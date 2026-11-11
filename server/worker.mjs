// The worker thread: it runs every tool, so the main thread can stop a slow call (decision 0006, "The time limit").
import { parentPort, workerData } from 'node:worker_threads';
import { openWorkspace } from './workspace.mjs';
import { runTool } from './tools.mjs';
import { ToolError } from './errors.mjs';

const ws = openWorkspace(workerData.root);

parentPort.on('message', ({ id, name, args }) => {
  try {
    parentPort.postMessage({ id, ...runTool(ws, name, args) });
  } catch (e) {
    // A ToolError is a named error of the tool. Any other error is a defect: the reply names only its kind, never a
    // path (security review F6), and the details go to stderr.
    if (!(e instanceof ToolError)) process.stderr.write(`html server: ${e?.stack ?? e}\n`);
    parentPort.postMessage({ id, error: e instanceof ToolError ? e.message : `internal error (${e?.code ?? e?.name ?? 'error'})` });
  }
});
parentPort.postMessage({ ready: true });
