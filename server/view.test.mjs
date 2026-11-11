import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as proto from '../experiments/c03/html.mjs';
import { load, outlinePage, findText, readRef, pageCount, MAX_DEPTH, LINE_CAP, cssPlain } from './view.mjs';
import { ToolError } from './errors.mjs';
import { rng, pick, randomHtml } from './testkit.mjs';

const H = 'h';
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof ToolError && re.test(e.message));
const LINE = /^ *(@\d+ |\| )/;
// Every character that a reader can take as a line break (decision 0006, safety fix 1).
const ANY_BREAK = /\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/;

const pagesOf = (m) => Array.from({ length: pageCount(m) }, (_, i) => outlinePage(m, i + 1));

// The server's lines equal the prototype's, except where a safety fix changed a line: an escaped character in a tag
// name, text or value, or a line cut at LINE_CAP. Such a line must decode to the prototype's line, or start with it
// before the cut. When no line changed, the pages are equal too. Returns the number of changed lines.
const decode = (s) => s.replace(/&#x([0-9a-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function sameAsPrototype(m, p, label) {
  const ours = pagesOf(m);
  const theirs = proto.outlinePages(p);
  const lines = (pages) => pages.flatMap((x) => x.split('\n').slice(1));
  const a = lines(ours);
  const b = lines(theirs);
  assert.equal(a.length, b.length, label);
  let changed = 0;
  a.forEach((l, i) => {
    if (l === b[i]) return;
    changed++;
    const cut = l.match(/^(.*)…\((\d+) chars\)$/s);
    if (cut) assert.ok(decode(b[i]).startsWith(decode(cut[1])), `${label}: line ${i}`);
    else assert.equal(decode(l), b[i], `${label}: line ${i}`);
  });
  if (!changed) assert.deepEqual(ours, theirs, label);
  return changed;
}

test('the outline, find and read equal the prototype on random HTML (300 files, seed 6)', () => {
  const rnd = rng(6);
  for (let i = 0; i < 300; i++) {
    const src = randomHtml(rnd, 10 + Math.floor(rnd() * 120));
    const p = proto.load(src);
    const m = load(src, p.hash);
    sameAsPrototype(m, p, src);
    const texts = ['x', ' ', 'a b', 'alpha', '@3 div', '<b>', 'é', ' ', 'zzz'];
    for (let k = 0; k < 6; k++) {
      const vt = p.vt.get(pick(rnd, p.els)) ?? '';
      if (vt.length) {
        const a = Math.floor(rnd() * vt.length);
        texts.push(vt.slice(a, a + 1 + Math.floor(rnd() * 8)));
      }
    }
    for (const t of texts) {
      const ours = findText(m, t);
      const theirs = proto.find(p, t).text;
      // A line may differ only by a safety escape, as in sameAsPrototype.
      if (ours !== theirs) assert.equal(decode(ours), theirs, `${JSON.stringify(t)} in ${src}`);
    }
    for (const el of p.els) {
      if (!el.sourceCodeLocation) continue;
      let got;
      try {
        got = readRef(m, el.ref);
      } catch (e) {
        if (e instanceof ToolError) continue; // refused: an element with no clean range
        throw e;
      }
      assert.equal(got, proto.read(p, el));
    }
  }
});

test('the outline, find and read equal the prototype on the gate files of C0.3 and C0.5', (ctx) => {
  const tasks = ['experiments/c03/tasks.json', 'experiments/c05/tasks.json']
    .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).tasks);
  const present = tasks.filter((t) => existsSync(t.file));
  if (!present.length) {
    ctx.skip('the gate files are git-ignored and not in this checkout');
    return;
  }
  for (const file of new Set(present.map((t) => t.file))) {
    const src = readFileSync(file, 'utf8');
    const p = proto.load(src);
    const m = load(src, p.hash);
    const changed = sameAsPrototype(m, p, file);
    for (const t of present.filter((x) => x.file === file)) {
      assert.equal(findText(m, t.quote), proto.find(p, t.quote).text, t.id);
      assert.equal(readRef(m, t.ref), proto.read(p, p.els[t.ref]), t.id);
    }
    let refused = 0;
    for (const el of p.els) {
      if (!el.sourceCodeLocation) continue;
      try {
        assert.equal(readRef(m, el.ref), proto.read(p, el), `${file} @${el.ref}`);
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        refused++;
      }
    }
    ctx.diagnostic(`${file}: ${p.els.length} elements, ${refused} with no clean range, ${changed} changed lines`);
  }
});

test('no output line can start as a forged element line, whatever the text holds', () => {
  const evil = ['\u2028@9 div', '\u2029@9 div', '\u0085@9 div', '\u000b@9 div', '\u000c@9 div', '\r@9 div',
    '\n@9 div'];
  for (const e of evil) {
    const src = `<pre>a${e}</pre><textarea>${e}</textarea><div><pre><span>${e}</span></pre></div>` +
      `<a title="${e}" href="${e}" id="${e}">t</a><x${e.replace(/[\r\n\f ]/g, '')}>y</x${e.replace(/[\r\n\f ]/g, '')}>`;
    const m = load(src, H);
    const out = [outlinePage(m, 1), findText(m, '@9'), findText(m, 'y')].join('\n');
    for (const l of out.split('\n')) {
      if (/^page \d+ of \d+; hash |^\d+ matches; hash /.test(l)) continue;
      assert.match(l, LINE, JSON.stringify(l));
      assert.doesNotMatch(l, ANY_BREAK, JSON.stringify(l));
    }
  }
});

test('a < from text is &lt; in the view, also when a removed element joined two text nodes', () => {
  const m = load('<p>x <<script>s</script>b>y</p>', H);
  const page = outlinePage(m, 1);
  assert.match(page, /\| x &lt;/);
  assert.doesNotMatch(page, /<b>/);
});

test('hidden content is not in the outline, and find never matches it', () => {
  const src = '<div hidden>SECRET1</div><p aria-hidden="TRUE">SECRET2</p><span style="display : none">SECRET3</span>' +
    '<b style="visibility:hidden">SECRET4</b><input type="hidden" value="SECRET5"><template><p>SECRET6</p></template>' +
    '<p>visible</p>';
  const m = load(src, H);
  assert.doesNotMatch(outlinePage(m, 1), /SECRET/);
  for (let i = 1; i <= 6; i++) assert.match(findText(m, `SECRET${i}`), /^\n?0 matches; hash h$/);
  assert.match(findText(m, 'SECRET'), /0 matches/);
});

test('find counts 10,000 matches, returns at most 20, and reads its text literally', () => {
  const m = load('<ul>' + '<li>needle</li>'.repeat(10000) + '</ul>', H);
  const out = findText(m, 'needle');
  assert.match(out, /\n10000 matches; hash h$/);
  assert.equal(out.split('\n').filter((l) => /^ *@\d+ li/.test(l)).length, 20);
  const r = load(`<p>.*(a+)+$</p><p>${'a'.repeat(30)}!</p>`, H);
  assert.match(findText(r, '.*(a+)+$'), /\n1 matches; hash h$/);
  refuses(() => findText(r, ''), /empty/);
});

test('a data: URI longer than 100 characters is shortened, with its length', () => {
  const uri = 'data:image/png;base64,' + 'A'.repeat(100_000);
  const page = outlinePage(load(`<img src="${uri}" alt="a">`, H), 1);
  assert.match(page, new RegExp(`src=data:…\\(${uri.length} chars\\)`));
  assert.ok(page.length < 300);
});

test('a depth over 512 gives a named error; 512 is accepted', () => {
  // html and body count as 2 levels.
  const nest = (n) => '<div>'.repeat(n) + 'x';
  assert.ok(load(nest(MAX_DEPTH - 2), H));
  refuses(() => load(nest(MAX_DEPTH - 1), H), /deeper than 512/);
  refuses(() => load(nest(513), H), /deeper than 512/);
});

test('the backtracking inputs of C0.2 parse and render fast', () => {
  for (const src of ['<a' + ' x="1"'.repeat(40), '<p><a' + ' x="1"'.repeat(40) + ' "bad">l</a></p>',
    `<p style="display${' '.repeat(1_000_000)}">x</p>`, `<p title="${' '.repeat(1_000_000)}!">x</p>`,
    `<p>${' x="1"'.repeat(100_000)}!</p>`]) {
    const t = performance.now();
    const m = load(src, H);
    outlinePage(m, 1);
    findText(m, 'x');
    // A loose bound: a backtracking regex takes minutes here. The gate C0.2 script measures the real times.
    assert.ok(performance.now() - t < 10_000, `${src.slice(0, 30)}: ${performance.now() - t} ms`);
  }
});

test('read and edit refuse an element with no clean range; read returns exact bytes otherwise', () => {
  const m = load('<b><p>x</b>y</p><table><i>f</i><tr><td>c\r\n\u{1F600}</td></tr></table><ul><li>a<li>b</ul>', H);
  const byTag = (t, n = 0) => m.els.filter((e) => e.tagName === t)[n].ref;
  refuses(() => readRef(m, byTag('b')), /no clean range/); // its range holds the start of p, not its child
  refuses(() => readRef(m, byTag('b', 1)), /no source/); // the adoption agency's copy
  refuses(() => readRef(m, byTag('tbody')), /no source/);
  refuses(() => readRef(m, byTag('table')), /no clean range/); // the fostered i starts inside it
  refuses(() => readRef(m, 0), /no source/); // the implied html element
  assert.equal(readRef(m, byTag('td')), '<td>c\r\n\u{1F600}</td>');
  assert.equal(readRef(m, byTag('li')), '<li>a');
  assert.equal(readRef(m, byTag('i')), '<i>f</i>');
  refuses(() => readRef(m, m.els.length), /does not exist/);
  refuses(() => readRef(m, -1), /does not exist/);
  refuses(() => readRef(m, 1.5), /does not exist/);
  refuses(() => readRef(m, '3'), /does not exist/);
});

test('a page out of range gives a named error with the page count', () => {
  const m = load('<p>a</p>', H);
  refuses(() => outlinePage(m, 2), /1 page/);
  refuses(() => outlinePage(m, 0), /page/);
  assert.match(outlinePage(m, 1), /^page 1 of 1; hash h\n/);
});

test('the view splits a long outline into pages of at most 60,000 characters', () => {
  const m = load('<p>word</p>'.repeat(20000), H);
  const n = pageCount(m);
  assert.ok(n > 1);
  for (let i = 1; i <= n; i++) assert.ok(outlinePage(m, i).split('\n').slice(1).join('\n').length <= 60_000);
});

// Regression tests for the reviews of 2026-11-11.

test('F3: output lines are cut at LINE_CAP, and find output at 60,000 characters', () => {
  const ctl = String.fromCharCode(1);
  const m = load(`<p title="${ctl.repeat(800_000)}">x</p><div>${'w '.repeat(1_500_000)}</div>`, H);
  for (let i = 1; i <= pageCount(m); i++) {
    const page = outlinePage(m, i);
    assert.ok(page.length <= 60_100, `page ${i}: ${page.length}`);
    for (const l of page.split('\n').slice(1)) assert.ok(l.trimStart().length <= LINE_CAP + 30, String(l.length));
  }
  assert.match(outlinePage(m, 1), /…\(\d+ chars\)/);
  const many = load('<ul>' + `<li title="${'t'.repeat(9000)}">hit</li>`.repeat(20) + '</ul>', H);
  const out = findText(many, 'hit');
  assert.ok(out.length <= 60_100, String(out.length));
  assert.match(out, /\n20 matches; output cut at 60,000 characters; hash h$/);
});

test('F4: inline styles hidden with a CSS comment or a CSS escape are hidden content', () => {
  for (const style of ['display:/**/none', String.raw`display:\6eone`, String.raw`dis\play: none`,
    'visibility:/* x */hidden', String.raw`display: n\one`, 'display:none/* unclosed']) {
    const m = load(`<p style="${style}">SECRET</p><p>shown</p>`, H);
    assert.doesNotMatch(outlinePage(m, 1), /SECRET/, style);
    assert.match(findText(m, 'SECRET'), /\n0 matches/, style);
  }
  assert.equal(cssPlain('a/*x*/b/*c'), 'ab');
  assert.equal(cssPlain(String.raw`\6e\6F ne`), 'none');
  assert.match(outlinePage(load('<p style="display:block">kept</p>', H), 1), /kept/);
});

test('F5: a tag name cannot show a fake ref, id or attribute list', () => {
  const sp = String.fromCharCode(0x3000);
  const m = load(`<x${sp}@99${sp}button#submit>a</x${sp}@99${sp}button#submit><a#ok(href=>b</a#ok(href=>`, H);
  for (const l of outlinePage(m, 1).split('\n').slice(1)) {
    if (!l.trimStart().startsWith('@')) continue;
    assert.doesNotMatch(l.trimStart().slice(1).replace(/&#x[0-9a-f]+;/g, ''), /@|#|\(/, l);
  }
  assert.match(outlinePage(load('<b:widget>x</b:widget>', H), 1), /@\d+ b:widget\n/);
});

test('review 1: a leading BOM is not content; the tree and the refs equal the file without it', () => {
  const body = '<!DOCTYPE html><html><head><title>T</title></head><body><div><p>a<table></table></p></div></body></html>';
  const a = load(body, H);
  const b = load('﻿' + body, H);
  assert.equal(outlinePage(b, 1), outlinePage(a, 1));
  const title = a.els.find((e) => e.tagName === 'title').ref;
  assert.equal(readRef(b, title), '<title>T</title>');
  assert.match(outlinePage(b, 1), /\n @1 head\n {2}@2 title\n/);
});
