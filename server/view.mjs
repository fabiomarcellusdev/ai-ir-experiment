// The reading view: parse, refs, clean ranges, html_outline, html_find and html_read (decision 0006, "The view").
// It starts from the prototype experiments/c03/html.mjs, which stays frozen. The outputs equal the prototype's
// outputs, except where a safety fix changes a line. This module does no file access.
import { parse, serialize } from 'parse5';
import { fail } from './errors.mjs';

export const DROP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta']);
export const KEEP_ATTR = new Set(('id href src alt title type name value placeholder for role aria-label action ' +
  'method lang checked selected disabled required colspan rowspan').split(' '));
const NOT_VISIBLE = new Set(['script', 'style', 'svg', 'template', 'noscript']);
/** A page of html_outline: at most 60,000 characters, a stand-in for 20,000 tokens (as the prototype). */
export const PAGE_CHARS = 60_000;
/** The deepest element the server accepts. html and body count as levels. */
export const MAX_DEPTH = 512;
const MAX_MATCHES = 20;

const WS = /[ \t\n\f\r]+/g;
const norm = (s) => s.replace(WS, ' ');
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
// Control characters and every character that a reader can take as a line break (safety fix 1). Text has its
// ASCII whitespace collapsed before this escape; attribute values have CR, LF and tab escaped first, as the prototype.
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;
const escUnsafe = (s) => s.replace(UNSAFE, (c) => `&#x${c.charCodeAt(0).toString(16)};`);

/** The longest output line, after its indent. A longer line is cut, and its length is named (security review F3). */
export const LINE_CAP = 10_000;
const capLine = (s) => {
  if (s.length <= LINE_CAP) return s;
  const end = /[\uD800-\uDBFF]/.test(s[LINE_CAP - 1]) ? LINE_CAP - 1 : LINE_CAP;
  return `${s.slice(0, end)}…(${s.length} chars)`;
};

/**
 * The CSS text of an inline style as the browser reads it: comments removed and escapes decoded (security review
 * F4). Linear: no regular expression with a lazy or nested quantifier.
 */
export function cssPlain(css) {
  let out = '';
  for (let i = 0; i < css.length;) {
    const open = css.indexOf('/*', i);
    if (open === -1) { out += css.slice(i); break; }
    out += css.slice(i, open);
    const close = css.indexOf('*/', open + 2);
    if (close === -1) break; // An unclosed comment runs to the end.
    i = close + 2;
  }
  return out.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f\r]?|([^\n\r\f0-9a-fA-F]))/g, (_, hex, ch) => {
    if (ch !== undefined) return ch;
    const cp = parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
  });
}

/** The closed list of hidden content in docs/contract.md (C0.2). */
export function isHidden(el) {
  const a = Object.fromEntries((el.attrs ?? []).map((x) => [x.name, x.value]));
  if ('hidden' in a) return true;
  if ((a['aria-hidden'] ?? '').toLowerCase() === 'true') return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(cssPlain(a.style ?? ''))) return true;
  if (el.tagName === 'input' && (a.type ?? '').toLowerCase() === 'hidden') return true;
  return el.tagName === 'template';
}

const escapeText = (t) => escUnsafe(t.replace(/&/g, '&amp;').replace(/</g, '&lt;'));

export function fmtValue(v) {
  if (/^data:/i.test(v) && v.length > 100) return `data:…(${v.length} chars)`;
  const safe = escUnsafe(v.replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;'));
  return /^[^\s()"']+$/.test(safe) ? safe : `"${safe.replace(/"/g, '&quot;')}"`;
}

function head(el) {
  const id = el.attrs.find((a) => a.name === 'id')?.value;
  const attrs = el.attrs.filter((a) => a.name !== 'id' && KEEP_ATTR.has(a.name))
    .map((a) => (a.value === '' ? a.name : `${a.name}=${fmtValue(a.value)}`));
  const idPart = id && /^[^\s()"'#]+$/.test(id) ? '#' + escUnsafe(id) : '';
  if (id && !idPart) attrs.unshift(`id=${fmtValue(id)}`);
  return capLine(`@${el.ref} ${escTag(el.tagName)}${idPart}${attrs.length ? '(' + attrs.join(' ') + ')' : ''}`);
}

// A tag name can hold almost any character. Escape each one outside a plain set, so a tag name cannot show a fake
// ref, id or attribute list (security review F5).
export const escTag = (t) => t.replace(/[^A-Za-z0-9._:-]/gu, (c) => `&#x${c.codePointAt(0).toString(16)};`);

const kids = (n) => n.childNodes ?? [];

/**
 * Parses text as a browser does: a leading BOM is not content (review, finding 1). The source offsets stay offsets
 * of the full text, BOM included.
 * @param {string} text
 */
export function parseDoc(text) {
  if (!text.startsWith('﻿')) return parse(text, { sourceCodeLocationInfo: true });
  const doc = parse(text.slice(1), { sourceCodeLocationInfo: true });
  for (const stack = [doc]; stack.length;) {
    const n = stack.pop();
    const l = n.sourceCodeLocation;
    if (l) {
      for (const part of [l, l.startTag, l.endTag, ...Object.values(l.attrs ?? {})]) {
        if (part) { part.startOffset += 1; part.endOffset += 1; }
      }
    }
    stack.push(...kids(n));
    if (n.content) stack.push(n.content);
  }
  return doc;
}

/**
 * The depth of the deepest element; the html element is level 1. Template content counts: parse5's serializer
 * recurses into it (C0.1 review, finding 1). No recursion.
 */
export function depthOf(doc) {
  let max = 0;
  for (const stack = [[doc, 0]]; stack.length;) {
    const [n, d] = stack.pop();
    const k = n.tagName ? d + 1 : d;
    if (k > max) max = k;
    for (const c of kids(n)) stack.push([c, k]);
    if (n.content) for (const c of kids(n.content)) stack.push([c, k]);
  }
  return max;
}

/**
 * Parses a file's text. `hash` is the hash of the file's bytes.
 * @param {string} text @param {string} hash
 */
export function load(text, hash) {
  const doc = parseDoc(text);
  if (depthOf(doc) > MAX_DEPTH) fail(`the file nests elements deeper than ${MAX_DEPTH} levels`);

  // Refs: a preorder number over all elements outside template content, as the prototype. No recursion.
  const els = [];
  const parent = new Map();
  // The html element is level 1.
  for (const stack = [[doc, 1]]; stack.length;) {
    const [n, d] = stack.pop();
    if (n.tagName) {
      if (d > MAX_DEPTH) fail(`the file nests elements deeper than ${MAX_DEPTH} levels`);
      n.ref = els.length;
      els.push(n);
    }
    const c = kids(n);
    for (let i = c.length - 1; i >= 0; i--) {
      parent.set(c[i], n);
      stack.push([c[i], n.tagName ? d + 1 : d]);
    }
  }
  const hidden = new Set(els.filter(isHidden));

  // The outline: kept elements and text, one per line, one space of indent per level.
  const lines = [];
  const lineOf = new Map();
  const shown = new Set();
  for (const stack = kids(doc).map((c) => [c, 0]).reverse(); stack.length;) {
    const [c, d] = stack.pop();
    if (c.nodeName === '#text') {
      const t = norm(c.value).trim();
      if (t) lines.push(' '.repeat(d) + capLine('| ' + escapeText(t)));
      continue;
    }
    if (!c.tagName || DROP.has(c.tagName) || hidden.has(c)) continue;
    const line = ' '.repeat(d) + head(c);
    lines.push(line);
    lineOf.set(c.ref, line);
    shown.add(c);
    if (c.tagName !== 'svg') for (const k of [...kids(c)].reverse()) stack.push([k, d + 1]);
  }

  // Visible text: one string of all visible text in document order, with each element's span in it.
  const parts = [];
  let len = 0;
  const span = new Map();
  for (const stack = [[doc, false]]; stack.length;) {
    const [n, exit] = stack.pop();
    if (exit) { span.get(n)[1] = len; continue; }
    if (n.nodeName === '#text') { parts.push(n.value); len += n.value.length; continue; }
    if (!n.tagName && n.nodeName !== '#document') continue;
    if (n.tagName && (NOT_VISIBLE.has(n.tagName) || hidden.has(n))) { span.set(n, [len, len]); continue; }
    if (n.tagName) { span.set(n, [len, 0]); stack.push([n, true]); }
    const c = kids(n);
    for (let i = c.length - 1; i >= 0; i--) stack.push([c[i], false]);
  }
  const raw = parts.join('');
  // The normalized text, and the position in it of each raw position.
  const vis = norm(raw);
  const at = new Int32Array(raw.length + 1);
  let g = 0;
  for (let i = 0, inWs = false; i < raw.length; i++) {
    at[i] = g;
    const ws = isWs(raw.charCodeAt(i));
    if (!ws || !inWs) g++;
    inWs = ws;
  }
  at[raw.length] = g;

  return { text, hash, doc, els, parent, lines, lineOf, shown, span, raw, vis, at, ranges: rangesOf(doc) };
}

/** The value of `ranges` for an element whose range a marker parse must confirm (`exactRange`). */
const CHECK = 'check';

/**
 * The clean range of each located element (decision 0006, "A clean range"): its range holds the ranges of all its
 * located descendants (template content included), and no other located node starts inside it. When a located node
 * that is not an ancestor still meets the range, the value is CHECK.
 */
function rangesOf(doc) {
  const order = [];
  const up = [];
  for (const stack = [[doc, -1]]; stack.length;) {
    const [n, p] = stack.pop();
    const i = order.length;
    order.push(n);
    up.push(p);
    const c = [...kids(n), ...(n.content ? [n.content] : [])];
    for (let k = c.length - 1; k >= 0; k--) stack.push([c[k], i]);
  }
  const count = new Int32Array(order.length);
  const lo = new Float64Array(order.length).fill(Infinity);
  const hi = new Float64Array(order.length).fill(-Infinity);
  const starts = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const l = order[i].sourceCodeLocation;
    if (l) {
      count[i]++;
      lo[i] = Math.min(lo[i], l.startOffset);
      hi[i] = Math.max(hi[i], l.endOffset);
      starts.push(l.startOffset);
    }
    const p = up[i];
    if (p >= 0) {
      count[p] += count[i];
      lo[p] = Math.min(lo[p], lo[i]);
      hi[p] = Math.max(hi[p], hi[i]);
    }
  }
  starts.sort((a, b) => a - b);
  const ends = order.flatMap((n) => (n.sourceCodeLocation ? [n.sourceCodeLocation.endOffset] : [])).sort((a, b) => a - b);
  /** The number of values in a sorted list that are less than x. */
  const below = (list, x) => {
    let a = 0;
    let b = list.length;
    while (a < b) { const m = (a + b) >> 1; if (list[m] < x) a = m + 1; else b = m; }
    return a;
  };
  const clean = new Map();
  order.forEach((n, i) => {
    const l = n.tagName && n.sourceCodeLocation;
    if (!l) return;
    const s = l.startOffset;
    const e = l.endOffset;
    if (!(lo[i] >= s && hi[i] <= e && below(starts, e) - below(starts, s) === count[i])) return clean.set(n, false);
    // The located nodes whose range meets [s, e): all nodes, minus those that end at s or before, minus those that
    // start at e or after (C0.1 development run, 2026-11-11).
    const meets = starts.length - below(ends, s + 1) - (starts.length - below(starts, e));
    let ancestors = 0;
    for (let p = up[i]; p >= 0; p = up[p]) {
      const pl = order[p].sourceCodeLocation;
      if (pl && pl.startOffset < e && pl.endOffset > s) ancestors++;
    }
    // Another node meets the range. Text that the parser fosters out of a table joins a text node outside the
    // element, and that node's range then spans the element; an element fostered out of a table lies inside the
    // table's range. A marker parse decides (`exactRange`).
    clean.set(n, meets === count[i] + ancestors ? true : CHECK);
  });
  return clean;
}

export const pageCount = (m) => paginate(m).length || 1;

function paginate(m) {
  if (m.pages) return m.pages;
  const pages = [];
  let cur = [];
  let size = 0;
  for (const l of m.lines) {
    if (size + l.length + 1 > PAGE_CHARS && cur.length) { pages.push(cur); cur = []; size = 0; }
    cur.push(l);
    size += l.length + 1;
  }
  if (cur.length) pages.push(cur);
  m.pages = pages;
  return pages;
}

/** html_outline: one page, from 1. */
export function outlinePage(m, page = 1) {
  const pages = paginate(m);
  const n = pages.length || 1;
  if (!Number.isInteger(page) || page < 1 || page > n) fail(`the page does not exist; the file has ${n} page${n === 1 ? '' : 's'}`);
  return `page ${page} of ${n}; hash ${m.hash}\n${(pages[page - 1] ?? []).join('\n')}`;
}

/**
 * A test of "the shown element's visible text contains `text`", and the deepest such elements, in document order
 * (html_find's matches). Shared by html_find and the v2 locator (decision 0008).
 */
export function textMatches(m, text) {
  if (typeof text !== 'string' || text === '') fail('the search text is empty');
  const occ = [];
  for (let i = m.vis.indexOf(text); i !== -1; i = m.vis.indexOf(text, i + 1)) occ.push(i);
  const firstAtOrAfter = (x) => {
    let a = 0;
    let b = occ.length;
    while (a < b) { const k = (a + b) >> 1; if (occ[k] < x) a = k + 1; else b = k; }
    return a;
  };
  // An element's normalized text is the normalized string between its span's ends, with one leading space when its
  // text starts inside a whitespace run that began before it.
  const hit = (e) => {
    if (!m.shown.has(e) || !occ.length) return false;
    const [s, t] = m.span.get(e);
    if (s === t) return false;
    const lead = s > 0 && isWs(m.raw.charCodeAt(s)) && isWs(m.raw.charCodeAt(s - 1));
    const a = m.at[s];
    const k = firstAtOrAfter(lead ? a - 1 : a);
    return k < occ.length && occ[k] + text.length <= m.at[t];
  };
  const hits = new Set(m.els.filter(hit));
  return { hit, hits, matches: [...hits].filter((e) => !kids(e).some((c) => hits.has(c))) };
}

/** html_find: the deepest shown elements whose visible text contains `text`; their lines and their ancestors' lines. */
export function findText(m, text) {
  const { matches } = textMatches(m, text);
  const refs = new Set();
  for (const e of matches.slice(0, MAX_MATCHES)) {
    for (let p = e; p && p.tagName; p = m.parent.get(p)) if (m.lineOf.has(p.ref)) refs.add(p.ref);
  }
  // The output holds at most PAGE_CHARS characters of lines, as one outline page (security review F3).
  const shownLines = [];
  let size = 0;
  let cut = false;
  for (const r of [...refs].sort((a, b) => a - b)) {
    const l = m.lineOf.get(r);
    if (size + l.length + 1 > PAGE_CHARS) { cut = true; break; }
    shownLines.push(l);
    size += l.length + 1;
  }
  const note = cut ? `; output cut at ${PAGE_CHARS.toLocaleString('en-US')} characters` : '';
  return `${shownLines.join('\n')}\n${matches.length} matches${note}; hash ${m.hash}`;
}

/** The element of a ref, with a clean range, or a named error. */
export function element(m, ref) {
  if (!Number.isInteger(ref) || ref < 0 || ref >= m.els.length) fail(`the ref @${ref} does not exist`);
  const el = m.els[ref];
  if (!el.sourceCodeLocation) fail(`@${ref} has no source bytes; the parser created it`);
  const r = m.ranges.get(el);
  if (!r || (r === CHECK && !exactRange(m, el))) fail(`@${ref} has no clean range in the file`);
  return el;
}

const MARK = 'data-html-mark';
const HTML = 'http://www.w3.org/1999/xhtml';
/** The HTML elements that have no end tag. */
export const VOID = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input',
  'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const attrName = (a) => (a.prefix ? `${a.prefix}:${a.name}` : a.name);
const attrValue = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The source of an empty element with an element's tag and attributes, plus one marker attribute. The attributes
 * stay, because some decide where the parser puts an element: `type="hidden"` keeps an input in a table, and `color`
 * takes a font out of SVG (C0.1 review, finding 2). A void element and `plaintext` get no end tag.
 * @param {object} el a parse5 element @param {string} mark the marker attribute's name @param {string} value
 */
export function markerSource(el, mark, value = '') {
  const t = el.tagName;
  const attrs = [...el.attrs.map((a) => `${attrName(a)}="${attrValue(a.value)}"`), `${mark}="${attrValue(value)}"`].join(' ');
  const open = el.namespaceURI === HTML && (VOID.has(t) || t === 'plaintext');
  return `<${t} ${attrs}>` + (open ? '' : `</${t}>`);
}

/**
 * Whether an element's range holds exactly the element: the file with the range replaced by an empty copy of the
 * element (`markerSource`) parses to the old tree with the element replaced by that copy (C0.1 development run,
 * 2026-11-11).
 * @param {ReturnType<typeof load>} m @param {object} el
 */
function exactRange(m, el) {
  const { startOffset: s, endOffset: e } = el.sourceCodeLocation;
  const t = el.tagName;
  const doc2 = parseDoc(m.text.slice(0, s) + markerSource(el, MARK) + m.text.slice(e));
  if (depthOf(doc2) > MAX_DEPTH) return false; // before the serializer, which is recursive
  const P = m.parent.get(el);
  const k = P.childNodes.indexOf(el);
  const stub = { nodeName: t, tagName: t, namespaceURI: el.namespaceURI, attrs: [...el.attrs, { name: MARK, value: '' }], childNodes: [], parentNode: P };
  if (el.content) stub.content = { nodeName: '#document-fragment', childNodes: [] };
  P.childNodes[k] = stub;
  try {
    return serialize(m.doc) === serialize(doc2);
  } finally {
    P.childNodes[k] = el;
  }
}

/** html_read: the original text of one element. */
export function readRef(m, ref) {
  const l = element(m, ref).sourceCodeLocation;
  return m.text.slice(l.startOffset, l.endOffset);
}
