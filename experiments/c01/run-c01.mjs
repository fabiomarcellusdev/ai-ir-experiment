// Gate C0.1, edit fidelity (docs/contract.md; decision 0006, "The oracle check for C0.1"). No model, no cost.
//   node experiments/c01/run-c01.mjs        the gate run: needs a clean tree for its code; writes c01-result.json
//   node experiments/c01/run-c01.mjs --dev  the same run on uncommitted code; writes no tracked file (the server copies
//                                           of the negative controls go in the git-ignored experiments/gate-files/)
// It drives the real server over stdio, as a harness does, and checks every edit with html5lib (oracle.py).
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, parseDoc, element, markerSource } from '../../server/view.mjs';
import { ToolError } from '../../server/errors.mjs';
import { generator } from '../c05/draw-files.mjs';
import { tokens } from './tree.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);

export const SEED = 20261110; // docs/contract.md, "The inputs": the seed of every draw
export const RANDOM_EDITS = 1000;
/** The new HTML of a random edit (docs/contract.md, C0.1, "One random edit", 3). */
export const NEW_HTML = ['', '<p>x</p>', 'line one\r\nline two', 'smile \u{1F600} here', '</div><div>', '<!--', '<script>'];
/**
 * The fragments that C0.1's "Pass", 2 lists. They are examples of the refusal rule (contract amendment "the server's
 * design", 2): one passes when the server accepts it and the oracle confirms the tree outside (owner, 2026-11-11). The
 * result lists each one that the server accepts.
 */
export const LISTED = new Set(['</div><div>', '<!--', '<script>']);
const ROOTS = new Set(['html', 'head', 'body']);
const HTML_NS = 'http://www.w3.org/1999/xhtml';
export const REFUSED = 'html_edit: the new HTML changes the document outside the element';
export const NO_RANGE = /^html_edit: @\d+ has (no source bytes; the parser created it|no clean range in the file)$/;

/** The html5lib tree-construction tests: the last commit that holds them (on 2026-06-26 they moved to WPT). */
export const TREE_TESTS = {
  repo: 'html5lib/html5lib-tests',
  commit: '9329e64694e7835d0dcff9811e22856ef6ad16f9',
  tarballSha256: '40c7c90c6b4105f20ff3448aa9257e44977b76960f2cbd275c719d2dd3a78fbe',
  folder: 'experiments/gate-files/html5lib-tests',
};

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hashOf = (b) => sha256(b).slice(0, 16);

// --- The parser-only rule (contract amendment "the C0.1 marker and draw", 3) ------------------------------------------

/**
 * The names in the oracle's text that would use html5lib's serializer, sanitizer, filters or tree walkers. Only the
 * module docstring is left out: a comment counts, so that no "#" in a string can hide a line (C0.1 review, 5).
 * Returns the names found; an empty list passes.
 * @param {string} src the text of oracle.py
 */
export function forbiddenNames(src) {
  const code = src.replace(/^\s*"""[\s\S]*?"""/, '');
  return [...new Set(code.match(/\b(serializ\w*|sanitiz\w*|filters?|treewalkers?|getTreeWalker|testSerializer)\b/gi) ?? [])];
}

// --- The inputs ----------------------------------------------------------------------------------------------------

/** The 3 copies of a file (C0.1, "The edits"): CRLF line ends, a leading BOM, and a character outside the BMP. */
export function copiesOf(text) {
  return {
    crlf: text.replace(/\r?\n/g, '\r\n'),
    bom: text.startsWith('﻿') ? text : '﻿' + text,
    // Before each "</": so that the offsets of most nodes move by a surrogate pair, in each kind of content.
    nonbmp: text.replaceAll('</', '\u{1F600}</'),
  };
}

const isRoot = (el) => el.namespaceURI === HTML_NS && ROOTS.has(el.tagName);
/** Whether the server can address an element: `element` of server/view.mjs gives it, with no named error. */
const addressable = (m, el) => {
  try {
    element(m, el.ref);
    return true;
  } catch (e) {
    if (e instanceof ToolError) return false; // a named refusal; any other error stops the run
    throw e;
  }
};

/** The refs that the random draw takes: every element except html, head and body, with a clean range. */
export function drawableRefs(m) {
  return (m.drawable ??= m.els.filter((el) => !isRoot(el) && addressable(m, el)).map((el) => el.ref));
}

/** The refs with no clean range (owner, 2026-11-11): each gets its own check, outside the random draw. */
export function noRangeRefs(m) {
  return m.els.filter((el) => !isRoot(el) && !addressable(m, el)).map((el) => el.ref);
}

/** The gate files: the rescope's 10 picks, checked against the draw's record, in task order. */
export function gateFiles() {
  const record = JSON.parse(readFileSync(at('experiments/c05/file-set.json'), 'utf8'));
  const picks = new Map(record.kinds.flatMap((k) => k.picks).map((p) => [p.file, p.sha256]));
  const tasks = JSON.parse(readFileSync(at('experiments/c05/tasks.json'), 'utf8')).tasks;
  const files = [];
  for (const t of tasks) {
    if (files.some((f) => f.path === t.file)) continue;
    const bytes = readFileSync(at(t.file));
    if (sha256(bytes) !== picks.get(t.file)) throw new Error(`${t.file} changed since the draw`);
    files.push({ path: t.file, number: t.fileNumber, bytes });
  }
  return { files, tasks };
}

/** One workspace file: its name in the workspace, bytes, text and the server's view of it. */
export function entry(name, bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return { name, bytes, text, m: load(text, hashOf(bytes)) };
}

/** An edit: the ref, the new HTML, and the range of the ref's element in the server's view, in UTF-16 units. */
export function editOf(id, f, ref, html, extra = {}) {
  const el = f.m.els[ref];
  const l = el.sourceCodeLocation;
  return { id, file: f.name, ref, ns: el.namespaceURI, tag: el.tagName, s: l?.startOffset ?? null, e: l?.endOffset ?? null, html, ...extra };
}

/**
 * The edits of the task set: for each text, attribute and structure task, html_edit replaces the task's element with
 * the expected file's text of it. The result must be the expected file.
 */
export function taskEdits(tasks, byPath) {
  const out = [];
  for (const t of tasks) {
    if (t.type === 'question') continue;
    const f = byPath.get(t.file);
    const el = f.m.els[t.ref];
    if (el.tagName !== t.tag) throw new Error(`${t.id}: the server's @${t.ref} is ${el.tagName}, the task's is ${t.tag}`);
    const { startOffset: s, endOffset: e } = el.sourceCodeLocation;
    const expected = readFileSync(at(t.file.replace(/\/[^/]+\/[^/]+$/, `/expected/${t.id}.html`)), 'utf8');
    const delta = expected.length - f.text.length;
    if (expected.slice(0, s) !== f.text.slice(0, s) || expected.slice(e + delta) !== f.text.slice(e)) {
      throw new Error(`${t.id}: the expected file changes bytes outside the task's element`);
    }
    out.push(editOf(`task:${t.id}`, f, t.ref, expected.slice(s, e + delta), { kind: 'task', expectedSha256: t.expectedSha256 }));
  }
  return out;
}

/** The random edits: a file, then a ref, then the new HTML, each drawn with the seed's stream. */
export function randomEdits(entries, rnd, count = RANDOM_EDITS) {
  const out = [];
  for (let k = 1; k <= count; k++) {
    const f = entries[rnd(entries.length)];
    const refs = drawableRefs(f.m);
    const ref = refs[rnd(refs.length)];
    const h = rnd(NEW_HTML.length);
    out.push(editOf(`random:${k}`, f, ref, NEW_HTML[h], { kind: 'random', htmlKind: h }));
  }
  return out;
}

// --- The server ----------------------------------------------------------------------------------------------------

/**
 * The negative controls: copies of the server with one line changed. The first 3 are C0.1's ("Negative controls");
 * the 4th is extra (C0.1 review, 4): a range rule that calls every located element clean. Each must make C0.1 fail.
 */
export const GOOD = "return Buffer.concat([bytes.subarray(0, bs), Buffer.from(html, 'utf8'), bytes.subarray(be)]);";
export const MUTANTS = {
  'moves the node by 1 byte': ['edit.mjs', GOOD, "return Buffer.concat([bytes.subarray(0, bs + 1), Buffer.from(html, 'utf8'), bytes.subarray(be + 1)]);"],
  'writes the whole file again from the tree': ['edit.mjs', GOOD, "return Buffer.from(serialize(doc2), 'utf8');"],
  'changes CRLF to LF': ['edit.mjs', GOOD, String.raw`return Buffer.from(Buffer.concat([bytes.subarray(0, bs), Buffer.from(html, 'utf8'), bytes.subarray(be)]).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');`],
  'calls every located range clean (extra)': ['view.mjs', 'return clean.set(n, false);', 'return clean.set(n, true);'],
};

/** A copy of the server with one line changed, inside the repository so that it finds parse5. */
function mutantServer(name, base) {
  const dir = path.join(base, name.replace(/\W+/g, '-'));
  mkdirSync(path.join(dir, 'server'), { recursive: true });
  mkdirSync(path.join(dir, 'experiments', 'c03'), { recursive: true });
  for (const f of readdirSync(at('server'))) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) copyFileSync(at('server', f), path.join(dir, 'server', f));
  copyFileSync(at('experiments/c03/mcp-tools.json'), path.join(dir, 'experiments', 'c03', 'mcp-tools.json'));
  const [file, from, to] = MUTANTS[name];
  const p = path.join(dir, 'server', file);
  const src = readFileSync(p, 'utf8');
  if (src.split(from).length !== 2) throw new Error(`the control "${name}" cannot find the line it changes in server/${file}`);
  writeFileSync(p, src.replace(from, to));
  return path.join(dir, 'server', 'main.mjs');
}

/** The server process, spoken to over stdio as a harness does. */
function startServer(main, root) {
  const p = spawn(process.execPath, [main, '--root', root], { stdio: ['pipe', 'pipe', 'inherit'] });
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
    waiting.set(id, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    req,
    tool: async (name, args) => (await req('tools/call', { name, arguments: args })).result,
    stop: () => new Promise((r) => { p.on('exit', r); p.stdin.end(); }),
  };
}

/**
 * Runs each edit on a fresh copy of its file through the server, and records what the server did. A record holds no
 * file content: only whether the bytes are the expected bytes.
 */
export async function serverOutcomes(main, entries, edits) {
  const root = mkdtempSync(path.join(tmpdir(), 'hir-c01-'));
  const s = startServer(main, root);
  try {
    await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c01', version: '1' } });
    const byName = new Map(entries.map((f) => [f.name, f]));
    const hashes = new Map();
    for (const f of entries) {
      writeFileSync(path.join(root, f.name), f.bytes);
      const page = (await s.tool('html_outline', { file: f.name })).content[0].text;
      hashes.set(f.name, page.match(/; hash (\w{16})$/m)[1]);
    }
    const out = new Map();
    for (const ed of edits) {
      const f = byName.get(ed.file);
      const file = path.join(root, f.name);
      writeFileSync(file, f.bytes);
      const r = await s.tool('html_edit', { file: f.name, ref: ed.ref, hash: hashes.get(f.name), html: ed.html });
      const text = r.content[0].text;
      const after = readFileSync(file);
      const o = { accepted: !r.isError, text: r.isError ? text : null, unchanged: after.equals(f.bytes) };
      if (ed.s !== null) {
        const want = Buffer.concat([Buffer.from(f.text.slice(0, ed.s)), Buffer.from(ed.html), Buffer.from(f.text.slice(ed.e))]);
        o.bytesOk = after.equals(want);
      }
      if (!r.isError) o.hashOk = text === `ok; hash ${hashOf(after)}`;
      if (ed.expectedSha256) o.expectedOk = sha256(after) === ed.expectedSha256;
      out.set(ed.id, o);
    }
    return out;
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

// --- The oracle ----------------------------------------------------------------------------------------------------

const PYTHON = at('.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const oracleReady = () => existsSync(PYTHON);

/** The number of code points in the first `u` UTF-16 units of `text`. */
export function codePoints(text, u) {
  let pairs = 0;
  for (let i = 0; i < u; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) pairs++;
  }
  return u - pairs;
}

const tokenHash = (text) => sha256(JSON.stringify(tokens(parseDoc(text))));

/**
 * The oracle's verdicts: for each file, its element count and whether its tree equals parse5's; for each edit, the
 * tag check, the marker check, whether the splice keeps the tree outside the element, and whether html5lib and parse5
 * agree on the marked and the spliced document.
 * @param {ReturnType<typeof entry>[]} entries @param {object[]} edits @param {string} work a temporary folder
 */
export function runOracle(entries, edits, work) {
  const job = { files: {}, edits: [] };
  for (const f of entries) job.files[f.name] = { text: f.text, parse5: tokens(parseDoc(f.text)) };
  const byName = new Map(entries.map((f) => [f.name, f]));
  for (const ed of edits) {
    if (ed.s === null) { job.edits.push({ id: ed.id, file: ed.file, ref: ed.ref, ns: ed.ns, tag: ed.tag, s: null }); continue; }
    const { text: t, m } = byName.get(ed.file);
    // The same marker as oracle.py's, with the attributes of parse5's element: for the parser comparison only.
    const mark = markerSource(m.els[ed.ref], 'data-oracle-mark', '1');
    job.edits.push({
      id: ed.id, file: ed.file, ref: ed.ref, ns: ed.ns, tag: ed.tag,
      s: codePoints(t, ed.s), e: codePoints(t, ed.e), html: ed.html,
      parse5Marked: tokenHash(t.slice(0, ed.s) + mark + t.slice(ed.e)),
      parse5Spliced: tokenHash(t.slice(0, ed.s) + ed.html + t.slice(ed.e)),
    });
  }
  const jobPath = path.join(work, 'job.json');
  const outPath = path.join(work, 'oracle.json');
  writeFileSync(jobPath, JSON.stringify(job));
  execFileSync(PYTHON, ['-I', '-B', at('experiments/c01/oracle.py'), 'check', jobPath, outPath], { stdio: 'inherit' });
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

/** The oracle loaded a module of html5lib's filters or sanitizer (the parser-only rule, at run time). */
export const filterModules = (modules) => modules.filter((x) => /^html5lib\.(filters|sanitizer)/.test(x));

// --- The verdict ---------------------------------------------------------------------------------------------------

/**
 * The reasons an edit fails; an empty list passes (C0.1, "Pass", and the contract amendments of 2026-11-11).
 * @param {object} ed the edit @param {object} o the server's outcome @param {object} v the oracle's verdict
 */
export function reasons(ed, o, v) {
  const r = [];
  if (v.error) r.push(`the oracle stopped (${v.error})`);
  if (!v.tagOk) r.push('the oracle finds another element at the ref');
  if (ed.kind === 'no-range') {
    // The server refuses by design; the oracle confirms that the parser's range is not exact, where one exists.
    if (o.accepted) r.push('accepted an element with no clean range');
    else if (!NO_RANGE.test(o.text)) r.push('refused with another error');
    if (!o.unchanged) r.push('the file changed');
    if (ed.s !== null && v.markerOk) r.push('the oracle finds the range exact');
    return r;
  }
  if (!v.markerOk) r.push('the range does not hold exactly the element');
  if (o.accepted) {
    if (!o.bytesOk) r.push('the bytes are not the bytes before, the new HTML and the bytes after');
    if (!o.hashOk) r.push('the returned hash is not the hash of the result');
    if (v.kept !== true) r.push('accepted, but the tree outside the element changed');
    if (ed.expectedSha256 && !o.expectedOk) r.push('the result is not the expected file');
  } else {
    if (o.text !== REFUSED) r.push('refused with another error');
    if (!o.unchanged) r.push('the file changed');
    if (v.kept !== false) r.push('refused, but the oracle finds the tree outside unchanged');
  }
  return r;
}

/** Judges every edit. Returns the failures, each with its edit id and reasons. */
export function judge(edits, outcomes, verdicts) {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const failures = [];
  for (const ed of edits) {
    const r = reasons(ed, outcomes.get(ed.id), byId.get(ed.id) ?? { error: 'no verdict' });
    if (r.length) failures.push({ id: ed.id, file: ed.file, ref: ed.ref, tag: ed.tag, html: ed.kind === 'random' ? ed.htmlKind : null, reasons: r });
  }
  return failures;
}

// --- The run -------------------------------------------------------------------------------------------------------

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const CODE = ['server', 'experiments/c01', 'experiments/c03/mcp-tools.json', 'experiments/c05/draw-files.mjs'];

async function main() {
  const dev = process.argv.includes('--dev');
  if (!dev && git('status', '--porcelain', '--', ...CODE)) throw new Error('the gate run needs committed code: commit first, or use --dev');
  if (!oracleReady()) throw new Error('the oracle is not installed: see AGENTS.md, "Python: pip, for the C0.1 oracle only"');

  // 1. The parser-only rule.
  const oracleSrc = readFileSync(at('experiments/c01/oracle.py'), 'utf8');
  const names = forbiddenNames(oracleSrc);
  const control = forbiddenNames(oracleSrc + '\nfrom html5lib.serializer import serialize\n');
  const work = mkdtempSync(path.join(tmpdir(), 'hir-c01-work-'));
  try {
    // 2. The html5lib tree-construction tests.
    const tar = path.join(at(TREE_TESTS.folder), 'tests.tar.gz');
    if (!existsSync(tar) || sha256(readFileSync(tar)) !== TREE_TESTS.tarballSha256) {
      throw new Error(`the tree tests are missing or changed: gh api repos/${TREE_TESTS.repo}/tarball/${TREE_TESTS.commit} > ${TREE_TESTS.folder}/tests.tar.gz, then extract it there`);
    }
    const treeOut = path.join(work, 'tree.json');
    execFileSync(PYTHON, ['-I', '-B', at('experiments/c01/oracle.py'), 'treetests', path.join(at(TREE_TESTS.folder), `html5lib-html5lib-tests-${TREE_TESTS.commit.slice(0, 7)}`, 'tree-construction'), treeOut], { stdio: 'inherit' });
    const tree = JSON.parse(readFileSync(treeOut, 'utf8'));
    const uniq = (list) => [...new Set(list.map((x) => x.id.split(' ')[0]))];

    // 3. The files and their copies.
    const { files, tasks } = gateFiles();
    const rnd = generator(SEED);
    const originals = files.map((f) => entry(`${f.number}.html`, f.bytes));
    const chosen = [];
    while (chosen.length < 2) { const i = rnd(originals.length); if (!chosen.includes(i)) chosen.push(i); }
    const copies = chosen.flatMap((i) => Object.entries(copiesOf(originals[i].text)).map(([k, t]) => entry(`${files[i].number}-${k}.html`, Buffer.from(t, 'utf8'))));
    const entries = [...originals, ...copies];

    // 4. The edits.
    const byPath = new Map(files.map((f, i) => [f.path, originals[i]]));
    const edits = [...taskEdits(tasks, byPath), ...randomEdits(entries, rnd)];
    for (const f of entries) for (const ref of noRangeRefs(f.m)) edits.push(editOf(`no-range:${f.name}@${ref}`, f, ref, '<p>x</p>', { kind: 'no-range' }));

    // 5. The oracle, then the server, then the negative controls.
    const oracle = runOracle(entries, edits, work);
    const outcomes = await serverOutcomes(at('server/main.mjs'), entries, edits);
    const failures = judge(edits, outcomes, oracle.edits);
    const controls = {};
    const mutants = path.join(at('experiments/gate-files'), 'c01-mutants');
    rmSync(mutants, { recursive: true, force: true });
    try {
      for (const name of Object.keys(MUTANTS)) {
        const out = await serverOutcomes(mutantServer(name, mutants), entries, edits);
        controls[name] = judge(edits, out, oracle.edits).length;
      }
    } finally {
      rmSync(mutants, { recursive: true, force: true });
    }

    // 6. The result.
    const count = (pred) => edits.filter(pred).length;
    const accepted = (pred) => edits.filter((e) => pred(e) && outcomes.get(e.id).accepted).length;
    const disagree = (key) => oracle.edits.filter((v) => v[key] === false).map((v) => v.id);
    const result = {
      gate: 'C0.1',
      date: new Date().toISOString().slice(0, 10),
      commit: git('rev-parse', 'HEAD'),
      dev,
      node: process.version,
      parse5: JSON.parse(readFileSync(at('node_modules/parse5/package.json'), 'utf8')).version,
      python: execFileSync(PYTHON, ['-I', '-B', '-c', 'import sys, html5lib; print(sys.version.split()[0], html5lib.__version__)'], { encoding: 'utf8' }).trim(),
      seed: SEED,
      parserOnly: { forbiddenNames: names, oracleModules: oracle.modules, filterModules: filterModules(oracle.modules), controlFinds: control },
      treeTests: {
        ...TREE_TESTS,
        files: tree.files,
        tests: tree.tests, runs: tree.runs, passedRuns: tree.passed,
        failedTests: uniq(tree.failed), skippedTests: uniq(tree.skipped),
      },
      files: entries.map((f) => ({ name: f.name, sha256: sha256(f.bytes), refs: f.m.els.length, ...oracle.files[f.name] })),
      copiesOf: chosen.map((i) => files[i].number),
      edits: {
        task: count((e) => e.kind === 'task'), taskAccepted: accepted((e) => e.kind === 'task'),
        random: count((e) => e.kind === 'random'),
        randomByHtml: NEW_HTML.map((h, i) => ({ html: JSON.stringify(h), edits: count((e) => e.htmlKind === i), accepted: accepted((e) => e.htmlKind === i) })),
        noRange: count((e) => e.kind === 'no-range'), noRangeWithoutLocation: count((e) => e.kind === 'no-range' && e.s === null),
      },
      parsersDisagree: { marked: disagree('markerAgree'), spliced: disagree('spliceAgree') },
      listedAccepted: edits.filter((e) => LISTED.has(e.html) && outcomes.get(e.id).accepted).map((e) => ({ id: e.id, file: e.file, ref: e.ref, tag: e.tag, html: e.html })),
      failures,
      controls,
      verdict: failures.length === 0 && names.length === 0 && filterModules(oracle.modules).length === 0 && control.length > 0 && Object.values(controls).every((n) => n > 0) ? 'PASS' : 'FAIL',
    };
    const json = JSON.stringify(result, null, 1) + '\n';
    if (dev) writeFileSync(path.join(work, '..', 'hir-c01-dev-result.json'), json);
    else writeFileSync(at('experiments/c01/c01-result.json'), json);
    console.log(`C0.1 ${result.verdict}: ${failures.length} failures in ${edits.length} edits; controls ${JSON.stringify(controls)}; parser-only ${names.length ? 'FAIL' : 'ok'}`);
    if (dev) console.log(`dev result: ${path.join(work, '..', 'hir-c01-dev-result.json')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`C0.1: ${e.message}`); process.exit(1); });
}
