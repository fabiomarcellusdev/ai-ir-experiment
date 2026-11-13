// Regression tests for the correctness review and the security review of the v2 tools (2026-11-12), each with a
// control. Hostile input too: CRLF, a BOM, characters outside the BMP, entities with no ";", RAWTEXT, large files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspace } from './workspace.mjs';
import { runToolV2, fullHead, MAX_ARG, viewOf } from './v2.mjs';
import { load, PAGE_CHARS, element } from './view.mjs';
import { ToolError } from './errors.mjs';

function space(text, name = 'a.html') {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-v2r-'));
  writeFileSync(path.join(root, name), text);
  const ws = openWorkspace(root);
  const call = (tool, args) => {
    const r = runToolV2(ws, tool, args);
    if (!r.write) return r.text;
    ws.write(r.write.real, r.write.bytes, r.write.oldHash, r.write.id);
    return 'ok';
  };
  return { root, call, read: () => readFileSync(path.join(root, name), 'utf8'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof ToolError && re.test(e.message));
const hashOf = (s) => /hash ([0-9a-f]{16})/.exec(s.call('html_outline', {}))[1];

test('review 1: set_attribute keeps an unquoted value that ends in "/"', () => {
  const s = space('<p><a href=/docs/>Docs</a><img src=a.png/></p>');
  s.call('html_change', { operation: 'set_attribute', text: 'Docs', tag: 'a', attribute: 'title', value: 't' });
  s.call('html_change', { operation: 'set_attribute', id: undefined, text: 'Docs', tag: 'p', attribute: 'class', value: 'c' });
  assert.equal(s.read(), '<p class="c"><a title="t" href=/docs/>Docs</a><img src=a.png/></p>');
  // The parsed values stay the same (control: the old code made href "/docs").
  const a = load(s.read(), 'h').els.find((e) => e.tagName === 'a');
  assert.equal(a.attrs.find((x) => x.name === 'href').value, '/docs/');
  s.done();
});

test('review 2: insert_after is refused after an element with an implied end tag; control: with an end tag it works', () => {
  for (const html of ['<body><p>first<p>second</body>', '<ul><li>one<li>two</ul>']) {
    const s = space(html);
    refuses(() => s.call('html_change', { operation: 'insert_after', text: html.includes('first') ? 'first' : 'one', html: '<b>new</b>' }), /no end tag in the file/);
    assert.equal(s.read(), html);
    s.done();
  }
  const ok = space('<ul><li>one</li><li>two</li></ul>');
  ok.call('html_change', { operation: 'insert_after', text: 'one', html: '<li>new</li>' });
  assert.equal(ok.read(), '<ul><li>one</li><li>new</li><li>two</li></ul>');
  ok.done();
});

test('review 3: n without child is refused, not ignored', () => {
  const s = space('<ul id="u"><li>1</li><li>2</li></ul>');
  refuses(() => s.call('html_change', { operation: 'remove', id: 'u', n: 2 }), /"n" goes with "child"/);
  assert.equal(s.read(), '<ul id="u"><li>1</li><li>2</li></ul>');
  s.done();
});

test('review 4: replace_text refuses half of a reference and a lone surrogate; control: a whole reference', () => {
  const s = space('<p>x&fjlig;ord here</p><p>x\u{1F600}y</p><p>Tom &amp; Jerry</p>');
  // "&fjlig;" is one reference that decodes to 2 characters, "fj": a change cannot start at its "j".
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'here', old: 'jord', new: 'x' }), /inside one character reference/);
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'x\u{1F600}y', old: '\uDE00y', new: 'z' }), /lone surrogate/);
  s.call('html_change', { operation: 'replace_text', text: 'Jerry', old: 'Tom & Jerry', new: 'Tom and Jerry' });
  assert.equal(s.read(), '<p>x&fjlig;ord here</p><p>x\u{1F600}y</p><p>Tom and Jerry</p>');
  s.done();
});

test('a legacy reference with no ";" ends before the plain text after it (&copy2024 is © and "2024")', () => {
  const s = space('<p>&copy2024 Acme</p><p>&notit; x</p>');
  s.call('html_change', { operation: 'replace_text', text: 'Acme', old: '2024', new: '2025' });
  s.call('html_change', { operation: 'replace_text', text: 'x', tag: 'p', old: 'it;', new: 'in' });
  assert.equal(s.read(), '<p>&copy2025 Acme</p><p>&notin x</p>');
  // The parsed text is what the agent asked for: © then 2025, and ¬ then "in".
  const ps = load(s.read(), 'h').els.filter((e) => e.tagName === 'p').map((e) => e.childNodes[0].value);
  assert.deepEqual(ps, ['©2025 Acme', '¬in x']);
  s.done();
});

test('review 5: replace_text refuses a RAWTEXT element; control: a textarea (RCDATA) decodes its entities', () => {
  const s = space('<xmp>Hello there</xmp><textarea>Old words</textarea>');
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'Hello', old: 'Hello', new: 'A & B' }), /inside a xmp element/);
  s.call('html_change', { operation: 'replace_text', text: 'Old words', old: 'Old', new: 'A & B' });
  assert.equal(s.read(), '<xmp>Hello there</xmp><textarea>A &amp; B words</textarea>');
  s.done();
});

test('review 6 and security 2: the tag locator is linear; 20,000 matches answer within the time limit', () => {
  const s = space(`<table>${'<tr><td>cell</td></tr>'.repeat(20_000)}</table>`);
  const t0 = Date.now();
  refuses(() => s.call('html_change', { operation: 'remove', text: 'cell', tag: 'td' }), /^20000 elements match; give a ref:/);
  // CI checks correctness, not time (AGENTS.md, "Version control and CI"): a shared runner took 1,508 ms (pull request
  // #4, 2026-11-13). There, the bound only catches a quadratic slowdown; the server's 1.5 s limit is checked locally.
  const limit = process.env.CI ? 5000 : 1500;
  assert.ok(Date.now() - t0 < limit, `took ${Date.now() - t0} ms`);
  s.done();
});

test('review 7: tags are case-insensitive; a hash with a locator is checked (security 1)', () => {
  const s = space('<div><P>Para</P></div>');
  const h = hashOf(s);
  refuses(() => s.call('html_change', { operation: 'remove', text: 'Para', tag: 'P', hash: '0000000000000000' }), /changed since the hash/);
  s.call('html_change', { operation: 'remove', text: 'Para', tag: 'P', hash: h }); // control: the right hash
  assert.equal(s.read(), '<div></div>');
  s.done();
});

test('review 8: fullHead names a long data: URI\'s full length, and never splits a surrogate pair', () => {
  const m = load(`<img src="data:image/png;base64,${'A'.repeat(50_000)}"><p title="${'x'.repeat(199)}\u{1F600}rest">t</p>`, 'h');
  assert.match(fullHead(m.els.find((e) => e.tagName === 'img')), /data:…\(50022 chars\)/);
  const line = fullHead(m.els.find((e) => e.tagName === 'p'));
  assert.equal(line.isWellFormed(), true);
});

test('security 3: html_find with an id is cut at one page, with the real child count', () => {
  const s = space(`<div id="d">${'<i a="1" b="2" c="3" d="4" e="5" f="6" g="7"></i>'.repeat(20_000)}</div>`);
  const out = s.call('html_find', { id: 'd' });
  assert.ok(out.length < PAGE_CHARS + 200);
  assert.match(out, /… output cut at 60,000 characters\n1 match; 20000 child elements; hash/);
  s.done();
});

test('security 6: a parser-made element named by its id gets a named error, not an internal error', () => {
  const s = space('<p>x</p><body id=b><div>y</div>');
  refuses(() => s.call('html_change', { operation: 'set_attribute', id: 'b', attribute: 'class', value: 'c' }), /no source bytes|no clean range|html, head and body/);
  s.done();
});

test('security 8: long locator arguments are refused before the read, and errors quote at most 80 characters', () => {
  const s = space('<p id="x">t</p>');
  refuses(() => s.call('html_find', { id: 'i'.repeat(MAX_ARG + 1) }), /longer than 10,000 characters/);
  assert.throws(() => s.call('html_find', { id: 'q'.repeat(5000) }), (e) => e.message.length < 200);
  s.done();
});

test('a dot file is not "the one file"; hostile input: CRLF and a BOM keep their bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-v2d-'));
  writeFileSync(path.join(root, '.hidden.html'), '<p>h</p>');
  writeFileSync(path.join(root, 'a.html'), '﻿<div>\r\n<p class="a">One two</p>\r\n</div>\r\n');
  const ws = openWorkspace(root);
  const r = runToolV2(ws, 'html_change', { operation: 'set_attribute', text: 'One two', attribute: 'class', value: 'b' });
  ws.write(r.write.real, r.write.bytes, r.write.oldHash, r.write.id);
  assert.equal(readFileSync(path.join(root, 'a.html'), 'utf8'), '﻿<div>\r\n<p class="b">One two</p>\r\n</div>\r\n');
  rmSync(root, { recursive: true, force: true });
});

test('gate-text review 9: an id never shows hidden content; hidden children are marked with no attributes', () => {
  const s = space('<form id=f><input type=hidden value="secret words"><p class="c">Shown</p></form><div id=h hidden><b id=in>x</b></div>');
  const out = s.call('html_find', { id: 'f' });
  assert.match(out, / @\d+ input \(hidden\)/);
  assert.doesNotMatch(out, /secret words/);
  assert.match(out, / @\d+ p\(class=c\)/); // control: a shown child keeps its attributes
  refuses(() => s.call('html_find', { id: 'h' }), /no element has the id "h"/);
  refuses(() => s.call('html_find', { id: 'in' }), /no element has the id "in"/);
  s.done();
});

test('gate-text review 5: replace_text refuses to start a pre with a line break; control: other changes in it', () => {
  const s = space('<pre>abc\ndef</pre>');
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'abc', old: 'abc', new: '' }), /line break, which the parser drops/);
  s.call('html_change', { operation: 'replace_text', text: 'abc', old: 'abc', new: 'xyz' });
  assert.equal(s.read(), '<pre>xyz\ndef</pre>');
  s.done();
});

test('the marker parse of an element runs once for each view (the result is kept)', () => {
  const m = load('<div>Q<table><tr><td>x</td>X</tr></table></div>', 'h');
  const td = m.els.find((e) => e.tagName === 'td');
  assert.equal(m.ranges.get(td), 'check'); // fostered text: the range needs the marker parse
  element(m, td.ref);
  assert.equal(m.ranges.get(td), true);
  assert.equal(element(m, td.ref), td); // control: a second call still gives the element
  // A range that the marker parse finds not exact is kept as false, and refused again (review of C0.2 v2, 9).
  const bad = load('<b><p>x</b>y</p>', 'h');
  const b = bad.els.find((e) => e.tagName === 'b' && e.sourceCodeLocation);
  const first = bad.ranges.get(b);
  assert.throws(() => element(bad, b.ref), /no clean range/);
  assert.throws(() => element(bad, b.ref), /no clean range/);
  if (first === 'check') assert.equal(bad.ranges.get(b), false);
});

test('the C0.2 v2 gate run: a view is kept for the same text only, and a change after a find stays right', () => {
  const a = { real: '/x/a.html', text: '<p>one</p>', hash: 'h1' };
  const m1 = viewOf(a);
  assert.equal(viewOf({ ...a }), m1); // the same file and text: the kept view
  assert.notEqual(viewOf({ ...a, text: '<p>two</p>', hash: 'h1' }), m1); // another text with the same hash: a new view
  assert.notEqual(viewOf({ ...a, real: '/x/b.html' }), m1); // another file
  // A find, then 2 changes on the same file: each result is right (the kept view is not left changed).
  const s = space('<div><p class="a">one</p><p>two</p></div>');
  s.call('html_find', { text: 'one' });
  s.call('html_change', { operation: 'set_attribute', text: 'one', attribute: 'class', value: 'b' });
  s.call('html_change', { operation: 'replace_text', text: 'two', old: 'two', new: 'three' });
  assert.equal(s.read(), '<div><p class="b">one</p><p>three</p></div>');
  s.done();
});

test('hidden text is skipped by the text locator; control: the same text when not hidden', () => {
  const s = space('<p>alpha <span hidden>beta</span></p><p>gamma beta</p>');
  s.call('html_change', { operation: 'remove', text: 'beta' });
  assert.equal(s.read(), '<p>alpha <span hidden>beta</span></p>');
  s.done();
});
