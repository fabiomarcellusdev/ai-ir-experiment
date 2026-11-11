// Draws gate C0.5's fresh file set (docs/contract.md, "The new inputs (a fresh draw)"), before any token count or
// view. Usage, from the repository root: node experiments/c05/draw-files.mjs
// Needs the GitHub CLI (`gh`), logged in, to read file contents at the pinned commits. No new search runs.
// Writes experiments/c05/file-set.json (committed, with this script's SHA-256) and the drawn files to
// experiments/gate-files/c05/<kind>/ (git-ignored: other people's content).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
// Not named select-files.mjs: the C0.3 script runs its draw when argv[1] ends with that name, also when imported.
import { contentRule } from '../c03/select-files.mjs';
import { makeTasks, candidates } from '../c03/make-tasks.mjs';
import { load } from '../c03/html.mjs';

export const SEED = 20261111;

/** The generator of C0.3 (high bits of a 31-bit LCG), as one stream for the whole draw. */
export function generator(seed) {
  let s = seed;
  return (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >>> 16) % n; };
}

/** A Fisher-Yates shuffle that takes its numbers from the stream `rnd`. */
export function shuffle(items, rnd) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const owner = (repo) => repo.split('/')[0].toLowerCase();

/**
 * The pool of one kind: the C0.3 candidates that passed the path rules (the size is the tree's blob size, already
 * applied), minus every file in a repository whose owner is the owner of a C0.3 pick, and minus the repositories
 * that an earlier kind of this draw picked. Returns the repositories sorted by name, each with its files sorted by
 * path.
 */
export function pool(kind, excludedOwners, usedRepos = new Set()) {
  const byRepo = new Map();
  for (const [repo, path, size] of kind.passPathRules) {
    if (excludedOwners.has(owner(repo)) || usedRepos.has(repo)) continue;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push({ repo, path, size });
  }
  return [...byRepo.keys()].sort().map((repo) => ({ repo, files: byRepo.get(repo).sort((a, b) => (a.path < b.path ? -1 : 1)) }));
}

/** A template: text with `{{`, `{%`, `<%` or `<?php` anywhere. The contract does not judge templates. */
export const templateRule = (text) => (/\{\{|\{%|<%|<\?php/.test(text) ? 'a template ({{, {%, <% or <?php)' : null);

/** A file must give all 4 task types, as file 1 (a removal) and as file 2 (an insertion), with the C0.5 seed. */
export function taskRule(text) {
  // With no candidate at all, makeTasks fails with a TypeError (it draws from an empty list), not its named error.
  if (!candidates(load(text)).length) return 'cannot give the 4 task types (no candidate target)';
  try {
    makeTasks([{ file: 'x', src: text }], SEED);
    makeTasks([{ file: 'x', src: text }, { file: 'y', src: text }], SEED);
    return null;
  } catch (e) {
    if (/no element meets the task rules/.test(e.message)) return 'cannot give the 4 task types';
    throw e; // any other error is a bug: stop the draw
  }
}

/** The rules a downloaded file must pass, in this order: C0.3's content rules, the template rule, the task rule. */
export const fileRule = (text) => contentRule(text) ?? templateRule(text) ?? taskRule(text);

/**
 * The draw of one kind, with the C0.3 generator in one stream (contract, "The new inputs"):
 * 1. Shuffle the repositories. Take them in that order.
 * 2. In a repository, shuffle its files and read them in that order. The first file that passes `fileRule` is the
 *    repository's pick. A repository with no passing file gives no pick.
 * 3. Stop at 2 picks.
 * 4. When the repositories run out with 1 pick, the second pick is the next passing file in the first pick's
 *    repository, in the same order. With 0 picks, the draw stops with an error.
 */
export function drawKind(repos, rnd, readText, rule = fileRule, want = 2) {
  const picks = [];
  const read = [];
  const rest = new Map(); // the unread files of each picked repository, in their shuffled order
  const take = (files) => {
    while (files.length) {
      const f = files.shift();
      const text = readText(f);
      const why = rule(text);
      read.push([f.repo, f.path, why ?? 'pass']);
      if (!why) return { ...f, text };
    }
    return null;
  };
  for (const r of shuffle(repos, rnd)) {
    if (picks.length === want) break;
    const files = shuffle(r.files, rnd);
    const p = take(files);
    if (p) { picks.push(p); rest.set(r.repo, files); }
  }
  if (picks.length === 0) throw new Error('no repository has a file that passes the rules');
  for (let i = 0; picks.length < want && i < picks.length; i++) {
    const p = take(rest.get(picks[i].repo));
    if (p) picks.push({ ...p, sameRepository: true });
  }
  if (picks.length < want) throw new Error(`only ${picks.length} of ${want} files pass the rules`);
  return { picks, read };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const c03 = JSON.parse(readFileSync('experiments/c03/file-set.json', 'utf8'));
  const excludedOwners = new Set(c03.kinds.flatMap((k) => k.picks.map((p) => owner(p.repo))));
  const raw = (repo, sha, path) => execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
    `repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const rnd = generator(SEED);
  const script = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  const out = { date: new Date().toISOString().slice(0, 10), seed: SEED, script: { path: 'experiments/c05/draw-files.mjs', sha256: script },
    from: 'experiments/c03/file-set.json', excludedOwners: [...excludedOwners].sort(), kinds: [] };
  const used = new Set();
  for (const kind of c03.kinds) {
    const commitOf = new Map(kind.repos.map((r) => [r.repo, r.commit]));
    const repos = pool(kind, excludedOwners, used);
    const { picks, read } = drawKind(repos, rnd, (f) => raw(f.repo, commitOf.get(f.repo), f.path));
    for (const p of picks) used.add(p.repo);
    const dir = join('experiments', 'gate-files', 'c05', kind.kind);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const rows = picks.map((p, i) => {
      const file = join(dir, `${i + 1}-${p.path.split('/').pop()}`).replaceAll('\\', '/');
      writeFileSync(file, p.text);
      return { repo: p.repo, commit: commitOf.get(p.repo), path: p.path, size: p.size, sameRepository: !!p.sameRepository,
        sha256: createHash('sha256').update(p.text, 'utf8').digest('hex'), file };
    });
    out.kinds.push({ kind: kind.kind, repositories: repos.length, files: repos.reduce((n, r) => n + r.files.length, 0), readInDrawOrder: read, picks: rows });
    console.log(`${kind.kind}: ${repos.length} repositories in the pool; ${read.length} files read; picks: ${rows.map((p) => `${p.repo}/${p.path}`).join(', ')}`);
  }
  writeFileSync('experiments/c05/file-set.json', JSON.stringify(out, null, 1) + '\n');
}
