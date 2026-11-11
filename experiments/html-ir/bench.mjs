// NOT timed. Size comparison and round-trip check for the HIR POC.
// Usage: node experiments/html-ir/bench.mjs <folder with .html files>... [--json <file>]
//
// Token counts are PROXIES, not Claude's tokenizer. Each counts the chunks of a pre-tokenizer regex:
//   A: a GPT-2-style split (" ?" before letters).  B: the cl100k-style split (one non-letter can join the letters).
// A real BPE count can be higher or lower than either: BPE splits long chunks, and its rules differ by model.
// Two proxies show how much the result depends on the split.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, relative, isAbsolute } from 'node:path';
import { parse, canon, toHTML, encode, decode, view, number, key, DROP_EL, KEEP_ATTR } from './ir.mjs';

const SPLIT_A = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
const SPLIT_B = /'(?:[sdmtSDMT]|ll|ve|re|LL|VE|RE)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
export const tok = (s) => (s.match(SPLIT_A) ?? []).length;
export const tokB = (s) => (s.match(SPLIT_B) ?? []).length;

// The text an agent needs once per session to read and write HIR.
export const PRIMER = `HIR = compact HTML. One node per line; 1 space of indent per level = nesting; no closing tags.
tag#id{class list}(attr=v attr2="v w" bool) text — div is implied when a line starts with # or {.
Text after the head is inline HTML (<b>, <em>). "| text" = text line. "// x" = comment. "!doctype html".
"tag." then deeper lines = verbatim content (script, style, pre, textarea). "@12" = element ref (views only).`;

// Removes one kind of content, to split the view's saving by cause.
function strip(node, kind) {
  if (!node.children) return node;
  const kids = [];
  for (const c of node.children) {
    if (kind === 'comments' && c.type === 'comment') continue;
    if (c.type !== 'el') { kids.push(c); continue; }
    if (kind === 'elements' && DROP_EL.has(c.tag)) continue;
    let e = c;
    if (kind === 'svg' && c.tag === 'svg') e = { ...c, children: [] };
    if (kind === 'class') e = { ...e, attrs: e.attrs.filter(([k]) => k !== 'class') };
    if (kind === 'attrs') e = { ...e, attrs: e.attrs.filter(([k]) => k === 'class' || KEEP_ATTR.has(k)) };
    kids.push(strip(e, kind));
  }
  return { ...node, children: kids };
}

export function measure(html) {
  const tree = canon(parse(html));
  const min = toHTML(tree);
  const hir = encode(tree);
  const back = decode(hir);
  const roundTrip = key(canon(parse(toHTML(back)))) === key(tree) ? 'PASS' : 'FAIL';
  const idempotent = encode(canon(back)) === hir;
  const v = canon(view(number(canon(parse(html)))));
  const forms = { min, hir, viewHtml: toHTML(v), viewHir: encode(v), viewHirRefs: encode(v, { refs: true }) };
  const tokens = {}, tokensB = {};
  for (const [k, s] of Object.entries(forms)) { tokens[k] = tok(s); tokensB[k] = tokB(s); }
  const removed = {};
  for (const kind of ['elements', 'svg', 'class', 'attrs', 'comments']) {
    removed[kind] = tokens.hir - tok(encode(canon(strip(tree, kind))));
  }
  return { bytes: Buffer.byteLength(html), tokens, tokensB, removed, roundTrip, idempotent };
}

const pct = (a, ref) => (ref ? `${a > ref ? '+' : ''}${(((a - ref) / ref) * 100).toFixed(1)}%` : 'n/a');
const line = (t) => `minified ${t.min}  HIR ${t.hir} (${pct(t.hir, t.min)})  view HTML ${t.viewHtml} (${pct(t.viewHtml, t.min)})` +
  `  view HIR ${t.viewHir} (${pct(t.viewHir, t.min)})  view HIR+refs ${t.viewHirRefs} (${pct(t.viewHirRefs, t.min)})`;

if (process.argv[1] && basename(process.argv[1]) === 'bench.mjs') {
  const args = process.argv.slice(2);
  const ji = args.indexOf('--json');
  const jsonOut = ji >= 0 ? args.splice(ji, 2)[1] : null;
  if (ji >= 0 && !jsonOut) throw new Error('bench: --json needs a file name');
  if (!args.length) throw new Error('bench: name one or more folders that hold .html files');
  const files = [];
  const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).forEach((f) => walk(join(p, f))) : p.endsWith('.html') && files.push(p));
  args.forEach(walk);
  console.log(`Primer (once per session): ${tok(PRIMER)} tokens (proxy A), ${tokB(PRIMER)} (proxy B)\n`);
  const results = [];
  const total = {}, totalB = {};
  for (const f of files.sort()) {
    // The results hold relative paths only, so that no user or machine name reaches a committed file.
    const name = relative(process.cwd(), f).replace(/\\/g, '/');
    if (isAbsolute(name) || name.startsWith('..')) throw new Error(`bench: ${f} is outside the current folder`);
    let r;
    try {
      r = measure(readFileSync(f, 'utf8'));
    } catch (e) {
      // Keep only the kind of error: the message can quote text from a third-party page.
      results.push({ file: name, error: e.message.split(':')[0] });
      console.log(`${name}  ERROR ${e.message.split(':')[0]}`);
      continue;
    }
    results.push({ file: name, ...r });
    for (const [k, v] of Object.entries(r.tokens)) total[k] = (total[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.tokensB)) totalB[k] = (totalB[k] ?? 0) + v;
    console.log(`${name}  ${r.bytes} B  round trip ${r.roundTrip}  idempotent ${r.idempotent}`);
    console.log(`  A: ${line(r.tokens)}\n  B: ${line(r.tokensB)}`);
    console.log(`  removed by the view (A), share of HIR: ` + Object.entries(r.removed).map(([k, v]) => `${k} ${pct(r.tokens.hir - v, r.tokens.hir)}`).join('  '));
  }
  console.log(`\nTotal A: ${line(total)}\nTotal B: ${line(totalB)}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ primerTokens: { A: tok(PRIMER), B: tokB(PRIMER) }, total, totalB, results }, null, 2) + '\n');
}
