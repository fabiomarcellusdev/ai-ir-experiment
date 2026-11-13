// Tests of gate C0.11 (docs/contract.md, "Gate C0.11"; decision 0012): the draw of the mix, its analysis by the ratio
// of total tokens, and its runner mode. No network, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawMix, mixProblem, committedSets, C11, C11_PATHS } from './draw-tasks.mjs';
import { analyzeMix } from '../c06/analysis.mjs';
import { MODES, RUN_PLAN_C11, analysisOptions } from '../c06/run-c06.mjs';
import { frozenFiles, OUT } from '../c07/freeze.mjs';

test('the draw gives 20 + 8 + 6 + 6 tasks from the 4 v2 sets, each unchanged but its id, and the same draw every time', () => {
  const sets = committedSets();
  const a = drawMix(sets);
  assert.deepEqual(a, drawMix(sets)); // the seed fixes the draw
  assert.deepEqual(C11.mix, [['c10', 20], ['c07', 8], ['c08', 6], ['c09', 6]]);
  assert.equal(C11.seed, 20261117); // the contract's seed (review of C0.11, 3)
  const count = {};
  for (const t of a.tasks.tasks) count[t.kind] = (count[t.kind] ?? 0) + 1;
  assert.deepEqual(count, { c10: 20, c07: 8, c08: 6, c09: 6 });
  assert.equal(new Set(a.tasks.tasks.map((t) => t.id)).size, 40);
  for (const t of a.tasks.tasks) {
    const src = sets[t.kind].tasks.find((x) => x.id === t.source.id);
    const { id, kind, source, ...rest } = t;
    assert.equal(id, `${kind}.${src.id}`);
    assert.deepEqual(rest, Object.fromEntries(Object.entries(src).filter(([k]) => k !== 'id'))); // all other fields as drawn
    // Each task's file is in the file set, with its set's record.
    assert.ok(a.record.kinds.find((k) => k.kind === kind).picks.some((p) => p.file === t.file), t.id);
  }
  // The control: another seed gives another draw.
  assert.notDeepEqual(drawMix(sets, C11.mix, C11.seed + 1).tasks.tasks.map((t) => t.id), a.tasks.tasks.map((t) => t.id));
});

/** Runs of a synthetic gate: `tok[id] = [B, M]` tokens, all passed unless `fail` names a task|arm|k. */
function runsOf(tasks, tok, fail = new Set()) {
  const out = [];
  for (const t of tasks) for (const arm of ['B', 'M']) for (let k = 1; k <= 3; k++) {
    out.push({ task: t.id, arm, k, type: 'x', pass: !fail.has(`${t.id}|${arm}|${k}`), tokens: tok[t.id][arm === 'B' ? 0 : 1], turns: 3, mcpCalls: arm === 'M' ? 1 : 0, toolCalls: {} });
  }
  return out;
}
const mixTasks = () => Array.from({ length: 24 }, (_, i) => ({ id: `k${i % 2}.${i}-t`, kind: `k${i % 2}`, file: `f${i}`, fileSha256: `s${i}` }));

test('analyzeMix: the ratio of total tokens, not the median of task ratios; a large task counts by its size', () => {
  const tasks = mixTasks();
  // 23 small tasks where M costs more (1,200 ÷ 1,000), and 1 large task where M saves much (10,000 ÷ 60,000).
  const tok = Object.fromEntries(tasks.map((t, i) => [t.id, i === 0 ? [60_000, 10_000] : [1000, 1200]]));
  const r = analyzeMix(runsOf(tasks, tok), tasks, 1, 3, { resamples: 2000 });
  assert.equal(r.totalRatio, (10_000 + 23 * 1200) / (60_000 + 23 * 1000)); // 0.453
  assert.equal(r.medianTaskRatio, 1.2); // the median would say "worse"
  assert.equal(r.qualifyingTasks, 24);
  assert.equal(r.checks.ratio, true);
  assert.equal(r.noise.files, 24);
});

test('analyzeMix: tasks with the same file SHA-256 are one file in the interval, across kinds', () => {
  const tasks = mixTasks().map((t, i) => ({ ...t, fileSha256: i < 2 ? 'same' : t.fileSha256 })); // 2 kinds, 1 file
  const tok = Object.fromEntries(tasks.map((t) => [t.id, [1000, 500]]));
  assert.equal(analyzeMix(runsOf(tasks, tok), tasks, 1, 3, { resamples: 200 }).noise.files, 23);
  // A task with no file SHA-256 is an error, not a group of its own (review of C0.11, 4).
  const { fileSha256, ...bare } = tasks[5];
  assert.throws(() => analyzeMix(runsOf(tasks, tok), tasks.map((t, i) => (i === 5 ? bare : t)), 1), /no file SHA-256/);
});

test('analyzeMix: the interval resamples files, so it spreads around the ratio and depends on the grouping', () => {
  // Ratios that differ by file: 0.2 to 1.35 (review of C0.11, 1: equal ratios cannot show a broken resample).
  const tasks = mixTasks();
  const tok = Object.fromEntries(tasks.map((t, i) => [t.id, [1000 + 100 * i, Math.round((1000 + 100 * i) * (0.2 + 0.05 * i))]]));
  const r = analyzeMix(runsOf(tasks, tok), tasks, 7, 3, { resamples: 4000 });
  assert.ok(r.noise.ratio95[0] < r.totalRatio && r.totalRatio < r.noise.ratio95[1], JSON.stringify(r.noise.ratio95));
  assert.ok(r.noise.ratio95[1] - r.noise.ratio95[0] > 0.1); // a resample that sums all files every time gives 0
  // The same tasks in 4 files of 6 neighbouring tasks each (similar ratios in a file): a bootstrap over files then gives
  // a much wider interval than over 24 files (2.4 times with this code); a bootstrap over single tasks would not.
  const fewer = tasks.map((t, i) => ({ ...t, fileSha256: `g${Math.floor(i / 6)}` }));
  const g = analyzeMix(runsOf(fewer, tok), fewer, 7, 3, { resamples: 4000 });
  assert.equal(g.totalRatio, r.totalRatio);
  assert.equal(g.noise.files, 4);
  const width = (x) => x.noise.ratio95[1] - x.noise.ratio95[0];
  assert.ok(width(g) > 1.5 * width(r), `${width(g)} against ${width(r)}`);
  // The cost of each arm (review of C0.11, 5).
  assert.deepEqual(Object.keys(r.costUsd), ['B', 'M']);
});

test('mixProblem: the runner refuses a task set or a file set that the seed does not give', () => {
  const sets = committedSets();
  const { tasks, record } = drawMix(sets);
  assert.equal(mixProblem(tasks, record, sets), null);
  const changed = structuredClone(tasks);
  changed.tasks[3].prompt += ' ';
  assert.match(mixProblem(changed, record, sets), /task set drawn again differs/);
  const wrongHash = structuredClone(record);
  wrongHash.kinds[0].picks[0].sha256 = '0'.repeat(64);
  assert.match(mixProblem(tasks, wrongHash, sets), /file set drawn again differs/);
  // The runner uses it before any paid run (a text check of run-c06.mjs, where a unit test cannot reach).
  const src = readFileSync(new URL('../c06/run-c06.mjs', import.meta.url), 'utf8');
  assert.match(src, /const problem = mixProblem\(committed, JSON\.parse\(readFileSync\(at\(set\.record\), 'utf8'\)\), committedSets\(\)\);\n {4}if \(problem\) throw new Error\(problem\);/);
});

test('analyzeMix: each of the 5 checks can fail the verdict', () => {
  const tasks = mixTasks();
  const ok = Object.fromEntries(tasks.map((t) => [t.id, [1000, 500]]));
  const base = analyzeMix(runsOf(tasks, ok), tasks, 1, 3, { resamples: 500 });
  assert.equal(base.verdict, 'PASS');
  // The ratio over 0.70, and an interval that reaches 1.00.
  const worse = Object.fromEntries(tasks.map((t) => [t.id, [1000, 1100]]));
  const w = analyzeMix(runsOf(tasks, worse), tasks, 1, 3, { resamples: 500 });
  assert.equal(w.checks.ratio, false);
  assert.equal(w.checks.interval, false);
  assert.equal(w.verdict, 'FAIL');
  // Success: arm M fails 1 run in each of 4 tasks: 4 of 72 runs, 5.6 points below B.
  const f4 = new Set(tasks.slice(0, 4).map((t) => `${t.id}|M|1`));
  assert.equal(analyzeMix(runsOf(tasks, ok, f4), tasks, 1, 3, { resamples: 500 }).checks.success, false);
  // A kind: arm M fails 2 runs in each of 3 tasks of kind k0 only: 6 of 36 runs, 16.7 points below B in that kind.
  const k0 = tasks.filter((t) => t.kind === 'k0').slice(0, 3);
  const r = analyzeMix(runsOf(tasks, ok, new Set(k0.flatMap((t) => [`${t.id}|M|1`, `${t.id}|M|2`]))), tasks, 1, 3, { resamples: 500 });
  assert.equal(r.checks.kinds, false);
  assert.equal(r.verdict, 'FAIL');
  // Too few qualifying tasks: arm B fails every run of 5 tasks, so 19 qualify.
  const five = new Set(tasks.slice(0, 5).flatMap((t) => [1, 2, 3].map((k) => `${t.id}|B|${k}`)));
  const e = analyzeMix(runsOf(tasks, ok, five), tasks, 1, 3, { resamples: 500 });
  assert.equal(e.qualifyingTasks, 19);
  assert.equal(e.checks.enoughTasks, false);
  assert.equal(e.verdict, 'FAIL');
});

test('the C0.11 mode: both arms, the mix, the "loc" server text, its own plan, freeze and result', () => {
  const s = MODES['gate-v2-c11'];
  assert.equal(s.gate, 'C0.11');
  assert.equal(s.mix, true);
  assert.equal(s.arms, undefined); // both arms
  assert.equal(s.tools, 'v2');
  assert.equal(s.toolSearch, undefined); // tool search off
  assert.equal(s.sentence, true); // decision 0011's sentence must be in the server
  assert.equal(s.tasks, C11_PATHS.tasks);
  assert.equal(s.record, C11_PATHS.fileSet);
  assert.equal(s.plan, RUN_PLAN_C11);
  assert.equal(s.seed, 20261112);
  assert.equal(s.rounds, 3);
  assert.equal(analysisOptions(s).intervalBelow, 1);
  assert.equal(OUT[s.freeze], 'experiments/c11/run-inputs-c11.json');
  const f = frozenFiles(s.freeze);
  for (const x of [C11_PATHS.tasks, C11_PATHS.fileSet, 'experiments/c11/draw-tasks.mjs', RUN_PLAN_C11, 'experiments/c07/v2-c10-tasks.json', 'server/tools-v2.json']) assert.ok(f.includes(x), x);
  assert.ok(!frozenFiles('gates-v2').includes(C11_PATHS.tasks)); // the C0.11 task set is in no other scope
});
