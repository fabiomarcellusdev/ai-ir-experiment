// github-security-check.mjs: reports the security settings of a GitHub repository and of the signed-in GitHub login.
// It changes nothing.
//
//   node tools/github-security-check.mjs <owner/repo>
//
// Required settings (exit 1 when one is not on): code scanning (CodeQL), secret scanning, push protection, a read-only
// default token for CI, and no right for CI to approve pull requests.
// Advised settings (printed, never change the exit code): only listed actions may run, every action is pinned to a full
// commit hash, `main` needs a pull request, and the daily login has no `workflow` scope. That scope lets any program on
// the PC push a workflow file that copies the repository's secrets (SETUP.md, section 4, step 6).
// Exit 2: the check could not run (no `gh`, not signed in, no such repository). The owner turns the first three on in
// the repository's Settings > Advanced Security (SETUP.md, section 4, step 3). They are free for public repositories;
// for a private repository they are paid add-ons on some plans.
//
// It runs read-only `gh api` calls, pinned to github.com, and uses Node built-ins only. The answer is data: the tool
// prints fixed words, never the response text, and reads the scopes header only to look for one word.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const STATES = { on: "on", off: "off", notOffered: "not offered", unknown: "unknown" };
export const LEVEL = { required: "required", advised: "advised" };

/** One setting from the repository's `security_and_analysis` object. A missing key means GitHub does not offer it. */
function fromStatus(section) {
  if (section === undefined || section === null) return STATES.notOffered;
  const status = typeof section === "object" ? section.status : undefined;
  if (status === "enabled") return STATES.on;
  if (status === "disabled") return STATES.off;
  return STATES.unknown;
}

/**
 * Reads the two API answers into one report.
 * `repo` is the parsed body of `GET /repos/{repo}`. `scan` is `{ status, body }` for
 * `GET /repos/{repo}/code-scanning/default-setup`.
 * GitHub leaves out `security_and_analysis` (or one key of it) when the plan does not offer a setting. It also leaves
 * it out when the caller has no admin right. These differ: with `permissions.admin === false` the caller cannot see,
 * so the answer is "unknown", never "not offered".
 */
export function interpret(repo, scan) {
  const isObject = repo && typeof repo === "object";
  const blind = Boolean(isObject && repo.permissions && repo.permissions.admin === false);
  const sa = isObject && repo.security_and_analysis && typeof repo.security_and_analysis === "object" ? repo.security_and_analysis : {};
  const secret = blind ? STATES.unknown : fromStatus(sa.secret_scanning);
  const push = blind ? STATES.unknown : fromStatus(sa.secret_scanning_push_protection);
  let code = STATES.unknown;
  if (scan && scan.status === 200 && scan.body && typeof scan.body === "object") {
    code = scan.body.state === "configured" ? STATES.on : STATES.off;
  } else if (!blind && scan && (scan.status === 403 || scan.status === 404)) {
    // GitHub answers 403 "Code scanning is not enabled" when the feature is off or not in the plan. If the other
    // two settings are shown, the plan offers them, so code scanning is off. If neither is shown, none is offered.
    code = secret === STATES.notOffered && push === STATES.notOffered ? STATES.notOffered : STATES.off;
  }
  return [
    { setting: "Code scanning (CodeQL default setup)", state: code, level: LEVEL.required },
    { setting: "Secret scanning", state: secret, level: LEVEL.required },
    { setting: "Push protection", state: push, level: LEVEL.required },
  ];
}

/** A boolean equal to `wanted` is "on", a different boolean is "off", anything else is "unknown". */
function fromBoolean(value, wanted) {
  if (typeof value !== "boolean") return STATES.unknown;
  return value === wanted ? STATES.on : STATES.off;
}

/** The body of an answer when it is a 200 with an object, else an empty object (the settings are then "unknown"). */
function bodyOf(answer) {
  return answer && answer.status === 200 && answer.body && typeof answer.body === "object" ? answer.body : {};
}

/**
 * The Actions settings. `perms` is the answer of `GET /repos/{repo}/actions/permissions`, `workflow` the answer of
 * `GET /repos/{repo}/actions/permissions/workflow`; each is `{ status, body }` or null. A caller without admin right
 * gets 403 for both: the state is "unknown".
 */
export function interpretActions(perms, workflow) {
  const p = bodyOf(perms);
  const w = bodyOf(workflow);
  let allowed = STATES.unknown;
  if (typeof p.allowed_actions === "string") {
    allowed = p.allowed_actions === "selected" || p.allowed_actions === "local_only" ? STATES.on : STATES.off;
  }
  let token = STATES.unknown;
  if (typeof w.default_workflow_permissions === "string") {
    token = w.default_workflow_permissions === "read" ? STATES.on : STATES.off;
  }
  return [
    { setting: "CI token is read-only by default", state: token, level: LEVEL.required },
    { setting: "CI cannot approve pull requests", state: fromBoolean(w.can_approve_pull_request_reviews, false), level: LEVEL.required },
    { setting: "Only listed actions may run (not all actions)", state: allowed, level: LEVEL.advised },
    { setting: "Every action must be pinned to a full commit hash", state: fromBoolean(p.sha_pinning_required, true), level: LEVEL.advised },
  ];
}

/**
 * The signed-in login's scopes. `user` is the answer of `GET /user`, with its headers. A classic or OAuth token lists its
 * scopes in `x-oauth-scopes`; a fine-grained token sends none, so the state is "unknown". The scope `workflow` lets a
 * program push a workflow file: the state is "off" when it is present.
 */
export function interpretScopes(user) {
  let state = STATES.unknown;
  if (user && user.status === 200 && user.headers && typeof user.headers["x-oauth-scopes"] === "string") {
    const scopes = user.headers["x-oauth-scopes"].split(",").map((x) => x.trim());
    state = scopes.includes("workflow") ? STATES.off : STATES.on;
  }
  return { setting: "Daily login has no `workflow` scope", state, level: LEVEL.advised };
}

/**
 * Whether the default branch has a rule that needs a pull request. `rules` is the answer of
 * `GET /repos/{repo}/rules/branches/{branch}`: the list of rules in force. An empty list means no rule applies (a
 * ruleset on a private repository on a free plan is not enforced).
 */
export function interpretRules(rules) {
  let state = STATES.unknown;
  if (rules && rules.status === 200 && Array.isArray(rules.body)) {
    state = rules.body.some((r) => r && r.type === "pull_request") ? STATES.on : STATES.off;
  }
  return { setting: "`main` needs a pull request (a ruleset in force)", state, level: LEVEL.advised };
}

/** Exit code for a report: 0 when every required setting is on, else 1. An advised setting never changes it. */
export function exitCode(report) {
  return report.every((r) => r.level === LEVEL.advised || r.state === STATES.on) ? 0 : 1;
}

/** Text for the owner. Fixed words only. */
export function format(report, repoName) {
  const lines = [`GitHub security settings for ${repoName}`];
  for (const r of report) lines.push(`  ${r.state.padEnd(11)} ${r.level.padEnd(9)} ${r.setting}`);
  const bad = report.filter((r) => r.state !== STATES.on);
  const badRequired = bad.filter((r) => r.level !== LEVEL.advised);
  const badAdvised = bad.filter((r) => r.level === LEVEL.advised);
  if (badAdvised.length) {
    lines.push("", "Advised settings that are not on (they do not fail the check). See SETUP.md, section 4:");
    for (const r of badAdvised) lines.push(`  - ${r.setting}`);
  }
  if (badRequired.length) {
    lines.push("", "Turn the required settings on (SETUP.md, section 4).");
    if (badRequired.some((r) => r.state === STATES.unknown)) {
      lines.push("\"unknown\": GitHub did not answer clearly, or this account has no admin right on the repository.");
    }
    if (badRequired.some((r) => r.state === STATES.notOffered)) {
      lines.push("\"not offered\": this repository's plan does not show the setting. They are free for public repositories.",
        "For a private repository they are paid add-ons on some plans. Write the gap in docs/follow-ups.md.");
    }
  }
  return lines.join("\n");
}

// A branch name that is safe in a URL path: no "..", no leading "-", only letters, digits and "._/-".
const VALID_BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/;

// owner/repo: letters, digits, "_", "." and "-". A part made only of dots ("..") is refused.
const VALID_REPO = /^(?!\.+\/)(?!.*\/\.+$)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Runs one `gh api` GET against github.com. Returns { status, body }, or null when `gh` cannot run or the answer cannot
 * be read. `run` and `env` can be replaced in tests.
 */
export function ghGet(path, run = spawnSync, env = process.env) {
  // GH_HOST would send the request, with its token, to another host. Pin github.com for this call.
  const r = run("gh", ["api", "-i", path], { encoding: "utf8", env: { ...env, GH_HOST: "github.com" } });
  if (!r || r.error || typeof r.stdout !== "string") return null;
  const m = r.stdout.match(/^HTTP\/[\d.]+ (\d{3})/);
  if (!m) return null;
  const crlf = r.stdout.indexOf("\r\n\r\n");
  const lf = r.stdout.indexOf("\n\n");
  const split = crlf >= 0 ? crlf + 4 : lf >= 0 ? lf + 2 : -1;
  if (split < 0) return null;
  let body;
  try { body = JSON.parse(r.stdout.slice(split)); } catch { return null; }
  // The header lines sit between the status line and the blank line. Names are lower case. Values are data.
  const headers = {};
  for (const line of r.stdout.slice(0, split).split(/\r?\n/).slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(m[1]), body, headers };
}

function main(argv) {
  const name = argv[2];
  if (!name || !VALID_REPO.test(name)) {
    console.error("Usage: node tools/github-security-check.mjs <owner/repo>");
    return 2;
  }
  const repo = ghGet(`repos/${name}`);
  if (!repo || repo.status !== 200) {
    console.error("Could not read the repository. Run `gh auth status`, and check the name.");
    return 2;
  }
  const scan = ghGet(`repos/${name}/code-scanning/default-setup`);
  const branch = repo.body && typeof repo.body.default_branch === "string" && VALID_BRANCH.test(repo.body.default_branch)
    ? repo.body.default_branch : null;
  const report = [
    ...interpret(repo.body, scan),
    ...interpretActions(ghGet(`repos/${name}/actions/permissions`), ghGet(`repos/${name}/actions/permissions/workflow`)),
    interpretRules(branch ? ghGet(`repos/${name}/rules/branches/${branch}`) : null),
    interpretScopes(ghGet("user")),
  ];
  console.log(format(report, name));
  return exitCode(report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
