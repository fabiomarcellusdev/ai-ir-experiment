// Writes the second rescope's freeze: the SHA-256 of each frozen file (docs/contract.md, "Phase 0, second rescope",
// "The inputs", 7 and 8; amendment "the previews first"). Two scopes, each written once and committed before its
// first paid run; the runner checks every hash before each start.
//   node experiments/c07/freeze.mjs --previews   experiments/c07/run-inputs-previews.json: the previews' inputs
//   node experiments/c07/freeze.mjs --gates      experiments/c07/run-inputs.json: also the gates' records and task sets
//   node experiments/c07/freeze.mjs --previews-v2  (--gates-v2) the same for the v2 runs (decision 0008):
//                                                run-inputs-previews-v2.json and run-inputs-v2.json
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
/** The freeze file of each scope. */
export const OUT = { gates: 'experiments/c07/run-inputs.json', previews: 'experiments/c07/run-inputs-previews.json',
  'previews-v2': 'experiments/c07/run-inputs-previews-v2.json', 'gates-v2': 'experiments/c07/run-inputs-v2.json' };
const GATES_V2 = ['c07', 'c08', 'c09', 'c10'];
const RUN_PLAN_V2 = 'docs/measurements/2026-11-12-c07-c10-v2-run-plan.md';
const GATES = ['c07', 'c08', 'c09'];

/**
 * The frozen files of a scope: the scripts and modules of the draw, the tasks, the oracle, the runner, the judge and
 * the server; the previews' task sets; the run plan; and, for the gates, their records and task sets.
 * @param {'gates' | 'previews' | 'gates-v2' | 'previews-v2'} [scope] the v2 scopes freeze the v2 records and run plan
 */
export function frozenFiles(scope = 'gates') {
  if (!OUT[scope]) throw new Error(`no freeze scope ${scope}`);
  // The server's modules and its JSON (the v2 tool text, decision 0008); not its tests or test helpers' data.
  const server = readdirSync(at('server')).filter((f) => (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) || f.endsWith('.json')).map((f) => `server/${f}`);
  const v2 = scope.endsWith('-v2');
  const records = v2
    ? [...GATES_V2.map((g) => `experiments/c07/preview-v2-${g}-tasks.json`),
      ...(scope === 'gates-v2' ? GATES_V2.flatMap((g) => [`experiments/c07/v2-${g}-file-set.json`, `experiments/c07/v2-${g}-tasks.json`]) : [])]
    : [...GATES.map((g) => `experiments/c07/preview-${g}-tasks.json`),
      ...(scope === 'gates' ? GATES.flatMap((g) => [`experiments/c07/${g}-file-set.json`, `experiments/c07/${g}-tasks.json`]) : [])];
  return [
    ...records,
    'experiments/c07/draw-files.mjs', 'experiments/c07/tasks.mjs', 'experiments/c07/rules.mjs', 'experiments/c07/oracle_c07.py',
    'experiments/c07/freeze.mjs',
    'experiments/c05/file-set.json', 'experiments/c05/draw-files.mjs', 'experiments/c05/run-c05.mjs',
    'experiments/c03/select-files.mjs', 'experiments/c03/run-c03.mjs',
    'experiments/c03/make-tasks.mjs', 'experiments/c03/html.mjs', 'experiments/c03/mcp-tools.json',
    'experiments/c01/oracle.py', 'experiments/c01/tree.mjs', 'experiments/c01/run-c01.mjs',
    'experiments/c06/run-c06.mjs', 'experiments/c06/analysis.mjs', 'experiments/c06/judge.py',
    // A v2 scope also pins the second rescope's plan: the v2 plan keeps its other points (review of the v2 rules, 2).
    ...server, ...(v2 ? [RUN_PLAN_V2] : []), 'docs/measurements/2026-11-12-c07-c09-run-plan.md', 'package.json', 'pnpm-lock.yaml',
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scope = ['previews-v2', 'gates-v2', 'previews', 'gates'].find((x) => process.argv.includes(`--${x}`)) ?? null;
  if (!scope) throw new Error('give --previews-v2, --gates-v2, --previews or --gates');
  if (existsSync(at(OUT[scope]))) throw new Error(`${OUT[scope]} exists: the freeze is written once`);
  const files = frozenFiles(scope);
  const missing = files.filter((f) => !existsSync(at(f)));
  if (missing.length) throw new Error(`not yet made: ${missing.join(', ')}`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`commit the frozen files first:\n${dirty}`);
  const sha256 = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(at(f))).digest('hex')]));
  writeFileSync(at(OUT[scope]), JSON.stringify({ scope, frozen: new Date().toISOString().slice(0, 10), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), sha256 }, null, 1) + '\n');
  console.log(`${files.length} files frozen in ${OUT[scope]}`);
}
