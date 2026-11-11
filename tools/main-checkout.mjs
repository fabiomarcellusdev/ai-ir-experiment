// main-checkout.mjs: finds the main checkout of this repository, also from inside a linked git worktree.
//
// The owner's private files are git-ignored, so only the main checkout has them: private-docs/ (the privacy terms)
// and .local/ (the quiet hours). A new worktree does not. If a guard read them from its own checkout, it would skip
// its check there without a word. So the guards read them from the main checkout (decision 0003, amendment
// "parallel checkouts").
//
// A session in a worktree can rewrite or delete its own `.git` file, so that file alone must never decide where the
// main checkout is (security review, 2026-11-08). The main checkout comes from the folder layout that
// tools/worktree.mjs makes, and git's own records must agree with it:
//
// 1. `<root>/.git` is a folder without a `commondir` file, and <root> is not inside a `<name>.worktrees` folder:
//    <root> is the main checkout.
// 2. <root> is `<parent>/<name>.worktrees/<branch>`: the main checkout is `<parent>/<name>`. Its `.git` must be a
//    folder; `<root>/.git` must be a file whose gitdir is inside `<main>/.git/worktrees/`; and that folder's
//    `gitdir` file (git's back-link) must point to `<root>/.git`; and its `commondir` file (the repository that git
//    really uses) must point to `<main>/.git`. Paths are compared after links are resolved.
// 3. No `.git` and no `.worktrees` parent (a source copy, as in some CI steps): <root> is used as it is.
// 4. Anything else: it throws. The callers fail closed: a push is refused, and quiet hours count as on.
//
// It reads files only and starts no git process, so that it stays fast when the git hooks call it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUFFIX = ".worktrees";

/** One spelling per folder: links resolved, and case folded on Windows. Throws when the path does not exist. */
function same(p) {
  const r = fs.realpathSync.native(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** True when the folder name ends in ".worktrees" (without case on Windows) and has a name before it. */
function isWorktreesFolder(name) {
  const n = process.platform === "win32" ? name.toLowerCase() : name;
  return n.endsWith(SUFFIX) && n.length > SUFFIX.length;
}

export function mainCheckout(start = ROOT) {
  // The real spelling on disk: links resolved, and on Windows the case as stored. A path typed in another case must
  // not skip the layout test below (second security review, 2026-11-08).
  const root = fs.realpathSync.native(start);
  const parent = path.dirname(root);
  const inWorktrees = isWorktreesFolder(path.basename(parent));
  const dotGit = path.join(root, ".git");
  let st;
  try {
    st = fs.lstatSync(dotGit);
  } catch (e) {
    if (e.code === "ENOENT" && !inWorktrees) return root;
    throw new Error(e.code === "ENOENT" ? "a worktree without its .git file" : `cannot read the .git entry (${e.code})`);
  }
  if (!inWorktrees) {
    // Only a linked worktree's record has a commondir file. A `.git` folder that has one is a copied record.
    if (st.isDirectory() && !fs.existsSync(path.join(dotGit, "commondir"))) return root;
    throw new Error("a linked worktree outside a <name>.worktrees folder; create worktrees with tools/worktree.mjs");
  }
  if (!st.isFile()) throw new Error("a worktree's .git must be a plain file");

  const main = path.join(path.dirname(parent), path.basename(parent).slice(0, -SUFFIX.length));
  const mainGit = path.join(main, ".git");
  if (!fs.lstatSync(mainGit).isDirectory()) throw new Error("the main checkout has no .git folder");
  // A decoy .git can borrow the real repository's objects and refs through links or an alternates file, so that git
  // commits into the real repository while the guards read the decoy (second security review, follow-up check,
  // 2026-11-08). The main checkout's .git has none of these. A full copy of the repository still passes; decision
  // 0003 records that limit.
  for (const part of ["objects", "refs", path.join("refs", "heads")]) {
    if (fs.lstatSync(path.join(mainGit, part), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("the main checkout's .git borrows another repository through a link");
  }
  if (fs.existsSync(path.join(mainGit, "objects", "info", "alternates"))) throw new Error("the main checkout's .git borrows another repository's objects");
  const admin = path.join(mainGit, "worktrees");

  // The worktree's own pointer must lead into the main checkout's worktree records.
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, "utf8"));
  if (!m) throw new Error("the worktree's .git file has no gitdir line");
  const gitdir = same(path.resolve(root, m[1]));
  if (path.dirname(gitdir) !== same(admin)) throw new Error("the worktree's gitdir is not a record of the main checkout");

  // Git's back-link from that record must lead to this worktree.
  const back = fs.readFileSync(path.join(gitdir, "gitdir"), "utf8").trim();
  if (same(path.resolve(gitdir, back)) !== same(dotGit)) throw new Error("git's record of this worktree points elsewhere");

  // The repository that git really uses must be the main checkout's. Without this check, a junction on the
  // .worktrees folder and a copied record send the guards to a decoy folder while git uses the real repository
  // (second security review, 2026-11-08).
  const common = fs.readFileSync(path.join(gitdir, "commondir"), "utf8").trim();
  if (!common || same(path.resolve(gitdir, common)) !== same(mainGit)) throw new Error("git's record of this worktree uses another repository");
  return main;
}

/** True when `root` is a linked worktree, not the main checkout. */
export function isLinkedWorktree(root = ROOT) {
  return same(mainCheckout(root)) !== same(root);
}

/** A path inside the main checkout, for the owner's git-ignored private files. */
export function privatePath(...parts) {
  return path.join(mainCheckout(), ...parts);
}
