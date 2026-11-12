// Tests of the C0.6 analysis and judge, on made-up runs: no model, no cost. The judge tests need the Python oracle
// (.venv-oracle/); without it they skip, with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, runTokens, taskRatios, TYPES } from './analysis.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = path.join(ROOT, '.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const noOracle = existsSync(PYTHON) ? false : 'the Python oracle is not installed (.venv-oracle/)';

/** 10 files with 4 tasks each, one of each type, as the rescope's task set. */
const TASKS = Array.from({ length: 10 }, (_, f) => TYPES.map((type) => ({ id: `${f + 1}-${type}`, type }))).flat();
const SIZES = Object.fromEntries(TASKS.map((t) => [t.id, Number(t.id.split('-')[0]) <= 5 ? 20_000 : 80_000]));

/** Runs where every run passes, B uses `b` tokens and M uses `m` tokens. */
function runsOf(b, m, pass = () => true) {
  const runs = [];
  for (const t of TASKS) for (const arm of ['B', 'M']) for (let k = 1; k <= 3; k++) {
    runs.push({ task: t.id, type: t.type, arm, k, pass: pass(t, arm, k), tokens: arm === 'B' ? b : m, turns: 5, mcpCalls: arm === 'M' ? 2 : 0 });
  }
  return runs;
}

test('the tokens of a run: input, cache write, cache read and output, over every model', () => {
  assert.equal(runTokens({ a: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 }, b: { inputTokens: 10 } }), 20);
  assert.equal(runTokens(undefined), 0);
});

test('the gate passes at a ratio of 0.70 and equal success, and fails above 0.70 (boundaries)', () => {
  assert.equal(analyze(runsOf(1000, 700), TASKS, SIZES, 1).verdict, 'PASS');
  const r = analyze(runsOf(1000, 701), TASKS, SIZES, 1);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.checks.ratio, false);
  assert.equal(r.medianRatio, 0.701);
});

test('the ratio uses passed runs only; a fast failure cannot lower it', () => {
  // M fails 2 runs per task with very few tokens; the passed run alone decides the ratio.
  const runs = runsOf(1000, 500, (t, arm, k) => !(arm === 'M' && k < 3)).map((r) => (r.arm === 'M' && r.k < 3 ? { ...r, tokens: 1 } : r));
  assert.equal(taskRatios(runs, TASKS.map((t) => t.id))[0].ratio, 0.5);
  assert.ok(taskRatios(runs, TASKS.map((t) => t.id), true)[0].ratio < 0.5);
});

test('fewer than 20 qualifying tasks fail the gate', () => {
  // M never passes in 21 tasks.
  const failing = new Set(TASKS.slice(0, 21).map((t) => t.id));
  const r = analyze(runsOf(1000, 100, (t, arm) => !(arm === 'M' && failing.has(t.id))), TASKS, SIZES, 1);
  assert.equal(r.qualifyingTasks, 19);
  assert.equal(r.checks.enoughTasks, false);
  assert.equal(r.verdict, 'FAIL');
});

test('success: M at B − 5 points passes; 1 run below fails (boundary)', () => {
  // B passes 120 of 120. 6 failed M runs = 5 points: pass. 7 = fail.
  const fails = (n) => (t, arm, k) => !(arm === 'M' && k === 1 && TASKS.findIndex((x) => x.id === t.id) < n);
  const at = analyze(runsOf(1000, 500, fails(6)), TASKS, SIZES, 1);
  assert.equal(at.checks.success, true);
  // 6 failures in the first 6 tasks: 2 questions among them → no type falls 15 points.
  assert.equal(analyze(runsOf(1000, 500, fails(7)), TASKS, SIZES, 1).checks.success, false);
});

test('a task type more than 15 points below fails, even when the total holds', () => {
  // M fails 5 of 30 question runs (16.7 points) and nothing else: total 4.2 points.
  let n = 0;
  const r = analyze(runsOf(1000, 500, (t, arm) => !(arm === 'M' && t.type === 'question' && n++ < 5)), TASKS, SIZES, 1);
  assert.equal(r.checks.success, true);
  assert.equal(r.checks.types, false);
  assert.equal(r.verdict, 'FAIL');
});

test('the report: size bands, MCP share, and a bootstrap interval that holds the point value', () => {
  const r = analyze(runsOf(1000, 400), TASKS, SIZES, 20261111);
  assert.equal(r.bySize['10 KB to 50 KB'].tasks, 20);
  assert.equal(r.bySize['over 50 KB'].tasks, 20);
  assert.equal(r.mcpShare, 1);
  assert.deepEqual(r.noise.ratio95, [0.4, 0.4]);
  assert.deepEqual(r.noise.successDiff95, [0, 0]);
});

/** Runs the judge on files and answers; returns its output. */
function judge(edits, answers) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hir-c06-test-'));
  try {
    const job = { edits: edits.map(([id, result, expected]) => {
      const rp = path.join(dir, `${id}-r.html`);
      const ep = path.join(dir, `${id}-e.html`);
      if (result !== null) writeFileSync(rp, result);
      writeFileSync(ep, expected);
      return { id, result: rp, expected: ep };
    }), answers };
    writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job));
    execFileSync(PYTHON, ['-I', '-B', path.join(ROOT, 'experiments/c06/judge.py'), path.join(dir, 'job.json'), path.join(dir, 'out.json')]);
    return JSON.parse(execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(dir, 'out.json'))}, 'utf8'))`], { encoding: 'utf8' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the judge: canonical DOM equality ignores quotes, attribute order, entities and whitespace, not content', { skip: noOracle }, () => {
  const exp = '<div class="a" id="b"><p>Hello  world</p><pre>a  b</pre></div>';
  const out = judge([
    ['same', "<div id='b' class=a><p>Hello\n world</p><pre>a  b</pre></div>", exp],
    ['entity', '<div class="a" id="b"><p>Hello&#32;world</p><pre>a  b</pre></div>', exp],
    ['pre', '<div class="a" id="b"><p>Hello world</p><pre>a b</pre></div>', exp],
    ['text', '<div class="a" id="b"><p>Hello there</p><pre>a  b</pre></div>', exp],
    ['attr', '<div class="c" id="b"><p>Hello world</p><pre>a  b</pre></div>', exp],
    ['missing', null, exp],
  ], [{ id: 'q1', value: '  a&amp;b ', expected: 'a&b' }, { id: 'q2', value: 'x', expected: 'y' }, { id: 'q3', value: null, expected: 'y' }]);
  assert.deepEqual(out.edits, { same: true, entity: true, pre: false, text: false, attr: false, missing: false });
  assert.deepEqual(out.answers, { q1: true, q2: false, q3: false });
  assert.deepEqual(out.modules.filter((m) => /filters|sanitizer/.test(m)), []);
});

// --- The runner's helpers, on a made-up stream ---------------------------------------------------------------------
import { parseStream, answerOf, readWholeFile, bytesOutsideKept, schedule, argsFor, PLAN } from './run-c06.mjs';

test('the stream: tool calls with their error flags, the result, the first request, tokens without a result', () => {
  const lines = [
    { type: 'system', subtype: 'init', tools: ['Read', 'mcp__html__html_find'], mcp_servers: [{ name: 'html', status: 'connected' }] },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.html' } }] } },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 5 }, content: [{ type: 'text', text: 'x' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } },
    'not json',
    { type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.01, result: 'done\nANSWER: a', modelUsage: { x: { inputTokens: 1 } } },
  ].map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
  const s = parseStream(lines);
  assert.deepEqual(s.calls.map((c) => [c.name, c.isError]), [['Read', false]]);
  assert.equal(s.result.num_turns, 2);
  assert.equal(s.firstInput, 110);
  assert.equal(s.streamTokens, 115); // one message id counts once
  assert.equal(s.init.mcp_servers[0].status, 'connected');
});

test('the answer is the last ANSWER line; none gives null', () => {
  assert.equal(answerOf('ANSWER: a\ntext\n  ANSWER: b '), ' b ');
  assert.equal(answerOf('no answer'), null);
  assert.equal(answerOf(undefined), null);
});

test('a whole-file read: no offset and limit, reads that cover every line, or every outline page', () => {
  const read = (input, isError = false) => ({ name: 'Read', input, isError });
  assert.equal(readWholeFile([read({ file_path: 'a' })], 100, 1), true);
  assert.equal(readWholeFile([read({ file_path: 'a' }, true)], 100, 1), false);
  assert.equal(readWholeFile([read({ offset: 1, limit: 50 }), read({ offset: 51, limit: 50 })], 100, 1), true);
  assert.equal(readWholeFile([read({ offset: 1, limit: 50 }), read({ offset: 52, limit: 50 })], 100, 1), false);
  const page = (p) => ({ name: 'mcp__html__html_outline', input: p ? { page: p } : {}, isError: false });
  assert.equal(readWholeFile([page(), page(2)], 100, 2), true);
  assert.equal(readWholeFile([page()], 100, 2), false);
});

test('bytes outside the target range: kept, or changed at either end (negative controls)', () => {
  const text = 'ab<p>x</p>cd';
  const orig = Buffer.from(text);
  const range = [2, 10];
  assert.equal(bytesOutsideKept(orig, Buffer.from('ab<p>new text</p>cd'), range, text), true);
  assert.equal(bytesOutsideKept(orig, Buffer.from('ab<p>x</p>cdX'), range, text), false); // a byte added after the end
  assert.equal(bytesOutsideKept(orig, Buffer.from('aB<p>x</p>cd'), range, text), false);
  assert.equal(bytesOutsideKept(orig, Buffer.from('ab<p>x</p>cD'), range, text), false);
  assert.equal(bytesOutsideKept(orig, Buffer.from('abcd'), range, text), true); // a removal
  assert.equal(bytesOutsideKept(orig, Buffer.from('ab'), range, text), false);
  // An insertion: the empty range after the element.
  assert.equal(bytesOutsideKept(orig, Buffer.from('ab<p>x</p><p>New text</p>cd'), [10, 10], text), true);
});

test('the schedule: 240 runs, each task 3 times in each arm, the same order for the same seed', () => {
  const tasks = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}` }));
  const a = schedule(tasks, PLAN.seed);
  assert.equal(a.length, 240);
  assert.equal(new Set(a.map((r) => `${r.task}|${r.arm}|${r.k}`)).size, 240);
  assert.deepEqual(a, schedule(tasks, PLAN.seed));
  assert.notDeepEqual(a.slice(0, 10), schedule(tasks, PLAN.seed + 1).slice(0, 10));
});

test('the command line: the same for both arms but the MCP server and its allow rule', () => {
  const b = argsFor('B', 'p', 'cfg.json');
  const m = argsFor('M', 'p', 'cfg.json');
  for (const x of [b, m]) {
    for (const f of ['--restricted', '--disable-slash-commands', '--strict-mcp-config', '--no-session-persistence']) assert.ok(x.includes(f), f);
    assert.ok(!x.includes('--bare')); // it removes Grep and Glob in 2.1.322 (pilot)
    assert.equal(x[x.indexOf('--tools') + 1], 'Read,Edit,Grep,Glob');
    assert.equal(x[x.indexOf('--model') + 1], 'claude-sonnet-5-5');
    assert.equal(x[x.indexOf('--max-turns') + 1], '40');
  }
  assert.ok(!b.includes('--mcp-config'));
  assert.equal(m[m.indexOf('--mcp-config') + 1], 'cfg.json');
  assert.equal(b[b.indexOf('--allowedTools') + 1], 'Read,Edit,Grep,Glob');
  assert.equal(m[m.indexOf('--allowedTools') + 1], 'Read,Edit,Grep,Glob,mcp__html__*');
});

// --- The security review's fixes -----------------------------------------------------------------------------------
import { cleanEnv, countTools, holdsKey, canaryHit, CANARY } from './run-c06.mjs';

test('the run environment: no variable of this session, the key and the plan only (negative control)', () => {
  const parent = { PATH: '/bin', SystemRoot: 'C:\Windows', CLAUDE_CODE_MESSAGING_TOKEN: 'fake-token', CLAUDECODE: '1', ANTHROPIC_API_KEY: 'parent-key', OTHER: 'x' };
  const env = cleanEnv('fake-key-123456', '/cfg', parent);
  assert.equal(env.ANTHROPIC_API_KEY, 'fake-key-123456');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/cfg');
  assert.equal(env.ENABLE_TOOL_SEARCH, 'false');
  assert.equal(env.PATH, '/bin');
  for (const k of ['CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDECODE', 'OTHER']) assert.equal(env[k], undefined, k);
  assert.ok(!JSON.stringify(env).includes('fake-token'));
});

test('the command line confines the file tools to the run folder', () => {
  for (const arm of ['B', 'M']) assert.ok(argsFor(arm, 'p', 'c').includes('--restricted'));
});

test('a made-up tool name is counted as "other", never written', () => {
  const calls = [{ name: 'Read' }, { name: 'mcp__html__html_find' }, { name: 'made-up-name-that-carries-text' }, { name: 'Read' }];
  assert.deepEqual(countTools(calls), { Read: 2, mcp__html__html_find: 1, other: 1 });
  assert.ok(!JSON.stringify(countTools(calls)).includes('carries'));
});

test('a record or result that holds the key, forward or reversed, is found (negative controls)', () => {
  const key = 'sk-test-0123456789';
  assert.equal(holdsKey('{"a":1}', key), false);
  assert.equal(holdsKey(`{"x":"${key}"}`, key), true);
  assert.equal(holdsKey(`{"x":"${[...key].reverse().join('')}"}`, key), true);
});

test('the canary: found in a stream line or when its file changed (negative controls)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hir-c06-canary-test-'));
  try {
    const f = path.join(dir, 'canary.txt');
    writeFileSync(f, CANARY);
    assert.equal(canaryHit(['{"type":"assistant"}'], f), false);
    assert.equal(canaryHit([`{"text":"${CANARY}"}`], f), true);
    writeFileSync(f, 'changed');
    assert.equal(canaryHit([], f), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- The correctness review's fixes and the owner's rules of 2026-11-12 ----------------------------------------------
import { endOf, mcpCrashed, checkStart, lineCountOf, expectedOf, EXPECTED_TOOLS } from './run-c06.mjs';
import { readFileSync as readFile } from 'node:fs';

test('the byte rule counts bytes after characters outside the BMP (UTF-16 offsets to bytes)', () => {
  const text = '\u{1F600}é<p>x</p>z';
  const orig = Buffer.from(text);
  const range = [3, 11]; // <p>x</p> in UTF-16 units
  assert.equal(bytesOutsideKept(orig, Buffer.from('\u{1F600}é<p>new</p>z'), range, text), true);
  assert.equal(bytesOutsideKept(orig, Buffer.from('\u{1F600}e<p>new</p>z'), range, text), false);
});

test('the byte rule allows layout whitespace right next to the range, and nothing further (owner, 2026-11-12)', () => {
  const text = '<div>\n  <p>a</p>\n  <p>b</p>\n</div>';
  const orig = Buffer.from(text);
  const range = [8, 16]; // the first <p>a</p>
  assert.equal(bytesOutsideKept(orig, Buffer.from('<div>\n  <p>b</p>\n</div>'), range, text), true); // removed with its line
  assert.equal(bytesOutsideKept(orig, Buffer.from('<div>\n  <p>b</p>\n</di>'), range, text), false);
  assert.equal(bytesOutsideKept(orig, Buffer.from('<div><p>b</p>\n</div>'), range, text), true); // whitespace only
  assert.equal(bytesOutsideKept(orig, Buffer.from('<dvi>\n  <p>b</p>\n</div>'), range, text), false);
});

test('the judge leaves out layout whitespace between elements, not text or pre content', { skip: noOracle }, () => {
  const exp = '<div><p>a</p><p>New text</p>\n  <p>b</p><pre>\n x</pre></div>';
  const out = judge([
    ['indented', '<div><p>a</p>\n  <p>New text</p>\n  <p>b</p><pre>\n x</pre></div>', exp],
    ['joined', '<div><p>a</p><p>New text</p><p>b</p><pre>\n x</pre></div>', exp],
    ['word', '<div><p>a</p> x <p>New text</p>\n  <p>b</p><pre>\n x</pre></div>', exp],
    ['pre', '<div><p>a</p><p>New text</p>\n  <p>b</p><pre>\n  x</pre></div>', exp],
  ], []);
  assert.deepEqual(out.edits, { indented: true, joined: true, word: false, pre: false });
});

test('how a run ends: limits fail the run; an API or harness error stops the gate', () => {
  const run = { timedOut: false };
  assert.equal(endOf({ result: { subtype: 'success', is_error: false } }, run), 'ok');
  assert.equal(endOf({ result: { subtype: 'success', is_error: false } }, { timedOut: true }), 'timeout');
  assert.equal(endOf({ result: { subtype: 'error_max_turns', is_error: true } }, run), 'max-turns');
  assert.equal(endOf({ result: { subtype: 'error_max_budget_usd', is_error: true } }, run), 'budget');
  assert.equal(endOf({ result: { subtype: 'success', is_error: true } }, run), 'api-error');
  assert.equal(endOf({ result: null }, run), 'api-error');
});

test('an MCP crash is a closed connection in an MCP tool result, not a named tool error', () => {
  const call = (name, errorText) => ({ name, isError: !!errorText, errorText });
  assert.equal(mcpCrashed([call('mcp__html__html_find', 'MCP error -32000: Connection closed')]), true);
  assert.equal(mcpCrashed([call('mcp__html__html_edit', 'html_edit: the file changed since the hash')]), false);
  assert.equal(mcpCrashed([call('Read', 'Connection closed')]), false);
});

test('the start check: the harness version and the exact tool list of each arm', () => {
  assert.equal(checkStart({ claude_code_version: '2.1.322', tools: ['Read', 'Edit', 'Grep', 'Glob'] }, 'B', '2.1.322'), null);
  assert.equal(checkStart({ tools: [...EXPECTED_TOOLS.M].reverse() }, 'M', '2.1.322'), null);
  assert.match(checkStart({ claude_code_version: '2.1.330', tools: EXPECTED_TOOLS.B }, 'B', '2.1.322'), /harness/);
  assert.match(checkStart({ tools: [...EXPECTED_TOOLS.B, 'Bash'] }, 'B', '2.1.322'), /tool list/);
  assert.match(checkStart({ tools: EXPECTED_TOOLS.B }, 'M', '2.1.322'), /tool list/);
  assert.match(checkStart(null, 'B', '2.1.322'), /start message/);
});

test('the schedule runs round 1, then 2, then 3; a final line break starts no new line', () => {
  const tasks = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}` }));
  const a = schedule(tasks, PLAN.seed);
  assert.deepEqual([1, 2, 3].map((k) => a.slice((k - 1) * 80, k * 80).every((r) => r.k === k)), [true, true, true]);
  assert.equal(lineCountOf('a\nb\n'), 2);
  assert.equal(lineCountOf('a\nb'), 2);
  // An offset with no limit reads at most 2,000 lines.
  assert.equal(readWholeFile([{ name: 'Read', isError: false, input: { offset: 1 } }], 3000, 1), false);
  assert.equal(readWholeFile([{ name: 'Read', isError: false, input: { offset: 1 } }, { name: 'Read', isError: false, input: { offset: 2001 } }], 3000, 1), true);
});

const GATE_FILES = existsSync(path.join(ROOT, 'experiments/gate-files/c05')) ? false : 'the gate files are not here (git-ignored)';
test('the judge passes each expected file of the task set and fails each original file', { skip: noOracle || GATE_FILES }, () => {
  const tasks = JSON.parse(readFile(path.join(ROOT, 'experiments/c05/tasks.json'), 'utf8')).tasks.filter((t) => t.type !== 'question');
  const pairs = tasks.flatMap((t) => [[`e:${t.id}`, expectedOf(t)], [`o:${t.id}`, t.file]].map(([id, f]) => [id, readFile(path.join(ROOT, f), 'utf8'), readFile(path.join(ROOT, expectedOf(t)), 'utf8')]));
  const out = judge(pairs, []);
  for (const t of tasks) {
    assert.equal(out.edits[`e:${t.id}`], true, t.id);
    assert.equal(out.edits[`o:${t.id}`], false, t.id);
  }
});

// --- The pilot's first finding: no --bare, so the start check and the notes check guard the isolation -------------
import { notesAbove, BUILTIN_PLUGINS } from './run-c06.mjs';
import { mkdirSync as mkdir } from 'node:fs';

test('the start check refuses loaded skills and any plugin other than the built-in ones', () => {
  const ok = { tools: EXPECTED_TOOLS.B, skills: [], plugins: BUILTIN_PLUGINS.map((name) => ({ name, path: 'builtin' })) };
  assert.equal(checkStart(ok, 'B', '2.1.322'), null);
  assert.match(checkStart({ ...ok, skills: ['debug'] }, 'B', '2.1.322'), /skills/);
  assert.match(checkStart({ ...ok, plugins: [...ok.plugins, { name: 'x', path: 'C:/p' }] }, 'B', '2.1.322'), /plugin/);
  assert.match(checkStart({ ...ok, plugins: [{ name: 'cc-plugin-privacy', path: 'C:/p' }] }, 'B', '2.1.322'), /plugin/);
});

test('project notes above a run folder are found (negative control)', () => {
  const top = mkdtempSync(path.join(tmpdir(), 'hir-c06-notes-test-'));
  try {
    const run = path.join(top, 'a', 'run');
    mkdir(run, { recursive: true });
    assert.deepEqual(notesAbove(run).filter((p) => p.startsWith(top)), []);
    writeFileSync(path.join(top, 'CLAUDE.md'), '# notes');
    mkdir(path.join(top, 'a', '.claude'));
    assert.deepEqual(notesAbove(run).filter((p) => p.startsWith(top)).sort(), [path.join(top, 'CLAUDE.md'), path.join(top, 'a', '.claude')].sort());
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
