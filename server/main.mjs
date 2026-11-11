// The HTML MCP server: `node server/main.mjs --root <folder>`. It reads JSON-RPC lines on stdin and writes responses
// on stdout. Nothing else goes to stdout (decision 0006).
import { Worker } from 'node:worker_threads';
import { openWorkspace } from './workspace.mjs';
import { handle, LineSplitter, toolResult } from './protocol.mjs';
import { ToolError } from './errors.mjs';

/** A call that takes longer than this gets a named error, and the worker is replaced. */
export const TIME_LIMIT_MS = 1500;

const i = process.argv.indexOf('--root');
if (i === -1 || !process.argv[i + 1]) {
  process.stderr.write('usage: node server/main.mjs --root <folder>\n');
  process.exit(2);
}
const rootArg = process.argv[i + 1];
const ws = openWorkspace(rootArg);

let worker;
let ready;
function startWorker() {
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { root: rootArg } });
  ready = new Promise((resolve, reject) => {
    const onMsg = (m) => { if (m?.ready) { worker.off('message', onMsg); resolve(); } };
    worker.on('message', onMsg);
    worker.once('error', reject);
  });
  ready.catch(() => {}); // A start failure is reported by the call that waits for it.
}
startWorker();

let nextId = 0;
/** Runs a tool in the worker, with the time limit. */
async function inWorker(name, args) {
  try {
    await ready;
  } catch (e) {
    startWorker();
    return { error: `internal error (the worker did not start: ${e?.code ?? e?.name ?? 'error'})` };
  }
  const id = ++nextId;
  const w = worker;
  return new Promise((resolve) => {
    const done = (r) => {
      clearTimeout(timer);
      w.off('message', onMsg);
      w.off('error', onErr);
      resolve(r);
    };
    const onMsg = (m) => { if (m?.id === id) done(m); };
    const onErr = (e) => { startWorker(); done({ error: `internal error (the worker stopped: ${e?.code ?? e?.name ?? 'error'})` }); };
    const timer = setTimeout(() => {
      w.terminate();
      startWorker();
      done({ error: `the call took longer than ${TIME_LIMIT_MS / 1000} s` });
    }, TIME_LIMIT_MS);
    w.on('message', onMsg);
    w.once('error', onErr);
    w.postMessage({ id, name, args });
  });
}

async function callTool(name, args) {
  const r = await inWorker(name, args);
  if (r.error) return toolResult(`${name}: ${r.error}`, true);
  if (!r.write) return toolResult(r.text);
  try {
    const { real, bytes, oldHash, id } = r.write;
    const hash = ws.write(real, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), oldHash, id);
    return toolResult(`ok; hash ${hash}`);
  } catch (e) {
    if (e instanceof ToolError) return toolResult(`${name}: ${e.message}`, true);
    process.stderr.write(`html server: ${e?.stack ?? e}\n`);
    return toolResult(`${name}: internal error (${e?.code ?? e?.name ?? 'error'})`, true);
  }
}

const send = (msg) => { if (msg) process.stdout.write(JSON.stringify(msg) + '\n'); };
let chain = Promise.resolve();
const splitter = new LineSplitter(
  (line) => {
    chain = chain.then(() => handle(line, callTool)).then(send, (e) => {
      process.stderr.write(`html server: internal error: ${e.message}\n`);
      send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    });
  },
  () => { chain = chain.then(() => send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'the message is longer than 8 MB' } })); },
);
process.stdin.on('data', (c) => splitter.push(c));
process.stdin.on('end', () => { chain.then(() => worker.terminate()).then(() => process.exit(0)); });
