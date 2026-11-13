// Tests of the C0.1 v2 script's own checks (experiments/c01/run-c01-v2.mjs), on made-up HTML: no model, no cost. The
// oracle tests need .venv-oracle/; without it they skip, with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entry } from './run-c01.mjs';
import { byteReasons, refusalKind, callArgs, oracle, textModel, oldRuns, locatorFor, checkJob, MUTANTS } from './run-c01-v2.mjs';
import { CASES, EXPECT } from '../../tests/gates/v2-cases.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const noOracle = existsSync(path.join(ROOT, '.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
  ? false : 'the Python oracle is not installed (.venv-oracle/)';
const f = (html) => entry('a.html', Buffer.from(html, 'utf8'));
const refOf = (e, tag, nth = 0) => e.m.els.filter((x) => x.tagName === tag)[nth].ref;

test('byteReasons accepts each right result and names each wrong one', () => {
  const e = f('<div><p class="a">Tom &amp; Jerry</p><img src=x/></div>');
  const p = refOf(e, 'p');
  const ch = (op, args, ref = p) => ({ op, args, ref });
  const t = e.text;
  assert.deepEqual(byteReasons(e, ch('remove', {}), t.replace('<p class="a">Tom &amp; Jerry</p>', '')), []);
  assert.deepEqual(byteReasons(e, ch('replace', { html: '<b>x</b>' }), t.replace('<p class="a">Tom &amp; Jerry</p>', '<b>x</b>')), []);
  assert.deepEqual(byteReasons(e, ch('insert_after', { html: '<i>n</i>' }), t.replace('</p>', '</p><i>n</i>')), []);
  assert.deepEqual(byteReasons(e, ch('set_attribute', { attribute: 'class', value: 'b & "c"' }), t.replace('class="a"', 'class="b &amp; &quot;c&quot;"')), []);
  assert.deepEqual(byteReasons(e, ch('set_attribute', { attribute: 'alt', value: 'v' }, refOf(e, 'img')), t.replace('<img src=x/>', '<img alt="v" src=x/>')), []);
  assert.deepEqual(byteReasons(e, ch('replace_text', { old: 'Tom & Jerry', new: 'A <b>' }), t.replace('Tom &amp; Jerry', 'A &lt;b>')), []);
  // A change of a part to the same text (development run, 2).
  assert.deepEqual(byteReasons(e, ch('replace_text', { old: 'Jerry', new: 'Jerry' }), t), []);
  // Negative controls.
  assert.match(byteReasons(e, ch('remove', {}), t.replace('<div>', '<div >').replace('<p class="a">Tom &amp; Jerry</p>', ''))[0], /outside the range/);
  assert.match(byteReasons(e, ch('set_attribute', { attribute: 'alt', value: 'v' }, refOf(e, 'img')), t.replace('<img src=x/>', '<img src=x alt="v"/>')).join(), /other bytes than the attribute/);
  assert.match(byteReasons(e, ch('replace_text', { old: 'Jerry', new: 'Ann' }), t.replace('Tom &amp; Jerry', 'Tom & Ann')).join(), /other bytes than one part/);
});

test('refusalKind maps exactly the closed list of named errors', () => {
  assert.equal(refusalKind('html_change: the new HTML changes the document outside the element'), 'outside');
  assert.equal(refusalKind('html_change: the element has no end tag in the file, so new HTML after it would go inside it'), 'noend');
  assert.equal(refusalKind('html_change: the text is inside a xmp element, whose text the tool cannot change'), 'rawtext');
  assert.equal(refusalKind('html_change: the text cannot be mapped to its bytes in the file'), 'nomap');
  assert.equal(refusalKind('html_change: the old text starts or ends inside one character reference of the file'), 'refbound');
  assert.equal(refusalKind('html_change: the new text would start the pre element with a line break, which the parser drops'), 'linebreak');
  for (const other of ['html_change: the old text occurs more than once in the element', 'html_change: 2 elements match; give a ref:\n…', 'html_change: the file changed since the hash']) {
    assert.equal(refusalKind(other), null, other);
  }
});

test('callArgs sends a ref with its hash, or a locator, with the hash only when asked', () => {
  assert.deepEqual(callArgs({ file: 'a.html', op: 'remove', args: {}, ref: 3, locator: null }, 'H'), { file: 'a.html', operation: 'remove', ref: 3, hash: 'H' });
  assert.deepEqual(callArgs({ file: 'a.html', op: 'remove', args: {}, ref: 3, locator: { id: 'x' }, withHash: false }, 'H'), { file: 'a.html', operation: 'remove', id: 'x' });
  assert.deepEqual(callArgs({ file: 'a.html', op: 'remove', args: {}, ref: 3, locator: { id: 'x' }, withHash: true }, 'H'), { file: 'a.html', operation: 'remove', id: 'x', hash: 'H' });
});

test('every fixed case has a known expectation, and every new control has a fixed case', () => {
  for (const c of CASES) assert.ok(c.expect === 'accept' || EXPECT[c.expect], c.name);
  for (const name of ['set_attribute that adds before />', 'insert_after without the end-tag check', 'replace_text that ignores the bounds of a character reference', 'a text locator that takes the first of several matches']) {
    assert.ok(MUTANTS[name], name);
    assert.ok(CASES.some((c) => c.control === name), `no fixed case for the control "${name}"`);
  }
});

test('the oracle model: old runs are found once in the target; locators name only the target', { skip: noOracle }, () => {
  const html = '<div id="box">\n<p>alpha beta gamma</p>\n<p>alpha beta delta</p>\n</div>\n<ul id="u"><li>one</li><li>two</li></ul>';
  const e = f(html);
  const facts = oracle('facts', { files: { 'a.html': html } })['a.html'];
  const tm = textModel(facts);
  const p1 = refOf(e, 'p', 0);
  const runs = oldRuns(tm, p1);
  assert.ok(runs.includes('gamma') && runs.includes('alpha beta gamma'));
  assert.ok(!runs.includes('alpha beta') || tm.textOf(p1).split('alpha beta').length === 2);
  // "alpha beta gamma" names only the first p; with the tag p it is the innermost p.
  assert.deepEqual(locatorFor(tm, p1), { text: 'alpha beta gamma', tag: 'p' });
  // The li has no unique run of 3 words; its parent has a unique id, so the locator is id, child and n.
  assert.deepEqual(locatorFor(tm, refOf(e, 'li', 1)), { id: 'u', child: 'li', n: 2 });
  // The ul's own id.
  assert.deepEqual(locatorFor(tm, refOf(e, 'ul')), { id: 'u' });
});

test('the oracle confirms a no-op replace_text, and refuses a change of another text (negative control)', { skip: noOracle }, () => {
  const html = '<p>Tom &amp; Jerry</p>';
  const e = f(html);
  const p = refOf(e, 'p');
  const ch = (id, after, args) => ({ id, file: 'a.html', ref: p, op: 'replace_text', args });
  const changes = [ch('same', html, { old: 'Jerry', new: 'Jerry' }), ch('right', '<p>Tom &amp; Ann</p>', { old: 'Jerry', new: 'Ann' }), ch('wrong', '<p>Bob &amp; Jerry</p>', { old: 'Jerry', new: 'Ann' })];
  const outcomes = new Map([['same', { accepted: true, after: html }], ['right', { accepted: true, after: '<p>Tom &amp; Ann</p>' }], ['wrong', { accepted: true, after: '<p>Bob &amp; Jerry</p>' }]]);
  const v = Object.fromEntries(oracle('check', checkJob([e], changes, outcomes)).changes.map((x) => [x.id, x.opOk]));
  assert.deepEqual(v, { same: true, right: true, wrong: false });
});
