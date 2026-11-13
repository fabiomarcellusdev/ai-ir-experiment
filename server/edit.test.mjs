import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from 'parse5';
import { load, element, markerSource } from './view.mjs';
import { editBytes } from './edit.mjs';
import { ToolError } from './errors.mjs';
import { rng, pick, randomHtml } from './testkit.mjs';

const H = 'h';
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof ToolError && re.test(e.message));
/** Whether the server can address an element: it has a clean range (decision 0006). */
const hasCleanRange = (m, ref) => {
  try {
    element(m, ref);
    return true;
  } catch (e) {
    if (e instanceof ToolError) return false; // a named refusal; any other error fails the test
    throw e;
  }
};
const refOf = (m, tag, n = 0) => m.els.filter((e) => e.tagName === tag)[n].ref;
const run = (src, tag, html, n = 0) => {
  const m = load(src, H);
  return editBytes(m, Buffer.from(src, 'utf8'), refOf(m, tag, n), H, html).toString('utf8');
};
const OUTSIDE = /changes the document outside the element/;

test('the edit writes the bytes before, the new HTML and the bytes after, with CRLF, a BOM and non-BMP text', () => {
  const src = '﻿<div>\r\n <p>\u{1F600} a</p>\r\n <p>b\u{1F600}</p>\r\n</div>\r\n';
  const bytes = Buffer.from(src, 'utf8');
  const m = load(src, H);
  const out = editBytes(m, bytes, refOf(load(src, H), 'p', 1), H, '<p>c\r\n\u{1F680}</p>');
  const before = bytes.subarray(0, bytes.indexOf(Buffer.from('<p>b')));
  const after = bytes.subarray(bytes.indexOf(Buffer.from('</p>\r\n</div>')) + 4);
  assert.deepEqual(out, Buffer.concat([before, Buffer.from('<p>c\r\n\u{1F680}</p>'), after]));
});

test('the edit removes an element with the empty string and keeps the whitespace around it', () => {
  assert.equal(run('<ul>\n <li>a</li>\n <li>b</li>\n</ul>', 'li', ''), '<ul>\n \n <li>b</li>\n</ul>');
});

test('the edit accepts an element with an implied end tag', () => {
  assert.equal(run('<ul><li>a<li>b</ul>', 'li', '<li>z'), '<ul><li>z<li>b</ul>');
});

test('the edit refuses each unbalanced fragment of C0.1, and the result would be wrong', () => {
  const src = '<div><p><span>x</span> y</p><p>z</p></div>';
  for (const frag of ['</div><div>', '<!--', '<script>', '</p>', '<p>', '<div>q</div>', '<table>']) {
    refuses(() => run(src, 'span', frag), OUTSIDE);
  }
});

test('the edit refuses a stale hash, a lone surrogate, a missing ref and the root elements', () => {
  const src = '<html><head><title>t</title></head><body><p>a</p></body></html>';
  const m = load(src, H);
  const b = Buffer.from(src);
  refuses(() => editBytes(m, b, refOf(m, 'p'), 'other', '<p>b</p>'), /changed since the hash/);
  refuses(() => editBytes(m, b, refOf(m, 'p'), H, '<p>\uD800</p>'), /lone surrogate/);
  refuses(() => editBytes(m, b, 99, H, '<p>b</p>'), /does not exist/);
  for (const t of ['html', 'head', 'body']) refuses(() => editBytes(load(src, H), b, refOf(m, t), H, ''), /html, head and body/);
  refuses(() => editBytes(m, b, refOf(m, 'p'), H, 5), /not a string/);
});

test('the edit refuses an element with no clean range', () => {
  const src = '<b><p>x</b>y</p>';
  const m = load(src, H);
  refuses(() => editBytes(m, Buffer.from(src), refOf(m, 'b'), H, '<b>z</b>'), /no clean range/);
});

// The marker check of the C0.1 oracle, done with parse5: the range of an accepted edit holds exactly the element.
// The marker is an empty copy of the element with a marker attribute, so the parser places it as it placed the
// element. (A comment marker fails at the start of a document: the parser puts that comment in the document node.)
function markerHolds(src, el) {
  const { startOffset: s, endOffset: e } = el.sourceCodeLocation;
  const marker = markerSource(el, 'data-mark');
  const marked = serialize(parse(src.slice(0, s) + marker + src.slice(e)));
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const order = [];
  const walk = (n) => { if (n.tagName) order.push(n); for (const c of n.childNodes ?? []) walk(c); };
  walk(doc);
  const twin = order[el.ref];
  const mark = { ...twin, attrs: [...twin.attrs, { name: 'data-mark', value: '' }], childNodes: [] };
  if (twin.content) mark.content = { nodeName: '#document-fragment', childNodes: [] };
  const kids = twin.parentNode.childNodes;
  kids.splice(kids.indexOf(twin), 1, mark);
  return serialize(doc) === marked;
}

test('property: an accepted edit is the exact splice of a range that holds exactly the element (400 files)', () => {
  const rnd = rng(1111);
  const FRAGS = ['', '<p>x</p>', 'text\r\nmore', '\u{1F600}', '</div><div>', '<!--', '<script>', '<b>b</b>', 'x &amp; y'];
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 400; i++) {
    const src = randomHtml(rnd, 20 + Math.floor(rnd() * 80));
    const bytes = Buffer.from(src, 'utf8');
    const probe = load(src, H);
    const cands = probe.els.filter((e) => e.sourceCodeLocation && !['html', 'head', 'body'].includes(e.tagName));
    if (!cands.length) continue;
    const el = pick(rnd, cands);
    const frag = pick(rnd, FRAGS);
    let out;
    try {
      out = editBytes(load(src, H), bytes, el.ref, H, frag);
    } catch (e) {
      assert.ok(e instanceof ToolError, String(e));
      assert.match(e.message, /no clean range|changes the document outside/);
      refused++;
      continue;
    }
    const { startOffset: s, endOffset: t } = el.sourceCodeLocation;
    const bs = Buffer.byteLength(src.slice(0, s));
    const be = Buffer.byteLength(src.slice(0, t));
    assert.deepEqual(out, Buffer.concat([bytes.subarray(0, bs), Buffer.from(frag), bytes.subarray(be)]));
    assert.ok(markerHolds(src, el), `marker check failed: @${el.ref} in ${JSON.stringify(src)}`);
    accepted++;
  }
  assert.ok(accepted > 100 && refused > 20, `accepted ${accepted}, refused ${refused}`);
});

// Regression tests for the review of 2026-11-11.

test('review 2: an edit that keeps the same bytes is never refused (quirks mode, tables in p, 300 files)', () => {
  assert.equal(run('<p>a<table><tr><td>c</td></tr></table></p>', 'p', '<p>a<table><tr><td>c</td></tr></table></p>'),
    '<p>a<table><tr><td>c</td></tr></table></p>');
  const rnd = rng(21);
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const src = randomHtml(rnd, 20 + Math.floor(rnd() * 80));
    const probe = load(src, H);
    for (const el of probe.els) {
      if (['html', 'head', 'body'].includes(el.tagName) || !hasCleanRange(probe, el.ref)) continue;
      const own = src.slice(el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset);
      assert.equal(editBytes(load(src, H), Buffer.from(src), el.ref, H, own).toString(), src, `@${el.ref} in ${src}`);
      n++;
    }
  }
  assert.ok(n > 3000, String(n));
});

test('review 3: a result deeper than 512 levels gets a named error, also when it is very deep', () => {
  refuses(() => run('<div><p>a</p></div>', 'p', '<span>'.repeat(600) + '</span>'.repeat(600)), /deeper than 512/);
  refuses(() => run('<div><p>a</p></div>', 'p', '<span>'.repeat(20000)), /deeper than 512/);
});

test('review 6: a leading line break in pre, and a CR before the file\'s LF, change nothing outside', () => {
  assert.equal(run('<pre><b>a</b></pre>', 'b', '\nhi'), '<pre>\nhi</pre>');
  assert.equal(run('<div><b>a</b>\nz</div>', 'b', 'x\r'), '<div>x\r\nz</div>');
  refuses(() => run('<pre><b>a</b>\nx</pre>', 'b', ''), OUTSIDE); // the parser would drop the text's own LF
});
