// The gate C0.3 prototype: the outputs of html_outline, html_find and html_read, made from the definitions in
// docs/contract.md with parse5 (amendment "C0.3 first"). It writes no file. A deliberately simple first pass: it is
// the reference that a real server must match, not the server.
import { parse } from 'parse5';
import { createHash } from 'node:crypto';

export const DROP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta']);
export const KEEP_ATTR = new Set(('id href src alt title type name value placeholder for role aria-label action ' +
  'method lang checked selected disabled required colspan rowspan').split(' '));
const NOT_VISIBLE = new Set(['script', 'style', 'svg', 'template', 'noscript']);
export const PAGE_CHARS = 60_000; // stand-in for 20,000 tokens a page (at least 3 characters a token)
const WS = /[ \t\n\f\r]+/g;

export const norm = (s) => s.replace(WS, ' ');
export const hashOf = (src) => createHash('sha256').update(src, 'utf8').digest('hex').slice(0, 16);

/** The closed list of hidden content in docs/contract.md (C0.2). */
export function isHidden(el) {
  const a = Object.fromEntries((el.attrs ?? []).map((x) => [x.name, x.value]));
  if ('hidden' in a) return true;
  if ((a['aria-hidden'] ?? '').toLowerCase() === 'true') return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? '')) return true;
  if (el.tagName === 'input' && (a.type ?? '').toLowerCase() === 'hidden') return true;
  return el.tagName === 'template';
}

/** Parses a file and gives each element its ref (preorder number over all elements) and its outline line. */
export function load(src) {
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const els = [];
  const parent = new Map();
  const walk = (n) => {
    if (n.tagName) { n.ref = els.length; els.push(n); }
    for (const c of n.childNodes ?? []) { parent.set(c, n); walk(c); }
  };
  walk(doc);
  const vt = new Map(); // visible text of each element
  const visible = (n) => {
    if (n.nodeName === '#text') return n.value;
    if (!n.tagName && n.nodeName !== '#document') return '';
    if (n.tagName && (NOT_VISIBLE.has(n.tagName) || isHidden(n))) { vt.set(n, ''); return ''; }
    const s = (n.childNodes ?? []).map(visible).join('');
    if (n.tagName) vt.set(n, norm(s));
    return s;
  };
  visible(doc);
  // The outline: kept elements and text, one per line, one space of indent per level.
  const lines = [];
  const lineOf = new Map();
  const shown = new Set();
  const out = (n, d) => {
    for (const c of n.childNodes ?? []) {
      if (c.nodeName === '#text') {
        const t = norm(c.value).trim();
        if (t) lines.push(' '.repeat(d) + '| ' + escapeText(t));
        continue;
      }
      if (!c.tagName || DROP.has(c.tagName) || isHidden(c)) continue;
      const line = ' '.repeat(d) + head(c);
      lines.push(line);
      lineOf.set(c.ref, line);
      shown.add(c);
      if (c.tagName !== 'svg') out(c, d + 1);
    }
  };
  out(doc, 0);
  return { src, doc, els, parent, vt, lines, lineOf, shown, hash: hashOf(src) };
}

const escapeText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function fmtValue(v) {
  if (/^data:/i.test(v) && v.length > 100) return `data:…(${v.length} chars)`;
  // A line break would start a new outline line that could look like an element with a ref (review, 2026-11-11).
  const safe = v.replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
  return /^[^\s()"']+$/.test(safe) ? safe : `"${safe.replace(/"/g, '&quot;')}"`;
}
function head(el) {
  const id = el.attrs.find((a) => a.name === 'id')?.value;
  const attrs = el.attrs.filter((a) => a.name !== 'id' && KEEP_ATTR.has(a.name))
    .map((a) => (a.value === '' ? a.name : `${a.name}=${fmtValue(a.value)}`));
  const idPart = id && /^[^\s()"'#]+$/.test(id) ? '#' + id : '';
  if (id && !idPart) attrs.unshift(`id=${fmtValue(id)}`);
  return `@${el.ref} ${el.tagName}${idPart}${attrs.length ? '(' + attrs.join(' ') + ')' : ''}`;
}

/** html_outline: all pages (each at most PAGE_CHARS characters), each with a header. */
export function outlinePages(m) {
  const pages = [];
  let cur = [];
  let size = 0;
  for (const l of m.lines) {
    if (size + l.length + 1 > PAGE_CHARS && cur.length) { pages.push(cur); cur = []; size = 0; }
    cur.push(l);
    size += l.length + 1;
  }
  if (cur.length) pages.push(cur);
  return pages.map((p, i) => `page ${i + 1} of ${pages.length}; hash ${m.hash}\n${p.join('\n')}`);
}

/** html_find: the deepest shown elements whose visible text contains `text`; their lines and their ancestors' lines. */
export function find(m, text) {
  if (!text) throw new Error('html_find: the search text is empty');
  const hit = (e) => m.shown.has(e) && (m.vt.get(e) ?? '').includes(text);
  const matches = m.els.filter((e) => hit(e) && !m.els.some((c) => m.parent.get(c) === e && hit(c)));
  const refs = new Set();
  for (const e of matches.slice(0, 20)) {
    for (let p = e; p && p.tagName; p = m.parent.get(p)) if (m.lineOf.has(p.ref)) refs.add(p.ref);
  }
  const body = [...refs].sort((a, b) => a - b).map((r) => m.lineOf.get(r)).join('\n');
  return { matches, text: `${body}\n${matches.length} matches; hash ${m.hash}` };
}

/** html_read: the original bytes of one element. */
export function read(m, el) {
  const l = el.sourceCodeLocation;
  return m.src.slice(l.startOffset, l.endOffset);
}
