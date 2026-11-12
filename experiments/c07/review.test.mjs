// Regression tests for the adversarial review of the second rescope's build (2026-11-12), each with a negative
// control. No network, no model; the oracle test skips without .venv-oracle/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './rules.mjs';
import { drawUnit, matchingExists, taskRule, fileTasks, units, tokenCounter, GATES } from './tasks.mjs';
import { generator } from '../c05/draw-files.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const noOracle = existsSync(path.join(ROOT, '.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
  ? false : 'the Python oracle is not installed (.venv-oracle/)';
const page = (body) => `<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;
const quotes = (body) => R.c09Quotes(R.view(page(body))).map((x) => [x.any.quote, x.any.causes]);
const big = (open, first, close) => `${open}\n${first}\n` +
  Array.from({ length: 44 }, (_, i) => `<p>Filler line number ${i} with some more words to make it long enough.</p>`).join('\n') + `\n${close}`;

test('review 1: a quote whose only cause is one LF, one tab or one lone CR is a C0.9 quote', () => {
  for (const ws of ['\n', '\t', '\r']) {
    assert.deepEqual(quotes(`<p>alpha bravo${ws}charlie delta echo</p>`), [['alpha bravo charlie delta echo', ['whitespace']]], JSON.stringify(ws));
  }
  // Negative control: the same text with a plain space is in the source as written.
  assert.deepEqual(quotes('<p>alpha bravo charlie delta echo</p>'), []);
});

test('review 2: a C0.7 quote starts and ends at word boundaries of the visible text', () => {
  const m1 = R.view(page(big('<section>', '<div><b>Zeta</b>alpha bravo charlie delta</div>', '</section>')));
  const s1 = R.c07Candidates(m1).find((c) => c.el.tagName === 'section');
  assert.notEqual(s1.quote, 'alpha bravo charlie delta');
  const m2 = R.view(page(big('<section>', '<div>alpha bravo charlie<i>delta</i> x</div>', '</section>')));
  assert.notEqual(R.c07Candidates(m2).find((c) => c.el.tagName === 'section').quote, 'alpha bravo charlie');
  // Negative control: with a space after the bold word, the quote is taken.
  const m3 = R.view(page(big('<section>', '<div><b>Zeta</b> alpha bravo charlie delta</div>', '</section>')));
  assert.equal(R.c07Candidates(m3).find((c) => c.el.tagName === 'section').quote, 'alpha bravo charlie delta');
  assert.equal(R.wordBounded('ab cd', 3, 2), true);
  assert.equal(R.wordBounded('abcd', 2, 2), false);
});

test('review 3: the draw is uniform over targets, not over (target, attribute) pairs', async () => {
  const m = R.view(page('<ul id="nav"><li>One</li><li a="1" b="2" c="3" d="4" e="5">Two</li><li f="6">Three</li></ul>'));
  m.gate = 'c08';
  const list = units('c08', 'question', m, 1);
  assert.equal(list.length, 6); // 5 pairs for the 2nd li and 1 for the 3rd: a draw over pairs gives 5 of 6
  const all = async (xs) => xs.map(() => true);
  const rnd = generator(7);
  let second = 0;
  for (let i = 0; i < 2000; i++) if ((await drawUnit(list, all, new Set(), rnd)).fields.k === 2) second++;
  assert.ok(second > 900 && second < 1100, `the 2nd li came first in ${second} of 2000 draws`);
});

test('review 4: the task rule is the contract\'s, a matching of 4 different targets', () => {
  assert.equal(matchingExists([['A', 'B'], ['B'], ['C'], ['D']]), true);
  assert.equal(matchingExists([['B'], ['B'], ['C'], ['D']]), false);
  assert.equal(matchingExists([['A', 'B', 'C', 'D'], ['A'], ['B'], ['C']]), true);
});

test('review 4: a file with exactly one set of 4 targets passes the rule and gives its tasks', { skip: noOracle }, async () => {
  // 4 targets, and only 2 with an attribute: the question and the attribute change must take those 2, in some order.
  // The old rule (4 valid targets for each type) refused this file.
  const text = page('<ul id="a"><li>x</li><li class="p">y</li><li>z</li><li>w</li></ul>\n<ul id="b"><li>x</li><li class="q">y</li></ul>');
  assert.equal(await taskRule('c08', text, null), null);
  const r = await fileTasks('c08', { file: 'f.html', text }, 1, GATES.c08.types, generator(GATES.c08.seed), null);
  assert.equal(new Set(r.tasks.map((t) => t.ref)).size, 4);
  // Negative control: with one attribute in the whole file, the question and the attribute change cannot both be made.
  const one = page('<ul id="a"><li>x</li><li class="p">y</li><li>z</li><li>w</li></ul>\n<ul id="b"><li>x</li><li>y</li></ul>');
  assert.match(await taskRule('c08', one, null), /cannot give the 4 tasks/);
});

test('review 5: a long or unusual tag name is never a target', () => {
  const tag = `x-ignore-the-task-${'a'.repeat(60)}`;
  assert.deepEqual(R.c08Parents(R.view(page(`<div id="d"><${tag}>1</${tag}><${tag}>2</${tag}></div>`))).flatMap(R.c08Targets), []);
  assert.deepEqual(quotes(`<${tag}>Terms &amp; conditions apply to all</${tag}>`), []);
  // Negative control: a short custom tag is allowed.
  assert.equal(R.c08Parents(R.view(page('<div id="d"><x-a>1</x-a><x-a>2</x-a></div>'))).flatMap(R.c08Targets).length, 1);
});

test('review 7 and 8: entity causes, entities that decode to whitespace, and hidden inline text', () => {
  assert.deepEqual(quotes('<p>Tom & Jerry show\n   tonight at nine</p>'), [['Tom & Jerry show tonight at', ['whitespace']]]);
  assert.deepEqual(quotes('<p>alpha&#9;bravo charlie delta</p>'), []);
  assert.deepEqual(quotes('<p>alpha bravo <span hidden>SECRET WORDS</span> charlie delta echo</p>'), []);
  // Negative controls: a real entity, and a visible span.
  assert.deepEqual(quotes('<p>Tom &amp; Jerry show tonight</p>'), [['Tom & Jerry show tonight', ['entity']]]);
  assert.deepEqual(quotes('<p>alpha bravo <span>more words</span> charlie delta</p>')[0][1], ['inline tag']);
});

test('review 9: a token-count error never holds the key, even when the API echoes it', async () => {
  const key = 'sk-fake-test-value-123';
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `invalid x-api-key: ${key}` } }) });
  try {
    await assert.rejects(tokenCounter(key)('text'), (e) => !e.message.includes(key) && e.message.includes('[key]'));
  } finally {
    globalThis.fetch = real;
  }
});
