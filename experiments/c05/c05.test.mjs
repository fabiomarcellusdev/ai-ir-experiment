import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generator, shuffle, pool, drawKind, templateRule, taskRule, fileRule } from './draw-files.mjs';
import { gateWork, countsRepeat, counter3, shortPaths, bootstrapFiles } from './run-c05.mjs';
import { paths } from '../c03/run-c03.mjs';
import { load } from '../c03/html.mjs';
import { makeTasks } from '../c03/make-tasks.mjs';
import { requestText, proxyCount } from '../c03/run-c03.mjs';

const OK = '<p>fine</p>\n';
const MINIFIED = '<p>' + 'x'.repeat(2001) + '</p>';
const repo = (name, n) => ({ repo: name, files: Array.from({ length: n }, (_, i) => ({ repo: name, path: `f${i}.html`, size: 20_000 })) });

test('the pool leaves out the C0.3 owners and the repositories that an earlier kind picked, and sorts', () => {
  const kind = { passPathRules: [['b/x', 'z.html', 1], ['a/y', 'b.html', 1], ['a/y', 'a.html', 1], ['C/old', 'q.html', 1],
    ['c/other', 'r.html', 1], ['d/used', 's.html', 1]] };
  const p = pool(kind, new Set(['c']), new Set(['d/used']));
  assert.deepEqual(p.map((r) => r.repo), ['a/y', 'b/x']);
  assert.deepEqual(p[0].files.map((f) => f.path), ['a.html', 'b.html']);
});

test('the file rules remove templates and files that cannot give the 4 task types', () => {
  assert.match(templateRule('<p>Hi {{ name }}</p>'), /template/);
  assert.match(templateRule('{% include x.html %}'), /template/);
  assert.match(templateRule('<% if x %>'), /template/);
  assert.equal(templateRule('<p>a { b } c</p>'), null);
  assert.match(taskRule('<style>p{color:red}</style>'), /4 task types/);
  assert.match(fileRule('<p>Hi {{ name }}</p>'), /template/);
});

test('the draw takes 2 files from 2 different repositories, and skips a repository with no passing file', () => {
  const repos = [repo('a', 3), repo('b', 3), repo('c', 3)];
  const text = (f) => (f.repo === 'b' ? MINIFIED : OK);
  for (let seed = 1; seed <= 50; seed++) {
    const { picks, read } = drawKind(repos, generator(seed), text, rule);
    assert.equal(picks.length, 2);
    assert.notEqual(picks[0].repo, picks[1].repo);
    assert.ok(picks.every((p) => p.repo !== 'b'), 'a minified file was picked');
    assert.ok(read.filter((r) => r[0] === 'b').every((r) => r[2] !== 'pass'));
  }
});

const pass = () => null;
const rule = (t) => (t === MINIFIED ? 'minified' : null);

test('with only 1 repository that passes, the second file is the next passing file of that repository', () => {
  const repos = [repo('a', 3), repo('b', 2)];
  const { picks } = drawKind(repos, generator(1), (f) => (f.repo === 'a' ? OK : MINIFIED), rule);
  assert.deepEqual(picks.map((p) => p.repo), ['a', 'a']);
  assert.notEqual(picks[0].path, picks[1].path);
  assert.equal(picks[1].sameRepository, true);
});

test('the draw fails with a named error when too few files pass', () => {
  assert.throws(() => drawKind([repo('a', 1), repo('b', 2)], generator(1), (f) => (f.repo === 'a' ? OK : MINIFIED), rule), /only 1 of 2 files/);
  assert.throws(() => drawKind([repo('b', 2)], generator(1), () => MINIFIED, rule), /no repository/);
});

test('each repository has about the same chance to be drawn first, whatever its file count', () => {
  // Negative control in spirit: a draw over files would give the 100-file repository about 98% of first picks.
  const repos = [repo('big', 100), repo('s1', 1), repo('s2', 1)];
  const first = { big: 0, s1: 0, s2: 0 };
  for (let seed = 1; seed <= 3000; seed++) first[drawKind(repos, generator(seed), () => OK, pass).picks[0].repo]++;
  for (const [k, n] of Object.entries(first)) assert.ok(n > 800 && n < 1200, `${k}: ${n} of 3000`);
});

test('the draw is the same for the same seed, and differs for another seed', () => {
  const repos = Array.from({ length: 8 }, (_, i) => repo(`r${i}`, 5));
  const run = (seed) => drawKind(repos, generator(seed), () => OK, pass).picks.map((p) => `${p.repo}/${p.path}`);
  assert.deepEqual(run(20261111), run(20261111));
  assert.notDeepEqual(run(20261111), run(20261110));
  assert.deepEqual([...shuffle([1, 2, 3, 4], generator(7))].sort(), [1, 2, 3, 4]);
});

const PAGE = `<!doctype html><html><head><title>T</title></head><body>
<nav><a href="/a">Home page link</a> <a href="/b" class="c">About us here</a></nav>
<main><h1 id="top">Main heading of page</h1>
<p class="lead">First paragraph with <b>bold</b> words in it</p>
<ul><li id="one">One list item</li><li id="two">Two list item</li></ul>
</main></body></html>`;

test('the seed parameter of makeTasks keeps the C0.3 draw as its default', () => {
  const files = [{ file: 'a', src: PAGE }, { file: 'b', src: PAGE }];
  assert.deepEqual(makeTasks(files), makeTasks(files, 20261110));
  assert.notDeepEqual(makeTasks(files, 20261111).map((t) => t.attr ?? t.op), makeTasks(files).map((t) => t.attr ?? t.op));
});

const proxy = async (arm, msgs) => proxyCount(/\S+|\s+/g)(requestText([{ name: arm === 'B' ? 'four tools of B' : 'six tools of M' }], msgs));

test('the work tokens leave out the fixed part, so the arms\' tool definitions do not change the ratio', async () => {
  const files = [{ file: 'a', src: PAGE }, { file: 'b', src: PAGE }];
  const tasks = makeTasks(files, 20261111);
  const r = await gateWork(tasks, (t) => files[t.fileNumber - 1].src, proxy);
  // Adding 1,000 tokens to one arm's fixed part changes the total ratio but not the work ratio.
  const heavyM = async (arm, msgs) => (await proxy(arm, msgs)) + (arm === 'M' ? 1000 : 0);
  const h = await gateWork(tasks, (t) => files[t.fileNumber - 1].src, heavyM);
  assert.equal(h.median, r.median);
  assert.notEqual(h.medianTotal, r.medianTotal);
  for (const row of r.rows) assert.equal(row.workM, Math.min(...[row.workM1, row.workM2, row.workM3].filter((x) => x !== null)));
});

test('a path whose work tokens are not above 0 stops the run with a named error', async () => {
  const files = [{ file: 'a', src: PAGE }];
  const tasks = makeTasks(files, 20261111).slice(0, 1);
  const flat = async () => 100; // every request the same size: the work is 0
  await assert.rejects(gateWork(tasks, () => PAGE, flat), /work tokens are 0, not above 0/);
});

test('the noise check finds a counter whose repeats differ (negative control), and passes a fixed one', async () => {
  let n = 0;
  const noisy = async () => 100 + (n++ % 2);
  const fixed = async () => 100;
  assert.equal(await countsRepeat([['B', []]], noisy), false);
  assert.equal(await countsRepeat([['B', []], ['M', []]], fixed), true);
  let k = 0;
  const seq = [5, 9, 7];
  assert.equal(await counter3(async () => seq[k++])('B', []), 7);
});

test('the short paths: Grep alone or html_find alone answers a question only when the attribute is in the output', () => {
  const src = '<body>\n<p>x</p>\n<a id="go" class="btn" href="/x">Start your free trial today</a>\n</body>';
  const base = { id: '1-question', type: 'question', quote: 'Start your free trial today', tag: 'a', prompt: 'Q' };
  const r = load(src).els.find((e) => e.tagName === 'a').ref;
  const href = { ...base, ref: r, attr: 'href', answer: '/x' };
  const cls = { ...base, ref: r, attr: 'class', answer: 'btn' };
  const sp = (t, s2) => shortPaths(t, s2, paths(t, s2));
  assert.equal(sp(href, src).B3.valid, true);
  assert.equal(sp(href, src).M3.valid, true);
  assert.equal(sp(cls, src).M3.valid, false, 'class is not in the view, so html_find alone cannot answer');
  assert.equal(sp(cls, src).B3.valid, true);
  // The start tag over 2 lines: Grep's matched line does not hold it.
  const split = src.replace('<a id="go"', '<a\nid="go"');
  const r2 = load(split).els.find((e) => e.tagName === 'a').ref;
  assert.equal(sp({ ...href, ref: r2 }, split).B3.valid, false);
  // Not a question: no short path.
  assert.equal(sp({ ...href, type: 'attribute', change: [0, 0, ''], range: [0, 0], newValue: 'v' }, src).B3.valid, false);
  // B3 drops the read step only.
  const msgs = sp(href, src).B3.messages;
  assert.equal(msgs.length, 5);
  assert.ok(!JSON.stringify(msgs).includes('"name":"Read"'));
});

test('the file bootstrap resamples whole files, and its interval is the value when every ratio is equal', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `${Math.floor(i / 4) + 1}-t${i % 4}`, ratio: 0.4 }));
  assert.deepEqual(bootstrapFiles(rows, 1, 200), [0.4, 0.4]);
  // Negative control: files with different ratios give an interval wider than 0.
  const mixed = rows.map((r) => ({ ...r, ratio: Number(r.id.split('-')[0]) / 10 }));
  const [lo, hi] = bootstrapFiles(mixed, 1, 500);
  assert.ok(lo < hi);
  assert.deepEqual(bootstrapFiles(mixed, 1, 500), [lo, hi]);
});
