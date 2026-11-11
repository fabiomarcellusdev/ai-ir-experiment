// Gate C0.3: ideal-path tokens (docs/contract.md). Builds each task's shortest paths as API messages and counts
// them with Anthropic's count_tokens endpoint (free; needs an API key).
//   node experiments/c03/run-c03.mjs --api      the gate run: reads the key from .local/anthropic-api-key, never
//                                               prints it, writes experiments/c03/c03-result.json
//   node experiments/c03/run-c03.mjs --selftest  builds the paths for synthetic tasks on the POC samples (not gate
//                                               inputs) and counts characters, to test the code without the API
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { load, outlinePages, find, read } from './html.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const MODEL = 'claude-sonnet-5-5';
const FILE = '/work/page.html';
const READ_LINES = 2000; // the harness's Read: 2,000 lines a call
const LINE_CHARS = 2000; // lines cut at 2,000 characters
const CONTEXT = 20; // B's Grep path: 20 lines before and after the matched lines

const catN = (lines, from) => lines.map((l, i) => `${String(from + i + 1).padStart(6)}\t${l.slice(0, LINE_CHARS)}`).join('\n');
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineAt = (src, offset) => src.slice(0, offset).split('\n').length - 1; // 0-based line of an offset

/**
 * The first unique old_string around [a, b) for the Edit tool: the window grows 8 code units a step on each side
 * (an insertion starts with one character before the point). Its edges never split a surrogate pair.
 */
export function uniqueAround(src, a, b) {
  let s = a === b ? Math.max(0, a - 1) : a, e = b;
  const low = (i) => i > 0 && i < src.length && /[\uDC00-\uDFFF]/.test(src[i]);
  const count = (t) => { let n = 0, i = -1; while ((i = src.indexOf(t, i + 1)) >= 0 && n < 2) n++; return n; };
  const fix = () => { if (low(s)) s--; if (low(e)) e++; };
  fix();
  while (count(src.slice(s, e)) > 1) { s = Math.max(0, s - 8); e = Math.min(src.length, e + 8); fix(); }
  return [s, e];
}

let ids = 0;
const use = (name, input) => ({ type: 'tool_use', id: `toolu_${String(++ids).padStart(6, '0')}`, name, input });
const result = (u, text) => ({ type: 'tool_result', tool_use_id: u.id, content: text });

/**
 * A path as messages: steps are [tool name, input, result text]; then `final` (the edit call or the ANSWER text);
 * then a short user turn ("ok"), so that the request does not end with an assistant message (review, 2026-11-11).
 * Both arms get the same last turn.
 */
function messages(prompt, steps, final) {
  const msgs = [{ role: 'user', content: `${prompt}\n\nThe file is ${FILE}.` }];
  for (const [name, input, text] of steps) {
    const u = use(name, input);
    msgs.push({ role: 'assistant', content: [u] }, { role: 'user', content: [result(u, text)] });
  }
  msgs.push({ role: 'assistant', content: [final] });
  msgs.push({ role: 'user', content: final.type === 'tool_use' ? [result(final, 'ok')] : 'ok' });
  return msgs;
}

/** The four ideal paths of one task, each { valid, messages }. */
export function paths(task, src) {
  const m = load(src);
  const el = m.els[task.ref];
  const lines = src.split('\n');
  // The final step of each arm.
  let finalB, finalM;
  // B's Read must hold every byte that the task needs: the start tag for a question, else the edit's old_string
  // and, for a removal, the whole element.
  const st = el.sourceCodeLocation.startTag;
  let need = [st.startOffset, st.endOffset];
  if (task.type === 'question') {
    finalB = finalM = { type: 'text', text: `ANSWER: ${task.answer}` };
  } else {
    const [a, b, text] = task.change;
    const [s, e] = uniqueAround(src, a, b);
    need = [Math.min(s, task.range[0]), Math.max(e, task.op === 'remove' ? task.range[1] : e)];
    finalB = use('Edit', { file_path: FILE, old_string: src.slice(s, e), new_string: src.slice(s, a) + text + src.slice(b, e) });
    const [ns, ne] = [el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset];
    const html = task.op === 'remove' ? '' : task.op === 'insert' ? src.slice(ns, ne) + text : src.slice(ns, a) + text + src.slice(b, ne);
    finalM = use('mcp__html__html_edit', { file: FILE, ref: el.ref, hash: m.hash, html });
  }
  const readNode = ['mcp__html__html_read', { file: FILE, ref: el.ref, hash: m.hash }, read(m, el)];
  // B1: the whole file, 2,000 lines a call.
  const b1 = [];
  for (let s = 0; s < lines.length; s += READ_LINES) {
    b1.push(['Read', s === 0 ? { file_path: FILE } : { file_path: FILE, offset: s + 1, limit: READ_LINES }, catN(lines.slice(s, s + READ_LINES), s)]);
  }
  // B2: Grep for the quoted words, then one read of the matched lines with 20 lines around them.
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(task.quote)) hits.push(i); });
  let B2 = { valid: false };
  if (hits.length) {
    const from = Math.max(0, hits[0] - CONTEXT), to = Math.min(lines.length - 1, hits[hits.length - 1] + CONTEXT);
    B2 = {
      valid: lineAt(src, need[0]) >= from && lineAt(src, Math.max(need[0], need[1] - 1)) <= to,
      messages: messages(task.prompt, [
        ['Grep', { pattern: reEscape(task.quote), path: FILE, output_mode: 'content', '-n': true },
          hits.map((i) => `${i + 1}:${lines[i].slice(0, LINE_CHARS)}`).join('\n')],
        ['Read', { file_path: FILE, offset: from + 1, limit: to - from + 1 }, catN(lines.slice(from, to + 1), from)],
      ], finalB),
    };
  }
  // M1: the whole outline, then the node. M2: html_find, then the node.
  const pages = outlinePages(m);
  const f = find(m, task.quote);
  return {
    hits: hits.length,
    findMatches: f.matches.length,
    B1: { valid: true, messages: messages(task.prompt, b1, finalB) },
    B2,
    M1: { valid: true, messages: messages(task.prompt, [...pages.map((p, i) => ['mcp__html__html_outline', { file: FILE, page: i + 1 }, p]), readNode], finalM) },
    M2: { valid: f.matches.slice(0, 20).includes(el), messages: messages(task.prompt, [['mcp__html__html_find', { file: FILE, text: task.quote }, f.text], readNode], finalM) },
  };
}

async function countTokens(key, tools, msgs) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, tools, messages: msgs }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt)); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`count_tokens failed (${r.status}): ${j.error?.message ?? 'no message'}`);
    return j.input_tokens;
  }
  throw new Error('count_tokens: too many retries');
}

export const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };


/** Counts every valid path of every task, then the gate's ratio. It prints no number for a single task. */
export async function gate(tasks, srcOf, count) {
  const rows = [];
  for (const t of tasks) {
    const p = paths(t, srcOf(t));
    const row = { id: t.id, type: t.type, grepHits: p.hits, findMatches: p.findMatches };
    for (const k of ['B1', 'B2', 'M1', 'M2']) row[k] = p[k].valid ? await count(k[0], p[k].messages) : null;
    row.B = Math.min(...[row.B1, row.B2].filter((x) => x !== null));
    row.M = Math.min(...[row.M1, row.M2].filter((x) => x !== null));
    row.ratio = row.M / row.B;
    row.ratioM1 = row.M1 / row.B;
    row.ratioM2 = row.M2 === null ? null : row.M2 / row.B;
    rows.push(row);
  }
  const med = median(rows.map((r) => r.ratio));
  const m2 = rows.filter((r) => r.ratioM2 !== null);
  return { rows, median: med, pass: med <= 0.5, medianM1Only: median(rows.map((r) => r.ratioM1)),
    medianM2Only: m2.length ? median(m2.map((r) => r.ratioM2)) : null, m2Valid: m2.length,
    b2Valid: rows.filter((r) => r.B2 !== null).length };
}

// The offline proxies of the POC (docs/measurements/2026-11-10-html-ir-token-proxy.md): pre-tokenizer chunk counts.
const SPLIT_A = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
const SPLIT_B = /'(?:[sdmtSDMT]|ll|ve|re|LL|VE|RE)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
/** The text a request carries: the tools as JSON, then each block's text, tool input as JSON, or tool result. */
export function requestText(tools, msgs) {
  const parts = [JSON.stringify(tools)];
  for (const m of msgs) {
    for (const b of typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content) {
      parts.push(b.type === 'text' ? b.text : b.type === 'tool_use' ? `${b.name} ${JSON.stringify(b.input)}` : b.content);
    }
  }
  return parts.join('\n');
}
export const proxyCount = (re) => (text) => (text.match(re) ?? []).length;

/** Checks that the run's inputs are the frozen ones: hashes, the task count and each target's tag. */
function checkInputs(tasks) {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const frozen = JSON.parse(readFileSync('experiments/c03/run-inputs.json', 'utf8'));
  for (const [file, want] of Object.entries(frozen.sha256)) {
    if (sha(file) !== want) throw new Error(`${file} is not the frozen input (SHA-256 differs)`);
  }
  const record = JSON.parse(readFileSync('experiments/c03/file-set.json', 'utf8'));
  for (const p of record.kinds.flatMap((k) => k.picks)) {
    if (createHash('sha256').update(readFileSync(p.file, 'utf8'), 'utf8').digest('hex') !== p.sha256) throw new Error(`${p.file} changed since the draw`);
  }
  if (tasks.length !== 40) throw new Error(`expected 40 tasks, found ${tasks.length}`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'experiments/c03', 'docs/contract.md'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`the frozen files have uncommitted changes:\n${dirty}`);
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha256: frozen.sha256 };
}

if (process.argv[1] && process.argv[1].endsWith('run-c03.mjs')) {
  const mcp = JSON.parse(readFileSync('experiments/c03/mcp-tools.json', 'utf8'));
  const base = JSON.parse(readFileSync('experiments/c03/baseline-tools.json', 'utf8'));
  const TOOLS = { B: base, M: [...base.filter((t) => t.name === 'Grep' || t.name === 'Glob'), ...mcp] };
  const gateRun = async (counters, outFile, label) => {
    const { tasks } = JSON.parse(readFileSync('experiments/c03/tasks.json', 'utf8'));
    const conditions = checkInputs(tasks);
    const srcs = new Map();
    const srcOf = (t) => { if (!srcs.has(t.file)) srcs.set(t.file, readFileSync(t.file, 'utf8')); return srcs.get(t.file); };
    const results = {};
    for (const [name, count] of Object.entries(counters)) results[name] = await gate(tasks, srcOf, count);
    writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), label, model: MODEL, ...conditions, results }, null, 1) + '\n');
    for (const [name, r] of Object.entries(results)) {
      console.log(`${label} (${name}): median ratio ${r.median.toFixed(3)}; pass at <= 0.50: ${r.pass ? 'PASS' : 'FAIL'}; ` +
        `outline only ${r.medianM1Only.toFixed(3)}; find only ${r.medianM2Only?.toFixed(3)} (${r.m2Valid} tasks); B2 valid in ${r.b2Valid} tasks`);
    }
  };
  if (process.argv.includes('--selftest')) {
    const dir = process.argv[process.argv.indexOf('--selftest') + 1];
    const srcs = readdirSafe(dir).map((f) => readFileSync(`${dir}/${f}`, 'utf8'));
    const { makeTasks } = await import('./make-tasks.mjs');
    const tasks = makeTasks(srcs.map((src, i) => ({ file: `sample-${i}`, src })));
    const res = await gate(tasks, (t) => srcs[t.fileNumber - 1], async (arm, msgs) => proxyCount(SPLIT_A)(requestText(TOOLS[arm], msgs)));
    console.log(`selftest (proxy A, not a gate input): median ${res.median.toFixed(3)}, M1 only ${res.medianM1Only.toFixed(3)}, M2 valid ${res.m2Valid}/${tasks.length}, B2 valid ${res.b2Valid}/${tasks.length}`);
  } else if (process.argv.includes('--preview')) {
    // The owner's preview (contract amendment "preview"): proxy counts on the frozen inputs, not the gate verdict.
    const counter = (re) => async (arm, msgs) => proxyCount(re)(requestText(TOOLS[arm], msgs));
    await gateRun({ proxyA: counter(SPLIT_A), proxyB: counter(SPLIT_B) }, 'experiments/c03/c03-preview.json', 'PREVIEW, not the gate verdict');
  } else if (process.argv.includes('--api')) {
    const keyFile = '.local/anthropic-api-key';
    if (!existsSync(keyFile)) throw new Error(`${keyFile} is missing: the owner puts the API key there (git-ignored)`);
    const key = readFileSync(keyFile, 'utf8').trim();
    await gateRun({ countTokens: (arm, msgs) => countTokens(key, TOOLS[arm], msgs) }, 'experiments/c03/c03-result.json', 'C0.3 gate run');
  } else {
    console.log('Name --api (the gate run), --preview (proxy counts) or --selftest <folder>.');
  }
}

function readdirSafe(dir) { return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')).sort() : []; }
