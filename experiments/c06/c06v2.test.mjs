// Tests of the runner's v2 parts (docs/contract.md, amendment "the gate text for the v2 tools", C.1 and C.5). No
// network, no model: the runner's paid part does not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, EXPECTED_TOOLS, EXPECTED_TOOLS_V2, EDIT_TOOLS, checkStart, countTools, v2ServerProblem } from './run-c06.mjs';

test('the v2 modes: one preview and one gate for each of C0.7 to C0.10, with v2 paths; no v1 mode of C0.10', () => {
  for (const g of ['c07', 'c08', 'c09', 'c10']) {
    const p = MODES[`preview-v2-${g}`];
    const q = MODES[`gate-v2-${g}`];
    assert.equal(p.tools, 'v2');
    assert.equal(p.freeze, 'previews-v2');
    assert.equal(p.tasks, `experiments/c07/preview-v2-${g}-tasks.json`);
    assert.equal(q.freeze, 'gates-v2');
    assert.equal(q.record, `experiments/c07/v2-${g}-file-set.json`);
    assert.equal(q.rounds, 3);
    assert.notEqual(q.result, MODES[`gate-${g}`]?.result); // the v1 result names stay free of v2 results
  }
  assert.equal(MODES['preview-c10'], undefined);
  assert.equal(MODES['gate-c10'], undefined);
  assert.equal(MODES['preview-c07'].tools, undefined); // a v1 mode stays v1
});

test('checkStart: a v2 run needs the 3 v2 tools in arm M; control: the v1 list fails it', () => {
  assert.equal(checkStart({ tools: [...EXPECTED_TOOLS_V2.M].reverse() }, 'M', '2.1.322', EXPECTED_TOOLS_V2), null);
  assert.match(checkStart({ tools: EXPECTED_TOOLS.M }, 'M', '2.1.322', EXPECTED_TOOLS_V2), /tool list/);
  assert.match(checkStart({ tools: EXPECTED_TOOLS_V2.M }, 'M', '2.1.322'), /tool list/); // the v1 default refuses v2
  assert.equal(checkStart({ tools: EXPECTED_TOOLS.B }, 'B', '2.1.322', EXPECTED_TOOLS_V2), null);
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
