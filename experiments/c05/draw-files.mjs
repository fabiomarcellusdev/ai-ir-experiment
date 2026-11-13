// Draws gate C0.5's fresh file set (docs/contract.md, "The new inputs (a fresh draw)"), before any token count or
// view. Usage, from the repository root: node experiments/c05/draw-files.mjs
// Needs the GitHub CLI (`gh`), logged in, to read file contents at the pinned commits. No new search runs.
// It runs once: it refuses to run when experiments/c05/file-set.json exists, or when experiments/ or the parser has
// uncommitted changes. Writes experiments/c05/file-set.json (committed, with the SHA-256 of this script and of every
// module whose rules it uses) and the drawn files to experiments/gate-files/c05/<kind>/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// Not named select-files.mjs: the C0.3 script runs its draw when argv[1] ends with that name, also when imported.
import { contentRule } from '../c03/select-files.mjs';
import { candidates, isAncestor, applyChange } from '../c03/make-tasks.mjs';
import { load, norm } from '../c03/html.mjs';

export const SEED = 20261111;
export const RULE_MODULES = ['experiments/c05/draw-files.mjs', 'experiments/c03/select-files.mjs',
  'experiments/c03/make-tasks.mjs', 'experiments/c03/html.mjs'];

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
// "Sorted by name": the full `owner/repo` name, and the full path, in UTF-16 code-unit order.
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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
  return [...byRepo.keys()].sort(byCodeUnits).map((repo) => ({ repo, files: byRepo.get(repo).sort((a, b) => byCodeUnits(a.path, b.path)) }));
}

/** A template: text with `{{`, `{%`, `<%` or `<?php` anywhere. The contract does not judge templates. */
export const templateRule = (text) => (/\{\{|\{%|<%|<\?php/.test(text) ? 'a template ({{, {%, <% or <?php)' : null);

const words = (s) => s.trim().split(' ').filter(Boolean);
const quoteOf = (s) => words(norm(s)).slice(0, 6).join(' ');
const countP = (src) => load(src).els.filter((e) => e.tagName === 'p').length;

/**
 * Which task types a file cannot give: an existence check over every candidate, with the C0.3 task rules of
 * make-tasks.mjs (review, 2026-11-11: a seeded try could miss a rare target). `even` checks an insertion, else a
 * removal. Returns the missing types.
 */
export function missingTypes(text, even) {
  const m = load(text);
  const cands = candidates(m);
  const missing = [];
  if (!cands.some((el) => el.attrs.length)) missing.push('question');
  const textOk = (el) => el.childNodes.some((tn) => {
    if (tn.nodeName !== '#text' || words(norm(tn.value)).length < 3) return false;
    const q = quoteOf(tn.value);
    if (m.els.some((o) => m.shown.has(o) && (m.vt.get(o) ?? '').includes(q) && o !== el && !isAncestor(m, o, el))) return false;
    const at = m.src.indexOf(q, tn.sourceCodeLocation.startOffset);
    return at >= 0 && at + q.length <= tn.sourceCodeLocation.endOffset;
  });
  if (!cands.some(textOk)) missing.push('text');
  if (!cands.some((el) => el.attrs.some((a) => el.sourceCodeLocation.attrs?.[a.name]))) missing.push('attribute');
  if (even) {
    const p = countP(text);
    const ok = (el) => countP(applyChange(text, [el.sourceCodeLocation.endOffset, el.sourceCodeLocation.endOffset, '<p>New text</p>'])) === p + 1;
    if (!cands.some(ok)) missing.push('structure (insert)');
  } else if (!cands.length) missing.push('structure (remove)');
  return missing;
}

/** The task rule: the file can give all 4 task types, both as an odd file and as an even file. */
export function taskRule(text) {
  const missing = [...new Set([...missingTypes(text, false), ...missingTypes(text, true)])];
  return missing.length ? `cannot give the task types: ${missing.join(', ')}` : null;
}

/** The rules a downloaded file must pass, in this order: C0.3's content rules, the template rule, the task rule. */
export const fileRule = (text) => contentRule(text) ?? templateRule(text) ?? taskRule(text);

/**
 * The draw of one kind, with the generator stream `rnd` (contract, "The new inputs"):
 * 1. Shuffle the repositories. Take them in that order.
 * 2. In a repository, shuffle its files and read them in that order. The first file that passes `rule` is the
 *    repository's pick. A repository with no passing file gives no pick.
 * 3. Stop at 2 picks.
 * 4. When the repositories run out with 1 pick, the second pick is the next passing file of the first pick's
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

/**
 * The whole draw over C0.3's record: the kinds in the record's order, one generator stream with `seed`, the owners
 * of C0.3's picks removed, and each picked repository removed from the later kinds.
 */
export function drawAll(c03, seed, readText, rule = fileRule) {
  const excludedOwners = new Set(c03.kinds.flatMap((k) => k.picks.map((p) => owner(p.repo))));
  const rnd = generator(seed);
  const used = new Set();
  const kinds = [];
  for (const kind of c03.kinds) {
    const commitOf = new Map(kind.repos.map((r) => [r.repo, r.commit]));
    const repos = pool(kind, excludedOwners, used);
    const { picks, read } = drawKind(repos, rnd, (f) => readText({ ...f, commit: commitOf.get(f.repo) }), rule);
    for (const p of picks) used.add(p.repo);
    kinds.push({ kind: kind.kind, repositories: repos.length, files: repos.reduce((n, r) => n + r.files.length, 0), read,
      picks: picks.map((p) => ({ ...p, commit: commitOf.get(p.repo) })) });
  }
  return { excludedOwners: [...excludedOwners].sort(byCodeUnits), kinds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('experiments/c05/file-set.json')) throw new Error('experiments/c05/file-set.json exists: the draw runs once');
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'experiments/c03', 'experiments/c05', 'package.json', 'pnpm-lock.yaml'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`commit the draw's inputs before the draw:\n${dirty}`);
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  const c03 = JSON.parse(readFileSync('experiments/c03/file-set.json', 'utf8'));
  const raw = (f) => execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
    `repos/${f.repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${f.commit}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const d = drawAll(c03, SEED, raw);
  const out = { date: new Date().toISOString().slice(0, 10), seed: SEED,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    rules: Object.fromEntries(RULE_MODULES.map((p) => [p, sha(readFileSync(p))])),
    parse5: JSON.parse(readFileSync('node_modules/parse5/package.json', 'utf8')).version,
    from: 'experiments/c03/file-set.json', excludedOwners: d.excludedOwners, kinds: [] };
  for (const k of d.kinds) {
    const dir = join('experiments', 'gate-files', 'c05', k.kind);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const rows = k.picks.map((p, i) => {
      const file = join(dir, `${i + 1}-${p.path.split('/').pop()}`).replaceAll('\\', '/');
      writeFileSync(file, p.text);
      return { repo: p.repo, commit: p.commit, path: p.path, size: p.size, sameRepository: !!p.sameRepository, sha256: sha(Buffer.from(p.text, 'utf8')), file };
    });
    out.kinds.push({ kind: k.kind, repositories: k.repositories, files: k.files, readInDrawOrder: k.read, picks: rows });
    console.log(`${k.kind}: ${k.repositories} repositories in the pool; ${k.read.length} files read; picks: ${rows.map((p) => `${p.repo}/${p.path}`).join(', ')}`);
  }
  writeFileSync('experiments/c05/file-set.json', JSON.stringify(out, null, 1) + '\n');
}
