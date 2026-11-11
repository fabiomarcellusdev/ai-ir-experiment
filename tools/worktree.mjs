// worktree.mjs: parallel checkouts (git worktrees), one per task branch, with the owner's local files in each.
//
//   node tools/worktree.mjs add <branch>     create a worktree for a task branch, beside the main checkout
//   node tools/worktree.mjs sync             copy the owner's local files from the main checkout into this worktree
//   node tools/worktree.mjs list             list the worktrees
//   node tools/worktree.mjs remove <branch>  remove a clean worktree (git refuses one with changes); the branch stays
//
// Rules (AGENTS.md, "Version control and CI"; decision 0003, amendment "parallel checkouts"):
// - One session per checkout. One task branch per worktree. At most `maxWorktrees` worktrees besides the main one.
// - A worktree lives in "<main checkout>.worktrees/<branch with / as ->", outside the repository.
// - Claude Code reads some git-ignored files from each checkout: `copyFromMain` in tools/worktree.config.json lists
//   them (the private notes, and the local settings that turn on local guards). `add` copies them, `sync` copies them
//   again, and `node tools/check.mjs fast` fails in a worktree where one is missing or differs.
// - The private terms and the quiet hours are not copied: the guards read them from the main checkout.
//
// Uses Node built-ins only. Exit 0 on success, 1 when refused, 2 on a usage error.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mainCheckout, isLinkedWorktree } from "./main-checkout.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The task branch names of decision 0003. */
export const TASK_BRANCH = /^(?:p\d+\/(?:feat|fix|test|docs|bench|sec|chore)-[\w.-]+|deps\/[\w.@-]+|exp\/[\w.-]+|fix\/[\w.-]+)$/;

// A copied path must be a plain relative path, and never a secret, the private files that stay in the main checkout,
// or git's own folder.
const BAD_PART = /^(|\.|\.\.|\.git|private-docs|\.local|\.env.*|.*:.*)$/i;
export function copyPathProblem(p) {
  if (typeof p !== "string" || !p || path.isAbsolute(p) || /^[a-z]:/i.test(p)) return `"${p}" is not a relative path`;
  const bad = p.split(/[\\/]/).find((part) => BAD_PART.test(part));
  return bad === undefined ? null : `"${p}" may not be copied (the part "${bad}")`;
}

export function loadConfig(root = ROOT) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "tools", "worktree.config.json"), "utf8"));
  if (!Number.isInteger(cfg.maxWorktrees) || cfg.maxWorktrees < 1) throw new Error("maxWorktrees must be a positive integer");
  if (!Array.isArray(cfg.copyFromMain)) throw new Error("copyFromMain must be a list");
  const problem = cfg.copyFromMain.map(copyPathProblem).find(Boolean);
  if (problem) throw new Error(`copyFromMain: ${problem}`);
  return cfg;
}

/** The folder of a branch's worktree: beside the main checkout, never inside it. */
export function worktreeDir(main, branch) {
  return path.join(path.dirname(main), `${path.basename(main)}.worktrees`, branch.replaceAll("/", "-"));
}

/** Every file under `p` (or `p` itself), as paths relative to `base`, with "/" on every system. */
function files(base, p) {
  const full = path.join(base, p);
  if (!fs.existsSync(full)) return [];
  if (!fs.statSync(full).isDirectory()) return [p];
  return fs.readdirSync(full).flatMap((name) => files(base, `${p}/${name}`));
}

/**
 * Problems when a worktree lacks the owner's local files: every file that the main checkout has under a
 * `copyFromMain` path must exist in the worktree with the same bytes. Extra files in the worktree are allowed.
 */
export function worktreeProblems(main, root, copyFromMain) {
  const problems = [];
  for (const item of copyFromMain) {
    for (const f of files(main, item)) {
      const there = path.join(root, f);
      if (!fs.existsSync(there)) problems.push(`${f} is missing in this worktree`);
      else if (!fs.readFileSync(there).equals(fs.readFileSync(path.join(main, f)))) problems.push(`${f} differs from the main checkout`);
    }
  }
  return problems;
}

/** Throws when a part of `rel` under `root` that exists is a link or a junction: a copy would leave the worktree. */
function refuseLinks(root, rel) {
  let cur = root;
  for (const part of rel.split("/")) {
    cur = path.join(cur, part);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (st.isSymbolicLink()) throw new Error(`${rel}: "${part}" is a link or a junction; sync writes no file through one`);
  }
}

/** One spelling per folder: links resolved, and case folded on Windows. */
function same(p) {
  const r = fs.realpathSync.native(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}
const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Throws unless the folder of `rel` resolves to the same folder under the worktree's real path. It runs directly
 * before each removal, so a junction swapped in after refuseLinks cannot send the removal into the main checkout
 * (second security review, 2026-11-08).
 */
export function refuseEscape(root, rel) {
  const want = fold(path.join(fs.realpathSync.native(root), path.dirname(rel)));
  if (same(path.join(root, path.dirname(rel))) !== want) throw new Error(`${rel}: its folder resolves outside this worktree; sync writes no file there`);
}

/**
 * Throws when the `<name>.worktrees` folder is a link or a junction. Git would record the link's target, and the
 * guards would then look for the main checkout beside that target (second security review, 2026-11-08).
 */
export function refuseLinkedWorktreesFolder(main) {
  // Resolve the main checkout first: an 8.3 short name or macOS's /var -> /private/var is not a link here.
  const folder = path.dirname(worktreeDir(fs.realpathSync.native(main), "x"));
  if (!fs.existsSync(folder) && !isLink(folder)) return;
  if (isLink(folder) || same(folder) !== fold(folder)) {
    throw new Error(`${path.basename(folder)} is a link or a junction; worktrees go only into a real folder`);
  }
}
function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/**
 * Copies the `copyFromMain` files from the main checkout into a worktree. It refuses to write through a link, removes
 * the old file first, and creates the new one only if nothing else did in between.
 */
export function syncInto(main, root, copyFromMain) {
  if (same(main) === same(root)) throw new Error("this is the main checkout; sync runs in a worktree");
  for (const item of copyFromMain) {
    const problem = copyPathProblem(item);
    if (problem) throw new Error(problem);
    for (const f of files(main, item)) {
      refuseLinks(root, f);
      const dest = path.join(root, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      refuseLinks(root, f);
      refuseEscape(root, f);
      fs.rmSync(dest, { force: true });
      fs.copyFileSync(path.join(main, f), dest, fs.constants.COPYFILE_EXCL);
    }
  }
}

// A git command in the main checkout. GIT_* variables are dropped, so a caller inside a git hook cannot point git at
// another repository.
function git(main, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  return spawnSync("git", args, { cwd: main, encoding: "utf8", env });
}

/** The linked worktrees (not the main one), from `git worktree list --porcelain`. */
export function linkedWorktrees(porcelain) {
  const blocks = porcelain.split(/\r?\n\r?\n/).filter((b) => b.trim());
  return blocks.slice(1).map((b) => ({
    dir: /^worktree (.+)$/m.exec(b)?.[1],
    branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? null,
  }));
}

function add(main, cfg, branch) {
  if (!TASK_BRANCH.test(branch ?? "")) return fail(`"${branch}" is not a task branch name (decision 0003), for example p0/feat-short-name.`);
  const list = git(main, ["worktree", "list", "--porcelain"]);
  if (list.status !== 0) return fail(`git worktree list failed: ${list.stderr.trim()}`);
  const linked = linkedWorktrees(list.stdout);
  if (linked.length >= cfg.maxWorktrees) {
    return fail(`There are already ${linked.length} worktrees (the limit is ${cfg.maxWorktrees}). Remove a finished one first: node tools/worktree.mjs remove <branch>.`);
  }
  const dir = worktreeDir(main, branch);
  if (fs.existsSync(dir)) return fail(`${dir} already exists.`);
  refuseLinkedWorktreesFolder(main);
  const exists = git(main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
  const r = git(main, exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, "main"]);
  if (r.status !== 0) return fail(`git worktree add failed: ${r.stderr.trim()}`);
  syncInto(main, dir, cfg.copyFromMain);
  console.log(`Created the worktree for ${branch}:\n  ${dir}\n`);
  console.log("Next:");
  console.log("1. Start a new Claude Code session in that folder. Never run two sessions in one checkout.");
  console.log("2. If the project has packages, install them there before a full check, with the owner's yes");
  console.log("   (AGENTS.md, \"Packages\"), with the install command of each ecosystem section that it holds.");
  console.log("3. When the pull request is merged: node tools/worktree.mjs remove " + branch);
  return 0;
}

function remove(main, branch) {
  if (!TASK_BRANCH.test(branch ?? "")) return fail(`"${branch}" is not a task branch name.`);
  const dir = worktreeDir(main, branch);
  const r = git(main, ["worktree", "remove", dir]);
  if (r.status !== 0) return fail(`git worktree remove failed (a worktree with changes is kept): ${r.stderr.trim()}`);
  console.log(`Removed ${dir}. The branch ${branch} stays; delete it after its pull request is merged.`);
  return 0;
}

function fail(message) {
  console.error(message);
  return 1;
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "worktree.mjs";
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  let code;
  try {
    const main = mainCheckout(ROOT);
    const cfg = loadConfig(ROOT);
    if (cmd === "add") code = add(main, cfg, arg);
    else if (cmd === "remove") code = remove(main, arg);
    else if (cmd === "list") {
      const r = git(main, ["worktree", "list"]);
      process.stdout.write(r.stdout);
      code = r.status === 0 ? 0 : 1;
    } else if (cmd === "sync") {
      if (!isLinkedWorktree(ROOT)) code = fail("This is the main checkout. Run sync inside a worktree.");
      else {
        syncInto(main, ROOT, cfg.copyFromMain);
        console.log("Copied the owner's local files from the main checkout.");
        code = 0;
      }
    } else {
      console.error("Usage: node tools/worktree.mjs <add <branch> | sync | list | remove <branch>>");
      code = 2;
    }
  } catch (e) {
    console.error(`worktree could not run: ${e.message}`);
    code = 1;
  }
  process.exit(code);
}
