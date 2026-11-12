// Tests of the v2 tools (decision 0008): html_find with a text or an id, html_change with a ref or a locator and its
// 5 operations, the optional `file`, and the end-to-end server with `--tools v2`. Each refusal has a test, and each
// test of an absence has a control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace } from './workspace.mjs';
import { runToolV2, fullHead, MAX_VALUE_SHOWN } from './v2.mjs';
import { load, findText } from './view.mjs';
import { TOOLS_V2 } from './protocol.mjs';
import { ToolError } from './errors.mjs';

const MAIN = fileURLToPath(new URL('./main.mjs', import.meta.url));

/** A workspace with files; `call` runs a v2 tool and, for a change, writes the bytes as the main thread does. */
function space(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-v2-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  const ws = openWorkspace(root);
  const call = (name, args) => {
    const r = runToolV2(ws, name, args);
    if (!r.write) return r.text;
    ws.write(r.write.real, r.write.bytes, r.write.oldHash, r.write.id);
    return `ok; changed ${r.note}`;
  };
  return { root, ws, call, read: (n) => readFileSync(path.join(root, n), 'utf8'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof ToolError && re.test(e.message));

const PAGE = '<!DOCTYPE html>\n<html><body>\n<ul id="nav">\n  <li class="a">One</li>\n  <li class="b" data-x="1">Two</li>\n  <li>Three</li>\n</ul>\n' +
  '<section class="big">\n  <h2>Pricing plans</h2>\n  <p>Terms &amp; conditions\n     apply to all buyers</p>\n</section>\n<p>Other text</p>\n</body></html>\n';

test('file is optional when the folder holds one .html file, and required with 0 or 2', () => {
  const one = space({ 'a.html': PAGE, 'notes.txt': 'x' });
  assert.match(one.call('html_find', { text: 'Pricing' }), /h2/);
  one.done();
  const two = space({ 'a.html': PAGE, 'b.html': PAGE });
  refuses(() => two.call('html_find', { text: 'Pricing' }), /give "file": the workspace holds 2 \.html or \.htm files/);
  assert.match(two.call('html_find', { text: 'Pricing', file: 'b.html' }), /h2/); // control: with a file it works
  two.done();
  const none = space({ 'a.txt': 'x' });
  refuses(() => none.call('html_find', { text: 'x' }), /holds 0 \.html or \.htm files/);
  none.done();
});

test('html_find with a text gives each match with all its attributes; v1 gives only a few', () => {
  const s = space({ 'a.html': PAGE });
  const out = s.call('html_find', { text: 'Two' });
  assert.match(out, /@\d+ li\(class=b data-x=1\)/);
  assert.match(out, /@\d+ ul#nav/); // the ancestor's outline line
  assert.match(out, /\n1 matches; hash [0-9a-f]{16}$/);
  // Control: v1's find line of the same element shows no class.
  assert.doesNotMatch(findText(load(PAGE, 'h'), 'Two'), /class=b/);
  s.done();
});

test('html_find with an id gives the element and its child elements; a missing or repeated id is refused', () => {
  const s = space({ 'a.html': PAGE });
  const out = s.call('html_find', { id: 'nav' });
  assert.deepEqual(out.split('\n').slice(0, 4).map((l) => l.replace(/@\d+ /, '@ ')), ['@ ul(id=nav)', ' @ li(class=a)', ' @ li(class=b data-x=1)', ' @ li']);
  refuses(() => s.call('html_find', { id: 'none' }), /no element has the id "none"/);
  refuses(() => s.call('html_find', { id: 'nav', text: 'x' }), /exactly one of "text" or "id"/);
  s.done();
  const d = space({ 'a.html': '<p id="x">1</p><p id="x">2</p>' });
  refuses(() => d.call('html_find', { id: 'x' }), /2 elements have the id "x"/);
  d.done();
});

test('fullHead cuts a long value and names its length', () => {
  const m = load(`<p title="${'v'.repeat(500)}">x</p>`, 'h');
  const line = fullHead(m.els.find((e) => e.tagName === 'p'));
  assert.ok(line.includes(`…(500 chars)`));
  assert.ok(line.length < MAX_VALUE_SHOWN + 60);
});

test('remove and replace by a text locator with a tag: the innermost element of that tag', () => {
  const s = space({ 'a.html': PAGE });
  assert.match(s.call('html_change', { operation: 'replace', text: 'Pricing plans', tag: 'section', html: '<p>New text</p>' }), /^ok; changed @\d+ section$/);
  assert.equal(s.read('a.html'), PAGE.replace(/<section class="big">[\s\S]*<\/section>/, '<p>New text</p>'));
  s.done();
  const r = space({ 'a.html': PAGE });
  r.call('html_change', { operation: 'remove', text: 'Three', tag: 'li' });
  assert.equal(r.read('a.html'), PAGE.replace('<li>Three</li>', ''));
  r.done();
});

test('a locator that fits 0 or several elements changes nothing and lists the matches', () => {
  const s = space({ 'a.html': PAGE });
  refuses(() => s.call('html_change', { operation: 'remove', text: 'missing words' }), /no element contains the text/);
  refuses(() => s.call('html_change', { operation: 'remove', text: 'Two', tag: 'section' }), /no element of the tag "section"/);
  refuses(() => s.call('html_change', { operation: 'remove', text: 'T' }), /^\d+ elements match; give a ref:\n[\s\S]*@\d+ li/);
  assert.equal(s.read('a.html'), PAGE);
  s.done();
});

test('the id locator with a child and n, and its refusals', () => {
  const s = space({ 'a.html': PAGE });
  s.call('html_change', { operation: 'set_attribute', id: 'nav', child: 'li', n: 2, attribute: 'class', value: 'updated-value-1' });
  assert.equal(s.read('a.html'), PAGE.replace('<li class="b" data-x="1">', '<li class="updated-value-1" data-x="1">'));
  refuses(() => s.call('html_change', { operation: 'remove', id: 'nav', child: 'li', n: 4 }), /the id "nav" has 3 child elements of the tag "li"/);
  refuses(() => s.call('html_change', { operation: 'remove', text: 'One', child: 'li' }), /"child" and "n" go with "id"/);
  refuses(() => s.call('html_change', { operation: 'remove', id: 'nav', tag: 'li' }), /"tag" goes with "text"/);
  s.done();
});

test('set_attribute adds a new attribute right after the tag name, and escapes the value', () => {
  const s = space({ 'a.html': '<p class="a">x</p><img src="i.png"/>' });
  s.call('html_change', { operation: 'set_attribute', text: 'x', attribute: 'title', value: 'say "hi" & go' });
  assert.equal(s.read('a.html'), '<p title="say &quot;hi&quot; &amp; go" class="a">x</p><img src="i.png"/>');
  const ref = Number(/@(\d+) img/.exec(s.call('html_outline', {}))[1]);
  const hash = /hash ([0-9a-f]{16})/.exec(s.call('html_outline', {}))[1];
  s.call('html_change', { operation: 'set_attribute', ref, hash, attribute: 'alt', value: 'pic' });
  assert.equal(s.read('a.html'), '<p title="say &quot;hi&quot; &amp; go" class="a">x</p><img alt="pic" src="i.png"/>');
  refuses(() => s.call('html_change', { operation: 'set_attribute', text: 'x', attribute: 'a b', value: 'v' }), /attribute name is not valid/);
  s.done();
});

test('replace_text replaces the source bytes of a visible text, entities and line breaks included', () => {
  const s = space({ 'a.html': PAGE });
  s.call('html_change', { operation: 'replace_text', text: 'Terms & conditions', old: 'Terms & conditions apply to', new: 'Updated <wording>' });
  assert.equal(s.read('a.html'), PAGE.replace('Terms &amp; conditions\n     apply to', 'Updated &lt;wording>'));
  s.done();
});

test('replace_text refuses a text that is missing, repeated, or across 2 text nodes', () => {
  const s = space({ 'a.html': '<div><p>ab ab</p><p>a <b>bold</b> c</p></div>' });
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'ab ab', old: 'ab', new: 'x' }), /occurs more than once/);
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'bold', tag: 'p', old: 'a bold', new: 'x' }), /not in one text node/);
  refuses(() => s.call('html_change', { operation: 'replace_text', text: 'ab ab', old: '  ', new: 'x' }), /old text is empty/);
  // Control: one occurrence works.
  s.call('html_change', { operation: 'replace_text', text: 'bold', tag: 'p', old: 'bold', new: 'strong' });
  assert.equal(s.read('a.html'), '<div><p>ab ab</p><p>a <b>strong</b> c</p></div>');
  s.done();
});

test('insert_after, a stale hash, and a fragment that changes the page outside are refused or applied as v1', () => {
  const s = space({ 'a.html': PAGE });
  s.call('html_change', { operation: 'insert_after', text: 'Other text', html: '<p>New text</p>' });
  assert.equal(s.read('a.html'), PAGE.replace('<p>Other text</p>', '<p>Other text</p><p>New text</p>'));
  refuses(() => s.call('html_change', { operation: 'remove', ref: 3, hash: '0000000000000000' }), /changed since the hash/);
  refuses(() => s.call('html_change', { operation: 'remove', ref: 3 }), /give "hash" with "ref"/);
  const before = s.read('a.html');
  refuses(() => s.call('html_change', { operation: 'replace', text: 'Three', tag: 'li', html: '</ul><div>' }), /changes the document outside/);
  assert.equal(s.read('a.html'), before);
  refuses(() => s.call('html_change', { operation: 'rename', text: 'Three' }), /"operation" must be one of/);
  refuses(() => s.call('html_change', { operation: 'replace', text: 'Three' }), /needs the argument "html"/);
  s.done();
});

test('the v2 tool text: 3 tools, each listed in the server, with the 5 operations', () => {
  assert.deepEqual(TOOLS_V2.map((t) => t.name), ['html_find', 'html_change', 'html_outline']);
  assert.deepEqual(TOOLS_V2[1].inputSchema.properties.operation.enum, ['remove', 'replace', 'insert_after', 'set_attribute', 'replace_text']);
});

function server(root, tools) {
  const p = spawn(process.execPath, [MAIN, '--root', root, ...(tools ? ['--tools', tools] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  p.stdout.on('data', (c) => {
    buf += c;
    for (let i = buf.indexOf('\n'); i !== -1; i = buf.indexOf('\n')) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  const req = (method, params) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { req, stop: () => new Promise((r) => { p.on('exit', r); p.stdin.end(); }) };
}

test('end to end: --tools v2 lists the v2 tools and changes a file; the default is still v1', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-v2e-'));
  mkdirSync(path.join(root, 'sub'));
  writeFileSync(path.join(root, 'a.html'), PAGE);
  const v2 = server(root, 'v2');
  assert.deepEqual((await v2.req('tools/list')).result.tools.map((t) => t.name), ['html_find', 'html_change', 'html_outline']);
  const r = (await v2.req('tools/call', { name: 'html_change', arguments: { operation: 'remove', text: 'Three', tag: 'li' } })).result;
  assert.match(r.content[0].text, /^ok; changed @\d+ li; hash [0-9a-f]{16}$/);
  assert.equal(readFileSync(path.join(root, 'a.html'), 'utf8'), PAGE.replace('<li>Three</li>', ''));
  const v1tool = (await v2.req('tools/call', { name: 'html_read', arguments: {} })).error;
  assert.match(v1tool.message, /Unknown tool: html_read/);
  await v2.stop();
  const v1 = server(root);
  assert.deepEqual((await v1.req('tools/list')).result.tools.map((t) => t.name), ['html_outline', 'html_find', 'html_read', 'html_edit']);
  await v1.stop();
  rmSync(root, { recursive: true, force: true });
});

// --- The size field (decision 0009, option B; owner, 2026-11-12) -------------------------------------------------
import { sizeNote, SIZE_SHOWN_FROM } from './v2.mjs';

/** A section of exactly `bytes` UTF-8 bytes, with an id; `fill` repeats to reach the size. */
function sectionOf(bytes, fill = 'a') {
  const open = '<section id="big">\n';
  const close = '\n</section>';
  const room = bytes - Buffer.byteLength(open + close);
  const unit = Buffer.byteLength(fill);
  return open + fill.repeat(Math.floor(room / unit)) + 'b'.repeat(room % unit) + close;
}

test('an element of 1 KB or more shows its source size; a smaller one shows none', () => {
  assert.equal(SIZE_SHOWN_FROM, 1024);
  const at = (bytes, fill) => {
    const html = `<!DOCTYPE html><html><body>${sectionOf(bytes, fill)}<p id="small">x</p></body></html>`;
    const m = load(html, 'h');
    const el = m.els.find((e) => e.attrs.some((a) => a.value === 'big'));
    assert.equal(Buffer.byteLength(html.slice(el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset)), bytes);
    return sizeNote(m, el);
  };
  assert.equal(at(1023), ''); // the control, 1 byte under
  assert.equal(at(1024), ' [1.0 KB, 3 lines]');
  assert.equal(at(5000), ' [4.9 KB, 3 lines]');
  // Bytes, not UTF-16 units: 600 two-byte characters are 1,200 bytes.
  assert.equal(at(1240, 'é'), ' [1.2 KB, 3 lines]');
});

test('html_find shows the size on a large match and on a large child of an id, not on small lines or ancestors', () => {
  const big = '<div id="wrap">\n' + `<section id="big">\n${'<p>Line of filler text here</p>\n'.repeat(60)}</section>\n` + '<p id="small">Tiny</p>\n</div>';
  const s = space({ 'a.html': `<!DOCTYPE html><html><body>\n${big}\n</body></html>` });
  const byId = s.call('html_find', { id: 'wrap' }).split('\n');
  assert.match(byId[0], /^@\d+ div\(id=wrap\) \[1\.\d KB, 65 lines\]$/);
  assert.match(byId[1], /^ @\d+ section\(id=big\) \[1\.\d KB, 62 lines\]$/);
  assert.match(byId[2], /^ @\d+ p\(id=small\)$/); // small: no size
  const byText = s.call('html_find', { text: 'Tiny' });
  assert.match(byText, /@\d+ p\(id=small\)\n/); // the match is small
  assert.doesNotMatch(byText, /div#wrap \[/); // the ancestor's outline line gets no size
  s.done();
});

test('the size stays visible after a long line is cut, and an implied end tag still counts the content', () => {
  const long = 'x'.repeat(5000);
  // 80 attributes of about 160 characters: a line over LINE_CAP (10,000), so fullHead cuts it.
  const html = `<!DOCTYPE html><html><body><div ${Array.from({ length: 80 }, (_, i) => `data-a${i}="${'v'.repeat(150)}"`).join(' ')}>${long}</div><ul><li id="li">${long}<li>next</ul></body></html>`;
  const s = space({ 'a.html': html });
  assert.match(s.call('html_find', { text: long.slice(0, 50) }), /…\(\d+ chars\) \[\d+\.\d KB, 1 line\]/);
  assert.match(s.call('html_find', { id: 'li' }), /^@\d+ li\(id=li\) \[4\.9 KB, 1 line\]/);
  s.done();
});

test('the html_find text names the size field and the advice for a large element', () => {
  assert.match(TOOLS_V2[0].description, /1 KB or more/);
  assert.match(TOOLS_V2[0].description, /html_change/);
});

test('the size counts CRLF once and a lone CR as a line end, in UTF-8 bytes after a BOM and with 4-byte characters', () => {
  const body = (sep) => `<div id="big">${'abcdefgh'.repeat(130)}${sep}x${sep}y</div>`;
  const note = (html) => { const m = load(html, 'h'); return sizeNote(m, m.els.find((e) => e.attrs.some((a) => a.value === 'big'))); };
  assert.equal(note(body('\r\n')), ' [1.0 KB, 3 lines]'); // 14 + 1,040 + 2 + 1 + 2 + 1 + 6 = 1,066 bytes
  assert.equal(note(body('\r')), ' [1.0 KB, 3 lines]');
  assert.equal(note(body('\n')), ' [1.0 KB, 3 lines]');
  assert.equal(note('﻿' + body('\n')), ' [1.0 KB, 3 lines]'); // the BOM is outside the element
  assert.equal(note(`<div id="big">${'😀'.repeat(300)}</div>`), ' [1.2 KB, 1 line]'); // 300 x 4 bytes + 20
});

test('a locator error lists its matches with their sizes', () => {
  const big = `<p class="x">Same ${'w'.repeat(1100)}</p>`;
  const s = space({ 'a.html': `<!DOCTYPE html><html><body>${big}${big}</body></html>` });
  refuses(() => s.call('html_change', { operation: 'remove', text: 'Same' }), /2 elements match; give a ref:\n[\s\S]*@\d+ p\(class=x\) \[1\.1 KB, 1 line\]/);
  s.done();
});
