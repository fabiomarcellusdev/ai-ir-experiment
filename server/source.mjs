// The source of a text node: for each UTF-16 unit of its value, the source range it comes from (decision 0008, the
// operation replace_text). Character references and CR LF give one range for several source characters. A second
// copy of experiments/c07/rules.mjs's `charMap`; the task rules keep their own frozen copy.
import { parseFragment } from 'parse5';

/** The decoded text of one character reference, through the parser itself; null when it is not a reference. */
function decodeRef(ref) {
  const v = parseFragment(ref).childNodes[0]?.value;
  return v === undefined || v === ref ? null : v;
}

/**
 * The source range of each UTF-16 unit of a text node's value, or null when the source does not give the value
 * exactly (for example, the newline that the parser drops after `<pre>` or `<textarea>`).
 * @param {string} text the file's text @param {object} tn a parse5 text node with its source location
 */
export function charMap(text, tn) {
  const loc = tn.sourceCodeLocation;
  if (!loc) return null;
  const src = text.slice(loc.startOffset, loc.endOffset);
  const out = [];
  let v = '';
  const push = (s, a, b) => { for (let k = 0; k < s.length; k++) out.push([loc.startOffset + a, loc.startOffset + b]); v += s; };
  for (let i = 0; i < src.length;) {
    if (src[i] === '&') {
      const r = /^&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/.exec(src.slice(i, i + 40));
      const d = r && decodeRef(r[0]);
      if (d !== null && d !== undefined) {
        // A legacy reference with no ";" ends before the text that follows it: "&copy2024" is "&copy" (©) and the
        // plain text "2024". The parser keeps that text as written, so it is the common end of source and decoded.
        let k = 0;
        while (k < d.length - 1 && k < r[0].length - 1 && d[d.length - 1 - k] === r[0][r[0].length - 1 - k]) k++;
        const len = r[0].length - k;
        push(d.slice(0, d.length - k), i, i + len);
        i += len;
        continue;
      }
    }
    if (src[i] === '\r') { const n = src[i + 1] === '\n' ? 2 : 1; push('\n', i, i + n); i += n; continue; }
    const ch = String.fromCodePoint(src.codePointAt(i));
    push(ch, i, i + ch.length);
    i += ch.length;
  }
  return v === tn.value ? out : null;
}
