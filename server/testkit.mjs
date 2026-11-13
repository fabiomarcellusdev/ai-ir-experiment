// Test helpers for the server's tests: a seeded generator and random HTML with the hard parts of the parser
// (misnesting, hidden content, raw text, tables, comments, entities, whitespace). Not used by the server.

/** mulberry32: a small seeded generator, so each property test can be repeated. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

const WORDS = ['alpha', 'beta', 'Gamma', 'x', 'a b', '  ', '\n', ' \t ', '\r\n', '&amp;', '&lt;b&gt;', ' ', 'é',
  '\u{1F600}', 'ab', 'a  b', '@3 div', '| x', 'x <', 'b>y'];
const OPEN = ['div', 'p', 'span', 'b', 'i', 'a href="/x"', 'ul', 'li', 'table', 'tr', 'td', 'pre', 'textarea',
  'section', 'h2', 'button', 'select', 'option', 'svg', 'template', 'script', 'style', 'noscript', 'title', 'em'];
const ATTRS = ['', '', '', ' hidden', ' aria-hidden="true"', ' style="display: none"', ' style="visibility:hidden"',
  ' class="c"', ' id="k"', ' title="t\nu"', ' id="a b"', ' alt=\'q"s\'', ' href="data:image/png;base64,' +
  'A'.repeat(120) + '"'];

/** Random HTML of about `size` tokens. */
export function randomHtml(rnd, size) {
  let out = rnd() < 0.5 ? '<!DOCTYPE html><html><head><title>t</title></head><body>' : '';
  const open = [];
  for (let i = 0; i < size; i++) {
    const r = rnd();
    if (r < 0.35) out += pick(rnd, WORDS);
    else if (r < 0.65) {
      const t = pick(rnd, OPEN);
      out += `<${t}${pick(rnd, ATTRS)}>`;
      open.push(t.split(' ')[0]);
    } else if (r < 0.85 && open.length) out += `</${open.pop()}>`;
    else if (r < 0.88) out += '<input type="hidden" value="h">';
    else if (r < 0.91) out += '<!-- c -->';
    else if (r < 0.94) out += '</b>';
    else if (r < 0.97) out += '<br>';
    else out += '<p>';
  }
  return out;
}
