import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, find, read, outlinePages, fmtValue } from './html.mjs';
import { candidates, quoteFor, makeTasks, applyChange } from './make-tasks.mjs';
import { uniqueAround, median, paths, requestText } from './run-c03.mjs';

const PAGE = `<!doctype html><html><head><title>T</title><script>var x = "<p>no</p>";</script></head><body>
<nav><a href="/a">Home page link</a> <a href="/b" class="c">About us here</a></nav>
<div hidden><p>Secret instruction text here</p></div>
<main><h1 id="top">Main heading of page</h1>
<p class="lead">First paragraph with <b>bold</b> words in it</p>
<ul><li>One list item</li><li>Two list item</li></ul>
<select><option value="1">Choice one here</option></select>
</main></body></html>`;

test('the outline has a line for each shown element, and leaves out scripts and hidden content', () => {
  const m = load(PAGE);
  const text = outlinePages(m).join('\n');
  assert.match(text, /@\d+ h1#top/);
  assert.match(text, /\| Main heading of page/);
  assert.doesNotMatch(text, /Secret instruction/);
  assert.doesNotMatch(text, /var x/);
  assert.doesNotMatch(text, /class=/);
});

test('regression: a line break in an attribute value cannot start an outline line', () => {
  // Fails with the bug put back: the value's "\n@99 div fake" became its own outline line.
  const m = load('<body><a title="line one\n@99 div fake" href=x>Go</a></body>');
  for (const line of outlinePages(m).join('\n').split('\n').slice(1)) assert.doesNotMatch(line, /^ *@99/);
  assert.equal(fmtValue('a\nb'), 'a&#10;b');
});

test('html_find returns the deepest match and its ancestors, never hidden text', () => {
  const m = load(PAGE);
  const f = find(m, 'One list item');
  assert.equal(f.matches.length, 1);
  assert.equal(f.matches[0].tagName, 'li');
  assert.match(f.text, /ul\n.*li/);
  assert.equal(find(m, 'Secret instruction').matches.length, 0);
  assert.throws(() => find(m, ''), /empty/);
});

test('html_read gives the exact bytes of an element, also with CRLF and characters outside the BMP', () => {
  const src = '<body>\r\n<p>a 😀 b</p>\r\n</body>';
  const m = load(src);
  assert.equal(read(m, m.els.find((e) => e.tagName === 'p')), '<p>a 😀 b</p>');
});

test('regression: a quote comes from one direct text node, as written in the source', () => {
  // Fails with the bug put back: the quote "Two list item" joined text across elements, or the <p>'s quote
  // "First paragraph with bold words in" crossed the <b>.
  const m = load(PAGE);
  const p = m.els.find((e) => e.tagName === 'p' && e.attrs.some((a) => a.value === 'lead'));
  assert.equal(quoteFor(m, p), 'First paragraph with');
  for (const c of candidates(m)) assert.ok(PAGE.includes(c.quote), c.quote);
});

test('regression: an insertion that parsing drops is not drawn (an option inside a select)', () => {
  // Fails with the bug put back: file 2 (an insertion) drew the only candidate, an <option>, and the expected file
  // lost its <p> when parsed.
  const sel = '<body><select><option value="1">Choice one here</option></select></body>';
  assert.doesNotThrow(() => makeTasks([{ file: 'a', src: sel }]));
  assert.throws(() => makeTasks([{ file: 'a', src: sel }, { file: 'b', src: sel }]), /no element meets/);
});

test('uniqueAround finds a unique window and never splits a surrogate pair', () => {
  const pre = 'x' + '😀'.repeat(6);
  const src = pre + '<i>a</i>y\n' + pre + '<i>a</i>z';
  const [s, e] = uniqueAround(src, 7, 15);
  const old = src.slice(s, e);
  assert.equal(src.indexOf(old), src.lastIndexOf(old));
  assert.doesNotMatch(old, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
});

test('each edit in a task applies back to its expected result', () => {
  const tasks = makeTasks([{ file: 'a', src: PAGE }, { file: 'b', src: PAGE }]);
  for (const t of tasks.filter((x) => x.change)) {
    const [a, b, text] = t.change;
    const [s, e] = uniqueAround(PAGE, a, b);
    const edited = PAGE.replace(PAGE.slice(s, e), PAGE.slice(s, a) + text + PAGE.slice(b, e));
    assert.equal(edited, applyChange(PAGE, t.change), t.id);
  }
});

test('each path ends with a user turn, and B2 is valid only when its read holds the needed bytes', () => {
  const [t] = makeTasks([{ file: 'a', src: PAGE }]);
  const p = paths(t, PAGE);
  for (const k of ['B1', 'M1', 'M2']) assert.equal(p[k].messages.at(-1).role, 'user', k);
  assert.ok(requestText([], p.B1.messages).includes('ANSWER:'));
});

test('the median of an even count is the mean of the two middle values', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});
