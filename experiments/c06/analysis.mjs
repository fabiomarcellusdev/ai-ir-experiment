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
function successDiff(runs, taskIds, runsPerArm = RUNS_PER_ARM) {
  const ids = new Set(taskIds);
  const of = (arm) => taskIds.map((id) => runs.filter((r) => r.task === id && r.arm === arm && r.pass).length).reduce((a, b) => a + b, 0);
  return ids.size ? (of('M') - of('B')) / (runsPerArm * taskIds.length) : 0;
}

/**
 * The paired bootstrap over files (C0.6, rule 4): resample the files with replacement, each with its tasks and all their
 * runs. Returns the 95% interval of the success difference and of the median token ratio.
 */
export function bootstrap(runs, tasks, seed, n = 10_000, runsPerArm = RUNS_PER_ARM) {
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
    diffs.push(successDiff(rs, ids, runsPerArm));
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
 * @param {{types?: string[], intervalBelow?: number}} [opts] the second rescope's changes (docs/contract.md, "Phase 0,
 *   second rescope", "Allowed changes to the code", 2 and 3): the gate's task types for the 15-point rule, and the
 *   bound that the upper end of the ratio's 95% interval must stay below. C0.6 uses neither.
 */
export function analyze(runs, tasks, sizes, seed, runsPerArm = RUNS_PER_ARM, opts = {}) {
  const types = opts.types ?? TYPES;
  const ids = tasks.map((t) => t.id);
  const ratios = taskRatios(runs, ids);
  const med = ratios.length ? median(ratios.map((r) => r.ratio)) : null;
  const arm = (a) => runs.filter((r) => r.arm === a);
  const success = Object.fromEntries(ARMS.map((a) => [a, rate(arm(a))]));
  const byType = Object.fromEntries(types.map((t) => [t, Object.fromEntries(ARMS.map((a) => [a, rate(arm(a).filter((r) => r.type === t))]))]));
  const sizeBand = (id) => (sizes[id] > 50_000 ? 'over 50 KB' : '10 KB to 50 KB');
  const bySize = {};
  for (const band of ['10 KB to 50 KB', 'over 50 KB']) {
    const bandIds = ids.filter((id) => sizeBand(id) === band);
    const tr = taskRatios(runs, bandIds).map((r) => r.ratio);
    bySize[band] = { tasks: bandIds.length, medianRatio: tr.length ? median(tr) : null,
      success: Object.fromEntries(ARMS.map((a) => [a, rate(arm(a).filter((r) => bandIds.includes(r.task)))])) };
  }
  const noise = bootstrap(runs, tasks, seed, 10_000, runsPerArm);
  const checks = {
    ratio: med !== null && ratios.length >= LIMITS.minTasks && med <= LIMITS.ratio,
    enoughTasks: ratios.length >= LIMITS.minTasks,
    success: success.M !== null && success.B !== null && success.M >= success.B - LIMITS.success - 1e-12,
    types: types.every((t) => byType[t].M !== null && byType[t].B !== null && byType[t].M >= byType[t].B - LIMITS.type - 1e-12),
    ...(opts.intervalBelow === undefined ? {} : { interval: !!noise.ratio95 && noise.ratio95[1] < opts.intervalBelow }),
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
    noise,
    checks,
    verdict: checks.ratio && checks.success && checks.types && checks.interval !== false ? 'PASS' : 'FAIL',
  };
}

/**
 * The arm-M check of decisions 0009 and 0010 (owner, 2026-11-13; `docs/measurements/2026-11-13-check-m-v2-run-plan.md`):
 * the new arm M against the arm M that a v2 gate recorded, on the same tasks and files. It decides nothing. The
 * recorded M runs take the place of arm B in `taskRatios` and `bootstrap`, so each task's ratio is the median tokens
 * of the new passed runs ÷ the median of the recorded passed runs.
 * @param {object[]} fresh the new runs (arm M) @param {object[]} recorded the gate's runs (arms B and M)
 */
export function compareM(freshRuns, recordedRuns, tasks, seed, runsPerArm = RUNS_PER_ARM) {
  const ids = tasks.map((t) => t.id);
  // Only the runs of the task set count, on both sides (review of the check, 2).
  const inSet = new Set(ids);
  const fresh = freshRuns.filter((r) => inSet.has(r.task));
  const recorded = recordedRuns.filter((r) => inSet.has(r.task));
  const oldM = recorded.filter((r) => r.arm === 'M').map((r) => ({ ...r, arm: 'B' }));
  const pair = [...oldM, ...fresh];
  const med = (a) => (a.length ? median(a) : null);
  const ratioOf = (runs, which) => med(taskRatios(runs, which).map((r) => r.ratio));
  const finite = (rs, k) => rs.map((r) => r[k]).filter((x) => Number.isFinite(x));
  const calls = (rs) => { const c = {}; for (const r of rs) for (const [k, n] of Object.entries(r.toolCalls ?? {})) c[k] = (c[k] ?? 0) + n; return c; };
  const types = [...new Set(tasks.map((t) => t.type))];
  return {
    tasks: taskRatios(pair, ids).length,
    medianNewOverOldM: ratioOf(pair, ids),
    medianNewOverOldMAllRuns: med(taskRatios(pair, ids, true).map((r) => r.ratio)),
    noise: bootstrap(pair, tasks, seed, 10_000, runsPerArm),
    // A comparison across 2 commits and 2 runs, not a gate ratio.
    medianNewOverRecordedB: ratioOf([...recorded.filter((r) => r.arm === 'B'), ...fresh], ids),
    recordedGateMedian: ratioOf(recorded, ids),
    byType: Object.fromEntries(types.map((t) => [t, { medianNewOverOldM: ratioOf(pair, tasks.filter((x) => x.type === t).map((x) => x.id)) }])),
    tokens: { old: med(finite(oldM, 'tokens')), new: med(finite(fresh, 'tokens')) },
    firstInput: { old: med(finite(oldM, 'firstInput')), new: med(finite(fresh, 'firstInput')) },
    turns: { old: med(finite(oldM, 'turns')), new: med(finite(fresh, 'turns')) },
    success: { old: rate(oldM), new: rate(fresh) },
    wholeFile: { old: oldM.filter((r) => r.wholeFile).length, new: fresh.filter((r) => r.wholeFile).length },
    insideChanges: { old: oldM.filter((r) => r.insideChange).length, new: fresh.filter((r) => r.insideChange).length },
    missingFileErrors: { old: oldM.reduce((a, r) => a + (r.missingFileErrors ?? 0), 0), new: fresh.reduce((a, r) => a + (r.missingFileErrors ?? 0), 0) },
    toolCalls: { old: calls(oldM), new: calls(fresh) },
    failures: fresh.filter((r) => !r.pass).map(({ task, k, reasons }) => ({ task, k, reasons })),
  };
}

/**
 * The analysis of gate C0.11 (docs/contract.md, "Gate C0.11"; decision 0012): a mix of task kinds, measured by the
 * ratio of total tokens. A task qualifies when each arm passed at least once; its value in an arm is the median tokens
 * of that arm's passed runs. The ratio is the sum of arm M's values over the qualifying tasks ÷ the sum of arm B's.
 * The interval resamples files, where tasks whose files have the same SHA-256 (`fileSha256`) are one file.
 * @param {object[]} runs @param {{id: string, kind: string, fileSha256?: string, file: string}[]} tasks
 */
export function analyzeMix(runs, tasks, seed, runsPerArm = RUNS_PER_ARM, opts = {}) {
  const limit = opts.limit ?? LIMITS.ratio;
  const intervalBelow = opts.intervalBelow ?? 1;
  const ids = tasks.map((t) => t.id);
  const inSet = new Set(ids);
  const rs = runs.filter((r) => inSet.has(r.task));
  const valueOf = (id, arm, all = false) => {
    const t = rs.filter((r) => r.task === id && r.arm === arm && (all || r.pass)).map((r) => r.tokens);
    return t.length ? median(t) : null;
  };
  const qualifying = ids.filter((id) => valueOf(id, 'B') !== null && valueOf(id, 'M') !== null);
  const total = (which, all = false) => {
    let m = 0;
    let b = 0;
    for (const id of which) { m += valueOf(id, 'M', all); b += valueOf(id, 'B', all); }
    return b ? m / b : null;
  };
  const ratio = qualifying.length ? total(qualifying) : null;
  // The interval: resample the files (by SHA-256), each with all its qualifying tasks; a file drawn twice counts twice.
  // The contract groups by SHA-256: a task without its file's hash is an error, not a fallback (review of C0.11, 4).
  const missing = tasks.filter((t) => !t.fileSha256).map((t) => t.id);
  if (missing.length) throw new Error(`no file SHA-256 for ${missing.join(', ')}`);
  const keyOf = (t) => t.fileSha256;
  const keys = [...new Set(tasks.map(keyOf))];
  const groups = keys.map((k) => tasks.filter((t) => keyOf(t) === k && qualifying.includes(t.id)).map((t) => [valueOf(t.id, 'M'), valueOf(t.id, 'B')]));
  const rnd = generator(seed);
  const n = opts.resamples ?? 10_000;
  const vals = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    let b = 0;
    for (const g of resampleFiles(groups, rnd)) for (const [x, y] of g) { m += x; b += y; }
    if (b) vals.push(m / b);
  }
  vals.sort((a, b) => a - b);
  const ratio95 = vals.length ? [vals[Math.floor(0.025 * (vals.length - 1))], vals[Math.ceil(0.975 * (vals.length - 1))]] : null;
  const arm = (a) => rs.filter((r) => r.arm === a);
  const success = Object.fromEntries(ARMS.map((a) => [a, rate(arm(a))]));
  const kindOf = new Map(tasks.map((t) => [t.id, t.kind]));
  const kinds = [...new Set(tasks.map((t) => t.kind))];
  const byKind = Object.fromEntries(kinds.map((k) => {
    const kq = qualifying.filter((id) => kindOf.get(id) === k);
    return [k, { tasks: ids.filter((id) => kindOf.get(id) === k).length, qualifying: kq.length, ratio: kq.length ? total(kq) : null,
      success: Object.fromEntries(ARMS.map((a) => [a, rate(arm(a).filter((r) => kindOf.get(r.task) === k))])) }];
  }));
  const perTask = qualifying.map((id) => valueOf(id, 'M') / valueOf(id, 'B'));
  const calls = (rr) => { const c = {}; for (const r of rr) for (const [k, v] of Object.entries(r.toolCalls ?? {})) c[k] = (c[k] ?? 0) + v; return c; };
  const both = ids.filter((id) => valueOf(id, 'B', true) !== null && valueOf(id, 'M', true) !== null);
  const checks = {
    ratio: ratio !== null && qualifying.length >= LIMITS.minTasks && ratio <= limit,
    enoughTasks: qualifying.length >= LIMITS.minTasks,
    interval: !!ratio95 && ratio95[1] < intervalBelow,
    success: success.M !== null && success.B !== null && success.M >= success.B - LIMITS.success - 1e-12,
    kinds: kinds.every((k) => byKind[k].success.M !== null && byKind[k].success.B !== null && byKind[k].success.M >= byKind[k].success.B - LIMITS.type - 1e-12),
  };
  return {
    totalRatio: ratio,
    totalRatioAllRuns: both.length ? total(both, true) : null,
    qualifyingTasks: qualifying.length,
    medianTaskRatio: perTask.length ? median(perTask) : null,
    noise: { ratio95, resamples: vals.length, files: groups.length },
    success,
    byKind,
    turns: Object.fromEntries(ARMS.map((a) => { const t = arm(a).map((r) => r.turns).filter((x) => Number.isFinite(x)); return [a, t.length ? median(t) : null]; })),
    mcpShare: arm('M').length ? arm('M').filter((r) => r.mcpCalls > 0).length / arm('M').length : null,
    wholeFile: Object.fromEntries(ARMS.map((a) => [a, arm(a).filter((r) => r.wholeFile).length])),
    insideChanges: Object.fromEntries(ARMS.map((a) => [a, arm(a).filter((r) => r.insideChange).length])),
    missingFileErrors: Object.fromEntries(ARMS.map((a) => [a, arm(a).reduce((x, r) => x + (r.missingFileErrors ?? 0), 0)])),
    toolCalls: Object.fromEntries(ARMS.map((a) => [a, calls(arm(a))])),
    // The cost of each arm's recorded runs (the contract's report list; review of C0.11, 5). A stopped attempt's cost
    // is in the result's total, not here.
    costUsd: Object.fromEntries(ARMS.map((a) => [a, arm(a).reduce((x, r) => x + (r.costUsd ?? 0), 0)])),
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
  };
}
