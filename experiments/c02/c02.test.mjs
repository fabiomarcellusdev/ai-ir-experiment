// Tests of the C0.2 gate script's checks, and of the hostile file set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkLines, checkRefs, checkFind, returnedMatches, named, shownTag, MUTANTS } from './run-c02.mjs';
import { hostileFiles, HIDDEN_WORDS } from '../../tests/gates/hostile.mjs';

test('condition 1 and 2: element and text lines pass; anything else, and a "<" in text, fail (negative controls)', () => {
  assert.deepEqual(checkLines(['@0 html', ' @2 body', '  | text &lt; ok', '  @3 p#x(title=a)']).reasons, []);
  assert.deepEqual(checkLines(['@0 html', ' fake line']).reasons, ['c1: a line is neither an element line nor a text line']);
  assert.deepEqual(checkLines(['  | a < b']).reasons, ['c2: a text line holds a "<"']);
  assert.deepEqual(checkLines(['@12 div#a(x)']).refs, [[12, 'div']]);
});

test('condition 1, refs: once each, and each an element of the oracle with its tag (negative controls)', () => {
  const els = ['html', 'head', 'body', 'p', 'linearGradient', 'x"y'];
  assert.deepEqual(checkRefs([[0, 'html'], [3, 'p'], [4, 'linearGradient'], [5, 'x&#x22;y']], els), []);
  assert.deepEqual(checkRefs([[3, 'p'], [3, 'p']], els), ['c1: a ref appears twice']);
  assert.deepEqual(checkRefs([[9, 'p']], els), ['c1: a ref names no element of the oracle, or another tag']);
  assert.deepEqual(checkRefs([[3, 'div']], els), ['c1: a ref names no element of the oracle, or another tag']);
  // Across pages.
  const seen = new Set();
  assert.deepEqual(checkRefs([[3, 'p']], els, seen), []);
  assert.deepEqual(checkRefs([[3, 'p']], els, seen), ['c1: a ref appears twice']);
});

test('a find output: element lines of the oracle only, at most 20 matches, no long data: URI (negative controls)', () => {
  const els = ['html', 'head', 'body', 'p', 'pre'];
  const foot = '1 matches; hash 0123456789abcdef';
  const out = (...lines) => lines.join('\n');
  assert.deepEqual(checkFind(out('@0 html', ' @2 body', '  @3 p', foot), els), []);
  assert.deepEqual(checkFind(out('', '0 matches; hash 0123456789abcdef'), els), []);
  // A forged line from pre text: ref 999 is no element, and ref 2 is not an "a".
  assert.match(checkFind(out('@0 html', ' @999 a(href=x)', foot), els).join(), /no element of the oracle/);
  assert.match(checkFind(out('@0 html', ' @2 a(href=x)', foot), els).join(), /no element of the oracle/);
  assert.match(checkFind(out('@0 html', ' | text', foot), els).join(), /not an element line/);
  assert.match(checkFind(out('@0 html', '1 matches'), els).join(), /footer/);
  const many = Array.from({ length: 21 }, (_, i) => `@${i} p`);
  assert.match(checkFind(out(...many, '21 matches; hash 0123456789abcdef'), Array(21).fill('p')).join(), /more than 20/);
  assert.match(checkFind(out(`@3 p(src=data:${'A'.repeat(120)})`, foot), els).join(), /data: URI/);
});

test('the returned matches of a find output are its leaf lines', () => {
  assert.equal(returnedMatches(['@0 html', ' @2 body', '  @3 p', '  @4 p', ' @9 div', '@10 x']), 4);
  assert.equal(returnedMatches([]), 0);
});

test('a named error is the tool\'s own error, not an internal error or the time limit', () => {
  assert.equal(named('html_find', { isError: true, text: 'html_find: the search text is empty' }), true);
  assert.equal(named('html_find', { isError: false, text: 'html_find: x' }), false);
  assert.equal(named('html_find', { isError: true, text: 'html_read: x' }), false);
  assert.equal(named('html_find', { isError: true, text: 'html_find: internal error (EIO)' }), false);
  assert.equal(named('html_find', { isError: true, text: 'html_find: the call took longer than 1.5 s' }), false);
});

test('the shown tag escapes as server/view.mjs does', () => {
  assert.equal(shownTag('b:widget'), 'b:widget');
  assert.equal(shownTag('a@1'), 'a&#x40;1');
});

test('each server control changes exactly one line of server/view.mjs', () => {
  const src = readFileSync(new URL('../../server/view.mjs', import.meta.url), 'utf8');
  for (const [name, [, [from, to]]] of Object.entries(MUTANTS)) {
    assert.equal(src.split(from).length, 2, name);
    assert.notEqual(from, to);
  }
});

test('the hostile file set is the same on each call, and holds each case', () => {
  const hash = (fs) => fs.map(([n, b]) => `${n}:${createHash('sha256').update(b).digest('hex')}`).join();
  const a = hostileFiles();
  assert.equal(hash(a), hash(hostileFiles()));
  const by = new Map(a);
  assert.ok(by.get('large-25mb.html').length >= 25_000_000);
  assert.ok(by.get('nest-513.html').toString().startsWith('<div>'.repeat(513)));
  assert.equal(by.get('backtrack-1.html').toString(), '<a' + ' x="1"'.repeat(40));
  for (const w of HIDDEN_WORDS) assert.equal(by.get('hidden.html').toString().split(w).length, 2, w);
  assert.ok(by.get('data-uri.html').toString().includes('A'.repeat(100_000)));
  assert.ok(by.get('fostered-2mb.html').length > 1_900_000 && by.get('fostered-2mb.html').length < 2_000_000);
});
