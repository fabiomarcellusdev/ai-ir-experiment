// End-to-end: the real server process, spoken to over stdio as a harness does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('./main.mjs', import.meta.url));

function server(root) {
  const p = spawn(process.execPath, [MAIN, '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  const raw = [];
  p.stdout.on('data', (c) => {
    buf += c;
    for (let i = buf.indexOf('\n'); i !== -1; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      raw.push(line);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  const req = (method, params) => new Promise((resolve) => {
    const id = ++n;
    waiting.set(id, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name, args) => (await req('tools/call', { name, arguments: args })).result;
  return { p, req, tool, raw, stop: () => new Promise((r) => { p.on('exit', r); p.stdin.end(); }) };
}

test('a harness session: initialize, list, outline, find, read, edit, then a stale edit', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-main-'));
  writeFileSync(path.join(root, 'a.html'), '<main>\r\n<p>Hello <b>world</b></p>\r\n</main>\r\n');
  const s = server(root);
  try {
    const init = await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'html');
    s.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.equal((await s.req('tools/list')).result.tools.length, 4);
    const page = (await s.tool('html_outline', { file: 'a.html' })).content[0].text;
    const hash = page.match(/hash (\w+)/)[1];
    const found = (await s.tool('html_find', { file: path.join(root, 'a.html'), text: 'world' })).content[0].text;
    const ref = Number(found.match(/@(\d+) b$/m)[1]);
    assert.equal((await s.tool('html_read', { file: 'a.html', ref, hash })).content[0].text, '<b>world</b>');
    const ok = await s.tool('html_edit', { file: 'a.html', ref, hash, html: '<b>there</b>' });
    assert.match(ok.content[0].text, /^ok; hash \w{16}$/);
    assert.equal(readFileSync(path.join(root, 'a.html'), 'utf8'), '<main>\r\n<p>Hello <b>there</b></p>\r\n</main>\r\n');
    const stale = await s.tool('html_edit', { file: 'a.html', ref, hash, html: '' });
    assert.deepEqual(stale, { content: [{ type: 'text', text: 'html_edit: the file changed since the hash' }], isError: true });
    const esc = await s.tool('html_read', { file: '../a.html', ref, hash });
    assert.equal(esc.isError, true);
    for (const line of s.raw) assert.doesNotThrow(() => JSON.parse(line)); // stdout holds protocol lines only
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a call that is too slow gets a named error within 2 s, and the next call works', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-main-'));
  writeFileSync(path.join(root, 'deep.html'), '<div>'.repeat(200_000) + 'x');
  writeFileSync(path.join(root, 'ok.html'), '<p>fine</p>');
  const s = server(root);
  try {
    await s.req('initialize', {});
    const t = performance.now();
    const slow = await s.tool('html_outline', { file: 'deep.html' });
    const ms = performance.now() - t;
    assert.equal(slow.isError, true);
    assert.match(slow.content[0].text, /took longer than 1.5 s|deeper than 512/);
    // A loose bound for CI; the gate C0.2 script measures the 2 s limit with p50 and p99 (review, gap 9).
    assert.ok(ms < 5000, `${ms} ms`);
    const ok = await s.tool('html_find', { file: 'ok.html', text: 'fine' });
    assert.match(ok.content[0].text, /1 matches/);
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('security review, other finding 1: a root given through a junction accepts absolute paths in that form', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'hir-main-'));
  const real = path.join(base, 'real');
  const link = path.join(base, 'link');
  mkdirSync(real);
  writeFileSync(path.join(real, 'a.html'), '<p>through</p>');
  symlinkSync(real, link, 'junction');
  const s = server(link);
  try {
    await s.req('initialize', {});
    const r = await s.tool('html_find', { file: path.join(link, 'a.html'), text: 'through' });
    assert.match(r.content[0].text, /1 matches/);
  } finally {
    await s.stop();
    rmSync(base, { recursive: true, force: true });
  }
});
