// Gate C0.1 v2: edit fidelity of the 5 v2 operations (docs/contract.md, amendment "the gate text for the v2 tools",
// A). No model, no cost.
//   node experiments/c01/run-c01-v2.mjs        the gate run: needs committed code; writes c01-v2-result.json
//   node experiments/c01/run-c01-v2.mjs --dev  the same run on uncommitted code; writes no tracked file
// It drives the real server with --tools v2 over stdio, as a harness does. Every check of a result uses html5lib
// (oracle_v2.py), or the bytes; the locators come from html5lib's tree, not from the server's code.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDoc, markerSource, VOID } from '../../server/view.mjs';
import { generator } from '../c05/draw-files.mjs';
import { tokens } from './tree.mjs';
import { copiesOf, gateFiles, entry, drawableRefs, noRangeRefs, codePoints, forbiddenNames, NEW_HTML, GOOD } from './run-c01.mjs';
import { CASES, EXPECT } from '../../tests/gates/v2-cases.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hashOf = (b) => sha256(b).slice(0, 16);

export const SEED = 20261116;
/** C0.1's seed: C0.1 v2 uses C0.1's 16 files, so it makes the same 2 copies with C0.1's first draws. */
export const SEED_C01 = 20261110;
export const RANDOM = 1500; // owner, 2026-11-12, after the development run: 1,000 gave 91 accepted replace changes
export const MIN_ACCEPTED = 100;
export const OPS = ['remove', 'replace', 'insert_after', 'set_attribute', 'replace_text'];
export const ATTR_NAMES = ['class', 'data-x', 'title'];
export const ATTR_VALUES = ['v', 'a "q" & b', 'é\u{1F600}', ''];
export const NEW_TEXTS = ['x', 'A & B <c>', '\u{1F600}', ''];
const PYTHON = at('.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
const WS = /[ \t\n\f\r]+/g;
const count = (hay, needle) => { let n = 0; for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) n++; return n; };
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// --- The oracle ------------------------------------------------------------------------------------------------------

/** Runs oracle_v2.py with a job; the system's variables only. */
export function oracle(cmd, job) {
  const work = mkdtempSync(path.join(tmpdir(), 'hir-c01v2-'));
  try {
    writeFileSync(path.join(work, 'job.json'), JSON.stringify(job));
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    execFileSync(PYTHON, ['-I', '-B', at('experiments/c01/oracle_v2.py'), cmd, path.join(work, 'job.json'), path.join(work, 'out.json')], { stdio: ['ignore', 'ignore', 'inherit'], env, maxBuffer: 1 << 30 });
    const out = JSON.parse(readFileSync(path.join(work, 'out.json'), 'utf8'));
    if (out.modules.some((x) => /^html5lib\.(filters|sanitizer)/.test(x))) throw new Error('the oracle loaded a filter or sanitizer module');
    return out.result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// --- The oracle's text model -----------------------------------------------------------------------------------------

/**
 * The visible text of a file from the oracle's facts: the raw text of its visible text tokens, the normalized text,
 * and each element's span in it (as html_find reads spans, but from html5lib's tree).
 */
export function textModel(facts) {
  const raw = [];
  const tokStart = [];
  let len = 0;
  for (const [idx, value] of facts.texts) { tokStart.push([idx, len]); raw.push(value); len += value.length; }
  const r = raw.join('');
  const atv = new Int32Array(r.length + 1);
  let g = 0;
  for (let i = 0, inWs = false; i < r.length; i++) { atv[i] = g; const ws = isWs(r[i]); if (!ws || !inWs) g++; inWs = ws; }
  atv[r.length] = g;
  const vis = r.replace(WS, ' ');
  const firstAtOrAfter = (idx) => { let a = 0; let b = tokStart.length; while (a < b) { const k = (a + b) >> 1; if (tokStart[k][0] < idx) a = k + 1; else b = k; } return a; };
  const spans = facts.elements.map((el) => {
    const a = firstAtOrAfter(el.start);
    const b = firstAtOrAfter(el.end);
    const rs = a < tokStart.length ? tokStart[a][1] : len;
    const re = b < tokStart.length ? tokStart[b][1] : len;
    return [atv[rs], atv[Math.max(rs, re)]];
  });
  const children = facts.elements.map(() => []);
  facts.elements.forEach((el, ref) => { if (el.parent !== null && el.parent !== undefined) children[el.parent].push(ref); });
  const textOf = (ref) => vis.slice(...spans[ref]);
  return { vis, spans, children, textOf, facts };
}

const wordBounded = (vis, i, n) => i >= 0 && (i === 0 || vis[i - 1] === ' ') && (i + n === vis.length || vis[i + n] === ' ');
const isAncestor = (facts, a, d) => { for (let p = facts.elements[d].parent; p !== null && p !== undefined; p = facts.elements[p].parent) if (p === a) return true; return false; };

/** The `old` runs of a target: 1 to 6 whole words of one visible text token inside it, found once in its text. */
export function oldRuns(tm, ref) {
  const el = tm.facts.elements[ref];
  const mine = tm.textOf(ref);
  const out = [];
  for (const [idx, value] of tm.facts.texts) {
    if (idx <= el.start || idx >= el.end) continue;
    const words = value.replace(WS, ' ').trim().split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= 6 && i + n <= words.length; n++) {
        const run = words.slice(i, i + n).join(' ');
        // Whole words of the target's visible text: "bar" of "foo<b>bar</b>" is not one (review, 13).
        if (count(mine, run) === 1 && wordBounded(mine, mine.indexOf(run), run.length) && !out.includes(run)) out.push(run);
      }
    }
  }
  return out;
}

/** The first locator of a target (locatorOptions' first), or null. */
export const locatorFor = (tm, ref) => locatorOptions(tm, ref)[0] ?? null;

/**
 * The locators of a target, by the oracle's text and tree (contract, A.5): text and tag, and text alone, when they
 * name only the target (the stream then picks one; owner, 2026-11-12); else id; else id with child and n; else none.
 */
export function locatorOptions(tm, ref) {
  const { facts, vis, spans } = tm;
  const el = facts.elements[ref];
  const words = tm.textOf(ref).trim().split(' ').filter(Boolean);
  let run = null;
  for (let i = 0; i < words.length && !run; i++) {
    for (let n = 6; n >= 3 && !run; n--) {
      if (i + n > words.length) continue;
      const r = words.slice(i, i + n).join(' ');
      if (count(vis, r) === 1 && wordBounded(vis, vis.indexOf(r), r.length)) run = r;
    }
  }
  if (run) {
    const pos = vis.indexOf(run);
    const holders = facts.elements.map((e, k) => k).filter((k) => facts.elements[k].shown && spans[k][0] <= pos && pos + run.length <= spans[k][1]);
    const tagged = holders.filter((k) => facts.elements[k].tag.toLowerCase() === el.tag.toLowerCase());
    const innermost = tagged.filter((k) => !tagged.some((o) => o !== k && isAncestor(facts, k, o)));
    const deepest = holders.filter((k) => !holders.some((o) => o !== k && isAncestor(facts, k, o)));
    const opts = [];
    if (innermost.length === 1 && innermost[0] === ref) opts.push({ text: run, tag: el.tag });
    if (deepest.length === 1 && deepest[0] === ref) opts.push({ text: run });
    if (opts.length) return opts;
  }
  if (el.id !== null && facts.ids[el.id] === 1 && el.shown) return [{ id: el.id }];
  const p = el.parent;
  if (p !== null && p !== undefined) {
    const pe = facts.elements[p];
    if (pe.id !== null && facts.ids[pe.id] === 1 && pe.shown) {
      const same = tm.children[p].filter((k) => facts.elements[k].tag === el.tag);
      return [{ id: pe.id, child: el.tag, n: same.indexOf(ref) + 1 }];
    }
  }
  return [];
}

// --- The changes -----------------------------------------------------------------------------------------------------

/** The change of a C0.5 task, as its v2 operation by ref (contract, A.2). */
export function taskChange(t, f) {
  const base = { id: `task:${t.id}`, kind: 'task', file: f.name, ref: t.ref, expectedSha256: t.expectedSha256 };
  if (t.type === 'text') return { ...base, op: 'replace_text', args: { old: t.quote, new: t.newText } };
  if (t.type === 'attribute') return { ...base, op: 'set_attribute', args: { attribute: t.attr, value: t.newValue } };
  if (t.op === 'insert') return { ...base, op: 'insert_after', args: { html: '<p>New text</p>' } };
  return { ...base, op: 'remove', args: {} };
}

/** The random changes (contract, A.4 and A.5): file, target, operation, arguments, locator, from one stream. */
export function randomChanges(entries, models, rnd, n = RANDOM) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const f = entries[rnd(entries.length)];
    const tm = models.get(f.name);
    const refs = drawableRefs(f.m);
    let ref = refs[rnd(refs.length)];
    const op = OPS[rnd(OPS.length)];
    let args;
    if (op === 'replace' || op === 'insert_after') args = { html: NEW_HTML[rnd(NEW_HTML.length)] };
    else if (op === 'set_attribute') {
      const names = [...ATTR_NAMES, ...tm.facts.elements[ref].attrs.map((a) => a[0]).filter((x) => !ATTR_NAMES.includes(x))];
      args = { attribute: names[rnd(names.length)], value: ATTR_VALUES[rnd(ATTR_VALUES.length)] };
    } else if (op === 'replace_text') {
      let runs = oldRuns(tm, ref);
      for (let tries = 0; !runs.length && tries < 100; tries++) { ref = refs[rnd(refs.length)]; runs = oldRuns(tm, ref); }
      if (!runs.length) { out.push({ id: `random:${k}`, kind: 'random', file: f.name, ref, op, skipped: 'no old run in 100 targets' }); continue; }
      args = { old: runs[rnd(runs.length)], new: NEW_TEXTS[rnd(NEW_TEXTS.length)] };
    } else args = {};
    const byLocator = rnd(2) === 1;
    const opts = byLocator ? locatorOptions(tm, ref) : [];
    const loc = opts.length > 1 ? opts[rnd(opts.length)] : opts[0] ?? null;
    const withHash = byLocator && rnd(10) === 0;
    out.push({ id: `random:${k}`, kind: 'random', file: f.name, ref, op, args, locator: loc, withHash });
  }
  return out;
}

// --- The server ------------------------------------------------------------------------------------------------------

/** The negative controls (contract, A.10): copies of the server with one line changed. */
export const MUTANTS = {
  'moves the node by 1 byte': ['edit.mjs', GOOD, "return Buffer.concat([bytes.subarray(0, bs + 1), Buffer.from(html, 'utf8'), bytes.subarray(be + 1)]);"],
  'writes the whole file again from the tree': ['edit.mjs', GOOD, "return Buffer.from(serialize(doc2), 'utf8');"],
  'changes CRLF to LF': ['edit.mjs', GOOD, String.raw`return Buffer.from(Buffer.concat([bytes.subarray(0, bs), Buffer.from(html, 'utf8'), bytes.subarray(be)]).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');`],
  'calls every located range clean': ['view.mjs', 'return clean.set(n, false);', 'return clean.set(n, true);'],
  'set_attribute that adds before />': ['v2.mjs', '  return `${own.slice(0, name0.length)} ${pair}${own.slice(name0.length)}`;',
    "  { const end = loc.startTag.endOffset - s; const cut = own.slice(0, end).endsWith('/>') ? end - 2 : end - 1; return `${own.slice(0, cut)} ${pair}${own.slice(cut)}`; }"],
  'insert_after without the end-tag check': ['v2.mjs', "      if (!el.sourceCodeLocation.endTag && !VOID.has(el.tagName)) fail('the element has no end tag in the file, so new HTML after it would go inside it');", ''],
  'replace_text that ignores the bounds of a character reference': ['v2.mjs', '  if ((a > 0 && map[a - 1][0] === map[a][0]) || (b < map.length && map[b][0] === map[b - 1][0])) {', '  if (false) {'],
  'a text locator that takes the first of several matches': ['v2.mjs', '    if (found.length !== 1) {', '    if (found.length === 0) {'],
};

function mutantServer(name, base) {
  const dir = path.join(base, name.replace(/\W+/g, '-'));
  mkdirSync(path.join(dir, 'server'), { recursive: true });
  mkdirSync(path.join(dir, 'experiments', 'c03'), { recursive: true });
  for (const f of readdirSync(at('server'))) if ((f.endsWith('.mjs') && !f.endsWith('.test.mjs')) || f.endsWith('.json')) copyFileSync(at('server', f), path.join(dir, 'server', f));
  copyFileSync(at('experiments/c03/mcp-tools.json'), path.join(dir, 'experiments', 'c03', 'mcp-tools.json'));
  const [file, from, to] = MUTANTS[name];
  const p = path.join(dir, 'server', file);
  const src = readFileSync(p, 'utf8');
  if (src.split(from).length !== 2) throw new Error(`the control "${name}" cannot find the line it changes in server/${file}`);
  writeFileSync(p, src.replace(from, to));
  return path.join(dir, 'server', 'main.mjs');
}

function startServer(main, root) {
  const p = spawn(process.execPath, [main, '--root', root, '--tools', 'v2'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (c) => {
    buf += c;
    for (let i = buf.indexOf('\n'); i !== -1; i = buf.indexOf('\n')) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  let n = 0;
  const req = (method, params) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { req, tool: async (name, args) => (await req('tools/call', { name, arguments: args })).result, stop: () => new Promise((r) => { p.on('exit', r); p.stdin.end(); }) };
}

/** The arguments of a change's call: the operation's arguments and its locator, or its ref with the hash. */
export function callArgs(ch, hash) {
  const loc = ch.locator ? { ...ch.locator, ...(ch.withHash ? { hash } : {}) } : { ref: ch.ref, hash };
  return { file: ch.file, operation: ch.op, ...ch.args, ...loc };
}

/** Runs each change on a fresh copy of its file; records the result bytes and the server's reply. */
export async function serverOutcomes(main, entries, changes) {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-c01v2-ws-'));
  const s = startServer(main, root);
  try {
    await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c01v2', version: '1' } });
    const byName = new Map(entries.map((f) => [f.name, f]));
    const out = new Map();
    for (const ch of changes) {
      if (ch.skipped) continue;
      const f = byName.get(ch.file);
      const file = path.join(root, f.name);
      writeFileSync(file, f.bytes);
      const r = await s.tool('html_change', callArgs(ch, hashOf(f.bytes)));
      const after = readFileSync(file);
      // The bytes on disk: strict UTF-8, and their own hashes (review, 2).
      let text = null;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(after); } catch { /* not UTF-8: a failure */ }
      const o = { accepted: !r.isError, text: r.content[0].text, after: text, invalidUtf8: text === null, unchanged: after.equals(f.bytes),
        afterHash: hashOf(after), afterSha256: sha256(after) };
      // A refused locator change runs again by ref: the refusal must be the same, so a wrong element with the same
      // refusal cannot hide (review, 9).
      if (r.isError && ch.locator) {
        writeFileSync(file, f.bytes);
        o.byRefText = (await s.tool('html_change', callArgs({ ...ch, locator: null }, hashOf(f.bytes)))).content[0].text;
      }
      out.set(ch.id, o);
    }
    return out;
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

// --- The byte checks -------------------------------------------------------------------------------------------------

/** The source range of a ref in UTF-16 units, from the parse5 view (confirmed by the oracle's marker check). */
const rangeOf = (f, ref) => { const l = f.m.els[ref].sourceCodeLocation; return l ? [l.startOffset, l.endOffset] : null; };

/** Whether the bytes are right for an accepted change (contract, A.6, 1 and 2). Returns the reasons, empty when right. */
export function byteReasons(f, ch, after) {
  const t = f.text;
  const [s, e] = rangeOf(f, ch.ref);
  const r = [];
  const tail = t.length - e;
  if (after.slice(0, s) !== t.slice(0, s) || after.slice(after.length - tail) !== t.slice(e)) r.push('a byte outside the range changed');
  const inside = after.slice(s, after.length - tail);
  const own = t.slice(s, e);
  if (ch.op === 'remove' && inside !== '') r.push('the range is not removed');
  if (ch.op === 'replace' && inside !== ch.args.html) r.push('the range is not the new HTML');
  if (ch.op === 'insert_after' && inside !== own + ch.args.html) r.push('the range is not the element and then the new HTML');
  if (ch.op === 'set_attribute') {
    const el = f.m.els[ch.ref];
    const name = ch.args.attribute;
    const loc = el.sourceCodeLocation.attrs?.[name.toLowerCase()];
    const pair = `${name}="${escAttr(ch.args.value)}"`;
    let want;
    if (loc) want = own.slice(0, loc.startOffset - s) + pair + own.slice(loc.endOffset - s);
    else { const tag = /^<[^\s/>]+/.exec(own)[0]; want = `${own.slice(0, tag.length)} ${pair}${own.slice(tag.length)}`; }
    if (inside !== want) r.push('set_attribute changed other bytes than the attribute');
  }
  if (ch.op === 'replace_text') {
    // One part of the range is replaced by the escaped new text, and nothing else changes.
    const neu = escText(ch.args.new);
    // The new text starts at some k: at most the common prefix p, and late enough that the common suffix q covers
    // everything after it. When old and new are equal, the strings are equal, and k can be anywhere (dev run, 2).
    let p = 0;
    while (p < own.length && p < inside.length && own[p] === inside[p]) p++;
    let q = 0;
    while (q < own.length - p && q < inside.length - p && own[own.length - 1 - q] === inside[inside.length - 1 - q]) q++;
    if (p === own.length && p === inside.length) q = own.length;
    const lo = Math.max(0, inside.length - q - neu.length);
    const hi = Math.min(p, inside.length - neu.length);
    let ok = false;
    for (let k = lo; k <= hi && !ok; k = neu ? inside.indexOf(neu, k + 1) : k + 1) {
      if (k < lo || k === -1) break;
      if (inside.slice(k, k + neu.length) !== neu) continue;
      const y = k + (own.length - inside.length) + neu.length;
      ok = y >= k && inside.slice(0, k) === own.slice(0, k) && inside.slice(k + neu.length) === own.slice(y);
      // The replaced bytes lie inside the source of one text node of the target (review, 1).
      if (ok) ok = textSpans(f.m.els[ch.ref]).some(([a, b]) => a <= s + k && s + y <= b);
    }
    if (!ok) r.push('replace_text changed other bytes than one part of the text');
  }
  return r;
}

/** The source spans of all text nodes inside an element, from parse5's source locations (the bytes). */
export function textSpans(el) {
  const out = [];
  for (const stack = [...(el.childNodes ?? [])]; stack.length;) {
    const n = stack.pop();
    if (n.nodeName === '#text' && n.sourceCodeLocation) out.push([n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset]);
    stack.push(...(n.childNodes ?? []));
    if (n.content) stack.push(...n.content.childNodes);
  }
  return out;
}

/** The refusal kind of a server error, by the server's named errors (contract, A.7). */
export function refusalKind(text) {
  const m = text.replace(/^html_change: /, '');
  if (/^the new HTML changes the document outside the element$/.test(m)) return 'outside';
  if (/^the element has no end tag in the file/.test(m)) return 'noend';
  if (/^the text is inside a \w+ element, whose text the tool cannot change$/.test(m)) return 'rawtext';
  if (/^the text cannot be mapped to its bytes in the file$/.test(m)) return 'nomap';
  if (/^the old text starts or ends inside one character reference/.test(m)) return 'refbound';
  if (/line break, which the parser drops$/.test(m)) return 'linebreak';
  if (/^the result nests elements deeper than 512 levels$/.test(m)) return 'depth';
  return null;
}

/**
 * Every text node of a target, in document order, with its source bytes and value: the oracle picks the one it
 * finds in html5lib's tree, and takes only its source from here (review, 8). No visibility rule of the server is used.
 */
export function candidatesOf(f, ref) {
  const out = [];
  for (const stack = [...f.m.els[ref].childNodes].reverse(); stack.length;) {
    const n = stack.pop();
    if (n.nodeName === '#text') {
      const l = n.sourceCodeLocation;
      if (l) out.push({ src: f.text.slice(l.startOffset, l.endOffset), value: n.value });
      continue;
    }
    for (const c of [...(n.childNodes ?? [])].reverse()) stack.push(c);
  }
  return out;
}

/** The oracle's job for the changes: C0.1's verdict fields, the result or the refusal, and the node for replace_text. */
export function checkJob(entries, changes, outcomes) {
  const tokenHash = (t) => sha256(JSON.stringify(tokens(parseDoc(t))));
  const byName = new Map(entries.map((f) => [f.name, f]));
  const job = { files: Object.fromEntries(entries.map((f) => [f.name, f.text])), changes: [] };
  for (const ch of changes) {
    const o = outcomes.get(ch.id);
    // A result that is not valid UTF-8 fails without the oracle (`reasons`); it has no text to parse.
    if (!o || (o.accepted && o.invalidUtf8)) continue;
    const f = byName.get(ch.file);
    const range = rangeOf(f, ch.ref);
    if (!range) { job.changes.push({ id: ch.id, file: f.name, ref: ch.ref, ns: f.m.els[ch.ref].namespaceURI, tag: f.m.els[ch.ref].tagName, s: null }); continue; }
    const [s, e] = range;
    const t = f.text;
    const own = t.slice(s, e);
    const intended = ch.op === 'remove' ? '' : ch.op === 'replace' ? ch.args.html : ch.op === 'insert_after' ? own + ch.args.html : own;
    const html = o.accepted ? o.after.slice(s, o.after.length - (t.length - e)) : intended;
    const el = f.m.els[ch.ref];
    const entryOf = { id: ch.id, file: f.name, ref: ch.ref, ns: el.namespaceURI, tag: el.tagName, s: codePoints(t, s), e: codePoints(t, e), html,
      parse5Marked: tokenHash(t.slice(0, s) + markerSource(el, 'data-oracle-mark', '1') + t.slice(e)), parse5Spliced: tokenHash(t.slice(0, s) + html + t.slice(e)),
      op: ch.op, args: ch.args ?? {} };
    if (o.accepted) entryOf.result = o.after;
    else {
      entryOf.result = null;
      entryOf.reason = refusalKind(o.text);
      if (ch.op === 'replace_text') entryOf.candidates = candidatesOf(f, ch.ref);
    }
    job.changes.push(entryOf);
  }
  return job;
}

// --- The verdict -----------------------------------------------------------------------------------------------------

/** The reasons a change fails; an empty list passes (contract, A.6, A.7 and A.9). */
export function reasons(f, ch, o, v) {
  const r = [];
  if (!o) return ['the server gave no outcome'];
  if (v?.error) r.push(`the oracle stopped (${v.error})`);
  if (ch.kind === 'no-range') {
    if (o.accepted) r.push('accepted an element with no clean range');
    else if (!/^html_change: @\d+ has (no source bytes; the parser created it|no clean range in the file)$/.test(o.text)) r.push('refused with another error');
    if (!o.unchanged) r.push('the file changed');
    if (v && v.markerOk) r.push('the oracle finds the range exact');
    return r;
  }
  const expect = ch.expect ?? 'accept';
  // A fixed case that expects a refusal is judged by its named error and the unchanged file only: a locator case has
  // no target ref of its own (contract, A.9).
  if (expect !== 'accept') {
    if (o.accepted) return [`accepted, but the case expects the refusal "${expect}"`];
    if (!o.unchanged) r.push('refused, but the file changed');
    const msg = o.text.replace(/^html_change: /, '');
    if (!EXPECT[expect].test(msg)) r.push(`refused with another error than the case's "${expect}"`);
    // An ambiguous name lists each match by its ref, then the file's hash (contract, A.9; review, 6).
    if (ch.matches) {
      const lines = msg.split('\n');
      for (const ref of ch.matches) if (!lines.some((l) => new RegExp(`^ *@${ref} `).test(l))) r.push(`the list of matches lacks @${ref}`);
      if (lines.at(-1) !== `hash ${hashOf(f.bytes)}`) r.push('the list of matches does not end with the file\'s hash');
    }
    return r;
  }
  if (o.invalidUtf8) return ['the result is not valid UTF-8'];
  if (!v || !v.tagOk) r.push('the oracle finds another element at the ref');
  if (v && !v.markerOk) r.push('the range does not hold exactly the element');
  if (o.accepted) {
    r.push(...byteReasons(f, ch, o.after));
    const note = /^ok; changed @(\d+) [^;]+; hash ([0-9a-f]{16})$/.exec(o.text);
    if (!note) r.push('the reply is not "ok; changed @n tag; hash H"');
    else {
      if (Number(note[1]) !== ch.ref) r.push('the server changed another element than the target');
      if (note[2] !== o.afterHash) r.push('the returned hash is not the hash of the result');
    }
    if (ch.op === 'remove' || ch.op === 'replace') { if (v?.kept !== true) r.push('accepted, but the tree outside the element changed'); }
    else if (v?.opOk !== true) r.push(`accepted, but html5lib's tree is not the original with the ${ch.op}`);
    if (ch.expectedSha256 && o.afterSha256 !== ch.expectedSha256) r.push('the result is not the task\'s expected file');
  } else {
    if (!o.unchanged) r.push('refused, but the file changed');
    if (o.byRefText !== undefined && o.byRefText !== o.text) r.push('the locator\'s refusal is not the refusal of the same change by ref');
    const kind = refusalKind(o.text);
    if (!kind) r.push('refused with a reason that is not on the closed list');
    else if (kind === 'noend') { const [s, e] = rangeOf(f, ch.ref); const el = f.m.els[ch.ref]; if (new RegExp(`</${el.tagName}\\s*>$`, 'i').test(f.text.slice(s, e)) || VOID.has(el.tagName)) r.push('refused for no end tag, but the range ends with one'); }
    else if (v?.confirmed !== true) r.push(`refused (${kind}), but the oracle does not confirm the reason`);
  }
  return r;
}

/** Judges every change; returns the failures. */
export function judge(entries, changes, outcomes, verdicts) {
  const byName = new Map(entries.map((f) => [f.name, f]));
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const failures = [];
  for (const ch of changes) {
    if (ch.skipped) continue;
    const r = reasons(byName.get(ch.file), ch, outcomes.get(ch.id), byId.get(ch.id));
    if (r.length) failures.push({ id: ch.id, file: ch.file, ref: ch.ref, op: ch.op, locator: ch.locator ? Object.keys(ch.locator).join('+') : 'ref', reasons: r });
  }
  return failures;
}

// --- The run ---------------------------------------------------------------------------------------------------------

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const CODE = ['server', 'experiments/c01', 'experiments/c02/oracle_c02.py', 'experiments/c03/mcp-tools.json', 'experiments/c05/draw-files.mjs', 'tests/gates/v2-cases.mjs'];

/** The case files and their changes (contract, A.9). */
export function caseChanges() {
  const entries = [];
  const changes = [];
  CASES.forEach((c, i) => {
    const f = entry(`case-${i + 1}.html`, Buffer.from(c.html, 'utf8'));
    entries.push(f);
    let ref = null;
    if (c.target) ref = f.m.els.filter((e) => e.tagName === c.target.tag)[c.target.nth].ref;
    else ref = f.m.els.find((e) => e.tagName === 'body')?.ref ?? 0;
    const matches = c.matches ? f.m.els.filter((e) => e.tagName === c.matches.tag).map((e) => e.ref) : null;
    changes.push({ id: `case:${i + 1}`, kind: 'case', name: c.name, file: f.name, ref, op: c.args.operation, args: Object.fromEntries(Object.entries(c.args).filter(([k]) => k !== 'operation')),
      locator: c.locator ?? null, expect: c.expect, control: c.control ?? null, matches });
  });
  return { entries, changes };
}

/**
 * The count of a control's own failures: those that the real server does not have, and not an internal error of the
 * changed copy (review, 7). A fixed case that names the control must be among them.
 */
export function controlResult(name, failures, base, outcomes, changes) {
  const baseIds = new Set(base.map((x) => x.id));
  const own = failures.filter((x) => !baseIds.has(x.id) && !/internal error/.test(outcomes.get(x.id)?.text ?? ''));
  const named = changes.filter((c) => c.control === name).map((c) => c.id);
  const caseFailed = named.length ? named.every((id) => own.some((x) => x.id === id)) : null;
  return { failures: own.length, caseFailed, ok: own.length > 0 && caseFailed !== false };
}

async function main() {
  const dev = process.argv.includes('--dev');
  // The commit and the clean tree are checked at the start, and again at the end (review, 15).
  const startCommit = git('rev-parse', 'HEAD');
  if (!dev && git('status', '--porcelain', '--', ...CODE)) throw new Error('the gate run needs committed code: commit first, or use --dev');
  if (!existsSync(PYTHON)) throw new Error('the oracle is not installed (.venv-oracle/)');
  const html5lib = execFileSync(PYTHON, ['-I', '-B', '-c', 'import html5lib; print(html5lib.__version__)'], { encoding: 'utf8' }).trim();
  if (html5lib !== '1.1') throw new Error(`the oracle needs html5lib 1.1; it has ${html5lib}`);
  // The parser-only rule on the 3 oracle files, with a positive control (review, 14).
  const oracleFiles = ['experiments/c01/oracle.py', 'experiments/c01/oracle_v2.py', 'experiments/c02/oracle_c02.py'];
  const names = oracleFiles.flatMap((p) => forbiddenNames(readFileSync(at(p), 'utf8')));
  const controlFinds = forbiddenNames(readFileSync(at('experiments/c01/oracle_v2.py'), 'utf8') + '\nfrom html5lib.serializer import serialize\n');

  // 1. The files: C0.1's 16 (the 10 picks and the same 6 copies), and the fixed cases.
  const { files, tasks } = gateFiles();
  const originals = files.map((f) => entry(`${f.number}.html`, f.bytes));
  const rnd0 = generator(SEED_C01);
  const chosen = [];
  while (chosen.length < 2) { const i = rnd0(originals.length); if (!chosen.includes(i)) chosen.push(i); }
  const copies = chosen.flatMap((i) => Object.entries(copiesOf(originals[i].text)).map(([k, t]) => entry(`${files[i].number}-${k}.html`, Buffer.from(t, 'utf8'))));
  const gate = [...originals, ...copies];
  const cases = caseChanges();
  const entries = [...gate, ...cases.entries];

  // 2. The oracle's facts, and the check that its numbering is the server's.
  const facts = oracle('facts', { files: Object.fromEntries(entries.map((f) => [f.name, f.text])) });
  const models = new Map();
  for (const f of entries) {
    const fx = facts[f.name];
    if (fx.elements.length !== f.m.els.length || fx.elements.some((x, k) => x.tag !== f.m.els[k].tagName)) throw new Error(`${f.name}: html5lib's elements are not the server's`);
    models.set(f.name, textModel(fx));
  }

  // 3. The changes: the task set's, the random ones, the elements with no clean range, the fixed cases.
  const byPath = new Map(files.map((f, i) => [f.path, originals[i]]));
  const changes = tasks.filter((t) => t.type !== 'question').map((t) => taskChange(t, byPath.get(t.file)));
  changes.push(...randomChanges(gate, models, generator(SEED)));
  for (const f of gate) for (const ref of noRangeRefs(f.m)) changes.push({ id: `no-range:${f.name}@${ref}`, kind: 'no-range', file: f.name, ref, op: 'remove', args: {} });
  changes.push(...cases.changes);

  // 4. The server, the oracle's checks, the verdict, then the negative controls.
  const outcomes = await serverOutcomes(at('server/main.mjs'), entries, changes);
  const verdicts = oracle('check', checkJob(entries, changes, outcomes)).changes;
  const failures = judge(entries, changes, outcomes, verdicts);
  const controls = {};
  const mutants = path.join(at('experiments/gate-files'), 'c01v2-mutants');
  rmSync(mutants, { recursive: true, force: true });
  try {
    for (const name of Object.keys(MUTANTS)) {
      const out = await serverOutcomes(mutantServer(name, mutants), entries, changes);
      const v = oracle('check', checkJob(entries, changes, out)).changes;
      controls[name] = controlResult(name, judge(entries, changes, out, v), failures, out, changes);
    }
  } finally {
    rmSync(mutants, { recursive: true, force: true });
  }

  // 5. The minimum, and the result.
  const random = changes.filter((c) => c.kind === 'random' && !c.skipped);
  const accepted = Object.fromEntries(OPS.map((op) => [op, random.filter((c) => c.op === op && outcomes.get(c.id)?.accepted).length]));
  const refusals = {};
  for (const c of random) { const o = outcomes.get(c.id); if (o && !o.accepted) { const k = refusalKind(o.text) ?? 'other'; refusals[`${c.op}: ${k}`] = (refusals[`${c.op}: ${k}`] ?? 0) + 1; } }
  const minimumOk = OPS.every((op) => accepted[op] >= MIN_ACCEPTED);
  if (git('rev-parse', 'HEAD') !== startCommit) throw new Error('HEAD moved during the run: run again');
  if (!dev && git('status', '--porcelain', '--', ...CODE)) throw new Error('the code changed during the run: run again');
  const passed = failures.length === 0 && names.length === 0 && controlFinds.length > 0 && Object.values(controls).every((c) => c.ok);
  const result = {
    gate: 'C0.1 v2', date: new Date().toISOString().slice(0, 10), commit: startCommit, dev, node: process.version,
    parse5: JSON.parse(readFileSync(at('node_modules/parse5/package.json'), 'utf8')).version,
    python: execFileSync(PYTHON, ['-I', '-B', '-c', 'import sys, html5lib; print(sys.version.split()[0], html5lib.__version__)'], { encoding: 'utf8' }).trim(),
    seed: SEED, random: RANDOM, parserOnly: { files: oracleFiles, forbiddenNames: names, controlFinds },
    files: gate.map((f) => ({ name: f.name, sha256: sha256(f.bytes), refs: f.m.els.length })),
    changes: {
      task: changes.filter((c) => c.kind === 'task').length, random: random.length, skipped: changes.filter((c) => c.skipped).length,
      noRange: changes.filter((c) => c.kind === 'no-range').length, cases: cases.changes.length,
      randomByOp: Object.fromEntries(OPS.map((op) => [op, random.filter((c) => c.op === op).length])), acceptedByOp: accepted,
      byLocator: Object.fromEntries(['ref', 'text+tag', 'text', 'id', 'id+child+n'].map((k) => [k, random.filter((c) => (c.locator ? Object.keys(c.locator).join('+') : 'ref') === k).length])),
      refusals,
    },
    parsersDisagree: verdicts.filter((v) => v.spliceAgree === false).map((v) => v.id),
    failures, controls, minimumOk,
    // FAIL first: a missed minimum must not hide a failure (review, 5).
    verdict: !passed ? 'FAIL' : minimumOk ? 'PASS' : 'NO VERDICT (minimum not reached)',
  };
  const json = JSON.stringify(result, null, 1) + '\n';
  const out = dev ? path.join(tmpdir(), 'hir-c01-v2-dev-result.json') : at('experiments/c01/c01-v2-result.json');
  writeFileSync(out, json);
  console.log(`C0.1 v2 ${result.verdict}: ${failures.length} failures in ${changes.length} changes; accepted ${JSON.stringify(accepted)}; controls ${JSON.stringify(controls)}`);
  if (dev) console.log(`dev result: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`C0.1 v2: ${e.stack ?? e.message}`); process.exit(1); });
}
