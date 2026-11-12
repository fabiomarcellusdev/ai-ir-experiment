// An exploratory check after the C0.6 gate (owner, 2026-11-12), not a gate rule. The gate files have names that start
// with a number and a hyphen ("1-build.html"). Grep prints a match as "1-build.html:250:", and the agent sometimes
// reads the name as "build.html". This script counts the runs where a tool failed because it got the name without its
// number prefix, and gives the token ratio of the runs without that mistake. It reads the git-ignored raw streams, so it runs only on the
// machine that ran the gate. NOT timed, free.
//   node experiments/c06/wrong-name.mjs
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStream, NOT_FOUND } from './run-c06.mjs';
import { taskRatios, LIMITS } from './analysis.mjs';
import { median } from '../c03/run-c03.mjs';


/**
 * The failed calls of a run whose error says the file does not exist. `dropped` counts the calls whose path is the
 * real name without its number prefix ("build.html" for "1-build.html"): a misread name.
 * @param {{name: string, input: object, isError: boolean|null, errorText: string|null}[]} calls @param {string} realName
 */
export function wrongNameCalls(calls, realName) {
  let errors = 0;
  let dropped = 0;
  for (const c of calls) {
    if (!c.isError || !NOT_FOUND.some((t) => c.errorText?.includes(t))) continue;
    errors++;
    const p = c.input.file_path ?? c.input.file ?? c.input.path ?? ''; // Read and Edit; the MCP tools; Grep
    const base = path.basename(String(p).replaceAll('\\', '/'));
    if (base && realName.endsWith(base) && /^\d+-$/.test(realName.slice(0, -base.length))) dropped++;
  }
  return { errors, dropped };
}

function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const at = (...p) => path.join(root, ...p);
  const result = JSON.parse(readFileSync(at('experiments/c06/c06-result.json'), 'utf8'));
  const { tasks } = JSON.parse(readFileSync(at('experiments/c05/tasks.json'), 'utf8'));
  const nameOf = Object.fromEntries(tasks.map((t) => [t.id, path.basename(t.file)]));
  const rawDir = at('experiments/gate-files/c06-runs');
  const raw = readdirSync(rawDir).filter((f) => /^gate-\d{8}T\d{6}-/.test(f));
  const runs = result.runs.map((r) => {
    const suffix = `-${r.task}-${r.arm}${r.k}-a${r.attempts}.jsonl`;
    const files = raw.filter((f) => f.endsWith(suffix));
    if (files.length !== 1) throw new Error(`expected 1 raw stream for ${suffix}, found ${files.length}`);
    const s = parseStream(readFileSync(path.join(rawDir, files[0]), 'utf8').split('\n'));
    return { ...r, ...wrongNameCalls(s.calls, nameOf[r.task]) };
  });
  const ids = tasks.map((t) => t.id);
  for (const arm of ['B', 'M']) {
    const of = runs.filter((r) => r.arm === arm);
    const hit = of.filter((r) => r.dropped > 0);
    const clean = of.filter((r) => r.dropped === 0);
    console.log(`${arm}: ${of.filter((r) => r.errors > 0).length} of ${of.length} runs with a missing-file error, ${hit.length} with a misread name; ` +
      `median turns with a misread name ${median(hit.map((r) => r.turns))}, without ${median(clean.map((r) => r.turns))}`);
  }
  const report = (label, rs) => {
    const ratios = taskRatios(rs, ids).map((x) => x.ratio);
    console.log(`${label}: ${ratios.length} tasks, median ratio ${median(ratios).toFixed(2)}, tasks at ${LIMITS.ratio} or less: ` +
      `${ratios.filter((x) => x <= LIMITS.ratio).length}`);
  };
  report('passed runs (the gate rule)', runs);
  report('passed runs without a misread name, in both arms', runs.filter((r) => r.dropped === 0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
