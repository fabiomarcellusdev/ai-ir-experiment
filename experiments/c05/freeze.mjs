// Writes experiments/c05/run-inputs.json: the SHA-256 of each file that gate C0.5 freezes (run-c05.mjs, C05_FROZEN).
// Run once, after the draw and the task set are committed, and commit its output before the gate run.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { C05_FROZEN } from './run-c05.mjs';

const sha256 = Object.fromEntries(C05_FROZEN.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));
writeFileSync('experiments/c05/run-inputs.json', JSON.stringify({ frozen: new Date().toISOString().slice(0, 10), sha256 }, null, 1) + '\n');
console.log(sha256);
