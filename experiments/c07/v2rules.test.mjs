// Tests of the v2 task rules (docs/contract.md, amendment "the gate text for the v2 tools", C.3 and C.4): the v2
// acceptance and C0.10's rules, each with a negative control. No network, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from './rules.mjs';
import { units, taskRule, previewType } from './tasks.mjs';
import { frozenFiles } from './freeze.mjs';

const page = (body) => `<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;
const el = (m, tag, nth = 0) => m.els.filter((e) => e.tagName === tag)[nth];

test('v2Accepts: the server accepts the change and writes exactly the expected bytes', () => {
  const m = R.view(page('<div><p class="a">Tom &amp; Jerry here</p></div>'));
  const p = el(m, 'p');
  const [s, e] = R.range(p);
  assert.equal(R.v2Accepts(m, p, 'remove', {}, [s, e, '']), true);
  const loc = p.sourceCodeLocation.attrs.class;
  assert.equal(R.v2Accepts(m, p, 'set_attribute', { attribute: 'class', value: 'b' }, [loc.startOffset, loc.endOffset, 'class="b"']), true);
  const at = m.text.indexOf('Tom &amp; Jerry');
  assert.equal(R.v2Accepts(m, p, 'replace_text', { old: 'Tom & Jerry', new: 'Ann' }, [at, at + 'Tom &amp; Jerry'.length, 'Ann']), true);
  // Negative controls: an expected change that is not the server's bytes, and a change that the server refuses.
  assert.equal(R.v2Accepts(m, p, 'remove', {}, [s, e + 1, '']), false);
  assert.equal(R.v2Accepts(m, el(m, 'div'), 'replace', { html: '</div><div>' }, [0, 0, '']), false);
});

test('wholeEdit uses v2: an element with an implied end tag gives no insertion', () => {
  const m = R.view(page('<ul><li>one<li>two</ul>'));
  assert.equal(R.wholeEdit(m, el(m, 'li'), 'insertion'), null);
  const ok = R.view(page('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(R.wholeEdit(ok, el(ok, 'li'), 'insertion')); // control: with an end tag
});

test('c10Quote: C0.3\'s quote, from the first direct text node, as written in the source', () => {
  const m = R.view(page('<p>alpha beta gamma delta epsilon zeta eta</p><p>a &amp; b c</p><p><b>x</b> tail words here</p>'));
  assert.equal(R.c10Quote(m, el(m, 'p', 0)), 'alpha beta gamma delta epsilon zeta');
  assert.equal(R.c10Quote(m, el(m, 'p', 1)), null); // "a & b c" is not in the source as written
  assert.equal(R.c10Quote(m, el(m, 'p', 2)), 'tail words here');
  assert.equal(R.c10Quote(R.view(page('<p>say "hi" now</p>')), el(R.view(page('<p>say "hi" now</p>')), 'p')), null); // a quote mark
});

test('c10Candidates: the deepest holder, and no other element of its tag holds the quote', () => {
  const m = R.view(page('<div>\n<p>unique words here</p>\n<p>shared words</p>\n<section><p>shared words</p></section>\n</div>'));
  const c = R.c10Candidates(m);
  assert.ok(c.some((x) => x.el === el(m, 'p', 0) && x.quote === 'unique words here'));
  assert.ok(!c.some((x) => x.quote === 'shared words')); // 2 p elements hold it
  // Negative control: an outer div whose first text node is also inside a child is not the deepest holder.
  const n = R.view(page('<div>alpha beta<span>alpha beta</span></div>'));
  assert.ok(!R.c10Candidates(n).some((x) => x.el === el(n, 'div')));
});

test('c10TextQuotes: 3 words or more, as written, held by no element outside the target and its ancestors', () => {
  const m = R.view(page('<div>\n<p>change these words please</p>\n<p>two words</p>\n<p>other text</p><span>change these words please</span>\n</div>'));
  assert.deepEqual(R.c10TextQuotes(m, el(m, 'p', 0)), []); // the span holds the same words
  assert.deepEqual(R.c10TextQuotes(m, el(m, 'p', 1)), []); // only 2 words
  const ok = R.view(page('<p>change these words please</p>'));
  assert.deepEqual(R.c10TextQuotes(ok, el(ok, 'p')).map((x) => x.quote), ['change these words please']);
});

// Review of the v2 task rules, finding 1: tests that fail when a C0.10 rule or a v2 freeze scope is broken.
const fourOptions = page('<select>' + ['one', 'two', 'three', 'four'].map((w, i) => `<option value="v${i}" title="t${i}">option ${w} words here</option>`).join('') + '</select>');

test('C0.10 structure: removal in odd files, insertion after the element in even files', () => {
  const m = R.view(page('<div title="a">block one words here</div>'));
  const [s, e] = R.range(el(m, 'div'));
  assert.deepEqual(units('c10', 'structure', m, 1).map((u) => u.change), [[s, e, '']]);
  assert.deepEqual(units('c10', 'structure', m, 2).map((u) => u.change), [[e, e, R.NEW_P]]);
  assert.equal(units('c10', 'structure', m, 2)[0].fields.op, 'insertion');
});

test('C0.10 task rule: a file must give the 4 tasks as an odd and as an even file', async () => {
  // Options in a select take a removal, but the parser drops an inserted p: the file fails as an even file.
  assert.match(await taskRule('c10', fourOptions, null), /structure: insertion/);
  const ok = page(['one', 'two', 'three', 'four'].map((w, i) => `<div title="t${i}">block ${w} words here</div>`).join('\n'));
  assert.equal(await taskRule('c10', ok, null), null); // control
});

test('C0.10 preview: C0.4\'s types in turn by file number', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => previewType('c10', n)), ['question', 'text', 'attribute', 'structure', 'question']);
});

test('c10Candidates: a target must hold a visible occurrence of its quote (an svg text is not visible)', () => {
  const m = R.view(page('<svg>words here now</svg><p>words here now</p>'));
  assert.deepEqual(R.c10Candidates(m).map((c) => c.el.tagName), ['p']);
});

test('c10Candidates: the cap of 50 occurrences, the quote length and the tag rule', () => {
  const spans = (k) => page(`<p>xx yy zz</p>${'<span>xx yy zz</span>'.repeat(k)}`);
  assert.ok(R.c10Candidates(R.view(spans(49))).some((c) => c.el.tagName === 'p')); // 50 occurrences
  assert.ok(!R.c10Candidates(R.view(spans(50))).some((c) => c.el.tagName === 'p')); // 51 occurrences
  const long = R.view(page(`<p>${Array.from({ length: 6 }, () => 'w'.repeat(14)).join(' ')}</p>`)); // 89 characters
  assert.equal(R.c10Quote(long, el(long, 'p')), null);
  assert.deepEqual(R.c10Candidates(R.view(page('<my_tag>odd tag words</my_tag>'))).map((c) => c.el.tagName), []);
  assert.equal(R.c10Candidates(R.view(page('<my-tag>odd tag words</my-tag>')))[0]?.el.tagName, 'my-tag'); // control
});

test('the v2 freeze scopes: the v2 records and both run plans, and no v1 task set', () => {
  const p = frozenFiles('previews-v2');
  const g = frozenFiles('gates-v2');
  for (const x of ['c07', 'c08', 'c09', 'c10']) {
    assert.ok(p.includes(`experiments/c07/preview-v2-${x}-tasks.json`), x);
    assert.ok(g.includes(`experiments/c07/v2-${x}-file-set.json`) && g.includes(`experiments/c07/v2-${x}-tasks.json`), x);
    assert.ok(!p.includes(`experiments/c07/v2-${x}-tasks.json`), x); // a preview freeze holds no gate task set
  }
  for (const s of [p, g]) {
    assert.ok(s.includes('docs/measurements/2026-11-12-c07-c10-v2-run-plan.md'));
    assert.ok(s.includes('docs/measurements/2026-11-12-c07-c09-run-plan.md')); // the v2 plan keeps its points
    assert.ok(s.includes('server/tools-v2.json') && s.includes('server/v2.mjs'));
    assert.deepEqual(s.filter((f) => /experiments\/c07\/(preview-)?c0[789]-(tasks|file-set)\.json$/.test(f)), []);
  }
  assert.deepEqual(frozenFiles('previews').filter((f) => f.includes('v2-')), []); // the v1 scope is as it was
});
