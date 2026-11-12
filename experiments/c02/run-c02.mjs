// Gate C0.2, hostile files (docs/contract.md, C0.2). No model, no cost. TIMED: leave the machine alone.
//   node experiments/c02/run-c02.mjs        the gate run: needs a clean tree for its code; writes c02-result.json
//   node experiments/c02/run-c02.mjs --dev  the same run on uncommitted code; writes no tracked file (the server copies
//                                           of the negative controls go in the git-ignored experiments/gate-files/)
// It drives the real server over stdio, as a harness does. Each case runs 5 times, each time in a new workspace.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync, symlinkSync, statSync, appendFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from '../../server/view.mjs';
import { hostileFiles, FIND, HIDDEN_WORDS } from '../../tests/gates/hostile.mjs';
import { runOracle as markerOracle, entry, editOf, REFUSED } from '../c01/run-c01.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hashOf = (b) => sha256(b).slice(0, 16);

export const RUNS = 5;
export const LIMIT_MS = 2000; // C0.2, "Pass", 7
const KILL_MS = 10_000; // the harness kills a call with no answer after this time
export const SECRET = 'TOP-SECRET-5510'; // in the file outside the workspace; no output may hold it
/** The POC of pull request #1, for negative control 1: its view as it was on the branch exp/html-ir-poc. */
export const POC = { commit: '748a75d05a90ac10d81226ed753d67a6ac12a84e', path: 'experiments/html-ir/ir.mjs' };

// --- The checks of one output (C0.2, "Pass") -----------------------------------------------------------------------

/** The tag as the view shows it (server/view.mjs, escTag): each character outside a plain set as a reference. */
export const shownTag = (t) => t.replace(/[^A-Za-z0-9._:-]/gu, (c) => `&#x${c.codePointAt(0).toString(16)};`);

/**
 * Condition 1 and 2 on the lines of a view: after its indent, each line starts with "@<n> " or "| ", and a text line
 * holds no "<". Returns the reasons and the refs with their shown tags.
 * @param {string[]} lines the content lines, without the header or footer line
 */
export function checkLines(lines) {
  const reasons = [];
  const refs = [];
  for (const line of lines) {
    const body = line.replace(/^ */, '');
    const el = /^@(\d+) ([^#(]*)/.exec(body);
    if (el) { refs.push([Number(el[1]), el[2]]); continue; }
    if (!body.startsWith('| ')) { reasons.push('c1: a line is neither an element line nor a text line'); continue; }
    if (body.includes('<')) reasons.push('c2: a text line holds a "<"');
  }
  return { reasons: [...new Set(reasons)], refs };
}

/**
 * The rest of condition 1: in html_outline each ref appears once, and each ref names an element that the oracle finds,
 * with the same tag. `seen` holds the refs of the earlier pages.
 */
export function checkRefs(refs, elements, seen = new Set()) {
  const reasons = new Set();
  for (const [ref, tag] of refs) {
    if (seen.has(ref)) reasons.add('c1: a ref appears twice');
    seen.add(ref);
    if (!elements || elements[ref] === undefined || shownTag(elements[ref]) !== tag) reasons.add('c1: a ref names no element of the oracle, or another tag');
  }
  return [...reasons];
}

const OUTLINE_HEAD = /^page (\d+) of (\d+); hash [0-9a-f]{16}$/;
const FIND_FOOT = /^(\d+) matches(; output cut at 60,000 characters)?; hash [0-9a-f]{16}$/;

/**
 * The checks of one html_find output: its footer; element lines only, each ref once and an element of the oracle
 * with its tag (condition 1; C0.2 review, 1); at most 20 matches returned (condition 4); no long data: URI
 * (condition 5).
 * @param {string} text @param {string[]} elements the oracle's elements of the file, in ref order
 */
export function checkFind(text, elements) {
  const all = text.split('\n');
  const reasons = [];
  if (!FIND_FOOT.test(all.at(-1))) reasons.push('c1: the find footer is wrong');
  const lines = all.slice(0, -1).filter((l) => l !== '');
  const c = checkLines(lines);
  reasons.push(...c.reasons);
  if (c.refs.length !== lines.length) reasons.push('c1: a find line is not an element line');
  reasons.push(...checkRefs(c.refs, elements));
  if (returnedMatches(lines) > 20) reasons.push('c4: more than 20 matches returned');
  if (/data:[^\s"')]{101}/.test(text)) reasons.push('c5: an output holds a data: URI longer than 100 characters');
  return [...new Set(reasons)];
}

/** The number of matches that a find output returns: the lines with no deeper line right after them (the leaves). */
export function returnedMatches(lines) {
  const depth = (l) => l.length - l.replace(/^ */, '').length;
  return lines.filter((l, i) => i === lines.length - 1 || depth(lines[i + 1]) <= depth(l)).length;
}

/** A named error: the tool's own error text, not an internal error and not the time limit. */
export const named = (tool, r) => r.isError && r.text.startsWith(`${tool}: `) && !/internal error|took longer than/.test(r.text);

// --- The server ----------------------------------------------------------------------------------------------------

function startServer(main, root) {
  const p = spawn(process.execPath, [main, '--root', root], { stdio: ['pipe', 'pipe', 'ignore'] });
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

/** A copy of the server with one line of server/view.mjs changed, inside the repository so that it finds parse5. */
function mutantServer(base, name, [from, to]) {
  const dir = path.join(base, name.replace(/\W+/g, '-'));
  mkdirSync(path.join(dir, 'server'), { recursive: true });
  mkdirSync(path.join(dir, 'experiments', 'c03'), { recursive: true });
  for (const f of readdirSync(at('server'))) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) copyFileSync(at('server', f), path.join(dir, 'server', f));
  copyFileSync(at('experiments/c03/mcp-tools.json'), path.join(dir, 'experiments', 'c03', 'mcp-tools.json'));
  const p = path.join(dir, 'server', 'view.mjs');
  const src = readFileSync(p, 'utf8');
  if (src.split(from).length !== 2) throw new Error(`the control "${name}" cannot find the line it changes in server/view.mjs`);
  writeFileSync(p, src.replace(from, to));
  return path.join(dir, 'server', 'main.mjs');
}

/** The negative controls that change the server (C0.2, "Negative controls"), each with the condition it must fail. */
export const MUTANTS = {
  'a planted backtracking regex': ['c7', ['  const doc = parseDoc(text);\n', '  /^<a(?: x="1"| x="1")*!/.test(text);\n  const doc = parseDoc(text);\n']],
  'html_find reads its search text as a regular expression': ['c4', [
    '  for (let i = m.vis.indexOf(text); i !== -1; i = m.vis.indexOf(text, i + 1)) occ.push(i);',
    "  for (const x of m.vis.matchAll(new RegExp(text, 'g'))) occ.push(x.index);"]],
  'html_find matches hidden content': ['c3', [
    'if (n.tagName && (NOT_VISIBLE.has(n.tagName) || hidden.has(n)))', 'if (n.tagName && NOT_VISIBLE.has(n.tagName))']],
  'html_find with no limit on matches': ['c4', ['const MAX_MATCHES = 20;', 'const MAX_MATCHES = Infinity;']],
};

// --- The run -------------------------------------------------------------------------------------------------------

/** The element that each file's read and edit cases use, and the edit's new HTML; null: the file has none. */
const TARGETS = {
  'pre-text.html': ['pre', 1, '<pre>@5 div#fake\n| fake line</pre>'],
  'hidden.html': ['div', 0, '<div hidden>replaced</div>'],
  'markup-join.html': ['script', 0, ''], // the splice "x <b>y" makes a b element: html_edit must refuse
  'attributes.html': ['a', 0, '<a href="/b" title="one\nline">first</a>'],
  'unclosed-comment.html': ['p', 0, '<p>edited</p>'],
  'unclosed-script.html': ['p', 0, '<p>edited</p>'],
  'backtrack-2.html': ['a', 0, '<a href="/ok">l</a>'],
  'regex.html': ['p', 1, '<p>edited</p>'],
  'data-uri.html': ['img', 0, '<img alt="small" src="/s.png">'],
  'ten-thousand.html': ['li', 5000, '<li>edited</li>'],
  'fostered-2mb.html': ['td', 5000, '<td>new</td>'], // a range that needs the server's marker parse
  'nest-513.html': null, // the server refuses the file: deeper than 512 levels
  'backtrack-1.html': null, // the parser drops the unclosed start tag: no element but html, head and body
  'large-25mb.html': null, // the server refuses the file: larger than 2 MB
};
const MUST_REFUSE = new Set(['markup-join.html']);
/** The files that the server must refuse whole, with the reason it must give. */
const OVER = { 'nest-513.html': /deeper than 512 levels/, 'large-25mb.html': /larger than 2 MB/ };

/** The oracle's elements of each file and its count for each find case. */
function runOracle(files, work) {
  const python = at('.venv-oracle', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw new Error('the oracle is not installed: see AGENTS.md, "Python: pip, for the C0.1 oracle only"');
  const job = { files: {}, finds: [] };
  for (const [name, bytes] of files) if (name !== 'large-25mb.html') job.files[name] = bytes.toString('utf8');
  for (const w of FIND.hidden) job.finds.push(['hidden.html', w]);
  job.finds.push(['pre-text.html', FIND.pre], ['ten-thousand.html', FIND.many], ['regex.html', FIND.regex]);
  writeFileSync(path.join(work, 'job.json'), JSON.stringify(job));
  execFileSync(python, ['-I', '-B', at('experiments/c02/oracle_c02.py'), path.join(work, 'job.json'), path.join(work, 'oracle.json')], { stdio: 'inherit' });
  const out = JSON.parse(readFileSync(path.join(work, 'oracle.json'), 'utf8'));
  // The C0.1 oracle confirms the ref, the range and the tree outside of each hostile edit (C0.2 review, 5).
  const entries = [];
  const edits = [];
  for (const [name, bytes] of files) {
    const target = TARGETS[name];
    if (!target) continue;
    const f = entry(name, bytes);
    const [tag, nth, html] = target;
    entries.push(f);
    edits.push(editOf(name, f, f.m.els.filter((e) => e.tagName === tag)[nth].ref, html));
  }
  const marker = markerOracle(entries, edits, work);
  return {
    elements: out.elements,
    hidden: out.hidden,
    count: new Map(out.finds.map(([f, t, n]) => [`${f}\0${t}`, n])),
    edits: Object.fromEntries(marker.edits.map((v) => [v.id, v])),
    modules: [...new Set([...out.modules, ...marker.modules])].sort(),
  };
}

/** One run of every case against one server. Returns the calls (with times) and the failures. */
async function runOnce(main, files, oracle) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'hir-c02-'));
  const root = path.join(base, 'ws');
  const outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  const secret = Buffer.from(`<!DOCTYPE html><html><body><p>${SECRET}</p></body></html>\n`);
  writeFileSync(path.join(outside, 'secret.html'), secret);
  writeFileSync(path.join(root, 'page.html'), '<!DOCTYPE html><html><body><p>page</p></body></html>\n');
  let linked = true;
  try {
    symlinkSync(outside, path.join(root, 'out-link'), 'junction');
  } catch {
    linked = false; // recorded in the result: the link case then did not run
  }
  const byName = new Map(files);
  const calls = [];
  const failures = [];
  let s = startServer(main, root);
  await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c02', version: '1' } });

  /** One tool call, with the checks that hold for every call (condition 7, no secret, no internal error). */
  const call = async (caseId, tool, args) => {
    const t0 = performance.now();
    const msg = await s.req('tools/call', { name: tool, arguments: args });
    const ms = performance.now() - t0;
    const r = msg ? { text: msg.result.content[0].text, isError: !!msg.result.isError, ms } : { text: '', isError: true, ms, killed: true };
    calls.push({ caseId, tool, ms });
    const why = [];
    if (r.killed) {
      why.push('c7: the harness killed the call');
      s.kill();
      s = startServer(main, root);
      await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c02', version: '1' } });
    } else {
      if (ms > LIMIT_MS) why.push('c7: the call took longer than 2 s');
      if (/took longer than/.test(r.text)) why.push('c7: the call reached the server\'s time limit');
      if (/internal error/.test(r.text)) why.push('the server gave an internal error');
      if (r.text.includes(SECRET)) why.push('c6: an output holds the text of a file outside the workspace');
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
    // The hostile files: outline (all pages), find, read and edit.
    for (const [name, bytes] of files) {
      const file = path.join(root, name);
      writeFileSync(file, bytes);
      const elements = oracle.elements[name];
      const over = OVER[name];
      // html_outline, every page. A file over the limits must be refused with its reason; every other file must give
      // every page (C0.2 review, 4).
      const seen = new Set();
      let pages = 1;
      const text = [];
      for (let page = 1; page <= pages; page++) {
        const r = await call(`${name}:outline`, 'html_outline', { file: name, page });
        if (r.isError) {
          if (!over) fail(`${name}:outline`, 'html_outline', 'c1: html_outline refuses a file that it must show');
          else if (!named('html_outline', r) || !over.test(r.text)) fail(`${name}:outline`, 'html_outline', 'a file over the limits is not refused with its reason');
          break;
        }
        const lines = r.text.split('\n');
        const head = OUTLINE_HEAD.exec(lines[0]);
        if (!head || Number(head[1]) !== page) { fail(`${name}:outline`, 'html_outline', 'c1: the page header is wrong'); break; }
        pages = Number(head[2]);
        const c = checkLines(lines.slice(1));
        for (const w of c.reasons) fail(`${name}:outline`, 'html_outline', w);
        for (const w of checkRefs(c.refs, elements, seen)) fail(`${name}:outline`, 'html_outline', w);
        text.push(r.text);
      }
      const all = text.join('\n');
      // Condition 3: no hidden word, and no line of a hidden element or of an element inside one, unless marked.
      const hiddenRefs = new Set(oracle.hidden[name] ?? []);
      for (const l of all.split('\n')) {
        const ref = /^ *@(\d+) /.exec(l)?.[1];
        const shown = HIDDEN_WORDS.some((w) => l.includes(w)) || (ref !== undefined && hiddenRefs.has(Number(ref)));
        if (shown && !l.includes('(hidden)')) fail(`${name}:outline`, 'html_outline', 'c3: the outline shows hidden content');
      }
      if (name === 'markup-join.html' && !/^ *\| x &lt;/m.test(all)) fail(`${name}:outline`, 'html_outline', 'c2: the "<" from text is not "&lt;"');
      if (name === 'data-uri.html' && !all.includes(`data:…(${'data:image/png;base64,'.length + 100_000} chars)`)) fail(`${name}:outline`, 'html_outline', 'c5: the data: URI is not shortened with its length');
      if (/data:[^\s"')]{101}/.test(all)) fail(`${name}:outline`, 'html_outline', 'c5: an output holds a data: URI longer than 100 characters');
      if (over && text.length) fail(`${name}:outline`, 'html_outline', 'the server read a file over its limits');

      // html_find: a word of the file's text. Its lines are element lines of the oracle's elements (C0.2 review, 1).
      const fr = await call(`${name}:find`, 'html_find', { file: name, text: 'e' });
      if (over) {
        if (!named('html_find', fr) || !over.test(fr.text)) fail(`${name}:find`, 'html_find', 'a file over the limits is not refused with its reason');
      } else if (fr.isError) {
        fail(`${name}:find`, 'html_find', 'c4: html_find refuses a file that it must read');
      } else {
        for (const w of checkFind(fr.text, elements)) fail(`${name}:find`, 'html_find', w);
      }

      // html_read and html_edit of one element.
      const target = TARGETS[name];
      if (target === undefined) throw new Error(`no target for ${name}`);
      const hash = hashOf(bytes);
      if (target === null) {
        for (const tool of ['html_read', 'html_edit']) {
          const r = await call(`${name}:${tool}`, tool, { file: name, ref: 0, hash, html: '' });
          const want = over ?? /@0 has no source bytes/; // the implied html element; read and edit check the ref first
          if (!named(tool, r) || !want.test(r.text)) fail(`${name}:${tool}`, tool, 'not refused with its reason');
        }
        if (!readFileSync(file).equals(bytes)) fail(`${name}:html_edit`, 'html_edit', 'c6: the file changed');
        continue;
      }
      const [tag, nth, html] = target;
      const m = load(bytes.toString('utf8'), hash);
      const el = m.els.filter((e) => e.tagName === tag)[nth];
      const { startOffset: st, endOffset: en } = el.sourceCodeLocation;
      // The ref, the range and the tree outside, confirmed by the oracle (C0.2 review, 5).
      const v = oracle.edits[name];
      if (!v?.tagOk) fail(`${name}:html_edit`, 'html_edit', 'the oracle finds another element at the ref');
      if (!v?.markerOk) fail(`${name}:html_edit`, 'html_edit', 'the oracle finds that the range does not hold exactly the element');
      const rr = await call(`${name}:html_read`, 'html_read', { file: name, ref: el.ref, hash });
      if (rr.isError || rr.text !== m.text.slice(st, en)) fail(`${name}:html_read`, 'html_read', 'the read does not return the element\'s bytes');
      const er = await call(`${name}:html_edit`, 'html_edit', { file: name, ref: el.ref, hash, html });
      const after = readFileSync(file);
      if (MUST_REFUSE.has(name)) {
        if (er.text !== REFUSED || !after.equals(bytes) || v?.kept !== false) fail(`${name}:html_edit`, 'html_edit', 'a wrong edit: the splice changes the tree outside the element');
      } else {
        const want = Buffer.concat([Buffer.from(m.text.slice(0, st)), Buffer.from(html), Buffer.from(m.text.slice(en))]);
        if (er.isError || !after.equals(want) || v?.kept !== true) fail(`${name}:html_edit`, 'html_edit', 'a wrong edit: the bytes are not the bytes before, the new HTML and the bytes after');
      }
      writeFileSync(file, bytes);
    }

    // The html_find cases.
    const findCase = async (caseId, file, text) => {
      const r = await call(caseId, 'html_find', { file, text });
      if (r.isError) return fail(caseId, 'html_find', 'c4: a find case gives an error');
      const lines = r.text.split('\n');
      const foot = FIND_FOOT.exec(lines.at(-1));
      const want = oracle.count.get(`${file}\0${text}`);
      if (!foot || Number(foot[1]) !== want) fail(caseId, 'html_find', `c4: the count is not the oracle's count (${want})`);
      for (const w of checkFind(r.text, oracle.elements[file])) fail(caseId, 'html_find', w);
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

    // The stale-ref case.
    const stale = path.join(root, 'stale.html');
    const staleBytes = Buffer.from('<!DOCTYPE html><html><body><p>one</p><p>two</p></body></html>\n');
    writeFileSync(stale, staleBytes);
    const o = await call('stale', 'html_outline', { file: 'stale.html' });
    const f = await call('stale', 'html_find', { file: 'stale.html', text: 'two' });
    // Both tools work, and each gives the file's hash (C0.2 review, 6).
    const outlineHash = /; hash ([0-9a-f]{16})$/m.exec(o.text)?.[1];
    const findHash = /; hash ([0-9a-f]{16})$/.exec(f.text)?.[1];
    if (o.isError || f.isError || outlineHash !== hashOf(staleBytes) || findHash !== hashOf(staleBytes)) fail('stale', 'html_outline', 'c6: outline or find does not give the file\'s hash');
    appendFileSync(stale, '<!-- changed -->\n');
    const changed = readFileSync(stale);
    const ref = load(staleBytes.toString(), '').els.find((e) => e.tagName === 'p').ref;
    for (const [tool, oldHash] of [['html_read', outlineHash], ['html_edit', outlineHash], ['html_read', findHash], ['html_edit', findHash]]) {
      const r = await call('stale', tool, { file: 'stale.html', ref, hash: oldHash ?? '', html: '<p>x</p>' });
      if (!named(tool, r) || !/changed since the hash/.test(r.text)) fail('stale', tool, 'c6: a stale hash is not refused with a named error');
    }
    if (!readFileSync(stale).equals(changed)) fail('stale', 'html_edit', 'c6: the file changed');

    // The path cases, with each tool.
    const secretRef = load(secret.toString(), '').els.find((e) => e.tagName === 'p').ref;
    // Each path leads to a real file where the system allows it, and each must be refused for its own reason, so that
    // "the file is not found" cannot pass (C0.2 review, 3). The stream holds the secret on NTFS.
    const secretPath = path.join(outside, 'secret.html');
    let stream = false;
    if (process.platform === 'win32') {
      try {
        writeFileSync(path.join(root, 'page.html:secret.html'), secret);
        stream = true;
      } catch {
        stream = false; // not NTFS: the case still needs its own reason
      }
    }
    const paths = {
      '..': ['../outside/secret.html', /holds a "\.\." segment/],
      'absolute, outside the workspace': [secretPath, /outside the workspace/],
      UNC: [process.platform === 'win32' ? `\\\\?\\${secretPath}` : `//localhost${secretPath}`, /UNC or device path/],
      'Windows device name': ['NUL.html', /Windows device name/],
      'alternate data stream': ['page.html:secret.html', /alternate data stream/],
      ...(linked ? { 'link or junction out of the workspace': ['out-link/secret.html', /outside the workspace/] } : {}),
    };
    const streamBytes = () => (stream ? readFileSync(path.join(root, 'page.html:secret.html')) : null);
    for (const [kind, [p, reason]] of Object.entries(paths)) {
      for (const tool of ['html_outline', 'html_find', 'html_read', 'html_edit']) {
        const before = snapshot();
        const r = await call(`path:${kind}`, tool, { file: p, text: 'p', ref: secretRef, hash: hashOf(secret), html: '<p>changed</p>' });
        if (!named(tool, r) || !reason.test(r.text)) fail(`path:${kind}`, tool, 'c6: a path case is not refused with its reason');
        if (snapshot() !== before || (stream && !streamBytes().equals(secret))) fail(`path:${kind}`, tool, 'c6: a file changed');
      }
    }
    return { calls, failures, linked, stream };
  } finally {
    await s.stop();
    rmSync(base, { recursive: true, force: true });
  }
}

/** Negative control 1: the POC's view of the nested pre case must break condition 1. */
export async function pocControl(files, work, oracle) {
  const src = execFileSync('git', ['show', `${POC.commit}:${POC.path}`], { cwd: ROOT, encoding: 'utf8' });
  if (/^\s*import\s/m.test(src)) throw new Error('the POC module imports a module; the control cannot load it alone');
  const p = path.join(work, 'poc-ir.mjs');
  writeFileSync(p, src);
  const ir = await import(pathToFileURL(p).href);
  const text = new Map(files).get('pre-text.html').toString('utf8');
  const out = ir.encode(ir.view(ir.number(ir.parse(text))), { refs: true }).split('\n');
  // Only the lines of the nested pre: the line of the deepest pre and the lines below it (C0.2 review, 2). Other POC
  // lines (its doctype line, for example) would fail condition 1 for another reason.
  const indent = (l) => l.length - l.replace(/^ */, '').length;
  const pres = out.map((l, i) => [l, i]).filter(([l]) => /^ *@\d+ pre\.$/.test(l));
  const [preLine, i] = pres.reduce((a, b) => (indent(b[0]) > indent(a[0]) ? b : a));
  const lines = [preLine];
  for (let k = i + 1; k < out.length && (out[k] === '' || indent(out[k]) > indent(preLine)); k++) if (out[k] !== '') lines.push(out[k]);
  if (indent(preLine) === 0 || lines.length < 3) throw new Error('the POC control did not find the nested pre');
  const c = checkLines(lines);
  return [...c.reasons, ...checkRefs(c.refs, oracle.elements['pre-text.html'])];
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const CODE = ['server', 'experiments/c02', 'experiments/c01', 'tests/gates/hostile.mjs', 'experiments/c03/mcp-tools.json'];

async function main() {
  const dev = process.argv.includes('--dev');
  if (!dev && git('status', '--porcelain', '--', ...CODE)) throw new Error('the gate run needs committed code: commit first, or use --dev');
  const files = hostileFiles();
  const work = mkdtempSync(path.join(os.tmpdir(), 'hir-c02-work-'));
  try {
    const oracle = runOracle(files, work);
    const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await runOnce(at('server/main.mjs'), files, oracle));
    const failures = runs.flatMap((r, k) => r.failures.map((f) => ({ run: k + 1, ...f })));
    const times = runs.flatMap((r) => r.calls.map((c) => c.ms)).sort((a, b) => a - b);
    const byCase = {};
    for (const c of runs.flatMap((r) => r.calls)) byCase[c.caseId] = Math.max(byCase[c.caseId] ?? 0, c.ms);

    // The negative controls.
    const controls = {};
    const poc = await pocControl(files, work, oracle);
    controls['the POC view on the nested pre case'] = { condition: 'c1', failures: poc.length, conditions: [...new Set(poc.map((x) => x.split(':')[0]))] };
    const base = path.join(at('experiments/gate-files'), 'c02-mutants');
    rmSync(base, { recursive: true, force: true });
    try {
      for (const [name, [cond, patch]] of Object.entries(MUTANTS)) {
        const r = await runOnce(mutantServer(base, name, patch), files, oracle);
        controls[name] = { condition: cond, failures: r.failures.length, conditions: [...new Set(r.failures.map((f) => f.reason.split(':')[0]))] };
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    const controlsOk = Object.values(controls).every((c) => c.conditions.includes(c.condition));

    const cpu = os.cpus();
    const result = {
      gate: 'C0.2',
      date: new Date().toISOString().slice(0, 10),
      commit: git('rev-parse', 'HEAD'),
      dev,
      node: process.version,
      machine: { platform: `${os.platform()} ${os.release()}`, cpu: cpu[0]?.model, cores: cpu.length, memoryGB: Math.round(os.totalmem() / 1e9) },
      files: files.map(([name, b]) => ({ name, bytes: b.length, sha256: sha256(b) })),
      oracleModules: oracle.modules,
      runs: RUNS,
      linkCase: runs.every((r) => r.linked),
      streamCase: runs.every((r) => r.stream),
      calls: times.length,
      ms: { p50: Math.round(pct(times, 0.5)), p99: Math.round(pct(times, 0.99)), max: Math.round(times.at(-1)) },
      slowestCases: Object.entries(byCase).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, ms]) => [c, Math.round(ms)]),
      failures,
      controls,
      verdict: failures.length === 0 && controlsOk && runs.every((r) => r.linked && (r.stream || process.platform !== 'win32')) ? 'PASS' : 'FAIL',
    };
    const json = JSON.stringify(result, null, 1) + '\n';
    const out = dev ? path.join(os.tmpdir(), 'hir-c02-dev-result.json') : at('experiments/c02/c02-result.json');
    writeFileSync(out, json);
    console.log(`C0.2 ${result.verdict}: ${failures.length} failures in ${times.length} calls; p50 ${result.ms.p50} ms, p99 ${result.ms.p99} ms; controls ok: ${controlsOk}`);
    if (dev) console.log(`dev result: ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`C0.2: ${e.stack}`); process.exit(1); });
}
