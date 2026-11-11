import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, canon, toHTML, encode, decode, view, number, key, MAX_DEPTH } from './ir.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// The round trip HTML -> HIR -> HTML keeps the canonical DOM. Attribute order is ignored (key()).
function roundTrip(html) {
  const tree = canon(parse(html));
  const hir = encode(tree);
  const back = decode(hir);
  assert.equal(key(canon(parse(toHTML(back)))), key(tree), `round trip changed the tree. HIR:\n${hir}`);
  assert.equal(encode(canon(back)), hir, 'encode is not idempotent');
  return hir;
}

test('each sample page survives the round trip', () => {
  const dir = join(here, 'samples');
  const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.ok(files.length >= 3);
  for (const f of files) roundTrip(readFileSync(join(dir, f), 'utf8'));
});

test('the syntax: tag, id, class group, attributes, inline content', () => {
  const hir = roundTrip('<nav id="top" class="a  b"><a href="/x" title="A b">Go <b>now</b></a><p>Hi <em>there</em></p></nav>');
  assert.equal(hir, 'nav#top{a b}\n a(href=/x title="A b") Go <b>now</b>\n p Hi <em>there</em>');
});

test('a div with an id or a class has no tag name', () => {
  assert.equal(roundTrip('<div class="card"><div id="x">t</div></div>'), '{card}\n #x t');
});

test('regression: inline content "." is not a verbatim block', () => {
  // Fails with the bug put back: the decoder read "span(about=x) ." as "span." and lost the text.
  assert.equal(roundTrip('<p>a<span about="x">.</span></p>'), 'p\n | a\n span(about=x) .');
});

test('regression: a line break in an attribute value survives', () => {
  // Fails with the bug put back: the value broke the line and decode threw "unclosed quote".
  roundTrip('<button data-copy="line 1\nline 2">Copy</button>');
});

test('verbatim blocks keep script, style and pre content exactly', () => {
  const html = '<pre><code>  a\n\n    b &lt; c\n</code></pre><script>if (a < b) {\n  go();\n}</script><style>p{x:1}</style>';
  const hir = roundTrip(html);
  assert.ok(hir.includes('script.\n if (a < b) {\n   go();\n }'));
});

test('hostile input: empty, BOM, CRLF, characters outside the BMP, lone surrogate, odd markup', () => {
  for (const html of ['', '   ', '﻿<p>bom</p>', '<p>a\r\nb</p>\r\n', '<p>😀 𝔘 é</p>', '<p>\uD800 lone</p>',
    '<p>a < b and c > d</p>', '</div><p>stray end tag</p>', '<p>unclosed', '<!-- only a comment -->',
    '<p data-x=\'say "hi"\'>q</p>', '<input disabled value="">', '<p>{not} (a) #head | .</p>', '<b>  spaced  </b>']) {
    roundTrip(html);
  }
});

test('hostile input: nesting up to the limit works; deeper fails with a named error', () => {
  roundTrip('<div>'.repeat(MAX_DEPTH) + 'deep' + '</div>'.repeat(MAX_DEPTH));
  assert.throws(() => parse('<div>'.repeat(MAX_DEPTH + 1)), /nest deeper than 512/);
  assert.throws(() => decode('p\n' + ' '.repeat(MAX_DEPTH + 1) + 'p'), /line 2 nests deeper than 512/);
});

test('regression: attribute lists do not backtrack exponentially', () => {
  // Fails with the bug put back: each input took hours (2^40 paths) with an unquoted value that matched quotes.
  for (const html of ['<a' + ' x="1"'.repeat(40), '<p><a' + ' x="1"'.repeat(40) + ' "bad">l</a></p>']) {
    const t0 = performance.now();
    parse(html);
    assert.ok(performance.now() - t0 < 1000, 'parse took more than 1 s');
  }
});

test('regressions from review: doctype, title, quotes, duplicates, whitespace', () => {
  roundTrip('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN"\n "http://www.w3.org/TR/xhtml1/DTD/xhtml1.dtd"><p>x</p>');
  roundTrip('<title>Use <div> tags <!-- c --></title>');
  roundTrip('<p title=a"b\'c>x</p>');
  assert.equal(encode(canon(parse('<div id="a" id="c" class="x" class="y">t</div>'))), '#a{x} t');
  assert.equal(encode(canon(parse('<p>10 km and <b>a b</b></p>'))), 'p 10 km and <b>a b</b>');
  assert.equal(toHTML(canon(parse('<p>Hello <!-- x --> world <button>OK</button> go</p>'))),
    '<p>Hello <!--x--> world <button>OK</button> go</p>');
});

test('an attribute name that HIR cannot hold fails with a named error', () => {
  assert.throws(() => encode(canon(parse('<button (click)="go()">x</button>'))), /cannot hold the attribute name "\(click\)"/);
});

test('negative control: key() notices a changed value, text, child order and tag', () => {
  const base = key(canon(parse('<p a="1">x<b>y</b></p>')));
  for (const other of ['<p a="2">x<b>y</b></p>', '<p a="1">z<b>y</b></p>', '<p a="1"><b>y</b>x</p>',
    '<p a="1">x<i>y</i></p>', '<p a="1" b>x<b>y</b></p>', '<p>x<b>y</b></p>']) {
    assert.notEqual(key(canon(parse(other))), base, other);
  }
  assert.equal(key(canon(parse('<p b a="1">x</p>'))), key(canon(parse('<p a="1" b>x</p>'))), 'attribute order counts');
});

test('malformed HIR fails with a message that names the line', () => {
  for (const [bad, msg] of [['nav(href="x', /unclosed quote/], ['nav(a=b', /without "\)"/], ['{a b', /without "}"/],
    ['123 text', /must start with/], ['"quoted"', /must start with/], ['Hello, world', /unexpected text/],
    ['a(href=x)y', /unexpected text/], ['p(=x)', /attribute name is missing/], ['p((a))', /attribute name is missing/],
    ['p(a="x"y)', /must follow a quoted value/]]) {
    assert.throws(() => decode(bad), msg, bad);
  }
});

test('known risk: a text line without "| " becomes an element, with no error', () => {
  // Recorded in docs/follow-ups.md. An agent that forgets "| " gets <click>here</click>, not the text "Click here".
  assert.equal(toHTML(decode('p\n Click here')), '<p><click>here</click></p>');
});

test('property: random trees survive the round trip', () => {
  let seed = 12345;
  // The low bits of this generator repeat in a short cycle, so use the high bits.
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % n; };
  const pick = (a) => a[rnd(a.length)];
  const TAGS = ['div', 'p', 'span', 'a', 'b', 'ul', 'li', 'section', 'em', 'code', 'td', 'pre', 'script', 'title',
    'br', 'img', 'button', 'svg'];
  const TEXT = ['x', ' y ', '.', '| bar', '// c', '{c}', '(p)', '#h', 'a&amp;b', '😀', '  ', 'end.', 'a b', '\n\tz'];
  const VALUES = ['v', 'a b', 'x"y', "it's", '', '(x)', 'a\nb', '#id', '{c}', 'q"r\'s', 'n b'];
  const gen = (depth) => {
    if (!rnd(12)) return { type: 'comment', value: pick([' note ', 'a\nb', '']) };
    const tag = pick(TAGS);
    const attrs = [];
    for (let i = rnd(3); i > 0; i--) attrs.push([pick(['id', 'class', 'href', 'data-k', 'title']), rnd(4) ? pick(VALUES) : null]);
    const unique = [...new Map(attrs.map((a) => [a[0], a])).values()];
    if (tag === 'script') return { type: 'el', tag, attrs: unique, children: [{ type: 'text', value: 'f(1);\n  g();' }] };
    if (tag === 'title') return { type: 'el', tag, attrs: unique, children: [{ type: 'text', value: 'a <div> b' }] };
    if (tag === 'br' || tag === 'img') return { type: 'el', tag, attrs: unique, children: [] };
    const children = [];
    for (let i = depth > 4 ? 0 : rnd(4); i > 0; i--) {
      children.push(rnd(2) ? { type: 'text', value: pick(TEXT) } : gen(depth + 1));
    }
    return { type: 'el', tag, attrs: unique, children };
  };
  for (let i = 0; i < 500; i++) roundTrip(toHTML({ type: 'root', children: [gen(0), gen(0)] }));
});

test('the reading view drops scripts, styles, classes and SVG content, and keeps the refs of the full tree', () => {
  const html = '<head><meta charset="utf-8"><style>p{}</style></head><body><!-- c --><p class="x" data-t="1">Hi</p>' +
    '<svg viewBox="0 0 1 1"><path d="M0"/></svg><a href="/go" class="btn">Go</a><script>t()</script></body>';
  const full = number(canon(parse(html)));
  const out = encode(canon(view(full)), { refs: true });
  assert.equal(out, '@0 head\n@3 body\n @4 p Hi\n @5 svg\n @7 a(href=/go) Go');
  // The ref in the view finds the same element in the full tree.
  const byRef = [];
  const walk = (n) => { if (n.type === 'el') byRef[n.ref] = n; n.children?.forEach(walk); };
  walk(full);
  assert.equal(byRef[7].tag, 'a');
  assert.deepEqual(byRef[7].attrs, [['href', '/go'], ['class', 'btn']]);
});
