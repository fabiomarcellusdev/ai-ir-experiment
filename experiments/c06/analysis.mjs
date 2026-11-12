// The analysis of gate C0.6 (docs/contract.md: C0.4's rules, with the changes in "C0.6, agent tasks"). Pure functions:
// the runner gives them one record for each run, and they give the verdict and the report's numbers.
import { median } from '../c03/run-c03.mjs';
import { generator } from '../c05/draw-files.mjs';
import { resampleFiles } from '../c05/run-c05.mjs';

export const ARMS = ['B', 'M'];
export const RUNS_PER_ARM = 3;
export const TYPES = ['question', 'text', 'attribute', 'structure'];
/** The pass rule (C0.4, "Pass"): the ratio, the success margin, and the margin of each task type. */
export const LIMITS = { ratio: 0.7, success: 0.05, type: 0.15, minTasks: 20 };

/**
 * The tokens of a run (C0.4, "Tokens of a run"): input, cache-write, cache-read and output tokens, summed over all
 * turns and all models. `usage` maps a model name to its totals.
 * @param {Record<string, {inputTokens: number, outputTokens: number, cacheReadInputTokens: number, cacheCreationInputTokens: number}>} usage
 */
export function runTokens(usage) {
  let n = 0;
  for (const u of Object.values(usage ?? {})) n += (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
  return n;
}

const fileOf = (taskId) => taskId.split('-')[0];
const rate = (rs) => (rs.length ? rs.filter((r) => r.pass).length / rs.length : null);

/**
 * The token ratio of each task where each arm passed at least once: the median tokens of M's passed runs ÷ the median
 * tokens of B's passed runs. With `all`, every run counts, passed or not (the report's "ratio over all runs").
 * @param {object[]} runs @param {string[]} taskIds @param {boolean} [all]
 */
export function taskRatios(runs, taskIds, all = false) {
  const out = [];
  for (const id of taskIds) {
    const of = (arm) => runs.filter((r) => r.task === id && r.arm === arm && (all || r.pass)).map((r) => r.tokens);
    const b = of('B');
    const m = of('M');
    if (b.length && m.length) out.push({ task: id, ratio: median(m) / median(b) });
  }
  return out;
}

/** The success difference in points: (M's passes − B's passes) ÷ (runs per arm × tasks). */
function successDiff(runs, taskIds) {
  const ids = new Set(taskIds);
  const of = (arm) => taskIds.map((id) => runs.filter((r) => r.task === id && r.arm === arm && r.pass).length).reduce((a, b) => a + b, 0);
  return ids.size ? (of('M') - of('B')) / (RUNS_PER_ARM * taskIds.length) : 0;
}

/**
 * The paired bootstrap over files (C0.6, rule 4): resample the files with replacement, each with its tasks and all their
 * runs. Returns the 95% interval of the success difference and of the median token ratio.
 */
export function bootstrap(runs, tasks, seed, n = 10_000) {
  const files = new Map();
  for (const t of tasks) { const k = fileOf(t.id); if (!files.has(k)) files.set(k, []); files.get(k).push(t.id); }
  const groups = [...files.values()];
  const rnd = generator(seed);
  const diffs = [];
  const ratios = [];
  for (let i = 0; i < n; i++) {
    const picked = resampleFiles(groups, rnd);
    // A file drawn twice counts twice: rename its tasks, so that each copy keeps its own runs.
    const ids = [];
    const rs = [];
    picked.forEach((g, j) => {
      for (const id of g) {
        ids.push(`${j}:${id}`);
        for (const r of runs) if (r.task === id) rs.push({ ...r, task: `${j}:${id}` });
      }
    });
    diffs.push(successDiff(rs, ids));
    const tr = taskRatios(rs, ids).map((x) => x.ratio);
    if (tr.length) ratios.push(median(tr));
  }
  const ci = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? [s[Math.floor(0.025 * (s.length - 1))], s[Math.ceil(0.975 * (s.length - 1))]] : null; };
  return { successDiff95: ci(diffs), ratio95: ci(ratios), resamplesWithRatio: ratios.length };
}

/**
 * The verdict and the report's numbers.
 * @param {object[]} runs one record for each run: {task, type, arm, k, pass, tokens, turns, mcpCalls, wholeFile, size}
 * @param {object[]} tasks the task set: {id, type}
 * @param {Record<string, number>} sizes each task's file size in bytes
 */
export function analyze(runs, tasks, sizes, seed) {
  const ids = tasks.map((t) => t.id);
  const ratios = taskRatios(runs, ids);
  const med = ratios.length ? median(ratios.map((r) => r.ratio)) : null;
  const arm = (a) => runs.filter((r) => r.arm === a);
  const success = Object.fromEntries(ARMS.map((a) => [a, rate(arm(a))]));
  const byType = Object.fromEntries(TYPES.map((t) => [t, Object.fromEntries(ARMS.map((a) => [a, rate(arm(a).filter((r) => r.type === t))]))]));
  const sizeBand = (id) => (sizes[id] > 50_000 ? 'over 50 KB' : '10 KB to 50 KB');
  const bySize = {};
  for (const band of ['10 KB to 50 KB', 'over 50 KB']) {
    const bandIds = ids.filter((id) => sizeBand(id) === band);
    const tr = taskRatios(runs, bandIds).map((r) => r.ratio);
    bySize[band] = { tasks: bandIds.length, medianRatio: tr.length ? median(tr) : null,
      success: Object.fromEntries(ARMS.map((a) => [a, rate(arm(a).filter((r) => bandIds.includes(r.task)))])) };
  }
  const checks = {
    ratio: med !== null && ratios.length >= LIMITS.minTasks && med <= LIMITS.ratio,
    enoughTasks: ratios.length >= LIMITS.minTasks,
    success: success.M !== null && success.B !== null && success.M >= success.B - LIMITS.success - 1e-12,
    types: TYPES.every((t) => byType[t].M !== null && byType[t].B !== null && byType[t].M >= byType[t].B - LIMITS.type - 1e-12),
  };
  const allRatios = taskRatios(runs, ids, true).map((r) => r.ratio);
  return {
    medianRatio: med,
    qualifyingTasks: ratios.length,
    medianRatioAllRuns: allRatios.length ? median(allRatios) : null,
    success,
    byType,
    bySize,
    // A run stopped at 10 minutes has no turn count: it is left out of the median (review, 10).
    turns: Object.fromEntries(ARMS.map((a) => { const t = arm(a).map((r) => r.turns).filter((x) => Number.isFinite(x)); return [a, t.length ? median(t) : null]; })),
    mcpShare: arm('M').length ? arm('M').filter((r) => r.mcpCalls > 0).length / arm('M').length : null,
    wholeFile: Object.fromEntries(ARMS.map((a) => [a, arm(a).filter((r) => r.wholeFile).length])),
    insideChanges: Object.fromEntries(ARMS.map((a) => [a, arm(a).filter((r) => r.insideChange).length])),
    noise: bootstrap(runs, tasks, seed),
    checks,
    verdict: checks.ratio && checks.success && checks.types ? 'PASS' : 'FAIL',
  };
}
