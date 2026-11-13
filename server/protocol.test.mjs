import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, TOOLS, KNOWN_VERSIONS, LineSplitter, toolResult } from './protocol.mjs';

const call = (obj, tool = async () => toolResult('t')) => handle(JSON.stringify(obj), tool);

test('tools/list gives the frozen definitions of mcp-tools.json, renamed only', async () => {
  const raw = JSON.parse(readFileSync('experiments/c03/mcp-tools.json', 'utf8'));
  const r = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(r.result.tools.length, 4);
  r.result.tools.forEach((t, i) => {
    assert.deepEqual(Object.keys(t), ['name', 'description', 'inputSchema', '_meta']);
    // The size that Claude Code shows inline: at least one outline page and its header (C0.6 run plan).
    assert.deepEqual(t._meta, { 'anthropic/maxResultSizeChars': 65_000 });
    assert.equal('mcp__html__' + t.name, raw[i].name);
    assert.equal(t.description, raw[i].description);
    assert.equal(JSON.stringify(t.inputSchema), JSON.stringify(raw[i].input_schema));
  });
  assert.deepEqual(TOOLS.map((t) => t.name), ['html_outline', 'html_find', 'html_read', 'html_edit']);
});

test('initialize names the server html, sends no instructions, and agrees on a version', async () => {
  const r = await call({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.deepEqual(Object.keys(r.result).sort(), ['capabilities', 'protocolVersion', 'serverInfo']);
  assert.equal(r.result.serverInfo.name, 'html');
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.equal(r.id, 'a');
  const u = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
  assert.equal(u.result.protocolVersion, KNOWN_VERSIONS.at(-1));
  assert.ok(!JSON.stringify(u).includes('instructions'));
});

test('the JSON-RPC errors: parse error, invalid request, unknown method, unknown tool', async () => {
  assert.equal((await handle('{not json', async () => {})).error.code, -32700);
  assert.equal((await handle('[{"jsonrpc":"2.0","id":1,"method":"ping"}]', async () => {})).error.code, -32600);
  assert.equal((await call({ jsonrpc: '1.0', id: 1, method: 'ping' })).error.code, -32600);
  assert.equal((await call({ jsonrpc: '2.0', id: { x: 1 }, method: 'ping' })).error.code, -32600);
  assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).error.code, -32601);
  const t = await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'html_delete', arguments: {} } });
  assert.equal(t.error.code, -32602);
  assert.deepEqual(await call({ jsonrpc: '2.0', id: 7, method: 'ping' }), { jsonrpc: '2.0', id: 7, result: {} });
});

test('a notification and a client response get no reply', async () => {
  assert.equal(await call({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await call({ jsonrpc: '2.0', id: 3, result: {} }), null);
});

test('tools/call passes the name and the arguments, and returns the tool result', async () => {
  let seen;
  const r = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'html_find', arguments: { file: 'a.html', text: 'x' } } },
    async (n, a) => { seen = [n, a]; return toolResult('html_find: the search text is empty', true); });
  assert.deepEqual(seen, ['html_find', { file: 'a.html', text: 'x' }]);
  assert.deepEqual(r.result, { content: [{ type: 'text', text: 'html_find: the search text is empty' }], isError: true });
});

test('the line splitter: CRLF, chunks that split a character, blank lines, and an over-long line', () => {
  const lines = [];
  let tooLong = 0;
  const s = new LineSplitter((l) => lines.push(l), () => tooLong++, 10);
  const bytes = Buffer.from('ab\r\n\n\u{1F600}c\n', 'utf8');
  for (const b of bytes) s.push(Buffer.from([b]));
  s.push(Buffer.from('0123456789ABC'));
  s.push(Buffer.from('DEF\nok\n'));
  s.push(Buffer.from('0123456789XY\nlast\n'));
  assert.deepEqual(lines, ['ab', '\u{1F600}c', 'ok', 'last']);
  assert.equal(tooLong, 2);
});

test('the inline size holds the longest outline page or find output, with its header or footer line', async () => {
  const { MAX_RESULT_CHARS } = await import('./protocol.mjs');
  const { PAGE_CHARS, load, outlinePage, pageCount, findText } = await import('./view.mjs');
  const src = `<ul>${'<li class="item">a needle in a list item with some words</li>'.repeat(20_000)}</ul>`;
  const m = load(src, '0123456789abcdef');
  let longest = 0;
  for (let p = 1; p <= pageCount(m); p++) longest = Math.max(longest, outlinePage(m, p).length);
  assert.ok(longest > PAGE_CHARS - 1000 && longest <= MAX_RESULT_CHARS, String(longest));
  assert.ok(findText(m, 'needle').length <= MAX_RESULT_CHARS);
});
