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
