// Regression tests for the review of the C0.1 v2 script (2026-11-12, 16 points), each with a negative control. No
// model, no cost; the oracle tests skip without .venv-oracle/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entry } from './run-c01.mjs';
import { oracle, textModel, oldRuns, locatorOptions, checkJob, reasons, refusalKind, controlResult, randomChanges, MUTANTS, byteReasons } from './run-c01-v2.mjs';
import { generator } from '../c05/draw-files.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const noOracle = existsSync(path.join(ROOT, '.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
  ? false : 'the Python oracle is not installed (.venv-oracle/)';
const f = (html, name = 'a.html') => entry(name, Buffer.from(html, 'utf8'));
const refOf = (e, tag, nth = 0) => e.m.els.filter((x) => x.tagName === tag)[nth].ref;
const model = (html) => textModel(oracle('facts', { files: { 'a.html': html } })['a.html']);

/** The oracle's verdict on accepted results: one change per [after, args]. */
function opOk(html, tag, op, list) {
  const e = f(html);
  const ref = refOf(e, tag);
  const changes = list.map(([, args], k) => ({ id: `c${k}`, file: 'a.html', ref, op, args }));
  const outcomes = new Map(list.map(([after], k) => [`c${k}`, { accepted: true, after }]));
  return oracle('check', checkJob([e], changes, outcomes)).changes.map((x) => x.opOk);
}

test('review 1 and 10: replace_text may change only one visible text node, and only the part', { skip: noOracle }, () => {
  const html = '<div><script>Tom</script><p>Tom here</p></div>';
  assert.deepEqual(opOk(html, 'div', 'replace_text', [
    ['<div><script>x</script><p>Tom here</p></div>', { old: 'Tom', new: 'x' }], // the script's text: not visible
    ['<div><script>Tom</script><p>x here</p></div>', { old: 'Tom', new: 'x' }], // control: the visible text
  ]), [false, true]);
  const ws = '<div><p>a</p>\n  Tom\n<p>b</p></div>';
  assert.deepEqual(opOk(ws, 'div', 'replace_text', [
    ['<div><p>a</p><p>b</p></div>', { old: 'Tom', new: '' }], // also the whitespace around it
    ['<div><p>a</p>\n  \n<p>b</p></div>', { old: 'Tom', new: '' }], // control: only the part
  ]), [false, true]);
});

test('op_ok for set_attribute and insert_after, each with a wrong result', { skip: noOracle }, () => {
  assert.deepEqual(opOk('<p class="a">x</p>', 'p', 'set_attribute', [
    ['<p class="b">x</p>', { attribute: 'class', value: 'b' }],
    ['<p class="b" id="z">x</p>', { attribute: 'class', value: 'b' }],
    ['<p title="t" class="a">x</p>', { attribute: 'title', value: 't' }],
  ]), [true, false, true]);
  assert.deepEqual(opOk('<div><p>first</p></div>', 'p', 'insert_after', [
    ['<div><p>first</p><b>new</b></div>', { html: '<b>new</b>' }],
    ['<div><p>first<b>new</b></p></div>', { html: '<b>new</b>' }],
  ]), [true, false]);
});

test('the refusal confirmations: each reason with a control that the oracle does not confirm', { skip: noOracle }, () => {
  const job = (html, tag, args, reason) => {
    const e = f(html);
    const ch = { id: 'r', file: 'a.html', ref: refOf(e, tag), op: 'replace_text', args };
    return oracle('check', checkJob([e], [ch], new Map([['r', { accepted: false, text: `html_change: ${reason}` }]]))).changes[0].confirmed;
  };
  const RAW = 'the text is inside a xmp element, whose text the tool cannot change';
  const REF = 'the old text starts or ends inside one character reference of the file';
  const LB = 'the new text would start the pre element with a line break, which the parser drops';
  assert.equal(job('<xmp>Hello there</xmp>', 'xmp', { old: 'Hello', new: 'x' }, RAW), true);
  assert.equal(job('<p>Hello there</p>', 'p', { old: 'Hello', new: 'x' }, RAW), false);
  assert.equal(job('<p>x&fjlig;ord here</p>', 'p', { old: 'jord', new: 'y' }, REF), true);
  assert.equal(job('<p>&copy2024 here</p>', 'p', { old: '2024', new: 'y' }, REF), false); // "2024" is plain text
  assert.equal(job('<pre>abc\ndef</pre>', 'pre', { old: 'abc', new: '' }, LB), true);
  assert.equal(job('<pre>abc\ndef</pre>', 'pre', { old: 'abc', new: 'x' }, LB), false);
});

test('review 12: numeric references decode as HTML does, control characters and noncharacters included', { skip: noOracle }, () => {
  // "&#1;" is U+0001 in HTML (Python's html.unescape drops it): a change of "ab" after it is not a reference bound.
  const e = f('<p>&#1;ab cd</p>');
  const ch = { id: 'r', file: 'a.html', ref: refOf(e, 'p'), op: 'replace_text', args: { old: 'ab', new: 'x' } };
  const v = oracle('check', checkJob([e], [ch], new Map([['r', { accepted: false, text: 'html_change: the text cannot be mapped to its bytes in the file' }]]))).changes[0];
  assert.equal(v.confirmed, false);
});

test('review 13: an old run is unique in the target and whole words there; review 4: both text locators are offered', { skip: noOracle }, () => {
  const html = '<div>\n<p>alpha beta gamma</p>\n<p>alpha</p>\n</div>\n<p>foo<b>bar</b> x</p>';
  const e = f(html);
  const tm = model(html);
  const runs = oldRuns(tm, refOf(e, 'p', 0));
  assert.ok(runs.includes('alpha')); // twice in the file, once in the target
  assert.ok(!oldRuns(tm, refOf(e, 'p', 2)).includes('bar')); // "foobar" is the whole word
  assert.deepEqual(locatorOptions(tm, refOf(e, 'p', 0)), [{ text: 'alpha beta gamma', tag: 'p' }, { text: 'alpha beta gamma' }]);
});

test('review 9 and 6: a locator refusal must equal the ref refusal; an ambiguous refusal lists every match', () => {
  const e = f('<div><p>a</p><p>a</p></div>');
  const ch = { id: 'c', kind: 'random', file: 'a.html', ref: refOf(e, 'p'), op: 'remove', args: {}, locator: { text: 'a' } };
  const o = { accepted: false, text: 'html_change: the new HTML changes the document outside the element', unchanged: true, byRefText: 'html_change: other' };
  assert.ok(reasons(e, ch, o, { tagOk: true, markerOk: true, kept: false }).some((x) => /not the refusal of the same change by ref/.test(x)));
  const amb = { ...ch, kind: 'case', expect: 'ambiguous', matches: e.m.els.filter((x) => x.tagName === 'p').map((x) => x.ref) };
  const hash = 'h'.repeat(16);
  const partial = { accepted: false, unchanged: true, text: `html_change: 2 elements match; give a ref:\n @${amb.matches[0]} p\nhash ${hash}` };
  assert.ok(reasons(e, amb, partial, {}).some((x) => /lacks @/.test(x)));
});

test('review 7: a control counts only its own failures, and its fixed case must be among them', () => {
  const base = [{ id: 'x' }];
  const outcomes = new Map([['y', { text: 'ok' }], ['z', { text: 'html_change: internal error (TypeError)' }], ['case:1', { text: 'ok' }]]);
  const changes = [{ id: 'case:1', control: 'c1' }];
  assert.deepEqual(controlResult('c1', [{ id: 'x' }, { id: 'y' }, { id: 'z' }], base, outcomes, changes), { failures: 1, caseFailed: false, ok: false });
  assert.deepEqual(controlResult('c1', [{ id: 'y' }, { id: 'case:1' }], base, outcomes, changes), { failures: 2, caseFailed: true, ok: true });
  assert.deepEqual(controlResult('c2', [], base, outcomes, changes), { failures: 0, caseFailed: null, ok: false });
});

test('review 11: the depth refusal is on the closed list', () => {
  assert.equal(refusalKind('html_change: the result nests elements deeper than 512 levels'), 'depth');
});

test('review 16: each control\'s line occurs exactly once in its server file', () => {
  for (const [name, [file, from]] of Object.entries(MUTANTS)) {
    assert.equal(readFileSync(path.join(ROOT, 'server', file), 'utf8').split(from).length, 2, name);
  }
});

test('review 16: the random draw gives the same changes for the same seed', { skip: noOracle }, () => {
  const html = '<div id="d">\n<p class="a">alpha beta gamma delta</p>\n<p>epsilon zeta eta</p>\n</div>';
  const e = f(html);
  const models = new Map([['a.html', model(html)]]);
  const a = randomChanges([e], models, generator(7), 40);
  const b = randomChanges([e], models, generator(7), 40);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, randomChanges([e], models, generator(8), 40)); // control: another seed
});

test('review 2: byteReasons and the verdict use the bytes as decoded strictly', () => {
  const e = f('<p>�</p><div>old</div>');
  const ch = { id: 'c', kind: 'random', file: 'a.html', ref: refOf(e, 'div'), op: 'replace', args: { html: '<i>n</i>' } };
  assert.deepEqual(reasons(e, ch, { accepted: true, invalidUtf8: true, after: null, text: 'ok' }, { tagOk: true, markerOk: true }), ['the result is not valid UTF-8']);
  assert.deepEqual(byteReasons(e, ch, '<p>�</p><i>n</i>'), []); // control: the right bytes
});
