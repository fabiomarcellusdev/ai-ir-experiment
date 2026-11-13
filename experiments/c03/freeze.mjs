// Writes experiments/c03/run-inputs.json: the SHA-256 of each frozen C0.3 input (run plan, "Fixed inputs").
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const files = ['experiments/c03/tasks.json', 'experiments/c03/baseline-tools.json', 'experiments/c03/mcp-tools.json',
  'experiments/c03/html.mjs', 'experiments/c03/make-tasks.mjs', 'experiments/c03/run-c03.mjs'];
const sha256 = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));
writeFileSync('experiments/c03/run-inputs.json', JSON.stringify({ frozen: new Date().toISOString().slice(0, 10), sha256 }, null, 1) + '\n');
console.log(sha256);
