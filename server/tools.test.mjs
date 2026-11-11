import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspace } from './workspace.mjs';
import { runTool } from './tools.mjs';
import { ToolError } from './errors.mjs';

function setup(src) {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-tools-'));
  writeFileSync(path.join(root, 'p.html'), src);
  return { root, ws: openWorkspace(root), done: () => rmSync(root, { recursive: true, force: true }) };
}
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof ToolError && re.test(e.message));

test('outline, find, read and edit work together on one file', () => {
  const t = setup('<ul>\n <li id="a">Apple</li>\n <li>Pear</li>\n</ul>\n');
  try {
    const page = runTool(t.ws, 'html_outline', { file: 'p.html' }).text;
    const hash = page.match(/hash (\w+)/)[1];
    const found = runTool(t.ws, 'html_find', { file: 'p.html', text: 'Pear' }).text;
    const ref = Number(found.match(/@(\d+) li\n/)[1]);
    assert.equal(runTool(t.ws, 'html_read', { file: 'p.html', ref, hash }).text, '<li>Pear</li>');
    const w = runTool(t.ws, 'html_edit', { file: 'p.html', ref, hash, html: '<li>Plum</li>' }).write;
    t.ws.write(w.real, w.bytes, w.oldHash, w.id);
    assert.equal(readFileSync(path.join(t.root, 'p.html'), 'utf8'), '<ul>\n <li id="a">Apple</li>\n <li>Plum</li>\n</ul>\n');
    refuses(() => runTool(t.ws, 'html_read', { file: 'p.html', ref, hash }), /changed since the hash/);
    refuses(() => runTool(t.ws, 'html_edit', { file: 'p.html', ref, hash, html: '' }), /changed since the hash/);
  } finally { t.done(); }
});

test('each argument of the wrong type gives a named error', () => {
  const t = setup('<p>a</p>');
  try {
    refuses(() => runTool(t.ws, 'html_outline', {}), /"file" is not a string/);
    refuses(() => runTool(t.ws, 'html_outline', { file: 'p.html', page: '1' }), /"page" is not an integer/);
    refuses(() => runTool(t.ws, 'html_find', { file: 'p.html' }), /"text" is not a string/);
    refuses(() => runTool(t.ws, 'html_find', { file: 'p.html', text: '' }), /empty/);
    refuses(() => runTool(t.ws, 'html_read', { file: 'p.html', ref: '3', hash: 'x' }), /"ref" is not an integer/);
    refuses(() => runTool(t.ws, 'html_read', { file: 'p.html', ref: 3 }), /"hash" is not a string/);
    refuses(() => runTool(t.ws, 'html_edit', { file: 'p.html', ref: 3, hash: 'x' }), /"html" is not a string/);
    refuses(() => runTool(t.ws, 'html_delete', { file: 'p.html' }), /does not exist/);
    refuses(() => runTool(t.ws, 'html_outline', null), /"file" is not a string/);
  } finally { t.done(); }
});

test('the stale-ref case of C0.2: outline and find, then a change, then an edit with the old hash', () => {
  const t = setup('<p>one</p><p>two</p>');
  try {
    const hash = runTool(t.ws, 'html_outline', { file: 'p.html' }).text.match(/hash (\w+)/)[1];
    runTool(t.ws, 'html_find', { file: 'p.html', text: 'two' });
    writeFileSync(path.join(t.root, 'p.html'), '<p>zero</p><p>one</p><p>two</p>');
    refuses(() => runTool(t.ws, 'html_edit', { file: 'p.html', ref: 4, hash, html: '<p>x</p>' }), /changed since the hash/);
    assert.equal(readFileSync(path.join(t.root, 'p.html'), 'utf8'), '<p>zero</p><p>one</p><p>two</p>');
  } finally { t.done(); }
});

test('each path case of C0.2 fails with each of the 4 tools', () => {
  const t = setup('<p>a</p>');
  try {
    // The outside file exists, so "not found" cannot hide a missing outside check (review, gap 8).
    const outside = mkdtempSync(path.join(tmpdir(), 'hir-out-'));
    writeFileSync(path.join(outside, 'x.html'), '<p>o</p>');
    const cases = ['../p.html', path.join(outside, 'x.html'), '\\\\srv\\s\\p.html', 'CON.html', 'p.html:ads'];
    for (const file of cases) {
      for (const [name, extra] of [['html_outline', {}], ['html_find', { text: 'a' }],
        ['html_read', { ref: 3, hash: 'x' }], ['html_edit', { ref: 3, hash: 'x', html: '' }]]) {
        refuses(() => runTool(t.ws, name, { file, ...extra }), /path/);
      }
    }
  } finally { t.done(); }
});

test('security review, other finding 2: new HTML over 2 MB is refused before any parse', () => {
  const t = setup('<p>a</p>');
  try {
    refuses(() => runTool(t.ws, 'html_edit', { file: 'p.html', ref: 3, hash: 'x', html: 'a'.repeat(2 * 1024 * 1024 + 1) }), /larger than 2 MB/);
  } finally { t.done(); }
});
