// The v2 tools (decision 0008, option D): html_find (a text or an id), html_change (a ref or a locator, and one of 5
// operations) and html_outline. `file` is optional when the workspace holds one .html file. Like v1, it reads files
// through the workspace and writes none: html_change returns the new bytes, and the main thread writes them.
import { fail } from './errors.mjs';
import { load, outlinePage, textMatches, element, fmtValue, escTag, isHidden, LINE_CAP, PAGE_CHARS } from './view.mjs';
import { editBytes } from './edit.mjs';
import { MAX_BYTES } from './workspace.mjs';
import { charMap } from './source.mjs';

export const TOOL_NAMES_V2 = ['html_find', 'html_change', 'html_outline'];
export const OPERATIONS = ['remove', 'replace', 'insert_after', 'set_attribute', 'replace_text'];
/** The longest attribute value that html_find shows in full; a longer one is cut, with its length named. */
export const MAX_VALUE_SHOWN = 200;
const MAX_MATCHES = 20;
const NOT_VISIBLE = new Set(['script', 'style', 'svg', 'template', 'noscript']); // as server/view.mjs
const kids = (n) => n.childNodes ?? [];
const WS = /[ \t\n\f\r]+/g;
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/** An element's line with all its attributes (v1's outline line keeps a few). */
export function fullHead(el) {
  const attrs = el.attrs.map((a) => {
    const v = a.value.length > MAX_VALUE_SHOWN ? `${a.value.slice(0, MAX_VALUE_SHOWN)}…(${a.value.length} chars)` : a.value;
    return a.value === '' ? escTag(a.name) : `${escTag(a.name)}=${fmtValue(v)}`;
  });
  const line = `@${el.ref} ${escTag(el.tagName)}${attrs.length ? `(${attrs.join(' ')})` : ''}`;
  return line.length > LINE_CAP ? `${line.slice(0, LINE_CAP)}…(${line.length} chars)` : line;
}

const indentOf = (m, el) => (m.lineOf.get(el.ref) ?? '').match(/^ */)[0];

/** The lines of some elements (full, with all attributes) and of their ancestors (outline lines), in document order. */
function linesOf(m, els) {
  const full = new Set(els.slice(0, MAX_MATCHES));
  const refs = new Map();
  for (const e of full) for (let p = e; p && p.tagName; p = m.parent.get(p)) if (m.lineOf.has(p.ref)) refs.set(p.ref, p);
  const out = [];
  let size = 0;
  for (const [ref, p] of [...refs].sort((a, b) => a[0] - b[0])) {
    const l = full.has(p) ? indentOf(m, p) + fullHead(p) : m.lineOf.get(ref);
    if (size + l.length + 1 > PAGE_CHARS) { out.push(`… output cut at ${PAGE_CHARS.toLocaleString('en-US')} characters`); break; }
    out.push(l);
    size += l.length + 1;
  }
  return out;
}

/** The element with an id: exactly one, else a named error. */
function byId(m, id) {
  const els = m.els.filter((e) => e.attrs.some((a) => a.name === 'id' && a.value === id));
  if (els.length !== 1) fail(els.length ? `${els.length} elements have the id "${id}"` : `no element has the id "${id}"`);
  return els[0];
}

/** html_find with an id: the element and its child elements, each with all its attributes. */
function findId(m, id) {
  const el = byId(m, id);
  const lines = [fullHead(el), ...kids(el).filter((c) => c.tagName).map((c) => ` ${fullHead(c)}`)];
  return `${lines.join('\n')}\n1 match; ${kids(el).filter((c) => c.tagName).length} child elements; hash ${m.hash}`;
}

/**
 * The elements that a text locator names: with no tag, html_find's deepest matches; with a tag, the innermost shown
 * elements of that tag whose visible text contains the text.
 */
export function textTargets(m, text, tag) {
  const { hit, matches } = textMatches(m, text);
  if (tag === undefined) return matches;
  const withTag = new Set(m.els.filter((e) => e.tagName === tag && hit(e)));
  // Innermost: no other element of the tag inside it holds the text.
  return [...withTag].filter((e) => ![...withTag].some((o) => o !== e && isAncestor(m, e, o)));
}
const isAncestor = (m, a, d) => { for (let p = m.parent.get(d); p; p = m.parent.get(p)) if (p === a) return true; return false; };

/**
 * The element that html_change names: a ref with its hash, a text (and a tag), or an id (and a child tag and n). A
 * locator must name exactly 1 element; else a named error that lists the matches.
 */
export function locate(m, a) {
  const kinds = ['ref', 'text', 'id'].filter((k) => a[k] !== undefined);
  if (kinds.length !== 1) fail('give exactly one of "ref", "text" or "id"');
  if (a.tag !== undefined && a.text === undefined) fail('"tag" goes with "text"');
  if ((a.child !== undefined || a.n !== undefined) && a.id === undefined) fail('"child" and "n" go with "id"');
  if (a.ref !== undefined) {
    if (a.hash === undefined) fail('give "hash" with "ref"');
    if (a.hash !== m.hash) fail('the file changed since the hash');
    return element(m, a.ref);
  }
  if (a.text !== undefined) {
    const found = textTargets(m, a.text, a.tag);
    if (found.length !== 1) {
      if (!found.length) fail(`no element${a.tag ? ` of the tag ${a.tag}` : ''} contains the text`);
      fail(`${found.length} elements match; give a ref:\n${linesOf(m, found).join('\n')}\nhash ${m.hash}`);
    }
    return found[0];
  }
  const el = byId(m, a.id);
  if (a.child === undefined) return el;
  const n = a.n ?? 1;
  const list = kids(el).filter((c) => c.tagName === a.child);
  if (n < 1 || n > list.length) fail(`the element with the id "${a.id}" has ${list.length} child elements of the tag ${a.child}`);
  return list[n - 1];
}

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const ATTR_NAME = /^[^\s"'>/=\u0000-\u001f\u007f]{1,100}$/;

/** The element's source with one attribute set: its value replaced, or the attribute added at the end of the start tag. */
function setAttribute(m, el, name, value) {
  if (!ATTR_NAME.test(name)) fail('the attribute name is not valid');
  const loc = el.sourceCodeLocation;
  const s = loc.startOffset;
  const own = m.text.slice(s, loc.endOffset);
  const pair = `${name}="${escAttr(value)}"`;
  const key = name.toLowerCase();
  const at = loc.attrs?.[key];
  if (at) return own.slice(0, at.startOffset - s) + pair + own.slice(at.endOffset - s);
  if (!loc.startTag) fail('the element has no start tag in the file');
  const end = loc.startTag.endOffset - s;
  const cut = own.slice(0, end).endsWith('/>') ? end - 2 : end - 1;
  return `${own.slice(0, cut)} ${pair}${own.slice(cut)}`;
}

/**
 * The element's source with a text replaced: `old` (whitespace runs count as one space) must occur exactly once in
 * the visible text nodes of the element, inside one text node.
 */
function replaceText(m, el, old, neu) {
  const want = old.replace(WS, ' ');
  if (!want.trim()) fail('the old text is empty');
  const hidden = new Set(m.els.filter(isHidden));
  const found = [];
  for (const stack = [...kids(el)].reverse(); stack.length;) {
    const n = stack.pop();
    if (n.nodeName === '#text') {
      // The value with its whitespace runs as one space, and each position's place in the value.
      let norm = '';
      const pos = [];
      const v = n.value;
      for (let i = 0; i < v.length; i++) {
        const ws = isWs(v[i]);
        if (ws && i > 0 && isWs(v[i - 1])) { pos[pos.length - 1][1] = i + 1; continue; }
        norm += ws ? ' ' : v[i];
        pos.push([i, i + 1]);
      }
      for (let k = norm.indexOf(want); k !== -1; k = norm.indexOf(want, k + 1)) found.push({ n, a: pos[k][0], b: pos[k + want.length - 1][1] });
      continue;
    }
    if (n.tagName && (NOT_VISIBLE.has(n.tagName) || hidden.has(n))) continue;
    for (const c of [...kids(n)].reverse()) stack.push(c);
  }
  if (found.length !== 1) fail(found.length ? `the old text occurs ${found.length} times in the element` : 'the old text is not in one text node of the element');
  const { n, a, b } = found[0];
  const map = charMap(m.text, n);
  if (!map) fail('the text cannot be mapped to its bytes in the file');
  const s = el.sourceCodeLocation.startOffset;
  const own = m.text.slice(s, el.sourceCodeLocation.endOffset);
  return own.slice(0, map[a][0] - s) + escText(neu) + own.slice(map[b - 1][1] - s);
}

/** The new source of the element for an operation. */
function newSource(m, el, a) {
  const str = (k) => (typeof a[k] === 'string' ? a[k] : fail(`the operation ${a.operation} needs the argument "${k}" (a string)`));
  const own = m.text.slice(el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset);
  switch (a.operation) {
    case 'remove': return '';
    case 'replace': return str('html');
    case 'insert_after': return own + str('html');
    case 'set_attribute': return setAttribute(m, el, str('attribute'), str('value'));
    default: return replaceText(m, el, str('old'), str('new'));
  }
}

/**
 * Runs one v2 tool. Returns `{ text }`, or for html_change `{ write: {...}, note }`.
 * @param {ReturnType<import('./workspace.mjs').openWorkspace>} ws @param {string} name @param {object} args
 */
export function runToolV2(ws, name, args) {
  if (!TOOL_NAMES_V2.includes(name)) fail(`the tool ${name} does not exist`);
  const a = args && typeof args === 'object' ? args : {};
  for (const k of ['file', 'hash', 'text', 'tag', 'id', 'child', 'html', 'attribute', 'value', 'old', 'new', 'operation']) {
    if (a[k] !== undefined && typeof a[k] !== 'string') fail(`the argument "${k}" is not a string`);
  }
  for (const k of ['ref', 'n', 'page']) if (a[k] !== undefined && !Number.isInteger(a[k])) fail(`the argument "${k}" is not an integer`);
  // Before any parse (security review of v1, other finding 2).
  for (const k of ['html', 'value', 'old', 'new']) if (a[k] !== undefined && Buffer.byteLength(a[k]) > MAX_BYTES) fail(`the argument "${k}" is larger than 2 MB`);
  const f = ws.read(a.file ?? ws.onlyFile());
  const m = load(f.text, f.hash);
  if (name === 'html_outline') return { text: outlinePage(m, a.page ?? 1) };
  if (name === 'html_find') {
    if ((a.text === undefined) === (a.id === undefined)) fail('give exactly one of "text" or "id"');
    if (a.id !== undefined) return { text: findId(m, a.id) };
    const { matches } = textMatches(m, a.text);
    return { text: `${linesOf(m, matches).join('\n')}\n${matches.length} matches; hash ${m.hash}` };
  }
  if (!OPERATIONS.includes(a.operation)) fail(`"operation" must be one of ${OPERATIONS.join(', ')}`);
  const el = locate(m, a);
  const html = newSource(m, el, a);
  const note = fullHead(el).slice(0, 200);
  return { write: { real: f.real, bytes: editBytes(m, f.bytes, el.ref, m.hash, html), oldHash: f.hash, id: f.id }, note };
}
