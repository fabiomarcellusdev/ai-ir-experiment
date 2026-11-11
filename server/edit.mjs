// html_edit: the splice and the check after it (decision 0006, "The edit", and its amendment of 2026-11-11). This
// module does no file access: it returns the new bytes, and the main thread writes them.
import { serialize, serializeOuter } from 'parse5';
import { fail } from './errors.mjs';
import { element, parseDoc, depthOf, MAX_DEPTH } from './view.mjs';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ROOTS = new Set(['html', 'head', 'body']);

const isText = (n) => n?.nodeName === '#text';
/** Two nodes are equal when their text, or their serialized subtrees, are equal. */
const same = (a, b) => (isText(a) ? isText(b) && a.value === b.value : !!b && !isText(b) && serializeOuter(a) === serializeOuter(b));

/**
 * Whether the parse of the new text keeps the old tree outside the element. The new nodes in the element's place can
 * be anything. Text next to the element can merge with new text, so a neighbour text node may grow at its inner end.
 * @param {ReturnType<import('./view.mjs').load>} m @param {object} el @param {object} doc2 the parse of the new text
 */
export function outsideKept(m, el, doc2) {
  const P = m.parent.get(el);
  // 1. The same path of child indexes leads to the parent's twin.
  const path = [];
  for (let n = P; m.parent.get(n); n = m.parent.get(n)) path.push(m.parent.get(n).childNodes.indexOf(n));
  let Q = doc2;
  for (const i of path.reverse()) {
    Q = Q.childNodes?.[i];
    if (!Q) return false;
  }
  // 2. Everything outside the parent's children is equal.
  const O = P.childNodes;
  const N = Q.childNodes ?? [];
  const mark = { nodeName: '#comment', data: 'html_edit', parentNode: null };
  P.childNodes = [mark];
  Q.childNodes = [mark];
  let ok;
  try {
    ok = serialize(m.doc) === serialize(doc2);
  } finally {
    P.childNodes = O;
    Q.childNodes = N;
  }
  if (!ok) return false;
  // 3. The siblings before and after the element are equal, except for text that merges at the element's place.
  const k = O.indexOf(el);
  const before = O.slice(0, k);
  const after = O.slice(k + 1);
  for (let j = 0; j < before.length; j++) {
    const a = before[j];
    const b = N[j];
    if (j === before.length - 1 && isText(a)) { if (!isText(b) || !b.value.startsWith(a.value)) return false; }
    else if (!same(a, b)) return false;
  }
  for (let j = 0; j < after.length; j++) {
    const a = after[after.length - 1 - j];
    const b = N[N.length - 1 - j];
    if (j === after.length - 1 && isText(a)) { if (!isText(b) || !b.value.endsWith(a.value)) return false; }
    else if (!same(a, b)) return false;
  }
  const start = N.length - after.length;
  if (start >= before.length) return true;
  // One text node holds the end of the text before, the new text, and the start of the text after.
  const t = N[before.length - 1];
  return start === before.length - 1 && isText(before.at(-1)) && isText(after[0]) &&
    t.value.length >= before.at(-1).value.length + after[0].value.length;
}

/**
 * The new bytes of the file after one element is replaced by `html`.
 * @param {ReturnType<import('./view.mjs').load>} m @param {Buffer} bytes @param {number} ref
 * @param {string} hash @param {string} html
 */
export function editBytes(m, bytes, ref, hash, html) {
  if (hash !== m.hash) fail('the file changed since the hash');
  if (typeof html !== 'string') fail('the new HTML is not a string');
  if (!html.isWellFormed()) fail('the new HTML holds a lone surrogate');
  const el = element(m, ref);
  if (ROOTS.has(el.tagName) && el.namespaceURI === HTML_NS) fail('the html, head and body elements cannot be edited');

  const { startOffset: s, endOffset: e } = el.sourceCodeLocation;
  const newText = m.text.slice(0, s) + html + m.text.slice(e);
  const doc2 = parseDoc(newText);
  // Before any serialize: parse5's serializer is recursive (review, finding 3).
  if (depthOf(doc2) > MAX_DEPTH) fail(`the result nests elements deeper than ${MAX_DEPTH} levels`);
  if (!outsideKept(m, el, doc2)) fail('the new HTML changes the document outside the element');

  const bs = Buffer.byteLength(m.text.slice(0, s));
  const be = bs + Buffer.byteLength(m.text.slice(s, e));
  return Buffer.concat([bytes.subarray(0, bs), Buffer.from(html, 'utf8'), bytes.subarray(be)]);
}
