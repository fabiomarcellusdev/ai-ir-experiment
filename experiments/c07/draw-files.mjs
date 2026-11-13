// Draws the file set of one gate of the second rescope (docs/contract.md, "Phase 0, second rescope", "The inputs"):
// C0.5's draw rules, with the pool also without the owners of C0.5's picks, the name rule, and the gate's own task rule.
//   node experiments/c07/draw-files.mjs <c07|c08|c09>
// Needs the GitHub CLI (`gh`), logged in, to read file contents at the pinned commits, and the oracle (.venv-oracle/).
// C0.7's task rule also needs the owner's key for count_tokens (free). The draw of a gate runs once: it refuses to run
// when its record exists, or when its inputs have uncommitted changes. Writes experiments/c07/<gate>-file-set.json
// (committed) and the files to experiments/gate-files/c07/<gate>/<n>/<base name> (git-ignored).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentRule } from '../c03/select-files.mjs';
import { generator, shuffle, templateRule } from '../c05/draw-files.mjs';
import { GATES, taskRule, tokenCounter, storedPath, PATHS, MIN_FILES } from './tasks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
export const RULE_MODULES = ['experiments/c07/draw-files.mjs', 'experiments/c07/tasks.mjs', 'experiments/c07/rules.mjs',
  'experiments/c07/oracle_c07.py', 'experiments/c01/oracle.py', 'experiments/c01/tree.mjs', 'experiments/c01/run-c01.mjs',
  'experiments/c03/select-files.mjs', 'experiments/c03/make-tasks.mjs', 'experiments/c03/html.mjs',
  'experiments/c05/draw-files.mjs', 'server/view.mjs', 'server/edit.mjs', 'server/errors.mjs', 'server/v2.mjs',
  'server/source.mjs', 'server/workspace.mjs'];

const owner = (repo) => repo.split('/')[0].toLowerCase();
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * The name rule (a path rule, before a file is read): a plain base name, not a device name, no trailing dot. The lead
 * also refuses a name that does not start with a letter or a digit (a hidden `.x.html` that Glob may not list) and a
 * name over 100 characters (security review, F7).
 */
export function nameRule(p) {
  const name = p.split('/').pop();
  if (!/^[A-Za-z0-9._-]+\.html$/.test(name)) return 'the base name has a character outside [A-Za-z0-9._-]';
  if (!/^[A-Za-z0-9]/.test(name)) return 'the base name does not start with a letter or a digit';
  if (name.length > 100) return 'the base name is over 100 characters';
  if (DEVICE.test(name)) return 'a Windows device name';
  if (name.endsWith('.')) return 'the name ends in a dot';
  return null;
}

/**
 * The downloaded bytes as text: they must have the tree's recorded size and be valid UTF-8, so that the record pins
 * the repository's own bytes (security review, F3). The pool's files are at most 500 KB, so 1 MB is enough.
 */
export function checkedText(bytes, size) {
  if (bytes.length !== size) throw new Error(`the download has ${bytes.length} bytes; the tree records ${size}`);
  try {
    // ignoreBOM keeps a leading BOM in the text, so the stored file has the same bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null; // Not UTF-8: the file rule refuses it with a named reason.
  }
}

/** The owners removed from the pool: the owners of C0.3's picks (C0.5's list) and of C0.5's picks. */
export function excludedOwners(c05) {
  return new Set([...c05.excludedOwners.map((o) => o.toLowerCase()), ...c05.kinds.flatMap((k) => k.picks.map((p) => owner(p.repo)))]);
}

/** One kind's pool: C0.3's candidates that passed its path rules and the name rule, without the removed owners and
 * the repositories that an earlier kind of this draw picked; repositories by name, files by path. */
export function pool(kind, excluded, usedRepos) {
  const byRepo = new Map();
  for (const [repo, p, size] of kind.passPathRules) {
    if (excluded.has(owner(repo)) || usedRepos.has(repo) || nameRule(p)) continue;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push({ repo, path: p, size });
  }
  return [...byRepo.keys()].sort(byCodeUnits).map((repo) => ({ repo, files: byRepo.get(repo).sort((a, b) => byCodeUnits(a.path, b.path)) }));
}

/**
 * The draw of one kind (C0.5's steps, async because the task rule may count tokens). Returns 0, 1 or 2 picks: the
 * caller applies the contract's fallback. With 1 pick after the repositories run out, the second pick is the next
 * passing file of the first pick's repository.
 */
export async function drawKind(repos, rnd, readText, rule, want = 2) {
  const picks = [];
  const read = [];
  const rest = new Map();
  const take = async (files) => {
    while (files.length) {
      const f = files.shift();
      const text = readText(f);
      const why = await rule(text);
      read.push([f.repo, f.path, why ?? 'pass']);
      if (!why) return { ...f, text };
    }
    return null;
  };
  for (const r of shuffle(repos, rnd)) {
    if (picks.length === want) break;
    const files = shuffle(r.files, rnd);
    const p = await take(files);
    if (p) { picks.push(p); rest.set(r.repo, files); }
  }
  for (let i = 0; picks.length && picks.length < want && i < picks.length; i++) {
    const p = await take(rest.get(picks[i].repo));
    if (p) picks.push({ ...p, sameRepository: true });
  }
  return { picks, read };
}

/** The rules a downloaded file must pass, in this order: C0.3's content rules, the template rule, the gate's task rule. */
export const fileRule = (gate, count) => async (text) => (text === null ? 'not valid UTF-8'
  : contentRule(text) ?? templateRule(text) ?? await taskRule(gate, text, count));

/** The files of a gate (contract, amendment of decision 0008, item 4). The fewest with which a gate runs: MIN_FILES. */
export const GATE_FILES = 10;

/**
 * The whole draw of a gate: the kinds in C0.3's order, one stream of the gate's seed, 2 files of each kind. Then the
 * fill rule (contract, amendment of decision 0008, item 4): when the gate has fewer than 10 files, the missing files
 * come from the kinds in C0.3's order, one file from each kind in turn (owner, 2026-11-12), with the same stream,
 * until the gate has 10 files or a full round gives no file. Each turn draws 1 file, so the same-repository fallback
 * of drawKind never runs in a fill: a fill never reads a file again, and never takes a repository that the draw
 * already picked (review of the fill rule, 1). Each fill pick is marked with its round, and stays under its own
 * kind. A gate with fewer than 6 files gets no task set (tasks.mjs).
 */
export async function drawAll(c03, c05, gate, readText, rule) {
  const excluded = excludedOwners(c05);
  const rnd = generator(GATES[gate].seed);
  const used = new Set();
  const seen = new Set();
  const kinds = [];
  const draw = async (kind, repos, want) => {
    const commitOf = new Map(kind.repos.map((r) => [r.repo, r.commit]));
    const { picks, read } = await drawKind(repos, rnd, (f) => readText({ ...f, commit: commitOf.get(f.repo) }), rule, want);
    for (const [repo, p] of read) seen.add(`${repo}\n${p}`);
    for (const p of picks) used.add(p.repo);
    return { read, picks: picks.map((p) => ({ ...p, commit: commitOf.get(p.repo) })) };
  };
  for (const kind of c03.kinds) {
    const repos = pool(kind, excluded, used);
    const { read, picks } = await draw(kind, repos, 2);
    kinds.push({ kind: kind.kind, repositories: repos.length, files: repos.reduce((n, r) => n + r.files.length, 0), read, picks });
  }
  let missing = GATE_FILES - kinds.reduce((n, k) => n + k.picks.length, 0);
  for (let round = 1, gave = true; missing > 0 && gave; round++) {
    gave = false;
    for (const [i, kind] of c03.kinds.entries()) {
      if (missing <= 0) break;
      const repos = pool(kind, excluded, used).map((r) => ({ repo: r.repo, files: r.files.filter((f) => !seen.has(`${f.repo}\n${f.path}`)) }))
        .filter((r) => r.files.length);
      if (!repos.length) continue;
      const { read, picks } = await draw(kind, repos, 1);
      (kinds[i].fillRead ??= []).push(...read);
      kinds[i].picks.push(...picks.map((p) => ({ ...p, fill: round })));
      missing -= picks.length;
      if (picks.length) gave = true;
    }
  }
  return { excludedOwners: [...excluded].sort(byCodeUnits), kinds };
}

async function main() {
  const gate = process.argv[2];
  if (!GATES[gate]) throw new Error('usage: node experiments/c07/draw-files.mjs <c07|c08|c09|c10>');
  const out = at(PATHS.fileSet(gate));
  if (existsSync(out)) throw new Error(`${path.relative(ROOT, out)} exists: the draw runs once`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'experiments/c01', 'experiments/c03', 'experiments/c05', 'experiments/c07', 'server', 'package.json', 'pnpm-lock.yaml'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`commit the draw's inputs before the draw:\n${dirty}`);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const c03 = JSON.parse(readFileSync(at('experiments/c03/file-set.json'), 'utf8'));
  const c05 = JSON.parse(readFileSync(at('experiments/c05/file-set.json'), 'utf8'));
  const count = gate === 'c07' ? tokenCounter(readFileSync(at('.local/anthropic-api-key'), 'utf8').trim()) : null;
  const raw = (f) => checkedText(execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
    `repos/${f.repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${f.commit}`], { maxBuffer: 1 << 20 }), f.size);
  const d = await drawAll(c03, c05, gate, raw, fileRule(gate, count));
  const record = { gate, date: new Date().toISOString().slice(0, 10), seed: GATES[gate].seed,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    rules: Object.fromEntries(RULE_MODULES.map((p) => [p, sha(readFileSync(at(p)))])),
    parse5: JSON.parse(readFileSync(at('node_modules/parse5/package.json'), 'utf8')).version,
    from: 'experiments/c03/file-set.json', excludedOwners: d.excludedOwners, kinds: [] };
  const dir = PATHS.store(gate);
  rmSync(at(dir), { recursive: true, force: true });
  let n = 0;
  for (const k of d.kinds) {
    const rows = k.picks.map((p) => {
      const file = storedPath(dir, ++n, p.path.split('/').pop());
      mkdirSync(at(path.dirname(file)), { recursive: true });
      writeFileSync(at(file), p.text);
      return { repo: p.repo, commit: p.commit, path: p.path, size: p.size, sameRepository: !!p.sameRepository, fill: p.fill ?? false, sha256: sha(Buffer.from(p.text, 'utf8')), file };
    });
    record.kinds.push({ kind: k.kind, repositories: k.repositories, files: k.files, readInDrawOrder: k.read, ...(k.fillRead ? { fillReadInDrawOrder: k.fillRead } : {}), picks: rows });
    console.log(`${k.kind}: ${k.repositories} repositories; ${k.read.length + (k.fillRead?.length ?? 0)} files read; ${rows.length} picks: ${rows.map((p) => `${p.repo}/${p.path}${p.fill ? ' (fill)' : ''}`).join(', ')}`);
  }
  writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  if (n < MIN_FILES) console.log(`${n} files, under ${MIN_FILES}: the gate does not run (the record stays)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
