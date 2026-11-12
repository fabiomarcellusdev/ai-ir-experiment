// The v2 tools (decision 0008, option D): html_find (a text or an id), html_change (a ref or a locator, and one of 5
// operations) and html_outline. `file` is optional when the workspace holds one .html file. Like v1, it reads files
// through the workspace and writes none: html_change returns the new bytes, and the main thread writes them.
import { fail } from './errors.mjs';
import { load, outlinePage, textMatches, element, fmtValue, escTag, isHidden, LINE_CAP, PAGE_CHARS, VOID } from './view.mjs';
import { editBytes } from './edit.mjs';
import { MAX_BYTES } from './workspace.mjs';
import { charMap } from './source.mjs';

export const TOOL_NAMES_V2 = ['html_find', 'html_change', 'html_outline'];
export const OPERATIONS = ['remove', 'replace', 'insert_after', 'set_attribute', 'replace_text'];
/** The longest attribute value that html_find shows in full; a longer one is cut, with its length named. */
export const MAX_VALUE_SHOWN = 200;
const MAX_MATCHES = 20;
const NOT_VISIBLE = new Set(['script', 'style', 'svg', 'template', 'noscript']); // as server/view.mjs
/** Elements whose text the parser reads raw: an entity in them is not decoded. */
const RAWTEXT = new Set(['xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const sameTag = (el, tag) => el.tagName.toLowerCase() === tag.toLowerCase();
const kids = (n) => n.childNodes ?? [];
const WS = /[ \t\n\f\r]+/g;
/** An argument in an error message: quoted, and cut at 80 characters (security review of v2, 8). */
const shown = (v) => JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v);
/** The longest locator or name argument. */
export const MAX_ARG = 10_000;
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/** An element's line with all its attributes (v1's outline line keeps a few). */
export function fullHead(el) {
  const attrs = el.attrs.map((a) => {
    // A data: URI goes to fmtValue whole, which names its length; another long value is cut at a whole character.
    const v = a.value.length > MAX_VALUE_SHOWN && !/^data:/i.test(a.value) ? `${cutAt(a.value, MAX_VALUE_SHOWN)}…(${a.value.length} chars)` : a.value;
    return a.value === '' ? escTag(a.name) : `${escTag(a.name)}=${fmtValue(v)}`;
  });
  const line = `@${el.ref} ${escTag(el.tagName)}${attrs.length ? `(${attrs.join(' ')})` : ''}`;
  return line.length > LINE_CAP ? `${cutAt(line, LINE_CAP)}…(${line.length} chars)` : line;
}

/** The first n UTF-16 units of s, one less when the cut would split a surrogate pair (review of v2, 8). */
const cutAt = (s, n) => s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1] ?? '') ? n - 1 : n);

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

/**
 * The shown element with an id: exactly one, else a named error. A hidden element, one inside hidden content or SVG,
 * and a dropped element (`script`, `template`, ...) are not found, as html_find never matches hidden content
 * (contract, C0.2, 3; review of the v2 gate text, 9).
 */
function byId(m, id) {
  const els = m.els.filter((e) => m.shown.has(e) && e.attrs.some((a) => a.name === 'id' && a.value === id));
  if (!els.length) fail(`no element has the id ${shown(id)}`);
  if (els.length > 1) fail(`${els.length} elements have the id ${shown(id)}; give a ref:\n${linesOf(m, els).join('\n')}\nhash ${m.hash}`);
  return els[0];
}

/** html_find with an id: the element and its child elements, each with all its attributes. */
function findId(m, id) {
  const el = byId(m, id);
  // At most one page of output, with the real child count (security review of v2, 3).
  const children = kids(el).filter((c) => c.tagName);
  const lines = [fullHead(el)];
  let size = lines[0].length + 1;
  for (const c of children) {
    // A child that the outline does not show is listed by its ref and tag only, marked (hidden): its place keeps the
    // count of `child` and `n` right, and none of its attributes or text is shown.
    const l = m.shown.has(c) ? ` ${fullHead(c)}` : ` @${c.ref} ${escTag(c.tagName)} (hidden)`;
    if (size + l.length + 1 > PAGE_CHARS) { lines.push(`… output cut at ${PAGE_CHARS.toLocaleString('en-US')} characters`); break; }
    lines.push(l);
    size += l.length + 1;
  }
  return `${lines.join('\n')}\n1 match; ${children.length} child elements; hash ${m.hash}`;
}

/**
 * The elements that a text locator names: with no tag, html_find's deepest matches; with a tag, the innermost shown
 * elements of that tag whose visible text contains the text.
 */
export function textTargets(m, text, tag) {
  const { hit, matches } = textMatches(m, text);
  if (tag === undefined) return matches;
  const withTag = m.els.filter((e) => sameTag(e, tag) && hit(e));
  // Innermost: no other element of the tag inside it holds the text. Each match marks its ancestors of the tag as
  // not innermost; a walk stops at a marked ancestor, so the time is linear (review of v2, 6).
  const set = new Set(withTag);
  const outer = new Set();
  for (const e of withTag) {
    for (let p = m.parent.get(e); p && p.tagName; p = m.parent.get(p)) {
      if (!set.has(p)) continue;
      if (outer.has(p)) break;
      outer.add(p);
    }
  }
  return withTag.filter((e) => !outer.has(e));
}

/**
 * The element that html_change names: a ref with its hash, a text (and a tag), or an id (and a child tag and n). A
 * locator must name exactly 1 element; else a named error that lists the matches.
 */
export function locate(m, a) {
  const kinds = ['ref', 'text', 'id'].filter((k) => a[k] !== undefined);
  if (kinds.length !== 1) fail('give exactly one of "ref", "text" or "id"');
  if (a.tag !== undefined && a.text === undefined) fail('"tag" goes with "text"');
  if ((a.child !== undefined || a.n !== undefined) && a.id === undefined) fail('"child" and "n" go with "id"');
  if (a.n !== undefined && a.child === undefined) fail('"n" goes with "child"'); // review of v2, 3
  // A hash is required with a ref and checked with any locator: a change built from an older view must not
  // overwrite a newer file (security review of v2, 1).
  if (a.ref !== undefined && a.hash === undefined) fail('give "hash" with "ref"');
  if (a.hash !== undefined && a.hash !== m.hash) fail('the file changed since the hash');
  // Every target passes the clean-range check before any offset is read (security review of v2, 6).
  return element(m, pick(m, a).ref);
}

/** The element that a ref, a text or an id names, before the clean-range check. */
function pick(m, a) {
  if (a.ref !== undefined) return element(m, a.ref);
  if (a.text !== undefined) {
    const found = textTargets(m, a.text, a.tag);
    if (found.length !== 1) {
      if (!found.length) fail(`no element${a.tag ? ` of the tag ${shown(a.tag)}` : ''} contains the text`);
      fail(`${found.length} elements match; give a ref:\n${linesOf(m, found).join('\n')}\nhash ${m.hash}`);
    }
    return found[0];
  }
  const el = byId(m, a.id);
  if (a.child === undefined) return el;
  const n = a.n ?? 1;
  const list = kids(el).filter((c) => c.tagName && sameTag(c, a.child));
  if (n < 1 || n > list.length) fail(`the element with the id ${shown(a.id)} has ${list.length} child elements of the tag ${shown(a.child)}`);
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
  // A new attribute goes right after the tag name: at the end of the tag, a "/" can belong to an unquoted value
  // (`<a href=/docs/>`), so a cut before "/>" would change that value (review of v2, 1).
  const name0 = /^<[^\s/>]+/.exec(own)?.[0];
  if (!name0) fail('the element has no start tag in the file');
  return `${own.slice(0, name0.length)} ${pair}${own.slice(name0.length)}`;
}

/**
 * The element's source with a text replaced: `old` (whitespace runs count as one space) must occur exactly once in
 * the visible text nodes of the element, inside one text node.
 */
function replaceText(m, el, old, neu) {
  if (!old.isWellFormed() || !neu.isWellFormed()) fail('the old or new text holds a lone surrogate');
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
      // Only "exactly 1" matters, so the search stops at the second match (security review of v2, 4).
      for (let k = norm.indexOf(want); k !== -1 && found.length < 2; k = norm.indexOf(want, k + 1)) found.push({ n, a: pos[k][0], b: pos[k + want.length - 1][1] });
      if (found.length > 1) break;
      continue;
    }
    if (n.tagName && (NOT_VISIBLE.has(n.tagName) || hidden.has(n))) continue;
    for (const c of [...kids(n)].reverse()) stack.push(c);
  }
  if (found.length !== 1) fail(found.length ? 'the old text occurs more than once in the element' : 'the old text is not in one text node of the element');
  const { n, a, b } = found[0];
  // The parser drops a newline right after the start tag of pre, textarea and listing. A change that makes the text
  // start with a newline there would lose it (review of the v2 gate text, 5).
  const host = m.parent.get(n);
  if (['pre', 'textarea', 'listing'].includes(host?.tagName) && kids(host)[0] === n && a === 0 && /^[\n\r]/.test(neu + n.value.slice(b))) {
    fail(`the new text would start the ${host.tagName} element with a line break, which the parser drops`);
  }
  // In a RAWTEXT element the browser shows "&amp;" as it is written, so an escaped new text would show wrong
  // (review of v2, 5).
  if (RAWTEXT.has(m.parent.get(n)?.tagName)) fail(`the text is inside a ${m.parent.get(n).tagName} element, whose text the tool cannot change`);
  const map = charMap(m.text, n);
  if (!map) fail('the text cannot be mapped to its bytes in the file');
  // The old text must start and end at whole source characters: one reference such as "&fjlig;" decodes to 2
  // characters, and half of it cannot be replaced alone (review of v2, 4).
  if ((a > 0 && map[a - 1][0] === map[a][0]) || (b < map.length && map[b][0] === map[b - 1][0])) {
    fail('the old text starts or ends inside one character reference of the file');
  }
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
    case 'insert_after':
      // With an implied end tag (`<p>first<p>second`), new HTML after the element's bytes would go inside it
      // (review of v2, 2).
      if (!el.sourceCodeLocation.endTag && !VOID.has(el.tagName)) fail('the element has no end tag in the file, so new HTML after it would go inside it');
      return own + str('html');
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
  for (const k of ['file', 'hash', 'text', 'tag', 'id', 'child', 'attribute']) {
    if (a[k] !== undefined && a[k].length > MAX_ARG) fail(`the argument "${k}" is longer than ${MAX_ARG.toLocaleString('en-US')} characters`);
  }
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
  // The ref and the tag only: after set_attribute, the element's old attributes would mislead (review of v2, 8).
  const note = `@${el.ref} ${escTag(el.tagName)}`;
  return { write: { real: f.real, bytes: editBytes(m, f.bytes, el.ref, m.hash, html), oldHash: f.hash, id: f.id }, note };
}
