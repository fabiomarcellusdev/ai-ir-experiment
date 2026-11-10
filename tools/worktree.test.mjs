// Tests for main-checkout.mjs and worktree.mjs, and for the guards inside a linked worktree (decision 0003, amendment
// "parallel checkouts"). Every repository here is a throwaway in the system's temporary folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mainCheckout, isLinkedWorktree } from "./main-checkout.mjs";
import { worktreeProblems, syncInto, linkedWorktrees, worktreeDir, TASK_BRANCH, loadConfig, copyPathProblem, refuseEscape, refuseLinkedWorktreesFolder } from "./worktree.mjs";
import { worktreeConfigProblems, worktreeSetupResult } from "./check.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ZERO = "0".repeat(40);
const DATE = "2026-11-07T15:00:00+0000";

// Git gives a hook GIT_DIR, GIT_INDEX_FILE and other GIT_* variables. These tests also run inside the pre-commit hook,
// and a git command that inherits them acts on the real repository. So drop every GIT_* variable.
function isolatedEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}
// The same folder, whatever its spelling: macOS links /var to /private/var, and Windows has 8.3 short names.
const real = (p) => {
  const r = fs.realpathSync.native(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

const SHIPPED = ["git-guard.mjs", "quiet-hours.mjs", "main-checkout.mjs", "worktree.mjs", "secret-scan.mjs", "git-guard.config.json", "worktree.config.json"];
const LOCAL = { "CLAUDE.local.md": "private notes\n", ".claude/settings.local.json": "{\"hooks\":{}}\n", ".claude/local/guard.mjs": "// a local guard\n" };
const ALL_DAY = { timeZone: "UTC", days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], start: "00:00", end: "24:00" };

/**
 * A main checkout on `main` with this repository's tools committed, the owner's local files, private terms, all-day
 * quiet hours, and a bare remote. `wt(branch)` adds a worktree in the layout of tools/worktree.mjs.
 */
function project({ terms = true, quiet = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-"));
  const main = path.join(base, "proj"), remote = path.join(base, "remote.git");
  fs.mkdirSync(main);
  spawnSync("git", ["init", "-q", "--bare", remote], { env: isolatedEnv() });
  const run = (args, cwd = main, env = {}) => spawnSync("git", args, { cwd, encoding: "utf8", env: isolatedEnv(env) });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@example.invalid"]);
  run(["config", "user.name", "test"]);
  run(["config", "core.hooksPath", "no-hooks"]);
  run(["remote", "add", "origin", remote]);
  fs.mkdirSync(path.join(main, "tools"));
  for (const f of SHIPPED) fs.copyFileSync(path.join(TOOLS, f), path.join(main, "tools", f));
  fs.writeFileSync(path.join(main, ".gitignore"), "private-docs/\n.local/\nCLAUDE.local.md\n.claude/settings.local.json\n.claude/local/\n");
  run(["add", "."]);
  run(["commit", "-q", "-m", "tools"], main, { GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE });
  for (const [f, text] of Object.entries(LOCAL)) {
    fs.mkdirSync(path.dirname(path.join(main, f)), { recursive: true });
    fs.writeFileSync(path.join(main, f), text);
  }
  if (terms) {
    fs.mkdirSync(path.join(main, "private-docs"));
    fs.writeFileSync(path.join(main, "private-docs", "privacy-terms.txt"), "zebracorn\n");
  }
  if (quiet) {
    fs.mkdirSync(path.join(main, ".local"));
    fs.writeFileSync(path.join(main, ".local", "quiet-hours.json"), JSON.stringify(ALL_DAY));
  }
  const node = (cwd, args, env = {}, input = "") => spawnSync(process.execPath, args, { cwd, input, encoding: "utf8", env: isolatedEnv(env) });
  const wt = (branch = "p0/feat-a") => {
    const dir = worktreeDir(main, branch);
    const r = run(["worktree", "add", "-q", "-b", branch, dir, "main"]);
    assert.equal(r.status, 0, r.stderr);
    return dir;
  };
  return { base, main, remote, run, node, wt };
}
const cleanup = (p) => fs.rmSync(p.base, { recursive: true, force: true });

/** A commit in the worktree that adds the private term, and the pre-push hook's answer for it. */
function pushWithTerm(p, dir) {
  fs.writeFileSync(path.join(dir, "note.md"), "a line about zebracorn\n");
  p.run(["add", "note.md"], dir);
  p.run(["commit", "-q", "-m", "note"], dir, { GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE });
  const sha = p.run(["rev-parse", "HEAD"], dir).stdout.trim();
  return () => p.node(dir, [path.join(dir, "tools", "git-guard.mjs"), "pre-push", "origin", p.remote],
    { QUIET_HOURS_APPROVED: "1" }, `refs/heads/p0/feat-a ${sha} refs/heads/p0/feat-a ${ZERO}\n`);
}
const quietStatus = (p, dir) => p.node(dir, [path.join(dir, "tools", "quiet-hours.mjs"), "status"]).stdout;
// Git hides a worktree's .git file on Windows, and a hidden file cannot be overwritten there: remove it first.
const rewrite = (file, text) => { fs.rmSync(file, { force: true }); fs.writeFileSync(file, text); };

// ---------------- main-checkout ----------------

test("mainCheckout finds the main checkout from a worktree made in the tool's layout, and from itself", () => {
  const p = project();
  const dir = p.wt();
  assert.equal(real(mainCheckout(dir)), real(p.main));
  assert.equal(real(mainCheckout(p.main)), real(p.main));
  assert.equal(isLinkedWorktree(dir), true);
  assert.equal(isLinkedWorktree(p.main), false);
  cleanup(p);
});

test("mainCheckout: a plain folder is used as it is; a worktree outside the layout or a stray .git file throws", () => {
  const p = project();
  const plain = path.join(p.base, "plain");
  fs.mkdirSync(plain);
  assert.equal(real(mainCheckout(plain)), real(plain));
  const outside = path.join(p.base, "wt");
  p.run(["worktree", "add", "-q", "-b", "p0/feat-x", outside, "main"]);
  assert.throws(() => mainCheckout(outside), /outside a <name>\.worktrees folder/);
  const stray = path.join(p.base, "stray");
  fs.mkdirSync(stray);
  fs.writeFileSync(path.join(stray, ".git"), `gitdir: ${path.join(p.main, ".git")}\n`);
  assert.throws(() => mainCheckout(stray));
  cleanup(p);
});

// The three attacks of the security review (2026-11-08): a session in a worktree rewrites or deletes its own .git
// file so that the guards look for the private files in a folder without them. Each must fail closed: quiet hours
// count as on, and a push with a private term is refused.
for (const [name, attack] of [
  ["A: the .git file points at the main checkout's .git folder", (p, dir) => rewrite(path.join(dir, ".git"), `gitdir: ${path.join(p.main, ".git")}\n`)],
  ["B: the .git file points at a copied record whose commondir leads to a decoy", (p, dir) => {
    const id = fs.readdirSync(path.join(p.main, ".git", "worktrees"))[0];
    const copy = path.join(p.base, "copy-record");
    fs.cpSync(path.join(p.main, ".git", "worktrees", id), copy, { recursive: true });
    const decoy = path.join(p.base, "decoy");
    fs.mkdirSync(decoy);
    fs.symlinkSync(path.join(p.main, ".git"), path.join(decoy, ".git"), "junction");
    fs.writeFileSync(path.join(copy, "commondir"), `${path.join(decoy, ".git")}\n`);
    rewrite(path.join(dir, ".git"), `gitdir: ${copy}\n`);
  }],
  ["C: the .git file is deleted", (p, dir) => fs.rmSync(path.join(dir, ".git"), { force: true })],
  ["D: git's back-link points to another folder", (p, dir) => {
    const id = fs.readdirSync(path.join(p.main, ".git", "worktrees"))[0];
    rewrite(path.join(p.main, ".git", "worktrees", id, "gitdir"), `${path.join(p.base, "elsewhere", ".git")}\n`);
  }],
]) {
  test(`attack ${name}: the guards fail closed`, () => {
    const p = project({ quiet: true });
    const dir = p.wt();
    const push = pushWithTerm(p, dir); // commit first, while git still works in the worktree
    attack(p, dir);
    assert.throws(() => mainCheckout(dir));
    assert.match(quietStatus(p, dir), /could not be found/);
    assert.notEqual(push().status, 0, "the push must be refused");
    assert.equal(worktreeSetupResult(dir)[1], false, "check.mjs must fail");
    cleanup(p);
  });
}

// The second security review (2026-11-08): a junction on the .worktrees folder moves the folder layout to a decoy,
// and a copied record there passes the gitdir and back-link checks, while its commondir keeps git on the real
// repository. So commits and pushes work, and the guards read the decoy. The commondir check refuses it.
test("attack E: a junction on the .worktrees folder and a decoy record: the guards fail closed, git still works", () => {
  const p = project({ quiet: true });
  const evil = path.join(p.base, "evil");
  fs.mkdirSync(path.join(evil, "proj.worktrees"), { recursive: true });
  fs.mkdirSync(path.join(evil, "proj", ".git", "worktrees"), { recursive: true });
  fs.symlinkSync(path.join(evil, "proj.worktrees"), `${p.main}.worktrees`, "junction");
  const dir = p.wt();
  const push = pushWithTerm(p, dir);
  const id = fs.readdirSync(path.join(p.main, ".git", "worktrees"))[0];
  const decoy = path.join(evil, "proj", ".git", "worktrees", id);
  fs.cpSync(path.join(p.main, ".git", "worktrees", id), decoy, { recursive: true });
  fs.writeFileSync(path.join(decoy, "commondir"), `${path.join(p.main, ".git")}\n`);
  fs.writeFileSync(path.join(decoy, "gitdir"), `${path.join(dir, ".git")}\n`);
  rewrite(path.join(dir, ".git"), `gitdir: ${decoy}\n`);
  assert.equal(real(p.run(["rev-parse", "--git-common-dir"], dir).stdout.trim()), real(path.join(p.main, ".git")), "git still uses the real repository");
  assert.throws(() => mainCheckout(dir), /uses another repository/);
  assert.match(quietStatus(p, dir), /could not be found/);
  assert.notEqual(push().status, 0, "the push must be refused");
  assert.equal(worktreeSetupResult(dir)[1], false, "check.mjs must fail");
  cleanup(p);
});

// The follow-up check of the second review: the decoy .git borrows the real objects and refs through junctions, and
// its record's commondir is the decoy itself. Git then commits into the real repository.
test("attack F: a decoy .git that borrows the real objects and refs: the guards fail closed", () => {
  const p = project({ quiet: true });
  const evil = path.join(p.base, "evil");
  const evilGit = path.join(evil, "proj", ".git");
  fs.mkdirSync(path.join(evil, "proj.worktrees"), { recursive: true });
  fs.mkdirSync(path.join(evilGit, "worktrees"), { recursive: true });
  for (const f of ["HEAD", "config"]) fs.copyFileSync(path.join(p.main, ".git", f), path.join(evilGit, f));
  fs.symlinkSync(path.join(evil, "proj.worktrees"), `${p.main}.worktrees`, "junction");
  const dir = p.wt();
  const push = pushWithTerm(p, dir);
  for (const part of ["objects", "refs"]) fs.symlinkSync(path.join(p.main, ".git", part), path.join(evilGit, part), "junction");
  const id = fs.readdirSync(path.join(p.main, ".git", "worktrees"))[0];
  const decoy = path.join(evilGit, "worktrees", id);
  fs.cpSync(path.join(p.main, ".git", "worktrees", id), decoy, { recursive: true });
  fs.writeFileSync(path.join(decoy, "commondir"), "../..\n");
  fs.writeFileSync(path.join(decoy, "gitdir"), `${path.join(dir, ".git")}\n`);
  rewrite(path.join(dir, ".git"), `gitdir: ${decoy}\n`);
  assert.throws(() => mainCheckout(dir), /borrows another repository/);
  assert.match(quietStatus(p, dir), /could not be found/);
  assert.notEqual(push().status, 0, "the push must be refused");
  // An alternates file is the other way to borrow the objects.
  for (const part of ["objects", "refs"]) fs.unlinkSync(path.join(evilGit, part));
  fs.mkdirSync(path.join(evilGit, "objects", "info"), { recursive: true });
  fs.mkdirSync(path.join(evilGit, "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(evilGit, "objects", "info", "alternates"), `${path.join(p.main, ".git", "objects")}\n`);
  assert.throws(() => mainCheckout(dir), /borrows another repository's objects/);
  cleanup(p);
});

test("a .git folder with a commondir file (a copied worktree record) is not a main checkout", () => {
  const p = project();
  const dir = p.wt();
  const id = fs.readdirSync(path.join(p.main, ".git", "worktrees"))[0];
  const copy = path.join(p.base, "copy");
  fs.mkdirSync(copy);
  fs.cpSync(path.join(p.main, ".git", "worktrees", id), path.join(copy, ".git"), { recursive: true });
  fs.writeFileSync(path.join(copy, ".git", "commondir"), `${path.join(p.main, ".git")}\n`);
  assert.throws(() => mainCheckout(copy), /outside a <name>\.worktrees folder/);
  // The same record in the worktree's place, reached through a path in another case: the layout test still sees it.
  fs.rmSync(path.join(dir, ".git"), { force: true });
  fs.cpSync(path.join(copy, ".git"), path.join(dir, ".git"), { recursive: true });
  assert.throws(() => mainCheckout(dir), /plain file/);
  const upper = path.join(p.base, "PROJ.WORKTREES", path.basename(dir));
  if (fs.existsSync(upper)) assert.throws(() => mainCheckout(upper)); // a file system without case only
  cleanup(p);
});

// ---------------- the guards inside a worktree ----------------

test("end to end: git-guard in a worktree reads the private terms from the main checkout", () => {
  const p = project();
  const dir = p.wt();
  const push = pushWithTerm(p, dir);
  assert.equal(fs.existsSync(path.join(dir, "private-docs")), false, "the worktree must not have the terms itself");
  assert.match(push().stderr, /private term/);
  // Negative control: without the main checkout's terms file, the same push passes. So the term came from there.
  fs.rmSync(path.join(p.main, "private-docs"), { recursive: true });
  const clean = push();
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stderr, /no private-term scan ran/, "a scan that did not run must be visible");
  cleanup(p);
});

test("end to end: quiet hours in a worktree come from the main checkout", () => {
  const p = project();
  const dir = p.wt();
  assert.match(quietStatus(p, dir), /no quiet hours are set/);
  fs.mkdirSync(path.join(p.main, ".local"));
  fs.writeFileSync(path.join(p.main, ".local", "quiet-hours.json"), JSON.stringify(ALL_DAY));
  assert.equal(fs.existsSync(path.join(dir, ".local")), false, "the worktree must not have the hours itself");
  assert.match(quietStatus(p, dir), /inside the owner's quiet hours/);
  cleanup(p);
});

test("the fail-closed reason prints no local path", () => {
  const p = project();
  const dir = p.wt();
  rewrite(path.join(dir, ".git"), "broken\n");
  const out = quietStatus(p, dir);
  assert.match(out, /could not be found/);
  assert.doesNotMatch(out, new RegExp(path.basename(p.base)));
  cleanup(p);
});

// ---------------- worktree.mjs ----------------

test("end to end: add creates a worktree beside the main checkout with the owner's local files; the limit holds", () => {
  const p = project();
  const wt = (args) => p.node(p.main, [path.join(p.main, "tools", "worktree.mjs"), ...args]);
  const a = wt(["add", "p0/feat-a"]);
  assert.equal(a.status, 0, a.stderr);
  const dir = worktreeDir(p.main, "p0/feat-a");
  assert.equal(path.dirname(path.dirname(dir)), path.dirname(p.main), "the worktree must be outside the main checkout");
  for (const [f, text] of Object.entries(LOCAL)) assert.equal(fs.readFileSync(path.join(dir, f), "utf8"), text, f);
  assert.equal(p.run(["branch", "--show-current"], dir).stdout.trim(), "p0/feat-a");
  assert.deepEqual(worktreeSetupResult(dir).slice(0, 2), ["worktree setup (the owner's local files are here)", true]);
  for (const bad of ["main", "feature/x", "p0/feat-a; rm -rf /", "../p0/feat-x"]) assert.equal(wt(["add", bad]).status, 1, bad);
  assert.equal(wt(["add", "p0/feat-b"]).status, 0);
  assert.equal(wt(["add", "p0/feat-c"]).status, 0);
  const fourth = wt(["add", "p0/feat-d"]);
  assert.equal(fourth.status, 1);
  assert.match(fourth.stderr, /the limit is 3/);
  assert.equal(wt(["remove", "p0/feat-a"]).status, 0);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(p.run(["show-ref", "--verify", "--quiet", "refs/heads/p0/feat-a"]).status, 0, "remove keeps the branch");
  assert.equal(wt(["sync"]).status, 1, "sync is refused in the main checkout");
  cleanup(p);
});

test("end to end: remove keeps a worktree that has changes", () => {
  const p = project();
  const wt = (args) => p.node(p.main, [path.join(p.main, "tools", "worktree.mjs"), ...args]);
  wt(["add", "p0/feat-a"]);
  const dir = worktreeDir(p.main, "p0/feat-a");
  fs.writeFileSync(path.join(dir, "tools", "worktree.config.json"), "{}\n");
  assert.equal(wt(["remove", "p0/feat-a"]).status, 1);
  assert.equal(fs.existsSync(dir), true);
  cleanup(p);
});

test("the worktree check fails without the local files, and sync repairs it", () => {
  const p = project();
  const dir = p.wt();
  const items = loadConfig(p.main).copyFromMain;
  assert.deepEqual(worktreeProblems(p.main, dir, items).sort(), [
    ".claude/local/guard.mjs is missing in this worktree",
    ".claude/settings.local.json is missing in this worktree",
    "CLAUDE.local.md is missing in this worktree",
  ]);
  assert.equal(worktreeSetupResult(dir)[1], false);
  syncInto(p.main, dir, items);
  assert.deepEqual(worktreeProblems(p.main, dir, items), []);
  assert.equal(worktreeSetupResult(dir)[1], true);
  fs.writeFileSync(path.join(dir, "CLAUDE.local.md"), "changed\n");
  fs.writeFileSync(path.join(dir, ".claude", "local", "extra.mjs"), "// extra files are allowed\n");
  assert.deepEqual(worktreeProblems(p.main, dir, items), ["CLAUDE.local.md differs from the main checkout"]);
  assert.throws(() => syncInto(p.main, p.main, items), /main checkout/);
  cleanup(p);
});

test("sync refuses to write through a link or a junction (security review, 2026-11-08)", () => {
  const p = project();
  const dir = p.wt();
  const outside = path.join(p.base, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "guard.mjs"), "untouched\n");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, ".claude", "local"), "junction");
  assert.throws(() => syncInto(p.main, dir, loadConfig(p.main).copyFromMain), /link or a junction/);
  assert.equal(fs.readFileSync(path.join(outside, "guard.mjs"), "utf8"), "untouched\n");
  // The check directly before each removal: a folder that resolves outside the worktree is refused.
  assert.throws(() => refuseEscape(dir, ".claude/local/guard.mjs"), /outside this worktree/);
  assert.doesNotThrow(() => refuseEscape(dir, "CLAUDE.local.md"));
  cleanup(p);
});

test("add refuses a .worktrees folder that is a link or a junction (second security review, 2026-11-08)", () => {
  const p = project();
  const elsewhere = path.join(p.base, "elsewhere");
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, `${p.main}.worktrees`, "junction");
  assert.throws(() => refuseLinkedWorktreesFolder(p.main), /link or a junction/);
  const r = p.node(p.main, [path.join(p.main, "tools", "worktree.mjs"), "add", "p0/feat-a"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /link or a junction/);
  assert.deepEqual(fs.readdirSync(elsewhere), [], "no worktree was created");
  cleanup(p);
  const q = project();
  assert.doesNotThrow(() => refuseLinkedWorktreesFolder(q.main), "a missing folder is fine");
  q.wt();
  assert.doesNotThrow(() => refuseLinkedWorktreesFolder(q.main), "a real folder is fine");
  // A main path reached through a link higher up (as with an 8.3 short name, or /var on macOS) is still fine.
  const alias = path.join(os.tmpdir(), `${path.basename(q.base)}-alias`);
  fs.symlinkSync(q.base, alias, "junction");
  try {
    assert.doesNotThrow(() => refuseLinkedWorktreesFolder(path.join(alias, "proj")), "a link above the main checkout is fine");
  } finally {
    fs.unlinkSync(alias);
  }
  cleanup(q);
});

// ---------------- configuration ----------------

test("copyFromMain refuses paths outside the checkout, secrets, the private files and git's folder", () => {
  for (const ok of ["CLAUDE.local.md", ".claude/settings.local.json", ".claude/local"]) assert.equal(copyPathProblem(ok), null, ok);
  for (const bad of ["", ".", "..", "../x", "/abs", "C:\\abs", "private-docs", "private-docs/terms.txt", ".local", ".env",
    ".env.production", "a/.git/config", ".git", "CLAUDE.local.md:ads", 5, null]) {
    assert.notEqual(copyPathProblem(bad), null, String(bad));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-config-"));
  fs.mkdirSync(path.join(dir, "tools"));
  for (const bad of [{ maxWorktrees: 3, copyFromMain: ["../x"] }, { maxWorktrees: 3, copyFromMain: "CLAUDE.local.md" }, { maxWorktrees: 0, copyFromMain: [] }]) {
    fs.writeFileSync(path.join(dir, "tools", "worktree.config.json"), JSON.stringify(bad));
    assert.throws(() => loadConfig(dir), undefined, JSON.stringify(bad));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("check.mjs refuses a weakened worktree config, and accepts the shipped one", () => {
  const shipped = fs.readFileSync(path.join(TOOLS, "worktree.config.json"), "utf8");
  assert.deepEqual(worktreeConfigProblems(shipped), []);
  const cfg = JSON.parse(shipped);
  for (const weak of [
    { ...cfg, maxWorktrees: 10 },
    { ...cfg, maxWorktrees: 0 },
    { ...cfg, copyFromMain: cfg.copyFromMain.filter((f) => f !== ".claude/settings.local.json") },
    { ...cfg, copyFromMain: cfg.copyFromMain.filter((f) => f !== ".claude/local") },
    { ...cfg, copyFromMain: [...cfg.copyFromMain, "."] },
    { ...cfg, copyFromMain: [...cfg.copyFromMain, "private-docs"] },
    { ...cfg, copyFromMain: cfg.copyFromMain.join(" ") },
    { ...cfg, copyFromMain: [] },
  ]) assert.notDeepEqual(worktreeConfigProblems(JSON.stringify(weak)), [], JSON.stringify(weak));
  assert.notDeepEqual(worktreeConfigProblems("{"), []);
});

test("the branch pattern and the porcelain reader", () => {
  for (const ok of ["p0/feat-x", "p3/fix-a.b", "deps/parse5-7.3.0", "exp/try", "fix/typo"]) assert.equal(TASK_BRANCH.test(ok), true, ok);
  for (const bad of ["main", "p0/feat", "feature/x", "p0/feat-x/../y", "p0/feat-x y"]) assert.equal(TASK_BRANCH.test(bad), false, bad);
  const porcelain = "worktree /m\nHEAD 1\nbranch refs/heads/main\n\nworktree /w1\nHEAD 2\nbranch refs/heads/p0/feat-a\n\nworktree /w2\nHEAD 3\ndetached\n";
  assert.deepEqual(linkedWorktrees(porcelain), [{ dir: "/w1", branch: "p0/feat-a" }, { dir: "/w2", branch: null }]);
});

test("check.mjs runs the worktree check at every level", () => {
  const text = fs.readFileSync(path.join(TOOLS, "check.mjs"), "utf8");
  assert.match(text, /unitTests\(cfg\); voiceLint\(\); guards\(cfg\); worktreeSetup\(\); privacy\(cfg\);/);
});
