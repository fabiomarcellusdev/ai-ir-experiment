import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generator, shuffle, pool, drawKind, drawAll, templateRule, taskRule, missingTypes } from './draw-files.mjs';
import { gateWork, countsRepeat, counter3, shortPaths, bootstrapFiles, resampleFiles, frozenProblems, C03_FROZEN, C05_FROZEN } from './run-c05.mjs';
import { makeTasks } from '../c03/make-tasks.mjs';
import { paths, requestText, proxyCount } from '../c03/run-c03.mjs';
import { load } from '../c03/html.mjs';

const OK = '<p>fine</p>\n';
const MINIFIED = '<p>' + 'x'.repeat(2001) + '</p>';
const repo = (name, n) => ({ repo: name, files: Array.from({ length: n }, (_, i) => ({ repo: name, path: `f${i}.html`, size: 20_000 })) });
const pass = () => null;
const rule = (t) => (t === MINIFIED ? 'minified' : null);

const PAGE = `<!doctype html><html><head><title>T</title></head><body>
<nav><a href="/a">Home page link</a> <a href="/b" class="c">About us here</a></nav>
<main><h1 id="top">Main heading of page</h1>
<p class="lead">First paragraph with <b>bold</b> words in it</p>
<ul><li id="one">One list item</li><li id="two">Two list item</li></ul>
</main></body></html>`;

// --- The draw ---

test('the pool leaves out the C0.3 owners and the repositories that an earlier kind picked, and sorts', () => {
  const kind = { passPathRules: [['b/x', 'z.html', 1], ['a/y', 'b.html', 1], ['a/y', 'a.html', 1], ['C/old', 'q.html', 1],
    ['c/other', 'r.html', 1], ['d/used', 's.html', 1]] };
  const p = pool(kind, new Set(['c']), new Set(['d/used']));
  assert.deepEqual(p.map((r) => r.repo), ['a/y', 'b/x']);
  assert.deepEqual(p[0].files.map((f) => f.path), ['a.html', 'b.html']);
});

test('the template rule finds each template marker, and leaves plain braces', () => {
  for (const t of ['<p>Hi {{ name }}</p>', '{% include x.html %}', '<% if x %>', '<?php echo 1; ?>']) assert.match(templateRule(t), /template/, t);
  assert.equal(templateRule('<p>a { b } c</p><script>if (a) { b(); }</script>'), null);
});

test('the task rule names each missing task type, for a removal and for an insertion', () => {
  assert.equal(taskRule(PAGE), null);
  assert.match(taskRule('<style>p{color:red}</style>'), /question, text, attribute, structure \(remove\), structure \(insert\)/);
  // Short text nodes only: no text change.
  assert.deepEqual(missingTypes('<body><a href="/x">Go now</a></body>', false), ['text']);
  // The only candidate is inside a select: an insertion of <p> does not survive parsing.
  assert.deepEqual(missingTypes('<body><select><option value="1">Choice one here now</option></select></body>', true), ['structure (insert)']);
  assert.deepEqual(missingTypes('<body><select><option value="1">Choice one here now</option></select></body>', false), []);
});

test('property: the task rule passes a file exactly when makeTasks can give its 4 tasks at that position', () => {
  const rnd = generator(99);
  const pieces = ['<p>Plain words in a row</p>', '<a href="/x">Go now</a>', '<select><option value="v">One two three four</option></select>',
    '<div class="k"><span>Some text that is long</span></div>', '<li id="i">Item with words here</li>', '<p>Hi</p>'];
  for (let i = 0; i < 60; i++) {
    const body = Array.from({ length: 1 + rnd(4) }, () => pieces[rnd(pieces.length)]).join('\n');
    const src = `<body>\n${body}\n</body>`;
    for (const even of [false, true]) {
      const files = even ? [{ file: 'a', src: PAGE }, { file: 'b', src }] : [{ file: 'b', src }];
      let ok = true;
      try { makeTasks(files, 20261111); } catch { ok = false; }
      assert.equal(missingTypes(src, even).length === 0, ok, `${even ? 'even' : 'odd'}: ${body}`);
    }
  }
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

test('golden: the read order for a fixed seed shuffles the repositories and the files in each', () => {
  // Pinned on 2026-11-11. A draw that reads files in sorted order, or that does not shuffle the repositories, fails.
  const repos = [repo('a', 4), repo('b', 4), repo('c', 4)];
  const text = (f) => (f.path === 'f0.html' || f.repo === 'c' ? MINIFIED : OK);
  const { read } = drawKind(repos, generator(20261111), text, rule);
  assert.deepEqual(read.map((r) => `${r[0]}/${r[1]}:${r[2]}`), GOLDEN_READ);
});
const GOLDEN_READ = ['c/f3.html:minified', 'c/f2.html:minified', 'c/f1.html:minified', 'c/f0.html:minified',
  'a/f0.html:minified', 'a/f1.html:pass', 'b/f0.html:minified', 'b/f2.html:pass'];

test('with only 1 repository that passes, the second file is the next passing file of that repository, in the same order', () => {
  const repos = [repo('a', 5), repo('b', 2)];
  const text = (f) => (f.repo === 'a' && f.path !== 'f2.html' ? OK : MINIFIED);
  const { picks, read } = drawKind(repos, generator(3), text, rule);
  assert.deepEqual(picks.map((p) => p.repo), ['a', 'a']);
  assert.equal(picks[1].sameRepository, true);
  // The second pick is the first passing file after the first pick in the read order of repository a.
  const aRead = read.filter((r) => r[0] === 'a');
  const passing = aRead.filter((r) => r[2] === 'pass').map((r) => r[1]);
  assert.deepEqual(picks.map((p) => p.path), passing.slice(0, 2));
  // Repository a's read order is one permutation: no file is read twice.
  assert.equal(new Set(aRead.map((r) => r[1])).size, aRead.length);
});

test('the draw fails with a named error when too few files pass', () => {
  assert.throws(() => drawKind([repo('a', 1), repo('b', 2)], generator(1), (f) => (f.repo === 'a' ? OK : MINIFIED), rule), /only 1 of 2 files/);
  assert.throws(() => drawKind([repo('b', 2)], generator(1), () => MINIFIED, rule), /no repository/);
});

test('each repository has about the same chance to be drawn first, whatever its file count', () => {
  // A draw over files would give the 100-file repository about 98% of first picks.
  const repos = [repo('big', 100), repo('s1', 1), repo('s2', 1)];
  const first = { big: 0, s1: 0, s2: 0 };
  for (let seed = 1; seed <= 3000; seed++) first[drawKind(repos, generator(seed), () => OK, pass).picks[0].repo]++;
  for (const [k, n] of Object.entries(first)) assert.ok(n > 800 && n < 1200, `${k}: ${n} of 3000`);
});

test('the whole draw removes C0.3 owners, never reuses a repository, and uses one generator stream', () => {
  const kind = (name, repos, picks) => ({ kind: name, repos: repos.map((r) => ({ repo: r, commit: `sha-${r}` })),
    passPathRules: repos.flatMap((r) => [0, 1, 2].map((i) => [r, `p${i}.html`, 20_000])), picks: picks.map((r) => ({ repo: r })) });
  const shared = ['x/one', 'x/two', 'y/three', 'z/four', 'w/five'];
  const c03 = { kinds: [kind('k1', [...shared, 'old/a'], ['old/a']), kind('k2', [...shared, 'OLD/b'], [])] };
  const reads = [];
  const d = drawAll(c03, 20261111, (f) => { reads.push(f); return OK; }, pass);
  assert.deepEqual(d.excludedOwners, ['old']);
  const picked = d.kinds.flatMap((k) => k.picks.map((p) => p.repo));
  assert.equal(new Set(picked).size, 4, picked.join(' '));
  assert.ok(!picked.some((r) => r.toLowerCase().startsWith('old/')));
  assert.ok(reads.every((f) => f.commit === `sha-${f.repo}`));
  // One stream: kind 2 is not drawn as if the generator started again.
  const again = drawKind(pool(c03.kinds[1], new Set(['old']), new Set(d.kinds[0].picks.map((p) => p.repo))), generator(20261111), () => OK, pass);
  const k2 = d.kinds[1].picks.map((p) => `${p.repo}/${p.path}`);
  assert.notDeepEqual(again.picks.map((p) => `${p.repo}/${p.path}`), k2);
});

test('the seed parameter of makeTasks keeps the C0.3 draw as its default', () => {
  const files = [{ file: 'a', src: PAGE }, { file: 'b', src: PAGE }];
  assert.deepEqual(makeTasks(files), makeTasks(files, 20261110));
  assert.notDeepEqual(makeTasks(files, 20261111).map((t) => t.attr ?? t.op), makeTasks(files).map((t) => t.attr ?? t.op));
  assert.deepEqual([...shuffle([1, 2, 3, 4], generator(7))].sort(), [1, 2, 3, 4]);
});

// --- The work tokens ---

const proxy = async (arm, msgs) => proxyCount(/\S+|\s+/g)(requestText([{ name: arm === 'B' ? 'four tools of B' : 'six tools of M' }], msgs));
const twoFiles = [{ file: 'a', src: PAGE }, { file: 'b', src: PAGE }];

test('the fixed part is each arm\'s tools with exactly the first user message, so tool definitions do not change the ratio', async () => {
  const tasks = makeTasks(twoFiles, 20261111);
  const calls = [];
  const rec = async (arm, msgs) => { calls.push([arm, msgs]); return proxy(arm, msgs); };
  const r = await gateWork(tasks, (t) => twoFiles[t.fileNumber - 1].src, rec);
  const fixed = calls.filter(([, m]) => m.length === 1);
  assert.equal(fixed.length, 2 * tasks.length);
  for (const [, m] of fixed) assert.equal(m[0].role, 'user');
  for (const [i, t] of tasks.entries()) assert.match(fixed[2 * i][1][0].content, new RegExp(t.prompt.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const heavyM = async (arm, msgs) => (await proxy(arm, msgs)) + (arm === 'M' ? 1000 : 0);
  const h = await gateWork(tasks, (t) => twoFiles[t.fileNumber - 1].src, heavyM);
  assert.equal(h.median, r.median);
  assert.notEqual(h.medianTotalC03, r.medianTotalC03);
  for (const row of r.rows) assert.equal(row.workM, Math.min(...[row.workM1, row.workM2, row.workM3].filter((x) => x !== null)));
});

test('a path whose work tokens are not above 0 stops the run with a named error', async () => {
  const tasks = makeTasks([{ file: 'a', src: PAGE }], 20261111).slice(0, 1);
  await assert.rejects(gateWork(tasks, () => PAGE, async () => 100), /work tokens are 0, not above 0/);
});

test('the noise check finds a counter whose repeats differ (negative control), and passes a fixed one', async () => {
  let n = 0;
  assert.equal(await countsRepeat([['B', []]], async () => 100 + (n++ % 2)), false);
  assert.equal(await countsRepeat([['B', []], ['M', []]], async () => 100), true);
  let k = 0;
  const seq = [5, 9, 7];
  assert.equal(await counter3(async () => seq[k++])('B', []), 7);
});

// --- The short paths ---

const QUOTE = 'Start your free trial today';
const LINK = (attrs) => `<body>\n<p>x</p>\n<a ${attrs}>${QUOTE}</a>\n</body>`;
const sp = (t, src) => shortPaths(t, src, paths(t, src));
const question = (src, attr, answer) => ({ id: '1-question', type: 'question', quote: QUOTE, tag: 'a', prompt: 'Q',
  ref: load(src).els.find((e) => e.tagName === 'a').ref, attr, answer });

test('the short paths: Grep alone or html_find alone answers a question only when the attribute is in the output', () => {
  const src = LINK('id="go" class="btn" href="/x"');
  assert.equal(sp(question(src, 'href', '/x'), src).B3.valid, true);
  assert.equal(sp(question(src, 'href', '/x'), src).M3.valid, true);
  assert.equal(sp(question(src, 'id', 'go'), src).M3.valid, true);
  assert.equal(sp(question(src, 'class', 'btn'), src).M3.valid, false, 'class is not in the view');
  assert.equal(sp(question(src, 'class', 'btn'), src).B3.valid, true);
  const msgs = sp(question(src, 'href', '/x'), src).B3.messages;
  assert.equal(msgs.length, 5);
  assert.equal(msgs.at(-1).role, 'user');
  assert.ok(!JSON.stringify(msgs).includes('"name":"Read"'));
  assert.equal(sp({ ...question(src, 'href', '/x'), type: 'attribute', change: [0, 0, ''], range: [0, 0], newValue: 'v' }, src).B3.valid, false);
});

test('B3 is not valid when the start tag spans 2 lines, or ends after 2,000 characters of its line', () => {
  const split = LINK('id="go"\nhref="/x"');
  assert.equal(sp(question(split, 'href', '/x'), split).B3.valid, false);
  const long = LINK(`title="${'t'.repeat(1990)}" href="/x"`);
  assert.equal(sp(question(long, 'href', '/x'), long).B3.valid, false);
  const fits = LINK(`title="${'t'.repeat(1900)}" href="/x"`);
  assert.equal(sp(question(fits, 'href', '/x'), fits).B3.valid, true);
});

test('M3 is not valid for an empty id, a shortened data: value, or a target after the first 20 matches', () => {
  const empty = LINK('id="" href="/x"');
  assert.equal(sp(question(empty, 'id', ''), empty).M3.valid, false);
  const data = `data:image/png;base64,${'A'.repeat(200)}`;
  const img = LINK(`href="${data}"`);
  assert.equal(sp(question(img, 'href', data), img).M3.valid, false);
  const many = `<body>\n${Array.from({ length: 21 }, () => `<p>${QUOTE}</p>`).join('\n')}\n<a href="/x">${QUOTE}</a>\n</body>`;
  assert.equal(sp(question(many, 'href', '/x'), many).M3.valid, false);
});

// --- The bootstrap ---

test('a file resample takes whole files, each with all its tasks', () => {
  const groups = Array.from({ length: 10 }, (_, f) => [0, 1, 2, 3].map((t) => f * 10 + t));
  const rnd = generator(5);
  for (let i = 0; i < 100; i++) {
    const r = resampleFiles(groups, rnd);
    assert.equal(r.length, 10);
    for (const g of r) assert.ok(groups.includes(g), 'a resample split a file');
  }
});

test('the file bootstrap gives the value when every ratio is equal, and a wider interval when files differ', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `${Math.floor(i / 4) + 1}-t${i % 4}`, ratio: 0.4 }));
  assert.deepEqual(bootstrapFiles(rows, 1, 200), [0.4, 0.4]);
  const mixed = rows.map((r) => ({ ...r, ratio: Number(r.id.split('-')[0]) / 10 }));
  const [lo, hi] = bootstrapFiles(mixed, 1, 500);
  assert.ok(lo < hi);
  assert.deepEqual(bootstrapFiles(mixed, 1, 500), [lo, hi]);
});

// --- The freeze ---

function fakeInputs() {
  const files = new Map();
  const put = (p, text) => files.set(p, Buffer.from(text, 'utf8'));
  const sha = (p) => createHash('sha256').update(files.get(p)).digest('hex');
  for (const f of [...C03_FROZEN, ...C05_FROZEN]) put(f, `content of ${f}`);
  put('experiments/c03/c03-result.json', JSON.stringify({ sha256: Object.fromEntries(C03_FROZEN.map((f) => [f, sha(f)])) }));
  const picks = Array.from({ length: 10 }, (_, i) => ({ file: `g/${i}.html`, sha256: '' }));
  for (const p of picks) { put(p.file, PAGE); p.sha256 = sha(p.file); }
  put('experiments/c05/file-set.json', JSON.stringify({ kinds: [{ picks }] }));
  const tasks = makeTasks(picks.map((p) => ({ file: p.file, src: PAGE })), 20261111).map((t) => ({ ...t, expectedSha256: 'x' }));
  put('experiments/c05/tasks.json', JSON.stringify({ seed: 20261111, tasks }));
  put('experiments/c05/run-inputs.json', JSON.stringify({ sha256: Object.fromEntries(C05_FROZEN.map((f) => [f, sha(f)])) }));
  return { files, put, read: (p) => { if (!files.has(p)) throw new Error(`no ${p}`); return files.get(p); } };
}

test('the freeze check passes the frozen inputs, and names each change', () => {
  const ok = fakeInputs();
  assert.deepEqual(frozenProblems(ok.read, makeTasks), []);
  const c03 = fakeInputs(); c03.put('experiments/c03/html.mjs', 'changed');
  assert.match(frozenProblems(c03.read, makeTasks).join('\n'), /html\.mjs differs from its hash in the C0\.3 result/);
  const unlisted = fakeInputs(); unlisted.put('experiments/c05/run-inputs.json', JSON.stringify({ sha256: {} }));
  assert.match(frozenProblems(unlisted.read, makeTasks).join('\n'), /does not list experiments\/c05\/tasks\.json/);
  const gate = fakeInputs(); gate.put('g/3.html', PAGE + ' ');
  assert.match(frozenProblems(gate.read, makeTasks).join('\n'), /g\/3\.html changed since the draw/);
  const edited = fakeInputs();
  const set = JSON.parse(edited.files.get('experiments/c05/tasks.json'));
  set.tasks[0].quote = 'another quote';
  edited.put('experiments/c05/tasks.json', JSON.stringify(set));
  assert.match(frozenProblems(edited.read, makeTasks).join('\n'), /not what makeTasks gives/);
});
