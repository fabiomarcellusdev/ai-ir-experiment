// Writes experiments/c07/run-inputs.json: the SHA-256 of each file that the second rescope freezes (docs/contract.md,
// "Phase 0, second rescope", "The inputs", 7 and 8). Run once, after the 3 draws, the 6 task sets and the run plan are
// committed, and commit its output before the first paid run. The runner checks every hash before each start.
//   node experiments/c07/freeze.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
export const OUT = 'experiments/c07/run-inputs.json';
const GATES = ['c07', 'c08', 'c09'];

/** The frozen files: the scripts and modules of the draw, the tasks, the oracle, the runner, the judge and the
 * server; the records, the task sets and the run plan. */
export function frozenFiles() {
  const server = readdirSync(at('server')).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => `server/${f}`);
  return [
    'experiments/c07/draw-files.mjs', 'experiments/c07/tasks.mjs', 'experiments/c07/rules.mjs', 'experiments/c07/oracle_c07.py',
    'experiments/c07/freeze.mjs',
    ...GATES.flatMap((g) => [`experiments/c07/${g}-file-set.json`, `experiments/c07/${g}-tasks.json`, `experiments/c07/preview-${g}-tasks.json`]),
    'experiments/c05/file-set.json', 'experiments/c05/draw-files.mjs', 'experiments/c05/run-c05.mjs',
    'experiments/c03/select-files.mjs', 'experiments/c03/run-c03.mjs',
    'experiments/c03/make-tasks.mjs', 'experiments/c03/html.mjs', 'experiments/c03/mcp-tools.json',
    'experiments/c01/oracle.py', 'experiments/c01/tree.mjs', 'experiments/c01/run-c01.mjs',
    'experiments/c06/run-c06.mjs', 'experiments/c06/analysis.mjs', 'experiments/c06/judge.py',
    ...server, 'docs/measurements/2026-11-12-c07-c09-run-plan.md', 'package.json', 'pnpm-lock.yaml',
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(at(OUT))) throw new Error(`${OUT} exists: the freeze is written once`);
  const files = frozenFiles();
  const missing = files.filter((f) => !existsSync(at(f)));
  if (missing.length) throw new Error(`not yet made: ${missing.join(', ')}`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`commit the frozen files first:\n${dirty}`);
  const sha256 = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(at(f))).digest('hex')]));
  writeFileSync(at(OUT), JSON.stringify({ frozen: new Date().toISOString().slice(0, 10), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), sha256 }, null, 1) + '\n');
  console.log(`${files.length} files frozen in ${OUT}`);
}
