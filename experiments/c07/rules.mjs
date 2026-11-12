// The task rules of the second rescope's gates C0.7, C0.8, C0.9 and C0.10 (docs/contract.md, "Phase 0, second rescope";
// decision 0007). Pure functions over the server's own view (`server/view.mjs`, inputs 5): no file access, no oracle,
// no network. tasks.mjs adds the oracle check and the token count, and draws.
import { parseFragment } from 'parse5';
import { load, element, findText, isHidden, VOID } from '../../server/view.mjs';
import { editBytes } from '../../server/edit.mjs';
import { ToolError } from '../../server/errors.mjs';
import { runToolV2 } from '../../server/v2.mjs';
import { hashOf } from '../../server/workspace.mjs';

export const NEW_P = '<p>New text</p>';
const HASH = 'rules';
const NOT_VISIBLE = new Set(['script', 'style', 'svg', 'template', 'noscript']); // as server/view.mjs
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
const kids = (n) => n.childNodes ?? [];

/** The server's view of a file's text, with the extra maps the rules need. */
export function view(text) {
  const m = load(text, HASH);
  m.body = m.els.find((e) => e.tagName === 'body');
  m.textNodes = visibleTextNodes(m);
  m.maps = new Map();
  return m;
}

/** The cached `charMap` of a text node. */
const mapOf = (m, tn) => {
  if (!m.maps.has(tn)) m.maps.set(tn, charMap(m.text, tn));
  return m.maps.get(tn);
};

/**
 * The source offsets where an element starts, its end tag starts or it ends, and where a comment starts, sorted: so
 * that a quote finds the boundaries inside its source range by a binary search.
 */
function boundaries(m) {
  if (m.bounds) return m.bounds;
  const b = [];
  for (const stack = [m.doc]; stack.length;) {
    const n = stack.pop();
    const l = n.sourceCodeLocation;
    if (l && n.nodeName === '#comment') b.push([l.startOffset, n]);
    if (l && n.tagName) {
      b.push([l.startOffset, n], [l.endOffset, n]);
      if (l.endTag) b.push([l.endTag.startOffset, n]);
    }
    stack.push(...kids(n));
  }
  m.bounds = b.sort((x, y) => x[0] - y[0]);
  return m.bounds;
}

/**
 * The visible text nodes in document order, each with its start in `m.raw`: the same walk as `load` in
 * server/view.mjs, so that their values joined equal `m.raw` (a test checks it).
 */
export function visibleTextNodes(m) {
  const hidden = new Set(m.els.filter(isHidden));
  const out = [];
  let len = 0;
  for (const stack = [m.doc]; stack.length;) {
    const n = stack.pop();
    if (n.nodeName === '#text') { out.push({ node: n, start: len }); len += n.value.length; continue; }
    if (!n.tagName && n.nodeName !== '#document') continue;
    if (n.tagName && (NOT_VISIBLE.has(n.tagName) || hidden.has(n))) continue;
    const c = kids(n);
    for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
  }
  return out;
}

export const inBody = (m, e) => { for (let p = m.parent.get(e); p; p = m.parent.get(p)) if (p === m.body) return true; return false; };
export const range = (e) => [e.sourceCodeLocation.startOffset, e.sourceCodeLocation.endOffset];
/** The element has source bytes and an explicit end tag, or is void. An element that the parser made has neither. */
const hasEnd = (e) => !!e.sourceCodeLocation && (!!e.sourceCodeLocation.endTag || VOID.has(e.tagName));

/** The server gives the element by its ref: it has a clean range (decision 0006). */
export function clean(m, e) {
  try {
    element(m, e.ref);
    return true;
  } catch (err) {
    if (err instanceof ToolError) return false;
    throw err;
  }
}

/**
 * The v2 server accepts a change by ref (contract amendment "the gate text for the v2 tools", C.3), and writes exactly
 * the expected file: it runs the server's own html_change on the text in memory, through a workspace that writes
 * nothing. `change` is the task's expected change [start, end, text].
 */
export function v2Accepts(m, e, operation, args, change) {
  const bytes = Buffer.from(m.text, 'utf8');
  const hash = hashOf(bytes);
  const ws = { read: () => ({ real: 'rules:v2', bytes, text: m.text, hash, id: null }), onlyFile: () => 'x.html' };
  try {
    const r = runToolV2(ws, 'html_change', { file: 'x.html', operation, ref: e.ref, hash, ...args });
    return Buffer.from(r.write.bytes).equals(Buffer.from(applyChange(m.text, change), 'utf8'));
  } catch (err) {
    if (err instanceof ToolError) return false;
    throw err;
  }
}

/** The v1 server's html_edit accepts `html` in place of the element (the v1 rules; kept for their tests). */
export function serverAccepts(m, e, html) {
  try {
    editBytes(m, Buffer.from(m.text, 'utf8'), e.ref, HASH, html);
    return true;
  } catch (err) {
    if (err instanceof ToolError) return false;
    throw err;
  }
}

/** The element's visible text, as html_find reads it: its part of `m.vis`. */
export function visOf(m, e) {
  const [s, t] = m.span.get(e) ?? [0, 0];
  return m.vis.slice(m.at[s], m.at[t]);
}

/** The number of times `needle` occurs in `hay`, overlaps counted, up to `max`. */
export function count(hay, needle, max = 2) {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1 && n < max; i = hay.indexOf(needle, i + 1)) n++;
  return n;
}

const countP = (text) => load(text, HASH).els.filter((e) => e.tagName === 'p').length;
const pInside = (e) => {
  let n = 0;
  for (const stack = [...kids(e)]; stack.length;) {
    const c = stack.pop();
    if (c.tagName === 'p') n++;
    stack.push(...kids(c));
  }
  return n;
};
export const applyChange = (text, [a, b, s]) => text.slice(0, a) + s + text.slice(b);

/**
 * The expected change of an edit of a whole element, and whether the server accepts it: removal, replacement with
 * `<p>New text</p>`, or insertion of `<p>New text</p>` after the element. A replacement and an insertion must give
 * the new `p` after parsing (in a `select`, for example, the parser drops it). Null when the edit is not valid.
 */
export function wholeEdit(m, e, op) {
  const [s, t] = range(e);
  const html = op === 'removal' ? '' : op === 'replacement' ? NEW_P : m.text.slice(s, t) + NEW_P;
  const change = op === 'insertion' ? [t, t, NEW_P] : [s, t, html];
  const v2 = op === 'removal' ? ['remove', {}] : op === 'replacement' ? ['replace', { html: NEW_P }] : ['insert_after', { html: NEW_P }];
  if (!v2Accepts(m, e, v2[0], v2[1], change)) return null;
  if (op !== 'removal') {
    const want = countP(m.text) - (op === 'replacement' ? pInside(e) + (e.tagName === 'p' ? 1 : 0) : 0) + 1;
    if (countP(applyChange(m.text, change)) !== want) return null;
  }
  return { html, change };
}

// --- C0.7: remove or replace a large element ----------------------------------------------------------------------

const lineCount = (s) => s.split('\n').length;
const NO_QUOTE_CHARS = /["`]/;
const firstWords = (s, n = 6) => s.trim().split(' ').filter(Boolean).slice(0, n);

/** The size rule of C0.7: at least 40 lines, at least 2,000 bytes and at most 50,000 bytes of source. */
export function largeEnough(m, e) {
  const [s, t] = range(e);
  const src = m.text.slice(s, t);
  const bytes = Buffer.byteLength(src, 'utf8');
  return lineCount(src) >= 40 && bytes >= 2000 && bytes <= 50_000;
}

/** The text at [i, i + n) starts and ends at word boundaries of `vis`: a space or the edge on each side. */
export const wordBounded = (vis, i, n) => i >= 0 && (i === 0 || vis[i - 1] === ' ') && (i + n === vis.length || vis[i + n] === ' ');

/** A plain tag name of at most 40 characters, for a target and for C0.8's T (review, 5: no long third-party text). */
export const TAG_RULE = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * The quote of a C0.7 target: from the first visible text node inside the target (document order) that gives a valid
 * quote. A text node's quote is its first 6 words (3 to 5 when it has fewer). Valid: exactly once in the visible text;
 * exactly once in the source, inside the text node's own source; the deepest holder (the text node's parent) is
 * shown; the target is the only element with its tag from itself down to that holder; no `"` and no backtick.
 */
export function c07Quote(m, e) {
  const [s, t] = m.span.get(e) ?? [0, 0];
  for (const { node, start } of m.textNodes) {
    if (start < s || start + node.value.length > t) continue;
    const w = firstWords(node.value.replace(/[ \t\n\f\r]+/g, ' '));
    if (w.length < 3) continue;
    const q = w.join(' ');
    if (q.length > MAX_QUOTE || NO_QUOTE_CHARS.test(q) || count(m.vis, q) !== 1 || count(m.text, q) !== 1) continue;
    // From start to end of words in the visible text: text of a neighbour element can join a word (review, 2).
    if (!wordBounded(m.vis, m.vis.indexOf(q), q.length)) continue;
    const loc = node.sourceCodeLocation;
    const at = m.text.indexOf(q);
    if (!loc || at < loc.startOffset || at + q.length > loc.endOffset) continue;
    const holder = m.parent.get(node);
    if (!m.shown.has(holder)) continue;
    let ok = true;
    for (let p = holder; p !== e; p = m.parent.get(p)) if (!p || p.tagName === e.tagName) { ok = false; break; }
    if (ok) return q;
  }
  return null;
}

/** The C0.7 candidates (before the oracle and the token count): each with its quote and its valid edits. */
export function c07Candidates(m) {
  const out = [];
  for (const e of m.els) {
    if (!TAG_RULE.test(e.tagName) || !inBody(m, e) || !m.shown.has(e) || !hasEnd(e) || !largeEnough(m, e) || !clean(m, e)) continue;
    const quote = c07Quote(m, e);
    if (!quote) continue;
    const edits = {};
    for (const op of ['removal', 'replacement']) { const x = wholeEdit(m, e, op); if (x) edits[op] = x; }
    if (Object.keys(edits).length) out.push({ el: e, quote, edits });
  }
  return out;
}

export const c07Prompt = (op, tag, quote) => (op === 'removal'
  ? `Remove the \`${tag}\` element that contains the text "${quote}". If several \`${tag}\` elements contain it, remove the innermost one.`
  : `Replace the \`${tag}\` element that contains the text "${quote}" with \`<p>New text</p>\`. If several \`${tag}\` elements contain it, replace the innermost one.`);

// --- C0.8: a target named by its position ------------------------------------------------------------------------

/** A plain id of at most 40 characters (security review, F1: no long third-party text in a committed prompt). */
export const ID_RULE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
/** The longest quote, attribute name and attribute value that a task may hold (security review, F1). */
export const MAX_QUOTE = 80;
export const MAX_NAME = 40;
export const MAX_VALUE = 80;

/**
 * The attributes a question or an attribute change can draw, in C0.8 and C0.9: a source location, a name of at most
 * 40 characters, and a value of 1 to 80 characters with no `"`, backtick or line break, and no space at either end
 * (the judge trims an answer). The name is plain (re-review, 7), and the value holds no "&": the judge decodes entities
 * in an answer, so "?x=1&section=2" could never be accepted (re-review, 2).
 */
export const ATTR_NAME = /^[a-z][a-z0-9_.:-]{0,39}$/;
export const safeAttrs = (e) => e.attrs.filter((a) => e.sourceCodeLocation?.attrs?.[a.name] && ATTR_NAME.test(a.name) &&
  a.value !== '' && a.value.length <= MAX_VALUE && !/["`&\r\n]/.test(a.value) && a.value === a.value.trim());

/** The English ordinal with digits: 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd. */
export function ordinal(k) {
  const t = k % 100;
  if (t >= 11 && t <= 13) return `${k}th`;
  return `${k}${{ 1: 'st', 2: 'nd', 3: 'rd' }[k % 10] ?? 'th'}`;
}

/** Each id value and the number of elements that have it, template content included. */
export function idCounts(m) {
  const n = new Map();
  for (const stack = [m.doc]; stack.length;) {
    const x = stack.pop();
    const id = x.attrs?.find((a) => a.name === 'id')?.value;
    if (id !== undefined) n.set(id, (n.get(id) ?? 0) + 1);
    stack.push(...kids(x));
    if (x.content) stack.push(x.content);
  }
  return n;
}

/**
 * The C0.8 parents: a shown element in `body` whose id is unique in the file and matches ID_RULE, whose child
 * elements are all shown, and each has a clean range with an explicit end tag (or is void). The oracle then checks
 * that html5lib gives the same list of child elements.
 */
export function c08Parents(m) {
  const ids = idCounts(m);
  const out = [];
  for (const p of m.els) {
    const id = p.attrs.find((a) => a.name === 'id')?.value;
    if (id === undefined || !ID_RULE.test(id) || ids.get(id) !== 1 || !m.shown.has(p) || !inBody(m, p)) continue;
    const children = kids(p).filter((c) => c.tagName);
    if (!children.length || !children.every((c) => m.shown.has(c) && hasEnd(c) && clean(m, c))) continue;
    out.push({ parent: p, id, children });
  }
  return out;
}

/** The targets of one parent: the k-th child element with tag T, for k ≥ 2. */
export function c08Targets(par) {
  const byTag = new Map();
  const out = [];
  for (const c of par.children) {
    const k = (byTag.get(c.tagName) ?? 0) + 1;
    byTag.set(c.tagName, k);
    if (k >= 2 && TAG_RULE.test(c.tagName)) out.push({ ...par, el: c, tag: c.tagName, k });
  }
  return out;
}

/** The attributes a C0.8 question or attribute change can draw (`safeAttrs`). */
export const c08Attrs = safeAttrs;

export function c08Prompt(type, t, extra = {}) {
  const lead = `In the element with id "${t.id}", take the ${ordinal(t.k)} child element that is a \`${t.tag}\` element.`;
  if (type === 'question') return `${lead} What is the value of its \`${extra.attr}\` attribute? End your reply with the line \`ANSWER: <value>\`.`;
  if (type === 'attribute') return `${lead} Set its \`${extra.attr}\` attribute to "${extra.newValue}". Change nothing else.`;
  if (type === 'removal') return `In the element with id "${t.id}", remove the ${ordinal(t.k)} child element that is a \`${t.tag}\` element.`;
  return `${lead} After it, add \`<p>New text</p>\`.`;
}

/** An attribute change as new bytes of the whole element (what html_edit must accept) and as a change of the file. */
export function attributeEdit(m, e, attr, newValue) {
  const loc = e.sourceCodeLocation.attrs[attr];
  const [s, t] = range(e);
  const html = m.text.slice(s, loc.startOffset) + `${attr}="${newValue}"` + m.text.slice(loc.endOffset, t);
  const change = [loc.startOffset, loc.endOffset, `${attr}="${newValue}"`];
  return v2Accepts(m, e, 'set_attribute', { attribute: attr, value: newValue }, change) ? { html, change } : null;
}

// --- C0.9: a quote that is not in the source as written ------------------------------------------------------------

export const INLINE = new Set(['a', 'abbr', 'b', 'code', 'em', 'i', 'small', 'span', 'strong', 'sub', 'sup', 'u']);
/** Printable ASCII other than `"` and the backtick, letters, and U+2013, U+2014, U+2018, U+2019, U+2026. */
// One character class: alternatives that overlap (ASCII letters are also \p{L}) backtrack exponentially on a failure.
export const allowedChars = (q) => /^[ !#-_a-~\p{L}–—‘’…]+$/u.test(q);

/** The decoded text of one character reference, through the parser itself; null when it is not a reference. */
function decodeRef(ref) {
  const v = parseFragment(ref).childNodes[0]?.value;
  return v === undefined || v === ref ? null : v;
}

/**
 * For each UTF-16 unit of a text node's value, the source range it comes from, or null when the source cannot be
 * mapped exactly. Character references and CR LF give one range for several source characters.
 */
export function charMap(text, tn) {
  const loc = tn.sourceCodeLocation;
  if (!loc) return null;
  const src = text.slice(loc.startOffset, loc.endOffset);
  const out = [];
  let v = '';
  const push = (s, a, b) => { for (const c of s) for (let k = 0; k < c.length; k++) out.push([loc.startOffset + a, loc.startOffset + b]); v += s; };
  for (let i = 0; i < src.length;) {
    if (src[i] === '&') {
      const r = /^&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/.exec(src.slice(i, i + 40));
      const d = r && decodeRef(r[0]);
      if (d !== null && d !== undefined) { push(d, i, i + r[0].length); i += r[0].length; continue; }
    }
    if (src[i] === '\r') { const n = src[i + 1] === '\n' ? 2 : 1; push('\n', i, i + n); i += n; continue; }
    const cp = src.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    push(ch, i, i + ch.length);
    i += ch.length;
  }
  return v === tn.value ? out : null;
}

/** The raw index of each visible position, for non-whitespace characters. */
function rawOf(m, visPos) {
  // `at` is non-decreasing; a non-whitespace character has exactly one raw index with at[r] === visPos.
  let a = 0;
  let b = m.raw.length;
  while (a < b) { const k = (a + b) >> 1; if (m.at[k] < visPos) a = k + 1; else b = k; }
  for (let r = a; r < m.raw.length && m.at[r] === visPos; r++) if (!isWs(m.raw[r])) return r;
  return -1;
}

/** The visible text node that holds raw index r. */
function nodeAt(m, r) {
  let a = 0;
  let b = m.textNodes.length - 1;
  while (a < b) { const k = (a + b + 1) >> 1; if (m.textNodes[k].start <= r) a = k; else b = k - 1; }
  return m.textNodes[a];
}

/**
 * The analysis of a quote at visible positions [qa, qb): its source range, the text nodes it covers, its causes, and
 * whether it is valid for C0.9 (the closed list of causes, inline tags at whitespace, no comment or other element).
 * Null when it is not valid.
 */
export function analyseQuote(m, qa, qb) {
  const ra = rawOf(m, qa);
  const rb = rawOf(m, qb - 1);
  if (ra < 0 || rb < 0) return null;
  const first = m.textNodes.indexOf(nodeAt(m, ra));
  const last = m.textNodes.indexOf(nodeAt(m, rb));
  const covered = m.textNodes.slice(first, last + 1);
  const maps = covered.map((x) => mapOf(m, x.node));
  if (maps.some((x) => !x)) return null;
  const srcStart = maps[0][ra - covered[0].start][0];
  const srcEnd = maps.at(-1)[rb - covered.at(-1).start][1];
  if (!(srcStart < srcEnd)) return null;
  const causes = new Set();
  // Element and comment boundaries strictly inside the quote's source.
  const b = boundaries(m);
  let lo = 0;
  let hi = b.length;
  while (lo < hi) { const k = (lo + hi) >> 1; if (b[k][0] <= srcStart) lo = k + 1; else hi = k; }
  for (let k = lo; k < b.length && b[k][0] < srcEnd; k++) {
    const n = b[k][1];
    // A hidden inline element would put text that is not visible inside the quote's source (review, 8).
    if (n.nodeName === '#comment' || !INLINE.has(n.tagName) || isHidden(n)) return null;
    causes.add('inline tag');
  }
  // Each junction between covered text nodes that a tag splits lies next to ASCII whitespace.
  for (let i = 0; i + 1 < covered.length; i++) {
    const a = covered[i].node.value;
    const b = covered[i + 1].node.value;
    if (!isWs(a.at(-1) ?? 'x') && !isWs(b[0] ?? 'x')) return null;
  }
  // Entities and whitespace inside the quote's part of each covered node. An entity is a source range of more than
  // one character that starts with "&"; it must decode to an allowed character (review, 7 and 8).
  let bad = false;
  covered.forEach((x, i) => {
    const lo = i === 0 ? ra - x.start : 0;
    const hi = i === covered.length - 1 ? rb - x.start : x.node.value.length - 1;
    for (let k = lo; k <= hi; k++) {
      const [s, e] = maps[i][k];
      const src = m.text.slice(s, e);
      if (e - s > 1 && src.startsWith('&')) { causes.add('entity'); if (!allowedChars(x.node.value[k])) bad = true; }
      else if (src.includes('\f')) bad = true; // not in the contract's closed list (re-review, 6)
      else if (/[\t\n\r]/.test(src)) causes.add('whitespace');
      // 2 spaces in the source: this space and the one before it are both literal spaces (not "&#32;").
      else if (src === ' ' && k > lo && m.text.slice(...maps[i][k - 1]) === ' ') causes.add('whitespace');
    }
  });
  if (bad || !causes.size) return null;
  return { srcStart, srcEnd, nodes: covered.length, causes: [...causes].sort() };
}

/** The deepest shown element whose visible text holds [qa, qb), and the elements above it. */
function holderOf(m, qa, qb) {
  const r = rawOf(m, qa);
  let e = m.parent.get(nodeAt(m, r).node);
  for (; e && e.tagName; e = m.parent.get(e)) {
    if (!m.shown.has(e)) continue;
    const [s, t] = m.span.get(e);
    if (m.at[s] <= qa && qb <= m.at[t]) return e;
  }
  return null;
}

const PRE = new Set(['pre', 'textarea']);

/**
 * A fast form of "the quote is in the source as written", for most windows: the quote lies in one text node, and its
 * characters come one for one from consecutive source characters. False does not mean "not in the source": the caller
 * then searches the source.
 */
function writtenInOneNode(m, qa, qb, q) {
  const ra = rawOf(m, qa);
  const rb = rawOf(m, qb - 1);
  if (ra < 0 || rb < 0) return false;
  const x = nodeAt(m, ra);
  if (nodeAt(m, rb) !== x || rb - ra !== qb - 1 - qa) return false;
  const map = mapOf(m, x.node);
  if (!map) return false;
  for (let k = ra - x.start; k <= rb - x.start; k++) {
    const [s, e] = map[k];
    if (e - s !== 1 || (k > ra - x.start && map[k - 1][1] !== s)) return false;
  }
  // The source characters must also equal the quote: a single LF or tab maps 1:1 to a space (review, 1).
  return m.text.slice(map[ra - x.start][0], map[rb - x.start][1]) === q;
}

/**
 * The C0.9 quotes of a file: for each target element, its first valid quote in document order (by start, longer
 * first), and its first valid quote inside one text node (for a text change). Valid: 3 to 6 words; allowed
 * characters; exactly once in the visible text; nowhere in the source as written; not inside `pre` or `textarea`;
 * html_find gives exactly the target; the closed list of causes (`analyseQuote`).
 */
export function c09Quotes(m) {
  const words = [];
  for (const w of m.vis.matchAll(/[^ ]+/g)) words.push([w.index, w.index + w[0].length]);
  const byEl = new Map();
  for (let i = 0; i < words.length; i++) {
    for (let len = 6; len >= 3; len--) {
      if (i + len > words.length) continue;
      const qa = words[i][0];
      const qb = words[i + len - 1][1];
      const q = m.vis.slice(qa, qb);
      if (q.length > MAX_QUOTE || !allowedChars(q) || writtenInOneNode(m, qa, qb, q) || m.text.includes(q) || count(m.vis, q) !== 1) continue;
      const e = holderOf(m, qa, qb);
      if (!e || !TAG_RULE.test(e.tagName) || !inBody(m, e) || !hasEnd(e)) continue;
      let pre = false;
      for (let p = e; p && p.tagName; p = m.parent.get(p)) if (PRE.has(p.tagName)) pre = true;
      if (pre) continue;
      // C0.3's target rule: no other element with the target's tag holds the quote (only ancestors can).
      let sameTag = false;
      for (let p = m.parent.get(e); p && p.tagName; p = m.parent.get(p)) if (p.tagName === e.tagName && m.shown.has(p)) sameTag = true;
      if (sameTag) continue;
      const slot = byEl.get(e) ?? {};
      if (slot.any && slot.one) continue;
      const a = analyseQuote(m, qa, qb);
      if (!a) continue;
      const f = findText(m, q);
      if (!f.endsWith(`hash ${m.hash}`) || !/\n1 matches;/.test(`\n${f}`) || !new RegExp(`^ *@${e.ref} `, 'm').test(f)) continue;
      const item = { quote: q, ...a };
      if (!slot.any) slot.any = item;
      if (!slot.one && a.nodes === 1 && !a.causes.includes('inline tag')) slot.one = item;
      byEl.set(e, slot);
    }
  }
  const out = [];
  for (const [el, slot] of byEl) if (clean(m, el)) out.push({ el, ...slot });
  return out.sort((a, b) => a.el.ref - b.el.ref);
}

// --- C0.10: C0.6's task kind with the v2 tools ---------------------------------------------------------------------

/** The visible-text positions where `q` occurs, up to `max` (null when there are more). */
function occurrences(m, q, max = 50) {
  const out = [];
  for (let i = m.vis.indexOf(q); i !== -1; i = m.vis.indexOf(q, i + 1)) {
    if (out.length === max) return null;
    out.push(i);
  }
  return out;
}

/** The shown elements whose visible text holds the occurrence at visible position p: the deepest and its ancestors. */
function holdersAt(m, p, len) {
  const out = [];
  for (let e = holderOf(m, p, p + len); e && e.tagName; e = m.parent.get(e)) if (m.shown.has(e)) out.push(e);
  return out;
}

const isAncestorOf = (m, a, d) => { for (let p = m.parent.get(d); p; p = m.parent.get(p)) if (p === a) return true; return false; };

/**
 * C0.3's quote of an element (`experiments/c03/make-tasks.mjs`, `quoteFor`), on the server's view: the first 6 words
 * of its first direct text node that has a word, when those words are in the node's source as written. With the
 * second rescope's limits: at most 80 characters, no `"` and no backtick.
 */
export function c10Quote(m, el) {
  for (const c of el.childNodes) {
    if (c.nodeName !== '#text') continue;
    const q = c.value.replace(/[ \t\n\f\r]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).join(' ');
    if (!q) continue;
    const loc = c.sourceCodeLocation;
    const at = loc ? m.text.indexOf(q, loc.startOffset) : -1;
    if (at < 0 || at + q.length > loc.endOffset || q.length > MAX_QUOTE || NO_QUOTE_CHARS.test(q)) return null;
    return q;
  }
  return null;
}

/**
 * C0.10's targets: C0.3's candidates (`candidates` of make-tasks.mjs) on the server's view. A shown element in body
 * with an explicit end tag and a clean range, whose quote it is the deepest holder of, and no other element of its
 * tag holds the quote. The holders come from the quote's occurrences in the visible text. A quote with more than 50
 * occurrences is not a candidate: such a quote names one element of its tag only in rare files, and the cap keeps the
 * rule fast (v2 run plan, reading 5).
 */
export function c10Candidates(m) {
  const out = [];
  for (const e of m.els) {
    if (!TAG_RULE.test(e.tagName) || !inBody(m, e) || !m.shown.has(e) || !hasEnd(e)) continue;
    const q = c10Quote(m, e);
    if (!q) continue;
    const occ = occurrences(m, q);
    if (!occ || !occ.length) continue;
    let ok = true;
    let holds = false;
    for (const p of occ) {
      const hs = holdersAt(m, p, q.length);
      if (hs.includes(e)) { holds = true; if (hs[0] !== e) ok = false; } // a child of e holds it: e is not the deepest
      if (hs.some((h) => h !== e && h.tagName === e.tagName)) ok = false; // another element of its tag holds it
    }
    if (ok && holds && clean(m, e)) out.push({ el: e, quote: q });
  }
  return out;
}

/**
 * The text-change quotes of a C0.10 target (make-tasks.mjs, the text change): each direct text node of 3 words or
 * more gives its first 6 words. Valid when the words are in the node's source as written, and no element other than
 * the target and its ancestors holds them.
 */
export function c10TextQuotes(m, el) {
  const out = [];
  for (const c of el.childNodes) {
    if (c.nodeName !== '#text') continue;
    const words = c.value.replace(/[ \t\n\f\r]+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length < 3) continue;
    const q = words.slice(0, 6).join(' ');
    if (q.length > MAX_QUOTE || NO_QUOTE_CHARS.test(q)) continue;
    const loc = c.sourceCodeLocation;
    const at = loc ? m.text.indexOf(q, loc.startOffset) : -1;
    if (at < 0 || at + q.length > loc.endOffset) continue;
    const occ = occurrences(m, q);
    if (!occ) continue;
    if (occ.some((p) => holdersAt(m, p, q.length).some((h) => h !== el && !isAncestorOf(m, h, el)))) continue;
    out.push({ quote: q, at });
  }
  return out;
}

/** C0.4's prompt templates, for C0.9 and C0.10. */
export function c09Prompt(type, tag, quote, extra = {}) {
  if (type === 'question') return `What is the value of the \`${extra.attr}\` attribute of the \`${tag}\` element that contains the text "${quote}"? End your reply with the line \`ANSWER: <value>\`.`;
  if (type === 'text') return `Change the text "${quote}" to "${extra.newText}". Change nothing else.`;
  if (type === 'attribute') return `In the \`${tag}\` element that contains the text "${quote}", set the \`${extra.attr}\` attribute to "${extra.newValue}". Change nothing else.`;
  if (extra.op === 'insertion') return `After the \`${tag}\` element that contains the text "${quote}", add \`<p>New text</p>\`.`;
  return `Remove the \`${tag}\` element that contains the text "${quote}".`;
}
