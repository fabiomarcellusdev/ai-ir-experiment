// security-guard.mjs: a Claude Code PreToolUse hook for Bash, PowerShell, WebFetch and MCP tools. Decision records:
// docs/decisions/0002-agents-and-security.md and 0004-task-pipeline-and-owner-approval.md.
//
// WHAT IT IS: an early warning, not the barrier. A guard that reads command text cannot model every shell spelling
// (three independent reviews proved it). The barriers are server-side branch protection, the command sandbox, and the
// owner's permission mode. This guard makes risky actions visible and refuses the owner's steps in every spelling it
// can read; where it cannot read a command with confidence, it asks.
//
// How it reads a command: it splits it into segments (; & | new lines $( ` <( >( and the text after " -- "),
// reads each segment's words the way a shell does (quotes joined, escapes removed), removes wrappers (env, command,
// nice, if/then/do), parses git and gh options, and looks inside bash -c, cmd /c and pwsh -Command.
//
// deny: a download piped into a shell; merging or approving a pull request; a push to main; a force push; deleting,
//   mirroring or pushing all branches; --no-verify; changing the hooks path, an alias, the SSH command, a push URL or
//   a mirror setting; setting ALLOW_MAIN_COMMIT, ALLOW_MAIN_PUSH or ALLOW_WORKFLOW_CHANGE.
// ask: private or secret files (also by wildcard); a host outside the allow list, anywhere in the command; every
//   publishing step (the pipeline's push and pull request too); every gh command that is not on the read-only list;
//   every git config write; git plumbing that moves refs; programs that run other programs (xargs, timeout, find
//   -exec, Start-Process, Invoke-Expression, ...); inline code that can reach the system (node -e with require,
//   python -c, ...); a write into the guards (tools/, .githooks/, .claude/, .git/, .gitattributes, git config files);
//   GIT_* variables and QUIET_HOURS_APPROVED set by the agent; words written in an obfuscated way; a command that
//   mentions git push or gh merge where the parser did not read a clean git or gh command; every MCP tool call.
//
// It fails closed: an error asks, and the hook entry blocks on a crash or a timeout. Uses Node built-ins only.

import { segments } from "./package-guard.mjs";

// ---------------------------------------------------------------------------------------------
// Text views of a command: the raw text, and the text a shell would see after quotes and escapes are removed.
// ---------------------------------------------------------------------------------------------

const views = (cmd) => [cmd, cmd.replace(/["']/g, ""), cmd.replace(/["'`]/g, "").replace(/\\(.)/g, "$1"), cmd.replace(/`(.)/g, "$1").replace(/["']/g, "")];
const anyView = (cmd, re) => views(cmd).some((v) => re.test(v));

const SENSITIVE = [
  /(^|[\s"'=/\\@])private-docs([/\\]|\s|$|["'])/i,
  /claude\.local\.md/i,
  /(^|[\s"'=/\\@])\.local([/\\]|\s|$|["'])/i,
  /(^|[\s"'=/\\@])\.env(\.[\w-]+)?(\s|$|["'])/i,
  /[/\\]\.ssh([/\\]|\s|$)|\bid_(rsa|ed25519|ecdsa)\b/i,
  /\.npmrc\b|\.pypirc\b|[/\\]\.aws[/\\]|[/\\]\.config[/\\]gh\b|credentials\.json\b|\.netrc\b/i,
  /\.(pem|key|p12|pfx)(\s|$|["'])/i,
  /\$env:[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)|\$\{?[A-Z_]*(TOKEN|SECRET|PASSWORD|API_KEY)\b/,
  /\bgh\s+auth\s+token\b|\bgit\s+credential\b/i,
];

// A write into the guards or into git's own configuration: a redirect or a writing program, then a guarded path.
const GUARDED_PATH = String.raw`[^\s"'|;&]*(\.githooks|\.claude|tools|\.git(?![\w-])|\.gitattributes|gitconfig|\.config[\\/]git)([\\/]|\s|$|["'])`;
const GUARD_WRITE = new RegExp(String.raw`(>>?\s*|\b(tee|cp|mv|rm|rmdir|del|erase|ren|rename|sed|perl|awk|truncate|dd|chmod|attrib|install|ln|mklink|set-content|sc|out-file|add-content|ac|remove-item|ri|copy-item|cpi|copy|move-item|mi|move|new-item|ni|rename-item|rni|clear-content|clc)\b[^|;&]*?\s)["']?${GUARDED_PATH}`, "i");

// Owner overrides set by the agent (deny), and other variables that change git or the quiet hours (ask).
const setsVar = (names) => new RegExp(String.raw`(\b(${names})\s*=|\b(export|declare|typeset|local|set|setx|readonly)\s+(-\w+\s+)*(${names})\b|\bprintf\s+-v\s+(${names})\b|\bread\s+(-\w+\s+)*(${names})\b|SetEnvironmentVariable\(\s*["']?(${names})|(set|new)-item\s+(-path\s+)?["']?env:(${names})|\$env:(${names})\s*=)`, "i");
const SETS_OVERRIDE = setsVar("ALLOW_MAIN_COMMIT|ALLOW_MAIN_PUSH|ALLOW_WORKFLOW_CHANGE");
const SETS_GIT_OR_QUIET = setsVar("GIT_[A-Z_]+|QUIET_HOURS_APPROVED");

// Hosts that need no prompt: the package registry, the vulnerability database, GitHub.
export const ALLOWED_HOSTS = ["registry.npmjs.org", "api.npmjs.org", "osv.dev", "api.osv.dev", "github.com", "api.github.com", "codeload.github.com", "raw.githubusercontent.com"];
const hostAllowed = (h) => ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));

export const TASK_BRANCH = /^(?:p\d+\/(?:feat|fix|test|docs|bench|sec|chore)-[\w.-]+|deps\/[\w.@-]+|exp\/[\w.-]+|fix\/[\w.-]+)$/;
const DENY_OWNER = "Only the owner approves or merges a pull request, pushes to main, rewrites or deletes a pushed branch, skips the hooks, or uses the owner's overrides (decisions 0003 and 0004). Report the pull request to the owner instead.";
const ASK_PUBLISH = "This changes something on GitHub or outside this machine. The owner approves it.";

/** True when a URL looks like it carries data out: a long query, or a long run of encoded characters. */
export function suspiciousUrl(url) {
  let u;
  try { u = new URL(url); } catch { return true; }
  if (u.username || u.password) return true;
  if (u.search.length > 200) return true;
  return /[A-Za-z0-9+/_=-]{120,}/.test(decodeURIComponent(u.pathname + u.search));
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** The words of a segment as a shell reads them: quoted parts joined, backslash escapes removed outside single quotes. */
export function shellWords(segment) {
  const words = [];
  let cur = "", has = false, quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote === "'") { if (c === "'") quote = null; else cur += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && /["\\$`]/.test(segment[i + 1] ?? "")) cur += segment[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === "\\" && i + 1 < segment.length && !/[\s]/.test(segment[i + 1]) && !/^[A-Za-z]:$|[\\/.]$/.test(cur)) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) words.push(cur); cur = ""; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) words.push(cur);
  return words;
}

/** A word that a shell would still change (a variable, a substitution, a glob, an escape) cannot be read with confidence. */
const unreadable = (w) => /[$`*?[\]{}()]/.test(w ?? "");
const progName = (t) => (t ?? "").split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();

const KEYWORDS = /^(!|then|do|else|elif|if|while|until|time|\{|\()$/;
const WRAPPERS = /^(env|command|builtin|exec|nohup|sudo|nice|ionice|time|chronic)$/;
const RUNNERS = /^(xargs|timeout|find|watch|setsid|stdbuf|parallel|wsl|call|start|start-process|saps|invoke-expression|iex|invoke-command|icm|foreach-object|%|invoke-item|ii|runas|schtasks|at|crontab|script|unbuffer|flock|su|doas|pkexec|busybox)$/;

/** The program, its arguments, and whether a wrapper with options or a runner hides the real program. */
function parse(segment) {
  const words = shellWords(segment.trim());
  let hidden = false;
  const skipEnv = () => { while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift(); };
  for (;;) {
    while (words.length && KEYWORDS.test(words[0])) words.shift();
    skipEnv();
    const p = progName(words[0]);
    if (WRAPPERS.test(p)) {
      words.shift();
      while (words[0]?.startsWith("-")) { hidden = true; words.shift(); }
      continue;
    }
    break;
  }
  const raw = words[0] ?? "";
  return { prog: progName(raw), rawProg: raw, args: words.slice(1), hidden };
}

const longIs = (arg, name, min = 2) => {
  if (!arg.startsWith("--")) return false;
  const f = arg.slice(2).split("=")[0].toLowerCase();
  return f.length >= min && name.startsWith(f);
};
const shortHas = (arg, letter) => /^-[A-Za-z0-9]+$/.test(arg) && arg.slice(1).includes(letter);
const stripRef = (r) => r.replace(/^refs\//, "").replace(/^heads\//, "");

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------

const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--super-prefix", "--attr-source", "--list-cmds"]);
const DANGEROUS_CONFIG = /hookspath|sshcommand|^include|includeif|pushurl|^url\.|insteadof|^alias\.|^remote\.[^.]+\.(push|mirror|url|receivepack|uploadpack)|fsmonitor|autocorrect|^core\.(editor|pager|askpass|gitproxy|attributesfile|excludesfile)|^credential|^diff\.[^.]+\.(textconv|command)|^filter\.|^merge\.[^.]+\.driver|^sequence\.editor/i;
const GIT_READS = new Set(["status", "diff", "log", "show", "blame", "grep", "ls-files", "ls-tree", "rev-parse", "rev-list", "describe", "shortlog", "reflog", "cat-file", "merge-base", "name-rev", "for-each-ref", "show-ref", "var", "version", "help", "check-ignore", "check-attr", "count-objects", "verify-commit", "whatchanged"]);
const GIT_LOCAL = new Set(["add", "commit", "switch", "checkout", "restore", "stash", "branch", "tag", "merge", "rebase", "cherry-pick", "revert", "reset", "rm", "mv", "init", "clean", "am", "apply", "format-patch", "notes", "worktree", "gc", "fsck", "prune", "maintenance", "sparse-checkout"]);
const GIT_NETWORK = new Set(["fetch", "pull", "clone", "ls-remote", "submodule", "remote", "archive", "request-pull", "send-email", "daemon", "http-backend", "svn", "p4"]);

function judgeGit(args) {
  const global = [];
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    global.push(args[i]);
    if (GIT_GLOBAL_WITH_VALUE.has(args[i]) && !args[i].includes("=")) { global.push(args[i + 1] ?? ""); i += 2; } else i++;
  }
  const sub = (args[i] ?? "").toLowerCase();
  const rest = args.slice(i + 1);
  if (unreadable(sub) || unreadable(args[i])) return { decision: "ask", reason: "The git subcommand is written in a form that cannot be read with confidence. The owner approves it." };

  const cfgValues = global.filter((_, k) => global[k - 1] === "-c").concat(global.filter((g) => g.startsWith("--config-env")));
  if (cfgValues.some((v) => DANGEROUS_CONFIG.test(v.split("=")[0]))) return { decision: "deny", reason: "This git command changes the hooks path, an alias, a push URL, a mirror setting, a program git runs or the included configuration. Only the owner may do this." };
  let ask = global.some((g) => g === "-c" || /^--(config-env|exec-path|git-dir|work-tree)/.test(g))
    ? { decision: "ask", reason: "This git command changes git's configuration or repository for one command. The owner approves it." } : null;
  // `-C <folder>` runs git in another folder, which may be another session's checkout. Only `-C .` passes.
  if (!ask && global.some((g, k) => global[k - 1] === "-C" && !/^\.[\\/]?$/.test(g))) {
    ask = { decision: "ask", reason: "git -C runs git in another folder, which may be another session's checkout. The owner approves it." };
  }

  let r;
  if (sub === "push") r = judgePush(rest);
  else if (["commit", "merge", "am", "rebase", "cherry-pick", "revert", "pull"].includes(sub) && rest.some((a) => longIs(a, "no-verify", 4) || (sub === "commit" && shortHas(a, "n")))) {
    r = { decision: "deny", reason: "--no-verify skips the git hooks and their checks. Only the owner may skip them." };
  } else if (sub === "config") r = judgeGitConfig(rest);
  else if ((sub === "rebase" && rest.some((a) => /^(-x|--exec)/.test(a) || shortHas(a, "x"))) || (sub === "bisect" && rest[0] === "run") || (sub === "difftool" && rest.some((a) => /^(-x|--extcmd)/.test(a))) || (sub === "submodule" && rest[0] === "foreach") || sub === "filter-branch" || sub === "filter-repo") {
    r = { decision: "ask", reason: "This git command runs another command. The owner approves it." };
  } else if (["update-ref", "symbolic-ref", "replace", "commit-tree", "hash-object", "update-index", "mktree", "read-tree", "write-tree", "pack-refs"].includes(sub) || (sub === "branch" && rest.some((a) => shortHas(a, "f") || shortHas(a, "M") || shortHas(a, "C") || longIs(a, "force", 3)) && rest.some((a) => /^(refs\/heads\/)?(main|master)$/.test(a)))) {
    r = { decision: "ask", reason: "This git command moves references directly. The owner approves it." };
  } else if (GIT_NETWORK.has(sub)) {
    r = sub === "remote" && !/^(add|set-url|rename|remove|rm|set-head|set-branches|prune|update)$/.test(rest[0] ?? "") ? { decision: "allow" } : { decision: "ask", reason: "This git command contacts a remote or changes one. The owner approves it." };
  } else if (sub === "worktree" && (rest[0] ?? "list") !== "list") {
    r = { decision: "ask", reason: "Create and remove worktrees with node tools/worktree.mjs, which copies the owner's local files and keeps the limit. The owner approves a direct git worktree command." };
  } else if (GIT_READS.has(sub) || GIT_LOCAL.has(sub) || sub === "") r = { decision: "allow" };
  else r = { decision: "ask", reason: `"git ${sub}" is not a known git command; it may be an alias. The owner approves it.` };

  if (r.decision === "deny") return r;
  if (r.decision === "ask") return r;
  return ask ?? r;
}

function judgeGitConfig(rest) {
  const readForm = rest.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|--list|-l|--show-origin|--show-scope|--name-only)$/.test(a)) || /^(get|list)$/.test(rest[0] ?? "");
  const writeForm = rest.some((a) => /^(--add|--replace-all|--unset|--unset-all|--rename-section|--remove-section|-e|--edit)$/.test(a)) || /^(set|unset|rename-section|remove-section|edit)$/.test(rest[0] ?? "");
  const keys = rest.filter((a) => !a.startsWith("-"));
  if (!writeForm && (readForm || keys.length <= 1)) return { decision: "allow" };
  if (keys.some((k) => DANGEROUS_CONFIG.test(k))) return { decision: "deny", reason: "This changes git's hooks path, an alias, a push URL, a mirror setting, a program git runs or an include. Only the owner may do this." };
  return { decision: "ask", reason: "This changes git's configuration. The owner approves it." };
}

const PUSH_WITH_VALUE = new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]);

function judgePush(rest) {
  const flags = [], pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("-")) { flags.push(a); if (PUSH_WITH_VALUE.has(a)) i++; } else pos.push(a);
  }
  for (const f of flags) {
    if (longIs(f, "force") || longIs(f, "force-with-lease") || longIs(f, "force-if-includes") || shortHas(f, "f")) return { decision: "deny", reason: DENY_OWNER };
    if (longIs(f, "delete") || shortHas(f, "d") || longIs(f, "mirror") || longIs(f, "prune", 3) || longIs(f, "all") || longIs(f, "branches")) return { decision: "deny", reason: DENY_OWNER };
    if (longIs(f, "no-verify", 4)) return { decision: "deny", reason: DENY_OWNER };
    if (longIs(f, "receive-pack", 3) || longIs(f, "exec", 3) || longIs(f, "repo", 3)) return { decision: "ask", reason: "This push runs a different receive program or names another repository. The owner approves it." };
  }
  const [remote, ...refspecs] = pos;
  for (const r of refspecs) {
    if (r.startsWith("+") || r.includes("*")) return { decision: "deny", reason: DENY_OWNER }; // a wildcard includes main
    if (unreadable(r)) return { decision: "ask", reason: "A refspec is written in a form that cannot be read with confidence. The owner approves it." };
    const colon = r.indexOf(":");
    if (colon === 0) return { decision: "deny", reason: DENY_OWNER }; // ":branch" deletes it
    const dst = stripRef(colon >= 0 ? r.slice(colon + 1) : r);
    if (/^(main|master)$|\/(main|master)$/.test(dst)) return { decision: "deny", reason: DENY_OWNER };
  }
  if (unreadable(remote)) return { decision: "ask", reason: "The remote is written in a form that cannot be read with confidence. The owner approves it." };
  const okFlags = flags.every((f) => f === "-u" || longIs(f, "set-upstream", 5));
  if (remote === "origin" && refspecs.length === 1 && TASK_BRANCH.test(refspecs[0]) && okFlags) {
    return { decision: "ask", reason: `Pipeline step: this publishes the task branch ${refspecs[0]} to GitHub. The owner approves each push (decision 0004).` };
  }
  return { decision: "ask", reason: "This push does not name exactly one task branch on origin (decision 0003). The owner approves it." };
}

// ---------------------------------------------------------------------------------------------
// gh: a read-only list; everything else asks, and the owner's steps are refused.
// ---------------------------------------------------------------------------------------------

const GH_WITH_VALUE = new Set(["-R", "--repo", "--hostname", "-H", "--header", "-X", "--method", "-f", "--raw-field", "-F", "--field", "--input", "-q", "--jq", "-t", "--template", "-b", "--body", "--body-file", "-T", "--title", "-B", "--base", "--head", "-l", "--label", "-a", "--assignee", "-r", "--reviewer", "-m", "--milestone", "-p", "--project", "-e", "--editor", "--cache", "--preview", "-L", "--limit", "-s", "--state", "-S", "--search", "--json", "-w", "--web", "-i", "--interval"]);
const GH_READ = {
  pr: ["view", "list", "ls", "checks", "diff", "status"],
  issue: ["view", "list", "ls", "status"],
  run: ["view", "list", "ls", "watch"],
  workflow: ["view", "list", "ls"],
  repo: ["view", "list", "ls"],
  release: ["view", "list", "ls"],
  label: ["list", "ls"],
  ruleset: ["view", "list", "ls", "check"],
  gist: ["view", "list", "ls"],
  cache: ["list", "ls"],
  search: ["*"],
  status: ["*"],
  auth: ["status"],
  version: ["*"],
  help: ["*"],
};

function judgeGh(args) {
  const words = [], flags = [];
  let repoFlag = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      flags.push(a);
      const name = a.split("=")[0];
      if (name === "-R" || name === "--repo") repoFlag = true;
      const isApprove = words[0] === "pr" && words[1] === "review" && /^-a/.test(a);
      if (!a.includes("=") && GH_WITH_VALUE.has(a) && !isApprove) { flags.push(args[i + 1] ?? ""); i++; }
    } else words.push(a);
  }
  if (words.slice(0, 2).some(unreadable)) return { decision: "ask", reason: "The gh command is written in a form that cannot be read with confidence. The owner approves it." };
  const [top, sub] = [(words[0] ?? "").toLowerCase(), (words[1] ?? "").toLowerCase()];

  if (top === "pr" && sub === "merge") return { decision: "deny", reason: DENY_OWNER };
  if (top === "pr" && sub === "review" && flags.some((f) => longIs(f, "approve", 3) || shortHas(f, "a"))) return { decision: "deny", reason: DENY_OWNER };
  if (top === "api") return judgeGhApi(words, flags);
  if (top === "pr" && (sub === "create" || sub === "new")) {
    if (repoFlag) return { decision: "ask", reason: "This opens a pull request on another repository (-R). The owner approves it." };
    return { decision: "ask", reason: "Pipeline step: this opens a pull request on GitHub. Check that its text holds nothing private. The owner approves it (decision 0004)." };
  }
  const reads = GH_READ[top];
  if (reads && (reads.includes("*") || reads.includes(sub)) && !flags.some((f) => /^(-w|--web)$/.test(f))) return { decision: "allow" };
  return { decision: "ask", reason: `"gh ${[top, sub].filter(Boolean).join(" ")}" is not on the read-only list. ${ASK_PUBLISH}` };
}

function judgeGhApi(words, flags) {
  const endpoints = words.slice(1);
  const methods = [];
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "-X" || f === "--method") methods.push((flags[i + 1] ?? "").toUpperCase());
    const m = /^(?:-X|--method=)(.+)$/i.exec(f);
    if (m) methods.push(m[1].toUpperCase());
  }
  const hasBody = flags.some((f) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(f) || /^-[fF].+/.test(f));
  const endpoint = endpoints[0] ?? "";
  const dangerous = /\/pulls\/\d+\/(merge|reviews)\b|\/merges\b|\/git\/refs\b|\/auto-merge\b|\/keys\b|\/deploy[-_]keys\b|\/collaborators\b|\/hooks\b|\/actions\/(secrets|permissions|variables)\b|\/rulesets\b|\/branches\/[^/]+\/protection\b/i;
  const graphqlMutation = /mergePullRequest|enablePullRequestAutoMerge|addPullRequestReview|submitPullRequestReview|updateRef|deleteRef|createCommitOnBranch|updateBranchProtectionRule|deleteBranchProtectionRule/i;
  if (endpoints.some((e) => dangerous.test(e)) && (hasBody || methods.some((m) => m !== "GET") || methods.length > 1)) return { decision: "deny", reason: DENY_OWNER };
  if (graphqlMutation.test(flags.join(" ") + " " + words.join(" "))) return { decision: "deny", reason: DENY_OWNER };
  if (endpoints.length !== 1 || /:\/\//.test(endpoint) || methods.length > 1 || hasBody || (methods[0] && methods[0] !== "GET") || /^\/?graphql$/i.test(endpoint) || flags.some((f) => /^(-H|--header|--hostname)/.test(f))) {
    return { decision: "ask", reason: `This API call may change something on GitHub or reach another host. ${ASK_PUBLISH}` };
  }
  return { decision: "allow" };
}

// ---------------------------------------------------------------------------------------------
// Other programs
// ---------------------------------------------------------------------------------------------

const SHELLS = /^(bash|sh|zsh|dash|ksh|fish|cmd|powershell|pwsh)$/;
const EGRESS_TOOLS = /^(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|nc|ncat|netcat|scp|sftp|ftp|ssh|rsync|telnet|socat|nslookup|dig|host|ping|tracert|traceroute|resolve-dnsname|test-netconnection|bitsadmin|certutil)$/;
const INLINE_CODE = { node: /^(-e|-p|--eval|--print|-pe)$/, deno: /^(eval)$/, python: /^-c$/, python3: /^-c$/, py: /^-c$/, perl: /^-[a-zA-Z]*e/, ruby: /^-e$/, php: /^-r$/ };
// Inline code that cannot reach the system is fine (node -e "console.log(1 + 1)").
const SYSTEM_REACH = /require|import|process|child|fetch|globalThis|global\s*\[|Function|eval|Deno|Bun|http|net|dns|fs|spawn|exec|open\(|os\.|subprocess|socket|urllib|system/i;

// New-Item's item type, in any spelling PowerShell accepts: -ItemType X, -ItemType:X, a prefix (-it X), the alias
// -Type. Only a plain File or Directory passes; a link type or a value this guard cannot read asks.
const ITEM_TYPE_PARAM = /^-(i|it|ite|item|itemt|itemty|itemtyp|itemtype|t|ty|typ|type)(:|$)/i;
function newItemMakesLink(args) {
  for (let i = 0; i < args.length; i++) {
    const m = ITEM_TYPE_PARAM.exec(args[i]);
    if (!m) continue;
    const value = (m[2] === ":" ? args[i].slice(args[i].indexOf(":") + 1) : args[i + 1] ?? "").replace(/^["']|["']$/g, "");
    if (!/^(file|directory)$/i.test(value)) return true;
  }
  return false;
}
// A link or junction can send a write, or a guard's file lookup, to another folder (decision 0003, amendment
// "parallel checkouts"; security reviews, 2026-11-08).
function makesLink(prog, args) {
  if (/^(ln|mklink|link|junction|junction64)$/.test(prog)) return true;
  if (/^(new-item|ni)$/.test(prog) && newItemMakesLink(args)) return true;
  if (prog === "fsutil" && args.some((a) => /^(hardlink|reparsepoint)$/i.test(a))) return true;
  // GNU cp accepts any unique prefix of a long option: --sym, --symb, ... --symbolic-link; --li, --link.
  const longPrefix = (a, name, min) => a.startsWith("--") && a.length - 2 >= min && name.startsWith(a.slice(2).split("=")[0]);
  if (prog === "cp" && args.some((a) => longPrefix(a, "symbolic-link", 2) || longPrefix(a, "link", 1) || /^-[a-zA-Z]*[sl][a-zA-Z]*$/.test(a))) return true;
  // The whole segment as text, for forms where New-Item is not the program word: `$null = New-Item ...`,
  // `(New-Item ...)`, `. { ni ... }`, splatting (`New-Item @p`). Also .NET calls from PowerShell, plain
  // ([IO.Directory]::CreateSymbolicLink) or with a computed name ([IO.Directory]::('Create...'+'Link')).
  const text = [prog, ...args].join(" ");
  if (/(^|[^\w-])(new-item|ni)($|[^\w-])/i.test(text) && /junction|symboliclink|hardlink|@\w/i.test(text)) return true;
  return /create(symbolic|hard)link|createjunction|\]::\s*\(/i.test(text);
}

function judgeOther(prog, args) {
  if (makesLink(prog, args)) {
    return { decision: "ask", reason: "This creates a link or a junction, which can send writes or a guard's lookup to another folder. The owner approves it." };
  }
  if (SHELLS.test(prog)) {
    const at = args.findIndex((a) => /^(\/c|\/k|-command|-commandwithargs|-c|-encodedcommand|-enc|-e|-ec)$/i.test(a) || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a) || /^-com/i.test(a));
    if (args.some((a) => /^-(f|file)$/i.test(a))) return { decision: "ask", reason: "This runs a script file through a shell. The owner approves it." };
    if (at >= 0) {
      if (/^-(encodedcommand|enc|e|ec)$/i.test(args[at])) return { decision: "ask", reason: "An encoded command cannot be read. The owner approves it." };
      return { inner: args.slice(at + 1).join(" ") };
    }
    return { decision: "allow" };
  }
  if (RUNNERS.test(prog) || (prog === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete)$/.test(a)))) {
    return { decision: "ask", reason: `"${prog}" runs other commands, which this guard cannot read. The owner approves it.` };
  }
  const inline = INLINE_CODE[prog];
  if (inline) {
    const at = args.findIndex((a) => inline.test(a));
    if (at >= 0 && SYSTEM_REACH.test(args.slice(at + 1).join(" "))) return { decision: "ask", reason: "This inline code can reach the system or the network. The owner approves it." };
  }
  if (EGRESS_TOOLS.test(prog)) {
    if (args.some((a) => /^(-x|--proxy|--preproxy|--resolve|--connect-to|-K|--config|--doh-url|-e|--execute)$/.test(a.split("=")[0]))) return { decision: "ask", reason: "This network command changes where it connects. The owner approves it." };
    if (/^(nc|ncat|netcat|socat|nslookup|dig|host|ping|tracert|traceroute|resolve-dnsname|test-netconnection|telnet|ftp|bitsadmin|certutil)$/.test(prog)) return { decision: "ask", reason: "This command talks to the network directly. The owner approves it." };
    if (!/:\/\//.test(args.join(" "))) return { decision: "ask", reason: "This network command names no URL that this guard can check. The owner approves it." };
  }
  if (/^(npm|pnpm|yarn|bun)$/.test(prog) && args[0] === "publish") return { decision: "ask", reason: "This publishes a package. The owner approves it." };
  return { decision: "allow" };
}

// ---------------------------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------------------------

const RANK = { allow: 0, ask: 1, deny: 2 };

/** Returns { decision: "deny" | "ask" | "allow", reason } for a shell command. "allow" means no opinion. */
export function judgeCommand(command, depth = 0) {
  let worst = { decision: "allow", reason: "" };
  const raise = (r) => { if (r && RANK[r.decision] > RANK[worst.decision]) worst = r; };

  // Whole-command checks, on every text view.
  if (anyView(command, /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|]*\|\s*(?:(?:sh|bash|zsh|dash|iex|invoke-expression|pwsh|powershell)\b|(?:node|python3?|py)(?:\s+-)?\s*(?:$|[;&|)]))/i)) {
    return { decision: "deny", reason: "Piping downloaded text into a shell runs unreviewed code. Download, read, then decide with the owner." };
  }
  if (anyView(command, SETS_OVERRIDE)) return { decision: "deny", reason: DENY_OWNER };
  if (anyView(command, /\|\s*(sh|bash|zsh|dash|ksh|pwsh|powershell|cmd|iex|invoke-expression)\b/i)) raise({ decision: "ask", reason: "This pipes text into a shell, which then runs it. The owner approves it." });
  if (anyView(command, SETS_GIT_OR_QUIET)) raise({ decision: "ask", reason: "This sets a GIT_* variable or QUIET_HOURS_APPROVED, which can change git or skip the quiet hours. The owner approves it." });
  if (SENSITIVE.some((r) => anyView(command, r)) || globHitsSensitive(command)) raise({ decision: "ask", reason: "This command names a private or secret file. The owner approves each access (decision 0002)." });
  if (anyView(command, GUARD_WRITE)) raise({ decision: "ask", reason: "This command writes into the guards, the git hooks or git's configuration. The owner approves it." });
  for (const v of views(command)) {
    for (const m of v.matchAll(/\b(?:https?|ftp|ssh|git|wss?):\/\/([^/\s"'?:@]+@)?([^/\s"'?:]+)/gi)) {
      if (!hostAllowed(m[2].toLowerCase())) raise({ decision: "ask", reason: `This command names ${m[2]}, a host outside the allow list. The owner approves network access (decision 0002).` });
    }
    for (const m of v.matchAll(/\bhttps?:\/\/\S+/gi)) if (suspiciousUrl(m[0].replace(/["')]+$/, ""))) raise({ decision: "ask", reason: "This URL looks like it carries data. The owner approves it (decision 0002)." });
  }

  // Segment checks.
  let readGitOrGh = false;
  const text = command.replace(/[<>]\(/g, "; ");
  for (const seg of segments(text)) {
    if (!seg.trim()) continue;
    const { prog, rawProg, args, hidden } = parse(seg);
    if (hidden) raise({ decision: "ask", reason: "A wrapper with options hides the program it runs. The owner approves it." });
    if (prog === "git") { readGitOrGh = true; raise(unreadable(rawProg) ? { decision: "ask", reason: "The program name cannot be read with confidence." } : judgeGit(args)); }
    else if (prog === "gh") { readGitOrGh = true; raise(unreadable(rawProg) ? { decision: "ask", reason: "The program name cannot be read with confidence." } : judgeGh(args)); }
    else {
      const r = judgeOther(prog, args);
      if (r.inner !== undefined) {
        if (depth >= 4) raise({ decision: "ask", reason: "Shells nested this deep cannot be read with confidence." });
        else { const inner = judgeCommand(r.inner, depth + 1); raise(inner); if (/git|gh/i.test(r.inner)) readGitOrGh = true; }
      } else raise(r);
    }
    if (worst.decision === "deny") return worst;
  }

  // Last chance: git push or gh merge appear, but no clean git or gh command was read.
  if (worst.decision === "allow" && !readGitOrGh && anyView(command, /(^|[\s;&|({!])git(\.exe)?\s[\s\S]*\spush\b|(^|[\s;&|({!])gh(\.exe)?\s[\s\S]*\s(merge|approve|create|new|delete|api)\b|--no-verify|hookspath/i)) {
    raise({ decision: "ask", reason: "This command mentions git push or a gh change in a form this guard could not read. The owner approves it." });
  }
  return worst;
}

// Names that a wildcard must not reach ("cat CLAUDE.loc*", "git add -f private-d*/"). A lone "*" is ordinary.
const SENSITIVE_NAMES = ["private-docs", "claude.local.md", ".local", ".env", ".env.local", ".env.production", ".ssh", "id_rsa", "id_ed25519", ".npmrc", ".netrc", ".aws", "credentials.json"];
function globHitsSensitive(command) {
  for (const tok of command.match(/\S+/g) ?? []) {
    for (const part of tok.replace(/["']/g, "").split(/[\\/]/)) {
      if (!/[*?[]/.test(part) || /^\*+$/.test(part) || part.length > 200) continue;
      const re = new RegExp(`^${part.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
      if (SENSITIVE_NAMES.some((n) => re.test(n) && /[a-z]/i.test(part.replace(/[*?[\]]/g, "")))) return true;
    }
  }
  return false;
}

/** Returns { decision, reason } for a WebFetch URL. */
export function judgeFetch(url) {
  if (suspiciousUrl(url)) return { decision: "ask", reason: "This URL looks like it carries data (a long query or encoded text). The owner approves it (decision 0002)." };
  return { decision: "allow", reason: "" };
}

export function judgeTool(data) {
  const name = data?.tool_name ?? "";
  const ti = data?.tool_input ?? {};
  if (name.startsWith("mcp__")) return { decision: "ask", reason: "An MCP tool can read or send data outside this machine. The owner approves each call." };
  if (typeof ti.command === "string") return judgeCommand(ti.command);
  if (typeof ti.url === "string") return judgeFetch(ti.url);
  return { decision: "allow", reason: "" };
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const r = judgeTool(JSON.parse(input));
  if (r.decision === "allow") return; // no opinion: Claude Code's normal permission flow decides
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: r.decision, permissionDecisionReason: `security-guard: ${r.reason}` } }));
}

if (process.argv[1] && /security-guard\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((e) => {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `security-guard could not judge this call (${e.message}); the owner decides.` } }));
  });
}
