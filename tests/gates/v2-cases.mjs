// The fixed cases of C0.1 v2 (docs/contract.md, amendment "the gate text for the v2 tools", A.9): small files, each
// with one change and its expected result. A case names the negative control that it must make fail, where it has
// one. `target` names the element by its tag and its place among the elements of that tag (from 0); `locator` gives
// the locator arguments instead. `matches` names the elements that an ambiguous refusal must list. `expect` is
// "accept" or a refusal kind of EXPECT.

export const CASES = [
  { name: 'a new attribute on a tag whose unquoted value ends in "/"', html: '<p><a href=/docs/>Docs</a></p>',
    target: { tag: 'a', nth: 0 }, args: { operation: 'set_attribute', attribute: 'title', value: 't' }, expect: 'accept',
    control: 'set_attribute that adds before />' },
  { name: 'insert_after an unclosed p', html: '<body><p>first<p>second</body>',
    target: { tag: 'p', nth: 0 }, args: { operation: 'insert_after', html: '<b>new</b>' }, expect: 'noend',
    control: 'insert_after without the end-tag check' },
  { name: 'insert_after an unclosed li', html: '<ul><li>one<li>two</ul>',
    target: { tag: 'li', nth: 0 }, args: { operation: 'insert_after', html: 'plain text' }, expect: 'noend',
    control: 'insert_after without the end-tag check' },
  { name: 'replace_text with a bound inside one reference (&fjlig; is "fj")', html: '<p>x&fjlig;ord here</p>',
    target: { tag: 'p', nth: 0 }, args: { operation: 'replace_text', old: 'jord', new: 'x' }, expect: 'refbound',
    control: 'replace_text that ignores the bounds of a character reference' },
  { name: 'replace_text that would start a pre with a line break', html: '<pre>abc\ndef</pre>',
    target: { tag: 'pre', nth: 0 }, args: { operation: 'replace_text', old: 'abc', new: '' }, expect: 'linebreak' },
  { name: 'replace_text in xmp', html: '<xmp>Hello there</xmp>',
    target: { tag: 'xmp', nth: 0 }, args: { operation: 'replace_text', old: 'Hello', new: 'A & B' }, expect: 'rawtext' },
  { name: 'a text that 2 elements hold', html: '<div><p>same words here</p><p>same words here</p></div>',
    locator: { text: 'same words here' }, args: { operation: 'remove' }, expect: 'ambiguous', matches: { tag: 'p' },
    control: 'a text locator that takes the first of several matches' },
  { name: 'an id that 2 elements have', html: '<p id="x">1</p><p id="x">2</p>',
    locator: { id: 'x' }, args: { operation: 'remove' }, expect: 'ambiguousId', matches: { tag: 'p' } },
  { name: 'an id on a hidden element', html: '<div id="h" hidden>x</div><p>y</p>',
    locator: { id: 'h' }, args: { operation: 'remove' }, expect: 'noId' },
  { name: 'a legacy reference with no ";" before plain text', html: '<p>&copy2024 Acme</p>',
    target: { tag: 'p', nth: 0 }, args: { operation: 'replace_text', old: '2024', new: '2025' }, expect: 'accept' },
];

/** The error text of each expected refusal (after the "html_change: " prefix). */
export const EXPECT = {
  noend: /^the element has no end tag in the file/,
  refbound: /^the old text starts or ends inside one character reference/,
  linebreak: /line break, which the parser drops$/,
  rawtext: /^the text is inside a xmp element/,
  ambiguous: /^2 elements match; give a ref:/,
  ambiguousId: /^2 elements have the id "x"; give a ref:/,
  noId: /^no element has the id "h"$/,
};
