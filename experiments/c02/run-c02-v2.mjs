// Gate C0.2 v2: hostile files with the v2 tools (docs/contract.md, amendment "the gate text for the v2 tools", B).
// No model, no cost. TIMED: leave the machine alone.
//   node experiments/c02/run-c02-v2.mjs        the gate run: needs committed code; writes c02-v2-result.json
//   node experiments/c02/run-c02-v2.mjs --dev  the same run on uncommitted code; writes no tracked file
// It drives the real server with --tools v2 over stdio, as a harness does. Each case runs 5 times, each time in a new
// workspace. The "no wrong edit" changes (B.8) are judged once with C0.1 v2's checks (html5lib and the bytes).
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync, symlinkSync, statSync, appendFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from '../../server/view.mjs';
import { hostileFiles, FIND, HIDDEN_WORDS } from '../../tests/gates/hostile.mjs';
import { hostileFilesV2, HIDDEN_ID_WORDS, IDS } from '../../tests/gates/hostile-v2.mjs';
import { checkLines, checkRefs, returnedMatches, shownTag, SECRET, RUNS, LIMIT_MS } from './run-c02.mjs';
import { entry } from '../c01/run-c01.mjs';
import { oracle as oracleV2, textModel, serverOutcomes, checkJob, reasons } from '../c01/run-c01-v2.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hashOf = (b) => sha256(b).slice(0, 16);
const KILL_MS = 10_000;
const TOOLS = ['html_find', 'html_change', 'html_outline'];
export const OPS = ['remove', 'replace', 'insert_after', 'set_attribute', 'replace_text'];

// --- The output formats (B.3) ----------------------------------------------------------------------------------------

export const CUT = '… output cut at 60,000 characters';
export const FIND_FOOT = /^(\d+) matches; hash [0-9a-f]{16}$/;
export const ID_FOOT = /^1 match; (\d+) child elements; hash [0-9a-f]{16}$/;
export const LOCATOR_HEAD = /^(\d+ elements match|\d+ elements have the id ".*"); give a ref:$/;
const HASH_FOOT = /^hash [0-9a-f]{16}$/;

/**
 * The content lines of a v2 output: each starts, after its indent, with "@<n> " or "| ", or is the cut line. A child
 * line "@n tag (hidden)" counts as an element line with its tag. Returns the reasons and the refs with their tags.
 */
export function checkV2Lines(lines) {
  const kept = lines.filter((l) => l !== CUT);
  const c = checkLines(kept.map((l) => l.replace(/ \(hidden\)$/, '')));
  return c;
}

/**
 * The checks of an html_find (text) or html_find (id) output, or of a locator's error list: the frame (B.3), the
 * lines (condition 1), the refs (each an element of the oracle with its tag), at most 20 matches (condition 4), no
 * long data: URI (condition 5).
 * @param {'text'|'id'|'locator'} kind
 */
export function checkV2Output(kind, text, elements) {
  const all = text.split('\n');
  const reasons = [];
  let body;
  if (kind === 'locator') {
    if (!LOCATOR_HEAD.test(all[0]) || !HASH_FOOT.test(all.at(-1))) reasons.push('c1: the frame of a locator\'s list is wrong');
    body = all.slice(1, -1);
  } else {
    if (!(kind === 'text' ? FIND_FOOT : ID_FOOT).test(all.at(-1))) reasons.push('c1: the last line is wrong');
    // A find with no match starts with an empty line, as in v1 (C0.2's checkFind leaves empty lines out).
    body = all.slice(0, -1).filter((l) => l !== '');
  }
  const c = checkV2Lines(body);
  reasons.push(...c.reasons);
  if (c.refs.length !== body.filter((l) => l !== CUT).length) reasons.push('c1: a line is not an element line');
  reasons.push(...checkRefs(c.refs.map(([r, t]) => [r, t.trimEnd()]), elements));
  if (kind === 'text' && returnedMatches(body.filter((l) => l !== CUT)) > 20) reasons.push('c4: more than 20 matches returned');
  if (/data:[^\s"')]{101}/.test(text)) reasons.push('c5: an output holds a data: URI longer than 100 characters');
  return [...new Set(reasons)];
}

/** A named error of a v2 tool: its own text, not an internal error and not the time limit. */
export const named = (tool, r) => r.isError && r.text.startsWith(`${tool}: `) && !/internal error|took longer than/.test(r.text);

// --- The server ------------------------------------------------------------------------------------------------------

function startServer(main, root) {
  const p = spawn(process.execPath, [main, '--root', root, '--tools', 'v2'], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const waiting = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (c) => {
    buf += c;
    for (let i = buf.indexOf('\n'); i !== -1; i = buf.indexOf('\n')) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  let n = 0;
  const req = (method, params) => new Promise((resolve) => {
    const id = ++n;
    const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, KILL_MS);
    waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { req, kill: () => p.kill(), stop: () => new Promise((r) => { p.on('exit', r); p.stdin.end(); }) };
}

/**
 * The negative controls (B.9), each with the condition it must fail and its patches [file, from, to]. The first 4 are
 * C0.2's server controls; C0.2's POC control does not use the server (run-c02.mjs).
 */
export const MUTANTS = {
  'a planted backtracking regex': ['c7', [['view.mjs', '  const doc = parseDoc(text);\n', '  /^<a(?: x="1"| x="1")*!/.test(text);\n  const doc = parseDoc(text);\n']]],
  'html_find reads its search text as a regular expression': ['c4', [['view.mjs',
    '  for (let i = m.vis.indexOf(text); i !== -1; i = m.vis.indexOf(text, i + 1)) occ.push(i);',
    "  for (const x of m.vis.matchAll(new RegExp(text, 'g'))) occ.push(x.index);"]]],
  'html_find matches hidden content': ['c3', [['view.mjs',
    'if (n.tagName && (NOT_VISIBLE.has(n.tagName) || hidden.has(n)))', 'if (n.tagName && NOT_VISIBLE.has(n.tagName))']]],
  'html_find with no limit on matches': ['c4', [['v2.mjs', 'const MAX_MATCHES = 20;', 'const MAX_MATCHES = Infinity;']]],
  'an id listing with no output cap': ['c1', [['v2.mjs',
    "    if (size + l.length + 1 > PAGE_CHARS) { lines.push(`… output cut at ${PAGE_CHARS.toLocaleString('en-US')} characters`); break; }", '']]],
  'a locator that ignores the hash': ['c6', [['v2.mjs', "  if (a.hash !== undefined && a.hash !== m.hash) fail('the file changed since the hash');", '']]],
  'an id listing that shows hidden children': ['c3', [
    ['v2.mjs', '  const els = m.els.filter((e) => m.shown.has(e) && e.attrs.some((a) => a.name === \'id\' && a.value === id));',
      '  const els = m.els.filter((e) => e.attrs.some((a) => a.name === \'id\' && a.value === id));'],
    ['v2.mjs', '    const l = m.shown.has(c) ? ` ${fullHead(c)}` : ` @${c.ref} ${escTag(c.tagName)} (hidden)`;', '    const l = ` ${fullHead(c)}`;']]],
};

function mutantServer(base, name, patches) {
  const dir = path.join(base, name.replace(/\W+/g, '-'));
  mkdirSync(path.join(dir, 'server'), { recursive: true });
  mkdirSync(path.join(dir, 'experiments', 'c03'), { recursive: true });
  for (const f of readdirSync(at('server'))) if ((f.endsWith('.mjs') && !f.endsWith('.test.mjs')) || f.endsWith('.json')) copyFileSync(at('server', f), path.join(dir, 'server', f));
  copyFileSync(at('experiments/c03/mcp-tools.json'), path.join(dir, 'experiments', 'c03', 'mcp-tools.json'));
  for (const [file, from, to] of patches) {
    const p = path.join(dir, 'server', file);
    const src = readFileSync(p, 'utf8');
    if (src.split(from).length !== 2) throw new Error(`the control "${name}" cannot find the line it changes in server/${file}`);
    writeFileSync(p, src.replace(from, to));
  }
  return path.join(dir, 'server', 'main.mjs');
}

// --- The cases -------------------------------------------------------------------------------------------------------

/** The element of each file that the changes use (C0.2's targets), and the new HTML of replace; null: no element. */
export const TARGETS = {
  'pre-text.html': ['pre', 1, '<pre>@5 div#fake\n| fake line</pre>'],
  'hidden.html': ['div', 0, '<div hidden>replaced</div>'],
  'markup-join.html': ['script', 0, ''],
  'attributes.html': ['a', 0, '<a href="/b" title="one\nline">first</a>'],
  'unclosed-comment.html': ['p', 0, '<p>edited</p>'],
  'unclosed-script.html': ['p', 0, '<p>edited</p>'],
  'backtrack-2.html': ['a', 0, '<a href="/ok">l</a>'],
  'regex.html': ['p', 1, '<p>edited</p>'],
  'data-uri.html': ['img', 0, '<img alt="small" src="/s.png">'],
  'ten-thousand.html': ['li', 5000, '<li>edited</li>'],
  'fostered-2mb.html': ['td', 5000, '<td>new</td>'],
  'ids.html': ['p', 0, '<p>edited</p>'],
  'tags-20000.html': ['td', 10_000, '<td>new</td>'],
  'id-80000.html': ['i', 40_000, '<i>new</i>'],
  'long-text.html': ['p', 0, '<p>short</p>'],
  'nest-513.html': null,
  'backtrack-1.html': null,
  'large-25mb.html': null,
};
const OVER = { 'nest-513.html': /deeper than 512 levels/, 'large-25mb.html': /larger than 2 MB/ };

/**
 * The `old` text of replace_text on a hostile target (B.8): the first word of the target's visible text (by the
 * oracle's facts) that occurs exactly once in it, as a whole word. C0.1 v2's `oldRuns` lists every run of 1 to 6
 * words and does not end on a text of 300,000 words (C0.2 v2 development run). Null when the target has none.
 */
export function firstOld(tm, ref) {
  const mine = tm.textOf(ref);
  const seen = new Set();
  for (const w of mine.split(' ')) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    const i = mine.indexOf(w);
    const bounded = (i === 0 || mine[i - 1] === ' ') && (i + w.length === mine.length || mine[i + w.length] === ' ');
    if (bounded && mine.indexOf(w, i + 1) === -1) return w;
  }
  return null;
}

/** The arguments of each operation on a target (B.8): the replace HTML of TARGETS, and fixed others. */
export function opArgs(op, target, old) {
  if (op === 'replace') return { html: target[2] };
  if (op === 'insert_after') return { html: '<p>New text</p>' };
  if (op === 'set_attribute') return { attribute: 'class', value: 'v' };
  if (op === 'replace_text') return old ? { old, new: 'x' } : null;
  return {};
}

/** The oracle: C0.2's elements, hidden refs and find counts, and C0.1 v2's facts of each file it reads. */
export function runOracle(files, work) {
  const python = at('.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw new Error('the oracle is not installed (.venv-oracle/)');
  const job = { files: {}, finds: [] };
  for (const [name, bytes] of files) if (name !== 'large-25mb.html') job.files[name] = bytes.toString('utf8');
  for (const w of FIND.hidden) job.finds.push(['hidden.html', w]);
  job.finds.push(['pre-text.html', FIND.pre], ['ten-thousand.html', FIND.many], ['regex.html', FIND.regex]);
  writeFileSync(path.join(work, 'job.json'), JSON.stringify(job));
  execFileSync(python, ['-I', '-B', at('experiments/c02/oracle_c02.py'), path.join(work, 'job.json'), path.join(work, 'oracle.json')], { stdio: 'inherit' });
  const out = JSON.parse(readFileSync(path.join(work, 'oracle.json'), 'utf8'));
  const readable = files.filter(([n]) => TARGETS[n]);
  const facts = oracleV2('facts', { files: Object.fromEntries(readable.map(([n, b]) => [n, b.toString('utf8')])) });
  return { elements: out.elements, hidden: out.hidden, count: new Map(out.finds.map(([f, t, n]) => [`${f}\0${t}`, n])), facts, modules: out.modules };
}

/** One run of every timed case against one server (B.1 to B.7). Returns the calls (with times) and the failures. */
export async function runOnce(main, files, oracle) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'hir-c02v2-'));
  const root = path.join(base, 'ws');
  const outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  const secret = Buffer.from(`<!DOCTYPE html><html><body><p>${SECRET}</p></body></html>\n`);
  writeFileSync(path.join(outside, 'secret.html'), secret);
  writeFileSync(path.join(root, 'page.html'), '<!DOCTYPE html><html><body><p>page</p></body></html>\n');
  let linked = true;
  try { symlinkSync(outside, path.join(root, 'out-link'), 'junction'); } catch { linked = false; }
  const calls = [];
  const failures = [];
  let s = startServer(main, root);
  const init = () => s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c02v2', version: '1' } });
  await init();
  const call = async (caseId, tool, args) => {
    const t0 = performance.now();
    const msg = await s.req('tools/call', { name: tool, arguments: args });
    const ms = performance.now() - t0;
    const r = msg ? { text: msg.result?.content?.[0]?.text ?? msg.error?.message ?? '', isError: !msg.result || !!msg.result.isError, ms } : { text: '', isError: true, ms, killed: true };
    calls.push({ caseId, tool, ms });
    if (process.env.C02V2_TRACE) process.stderr.write(`${caseId} ${tool} ${Math.round(ms)} ms${r.killed ? ' KILLED' : ''}
`);
    const why = [];
    if (r.killed) { why.push('c7: the harness killed the call'); s.kill(); s = startServer(main, root); await init(); }
    else {
      if (ms > LIMIT_MS) why.push('c7: the call took longer than 2 s');
      if (/took longer than/.test(r.text)) why.push('c7: the call reached the server\'s time limit');
      if (/internal error/.test(r.text)) why.push('the server gave an internal error');
      if (r.text.includes(SECRET)) why.push('c6: an output holds the text of a file outside the workspace');
      if ([...HIDDEN_WORDS, ...HIDDEN_ID_WORDS].some((w) => r.text.includes(w))) why.push('c3: an output shows hidden content');
    }
    for (const w of why) failures.push({ caseId, tool, reason: w });
    return r;
  };
  const fail = (caseId, tool, reason) => failures.push({ caseId, tool, reason });
  const snapshot = () => {
    const out = [];
    for (const dir of [root, outside]) for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isFile()) out.push(`${p}:${sha256(readFileSync(p))}`); }
    return out.sort().join('\n');
  };

  try {
    // The hostile files: the outline (as C0.2), find with a text, and each operation on the target (timed here; the
    // bytes and trees are judged once, after the runs).
    for (const [name, bytes] of files) {
      const file = path.join(root, name);
      writeFileSync(file, bytes);
      const elements = oracle.elements[name];
      const over = OVER[name];
      const seen = new Set();
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const r = await call(`${name}:outline`, 'html_outline', { file: name, page });
        if (r.isError) {
          if (!over) fail(`${name}:outline`, 'html_outline', 'c1: html_outline refuses a file that it must show');
          else if (!named('html_outline', r) || !over.test(r.text)) fail(`${name}:outline`, 'html_outline', 'a file over the limits is not refused with its reason');
          break;
        }
        const lines = r.text.split('\n');
        const head = /^page (\d+) of (\d+); hash [0-9a-f]{16}$/.exec(lines[0]);
        if (!head || Number(head[1]) !== page) { fail(`${name}:outline`, 'html_outline', 'c1: the page header is wrong'); break; }
        pages = Number(head[2]);
        const c = checkLines(lines.slice(1));
        for (const w of c.reasons) fail(`${name}:outline`, 'html_outline', w);
        for (const w of checkRefs(c.refs, elements, seen)) fail(`${name}:outline`, 'html_outline', w);
      }
      const fr = await call(`${name}:find`, 'html_find', { file: name, text: 'e' });
      if (over) { if (!named('html_find', fr) || !over.test(fr.text)) fail(`${name}:find`, 'html_find', 'a file over the limits is not refused with its reason'); }
      else if (fr.isError) fail(`${name}:find`, 'html_find', 'c4: html_find refuses a file that it must read');
      else for (const w of checkV2Output('text', fr.text, elements)) fail(`${name}:find`, 'html_find', w);
      const target = TARGETS[name];
      if (target === undefined) throw new Error(`no target for ${name}`);
      if (target === null) {
        const r = await call(`${name}:change`, 'html_change', { file: name, operation: 'remove', ref: 0, hash: hashOf(bytes) });
        if (!named('html_change', r) || !(over ?? /@0 has no source bytes/).test(r.text)) fail(`${name}:change`, 'html_change', 'not refused with its reason');
        if (!readFileSync(file).equals(bytes)) fail(`${name}:change`, 'html_change', 'c6: the file changed');
        continue;
      }
      const m = load(bytes.toString('utf8'), hashOf(bytes));
      const ref = m.els.filter((e) => e.tagName === target[0])[target[1]].ref;
      const old = firstOld(textModel(oracle.facts[name]), ref);
      for (const op of OPS) {
        const args = opArgs(op, target, old);
        if (!args) continue;
        writeFileSync(file, bytes);
        await call(`${name}:${op}`, 'html_change', { file: name, operation: op, ref, hash: hashOf(bytes), ...args });
      }
      writeFileSync(file, bytes);
    }

    // C0.2's html_find cases, with v2's html_find (B: "C0.2's hostile file set and conditions").
    const findCase = async (caseId, file, text) => {
      const r = await call(caseId, 'html_find', { file, text });
      if (r.isError) { fail(caseId, 'html_find', 'c4: a find case gives an error'); return null; }
      const foot = FIND_FOOT.exec(r.text.split('\n').at(-1));
      const want = oracle.count.get(`${file}\0${text}`);
      if (!foot || Number(foot[1]) !== want) fail(caseId, 'html_find', `c4: the count is not the oracle's count (${want})`);
      for (const w of checkV2Output('text', r.text, oracle.elements[file])) fail(caseId, 'html_find', w);
      return foot ? Number(foot[1]) : null;
    };
    for (const w of FIND.hidden) {
      if (oracle.count.get(`hidden.html\0${w}`) !== 0) fail('find:hidden', 'html_find', 'c3: the oracle counts hidden content');
      if ((await findCase('find:hidden', 'hidden.html', w)) !== 0) fail('find:hidden', 'html_find', 'c3: html_find matches hidden content');
    }
    await findCase('find:pre', 'pre-text.html', FIND.pre);
    await findCase('find:10000', 'ten-thousand.html', FIND.many);
    if (oracle.count.get(`ten-thousand.html\0${FIND.many}`) !== 10_000) fail('find:10000', 'html_find', 'c4: the oracle does not count 10,000');
    await findCase('find:regex', 'regex.html', FIND.regex);
    if (oracle.count.get(`regex.html\0${FIND.regex}`) !== 1) fail('find:regex', 'html_find', 'c4: the oracle does not count 1');
    const empty = await call('find:empty', 'html_find', { file: 'regex.html', text: '' });
    if (!named('html_find', empty)) fail('find:empty', 'html_find', 'c4: the empty search text is not refused with a named error');

    // B.4: ids on and around hidden content.
    const ids = await call('ids:shown-parent', 'html_find', { file: 'ids.html', id: IDS.shownParent });
    if (ids.isError) fail('ids:shown-parent', 'html_find', 'c3: the shown parent is not found by its id');
    else {
      for (const w of checkV2Output('id', ids.text, oracle.elements['ids.html'])) fail('ids:shown-parent', 'html_find', w);
      const hiddenRefs = new Set(oracle.hidden['ids.html'] ?? []);
      for (const l of ids.text.split('\n')) {
        const r = /^ *@(\d+) /.exec(l)?.[1];
        if (r !== undefined && hiddenRefs.has(Number(r)) && !/ \(hidden\)$/.test(l)) fail('ids:shown-parent', 'html_find', 'c3: a hidden child is shown with its attributes');
      }
    }
    for (const id of IDS.hidden) {
      const r = await call(`ids:${id}`, 'html_find', { file: 'ids.html', id });
      if (!named('html_find', r) || !/no element has the id/.test(r.text)) fail(`ids:${id}`, 'html_find', 'c3: a hidden element is found by its id');
    }

    // B.6: the time cases of the new files (the tag locator, the id listing, a long text node).
    const tags = await call('time:tag-locator', 'html_change', { file: 'tags-20000.html', operation: 'remove', text: 'cell', tag: 'td' });
    if (!named('html_change', tags) || !/^html_change: 20000 elements match; give a ref:/.test(tags.text)) fail('time:tag-locator', 'html_change', 'the ambiguous tag locator is not refused with its list');
    else for (const w of checkV2Output('locator', tags.text.replace(/^html_change: /, ''), oracle.elements['tags-20000.html'])) fail('time:tag-locator', 'html_change', w);
    const big = await call('time:id-listing', 'html_find', { file: 'id-80000.html', id: 'big' });
    if (big.isError || !big.text.includes(CUT) || big.text.length > 60_000 + 200) fail('time:id-listing', 'html_find', 'c1: the id listing is not cut at one page');
    else for (const w of checkV2Output('id', big.text, oracle.elements['id-80000.html'])) fail('time:id-listing', 'html_find', w);
    const longFile = path.join(root, 'long-text.html');
    const longBytes = readFileSync(longFile);
    const lt = await call('time:long-text', 'html_change', { file: 'long-text.html', operation: 'replace_text', text: 'needle near the end', old: 'needle near the end', new: 'found' });
    if (lt.isError) fail('time:long-text', 'html_change', 'replace_text in a long text node is refused');
    writeFileSync(longFile, longBytes);

    // B.5: the stale hash, by ref and by a locator.
    const stale = path.join(root, 'stale.html');
    const staleBytes = Buffer.from('<!DOCTYPE html><html><body><p>one</p><p>two</p></body></html>\n');
    writeFileSync(stale, staleBytes);
    const f = await call('stale', 'html_find', { file: 'stale.html', text: 'two' });
    const findHash = /hash ([0-9a-f]{16})$/.exec(f.text)?.[1];
    if (f.isError || findHash !== hashOf(staleBytes)) fail('stale', 'html_find', 'c6: find does not give the file\'s hash');
    appendFileSync(stale, '<!-- changed -->\n');
    const changed = readFileSync(stale);
    const pRef = load(staleBytes.toString(), '').els.find((e) => e.tagName === 'p').ref;
    for (const [kind, args] of [['ref', { ref: pRef }], ['text', { text: 'two' }], ['id', { id: 'none-but-checked-after-hash' }]]) {
      const r = await call(`stale:${kind}`, 'html_change', { file: 'stale.html', operation: 'remove', hash: findHash ?? '', ...args });
      if (!named('html_change', r) || !/changed since the hash/.test(r.text)) fail(`stale:${kind}`, 'html_change', 'c6: a stale hash is not refused with a named error');
    }
    if (!readFileSync(stale).equals(changed)) fail('stale', 'html_change', 'c6: the file changed');

    // B.7: bad arguments.
    const bad = [
      ['a text over 10,000 characters', 'html_find', { file: 'page.html', text: 'a'.repeat(10_001) }, /longer than 10,000 characters/],
      ['an html over 2 MB', 'html_change', { file: 'page.html', operation: 'replace', text: 'page', html: 'x'.repeat(2 * 1024 * 1024 + 1) }, /larger than 2 MB/], // the server's MB is 1,048,576 bytes
      ['a lone surrogate', 'html_change', { file: 'page.html', operation: 'replace_text', text: 'page', old: 'page', new: '\uD800' }, /lone surrogate/],
      ['n of 0', 'html_change', { file: 'ids.html', operation: 'remove', id: IDS.shownParent, child: 'p', n: 0 }, /child elements of the tag/],
      ['n below 0', 'html_change', { file: 'ids.html', operation: 'remove', id: IDS.shownParent, child: 'p', n: -1 }, /child elements of the tag/],
      ['a ref that is not an integer', 'html_change', { file: 'page.html', operation: 'remove', ref: 'x', hash: 'h' }, /not an integer/],
      ['a text that is not a string', 'html_find', { file: 'page.html', text: 5 }, /not a string/],
    ];
    for (const [kind, tool, args, want] of bad) {
      const before = snapshot();
      const r = await call(`bad:${kind}`, tool, args);
      if (!named(tool, r) || !want.test(r.text)) fail(`bad:${kind}`, tool, 'c6: a bad argument is not refused with its reason');
      if (snapshot() !== before) fail(`bad:${kind}`, tool, 'c6: a file changed');
    }

    // B.1: the path cases, with each v2 tool and `file` given.
    let stream = false;
    const secretPath = path.join(outside, 'secret.html');
    if (process.platform === 'win32') { try { writeFileSync(path.join(root, 'page.html:secret.html'), secret); stream = true; } catch { stream = false; } }
    const paths = {
      '..': ['../outside/secret.html', /holds a "\.\." segment/],
      'absolute, outside the workspace': [secretPath, /outside the workspace/],
      UNC: [process.platform === 'win32' ? `\\\\?\\${secretPath}` : `//localhost${secretPath}`, /UNC or device path/],
      'Windows device name': ['NUL.html', /Windows device name/],
      'alternate data stream': ['page.html:secret.html', /alternate data stream/],
      ...(linked ? { 'link or junction out of the workspace': ['out-link/secret.html', /outside the workspace/] } : {}),
    };
    for (const [kind, [p, reason]] of Object.entries(paths)) {
      for (const tool of TOOLS) {
        const before = snapshot();
        const args = tool === 'html_find' ? { file: p, text: 'p' } : tool === 'html_outline' ? { file: p } : { file: p, operation: 'remove', text: 'p' };
        const r = await call(`path:${kind}`, tool, args);
        if (!named(tool, r) || !reason.test(r.text)) fail(`path:${kind}`, tool, 'c6: a path case is not refused with its reason');
        if (snapshot() !== before) fail(`path:${kind}`, tool, 'c6: a file changed');
      }
    }
    return { calls, failures, linked, stream };
  } finally {
    await s.stop();
    rmSync(base, { recursive: true, force: true });
  }
}

/** B.2: the calls without `file`, each in its own folder. Returns the failures. */
async function noFileCases(main) {
  const failures = [];
  const page = Buffer.from('<!DOCTYPE html><html><body><p>only page</p></body></html>\n');
  const setups = {
    'no .html file': [(d) => writeFileSync(path.join(d, 'notes.txt'), 'x'), /holds 0 \.html or \.htm files/],
    '2 .html files': [(d) => { writeFileSync(path.join(d, 'a.html'), page); writeFileSync(path.join(d, 'b.html'), page); }, /holds 2 \.html or \.htm files/],
    '1 file and a dot file': [(d) => { writeFileSync(path.join(d, 'a.html'), page); writeFileSync(path.join(d, '.hidden.html'), '<p>dot</p>'); }, null],
    'only a link named x.html': [(d) => { mkdirSync(path.join(d, 'target')); symlinkSync(path.join(d, 'target'), path.join(d, 'x.html'), 'junction'); }, /holds 0 \.html or \.htm files/],
  };
  for (const [kind, [setup, want]] of Object.entries(setups)) {
    const d = mkdtempSync(path.join(os.tmpdir(), 'hir-c02v2-nofile-'));
    try {
      setup(d);
      const s = startServer(main, d);
      await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c02v2', version: '1' } });
      // The reads first, then the change: the change alters the file's hash (development run).
      for (const tool of ['html_find', 'html_outline', 'html_change']) {
        const args = tool === 'html_find' ? { text: 'only' } : tool === 'html_outline' ? {} : { operation: 'set_attribute', text: 'only page', attribute: 'class', value: 'v' };
        const msg = await s.req('tools/call', { name: tool, arguments: args });
        const r = { text: msg?.result?.content?.[0]?.text ?? '', isError: !msg || !!msg.result?.isError };
        if (want) { if (!named(tool, r) || !want.test(r.text)) failures.push({ caseId: `nofile:${kind}`, tool, reason: 'c6: not refused with its reason' }); }
        else {
          // The call works on the one plain file: a read gives its hash; the change changes it, and not the dot file.
          const worked = tool === 'html_change'
            ? !r.isError && readFileSync(path.join(d, 'a.html'), 'utf8').includes('class="v"') && readFileSync(path.join(d, '.hidden.html'), 'utf8') === '<p>dot</p>'
            : !r.isError && r.text.includes(`hash ${hashOf(page)}`);
          if (!worked) failures.push({ caseId: `nofile:${kind}`, tool, reason: 'the call does not work on the one plain file' });
        }
      }
      await s.stop();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
  return failures;
}

/** B.8: each operation on each target, judged once with C0.1 v2's checks (the bytes and html5lib). */
async function noWrongEdit(main, files, oracle) {
  const entries = [];
  const changes = [];
  for (const [name, bytes] of files) {
    const target = TARGETS[name];
    if (!target) continue;
    const f = entry(name, bytes);
    entries.push(f);
    const ref = f.m.els.filter((e) => e.tagName === target[0])[target[1]].ref;
    const old = firstOld(textModel(oracle.facts[name]), ref);
    for (const op of OPS) {
      const args = opArgs(op, target, old);
      if (args) changes.push({ id: `${name}:${op}`, kind: 'hostile', file: name, ref, op, args, locator: null });
    }
  }
  const outcomes = await serverOutcomes(main, entries, changes);
  const verdicts = oracleV2('check', checkJob(entries, changes, outcomes)).changes;
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const failures = [];
  for (const ch of changes) {
    const o = outcomes.get(ch.id);
    const r = reasons(entries.find((e) => e.name === ch.file), ch, o, byId.get(ch.id));
    // markup-join's removal must be refused: the splice "x <b>y" makes a new element (C0.2, review 5).
    if (ch.file === 'markup-join.html' && ch.op === 'remove' && o?.accepted) r.push('a wrong edit: the removal joins text into markup');
    for (const w of r) failures.push({ caseId: ch.id, tool: 'html_change', reason: `no wrong edit: ${w}` });
  }
  return { failures, accepted: changes.filter((c) => outcomes.get(c.id)?.accepted).length, changes: changes.length };
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const CODE = ['server', 'experiments/c02', 'experiments/c01', 'tests/gates/hostile.mjs', 'tests/gates/hostile-v2.mjs', 'experiments/c03/mcp-tools.json'];

async function main() {
  const dev = process.argv.includes('--dev');
  const startCommit = git('rev-parse', 'HEAD');
  if (!dev && git('status', '--porcelain', '--', ...CODE)) throw new Error('the gate run needs committed code: commit first, or use --dev');
  const files = [...hostileFiles(), ...hostileFilesV2()];
  const work = mkdtempSync(path.join(os.tmpdir(), 'hir-c02v2-work-'));
  try {
    const oracle = runOracle(files, work);
    const main0 = at('server/main.mjs');
    const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await runOnce(main0, files, oracle));
    const nofile = await noFileCases(main0);
    const edits = await noWrongEdit(main0, files, oracle);
    const failures = [...runs.flatMap((r, k) => r.failures.map((x) => ({ run: k + 1, ...x }))), ...nofile, ...edits.failures];
    const times = runs.flatMap((r) => r.calls.map((c) => c.ms)).sort((a, b) => a - b);
    const byCase = {};
    for (const c of runs.flatMap((r) => r.calls)) byCase[c.caseId] = Math.max(byCase[c.caseId] ?? 0, c.ms);

    // The negative controls: each must fail its condition (B.9). The POC control is C0.2's and does not use the
    // server; its result stands in c02-result.json.
    const controls = {};
    const base = path.join(at('experiments/gate-files'), 'c02v2-mutants');
    rmSync(base, { recursive: true, force: true });
    try {
      for (const [name, [cond, patches]] of Object.entries(MUTANTS)) {
        const r = await runOnce(mutantServer(base, name, patches), files, oracle);
        controls[name] = { condition: cond, failures: r.failures.length, conditions: [...new Set(r.failures.map((x) => x.reason.split(':')[0]))] };
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    const controlsOk = Object.values(controls).every((c) => c.conditions.includes(c.condition));
    if (git('rev-parse', 'HEAD') !== startCommit) throw new Error('HEAD moved during the run: run again');
    const cpu = os.cpus();
    const result = {
      gate: 'C0.2 v2', date: new Date().toISOString().slice(0, 10), commit: startCommit, dev, node: process.version,
      machine: { platform: `${os.platform()} ${os.release()}`, cpu: cpu[0]?.model, cores: cpu.length, memoryGB: Math.round(os.totalmem() / 1e9) },
      files: files.map(([name, b]) => ({ name, bytes: b.length, sha256: sha256(b) })),
      oracleModules: oracle.modules, runs: RUNS,
      linkCase: runs.every((r) => r.linked), streamCase: runs.every((r) => r.stream),
      calls: times.length,
      ms: { p50: Math.round(pct(times, 0.5)), p99: Math.round(pct(times, 0.99)), max: Math.round(times.at(-1)) },
      slowestCases: Object.entries(byCase).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, ms]) => [c, Math.round(ms)]),
      noWrongEdit: { changes: edits.changes, accepted: edits.accepted },
      failures, controls,
      verdict: failures.length === 0 && controlsOk && runs.every((r) => r.linked && (r.stream || process.platform !== 'win32')) ? 'PASS' : 'FAIL',
    };
    const out = dev ? path.join(os.tmpdir(), 'hir-c02-v2-dev-result.json') : at('experiments/c02/c02-v2-result.json');
    writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
    console.log(`C0.2 v2 ${result.verdict}: ${failures.length} failures in ${times.length} calls; p50 ${result.ms.p50} ms, p99 ${result.ms.p99} ms, max ${result.ms.max} ms; controls ok: ${controlsOk}`);
    if (dev) console.log(`dev result: ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`C0.2 v2: ${e.stack}`); process.exit(1); });
}
