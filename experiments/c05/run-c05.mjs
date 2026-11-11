// Gate C0.5: ideal-path work tokens (docs/contract.md, "Phase 0, rescope"). It builds C0.3's 4 paths for each task,
// counts them with Anthropic's count_tokens endpoint (free; needs an API key), and leaves out each arm's fixed part:
// the arm's tools with only the task's first user message.
//   node experiments/c05/run-c05.mjs --api   the gate run: reads the key from .local/anthropic-api-key, never prints
//                                            it, writes experiments/c05/c05-result.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { paths, median, MODEL } from '../c03/run-c03.mjs';
import { load, find, KEEP_ATTR } from '../c03/html.mjs';
import { generator } from './draw-files.mjs';

export const PATHS = ['B1', 'B2', 'B3', 'M1', 'M2', 'M3'];

/**
 * The 2 short paths of a question (review, 2026-11-11), built from B2 and M2 without their read step:
 * - B3: Grep alone. Valid when one matched line holds the target's whole start tag within its first 2,000 characters.
 * - M3: html_find alone. Valid when the target is among the first 20 matches and its outline line shows the
 *   attribute: the attribute is `id` or in KEEP_ATTR, and the view does not shorten its value.
 * For the other task types, both are not valid.
 */
export function shortPaths(task, src, p) {
  const none = { B3: { valid: false }, M3: { valid: false } };
  if (task.type !== 'question') return none;
  const drop = (msgs) => [...msgs.slice(0, 3), ...msgs.slice(5)]; // remove the read call and its result
  const m = load(src);
  const el = m.els[task.ref];
  const st = el.sourceCodeLocation.startTag;
  const before = src.slice(0, st.startOffset);
  const line = before.split('\n').length - 1;
  const col = st.startOffset - (before.lastIndexOf('\n') + 1);
  const oneLine = !src.slice(st.startOffset, st.endOffset).includes('\n');
  const hit = src.split('\n')[line].includes(task.quote);
  const b3 = p.B2.messages && oneLine && hit && col + (st.endOffset - st.startOffset) <= 2000;
  const shown = (task.attr === 'id' || KEEP_ATTR.has(task.attr)) && !(/^data:/i.test(task.answer) && task.answer.length > 100);
  const m3 = find(m, task.quote).matches.slice(0, 20).includes(el) && shown;
  return {
    B3: b3 ? { valid: true, messages: drop(p.B2.messages) } : { valid: false },
    M3: m3 ? { valid: true, messages: drop(p.M2.messages) } : { valid: false },
  };
}

/**
 * A bootstrap over files (review, 2026-11-11): resample the 10 files with replacement, each with its 4 tasks, and
 * take the median ratio of each resample. Returns the 2.5% and 97.5% values of 10,000 resamples.
 */
export function bootstrapFiles(rows, seed, n = 10_000) {
  const files = new Map();
  for (const r of rows) { const k = r.id.split('-')[0]; if (!files.has(k)) files.set(k, []); files.get(k).push(r.ratio); }
  const groups = [...files.values()];
  const rnd = generator(seed);
  const meds = [];
  for (let i = 0; i < n; i++) {
    const pick = [];
    for (let j = 0; j < groups.length; j++) pick.push(...groups[rnd(groups.length)]);
    meds.push(median(pick));
  }
  meds.sort((a, b) => a - b);
  return [meds[Math.floor(0.025 * (n - 1))], meds[Math.ceil(0.975 * (n - 1))]];
}

/**
 * The noise check (contract, C0.5, "Noise"): count each request 3 times. Returns true when every repeat gave the
 * same number.
 */
export async function countsRepeat(requests, count) {
  for (const [arm, msgs] of requests) {
    const n = [await count(arm, msgs), await count(arm, msgs), await count(arm, msgs)];
    if (n[0] !== n[1] || n[1] !== n[2]) return false;
  }
  return true;
}

/** The median of 3 counts, used only when the noise check found a difference. */
export const counter3 = (count) => async (arm, msgs) => median([await count(arm, msgs), await count(arm, msgs), await count(arm, msgs)]);

/**
 * Counts every valid path of every task, the fixed part of each arm, and the gate's ratio of work tokens.
 * `count(arm, messages)` returns a token count; the arm is 'B' or 'M'. It prints no number for a single task.
 */
export async function gateWork(tasks, srcOf, count) {
  const rows = [];
  for (const t of tasks) {
    const p = paths(t, srcOf(t));
    Object.assign(p, shortPaths(t, srcOf(t), p));
    const row = { id: t.id, type: t.type, grepHits: p.hits, findMatches: p.findMatches };
    // The fixed part: the arm's tools with only the first user message. All 4 paths start with the same message.
    const first = [p.B1.messages[0]];
    row.fixedB = await count('B', first);
    row.fixedM = await count('M', first);
    for (const k of PATHS) {
      if (!p[k].valid) { row[k] = null; row[`work${k}`] = null; continue; }
      row[k] = await count(k[0], p[k].messages);
      row[`work${k}`] = row[k] - (k[0] === 'B' ? row.fixedB : row.fixedM);
      if (row[`work${k}`] <= 0) throw new Error(`${t.id} ${k}: the work tokens are ${row[`work${k}`]}, not above 0`);
    }
    const cheapest = (keys) => Math.min(...keys.map((k) => row[k]).filter((x) => x !== null));
    row.workB = cheapest(['workB1', 'workB2', 'workB3']);
    row.workM = cheapest(['workM1', 'workM2', 'workM3']);
    row.ratio = row.workM / row.workB;
    row.ratioM1 = row.workM1 / row.workB;
    row.ratioM2 = row.workM2 === null ? null : row.workM2 / row.workB;
    row.ratioTotal = cheapest(['M1', 'M2', 'M3']) / cheapest(['B1', 'B2', 'B3']);
    rows.push(row);
  }
  const med = median(rows.map((r) => r.ratio));
  const m2 = rows.filter((r) => r.ratioM2 !== null);
  const byType = {};
  for (const r of rows) (byType[r.type] ??= []).push(r.ratio);
  return {
    rows, median: med, pass: med <= 0.5,
    medianTotal: median(rows.map((r) => r.ratioTotal)),
    medianM1Only: median(rows.map((r) => r.ratioM1)),
    medianM2Only: m2.length ? median(m2.map((r) => r.ratioM2)) : null, m2Valid: m2.length,
    b2Valid: rows.filter((r) => r.B2 !== null).length,
    b3Valid: rows.filter((r) => r.B3 !== null).length, m3Valid: rows.filter((r) => r.M3 !== null).length,
    bootstrapFiles95: bootstrapFiles(rows, 20261111),
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, median(v)])),
  };
}

async function countTokens(key, tools, messages) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, tools, messages }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt)); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`count_tokens failed (${r.status}): ${j.error?.message ?? 'no message'}`);
    return j.input_tokens;
  }
  throw new Error('count_tokens: too many retries');
}

/** Checks that the run's inputs are the frozen ones (experiments/c05/run-inputs.json), the gate files and 40 tasks. */
function checkInputs(tasks) {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const frozen = JSON.parse(readFileSync('experiments/c05/run-inputs.json', 'utf8'));
  const c03 = JSON.parse(readFileSync('experiments/c03/run-inputs.json', 'utf8')).sha256;
  for (const file of ['experiments/c03/html.mjs', 'experiments/c03/mcp-tools.json', 'experiments/c03/baseline-tools.json', 'experiments/c03/run-c03.mjs']) {
    if (sha(file) !== c03[file]) throw new Error(`${file} differs from its C0.3 hash: the contract freezes it`);
  }
  for (const [file, want] of Object.entries(frozen.sha256)) {
    if (sha(file) !== want) throw new Error(`${file} is not the frozen input (SHA-256 differs)`);
  }
  const record = JSON.parse(readFileSync('experiments/c05/file-set.json', 'utf8'));
  for (const p of record.kinds.flatMap((k) => k.picks)) {
    if (createHash('sha256').update(readFileSync(p.file, 'utf8'), 'utf8').digest('hex') !== p.sha256) throw new Error(`${p.file} changed since the draw`);
  }
  if (tasks.length !== 40) throw new Error(`expected 40 tasks, found ${tasks.length}`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'experiments/c03', 'experiments/c05', 'docs/contract.md'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`the frozen files have uncommitted changes:\n${dirty}`);
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha256: frozen.sha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--api')) {
    console.log('Name --api (the gate run).');
    process.exit(0);
  }
  const mcp = JSON.parse(readFileSync('experiments/c03/mcp-tools.json', 'utf8'));
  const base = JSON.parse(readFileSync('experiments/c03/baseline-tools.json', 'utf8'));
  const TOOLS = { B: base, M: [...base.filter((t) => t.name === 'Grep' || t.name === 'Glob'), ...mcp] };
  const keyFile = '.local/anthropic-api-key';
  if (!existsSync(keyFile)) throw new Error(`${keyFile} is missing: the owner puts the API key there (git-ignored)`);
  const key = readFileSync(keyFile, 'utf8').trim();
  const once = (arm, msgs) => countTokens(key, TOOLS[arm], msgs);

  const { tasks } = JSON.parse(readFileSync('experiments/c05/tasks.json', 'utf8'));
  const conditions = checkInputs(tasks);
  const srcs = new Map();
  const srcOf = (t) => { if (!srcs.has(t.file)) srcs.set(t.file, readFileSync(t.file, 'utf8')); return srcs.get(t.file); };

  // The noise check: the first 5 tasks' M2 path, or B2 when M2 is not valid, each counted 3 times.
  const probe = tasks.slice(0, 5).map((t) => { const p = paths(t, srcOf(t)); return p.M2.valid ? ['M', p.M2.messages] : ['B', p.B2.messages]; });
  const repeatable = await countsRepeat(probe, once);
  const count = repeatable ? once : counter3(once);
  // Each arm's fixed cost: its tools with one short user message, minus the same message with no tools.
  const ok = [{ role: 'user', content: 'ok' }];
  const noTools = await countTokens(key, [], ok);
  const toolCost = { B: (await once('B', ok)) - noTools, M: (await once('M', ok)) - noTools,
    'M with the baseline tools (C0.6)': (await countTokens(key, [...base, ...mcp], ok)) - noTools };

  const r = await gateWork(tasks, srcOf, count);
  writeFileSync('experiments/c05/c05-result.json', JSON.stringify({ date: new Date().toISOString(), label: 'C0.5 gate run',
    model: MODEL, ...conditions, noiseCheck: { requests: probe.length, repeats: 3, identical: repeatable,
      counting: repeatable ? 'once' : 'median of 3' }, toolCost, result: r }, null, 1) + '\n');
  console.log(`C0.5 gate run: median work ratio ${r.median.toFixed(3)}; pass at <= 0.50: ${r.pass ? 'PASS' : 'FAIL'}; ` +
    `with tool definitions ${r.medianTotal.toFixed(3)}; outline only ${r.medianM1Only.toFixed(3)}; ` +
    `find only ${r.medianM2Only?.toFixed(3)} (${r.m2Valid} tasks); B2 valid in ${r.b2Valid} tasks; ` +
    `B3 valid in ${r.b3Valid}, M3 valid in ${r.m3Valid}; 95% interval over files ${r.bootstrapFiles95.map((x) => x.toFixed(3)).join(' to ')}; ` +
    `noise check: ${repeatable ? 'identical repeats' : 'repeats differ, median of 3 used'}`);
}
