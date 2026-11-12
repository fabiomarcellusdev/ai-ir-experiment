// Regression tests for the re-review of the second rescope's build (2026-11-12, commit 0301d6b), each with a negative
// control. No network, no model; the oracle tests skip without .venv-oracle/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './rules.mjs';
import { drawExact, taskRule, fileTasks, previewTasks, GATES } from './tasks.mjs';
import { frozenFiles } from './freeze.mjs';
import { generator } from '../c05/draw-files.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const noOracle = existsSync(path.join(ROOT, '.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
  ? false : 'the Python oracle is not installed (.venv-oracle/)';
const page = (body) => `<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;
const quotes = (body) => R.c09Quotes(R.view(page(body))).map((x) => [x.any.quote, x.any.causes]);
const attrsOf = (html) => { const m = R.view(page(html)); return R.safeAttrs(m.els.find((e) => e.tagName === 'a')).map((a) => a.name); };

test('re-review 2: a value with "&" is never an answer; re-review 7: attribute names are plain', () => {
  assert.deepEqual(attrsOf('<a href="page?x=1&section=2" title="ok">x</a>'), ['title']);
  assert.deepEqual(attrsOf('<a a`b="v1" c"d="v2" data-x="v3">x</a>'), ['data-x']);
  // Negative control: a plain name and a value with no "&" are kept.
  assert.deepEqual(attrsOf('<a href="page?x=1" class="c">x</a>'), ['href', 'class']);
});

test('re-review 6: a form feed is not a cause; "&#32;" and a space are not 2 spaces in the source', () => {
  assert.deepEqual(quotes('<p>alpha bravo\fcharlie delta echo</p>'), []);
  assert.deepEqual(quotes('<p>alpha bravo&#32; charlie delta echo</p>').map(([, c]) => c), [['entity']]);
  // Negative control: 2 literal spaces are the whitespace cause.
  assert.deepEqual(quotes('<p>alpha bravo  charlie delta echo</p>').map(([, c]) => c), [['whitespace']]);
});

test('re-review 10: the find check looks for the target\'s own line, not a ref inside an attribute', () => {
  // The ancestor's title holds the text "@<ref> "; the quote's holder is the inner p.
  const m = R.view(page('<div title="@5 x"><p>Terms &amp; conditions apply to all</p></div>'));
  const q = R.c09Quotes(m);
  assert.equal(q.length, 1);
  assert.equal(q[0].el.tagName, 'p');
});

test('re-review 3: a file nested over 512 levels gets a reason from the task rule, not a crash', async () => {
  const deep = page(`${'<div>'.repeat(600)}x${'</div>'.repeat(600)}`);
  assert.match(await taskRule('c08', deep, null), /deeper than 512/);
});

test('re-review 5: the exact draw never fails when a matching exists, also for nested lists', () => {
  const slot = (...ts) => new Map(ts.map((t) => [t, [{ el: t, fields: {} }]]));
  // The worst case of the retry draw: {A,B,C,D}, {B,C,D}, {C,D}, {D}. Only one matching exists.
  const slots = [slot('A', 'B', 'C', 'D'), slot('B', 'C', 'D'), slot('C', 'D'), slot('D')];
  const rnd = generator(3);
  for (let i = 0; i < 500; i++) assert.deepEqual(drawExact(slots, rnd).map((u) => u.el), ['A', 'B', 'C', 'D']);
  // Negative control: no matching exists.
  assert.equal(drawExact([slot('A'), slot('A')], rnd), null);
});

test('re-review 9: the task draw of a file is the same when it runs twice', { skip: noOracle }, async () => {
  const items = Array.from({ length: 5 }, (_, i) => `<li class="c${i}">Item ${i}</li>`).join('');
  const text = page(`<ul id="nav">${items}</ul>\n<ol id="two">${items}</ol>`);
  const once = await fileTasks('c08', { file: 'f.html', text }, 1, GATES.c08.types, generator(GATES.c08.seed), null);
  const twice = await fileTasks('c08', { file: 'f.html', text }, 1, GATES.c08.types, generator(GATES.c08.seed), null);
  assert.deepEqual(once, twice);
  // Negative control: another seed draws other targets.
  const other = await fileTasks('c08', { file: 'f.html', text }, 1, GATES.c08.types, generator(1), null);
  assert.notDeepEqual(other.tasks.map((t) => t.ref), once.tasks.map((t) => t.ref));
});

test('re-review 3 and 8: a preview skips a file that the server refuses, with its reason', { skip: noOracle }, async () => {
  const deep = { file: 'deep.html', text: page(`${'<div>'.repeat(600)}x${'</div>'.repeat(600)}`) };
  const r = await previewTasks('c08', [deep], null);
  assert.equal(r.tasks.length, 0);
  assert.match(r.skipped[0].reason, /deeper than 512/);
});

/** The repository files that a module loads: relative imports (JSON too), `at('...')` paths of code, and Python's
 * spec_from_file_location paths. */
function loads(file) {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const out = new Set();
  const dir = path.posix.dirname(file);
  for (const m of text.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)) out.add(path.posix.normalize(path.posix.join(dir, m[1])));
  for (const m of text.matchAll(/at\('((?:server|experiments)\/[^']+\.(?:mjs|py))'\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/os\.path\.join\(os\.path\.dirname\(os\.path\.abspath\(__file__\)\), '\.\.', '([a-z0-9]+)', '([a-z0-9_]+\.py)'\)/g)) {
    out.add(path.posix.join(path.posix.dirname(dir), m[1], m[2]));
  }
  return [...out];
}

test('re-review 4: the freeze lists every file that the frozen code loads', () => {
  const frozen = new Set(frozenFiles());
  const seen = new Set();
  const todo = ['experiments/c06/run-c06.mjs', 'experiments/c07/tasks.mjs', 'experiments/c07/draw-files.mjs', 'experiments/c07/freeze.mjs', 'server/main.mjs'];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (/\.(mjs|py)$/.test(f)) todo.push(...loads(f));
  }
  const missing = [...seen].filter((f) => !frozen.has(f));
  assert.deepEqual(missing, []);
  // Negative control: the closure holds the tool text and both Python files.
  for (const f of ['experiments/c03/mcp-tools.json', 'experiments/c06/judge.py', 'experiments/c07/oracle_c07.py', 'experiments/c01/oracle.py']) assert.ok(seen.has(f), f);
});
