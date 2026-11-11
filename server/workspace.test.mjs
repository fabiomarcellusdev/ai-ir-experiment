import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, rmSync, linkSync, renameSync, chmodSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openWorkspace, MAX_BYTES, fsFail } from './workspace.mjs';
import { ToolError } from './errors.mjs';

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), 'hir-ws-'));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  mkdirSync(path.join(root, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, 'a.html'), '<p>a</p>');
  writeFileSync(path.join(root, 'sub', 'b.htm'), '<p>b</p>');
  writeFileSync(path.join(root, 'notes.txt'), 'SECRET=x');
  writeFileSync(path.join(outside, 'o.html'), '<p>o</p>');
  return { base, root, outside, ws: openWorkspace(root), done: () => rmSync(base, { recursive: true, force: true }) };
}

const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof ToolError && re.test(e.message));

test('reads a relative path and an absolute path inside the root', () => {
  const t = setup();
  try {
    assert.equal(t.ws.read('a.html').text, '<p>a</p>');
    assert.equal(t.ws.read('sub/b.htm').text, '<p>b</p>');
    assert.equal(t.ws.read('sub\\b.htm').text, '<p>b</p>');
    assert.equal(t.ws.read('./a.html').text, '<p>a</p>');
    assert.equal(t.ws.read(path.join(t.root, 'a.html')).text, '<p>a</p>');
  } finally { t.done(); }
});

test('refuses each path case of C0.2 with a named error', () => {
  const t = setup();
  try {
    refuses(() => t.ws.read('../outside/o.html'), /\.\./);
    refuses(() => t.ws.read('sub/../a.html'), /\.\./);
    refuses(() => t.ws.read(path.join(t.outside, 'o.html')), /outside the workspace/);
    refuses(() => t.ws.read('\\\\server\\share\\a.html'), /UNC/);
    refuses(() => t.ws.read('//server/share/a.html'), /UNC/);
    refuses(() => t.ws.read('\\\\?\\C:\\a.html'), /UNC/);
    refuses(() => t.ws.read('\\\\.\\CON'), /UNC/);
    for (const dev of ['CON.html', 'nul.html', 'COM1.html', 'lpt9.htm', 'sub/AUX.html', 'CON .html', 'con.x.html', 'COM\u00b9.html']) {
      refuses(() => t.ws.read(dev), /device name/);
    }
    refuses(() => t.ws.read('a.html:evil'), /data stream/);
    refuses(() => t.ws.read('a.html::$DATA'), /data stream/);
    refuses(() => t.ws.read('C:a.html'), /drive-relative/);
    refuses(() => t.ws.read('notes.txt'), /\.html/);
    refuses(() => t.ws.read(''), /empty/);
    refuses(() => t.ws.read('a\u0000.html'), /NUL/);
    refuses(() => t.ws.read('missing.html'), /not found/);
    refuses(() => t.ws.read('sub'), /not found|not a file|\.html/);
  } finally { t.done(); }
});

test('refuses a junction or link that leads out of the root', () => {
  const t = setup();
  try {
    symlinkSync(t.outside, path.join(t.root, 'j'), 'junction');
    refuses(() => t.ws.read('j/o.html'), /outside the workspace/);
  } finally { t.done(); }
});

test('refuses a file link to a non-HTML file, where the system allows file links', (ctx) => {
  const t = setup();
  try {
    try {
      symlinkSync(path.join(t.root, 'notes.txt'), path.join(t.root, 'link.html'), 'file');
    } catch (e) {
      // Windows refuses file links without developer mode; the junction test covers the escape there.
      ctx.skip(`file links not allowed here: ${e.code}`);
      return;
    }
    refuses(() => t.ws.read('link.html'), /\.html/);
  } finally { t.done(); }
});

test('refuses a file over the size limit and invalid UTF-8, before any parse', () => {
  const t = setup();
  try {
    writeFileSync(path.join(t.root, 'big.html'), Buffer.alloc(MAX_BYTES + 1, 0x61));
    refuses(() => t.ws.read('big.html'), /2 MB/);
    writeFileSync(path.join(t.root, 'bad.html'), Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe]));
    refuses(() => t.ws.read('bad.html'), /UTF-8/);
    writeFileSync(path.join(t.root, 'ok.html'), Buffer.alloc(MAX_BYTES, 0x61));
    assert.equal(t.ws.read('ok.html').bytes.length, MAX_BYTES);
  } finally { t.done(); }
});

test('keeps a BOM, CRLF and non-BMP characters, and hashes the bytes', () => {
  const t = setup();
  try {
    const bytes = Buffer.from('\uFEFF<p>\u{1F600}\r\n</p>', 'utf8');
    writeFileSync(path.join(t.root, 'x.html'), bytes);
    const f = t.ws.read('x.html');
    assert.equal(f.text, '\uFEFF<p>\u{1F600}\r\n</p>');
    assert.deepEqual(f.bytes, bytes);
    assert.equal(f.hash, createHash('sha256').update(bytes).digest('hex').slice(0, 16));
  } finally { t.done(); }
});

test('the atomic write replaces the bytes and leaves no temporary file', () => {
  const t = setup();
  try {
    const f = t.ws.read('a.html');
    const hash = t.ws.write(f.real, Buffer.from('<p>new</p>'), f.hash, f.id);
    assert.equal(readFileSync(path.join(t.root, 'a.html'), 'utf8'), '<p>new</p>');
    assert.equal(hash, t.ws.read('a.html').hash);
    assert.deepEqual(readdirSync(t.root).sort(), ['a.html', 'notes.txt', 'sub']);
  } finally { t.done(); }
});

test('the atomic write refuses when the file changed after the read, and changes nothing', () => {
  const t = setup();
  try {
    const f = t.ws.read('a.html');
    writeFileSync(path.join(t.root, 'a.html'), '<p>changed</p>');
    refuses(() => t.ws.write(f.real, Buffer.from('<p>new</p>'), f.hash, f.id), /changed/);
    assert.equal(readFileSync(path.join(t.root, 'a.html'), 'utf8'), '<p>changed</p>');
    assert.deepEqual(readdirSync(t.root).sort(), ['a.html', 'notes.txt', 'sub']);
  } finally { t.done(); }
});

test('the atomic write refuses a target outside the root', () => {
  const t = setup();
  try {
    refuses(() => t.ws.write(path.join(t.outside, 'o.html'), Buffer.from('x'), '0'), /outside the workspace/);
    assert.equal(readFileSync(path.join(t.outside, 'o.html'), 'utf8'), '<p>o</p>');
  } finally { t.done(); }
});

test('the root must be a folder that exists', () => {
  const t = setup();
  try {
    assert.throws(() => openWorkspace(path.join(t.base, 'nope')), /root/);
    assert.throws(() => openWorkspace(path.join(t.root, 'a.html')), /root/);
  } finally { t.done(); }
});

// Regression tests for the security review of 2026-11-11.

test('F1: refuses a hard link, which realpath cannot see through', () => {
  const t = setup();
  try {
    writeFileSync(path.join(t.outside, 'secret.txt'), 'FAKE_SECRET=abc');
    linkSync(path.join(t.outside, 'secret.txt'), path.join(t.root, 'hl.html'));
    refuses(() => t.ws.read('hl.html'), /hard link/);
  } finally { t.done(); }
});

test('F2: the write refuses when a folder became a junction, or the file another file, after the read', () => {
  const t = setup();
  try {
    const f = t.ws.read('sub/b.htm');
    renameSync(path.join(t.root, 'sub'), path.join(t.root, 'sub-old'));
    mkdirSync(path.join(t.outside, 'o2'));
    writeFileSync(path.join(t.outside, 'o2', 'b.htm'), '<p>b</p>');
    symlinkSync(path.join(t.outside, 'o2'), path.join(t.root, 'sub'), 'junction');
    refuses(() => t.ws.write(f.real, Buffer.from('<p>WRITTEN</p>'), f.hash, f.id), /outside the workspace/);
    assert.equal(readFileSync(path.join(t.outside, 'o2', 'b.htm'), 'utf8'), '<p>b</p>');
    const g = t.ws.read('a.html');
    rmSync(path.join(t.root, 'a.html'));
    writeFileSync(path.join(t.root, 'a.html'), '<p>a</p>'); // the same bytes, but another file
    refuses(() => t.ws.write(g.real, Buffer.from('<p>x</p>'), g.hash, g.id), /changed since the hash/);
  } finally { t.done(); }
});

test('F6: a read-only file gives a named error with no path, and the write keeps the mode', () => {
  const t = setup();
  try {
    const file = path.join(t.root, 'a.html');
    chmodSync(file, 0o444);
    const f = t.ws.read('a.html');
    assert.throws(() => t.ws.write(f.real, Buffer.from('x'), f.hash, f.id),
      (e) => e instanceof ToolError && /read-only/.test(e.message) && !e.message.includes(t.base));
    chmodSync(file, 0o640);
    const g = t.ws.read('a.html');
    t.ws.write(g.real, Buffer.from('<p>y</p>'), g.hash, g.id);
    assert.equal(statSync(file).mode & 0o777, process.platform === 'win32' ? 0o666 : 0o640);
    assert.deepEqual(readdirSync(t.root).sort(), ['a.html', 'notes.txt', 'sub']);
  } finally { t.done(); }
});

test('F6: a file-system error names its code, never a path', () => {
  const t = setup();
  try {
    mkdirSync(path.join(t.root, 'd.html'));
    // Windows refuses to open a folder (EISDIR); other systems open it, and the type check refuses it.
    assert.throws(() => t.ws.read('d.html'),
      (e) => e instanceof ToolError && /cannot be|not a file/.test(e.message) && !e.message.includes(t.base) &&
        !e.message.includes('d.html'));
  } finally { t.done(); }
});

test('F6: fsFail keeps the error code and drops the message, which holds paths', () => {
  const e = Object.assign(new Error("EPERM: operation not permitted, rename 'C:/Users/someone/x.tmp' -> 'C:/Users/someone/x.html'"), { code: 'EPERM' });
  assert.throws(() => fsFail(e, 'the file cannot be written'),
    (x) => x instanceof ToolError && x.message === 'the file cannot be written (EPERM)');
  const named = new ToolError('the file is read-only');
  assert.throws(() => fsFail(named, 'ignored'), (x) => x === named);
});
