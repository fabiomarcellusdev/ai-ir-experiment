// NOT a gate run. Corrected proxy estimate of gate C0.3 on the POC's files (excluded from the gate's file set).
// Usage: node check3.mjs <seeds> <folder>...   Writes raw values as JSON to stdout's last line when RAW=1.
// Follows the gate's paths as closely as the POC code allows:
//   B1: whole file through Read (2,000 lines a call, line-number prefix, lines cut at 2,000 characters).
//   B2: Grep output (matched lines with numbers) + one Read of all matched lines with 20 lines before and after.
//       Valid only when the quote is in at least one raw line. No shorter fallback quote.
//   M1: whole outline with refs + the node.  M2: html_find output (deepest matches, union of ancestor lines) + node.
//       M2 is valid only when the target is among the first 20 matches.
//   Each path adds its arm's tool definitions and its edit payload (B: old and new string; M: the new node).
//   The node is the canonical node's HTML, not the original bytes (the POC has no source positions).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse, canon, encode, view, number, toHTML } from './ir.mjs';
import { tok } from './bench.mjs';
import { B_READ, B_EDIT, GREP, GLOB, M_TOOLS } from './tooldefs.mjs';

const DEF_B = tok(B_READ + B_EDIT + GREP + GLOB);
const DEF_M = tok(GREP + GLOB + M_TOOLS);
const SKIP = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head']);
const vtext = (n) => (n.type === 'text' ? n.value : n.type === 'el' && SKIP.has(n.tag) ? '' : (n.children ?? []).map(vtext).join(''));
const norm = (s) => s.replace(/[ \t\n\f\r]+/g, ' ').trim();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const numbered = (lines, from) => lines.map((l, k) => `${String(from + k + 1).padStart(6)}\t${l.slice(0, 2000)}`).join('\n');

const [seeds, ...roots] = process.argv.slice(2);
console.log(`tool definitions, proxy tokens: B ${DEF_B}, M ${DEF_M}`);
const raw = [];
for (const root of roots) {
  for (const f of readdirSync(root, { recursive: true }).filter((x) => x.endsWith('.html')).sort()) {
    const src = readFileSync(join(root, f), 'utf8').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    const full = number(canon(parse(src)));
    const outline = encode(canon(view(full)), { refs: true });
    const lineOf = new Map();
    for (const l of outline.split('\n')) { const m = /^ *@(\d+) /.exec(l); if (m) lineOf.set(+m[1], l); }
    const parent = new Map();
    const els = [];
    const walk = (n, inBody) => {
      if (n.type === 'el') {
        if (SKIP.has(n.tag)) return;
        if (n.tag === 'body') inBody = true;
        if (inBody && norm(vtext(n)).split(' ').length >= 3) els.push(n);
      }
      for (const c of n.children ?? []) { if (c.type === 'el') parent.set(c, n); walk(c, inBody); }
    };
    walk(full, false);
    let wholeB = 0;
    for (let s = 0; s < lines.length; s += 2000) wholeB += tok(numbered(lines.slice(s, s + 2000), s));
    const outlineT = tok(outline);
    const perSeed = { m1: [], best: [] };
    for (let sd = 0; sd < +seeds; sd++) {
      let seed = 20261110 + sd;
      const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % n; };
      const r1 = [], rBest = [];
      for (let t = 0; t < 20 && els.length; t++) {
        const el = els[rnd(els.length)];
        const quote = norm(vtext(el)).split(' ').slice(0, 6).join(' ');
        const node = toHTML(el);
        const editB = 2 * tok(quote) + 20;
        const editM = tok(node) + 20;
        // B
        const hits = [];
        lines.forEach((l, k) => { if (l.includes(quote)) hits.push(k); });
        let b = wholeB;
        if (hits.length) {
          const keep = new Set();
          for (const h of hits) for (let k = Math.max(0, h - 20); k <= Math.min(lines.length - 1, h + 20); k++) keep.add(k);
          const slice = [...keep].sort((x, y) => x - y).map((k) => `${String(k + 1).padStart(6)}\t${lines[k].slice(0, 2000)}`).join('\n');
          const grepOut = hits.map((k) => `${k + 1}:${lines[k].slice(0, 2000)}`).join('\n');
          b = Math.min(wholeB, tok(grepOut) + tok(slice));
        }
        b += DEF_B + editB;
        // M1
        const m1 = DEF_M + outlineT + tok(node) + editM;
        // M2: deepest elements whose visible text contains the quote
        const matches = els.filter((e) => norm(vtext(e)).includes(quote));
        const isAncestor = (a, d) => { for (let p = parent.get(d); p; p = parent.get(p)) if (p === a) return true; return false; };
        const deepest = matches.filter((e) => !matches.some((o) => o !== e && isAncestor(e, o)));
        let m2 = Infinity;
        if (deepest.slice(0, 20).includes(el)) {
          const out = new Set();
          for (const d of deepest.slice(0, 20)) {
            const chain = [];
            for (let p = d; p && p.type === 'el'; p = parent.get(p)) if (lineOf.has(p.ref)) chain.push(p.ref);
            chain.reverse().forEach((r) => out.add(r));
          }
          const findOut = [...out].sort((x, y) => x - y).map((r) => lineOf.get(r)).join('\n') + `\n${deepest.length} matches, hash 0123456789abcdef`;
          m2 = DEF_M + tok(findOut) + tok(node) + editM;
        }
        r1.push(m1 / b);
        rBest.push(Math.min(m1, m2) / b);
        raw.push({ file: f, seed: 20261110 + sd, task: t, b, m1, m2: Number.isFinite(m2) ? m2 : null, grepHit: hits.length > 0 });
      }
      perSeed.m1.push(med(r1));
      perSeed.best.push(med(rBest));
    }
    const pass = (a) => `${Math.round((100 * a.filter((x) => x <= 0.5).length) / a.length)}%`;
    console.log(`${f.padEnd(24)} ${String(Math.round(src.length / 1000)).padStart(4)} KB  outline only: median ${med(perSeed.m1).toFixed(2)} ` +
      `[${Math.min(...perSeed.m1).toFixed(2)}–${Math.max(...perSeed.m1).toFixed(2)}] pass ${pass(perSeed.m1)}   ` +
      `cheaper of outline and find: median ${med(perSeed.best).toFixed(2)} [${Math.min(...perSeed.best).toFixed(2)}–${Math.max(...perSeed.best).toFixed(2)}] pass ${pass(perSeed.best)}`);
  }
}
if (process.env.RAW) console.log(JSON.stringify(raw));
