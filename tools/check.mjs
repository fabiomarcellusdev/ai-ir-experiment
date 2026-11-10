// check.mjs: the checks that must pass at each milestone (docs/testing.md). Configured by tools/check.config.json.
//
//   node tools/check.mjs fast            every commit (the pre-commit hook runs it)
//   node tools/check.mjs full            every push and pull request (the pre-push hook and CI run it)
//   node tools/check.mjs gate            a phase gate: full, plus the gate tests in tests/gates/
//   node tools/check.mjs update-golden   re-pin the golden outputs after an explained, intended change
//
// Uses Node built-ins only. Exit 0 when every check passes, 1 when one fails.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mainCheckout, privatePath } from "./main-checkout.mjs";
import { worktreeProblems, loadConfig as loadWorktreeConfig } from "./worktree.mjs";
import { scanRepository } from "./secret-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Problems with tools/worktree.config.json that would weaken a worktree: a limit above 3, or a copy list that is not
 * exactly the files that turn on the owner's local notes and guards (decision 0003, amendment "parallel checkouts").
 */
const WORKTREE_COPY = ["CLAUDE.local.md", ".claude/settings.local.json", ".claude/local"];
export function worktreeConfigProblems(configJson) {
  let cfg;
  try { cfg = JSON.parse(configJson); } catch { return ["tools/worktree.config.json is not valid JSON"]; }
  const p = [];
  if (!Number.isInteger(cfg.maxWorktrees) || cfg.maxWorktrees < 1 || cfg.maxWorktrees > 3) p.push("worktree.config.json: maxWorktrees must be 1 to 3");
  const list = cfg.copyFromMain;
  if (!Array.isArray(list) || list.length !== WORKTREE_COPY.length || !WORKTREE_COPY.every((f) => list.includes(f))) {
    p.push(`worktree.config.json: copyFromMain must be exactly ${JSON.stringify(WORKTREE_COPY)}`);
  }
  return p;
}

/** [name, ok, detail] for the worktree setup check of `root`. Every error fails the check (fail closed). */
export function worktreeSetupResult(root = ROOT) {
  try {
    const main = mainCheckout(root);
    if (path.resolve(main) === path.resolve(root)) return ["worktree setup (this is the main checkout)", true, ""];
    const problems = worktreeProblems(main, root, loadWorktreeConfig(root).copyFromMain);
    return ["worktree setup (the owner's local files are here)", problems.length === 0,
      problems.length ? `${problems.join("\n")}\nRun: node tools/worktree.mjs sync` : ""];
  } catch (e) {
    return ["worktree setup", false, `This checkout could not be checked: ${e.message}. Create worktrees with tools/worktree.mjs.`];
  }
}

// ---------------------------------------------------------------------------------------------
// Pure checks, exported for tools/tools.test.mjs
// ---------------------------------------------------------------------------------------------

/** Problems with one pnpm project's pins and safety settings. An empty list means the guards are intact. */
export function guardProblems({ packageJson, workspaceYaml, minAgeMinutes = 86400 }, today = new Date()) {
  const p = [];
  const pkg = JSON.parse(packageJson);
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })) {
    if (!/^\d+\.\d+\.\d+$/.test(spec)) p.push(`${name} is "${spec}", not an exact version`);
  }
  if (!/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/.test(pkg.packageManager ?? "")) p.push("packageManager is not pnpm pinned with a sha512 hash");
  if (pkg.devEngines?.packageManager?.name !== "pnpm" || pkg.devEngines?.packageManager?.onFail !== "error") p.push("devEngines.packageManager is not pnpm with onFail: error");

  const setting = (key) => workspaceYaml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"))?.[1];
  const age = Number(setting("minimumReleaseAge"));
  if (!(age >= minAgeMinutes)) p.push(`minimumReleaseAge is ${setting("minimumReleaseAge")}, below ${minAgeMinutes} minutes`);
  const want = {
    minimumReleaseAgeStrict: "true", trustPolicy: "no-downgrade", blockExoticSubdeps: "true", strictDepBuilds: "true",
    allowBuilds: "{}", ignoreScripts: "true", verifyDepsBeforeRun: "error", autoInstallPeers: "false", pmOnFail: "error", saveExact: "true",
  };
  for (const [k, v] of Object.entries(want)) if (setting(k) !== v) p.push(`${k} is ${setting(k) ?? "missing"}, not ${v}`);

  for (const m of workspaceYaml.matchAll(/Remove this entry on or after (\d{4}-\d{2}-\d{2})/g)) {
    if (new Date(`${m[1]}T00:00:00Z`) <= today) p.push(`a minimumReleaseAgeExclude entry expired on ${m[1]}; remove it (docs/decisions)`);
  }
  return p;
}

// Each guard must run as a PreToolUse hook, on the tools it guards, as "node <the guard>", and block on failure.
const REQUIRED_HOOKS = [
  { file: "package-guard.mjs", tools: ["Bash", "PowerShell"] },
  { file: "security-guard.mjs", tools: ["Bash", "PowerShell", "WebFetch", "mcp__.*"] },
  { file: "quiet-hours-guard.mjs", tools: ["*"] },
];

/** Problems with the guard hooks in .claude/settings.json. An empty list means each guard runs as required. */
export function hookProblems(settingsJson) {
  const groups = JSON.parse(settingsJson).hooks?.PreToolUse ?? [];
  const problems = [];
  for (const req of REQUIRED_HOOKS) {
    const cmd = new RegExp(`^node\\s+"?\\$CLAUDE_PROJECT_DIR/\\.claude/hooks/${req.file.replace(".", "\\.")}"?$`);
    const ok = groups.some((g) => {
      const matcher = g.matcher ?? "*";
      const covers = req.tools[0] === "*" ? matcher === "*" || matcher === "" : matcher === "*" || req.tools.every((t) => matcher.split("|").includes(t));
      return covers && (g.hooks ?? []).some((h) => h.type === "command" && cmd.test(h.command ?? "") && h.onFailure === "block");
    });
    if (!ok) problems.push(`.claude/settings.json must run ${req.file} as a PreToolUse hook on ${req.tools.join(", ")}, as "node $CLAUDE_PROJECT_DIR/.claude/hooks/${req.file}", with onFailure "block"`);
  }
  return problems;
}

/** Problems with the git hooks: each must run git-guard before the checks. */
export function gitHookProblems(preCommit, prePush) {
  const p = [];
  if (!/node tools\/git-guard\.mjs pre-commit[^\n]*\|\| exit 1[\s\S]*node tools\/check\.mjs fast/.test(preCommit)) p.push(".githooks/pre-commit must run git-guard pre-commit, then check.mjs fast");
  if (!/node tools\/git-guard\.mjs pre-push[^\n]*\|\| exit 1[\s\S]*node tools\/check\.mjs full/.test(prePush)) p.push(".githooks/pre-push must run git-guard pre-push, then check.mjs full");
  return p;
}

/** Lines of `text` that contain a private term (case-insensitive). */
export function privateHits(text, terms) {
  const hits = [];
  const lower = terms.map((t) => t.toLowerCase());
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.toLowerCase();
    for (const t of lower) if (l.includes(t)) hits.push({ line: i + 1, term: t });
  });
  return hits;
}

/** File names that differ between two folders: missing, extra or changed. */
export function folderDiff(expectedDir, actualDir) {
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
  const exp = list(expectedDir), act = list(actualDir);
  const diffs = [];
  for (const f of exp) {
    if (!act.includes(f)) diffs.push(`missing: ${f}`);
    else if (!fs.readFileSync(path.join(expectedDir, f)).equals(fs.readFileSync(path.join(actualDir, f)))) diffs.push(`changed: ${f}`);
  }
  for (const f of act) if (!exp.includes(f)) diffs.push(`new: ${f}`);
  return diffs;
}

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail.split("\n").join("\n      ")}` : ""}`);
}
const run = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", ...opts });
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const config = () => JSON.parse(read("tools/check.config.json"));

function unitTests(cfg) {
  const r = run(["--test", ...cfg.unitTests]);
  const summary = (r.stdout ?? "").split("\n").filter((l) => /^ℹ (tests|pass|fail)|✖/.test(l)).join("\n");
  record("unit tests", r.status === 0, r.status === 0 ? summary : `${summary}\n${r.stderr ?? ""}`.trim());
}

function voiceLint() {
  const r = run(["tools/voice-lint.mjs"]);
  record("voice lint (docs/voice.md terms)", r.status === 0, (r.stdout + r.stderr).trim());
}

function guards(cfg) {
  const problems = [...hookProblems(read(".claude/settings.json")), ...gitHookProblems(read(".githooks/pre-commit"), read(".githooks/pre-push"))];
  for (const dir of cfg.pnpmProjects) {
    const pj = path.join(dir, "package.json"), ws = path.join(dir, "pnpm-workspace.yaml");
    if (!fs.existsSync(path.join(ROOT, pj)) || !fs.existsSync(path.join(ROOT, ws))) { problems.push(`${dir}: package.json or pnpm-workspace.yaml is missing`); continue; }
    for (const p of guardProblems({ packageJson: read(pj), workspaceYaml: read(ws), minAgeMinutes: cfg.minReleaseAgeMinutes })) problems.push(`${dir}: ${p}`);
  }
  problems.push(...worktreeConfigProblems(read("tools/worktree.config.json")));
  record("package and agent guards intact", problems.length === 0, problems.join("\n"));
}

// A linked worktree must hold the owner's local files that Claude Code reads per checkout (tools/worktree.mjs).
function worktreeSetup() {
  record(...worktreeSetupResult(ROOT));
}

function privacy(cfg) {
  // The terms are git-ignored, so they live in the main checkout only; a linked worktree reads them from there.
  let termsFile;
  try {
    termsFile = privatePath(cfg.privacyTermsFile);
  } catch {
    return record("privacy lint", false, "The main checkout could not be found, so the private terms could not be read.");
  }
  if (!fs.existsSync(termsFile)) return record(`privacy lint (skipped: no ${cfg.privacyTermsFile} here)`, true);
  const terms = fs.readFileSync(termsFile, "utf8").split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith("#"));
  const git = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  if (git.status !== 0) return record("privacy lint", false, "git ls-files failed");
  const allowed = new Set(cfg.privacyAllow ?? []);
  const hits = [];
  for (const f of git.stdout.split("\n").filter(Boolean)) {
    if (allowed.has(f) || !fs.existsSync(path.join(ROOT, f))) continue;
    const buf = fs.readFileSync(path.join(ROOT, f));
    if (buf.includes(0)) continue;
    for (const h of privateHits(buf.toString("utf8"), terms)) hits.push(`${f}:${h.line} contains "${h.term}"`);
  }
  record("privacy lint (no private term in a file that git would publish)", hits.length === 0, hits.join("\n"));
}

// Every commit and every pull request: CI runs `full`, which includes this, so a pull request gets the same scan.
function secrets() {
  let hits, skipped;
  try { ({ hits, skipped } = scanRepository(ROOT)); } catch (e) { return record("secret scan", false, String(e.message)); }
  const notes = skipped.length ? `Not scanned:\n${skipped.join("\n")}` : "";
  record("secret scan (no key, token or password in a file that git would publish)", hits.length === 0,
    hits.length ? `${hits.join("\n")}\nFollow AGENTS.md, "If a secret appears": revoke and rotate a real secret first. A false alarm goes into tools/secret-scan.allow.json with its reason (the owner's yes).${notes ? "\n" + notes : ""}` : notes);
}

function golden(cfg) {
  if (!cfg.golden.length) return record("golden outputs (none configured)", true);
  for (const g of cfg.golden) {
    const r = spawnSync(g.command[0] === "node" ? process.execPath : g.command[0], g.command.slice(1), { cwd: path.join(ROOT, g.cwd ?? "."), encoding: "utf8" });
    if (r.status !== 0) { record(`golden: ${g.name}`, false, r.stderr); continue; }
    const diffs = folderDiff(path.join(ROOT, g.expected), path.join(ROOT, g.actual));
    record(`golden: ${g.name}`, diffs.length === 0, diffs.length ? `${diffs.join("\n")}\nIf intended: explain it, run "node tools/check.mjs update-golden", commit both together.` : "");
  }
}

function osv(cfg) {
  const locks = cfg.pnpmProjects.map((d) => path.join(d, "pnpm-lock.yaml")).filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (!locks.length) return record("known vulnerabilities (no lockfile yet)", true);
  for (const lock of locks) {
    const r = run(["tools/osv-check.mjs", lock]);
    const last = (r.stdout ?? "").trim().split("\n").slice(-2).join("\n");
    record(`known vulnerabilities: ${lock}`, r.status === 0, r.status === 0 ? last : `${r.stdout}\n${r.stderr}`.trim());
  }
}

function gateTests() {
  const dir = path.join(ROOT, "tests", "gates");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")) : [];
  if (!files.length) return record("gate tests (none yet)", true);
  const r = run(["--test", ...files.map((f) => path.join("tests", "gates", f))]);
  record("gate tests (tests/gates)", r.status === 0, (r.stdout ?? "").split("\n").filter((l) => /^ℹ (pass|fail)|✖/.test(l)).join("\n"));
}

function updateGolden(cfg) {
  for (const g of cfg.golden) {
    const r = spawnSync(g.command[0] === "node" ? process.execPath : g.command[0], g.command.slice(1), { cwd: path.join(ROOT, g.cwd ?? "."), encoding: "utf8" });
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    const exp = path.join(ROOT, g.expected);
    fs.rmSync(exp, { recursive: true, force: true });
    fs.mkdirSync(exp, { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, g.actual))) fs.copyFileSync(path.join(ROOT, g.actual, f), path.join(exp, f));
  }
  console.log("Golden files updated. Explain the change in the commit message, and commit the golden files with it.");
}

const mode = process.argv[2];
// By file name, so a symlinked or junctioned checkout still runs the checks (a path comparison would skip them).
const isMain = process.argv[1] && path.basename(process.argv[1]) === "check.mjs";
if (isMain) {
  const cfg = config();
  if (mode === "update-golden") updateGolden(cfg);
  else if (["fast", "full", "gate"].includes(mode)) {
    console.log(`checks: ${mode}\n`);
    unitTests(cfg); voiceLint(); guards(cfg); worktreeSetup(); privacy(cfg); secrets();
    if (mode !== "fast") { golden(cfg); osv(cfg); }
    if (mode === "gate") gateTests();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
    process.exit(failed.length ? 1 : 0);
  } else {
    console.error("Usage: node tools/check.mjs <fast|full|gate|update-golden>");
    process.exit(2);
  }
}
