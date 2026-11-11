// POC: HTML <-> HIR, a compact text form of HTML for AI agents. Node standard library only.
// Deliberately simple first pass (cost: wrong trees for some real pages; replace with an HTML5 parser if the idea
// continues): the parser is tolerant but not HTML5-complete. It does not imply end tags (</p>, </li>, </td>).
//
// HIR syntax, one node per line, one space of indent per level:
//   tag#id{class list}(attr=value attr2="a b" bool) inline content
//   - The tag is "div" when a line starts with "#" or "{".
//   - Inline content is HTML, kept as is; HIR uses it only for text and inline elements without attributes.
//   - "| text" is a text node, "// text" a comment, "!doctype html" a doctype.
//   - "tag." with deeper lines below it keeps the content verbatim (script, style, pre, textarea).

export const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
const RAW_PARSE = new Set(['script', 'style', 'textarea', 'title']); // the parser reads their content as text
const VERBATIM = new Set(['script', 'style', 'textarea', 'pre']); // HIR keeps their content as a block
const KEEP_WS = new Set(['pre', 'textarea', 'script', 'style']);
export const INLINE = new Set(('a abbr b bdi bdo br cite code data dfn em i img input kbd label mark q s samp small ' +
  'span strong sub sup time u var wbr').split(' '));
// Elements that sit in a line of text: whitespace next to them is kept. HIR still gives them their own line.
const IN_TEXT = new Set([...INLINE, ...'button select textarea svg math script noscript template iframe video audio canvas object picture'.split(' ')]);
// HTML's whitespace is ASCII only. JavaScript's \s also matches U+00A0, which HTML keeps as a no-break space.
const WS = /[ \t\n\f\r]+/g;
export const MAX_DEPTH = 512; // deeper input fails with a named error, not a stack overflow
export const MAX_CHARS = 20_000_000;

// ---------- HTML -> tree ----------
export function parse(html) {
  if (html.length > MAX_CHARS) throw new Error(`HTML: input has ${html.length} characters; the limit is ${MAX_CHARS}`);
  html = html.replace(/\r\n?/g, '\n');
  const lower = html.toLowerCase();
  const root = { type: 'root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (value) => {
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.type === 'text') last.value += value;
    else kids.push({ type: 'text', value });
  };
  const n = html.length;
  let i = 0;
  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const e = html.indexOf('-->', i + 4);
      top().children.push({ type: 'comment', value: html.slice(i + 4, e < 0 ? n : e) });
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html[i] === '<' && html[i + 1] === '!') {
      const e = html.indexOf('>', i);
      top().children.push({ type: 'doctype', value: html.slice(i + 2, e < 0 ? n : e) });
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (html[i] === '<' && html[i + 1] === '/') {
      const re = /<\/([a-zA-Z][\w:-]*)\s*>/y;
      re.lastIndex = i;
      const m = re.exec(html);
      if (m) {
        const tag = m[1].toLowerCase();
        // An end tag with no open element of that name is ignored, as browsers do.
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
        i = re.lastIndex;
        continue;
      }
    }
    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] ?? '')) {
      // The unquoted value excludes quotes, so a quoted value matches one way only (no exponential backtracking).
      const re = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
      re.lastIndex = i;
      const m = re.exec(html);
      if (m) {
        const tag = m[1].toLowerCase();
        const el = { type: 'el', tag, attrs: parseAttrs(m[2]), children: [] };
        top().children.push(el);
        i = re.lastIndex;
        if (RAW_PARSE.has(tag)) {
          let e = lower.indexOf('</' + tag, i);
          if (e < 0) e = n;
          if (e > i) el.children.push({ type: 'text', value: html.slice(i, e) });
          const gt = html.indexOf('>', e);
          i = gt < 0 ? n : gt + 1;
        } else if (!VOID.has(tag) && !m[3]) {
          if (stack.length > MAX_DEPTH) throw new Error(`HTML: elements nest deeper than ${MAX_DEPTH} levels`);
          stack.push(el);
        }
        continue;
      }
    }
    let j = html.indexOf('<', i + 1);
    if (j < 0) j = n;
    pushText(html.slice(i, j));
    i = j;
  }
  return root;
}

function parseAttrs(s) {
  const out = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? null]);
  return out;
}

// ---------- tree -> HTML ----------
const quote = (v) => (v.includes('"') ? `'${v}'` : `"${v}"`);
export function toHTML(node) {
  switch (node.type) {
    case 'root': return node.children.map(toHTML).join('');
    case 'text': return node.value;
    case 'comment': return `<!--${node.value}-->`;
    case 'doctype': return `<!${node.value}>`;
    default: {
      const a = node.attrs.map(([k, v]) => (v === null ? ' ' + k : ` ${k}=${quote(v)}`)).join('');
      if (VOID.has(node.tag)) return `<${node.tag}${a}>`;
      return `<${node.tag}${a}>${node.children.map(toHTML).join('')}</${node.tag}>`;
    }
  }
}

// ---------- canonical form: removes whitespace that does not change rendering ----------
export function canon(node, keepWs = false) {
  if (!node.children) return node;
  const kw = keepWs || (node.type === 'el' && KEEP_WS.has(node.tag));
  let kids = node.children.map((c) => {
    if (c.type === 'text') return { type: 'text', value: kw ? c.value : c.value.replace(WS, ' ') };
    if (c.type === 'comment' || c.type === 'doctype') return { type: c.type, value: c.value.replace(WS, ' ').trim() };
    if (c.type === 'el') {
      // The DOM keeps the first copy of an attribute, so later copies go.
      const seen = new Set();
      const attrs = c.attrs.filter(([k]) => !seen.has(k) && seen.add(k)).map(([k, v]) => [k, v === null ? v
        : k === 'class' ? v.replace(WS, ' ').trim()
        // HIR is line-based, so a line break becomes "&#10;". A value with both quote kinds gets "&quot;".
        // Both give the same value in the DOM.
        : (v.includes('"') && v.includes("'") ? v.replace(/"/g, '&quot;') : v).replace(/\n/g, '&#10;')]);
      return canon({ ...c, attrs }, kw);
    }
    return c;
  });
  if (!kw) {
    const blockParent = !(node.type === 'el' && IN_TEXT.has(node.tag));
    const isBlock = (k) => k && k.type === 'el' && !IN_TEXT.has(k.tag);
    kids = kids.map((k, idx) => {
      if (k.type !== 'text') return k;
      let v = k.value;
      const prev = kids[idx - 1], next = kids[idx + 1];
      if ((!prev && blockParent) || isBlock(prev)) v = v.trimStart();
      if ((!next && blockParent) || isBlock(next)) v = v.trimEnd();
      return { type: 'text', value: v };
    }).filter((k) => k.type !== 'text' || k.value !== '');
  }
  return { ...node, children: kids };
}

// ---------- tree -> HIR ----------
const SAFE_ID = /^[\w:\/%-]+$/;
const phrasing = (n) => n.type === 'text' ||
  (n.type === 'el' && INLINE.has(n.tag) && !n.attrs.length && n.children.every(phrasing));
const fmtAttr = ([k, v]) => {
  if (!/^[^\s=()"']+$/.test(k)) throw new Error(`HIR cannot hold the attribute name ${JSON.stringify(k)}`);
  return v === null ? k : v === '' ? `${k}=""` : /^[^\s()"']+$/.test(v) ? `${k}=${v}` : `${k}=${quote(v)}`;
};

function head(el) {
  let id = null, cls = null;
  const rest = [];
  for (const [k, v] of el.attrs) {
    if (k === 'id' && id === null && v && SAFE_ID.test(v)) id = v;
    else if (k === 'class' && cls === null && v && !/[{}]/.test(v)) cls = v;
    else rest.push([k, v]);
  }
  const tag = el.tag === 'div' && (id || cls) ? '' : el.tag;
  return tag + (id ? '#' + id : '') + (cls ? '{' + cls + '}' : '') +
    (rest.length ? '(' + rest.map(fmtAttr).join(' ') + ')' : '');
}

// refs: true prefixes each element line with "@n", the element's number in the full tree (see number()).
export function encode(root, { refs = false } = {}) {
  const out = [];
  const enc = (node, d) => {
    const ind = ' '.repeat(d);
    if (node.type === 'text') return out.push(ind + '| ' + node.value);
    if (node.type === 'comment') return out.push(ind + '// ' + node.value);
    if (node.type === 'doctype') return out.push(ind + '!' + node.value);
    const h = (refs && node.ref !== undefined ? '@' + node.ref + ' ' : '') + head(node);
    if (VERBATIM.has(node.tag) && node.children.length) {
      out.push(ind + h + '.');
      const body = node.children.map(toHTML).join('');
      for (const line of body.split('\n')) out.push(line ? ind + ' ' + line : '');
      return;
    }
    if (!node.children.length) return out.push(ind + h);
    if (node.children.every(phrasing)) return out.push(ind + h + ' ' + node.children.map(toHTML).join(''));
    out.push(ind + h);
    for (const c of node.children) enc(c, d + 1);
  };
  for (const c of root.children) enc(c, 0);
  return out.join('\n');
}

// ---------- HIR -> tree ----------
function parseHead(s) {
  const m = /^([a-zA-Z][\w:-]*)?(#[\w:\/%-]+)?/.exec(s);
  const attrs = [];
  if (m[2]) attrs.push(['id', m[2].slice(1)]);
  let i = m[0].length;
  if (s[i] === '{') {
    const e = s.indexOf('}', i);
    if (e < 0) throw new Error(`HIR: "{" without "}": ${s}`);
    attrs.push(['class', s.slice(i + 1, e)]);
    i = e + 1;
  }
  if (!m[1] && !attrs.length) {
    throw new Error(`HIR: a line must start with a tag, "#id", "{class}", "| ", "// " or "!": ${s}`);
  }
  if (s[i] === '(') {
    i++;
    for (;;) {
      while (s[i] === ' ') i++;
      if (s[i] === ')') { i++; break; }
      if (i >= s.length) throw new Error(`HIR: "(" without ")": ${s}`);
      const km = /[^\s=()"']+/y;
      km.lastIndex = i;
      const km0 = km.exec(s);
      if (!km0) throw new Error(`HIR: an attribute name is missing at character ${i + 1}: ${s}`);
      const k = km0[0];
      i = km.lastIndex;
      if (s[i] !== '=') { attrs.push([k, null]); continue; }
      i++;
      if (s[i] === '"' || s[i] === "'") {
        const e = s.indexOf(s[i], i + 1);
        if (e < 0) throw new Error(`HIR: unclosed quote: ${s}`);
        attrs.push([k, s.slice(i + 1, e)]);
        i = e + 1;
        if (s[i] !== ' ' && s[i] !== ')') throw new Error(`HIR: a space or ")" must follow a quoted value: ${s}`);
      } else {
        const vm = /[^\s()]*/y;
        vm.lastIndex = i;
        attrs.push([k, vm.exec(s)[0]]);
        i = vm.lastIndex;
      }
    }
  }
  // After the head: nothing, "." (a verbatim block follows), or a space and inline content. Inline content can
  // itself be "." (regression: a <span> whose text was "." was read as a verbatim block).
  const tail = s.slice(i);
  if (tail !== '' && tail !== '.' && tail[0] !== ' ') throw new Error(`HIR: unexpected text after the element head: ${s}`);
  const el = { type: 'el', tag: m[1] ? m[1].toLowerCase() : 'div', attrs, children: [] };
  return { el, verbatim: tail === '.', content: tail[0] === ' ' ? tail.slice(1) : null };
}

const indentOf = (line) => line.length - line.replace(/^ +/, '').length;

export function decode(hir) {
  const lines = hir.replace(/\r\n?/g, '\n').split('\n');
  const root = { type: 'root', children: [] };
  const stack = [{ node: root, d: -1 }];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const d = indentOf(line);
    if (d > MAX_DEPTH) throw new Error(`HIR: line ${li + 1} nests deeper than ${MAX_DEPTH} levels`);
    const s = line.slice(d);
    while (stack[stack.length - 1].d >= d) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (s === '|' || s.startsWith('| ')) { parent.children.push({ type: 'text', value: s.slice(2) }); continue; }
    if (s.startsWith('//')) { parent.children.push({ type: 'comment', value: s.slice(3) }); continue; }
    if (s[0] === '!') { parent.children.push({ type: 'doctype', value: s.slice(1) }); continue; }
    const { el, verbatim, content } = parseHead(s);
    parent.children.push(el);
    if (verbatim) {
      const body = [];
      while (li + 1 < lines.length && (lines[li + 1] === '' || indentOf(lines[li + 1]) > d)) {
        li++;
        body.push(lines[li] === '' ? '' : lines[li].slice(d + 1));
      }
      const text = body.join('\n');
      if (RAW_PARSE.has(el.tag)) el.children.push({ type: 'text', value: text });
      else el.children.push(...parse(text).children);
    } else if (content !== null) {
      // title has no child elements in HTML: its content is text, also when it looks like markup.
      if (RAW_PARSE.has(el.tag)) el.children.push({ type: 'text', value: content });
      else el.children.push(...parse(content).children);
    }
    stack.push({ node: el, d });
  }
  return root;
}

// ---------- the reading view: lossy, for an agent that reads a page ----------
// Gives each element of the full tree its number (preorder), so a ref in the view finds the node in the real page.
export function number(root) {
  let n = 0;
  const walk = (node) => {
    if (node.type === 'el') node.ref = n++;
    node.children?.forEach(walk);
  };
  walk(root);
  return root;
}

export const DROP_EL = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta']);
export const KEEP_ATTR = new Set(('id href src alt title type name value placeholder for role aria-label action ' +
  'method lang checked selected disabled required colspan rowspan').split(' '));
export function view(node) {
  if (!node.children) return node;
  const kids = [];
  for (const c of node.children) {
    if (c.type === 'comment') continue;
    if (c.type === 'el') {
      if (DROP_EL.has(c.tag)) continue;
      const attrs = c.attrs.filter(([k]) => KEEP_ATTR.has(k));
      if (c.tag === 'svg') { kids.push({ ...c, attrs, children: [] }); continue; }
      kids.push(view({ ...c, attrs }));
    } else kids.push(c);
  }
  return { ...node, children: kids };
}

// A string that is equal for two trees with the same DOM. Attribute order is ignored: it has no meaning in the DOM.
// It uses a loop, not recursion, so that deep trees do not overflow the stack.
export function key(root) {
  const out = [];
  const todo = [root];
  while (todo.length) {
    const n = todo.pop();
    if (n === null) { out.push(')'); continue; }
    if (n.type !== 'el' && n.type !== 'root') { out.push(JSON.stringify([n.type, n.value])); continue; }
    const attrs = n.attrs ? [...n.attrs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : [];
    out.push('(' + JSON.stringify([n.tag ?? n.type, attrs]));
    todo.push(null);
    for (let i = n.children.length - 1; i >= 0; i--) todo.push(n.children[i]);
  }
  return out.join('');
}
