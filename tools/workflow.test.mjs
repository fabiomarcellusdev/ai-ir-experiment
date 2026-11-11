// Tests for quiet-hours.mjs and git-guard.mjs. Run: node --test "tools/*.test.mjs"
// The time zones and hours here are examples, not anyone's real hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inQuietHours, validate, status } from "./quiet-hours.mjs";
import { pushProblems, commitProblem, urlAllowed, offsetProblems, pathProblems, addedLineHits } from "./git-guard.mjs";
import { privatePath } from "./main-checkout.mjs";

const CFG = { timeZone: "Europe/Berlin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start: "09:00", end: "17:00" };

// ---------------- quiet hours ----------------

test("inside the window on a weekday is quiet; the start minute is quiet, the end minute is not", () => {
  assert.equal(inQuietHours(CFG, new Date("2026-11-04T10:00:00+01:00")), true); // Wed 10:00
  assert.equal(inQuietHours(CFG, new Date("2026-11-04T09:00:00+01:00")), true);
  assert.equal(inQuietHours(CFG, new Date("2026-11-04T17:00:00+01:00")), false);
  assert.equal(inQuietHours(CFG, new Date("2026-11-04T08:59:00+01:00")), false);
  assert.equal(inQuietHours(CFG, new Date("2026-11-07T10:00:00+01:00")), false); // Sat
});

test("daylight saving decides (a version with a fixed offset fails these)", () => {
  // 07:30 UTC on Wed 2026-07-01 is 09:30 in Berlin in summer (UTC+2): quiet. With a fixed UTC+1 it would be 08:30.
  assert.equal(inQuietHours(CFG, new Date("2026-07-01T07:30:00Z")), true);
  // 07:30 UTC on Wed 2026-11-04 is 08:30 in Berlin in winter (UTC+1): not quiet. With a fixed UTC+2 it would be 09:30.
  assert.equal(inQuietHours(CFG, new Date("2026-11-04T07:30:00Z")), false);
  // 13:30 UTC on Wed 2026-07-01 is 09:30 in New York (UTC-4): quiet. With a fixed UTC-5 it would be 08:30.
  assert.equal(inQuietHours({ ...CFG, timeZone: "America/New_York" }, new Date("2026-07-01T13:30:00Z")), true);
});

test("a window past midnight belongs to its start day", () => {
  const night = { timeZone: "UTC", days: ["Mon"], start: "22:00", end: "07:00" };
  assert.equal(inQuietHours(night, new Date("2026-11-02T23:00:00Z")), true); // Mon 23:00
  assert.equal(inQuietHours(night, new Date("2026-11-03T06:59:00Z")), true); // Tue 06:59, from Monday's window
  assert.equal(inQuietHours(night, new Date("2026-11-03T07:00:00Z")), false);
  assert.equal(inQuietHours(night, new Date("2026-11-03T23:00:00Z")), false); // Tue 23:00: Tuesday is not listed
});

test("24:00 ends a window at midnight, so 23:59 is quiet", () => {
  const late = { timeZone: "UTC", days: ["Mon"], start: "18:00", end: "24:00" };
  assert.equal(inQuietHours(late, new Date("2026-11-02T23:59:30Z")), true);
  assert.equal(inQuietHours(late, new Date("2026-11-03T00:00:00Z")), false);
});

test("an invalid config is refused", () => {
  assert.throws(() => validate({ ...CFG, timeZone: "Mars/Olympus" }));
  assert.throws(() => validate({ ...CFG, timeZone: undefined }));
  assert.throws(() => validate({ ...CFG, timeZone: "+05:00" }));
  assert.throws(() => validate({ ...CFG, days: ["Funday"] }));
  assert.throws(() => validate({ ...CFG, start: "09:00", end: "09:00" }));
  assert.throws(() => validate({ ...CFG, start: "9am" }));
  assert.throws(() => validate({ ...CFG, start: "24:00" }));
});

test("no file: not quiet; a broken file: quiet; a BOM is accepted; messages hold no zone or hours", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiet-"));
  assert.equal(status(new Date(), path.join(dir, "absent.json")).quiet, false);
  fs.writeFileSync(path.join(dir, "bad.json"), "{ not json");
  assert.equal(status(new Date(), path.join(dir, "bad.json")).quiet, true);
  fs.writeFileSync(path.join(dir, "bom.json"), `﻿${JSON.stringify(CFG)}`);
  const s = status(new Date("2026-11-04T10:00:00+01:00"), path.join(dir, "bom.json"));
  assert.equal(s.quiet, true);
  assert.doesNotMatch(s.reason, /Berlin|09:00|17:00|Mon/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------- git-guard: pure checks ----------------

const SHA = "a".repeat(40), ZERO = "0".repeat(40);
test("ref checks: task branch passes; main and deletion are refused; the owner's override works", () => {
  assert.deepEqual(pushProblems(`refs/heads/p0/feat-x ${SHA} refs/heads/p0/feat-x ${ZERO}\n`), []);
  assert.equal(pushProblems(`refs/heads/main ${SHA} refs/heads/main ${SHA}\n`).length, 1);
  assert.equal(pushProblems(`refs/heads/p0/x ${SHA} refs/heads/main ${SHA}\n`).length, 1);
  assert.deepEqual(pushProblems(`refs/heads/main ${SHA} refs/heads/main ${SHA}\n`, { ALLOW_MAIN_PUSH: "1" }), []);
  assert.equal(pushProblems(`(delete) ${ZERO} refs/heads/p0/feat-x ${SHA}\n`).length, 1);
});
test("commit checks: main and a detached HEAD are refused; a task branch passes", () => {
  assert.match(commitProblem("main"), /task branch/);
  assert.match(commitProblem(""), /detached/);
  assert.equal(commitProblem("main", { ALLOW_MAIN_COMMIT: "1" }), null);
  assert.equal(commitProblem("p0/chore-x"), null);
});
test("the URL pin accepts the pinned repository in any spelling and refuses others", () => {
  const pin = ["https://github.com/o/r.git"];
  assert.equal(urlAllowed("https://github.com/o/r", pin), true);
  assert.equal(urlAllowed("git@github.com:o/r.git", pin), true);
  assert.equal(urlAllowed("https://evil.example/x.git", pin), false);
  assert.equal(urlAllowed("https://anything", []), true);
});
test("dates must be UTC", () => {
  assert.deepEqual(offsetProblems([`${SHA} | 2026-11-07 15:00:00 +0000 | 2026-11-07 15:00:00 +0000`]), []);
  assert.equal(offsetProblems([`${SHA} | 2026-11-07 09:00:00 -0600 | 2026-11-07 15:00:00 +0000`]).length, 1);
});
test("private files and workflow changes in pushed commits are refused", () => {
  for (const p of ["private-docs/x.md", ".local/quiet-hours.json", "CLAUDE.local.md", ".env", "a/.env.production", "certs/k.pem", ".claude/settings.local.json"]) {
    assert.equal(pathProblems([p]).length, 1, p);
  }
  assert.equal(pathProblems([".github/workflows/checks.yml"]).length, 1);
  assert.deepEqual(pathProblems([".github/workflows/checks.yml"], { ALLOW_WORKFLOW_CHANGE: "1" }), []);
  assert.deepEqual(pathProblems(["docs/x.md", "tools/a.mjs", ".envrc.example.md"]), []);
});
test("added lines with a private term are found; removed lines are not", () => {
  const patch = "diff --git a/x b/x\n+++ b/x\n+a Secret Name here\n-old Other Secret\n context\n";
  assert.deepEqual(addedLineHits(patch, ["secret name", "other secret"]), ["secret name"]);
});

// ---------------- git-guard: end to end, in throwaway repositories ----------------

const GUARD = fileURLToPath(new URL("./git-guard.mjs", import.meta.url));

// Git gives a hook GIT_DIR, GIT_INDEX_FILE and other GIT_* variables. These tests also run inside the pre-commit hook,
// and a git command that inherits those variables acts on the real repository. So drop every GIT_* variable.
function isolatedEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}

// Each throwaway repository has a local bare repository as its remote, so nothing reaches the network.
function repo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "git-guard-"));
  const dir = path.join(base, "work"), remote = path.join(base, "remote.git");
  fs.mkdirSync(dir);
  spawnSync("git", ["init", "-q", "--bare", remote], { env: isolatedEnv() });
  const run = (args, env = {}) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: isolatedEnv(env) });
  run(["init", "-q", "-b", "p0/feat-x"]);
  run(["config", "user.email", "test@example.invalid"]);
  run(["config", "user.name", "test"]);
  run(["config", "core.hooksPath", "no-hooks"]);
  run(["remote", "add", "origin", remote]);
  return { base, dir, remote, run };
}
const commit = (r, file, text, date = "2026-11-07T15:00:00+0000") => {
  fs.mkdirSync(path.dirname(path.join(r.dir, file)), { recursive: true });
  fs.writeFileSync(path.join(r.dir, file), text);
  r.run(["add", "-f", file]);
  r.run(["commit", "-q", "-m", "x"], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return r.run(["rev-parse", "HEAD"]).stdout.trim();
};
const prePush = (r, input, env = {}, url = r.remote) =>
  spawnSync(process.execPath, [GUARD, "pre-push", "origin", url], { cwd: r.dir, input, encoding: "utf8", env: isolatedEnv({ QUIET_HOURS_APPROVED: "1", ...env }) });
const pushLine = (sha) => `refs/heads/p0/feat-x ${sha} refs/heads/p0/feat-x ${ZERO}\n`;
const cleanup = (...rs) => { for (const r of rs) fs.rmSync(r.base, { recursive: true, force: true }); };

// This test runs first among the end-to-end tests, so a regression fails here before the tests below run. It detects a
// leak; isolatedEnv() is what prevents one.
test("end to end: inside a hook, the throwaway repositories and git-guard leave the real repository alone", () => {
  // A decoy stands in for the real repository. GIT_DIR and GIT_INDEX_FILE point at it, as git sets them for a hook.
  const decoy = repo();
  commit(decoy, "a.md", "decoy\n");
  const gitDir = path.join(decoy.dir, ".git");
  const snapshot = () => ({
    head: decoy.run(["rev-parse", "HEAD"]).stdout,
    refs: decoy.run(["for-each-ref"]).stdout,
    config: fs.readFileSync(path.join(gitDir, "config"), "utf8"),
  });
  const before = snapshot();
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = gitDir;
  process.env.GIT_INDEX_FILE = path.join(gitDir, "index");
  let r, clean, secret, afterHelpers, leaked;
  try {
    r = repo();
    const sha = commit(r, "b.md", "throwaway\n");
    // git-guard must read the throwaway repository: a clean commit passes, and a secret file is refused.
    clean = prePush(r, pushLine(sha));
    secret = prePush(r, pushLine(commit(r, ".env", "TOKEN=fake\n")));
    afterHelpers = snapshot();
    // Negative control: a git command that keeps the inherited variables does reach the decoy.
    fs.writeFileSync(path.join(r.dir, "c.md"), "leak\n");
    spawnSync("git", ["add", "c.md"], { cwd: r.dir, env: { ...process.env } });
    leaked = spawnSync("git", ["commit", "-q", "-m", "leak"], { cwd: r.dir, env: { ...process.env } });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  assert.deepEqual(afterHelpers, before, "a throwaway repository changed the decoy");
  assert.equal(r.run(["log", "--format=%s", "-1"]).stdout.trim(), "x", "the throwaway commit is missing");
  assert.equal(clean.status, 0, `git-guard did not read the throwaway repository: ${clean.stderr}`);
  assert.match(secret.stderr, /private or secret/, "git-guard did not see the secret in the throwaway repository");
  assert.equal(leaked.status, 0, "the negative control did not commit");
  assert.notEqual(snapshot().head, before.head, "the negative control did not reach the decoy");
  cleanup(decoy, r);
});

test("end to end: a clean UTC commit on a task branch passes; main, a foreign URL, a non-UTC date, a private file and a workflow change are refused", () => {
  const r = repo();
  const sha = commit(r, "docs/a.md", "plain text\n");
  const line = (ref) => `refs/heads/p0/feat-x ${sha} ${ref} ${ZERO}\n`;
  assert.equal(prePush(r, line("refs/heads/p0/feat-x")).status, 0, prePush(r, line("refs/heads/p0/feat-x")).stderr);
  assert.equal(prePush(r, line("refs/heads/main")).status, 1);
  assert.equal(prePush(r, line("refs/heads/p0/feat-x"), {}, "https://evil.example/x.git").status, 1);

  const local = commit(r, "docs/b.md", "text\n", "2026-11-07T09:00:00-0600");
  assert.match(prePush(r, `refs/heads/p0/feat-x ${local} refs/heads/p0/feat-x ${ZERO}\n`).stderr, /UTC/);

  const r2 = repo();
  const secret = commit(r2, ".env", "TOKEN=fake\n");
  assert.match(prePush(r2, `refs/heads/p0/feat-x ${secret} refs/heads/p0/feat-x ${ZERO}\n`).stderr, /private or secret/);

  const r3 = repo();
  const wf = commit(r3, ".github/workflows/x.yml", "on: push\n");
  const wfLine = `refs/heads/p0/feat-x ${wf} refs/heads/p0/feat-x ${ZERO}\n`;
  assert.equal(prePush(r3, wfLine).status, 1);
  assert.equal(prePush(r3, wfLine, { ALLOW_WORKFLOW_CHANGE: "1" }).status, 0);
  cleanup(r, r2, r3);
});

test("end to end: a push that rewrites the remote branch is refused", () => {
  const r = repo();
  const first = commit(r, "a.md", "1\n");
  r.run(["checkout", "-q", "--orphan", "p0/other"]);
  const unrelated = commit(r, "b.md", "2\n");
  assert.match(prePush(r, `refs/heads/p0/feat-x ${unrelated} refs/heads/p0/feat-x ${first}\n`).stderr, /fast-forward/);
  cleanup(r);
});

// The four ways the re-review skipped the scan of pushed commits (2026-11-07):
test("end to end: a faked remote-tracking ref does not hide commits from the scan", () => {
  const r = repo();
  const secret = commit(r, ".env", "TOKEN=fake\n");
  r.run(["update-ref", "refs/remotes/origin/zz", "HEAD"]); // would make "--not --remotes=origin" empty
  assert.match(prePush(r, pushLine(secret)).stderr, /private or secret/);
  cleanup(r);
});

test("end to end: a file added only by a merge commit is seen", () => {
  const r = repo();
  commit(r, "a.md", "1\n");
  r.run(["switch", "-q", "-c", "side"]);
  commit(r, "b.md", "2\n");
  r.run(["switch", "-q", "p0/feat-x"]);
  commit(r, "c.md", "3\n");
  r.run(["merge", "-q", "--no-ff", "--no-commit", "side"]);
  fs.mkdirSync(path.join(r.dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(r.dir, ".github", "workflows", "ci.yml"), "on: push\n");
  r.run(["add", "-f", ".github/workflows/ci.yml"]);
  const date = "2026-11-07T15:00:00+0000";
  r.run(["commit", "-q", "-m", "merge"], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const merge = r.run(["rev-parse", "HEAD"]).stdout.trim();
  assert.match(prePush(r, pushLine(merge)).stderr, /\.github\/workflows\/ci\.yml/);
  cleanup(r);
});

test("end to end: a non-ASCII file name is read correctly", () => {
  const r = repo();
  const sha = commit(r, ".github/workflows/ä.yml", "on: push\n");
  assert.match(prePush(r, pushLine(sha)).stderr, /\.github\/workflows\/ä\.yml/);
  cleanup(r);
});

test("end to end: a pushed commit that adds a secret is refused, also when a later commit removes it", () => {
  const fake = ["sk-", "ant-", "api03-", "Zq8vK2pX7mN4bT9wL3cY6hR1dF5gJ0sA"].join(""); // built at run time: no secret in this file
  const r = repo();
  commit(r, "src/config.ts", `export const key = "${fake}";\n`);
  const sha = commit(r, "src/config.ts", "export const key = process.env.API_KEY;\n");
  const out = prePush(r, pushLine(sha));
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /looks like a secret: src\/config\.ts \(Anthropic API key/);
  assert.ok(!out.stderr.includes(fake.slice(4)), "the hook never prints the secret");
  cleanup(r);
});

test("end to end: a pushed commit message with a secret is refused", () => {
  const fake = ["gh", "p_", "Zq8vK2pX7mN4bT9wL3cY6hR1dF5gJ0sAAb12"].join("");
  const r = repo();
  fs.writeFileSync(path.join(r.dir, "note.md"), "a note\n");
  spawnSync("git", ["add", "note.md"], { cwd: r.dir, env: isolatedEnv() });
  spawnSync("git", ["commit", "-q", "-m", `Add a note; token ${fake}`], { cwd: r.dir, env: isolatedEnv({ GIT_AUTHOR_DATE: "2026-11-07T15:00:00+0000", GIT_COMMITTER_DATE: "2026-11-07T15:00:00+0000" }) });
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: r.dir, encoding: "utf8", env: isolatedEnv() }).stdout.trim();
  const out = prePush(r, pushLine(sha));
  assert.match(out.stderr, /commit message holds what looks like a secret \(GitHub token/);
  assert.ok(!out.stderr.includes(fake.slice(4)));
  cleanup(r);
});

const TERMS_FILE = privatePath("private-docs", "privacy-terms.txt"); // in the main checkout, also from a worktree
test("end to end: a .gitattributes line does not hide a private term (runs where the private terms file exists)", { skip: !fs.existsSync(TERMS_FILE) }, () => {
  const term = fs.readFileSync(TERMS_FILE, "utf8").split(/\r?\n/).map((t) => t.trim()).find((t) => t && !t.startsWith("#"));
  const r = repo();
  fs.writeFileSync(path.join(r.dir, ".gitattributes"), "*.md -diff\n");
  const sha = commit(r, "docs/note.md", `a line with ${term} in it\n`);
  assert.match(prePush(r, pushLine(sha)).stderr, /private term/);
  cleanup(r);
});

test("end to end: the git hooks call git-guard before the checks", () => {
  for (const [hook, mode] of [["pre-commit", "pre-commit"], ["pre-push", "pre-push"]]) {
    const text = fs.readFileSync(new URL(`../.githooks/${hook}`, import.meta.url), "utf8");
    assert.match(text, new RegExp(`node tools/git-guard\\.mjs ${mode}[^\\n]*\\|\\| exit 1`));
  }
});
