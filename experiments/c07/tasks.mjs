// The task sets of gates C0.7, C0.8, C0.9 and C0.10 and of their previews (docs/contract.md, "Phase 0, second rescope").
// The rules are in rules.mjs. This module adds the oracle (html5lib 1.1 through oracle_c07.py) and, for C0.7, the
// token count of a Read of the target (count_tokens: free, with the owner's key), and draws.
//
// A target is valid only after both checks. The task rule of the draw asks that each of the file's tasks can get a
// different valid target (a matching). The task draw checks every unit of a drawn file, then draws slot by slot among
// the valid targets that still leave a matching (`drawExact`), so it never fails on a file that passed the rule.
//
//   node experiments/c07/tasks.mjs <c07|c08|c09|c10>            the gate's v2 task set, from its committed v2 draw
//   node experiments/c07/tasks.mjs <c07|c08|c09|c10> --preview  the v2 preview's tasks, from C0.5's 10 files
// Since decision 0008 the rules use the v2 server, and the records have v2 names (`PATHS`); the v1 records stay.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generator, shuffle } from '../c05/draw-files.mjs';
import { tokens } from '../c01/tree.mjs';
import { codePoints } from '../c01/run-c01.mjs';
import { parseDoc, markerSource } from '../../server/view.mjs';
import * as R from './rules.mjs';
import { ToolError } from '../../server/errors.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
export const GATES = {
  c07: { seed: 20261112, types: ['removal', 'replacement'] },
  c08: { seed: 20261113, types: ['question', 'attribute', 'removal', 'insertion'] },
  c09: { seed: 20261114, types: ['question', 'text', 'attribute', 'structure'] },
  c10: { seed: 20261115, types: ['question', 'text', 'attribute', 'structure'] },
};
/** The gates whose structure task depends on the file number: an insertion in even files, a removal in odd files. */
const BY_PARITY = new Set(['c09', 'c10']);
/** The fewest files with which a gate runs (contract, amendment of decision 0008, item 4). */
export const MIN_FILES = 6;
/** Stops a gate's task set when its draw gave fewer than MIN_FILES files. */
export function checkFileCount(gate, n) {
  if (n < MIN_FILES) throw new Error(`${gate}: the draw gave ${n} files, under ${MIN_FILES}: the gate does not run`);
}
export const READ_LIMIT = 25_000; // tokens of one Read call (C0.6 run plan)
const MODEL = 'claude-sonnet-5-5';
const PYTHON = at('.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const sha = (s) => createHash('sha256').update(s).digest('hex');

// --- The oracle -----------------------------------------------------------------------------------------------------

/** The system's own variables for the oracle, as the C0.6 runner gives its judge (`systemEnv` in run-c06.mjs, which
 * imports this module, so the list is a second copy here). No key or token reaches Python. */
export function oracleEnv(parent = process.env) {
  const keep = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'LANG'];
  const env = {};
  for (const k of keep) if (parent[k] !== undefined) env[k] = parent[k];
  return env;
}

/**
 * Runs oracle_c07.py on one file. `edits`: [{id, el, html}] checks the tag, the clean range (the marker) and, for an
 * edit, that the splice keeps the tree outside the element. `kids`: [{id, el}] gives html5lib's child elements.
 */
export function runOracle(m, edits, kids = []) {
  const tokenHash = (t) => sha(JSON.stringify(tokens(parseDoc(t))));
  const t = m.text;
  const job = { files: { f: { text: t, parse5: null } }, edits: [], children: [] };
  for (const { id, el, html } of edits) {
    const [s, e] = R.range(el);
    job.edits.push({ id, file: 'f', ref: el.ref, ns: el.namespaceURI, tag: el.tagName, s: codePoints(t, s), e: codePoints(t, e), html,
      parse5Marked: tokenHash(t.slice(0, s) + markerSource(el, 'data-oracle-mark', '1') + t.slice(e)),
      parse5Spliced: tokenHash(t.slice(0, s) + html + t.slice(e)) });
  }
  for (const { id, el } of kids) job.children.push({ id, file: 'f', ref: el.ref });
  const work = mkdtempSync(path.join(tmpdir(), 'c07-oracle-'));
  try {
    writeFileSync(path.join(work, 'job.json'), JSON.stringify(job));
    // The system's variables only, and no output: a traceback could print third-party text (security review, F2).
    try {
      execFileSync(PYTHON, ['-I', '-B', at('experiments/c07/oracle_c07.py'), path.join(work, 'job.json'), path.join(work, 'out.json')],
        { stdio: 'ignore', env: oracleEnv() });
    } catch (err) {
      throw new Error(`the oracle failed (exit ${err.status ?? 'none'})`);
    }
    const out = JSON.parse(readFileSync(path.join(work, 'out.json'), 'utf8'));
    if (out.modules.some((x) => /^html5lib\.(filters|sanitizer)/.test(x))) throw new Error('the oracle loaded a filter or sanitizer module');
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** An edit passes the oracle: the same tag, an exact range, and (for an edit) the tree outside kept. */
const editOk = (v) => !!v && !v.error && v.tagOk && v.markerOk && v.kept === true;

/** html5lib gives the same child elements as parse5, with the same refs. */
export const childrenOk = (par, list) => Array.isArray(list) && list.length === par.children.length &&
  list.every(([ns, name, ref], i) => ns === par.children[i].namespaceURI && name === par.children[i].tagName && ref === par.children[i].ref);

// --- The token count of a Read of a C0.7 target ---------------------------------------------------------------------

/** Read's output for the lines of [s, e): "<line number>\t<line>", one per line (Claude Code 2.1.322). */
export function readOutput(text, s, e) {
  const lines = text.split('\n');
  const first = text.slice(0, s).split('\n').length;
  const last = text.slice(0, e).split('\n').length;
  return lines.slice(first - 1, last).map((l, i) => `${first + i}\t${l.replace(/\r$/, '')}`).join('\n');
}

export function tokenCounter(key) {
  return async (text) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: text }] }),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt)); continue; }
      const j = await r.json();
      // The API's message is redacted: it must never carry the key into an error (review, 9).
      if (!r.ok) throw new Error(`count_tokens failed (${r.status}): ${String(j.error?.message ?? 'no message').split(key).join('[key]')}`);
      return j.input_tokens;
    }
    throw new Error('count_tokens: too many retries');
  };
}

// --- The units of each gate -----------------------------------------------------------------------------------------

/**
 * The candidate units of one task type in one file, before the checks: each has a target `el`, the edit's html for
 * the oracle, the change of the file (null for a question), and the task's fields.
 */
export function units(gate, type, m, n) {
  const out = [];
  if (gate === 'c07') {
    for (const c of m.c07 ??= R.c07Candidates(m)) {
      const x = c.edits[type];
      if (x) out.push({ el: c.el, html: x.html, change: x.change, quote: c.quote, fields: { quote: c.quote, prompt: R.c07Prompt(type, c.el.tagName, c.quote) } });
    }
    return out;
  }
  if (gate === 'c08') {
    for (const par of m.c08 ??= R.c08Parents(m)) {
      for (const t of R.c08Targets(par)) {
        const [s, e] = R.range(t.el);
        const own = m.text.slice(s, e);
        const base = { parentId: t.id, k: t.k };
        if (type === 'question') for (const a of R.c08Attrs(t.el)) out.push({ el: t.el, par, html: own, change: null, fields: { ...base, attr: a.name, answer: a.value, prompt: R.c08Prompt(type, t, { attr: a.name }) } });
        if (type === 'attribute') {
          for (const a of R.c08Attrs(t.el)) {
            const newValue = `updated-value-${n}`;
            const x = R.attributeEdit(m, t.el, a.name, newValue);
            if (x) out.push({ el: t.el, par, html: x.html, change: x.change, fields: { ...base, attr: a.name, newValue, prompt: R.c08Prompt(type, t, { attr: a.name, newValue }) } });
          }
        }
        if (type === 'removal' || type === 'insertion') {
          const x = R.wholeEdit(m, t.el, type);
          if (x) out.push({ el: t.el, par, html: x.html, change: x.change, fields: { ...base, op: type, prompt: R.c08Prompt(type, t) } });
        }
      }
    }
    return out;
  }
  const op = n % 2 === 0 ? 'insertion' : 'removal';
  if (gate === 'c10') {
    // C0.10: C0.3's task rules on the server's view, with the v2 acceptance (contract amendment "the gate text for
    // the v2 tools", C.4).
    for (const c of m.c10 ??= R.c10Candidates(m)) {
      const [s, e] = R.range(c.el);
      const own = m.text.slice(s, e);
      const tag = c.el.tagName;
      if (type === 'question') for (const a of R.safeAttrs(c.el)) out.push({ el: c.el, html: own, change: null, fields: { quote: c.quote, attr: a.name, answer: a.value, prompt: R.c09Prompt(type, tag, c.quote, { attr: a.name }) } });
      if (type === 'text') {
        for (const t of R.c10TextQuotes(m, c.el)) {
          const newText = `Updated wording ${n}`;
          const change = [t.at, t.at + t.quote.length, newText];
          const html = m.text.slice(s, t.at) + newText + m.text.slice(t.at + t.quote.length, e);
          if (R.v2Accepts(m, c.el, 'replace_text', { old: t.quote, new: newText }, change)) out.push({ el: c.el, html, change, fields: { quote: t.quote, newText, prompt: R.c09Prompt(type, tag, t.quote, { newText }) } });
        }
      }
      if (type === 'attribute') {
        for (const a of R.safeAttrs(c.el)) {
          const newValue = `updated-value-${n}`;
          const x = R.attributeEdit(m, c.el, a.name, newValue);
          if (x) out.push({ el: c.el, html: x.html, change: x.change, fields: { quote: c.quote, attr: a.name, newValue, prompt: R.c09Prompt(type, tag, c.quote, { attr: a.name, newValue }) } });
        }
      }
      if (type === 'structure') {
        const x = R.wholeEdit(m, c.el, op);
        if (x) out.push({ el: c.el, html: x.html, change: x.change, fields: { quote: c.quote, op, prompt: R.c09Prompt(type, tag, c.quote, { op }) } });
      }
    }
    return out;
  }
  // c09
  for (const q of m.c09 ??= R.c09Quotes(m)) {
    const [s, e] = R.range(q.el);
    const own = m.text.slice(s, e);
    const tag = q.el.tagName;
    if (type === 'question' && q.any) {
      for (const a of R.safeAttrs(q.el)) out.push({ el: q.el, html: own, change: null, fields: { quote: q.any.quote, causes: q.any.causes, attr: a.name, answer: a.value, prompt: R.c09Prompt(type, tag, q.any.quote, { attr: a.name }) } });
    }
    if (type === 'text' && q.one) {
      const newText = `Updated wording ${n}`;
      const html = m.text.slice(s, q.one.srcStart) + newText + m.text.slice(q.one.srcEnd, e);
      if (R.v2Accepts(m, q.el, 'replace_text', { old: q.one.quote, new: newText }, [q.one.srcStart, q.one.srcEnd, newText])) out.push({ el: q.el, html, change: [q.one.srcStart, q.one.srcEnd, newText], fields: { quote: q.one.quote, causes: q.one.causes, newText, prompt: R.c09Prompt(type, tag, q.one.quote, { newText }) } });
    }
    if (type === 'attribute' && q.any) {
      for (const a of R.safeAttrs(q.el)) {
        const newValue = `updated-value-${n}`;
        const x = R.attributeEdit(m, q.el, a.name, newValue);
        if (x) out.push({ el: q.el, html: x.html, change: x.change, fields: { quote: q.any.quote, causes: q.any.causes, attr: a.name, newValue, prompt: R.c09Prompt(type, tag, q.any.quote, { attr: a.name, newValue }) } });
      }
    }
    if (type === 'structure' && q.any) {
      const x = R.wholeEdit(m, q.el, op);
      if (x) out.push({ el: q.el, html: x.html, change: x.change, fields: { quote: q.any.quote, causes: q.any.causes, op, prompt: R.c09Prompt(type, tag, q.any.quote, { op }) } });
    }
  }
  return out;
}

/**
 * A checker of units for one file: the oracle (in batches, cached by unit) and, for C0.7, the Read token count
 * (cached by target). `count` is null when no key is given: then a C0.7 unit fails with an error.
 */
export function checker(m, count) {
  const verdicts = new Map();
  const kidsOk = new Map();
  const tokensOf = new Map();
  let next = 0;
  const check = async (list) => {
    const todo = list.filter((u) => !verdicts.has(u));
    if (todo.length) {
      const ids = new Map(todo.map((u) => [u, `u${next++}`]));
      const pars = [...new Set(todo.map((u) => u.par).filter((p) => p && !kidsOk.has(p)))];
      const pid = new Map(pars.map((p, i) => [p, `p${next}-${i}`]));
      const out = runOracle(m, todo.map((u) => ({ id: ids.get(u), el: u.el, html: u.html })), pars.map((p) => ({ id: pid.get(p), el: p.parent })));
      const byId = new Map(out.edits.map((v) => [v.id, v]));
      for (const p of pars) kidsOk.set(p, childrenOk(p, out.children[pid.get(p)]));
      for (const u of todo) verdicts.set(u, editOk(byId.get(ids.get(u))) && (!u.par || kidsOk.get(u.par)));
    }
    const ok = [];
    for (const u of list) {
      let v = verdicts.get(u);
      if (v && m.gate === 'c07') {
        if (!count) throw new Error('C0.7 needs the token count: no API key');
        if (!tokensOf.has(u.el)) { const [s, e] = R.range(u.el); tokensOf.set(u.el, await count(readOutput(m.text, s, e))); }
        u.readTokens = tokensOf.get(u.el);
        v = u.readTokens < READ_LIMIT;
      }
      ok.push(v);
    }
    return ok;
  };
  check.counts = () => [...tokensOf].map(([el, n]) => [el.ref, n]).sort((x, y) => x[0] - y[0]);
  return check;
}

/** The units of a list grouped by target, in the order of each target's first unit. */
const byTarget = (list) => {
  const g = new Map();
  for (const u of list) { if (!g.has(u.el)) g.set(u.el, []); g.get(u.el).push(u); }
  return [...g.values()];
};

/**
 * The first group, in the given order, that has a valid unit, and that unit: the first valid one in the group's
 * order. Checks `batch` groups in one oracle call.
 */
async function firstValidGroup(groups, check, batch = 6) {
  for (let i = 0; i < groups.length; i += batch) {
    const part = groups.slice(i, i + batch);
    const ok = await check(part.flat());
    let k = 0;
    for (const g of part) {
      const j = ok.slice(k, k + g.length).indexOf(true);
      if (j >= 0) return g[j];
      k += g.length;
    }
  }
  return null;
}

/** The valid targets of a list, in document order, up to `cap` (all of them when there are fewer). */
async function validTargets(list, check, cap) {
  const out = [];
  let groups = byTarget(list);
  while (out.length < cap) {
    const u = await firstValidGroup(groups, check);
    if (!u) break;
    out.push(u.el);
    groups = groups.slice(groups.findIndex((g) => g[0].el === u.el) + 1);
  }
  return out;
}

/** Whether each slot can get a different target from its own list (a small matching, by backtracking). */
export function matchingExists(lists, used = new Set(), i = 0) {
  if (i === lists.length) return true;
  for (const t of lists[i]) {
    if (used.has(t)) continue;
    used.add(t);
    if (matchingExists(lists, used, i + 1)) return true;
    used.delete(t);
  }
  return false;
}

/** The task types of a gate's file: its 4 tasks (C0.7: removal, replacement, removal, replacement). */
const taskTypes = (gate) => (gate === 'c07' ? ['removal', 'replacement', 'removal', 'replacement'] : GATES[gate].types);

/**
 * The task rule of the draw (contract, inputs 2): the file can give the gate's 4 tasks, with 4 different targets. For
 * C0.9 the file number is not known yet, so both the removal and the insertion must work. With at most 4 valid targets
 * kept for each type, the matching is exact: a type with 4 can always be served after the others. Returns the reason,
 * or null.
 */
export async function taskRule(gate, text, count) {
  let m;
  try {
    m = R.view(text);
  } catch (err) {
    if (err instanceof ToolError) return err.message;
    throw err;
  }
  m.gate = gate;
  const check = checker(m, count);
  const found = new Map();
  const targetsOf = async (type, n) => {
    const k = `${type}|${BY_PARITY.has(gate) && type === 'structure' ? n % 2 : 0}`;
    if (!found.has(k)) found.set(k, await validTargets(units(gate, type, m, n), check, 4));
    return found.get(k);
  };
  for (const n of BY_PARITY.has(gate) ? [1, 2] : [1]) {
    const lists = [];
    for (const type of taskTypes(gate)) lists.push(await targetsOf(type, n));
    if (!matchingExists(lists)) {
      const op = BY_PARITY.has(gate) ? (n % 2 ? ' (structure: removal)' : ' (structure: insertion)') : '';
      return `cannot give the 4 tasks with 4 different targets${op}; valid targets: ${taskTypes(gate).map((t, i) => `${t} ${lists[i].length}`).join(', ')}`;
    }
  }
  return null;
}

/**
 * The draw of one file's tasks (re-review, 5): slot by slot, a uniform choice among the valid targets that no earlier
 * slot uses and that still leave a matching for the later slots; then a uniform choice among that target's valid units
 * (its attributes, for a question or an attribute change). `slots` holds, for each task, a Map from target to its valid
 * units, in document order. Returns null only when no matching exists, which the task rule refuses.
 */
export function drawExact(slots, rnd) {
  const used = new Set();
  const picks = [];
  for (let i = 0; i < slots.length; i++) {
    const rest = slots.slice(i + 1).map((g) => [...g.keys()]);
    const options = [];
    for (const t of slots[i].keys()) {
      if (used.has(t)) continue;
      if (matchingExists(rest, new Set([...used, t]))) options.push(t);
    }
    if (!options.length) return null;
    const t = shuffle(options, rnd)[0];
    const list = slots[i].get(t);
    picks.push(list.length > 1 ? shuffle(list, rnd)[0] : list[0]);
    used.add(t);
  }
  return picks;
}

/** A file that cannot give its tasks, with the token counts made so far (re-review, 8). */
export class NoTasks extends Error {
  constructor(message, readTokens = []) {
    super(message);
    this.readTokens = readTokens;
  }
}

/** The server's view of a file, or NoTasks with the server's reason (re-review, 3: a file nested over 512 levels). */
function viewOrNoTasks(text, n) {
  try {
    return R.view(text);
  } catch (err) {
    if (err instanceof ToolError) throw new NoTasks(`file ${n}: ${err.message}`);
    throw err;
  }
}

/**
 * The tasks of one file. `types` is the list of task types to make, in order; `rnd` the gate's stream. Every unit is
 * checked (the oracle and, for C0.7, the token count), then `drawExact` draws. Returns the tasks and every Read token
 * count of C0.7 (contract: the script records each count).
 */
export async function fileTasks(gate, f, n, types, rnd, count) {
  const m = viewOrNoTasks(f.text, n);
  m.gate = gate;
  const check = checker(m, count);
  const byType = new Map();
  for (const type of new Set(types)) {
    const list = units(gate, type, m, n);
    const ok = list.length ? await check(list) : [];
    const g = new Map();
    list.forEach((u, i) => { if (ok[i]) { if (!g.has(u.el)) g.set(u.el, []); g.get(u.el).push(u); } });
    byType.set(type, g);
  }
  const picks = drawExact(types.map((t) => byType.get(t)), rnd);
  if (!picks) throw new NoTasks(`file ${n}: no valid target left for ${types.join(', ')} with different targets`, check.counts());
  const seen = new Map();
  const tasks = picks.map((u, i) => {
    const type = types[i];
    const j = (seen.get(type) ?? 0) + 1;
    seen.set(type, j);
    const id = `${n}-${type}${types.filter((x) => x === type).length > 1 ? `-${j}` : ''}`;
    const [s, e] = R.range(u.el);
    const op = u.fields.op;
    return { id, fileNumber: n, file: f.file, type, ref: u.el.ref, tag: u.el.tagName, ...u.fields,
      range: op === 'insertion' ? [e, e] : [s, e], ...(u.change ? { change: u.change } : {}),
      ...(u.readTokens !== undefined ? { readTokens: u.readTokens } : {}) };
  });
  return { tasks, readTokens: check.counts() };
}

/** A gate's 40 tasks (or 32), file by file in the record's order, with one stream of the gate's seed. */
export async function gateTasks(gate, files, count) {
  const rnd = generator(GATES[gate].seed);
  const tasks = [];
  const readTokens = {};
  for (let i = 0; i < files.length; i++) {
    const r = await fileTasks(gate, files[i], i + 1, taskTypes(gate), rnd, count);
    tasks.push(...r.tasks);
    if (r.readTokens.length) readTokens[i + 1] = r.readTokens;
  }
  return { tasks, skipped: [], readTokens };
}

/** The preview's type of file number n (contract, "Order of the second rescope", 4). */
export function previewType(gate, n) {
  if (gate === 'c07') return n % 2 ? 'removal' : 'replacement';
  return GATES[gate].types[(n - 1) % 4];
}

/** A preview's tasks: one from each of C0.5's files, with the gate's seed; a file that cannot give it is skipped. */
export async function previewTasks(gate, files, count) {
  const rnd = generator(GATES[gate].seed);
  const tasks = [];
  const skipped = [];
  const readTokens = {};
  for (let i = 0; i < files.length; i++) {
    try {
      const r = await fileTasks(gate, files[i], i + 1, [previewType(gate, i + 1)], rnd, count);
      tasks.push(...r.tasks);
      if (r.readTokens.length) readTokens[i + 1] = r.readTokens;
    } catch (err) {
      if (!(err instanceof NoTasks)) throw err;
      skipped.push({ fileNumber: i + 1, file: files[i].file, reason: err.message, ...(err.readTokens.length ? { readTokens: err.readTokens } : {}) });
    }
  }
  return { tasks, skipped, readTokens };
}

// --- The command line -----------------------------------------------------------------------------------------------

/**
 * The paths of the v2 records (contract amendment "the gate text for the v2 tools", C): the v1 records of the same
 * gates stay as they were, frozen. A preview's task set, a gate's task set, a gate's draw, and a gate's stored files.
 */
export const PATHS = {
  tasks: (gate, preview) => `experiments/c07/${preview ? 'preview-' : ''}v2-${gate}-tasks.json`,
  fileSet: (gate) => `experiments/c07/v2-${gate}-file-set.json`,
  store: (gate) => `experiments/gate-files/c07/v2-${gate}`,
  expected: (gate, preview) => `experiments/gate-files/c07/${preview ? 'preview-' : ''}v2-${gate}/expected`,
};

/** The stored path of a file: one folder for each file, under its base name (contract, inputs 3). */
export const storedPath = (dir, n, name) => `${dir}/${n}/${name}`;

const SEGMENTS = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
/**
 * A path from a committed record or task set, checked before any read or copy (security review, F4): relative,
 * forward slashes, plain segments, no `.` or `..` segment, and under `root` (default: the git-ignored data folder).
 */
export function checkedPath(p, roots = ['experiments/gate-files/']) {
  const ok = typeof p === 'string' && SEGMENTS.test(p) && !p.split('/').some((s) => s === '.' || s === '..') && roots.some((r) => p.startsWith(r));
  if (!ok) throw new Error(`refused path in a record: ${JSON.stringify(String(p).slice(0, 80))}`);
  return p;
}

async function main() {
  const [gate, flag] = process.argv.slice(2);
  if (!GATES[gate]) throw new Error('usage: node experiments/c07/tasks.mjs <c07|c08|c09|c10> [--preview]');
  const preview = flag === '--preview';
  const out = at(PATHS.tasks(gate, preview));
  if (existsSync(out)) throw new Error(`${path.relative(ROOT, out)} exists: the task set is made once`);
  const keyFile = at('.local/anthropic-api-key');
  const count = gate === 'c07' ? tokenCounter(readFileSync(keyFile, 'utf8').trim()) : null;
  let files;
  if (preview) {
    // C0.5's 10 files, stored again under plain names (contract, "Order of the second rescope", 4).
    const c05 = JSON.parse(readFileSync(at('experiments/c05/file-set.json'), 'utf8'));
    files = c05.kinds.flatMap((k) => k.picks).map((p, i) => {
      const file = storedPath('experiments/gate-files/c07/preview', i + 1, p.path.split('/').pop());
      mkdirSync(at(path.dirname(file)), { recursive: true });
      if (!existsSync(at(file))) copyFileSync(at(checkedPath(p.file)), at(checkedPath(file)));
      return { file, sha256: p.sha256 };
    });
  } else {
    const record = JSON.parse(readFileSync(at(PATHS.fileSet(gate)), 'utf8'));
    files = record.kinds.flatMap((k) => k.picks).map((p) => ({ file: checkedPath(p.file), sha256: p.sha256 }));
    // A gate with fewer than 6 files does not run (contract, amendment of decision 0008, item 4).
    checkFileCount(gate, files.length);
  }
  for (const f of files) {
    f.text = readFileSync(at(f.file), 'utf8');
    if (sha(Buffer.from(f.text, 'utf8')) !== f.sha256) throw new Error(`${f.file} changed since the draw`);
  }
  const result = preview ? await previewTasks(gate, files, count) : await gateTasks(gate, files, count);
  const expDir = PATHS.expected(gate, preview);
  mkdirSync(at(expDir), { recursive: true });
  for (const t of result.tasks) {
    if (!t.change) continue;
    const exp = R.applyChange(files[t.fileNumber - 1].text, t.change);
    t.expected = `${expDir}/${t.id}.html`;
    writeFileSync(at(t.expected), exp);
    t.expectedSha256 = sha(Buffer.from(exp, 'utf8'));
  }
  writeFileSync(out, JSON.stringify({ gate, tools: 'v2', preview, seed: GATES[gate].seed, offsetUnit: 'UTF-16 code units of the file as text',
    skipped: result.skipped, readTokens: result.readTokens, tasks: result.tasks }, null, 1) + '\n');
  console.log(`${result.tasks.length} tasks written to ${path.relative(ROOT, out)}; ${result.skipped.length} files skipped`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
