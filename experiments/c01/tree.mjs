// The parse5 tree as the oracle's token list (experiments/c01/oracle.py, `tokens`), so that the run can name each file
// where html5lib and parse5 disagree (decision 0006, "The oracle check for C0.1"). No recursion.
const kids = (n) => (n.tagName === 'template' && n.namespaceURI === 'http://www.w3.org/1999/xhtml' ? n.content.childNodes : n.childNodes ?? []);

/**
 * The tokens of a parse5 document: ["d", name, public, system], ["c", data], ["t", text], ["o", namespace, name,
 * attributes], ["x"]. Attributes are [namespace, name, value], sorted. Adjacent text is one token, as in html5lib.
 * @param {object} doc
 */
export function tokens(doc) {
  const out = [];
  const push = (t) => {
    const last = out.at(-1);
    if (t[0] === 't' && last?.[0] === 't') last[1] += t[1];
    else out.push(t);
  };
  for (const stack = [...kids(doc)].reverse().map((n) => [n, false]); stack.length;) {
    const [n, end] = stack.pop();
    if (end) { push(['x']); continue; }
    if (n.nodeName === '#text') { if (n.value) push(['t', n.value]); continue; }
    if (n.nodeName === '#comment') { push(['c', n.data]); continue; }
    if (n.nodeName === '#documentType') { push(['d', n.name ?? '', n.publicId ?? '', n.systemId ?? '']); continue; }
    const attrs = n.attrs.map((a) => [a.namespace ?? '', a.name, a.value]).sort(cmp);
    push(['o', n.namespaceURI, n.tagName, attrs]);
    stack.push([n, true]);
    for (const c of [...kids(n)].reverse()) stack.push([c, false]);
  }
  return out;
}

/** Python's order of lists of strings: by code point, item by item. */
function cmp(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return codePointLess(a[i], b[i]) ? -1 : 1;
  }
  return a.length - b.length;
}

function codePointLess(x, y) {
  const a = [...x];
  const b = [...y];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i].codePointAt(0) < b[i].codePointAt(0);
  }
  return a.length < b.length;
}
