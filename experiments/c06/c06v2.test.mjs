// Tests of the runner's v2 parts (docs/contract.md, amendment "the gate text for the v2 tools", C.1 and C.5). No
// network, no model: the runner's paid part does not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, gateName, EXPECTED_TOOLS, EXPECTED_TOOLS_V2, EDIT_TOOLS, checkStart, countTools, v2ServerProblem } from './run-c06.mjs';

test('the v2 modes: one preview and one gate for each of C0.7 to C0.10, with v2 paths; no v1 mode of C0.10', () => {
  for (const g of ['c07', 'c08', 'c09', 'c10']) {
    const p = MODES[`preview-v2-${g}`];
    const q = MODES[`gate-v2-${g}`];
    assert.equal(p.tools, 'v2');
    assert.equal(p.freeze, 'previews-v2');
    assert.equal(p.tasks, `experiments/c07/preview-v2-${g}-tasks.json`);
    assert.equal(q.freeze, g === 'c08' ? 'gates-v2-c08' : 'gates-v2'); // C0.8 runs after the runner changed
    assert.equal(q.record, `experiments/c07/v2-${g}-file-set.json`);
    assert.equal(q.rounds, 3);
    assert.notEqual(q.result, MODES[`gate-${g}`]?.result); // the v1 result names stay free of v2 results
  }
  assert.equal(MODES['preview-c10'], undefined);
  assert.equal(MODES['gate-c10'], undefined);
  assert.equal(MODES['preview-c07'].tools, undefined); // a v1 mode stays v1
});

test('checkStart: a v2 run needs the 3 v2 tools in arm M; control: the v1 list fails it', () => {
  const v = { claude_code_version: '2.1.322' };
  assert.equal(checkStart({ ...v, tools: [...EXPECTED_TOOLS_V2.M].reverse() }, 'M', '2.1.322', EXPECTED_TOOLS_V2), null);
  assert.match(checkStart({ ...v, tools: EXPECTED_TOOLS.M }, 'M', '2.1.322', EXPECTED_TOOLS_V2), /tool list/);
  assert.match(checkStart({ ...v, tools: EXPECTED_TOOLS_V2.M }, 'M', '2.1.322'), /tool list/); // the v1 default refuses v2
  assert.equal(checkStart({ ...v, tools: EXPECTED_TOOLS.B }, 'B', '2.1.322', EXPECTED_TOOLS_V2), null);
});

test('a successful html_change counts as an edit, and as a known tool', () => {
  assert.ok(EDIT_TOOLS.includes('mcp__html__html_change'));
  assert.deepEqual(countTools([{ name: 'mcp__html__html_change' }, { name: 'mcp__html__made_up' }]), { mcp__html__html_change: 1, other: 1 });
});

test('v2ServerProblem: both gates passed and the server did not change since; each failure is named', () => {
  const pass = { verdict: 'PASS', commit: 'a' };
  const none = () => [];
  assert.equal(v2ServerProblem({ 'C0.1 v2': pass, 'C0.2 v2': pass }, none), null);
  assert.equal(v2ServerProblem({ x: pass }, () => ['server/v2.test.mjs']), null); // a test file is not the server
  assert.match(v2ServerProblem({ x: { verdict: 'FAIL', commit: 'a' } }, none), /x has not passed/);
  assert.match(v2ServerProblem({ x: null }, none), /x has not passed/);
  assert.match(v2ServerProblem({ x: pass }, () => ['server/v2.mjs']), /server changed since x passed: server\/v2.mjs/);
});

test('each gate keeps its number in its name, C0.10 too', () => {
  assert.equal(gateName('c07'), 'C0.7');
  assert.equal(gateName('c10'), 'C0.10');
  for (const g of ['c07', 'c08', 'c09', 'c10']) assert.equal(MODES[`gate-v2-${g}`].gate, gateName(g));
  assert.equal(MODES['gate-v2-c10'].label, 'C0.10 (v2 tools)');
  assert.equal(MODES['gate-c09'].gate, 'C0.9');
});

// --- After the v2 gates (owner, 2026-11-12): the commit stop, the pinned harness, C0.8's own freeze ----------------
import { StopGate, commitStop, assertCommitted, harnessProblem, HARNESS_FILE } from './run-c06.mjs';
import { readFileSync } from 'node:fs';
import { OUT as FREEZE_SCOPES, frozenFiles } from '../c07/freeze.mjs';

test('a changed HEAD or a changed input is a gate stop with the run cost, not a plain error', () => {
  const head = 'a'.repeat(40);
  assert.equal(commitStop('', head, head, 0.5), null);
  const moved = commitStop('', 'b'.repeat(40), head, 0.0117);
  assert.ok(moved instanceof StopGate);
  assert.equal(moved.costUsd, 0.0117);
  assert.match(moved.message, /HEAD changed/);
  const dirty = commitStop(' M server/v2.mjs', head, head, 0);
  assert.ok(dirty instanceof StopGate);
  assert.match(dirty.message, /changed during the run/);
  assert.equal(commitStop('', 'b'.repeat(40), null, 0), null); // before the start commit is known
});

test('the harness must be the pinned file, with its hash and its exact version', () => {
  const plan = { harness: '2.1.322', harnessSha256: 'f'.repeat(64) };
  const ok = { exists: true, sha256: 'f'.repeat(64), version: '2.1.322 (Claude Code)' };
  assert.equal(harnessProblem(ok, plan), null);
  assert.match(harnessProblem({ ...ok, exists: false }, plan), /no pinned harness/);
  assert.match(harnessProblem({ ...ok, sha256: '0'.repeat(64) }, plan), /SHA-256/);
  assert.match(harnessProblem({ ...ok, version: '2.1.3220 (Claude Code)' }, plan), /version/);
  assert.match(harnessProblem({ ...ok, version: '2.1.323 (Claude Code)' }, plan), /version/);
  assert.match(harnessProblem({ ...ok, version: '2.1.322 x' }, plan), /version/);
  // Without a version, only the file and its hash: the preflight runs the file only after this passes.
  const { version, ...fileOnly } = ok;
  assert.equal(harnessProblem(fileOnly, plan), null);
  assert.match(harnessProblem({ ...fileOnly, sha256: '0'.repeat(64) }, plan), /SHA-256/);
  assert.match(HARNESS_FILE, /\.local[\\/]harness[\\/]claude-2\.1\.322/);
});

test('the start check takes the exact version, so 2.1.3220 is another harness', () => {
  assert.match(checkStart({ claude_code_version: '2.1.3220', tools: EXPECTED_TOOLS.B }, 'B', '2.1.322'), /harness/);
  assert.equal(checkStart({ claude_code_version: '2.1.322', tools: EXPECTED_TOOLS.B }, 'B', '2.1.322'), null);
  assert.match(checkStart({ claude_code_version: '2.1.322 x', tools: EXPECTED_TOOLS.B }, 'B', '2.1.322'), /harness/);
  assert.match(checkStart({ tools: EXPECTED_TOOLS.B }, 'B', '2.1.322'), /no version/);
});

test("the runner's commit check throws the gate stop, with the cost it is given", () => {
  const start = 'a'.repeat(40);
  assert.doesNotThrow(() => assertCommitted(0.2, () => ({ status: '', head: start }), start));
  assert.throws(() => assertCommitted(0.2, () => ({ status: '', head: 'b'.repeat(40) }), start),
    (e) => e instanceof StopGate && e.costUsd === 0.2 && /HEAD changed/.test(e.message));
  // A text check of the runner: both judge calls pass the run's cost, and every run is checked after its attempts.
  const src = readFileSync(new URL('./run-c06.mjs', import.meta.url), 'utf8');
  assert.equal(src.match(/judge\(\{ (answers|edits):[^\n]*, base, cost\)/g)?.length, 2);
  assert.match(src, /const cost = attempts\.reduce[^\n]*\n[^\n]*\n\s*assertCommitted\(cost\);/);
});

test("C0.8 has its own freeze, and the 3 gates that ran keep theirs", () => {
  assert.equal(MODES['gate-v2-c08'].freeze, 'gates-v2-c08');
  for (const g of ['c07', 'c09', 'c10']) assert.equal(MODES[`gate-v2-${g}`].freeze, 'gates-v2');
  assert.equal(FREEZE_SCOPES['gates-v2'], 'experiments/c07/run-inputs-v2.json');
  assert.equal(FREEZE_SCOPES['gates-v2-c08'], 'experiments/c07/run-inputs-v2-c08.json');
  assert.deepEqual(frozenFiles('gates-v2-c08'), frozenFiles('gates-v2'));
});

// --- The arm-M check of decisions 0009 and 0010 (owner, 2026-11-13: option A) ---------------------------------------
import { compareM } from './analysis.mjs';
import { schedule, checkResult, RUN_PLAN_CHECK } from './run-c06.mjs';

test('compareM: the new arm M against the recorded arm M, per task, with no verdict', () => {
  const tasks = [{ id: '1-a', type: 'removal' }, { id: '2-a', type: 'removal' }, { id: '3-b', type: 'replacement' }];
  const run = (task, arm, k, tokens, extra = {}) => ({ task, type: tasks.find((t) => t.id === task).type, arm, k, pass: true, tokens, turns: 3, firstInput: 5000, wholeFile: false, insideChange: false, toolCalls: {}, reasons: [], ...extra });
  const recorded = [];
  const fresh = [];
  for (const t of tasks) for (let k = 1; k <= 3; k++) {
    // Arm B differs from arm M in every field, so a mix-up of the arms changes a number (review of the check, 1).
    recorded.push(run(t.id, 'B', k, 1000, { firstInput: 4000, turns: 5, wholeFile: true, pass: k !== 3 }), run(t.id, 'M', k, 1200));
    fresh.push(run(t.id, 'M', k, t.id === '3-b' ? 600 : 900, { firstInput: 4800, turns: 2 }));
  }
  // A recorded run of a task outside the set never counts (review of the check, 2).
  recorded.push(run('1-a', 'M', 4, 1200, { task: '9-z', pass: false, firstInput: 9999, turns: 40 }));
  fresh[0] = { ...fresh[0], pass: false, reasons: ['the canonical DOM is not the expected file\'s'] };
  const c = compareM(fresh, recorded, tasks, 1);
  assert.equal(c.verdict, undefined); // decides nothing
  assert.equal(c.tasks, 3);
  assert.equal(c.medianNewOverOldM, 0.75); // 900/1200 for 2 tasks, 600/1200 for 1
  // The 3 files resampled: the median is 0.5 when 3-b is drawn twice or more (7 in 27), else 0.75. With recorded B as
  // the reference by mistake, the interval would be 0.6 to 0.9.
  assert.deepEqual(c.noise.ratio95, [0.5, 0.75]);
  assert.deepEqual(c.wholeFile, { old: 0, new: 0 });
  assert.equal(c.medianNewOverRecordedB, 0.9);
  assert.equal(c.recordedGateMedian, 1.2);
  assert.deepEqual(c.firstInput, { old: 5000, new: 4800 });
  assert.deepEqual(c.turns, { old: 3, new: 2 });
  assert.deepEqual(c.success, { old: 1, new: 8 / 9 });
  assert.equal(c.failures.length, 1);
  assert.equal(c.byType.replacement.medianNewOverOldM, 0.5);
  // A recorded run of arm B never counts as old arm M (the control).
  assert.equal(compareM(fresh, recorded.filter((r) => r.arm === 'B'), tasks, 1).medianNewOverOldM, null);
});

test('the check modes run arm M only on the gates C0.7 and C0.10, with their own freeze and plan', () => {
  for (const g of ['c07', 'c10']) {
    const s = MODES[`check-m-v2-${g}`];
    assert.deepEqual(s.arms, ['M']);
    assert.equal(s.tools, 'v2');
    assert.equal(s.freeze, 'check-m-v2');
    assert.equal(s.plan, RUN_PLAN_CHECK);
    assert.equal(s.baseline, `experiments/c07/gate-v2-${g}-result.json`);
    assert.equal(s.tasks, MODES[`gate-v2-${g}`].tasks);
    assert.equal(s.gate, undefined); // not a gate
    assert.notEqual(s.result, MODES[`gate-v2-${g}`].result);
    assert.equal(s.seed, MODES[`gate-v2-${g}`].seed); // the plan's seed 20261112, not C0.6's
    assert.equal(s.seed, 20261112);
    assert.equal(s.rounds, 3);
    assert.equal(s.record, MODES[`gate-v2-${g}`].record);
  }
  // The check's inputs stay out of every other scope.
  for (const scope of ['gates-v2', 'gates-v2-c08', 'previews-v2']) assert.ok(!frozenFiles(scope).includes(RUN_PLAN_CHECK), scope);
  // The result of a check has no gate and no verdict.
  const r = checkResult({ label: 'x', commit: 'c', version: 'v', baseline: 'b', runPlan: 'p', seed: 1, starts: [], stops: [], cost: 0, done: [], comparison: {} });
  assert.equal(r.check, 'x');
  assert.equal(r.gate, undefined);
  assert.equal(r.verdict, undefined);
  assert.equal(r.analysis, undefined);
  assert.equal(MODES['check-m-v2-c08'], undefined);
  const order = schedule([{ id: '1-a' }, { id: '2-a' }], 5, 3, ['M']);
  assert.equal(order.length, 6);
  assert.ok(order.every((o) => o.arm === 'M'));
  assert.equal(schedule([{ id: '1-a' }], 5, 3).length, 6); // the default is still both arms
  const frozen = frozenFiles('check-m-v2');
  for (const f of ['experiments/c07/gate-v2-c07-result.json', 'experiments/c07/gate-v2-c10-result.json', RUN_PLAN_CHECK]) assert.ok(frozen.includes(f), f);
  assert.equal(FREEZE_SCOPES['check-m-v2'], 'experiments/c07/run-inputs-check-m-v2.json');
});

test('a second-rescope mode cannot reach the verdict without its interval limit (follow-up of the C0.8 v2 check)', async () => {
  const { analysisOptions } = await import('./run-c06.mjs');
  for (const [name, set] of Object.entries(MODES)) {
    if (set.baseline) continue; // an arm-M check returns before the analysis (compareM)
    if (!set.second) { assert.deepEqual(analysisOptions(set), {}, name); continue; }
    assert.equal(analysisOptions(set).intervalBelow, 1, name);
  }
  // The control: a second-rescope mode that forgot its limit is refused, not passed.
  const { intervalBelow, ...forgot } = MODES['gate-v2-c07'];
  assert.throws(() => analysisOptions(forgot), /needs its interval limit/);
});

// --- The checks of tool search on and of the direct-locator sentence (owner, 2026-11-13) ----------------------------
import { cleanEnv, argsFor, KNOWN_TOOLS, sentenceProblem, LOCATOR_SENTENCE, EXPECTED_TOOLS_V2_SEARCH, RUN_PLAN_CHECK_2 } from './run-c06.mjs';

test('the tool-search check sets ENABLE_TOOL_SEARCH to true; every gate and the other checks keep it false', () => {
  assert.equal(cleanEnv('k', 'c', {}, true).ENABLE_TOOL_SEARCH, 'true');
  assert.equal(cleanEnv('k', 'c', {}, false).ENABLE_TOOL_SEARCH, 'false');
  assert.equal(cleanEnv('k', 'c', {}).ENABLE_TOOL_SEARCH, 'false'); // the default outside a run is off
  for (const [name, set] of Object.entries(MODES)) assert.equal(!!set.toolSearch, name.startsWith('check-ts-'), name);
  const r = checkResult({ label: 'x', commit: 'c', version: 'v', baseline: 'b', runPlan: 'p', seed: 1, starts: [], stops: [], cost: 0, done: [], comparison: {}, search: true });
  assert.equal(r.plan.env.ENABLE_TOOL_SEARCH, 'true'); // the result records the setting that ran
  assert.equal(r.plan.toolSearch, true);
});

test('with tool search on, arm M may list the deferred tools or not, plus ToolSearch; nothing else', () => {
  const v = { claude_code_version: '2.1.322', mcp_servers: [{ name: 'html', status: 'connected' }] };
  const M = (tools, extra = {}) => checkStart({ ...v, tools, ...extra }, 'M', '2.1.322', EXPECTED_TOOLS_V2_SEARCH);
  assert.equal(M([...EXPECTED_TOOLS_V2.M, 'ToolSearch']), null);
  assert.equal(M(['Read', 'Edit', 'Grep', 'Glob', 'ToolSearch']), null);
  assert.match(M(EXPECTED_TOOLS_V2.M), /tool list/); // control: no ToolSearch means tool search is off
  assert.match(M([...EXPECTED_TOOLS_V2.M, 'ToolSearch', 'Bash']), /tool list/);
  // The server's status must show the connection, which the short list cannot (review of the "ts" check, 4).
  assert.match(M(['Read', 'Edit', 'Grep', 'Glob', 'ToolSearch'], { mcp_servers: [{ name: 'html', status: 'failed' }] }), /did not connect/);
  assert.match(M(['Read', 'Edit', 'Grep', 'Glob', 'ToolSearch'], { mcp_servers: [] }), /did not connect/);
  assert.equal(checkStart({ claude_code_version: '2.1.322', tools: EXPECTED_TOOLS_V2.M }, 'M', '2.1.322', EXPECTED_TOOLS_V2), null); // the gates' list still holds
});

test('with tool search on, arm M gets ToolSearch in --tools and --allowedTools; every other run is as before', () => {
  const on = argsFor('M', 'p', 'cfg.json', true);
  assert.equal(on[on.indexOf('--tools') + 1], 'Read,Edit,Grep,Glob,ToolSearch');
  assert.ok(on[on.indexOf('--allowedTools') + 1].split(',').includes('ToolSearch'));
  for (const [arm, search] of [['M', false], ['B', true], ['B', false]]) {
    const a = argsFor(arm, 'p', 'cfg.json', search);
    assert.equal(a[a.indexOf('--tools') + 1], 'Read,Edit,Grep,Glob', `${arm} ${search}`);
    assert.ok(!a.join(' ').includes('ToolSearch'), `${arm} ${search}`);
  }
  assert.ok(KNOWN_TOOLS.includes('ToolSearch')); // a ToolSearch call is counted by name, not as "other"
});

test('the runner wires tool search from the mode to the env, the arguments, the start check and the result', () => {
  // A text check of run-c06.mjs, where a unit test cannot reach (review of the "ts" check, 7).
  const src = readFileSync(new URL('./run-c06.mjs', import.meta.url), 'utf8');
  assert.match(src, /\n {2}toolSearch = !!set\.toolSearch;\n/);
  assert.match(src, /toolSearch \? EXPECTED_TOOLS_V2_SEARCH : EXPECTED_TOOLS_V2/);
  assert.match(src, /comparison, search: toolSearch \}\);/);
  assert.match(src, /if \(!set\.baseline\) analysisOptions\(set\);/); // the interval guard runs before any paid run
});

test('each check refuses the wrong tool text: "loc" needs decision 0011\'s sentence, "now" and "ts" refuse it', () => {
  // Both texts, whichever the server holds now: decision 0011's sentence follows "Not for html, head or body.".
  const now = readFileSync(new URL('../../server/tools-v2.json', import.meta.url), 'utf8');
  const plain = now.replace(` ${LOCATOR_SENTENCE}`, '');
  const withIt = plain.replace('Not for html, head or body.', `Not for html, head or body. ${LOCATOR_SENTENCE}`);
  assert.notEqual(withIt, plain);
  for (const g of ['c07', 'c10']) {
    assert.equal(sentenceProblem(MODES[`check-now-v2-${g}`], plain), null);
    assert.equal(sentenceProblem(MODES[`check-ts-v2-${g}`], plain), null);
    assert.match(sentenceProblem(MODES[`check-loc-v2-${g}`], plain), /lacks decision 0011/);
    assert.equal(sentenceProblem(MODES[`check-loc-v2-${g}`], withIt), null);
    assert.match(sentenceProblem(MODES[`check-ts-v2-${g}`], withIt), /holds decision 0011/);
  }
  assert.equal(sentenceProblem(MODES['gate-v2-c07'], withIt), null); // a gate has no sentence rule
  // While decision 0011's sentence is in the server, the server's text and the runner's constant agree (review, 2).
  if (now.includes('html_find is not needed first')) assert.equal(sentenceProblem(MODES['check-loc-v2-c07'], now), null);
});

test('the 6 later check modes: the baseline, tool search on and the direct-locator sentence, on C0.7 and C0.10, with their own freezes', () => {
  for (const v of ['now', 'ts', 'loc']) for (const g of ['c07', 'c10']) {
    const s = MODES[`check-${v}-v2-${g}`];
    const first = MODES[`check-m-v2-${g}`];
    assert.deepEqual(s.arms, ['M']);
    assert.equal(s.plan, RUN_PLAN_CHECK_2);
    assert.equal(s.freeze, `check-${v}-v2`);
    assert.equal(s.baseline, first.baseline);
    assert.equal(s.tasks, first.tasks);
    assert.equal(s.seed, 20261112);
    assert.equal(s.gate, undefined);
    assert.equal(s.result, `experiments/c07/check-${v}-v2-${g}-result.json`);
  }
  for (const scope of ['check-now-v2', 'check-ts-v2', 'check-loc-v2']) {
    const f = frozenFiles(scope);
    for (const x of [RUN_PLAN_CHECK_2, 'experiments/c07/check-m-v2-c07-result.json', 'experiments/c07/gate-v2-c10-result.json']) assert.ok(f.includes(x), `${scope} ${x}`);
    assert.ok(f.includes('server/tools-v2.json'));
  }
  assert.ok(!frozenFiles('check-m-v2').includes(RUN_PLAN_CHECK_2)); // the first check's freeze is as it was
});
