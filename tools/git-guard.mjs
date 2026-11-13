// git-guard.mjs: the rules that git itself enforces, for every person and every AI tool (decisions 0003 and 0004).
// The git hooks in .githooks/ run it before the milestone checks. Configured by tools/git-guard.config.json.
//
//   node tools/git-guard.mjs pre-commit
//     refuses: a commit on main or on a detached HEAD; a commit inside the quiet hours; a commit whose dates are not
//     in UTC (a local offset reveals the owner's time zone).
//   node tools/git-guard.mjs pre-push <remote name> <remote URL>   (git passes the refs on stdin)
//     refuses: a push to main; a branch deletion; a push that rewrites the remote branch (not a fast-forward); a
//     push to a URL that is not in the config; a push inside the quiet hours; and, in every pushed commit: a date
//     not in UTC, a private or secret file, a change to .github/ (CI runs it with the repository's token), and an
//     added line with a term from private-docs/privacy-terms.txt.
//
// Owner overrides, one command at a time: ALLOW_MAIN_COMMIT=1, ALLOW_MAIN_PUSH=1, ALLOW_WORKFLOW_CHANGE=1,
// QUIET_HOURS_APPROVED=1. They guard against mistakes, not against a hostile process: any process can set them.
// Agents must never set them (AGENTS.md); branch protection on GitHub is the server-side control.
// Uses Node built-ins only.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { status as quietStatus } from "./quiet-hours.mjs";
import { privatePath } from "./main-checkout.mjs";
import { scanAddedLines, scanText, loadAllow, allowed } from "./secret-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROTECTED = ["refs/heads/main", "refs/heads/master"];
const ZERO = /^0+$/;
const SENSITIVE_PATH = /(^|\/)(private-docs\/|\.local\/|claude\.local\.md$|\.env(\.[\w-]+)?$|\.claude\/settings\.local\.json$|\.claude\/local\/|[^/]+\.(pem|key|p12|pfx)$|id_(rsa|ed25519|ecdsa)$|\.npmrc$|\.netrc$)/i;

// ---------------------------------------------------------------------------------------------
// Pure checks, exported for tests
// ---------------------------------------------------------------------------------------------

/** Problems with the refs a push sends (git's pre-push input: "<local ref> <local sha> <remote ref> <remote sha>"). */
export function pushProblems(stdinText, env = {}) {
  const problems = [];
  for (const line of stdinText.split(/\r?\n/).filter(Boolean)) {
    const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
    if (PROTECTED.includes(remoteRef) && env.ALLOW_MAIN_PUSH !== "1") {
      problems.push(`A push to ${remoteRef} is refused. Push a task branch and open a pull request; the owner merges (decision 0003).`);
    }
    if (ZERO.test(localSha ?? "") || localRef === "(delete)") problems.push(`Deleting ${remoteRef} is refused. The owner deletes branches.`);
  }
  return problems;
}

/** A problem when committing on a protected branch or a detached HEAD, or null. */
export function commitProblem(branch, env = {}) {
  if (branch === "") return "A commit on a detached HEAD is refused. Switch to a task branch first (decision 0003).";
  if (["main", "master"].includes(branch) && env.ALLOW_MAIN_COMMIT !== "1") {
    return "A commit on main is refused. Create a task branch first: git switch -c p<phase>/<type>-<short-name> (decision 0003).";
  }
  return null;
}

const normalizeUrl = (u) => (u ?? "").trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "").replace(/^git@github\.com:/, "https://github.com/");

/** True for a local path (nothing leaves the machine), when the config pins no URL, or for a pinned URL. */
export function urlAllowed(url, allowed = []) {
  if (!/:\/\/|^[\w.-]+@[\w.-]+:/.test(url ?? "") || /^file:\/\//i.test(url ?? "")) return true;
  return !allowed.length || allowed.map(normalizeUrl).includes(normalizeUrl(url));
}

/** Problems with "<sha> <author date> <committer date>" lines whose offset is not +0000. */
export function offsetProblems(lines) {
  return lines.filter(Boolean).flatMap((l) => {
    const [sha, ...dates] = l.trim().split(" | ");
    return dates.some((d) => !/\+0000$/.test(d.trim())) ? [`Commit ${sha.slice(0, 9)} has a date that is not in UTC, which reveals a time zone. Commit with TZ=UTC set (AGENTS.md, "Version control and CI").`] : [];
  });
}

/** Problems with the paths a pushed commit changes. */
export function pathProblems(paths, env = {}) {
  const problems = [];
  for (const p of paths.filter(Boolean)) {
    if (SENSITIVE_PATH.test(p)) problems.push(`A pushed commit contains ${p}, a private or secret file. Remove it from the branch history before pushing.`);
    if (p.startsWith(".github/") && env.ALLOW_WORKFLOW_CHANGE !== "1") {
      problems.push(`A pushed commit changes ${p}. CI runs it with the repository's token, so the owner pushes workflow changes (ALLOW_WORKFLOW_CHANGE=1).`);
    }
  }
  return [...new Set(problems)];
}

/** Lines added by a patch (from `git log -p`) that contain a private term. */
export function addedLineHits(patchText, terms) {
  const lower = terms.map((t) => t.toLowerCase());
  const hits = [];
  for (const line of patchText.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const l = line.toLowerCase();
    for (const t of lower) if (l.includes(t)) hits.push(t);
  }
  return [...new Set(hits)];
}

// ---------------------------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------------------------

const git = (args) => {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  return r.stdout;
};
// A missing or broken config refuses every push (fail closed): without it, the URL pin would accept any URL.
const config = () => {
  const f = path.join(ROOT, "tools", "git-guard.config.json");
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
};
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Read history without letting the working tree change what git shows: no attributes (a "-diff" line would hide
// added text), no text conversion, no external diff, no quoted file names.
const SAFE = ["-c", "core.quotePath=false", `--attr-source=${EMPTY_TREE}`];
// The terms are git-ignored, so they live in the main checkout only; a linked worktree reads them from there.
// A clone without the file (a contributor's) has no terms to scan, so a missing file is not a failure. But the push
// says so, so the owner sees a scan that did not run (second security review, 2026-11-08).
const privacyTerms = () => {
  const f = privatePath("private-docs", "privacy-terms.txt");
  if (!fs.existsSync(f)) {
    console.error("Note: private-docs/privacy-terms.txt is missing in the main checkout, so no private-term scan ran.");
    return [];
  }
  return fs.readFileSync(f, "utf8").split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith("#"));
};
function quietProblem() {
  const s = quietStatus();
  return s.quiet && process.env.QUIET_HOURS_APPROVED !== "1"
    ? `Stopped: ${s.reason}. If the owner approves this instance, run it again with QUIET_HOURS_APPROVED=1 set.`
    : null;
}

function preCommit() {
  const cfg = config() ?? { requireUtcDates: true };
  const problems = [commitProblem(git(["branch", "--show-current"]).trim(), process.env), quietProblem()];
  if (cfg.requireUtcDates !== false) {
    const offs = ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"].map((v) => git(["var", v]).trim().split(" ").pop());
    if (offs.some((o) => o !== "+0000")) problems.push("This commit's date is not in UTC, which reveals a time zone. Commit with TZ=UTC set (bash: TZ=UTC git commit ...; PowerShell: $env:TZ='UTC'; git commit ...).");
  }
  return problems.filter(Boolean);
}

function prePush(remoteUrl, stdinText) {
  const cfg = config();
  if (!cfg) return ["tools/git-guard.config.json is missing or invalid, so every push is refused. Restore it from main."];
  const problems = [...pushProblems(stdinText, process.env), quietProblem()].filter(Boolean);
  if (!urlAllowed(remoteUrl, cfg.allowedPushUrls)) {
    return [...problems, `A push to ${remoteUrl} is refused. tools/git-guard.config.json pins the repository's URL.`];
  }
  const terms = privacyTerms();
  // The remote's real branches, read from the remote itself: local remote-tracking refs can be faked
  // (git update-ref refs/remotes/origin/x ...) to hide commits from the scan.
  // The tips of the remote's branches that exist here: their commits are on the remote already, so a push does not
  // publish them again (a merge of main brings in main's commits; owner, 2026-11-13, decision 0003). Read once.
  let tips = null;
  const knownTips = () => {
    tips ??= git(["ls-remote", "--heads", remoteUrl]).split("\n").map((l) => l.split("\t")[0]).filter((s) => /^[0-9a-f]{40,64}$/.test(s))
      .filter((s) => spawnSync("git", ["cat-file", "-e", `${s}^{commit}`]).status === 0);
    return tips;
  };
  for (const line of stdinText.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (ZERO.test(localSha ?? "")) continue;
    let range;
    if (ZERO.test(remoteSha ?? "")) {
      const known = knownTips();
      range = known.length ? [localSha, "--not", ...known] : [localSha];
    } else {
      const known = spawnSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`]).status === 0;
      const ff = known && spawnSync("git", ["merge-base", "--is-ancestor", remoteSha, localSha]).status === 0;
      if (!ff) { problems.push("This push rewrites the remote branch (it is not a fast-forward). Only the owner rewrites a pushed branch."); continue; }
      range = [localSha, "--not", remoteSha, ...knownTips()];
    }
    const commits = git(["rev-list", ...range]).split("\n").filter(Boolean);
    if (!commits.length) continue;
    if (cfg.requireUtcDates !== false) problems.push(...offsetProblems(git(["log", "--no-walk=unsorted", "--format=%H | %ai | %ci", ...commits]).split("\n")));
    // -m lists the files of merge commits too; -z with quotePath off keeps non-ASCII names readable.
    const paths = commits.flatMap((c) => git([...SAFE, "diff-tree", "-m", "-r", "-z", "--no-commit-id", "--name-only", "--root", c]).split("\0"));
    problems.push(...pathProblems(paths, process.env));
    const patch = git([...SAFE, "log", "-p", "-m", "--text", "--no-textconv", "--no-ext-diff", "--format=", ...range]);
    if (terms.length) {
      const hits = addedLineHits(patch, terms);
      if (hits.length) problems.push(`A pushed commit adds a private term (${hits.length} term${hits.length > 1 ? "s" : ""}; see private-docs/privacy-terms.txt). Remove it from the branch history before pushing.`);
    }
    // Every pushed commit, not only the last: a secret added and then removed is still in the history.
    let allow = [];
    try { allow = loadAllow(ROOT); } catch (e) { problems.push(String(e.message)); }
    const secrets = scanAddedLines(patch).filter((h) => !allowed(allow, h.file, h.name));
    if (secrets.length) {
      problems.push(`A pushed commit adds what looks like a secret: ${[...new Set(secrets.map((h) => `${h.file} (${h.name}, ${h.masked})`))].join("; ")}. Follow AGENTS.md, "If a secret appears": revoke and rotate a real secret first, then remove it from the branch history.`);
    }
    // A commit message is published with the commit, so it is scanned too.
    const messageSecrets = scanText(git(["log", "--format=%B", ...range]));
    if (messageSecrets.length) {
      problems.push(`A pushed commit message holds what looks like a secret (${[...new Set(messageSecrets.map((h) => `${h.name}, ${h.masked}`))].join("; ")}). Follow AGENTS.md, "If a secret appears", then reword the commit.`);
    }
  }
  return [...new Set(problems)];
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "git-guard.mjs";
if (isMain) {
  const mode = process.argv[2];
  let problems;
  try {
    if (mode === "pre-commit") problems = preCommit();
    else if (mode === "pre-push") problems = prePush(process.argv[4] ?? process.argv[3] ?? "", fs.readFileSync(0, "utf8"));
    else { console.error("Usage: node tools/git-guard.mjs <pre-commit|pre-push <remote> <url>>"); process.exit(2); }
  } catch (e) {
    problems = [`git-guard could not check this (${e.message}). Fix the cause; the guard does not pass on an error.`];
  }
  for (const m of problems) console.error(`git-guard: ${m}`);
  process.exit(problems.length ? 1 : 0);
}
