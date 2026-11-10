// package-guard.mjs: a Claude Code PreToolUse hook for the Bash and PowerShell tools.
// It refuses JavaScript package managers other than pnpm. It makes the common commands that install or fetch a
// package, in each ecosystem that it knows (INSTALLS below), wait for the owner's approval.
// Decision record: docs/decisions/0001-supply-chain.md.
//
// Limits (docs/follow-ups.md): it reads the command text only. It splits the command at ; & | ( ) { } and new
// lines. It also checks the text after " -- " (a wrapper such as "lock run -- <command>"), and the command inside
// "bash -c" (also "-lc"), "sh -c", "su -c", "cmd /c" (also /k, /r and "/d/c"), "powershell -Command" (also a
// command with no parameter), "eval", "iex", "env -S", "find -exec", a runner ("poetry run", "pnpm exec") and
// "node npm-cli.js". It removes prefixes such as "sudo -E", "env FOO=1", "nice -n 10", "timeout 60", "$x =", "if"
// and "do", quotes inside a word ("c''argo"), and a brace expansion ("{ci,}"). After a prefix with an option, it also
// judges the first later word that names a package manager. It asks for an encoded PowerShell command, text piped
// into a shell, and a command with more prefixes, nested shells or parts than it reads. A command hidden in a script
// file, an alias, an escape character or a quoted string is not seen. Claude Code's own permission prompt is the
// second line of defence.
//
// Uses Node built-ins only. Exported so that package-guard.test.mjs can test it.

// npm may run only these subcommands (and "npm --version"). Every other subcommand is refused, so a global option
// with a value before the subcommand ("npm --omit dev ci") cannot hide an install. When an option that the guard
// does not know comes before the subcommand, its value can look like a read-only word ("npm --tag run install x"),
// so every later word is checked too (`unsure`).
const NPM_READ = new Set(["", "view", "v", "info", "show", "audit", "ls", "list", "ll", "la", "outdated", "help", "help-search", "search", "s", "se", "find", "explain", "why", "fund", "doctor", "ping", "whoami", "config", "c", "get", "run", "run-script", "rum", "urn", "test", "t", "tst", "start", "stop", "restart", "root", "prefix", "query", "sbom", "diff", "completion", "pkg", "cache"]);
const NPM_INSTALL = /^(install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add|ci|clean-install|install-ci-test|cit|install-test|it|update|up|upgrade|udpate|exec|x|link|ln|rebuild|rb|dedupe|ddp|init|create|innit)$/;

const DENY = [
  [/^(npx|yarn|yarnpkg|bun|bunx|cnpm)$/, () => true, "This project uses pnpm only. Use the pnpm command instead."],
  [
    /^npm$/,
    (sub, pos, unsure) =>
      !NPM_READ.has(sub) ||
      (unsure && pos.some((w) => NPM_INSTALL.test(w))) ||
      (sub === "audit" && pos.includes("fix")) ||
      (/^(config|c)$/.test(sub) && !/^(get|list|ls)?$/.test(pos[1] ?? "")) ||
      (sub === "pkg" && pos[1] !== "get") ||
      (sub === "cache" && !/^(verify|ls)$/.test(pos[1] ?? "")),
    "This project uses pnpm only. npm may only run read-only commands (view, audit, ls, run, test, --version).",
  ],
];

const PNPM_INSTALL = /^(add|install|i|install-test|it|import|update|up|upgrade|dlx|create|fetch|rebuild|rb|dedupe|self-update|setup|env|patch|patch-commit|link|ln|deploy)$/;
// pnpm subcommands that install nothing. For any other first word, or after an option that the guard does not
// know, every later word is checked, so a global option with a value ("pnpm --workspace-concurrency 4 add x")
// cannot hide an install.
const PNPM_OTHER = /^(run|run-script|test|t|tst|exec|list|ls|ll|la|why|outdated|audit|licenses|view|info|show|store|root|bin|config|c|get|set|help|start|publish|pack|remove|rm|uninstall|un|prune|doctor)$/;

const ASK = [
  [
    /^pnpm$/,
    (sub, pos, unsure) =>
      PNPM_INSTALL.test(sub) ||
      (sub === "store" && pos[1] === "add") ||
      ((unsure || !PNPM_OTHER.test(sub)) && pos.some((w) => PNPM_INSTALL.test(w))),
    "This pnpm command can install or fetch packages. The owner approves each install (AGENTS.md, \"Packages\").",
  ],
  [/^(pnpx|corepack)$/, () => true, "This command can download a package or a package manager. The owner approves each install."],
  [/^(winget|choco|scoop)$/, (sub) => /^(install|upgrade|update)$/.test(sub), "This command installs software. The owner approves each install."],
  [/^(install-module|install-package|install-script|update-module)$/, () => true, "This PowerShell command installs a module. The owner approves each install."],
];

// Other ecosystems (decision 0001, amendment "language-neutral"): the common commands that add, install, update or
// fetch a package, a tool or a toolchain. Each entry: the program, its subcommands, and what it installs. A
// subcommand matches at any place after the program, so a global option with a value before it ("cargo --color
// always add") does not hide it; a false match only asks. The search stops at "--" and after a word in STOP
// ("cargo test add" runs a test filter). "a b" matches a with the word b later ("dotnet add App.csproj package X").
// "*" matches every use, and "" matches the program with no subcommand ("bundle").
// Not held (docs/follow-ups.md): a build that resolves packages by itself (cargo build, go build, dotnet build,
// uv run without --with), and Maven and Gradle, which fetch on every build.
const INSTALLS = [
  [/^cargo$/, ["add", "install", "binstall", "update", "upgrade", "fetch", "generate-lockfile"], "a Rust crate"],
  [/^cargo-binstall$/, ["*"], "a Rust crate"],
  [/^rustup$/, ["update", "install", "default", "toolchain install", "toolchain add", "toolchain update", "component add", "target add", "self update"], "a Rust toolchain"],
  [/^go$/, ["get", "install", "mod download", "mod tidy", "mod vendor", "work sync"], "a Go module"],
  [/^dotnet$/, ["add package", "package add", "package update", "restore", "tool install", "tool update", "tool restore", "tool exec", "workload install", "workload update", "workload restore", "new install"], "a .NET package"],
  [/^(dnx|uvx|dx)$/, ["*"], "a package that it then runs"],
  [/^nuget$/, ["install", "restore", "update"], "a NuGet package"],
  [/^gem$/, ["install", "i", "in", "ins", "inst", "insta", "instal", "update", "up", "upd", "upda", "updat", "fetch"], "a Ruby gem"],
  [/^(bundle|bundler)$/, ["", "install", "i", "update", "add", "lock", "cache"], "a Ruby gem"],
  [/^composer$/, ["require", "req", "r", "install", "i", "update", "u", "upgrade", "create-project", "global", "self-update", "selfupdate"], "a PHP package"],
  [/^poetry$/, ["add", "install", "update", "sync", "lock", "self"], "a Python package"],
  [/^pipx$/, ["install", "run", "upgrade", "upgrade-all", "inject", "reinstall", "reinstall-all"], "a Python tool"],
  [/^pip(3(\.\d+)?)?$/, ["install", "download", "wheel"], "a Python package"],
  [/^uv$/, ["add", "sync", "lock", "pip install", "pip sync", "tool install", "tool upgrade", "tool run", "python install", "python upgrade", "self update"], "a Python package"],
  [/^(conda|mamba|micromamba)$/, ["install", "create", "update", "upgrade", "env create", "env update"], "a Conda package"],
  [/^deno$/, ["add", "install", "cache", "x", "upgrade"], "a Deno or npm package"],
  [/^swift$/, ["package resolve", "package update", "package add-dependency"], "a Swift package"],
  [/^pod$/, ["install", "update"], "a CocoaPods package"],
  [/^(dart|flutter)$/, ["pub get", "pub add", "pub upgrade", "pub downgrade", "pub global", "packages get", "packages add", "packages upgrade", "packages downgrade"], "a Dart package"],
  [/^flutter$/, ["upgrade"], "a Flutter SDK"],
  [/^mix$/, ["deps.get", "deps.update", "archive.install", "escript.install", "local.hex", "local.rebar"], "an Elixir package"],
  [/^cabal$/, ["install", "v1-install", "v2-install", "new-install", "update", "get"], "a Haskell package"],
  [/^vcpkg$/, ["install", "upgrade"], "a C or C++ package"],
  [/^conan$/, ["install", "upgrade", "create", "config install"], "a C or C++ package"],
  [/^brew$/, ["install", "upgrade", "reinstall", "bundle", "tap", "fetch"], "a system package"],
  [/^(apt|apt-get)$/, ["install", "reinstall", "upgrade", "dist-upgrade", "full-upgrade", "build-dep", "source"], "a system package"],
];

// Subcommands that run, test, build or show. When one is the first word after the program, the later words are the
// program's own arguments ("cargo test add" runs a test filter). Elsewhere it can be an option's value or a path
// ("dotnet add test package X"), so it does not stop the search.
const STOP = new Set(["run", "test", "build", "exec", "check", "show", "list", "task", "bench", "help"]);

const PYTHON = /^(py|python(3(\.\d+)?)?|pypy3?)$/;
const SHELL = /^(bash|sh|zsh|dash|ksh|ash|fish|su|cmd|powershell|pwsh|eval|iex|invoke-expression)$/;

/** True when a word names a program that this guard refuses or holds. */
function known(name) {
  return [...DENY, ...ASK, ...INSTALLS].some(([prog]) => prog.test(name)) || PYTHON.test(name) || SHELL.test(name);
}

/** The words after the program that are not options, lower-cased, up to "--". Skips option values and "+toolchain". */
function positional(ws) {
  const out = [];
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i];
    if (w === "--") break;
    if (VALUE_OPTIONS.has(w)) i++;
    else if (!w.startsWith("-") && !w.startsWith("+")) out.push(w.toLowerCase());
  }
  return out;
}

const hold = (kind) => `This command can add, install or fetch ${kind}. The owner approves each install.`;

// Go build flags that take a value in the next word ("go run -tags foo x@v1").
const GO_VALUE_FLAGS = /^--?(C|p|o|asmflags|buildmode|compiler|gccgoflags|gcflags|installsuffix|ldflags|mod|modfile|overlay|pgo|pkgdir|tags|toolexec|exec|covermode|coverpkg)$/;

/** The package of "go run [flags] <package> [arguments]", else "". */
function goRunPackage(ws) {
  const run = ws.indexOf("run");
  if (run < 0) return "";
  for (let i = run + 1; i < ws.length; i++) {
    if (!ws[i].startsWith("-")) return ws[i];
    if (GO_VALUE_FLAGS.test(ws[i])) i++;
  }
  return "";
}

/** The reason to hold a command of another ecosystem, else null. `fromStdin`: xargs adds the arguments. */
function otherEcosystem(ws, fromStdin = false) {
  const all = positional(ws);
  // A run of a remote package fetches it: "go run x@v1", "deno run npm:x", "uv run --with x".
  if (ws[0] === "go" && goRunPackage(ws).includes("@")) return hold("a Go module");
  const run = all.indexOf("run");
  if (ws[0] === "deno" && run >= 0 && all.slice(run + 1).some((w) => /^(npm:|jsr:|https?:)/.test(w))) return hold("a Deno or npm package");
  if (ws[0] === "uv" && run >= 0 && ws.some((w) => /^--with(-requirements|-editable)?(=|$)/.test(w))) return hold("a Python package");
  const pos = STOP.has(all[0]) && !subcommand(ws).unsure ? all.slice(0, 1) : all;
  for (const [prog, subs, kind] of INSTALLS) {
    if (!prog.test(ws[0])) continue;
    if (fromStdin) return hold(kind);
    for (const s of subs) {
      const [a, b] = s.split(" ");
      if (a === "*" || (a === "" && pos.length === 0)) return hold(kind);
      const at = a ? pos.indexOf(a) : -1;
      if (at >= 0 && (!b || pos.slice(at + 1).includes(b))) return hold(kind);
    }
  }
  return null;
}

// Prefixes that run the next word as the program, with their options that take a value. Shell keywords and "start"
// (cmd and PowerShell) are here too.
const PREFIXES = {
  sudo: ["-a", "-c", "-u", "-g", "-C", "-D", "-h", "-p", "-r", "-R", "-t", "-U", "-T", "--user", "--group", "--host", "--prompt", "--chdir", "--chroot", "--close-from", "--role", "--type", "--other-user", "--command-timeout", "--login-class"],
  doas: ["-a", "-u", "-C"],
  env: ["-u", "-C", "-P", "--unset", "--chdir"],
  time: ["-f", "-o", "--format", "--output"],
  nice: ["-n", "--adjustment"],
  nohup: [],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  command: [],
  builtin: [],
  coproc: [],
  busybox: [],
  exec: ["-a"],
  start: ["/d", "-WorkingDirectory", "-wd", "-Verb", "-WindowStyle", "-ArgumentList", "-Args"],
  "start-process": ["-WorkingDirectory", "-wd", "-Verb", "-WindowStyle", "-ArgumentList", "-Args"],
  saps: ["-WorkingDirectory", "-wd", "-Verb", "-WindowStyle", "-ArgumentList", "-Args"],
  xargs: ["-I", "-J", "-R", "-S", "-n", "-P", "-L", "-s", "-d", "-E", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file", "--replace", "--max-lines", "--max-chars", "--eof", "--process-slot-var"],
  "!": [], if: [], then: [], else: [], elif: [], do: [], while: [], until: [], try: [], finally: [],
};

/** A program name without its folder, its file extension and its case: "C:\x\npm.cmd" gives "npm". */
const programName = (t) => t.split(/[\\/]/).pop().replace(/\.(cmd|exe|ps1|bat|js|mjs|cjs)$/i, "").toLowerCase();

const MAX_ROUNDS = 32;
const ASSIGN_OP = /^(\?\?|[-+*/%])?=$/;
// A PowerShell variable or target: "$x", "${x}", "$a[0]", "$x.y", "[string]$x".
const PS_TARGET = /^(\[[^\]]*\])*\$\S*$/;
const BRACES = /\{([^{},\s]*),[^{}\s]*\}/g;

/**
 * Reads one command segment. Removes variables, prefixes and their options, PowerShell assignments and quotes.
 * Returns { ws, also, texts, fromStdin, unclear }:
 * - ws: the words, with the program first.
 * - also: after a prefix with an option, or after "start", the first later word that names a known program, as
 *   { ws, weak }. An option that the guard does not know can take the real program's place ("start "" npm ci",
 *   "sudo -Z x npm ci"). The list only asks (weak is true), because the word is more likely an argument
 *   ("sudo -u bob grep npx"). The one exception: the word directly after cmd's "start "title"" can refuse.
 * - texts: command texts to judge ("env -S").
 * - fromStdin: xargs adds the arguments.
 * - unclear: a reason to ask (more prefixes than the guard reads, a brace expansion on a known program).
 */
function parse(segment) {
  const s = segment.trim().replace(/^[&@({]+\s*/, "");
  // A word may join quoted and plain parts ("c''argo", FOO="a b"); each part's quotes are removed. A brace expansion
  // gives its first word ("npm {ci,}" runs "npm ci").
  const out = { ws: [], also: [], texts: [], fromStdin: false, unclear: null };
  let braces = false;
  const raw = (s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((w) => {
    // One level of quotes, as a shell removes it: "bash -c \"env -S 'npm ci'\"" keeps the inner quotes.
    const unquoted = w.replace(/"([^"]*)"|'([^']*)'/g, (_, d, q) => d ?? q);
    const expanded = unquoted.replace(BRACES, (_, firstWord) => { braces = true; return firstWord; });
    return expanded.replace(/[)}]+$/, "");
  });
  let i = 0, first = -1, unsure = false, last = "";
  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) {
      out.unclear = "This command has more prefixes than the guard reads. The owner approves it.";
      return out;
    }
    const w = raw[i] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; } // FOO=1 cmd
    // PowerShell assignment: "$x = npm ci", "${x} = ...", "[string]$x = ...", "$x ??= ...", "$x=npm ci".
    if (PS_TARGET.test(w) && ASSIGN_OP.test(raw[i + 1] ?? "")) { i += 2; continue; }
    if (ASSIGN_OP.test(w) && i + 1 < raw.length) { i++; continue; } // the rest of "${x} = ..." after a split
    const glued = /^(?:\[[^\]]*\])*\$[^=\s]*?(?:\?\?|[-+*/%])?=(.+)$/.exec(w);
    if (glued) { raw[i] = glued[1]; continue; }
    const prefix = programName(w);
    const opts = Object.hasOwn(PREFIXES, prefix) ? PREFIXES[prefix] : null;
    if (!opts || i + 1 >= raw.length) break; // a prefix alone is the program itself
    if (prefix === "command" && /^-[pvV]*[vV][pvV]*$/.test(raw[i + 1])) break; // "command -v npx" only looks it up
    last = prefix;
    if (prefix === "xargs") out.fromStdin = true;
    i++;
    if (first < 0) first = i;
    const windows = /^(start|start-process|saps)$/.test(prefix); // PowerShell names ignore case; cmd uses "/b"
    if (windows) unsure = true; // cmd's start takes a quoted title first
    while (i < raw.length && (raw[i].startsWith("-") || (windows && raw[i].startsWith("/")))) {
      const o = raw[i++];
      if (o === "--") break;
      unsure = true;
      const split = prefix === "env" && /^(?:-[iv0]*S|--split-string=?)(.*)$/.exec(o); // "-S", "-iS", "-vS'npm ci'"
      if (split) {
        // env splits the value into words and adds the later words: the whole rest is one command.
        out.texts.push([split[1], ...raw.slice(i)].filter(Boolean).join(" "));
        i = raw.length;
        break;
      }
      // A value option, alone or as the last letter of a group ("sudo -nu root").
      const last = /^-[A-Za-z]{2,}$/.test(o) ? `-${o.at(-1)}` : o;
      if (opts.some((v) => v === o || v === last || (windows && v.toLowerCase() === o.toLowerCase()))) i++;
    }
    if (prefix === "timeout" && i + 1 < raw.length) i++; // timeout's duration: "60", "1.5m", ".5", "inf"
  }
  out.ws = raw.slice(i).map((t, k) => (k === 0 ? programName(t) : t)); // options keep their case: pnpm's -F is not -f
  if (braces && known(out.ws[0] ?? "")) out.unclear = "This command has a brace expansion that the guard does not read. The owner approves it.";
  if (first >= 0 && (unsure || out.ws[0] === "")) {
    for (let k = first; k < raw.length; k++) {
      if (k === i || !known(programName(raw[k]))) continue;
      out.also.push({ ws: [programName(raw[k]), ...raw.slice(k + 1)], weak: !(k === i + 1 && /^(start|start-process|saps)$/.test(last)) });
      break; // one list: more would make a long command slow
    }
  }
  return out;
}

// Options that take a value in the next word ("pnpm --dir x install", "npm --prefix x ci").
const VALUE_OPTIONS = new Set(["-C", "--dir", "--filter", "-F", "--prefix", "--workspace", "--registry", "--loglevel", "--reporter", "--config", "--userconfig", "--cache", "--store-dir"]);

/**
 * The first word that is not an option, after the program name ("npm -g install x" gives "install"), and `unsure`:
 * an option that the guard does not know came before it, so the "subcommand" can be that option's value.
 */
function subcommand(ws) {
  let unsure = false;
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i];
    if (VALUE_OPTIONS.has(w)) i++; // skip the option's value
    else if (w.startsWith("-")) unsure ||= !w.includes("=");
    else return { sub: w.toLowerCase(), unsure };
  }
  return { sub: "", unsure };
}

/** Python's "python -m <module> ...": judged as the module run as a program ("python3.12 -Im pip install x"). */
function pythonModule(ws, fromStdin) {
  if (!PYTHON.test(ws[0] ?? "")) return null;
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i];
    if (w === "-c" || w === "-" || !w.startsWith("-")) return null; // code or a script file
    const m = /^-[bBdEhiIOPqsSuvx]*m(.*)$/.exec(w);
    if (m) {
      const mod = m[1] || ws[i + 1];
      return mod ? otherEcosystem([mod.toLowerCase(), ...ws.slice(m[1] ? i + 1 : i + 2)], fromStdin) : null;
    }
    if (/^-[XW]$/.test(w)) i++;
  }
  return null;
}

/**
 * Splits a command line at ; & | new lines, $( and backticks, but not inside quotes. With `groups`, it also splits
 * at ( ) { }, so that "if ($x) { npm ci }" and "[void](npm ci)" give a segment that starts with the program. It does
 * not split "{}", "${x}" or a brace expansion ("{ci,}"), which stay inside their word.
 */
function splitOutsideQuotes(command, groups) {
  const parts = [];
  let cur = "", quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    // Bash runs $( ) and backticks inside double quotes, so those still split there.
    const substitution = c === "`" || (c === "$" && command[i + 1] === "(");
    if (quote === '"' && substitution) { parts.push(cur); cur = ""; continue; }
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (groups && c === "{") {
      const j = command.slice(i, i + 256).indexOf("}"); // a bounded look: a long command stays linear
      const inside = j > 0 ? command.slice(i + 1, i + j) : null;
      if (inside !== null && (inside === "" || command[i - 1] === "$" || (inside.includes(",") && !/[\s;|&(){}]/.test(inside)))) {
        cur += command.slice(i, i + j + 1);
        i += j;
        continue;
      }
    }
    // "2>&1" and "&>" are redirections, not separators. Only the character before is tested: a test of the whole
    // text, or of the last character of a long joined string, makes a long command slow.
    const redirect = c === "&" && (/[<>0-9]/.test(command[i - 1] ?? "") || command[i + 1] === ">");
    if (!redirect && (substitution || ";&|\n".includes(c) || (groups && "(){}".includes(c)))) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

/** The segments of a command line. security-guard.mjs uses it without `groups`. */
export function segments(command, { groups = false } = {}) {
  const parts = splitOutsideQuotes(command, groups);
  const out = [];
  for (const p of parts) {
    out.push(p);
    const at = p.lastIndexOf(" -- ");
    if (at >= 0) out.push(p.slice(at + 4));
  }
  return out.filter((p) => p.trim());
}

const ENCODED = Symbol("encoded");
const STDIN = Symbol("stdin");

// PowerShell parameters that take a value, as [full name, shortest prefix], and their aliases.
const PS_VALUES = [["executionpolicy", 3], ["windowstyle", 2], ["version", 2], ["inputformat", 3], ["outputformat", 2], ["configurationname", 4], ["workingdirectory", 2], ["psconsolefile", 2], ["settingsfile", 2], ["custompipename", 2]];
const PS_VALUE_ALIASES = new Set(["ex", "ep", "w", "wd", "v", "inp", "if", "o", "of", "config"]);
const isPrefix = (name, full, min) => name.length >= min && full.startsWith(name);
const STDIN_FILES = new Set(["-", "/dev/stdin", "/proc/self/fd/0"]);

/**
 * The command text that a shell runs: "bash -c '...'", "su -c", "cmd /c", "powershell -Command" or a PowerShell
 * command with no parameter, "eval", "iex -Command". ENCODED for an encoded PowerShell command. STDIN for a shell
 * that reads its input ("bash -s", "cmd", "powershell -Command -"). Else null.
 */
function innerCommand(ws) {
  const prog = ws[0] ?? "";
  if (/^(eval|iex|invoke-expression)$/.test(prog)) {
    const from = /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(ws[1] ?? "") ? 2 : 1;
    return ws.length > from ? ws.slice(from).join(" ") : null;
  }
  if (/^(bash|sh|zsh|dash|ksh|ash|fish|su)$/.test(prog)) {
    // A POSIX shell takes -c inside a group of short options ("bash -lc", "sh -xc").
    const at = ws.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w));
    if (at < 0) {
      if (prog === "su") return null;
      if (ws.some((w, i) => i > 0 && /^-[a-z]*s[a-z]*$/.test(w))) return STDIN; // "bash -s arg"
      const script = ws.find((w, i) => i > 0 && (STDIN_FILES.has(w) || !/^[-+]/.test(w)));
      if (script) return STDIN_FILES.has(script) ? STDIN : null;
      return ws.some((w) => /^--(version|help)$/.test(w)) ? null : STDIN;
    }
    let k = at + 1;
    while (k < ws.length && /^[-+]/.test(ws[k])) k++; // "bash -c -- cmd", "bash -c -x cmd"
    return k < ws.length ? ws.slice(k).join(" ") : null;
  }
  if (prog === "cmd") {
    for (let i = 1; i < ws.length; i++) {
      // "/c", "/k", "/r", "/cnpm install", and switches joined before it ("/d/c", "/q/c").
      const m = /^(?:\/(?![ckr])[^/\s]*)*\/[ckr](.*)$/i.exec(ws[i]);
      if (m) return [m[1], ...ws.slice(i + 1)].join(" ").trim() || null;
    }
    return STDIN;
  }
  if (/^(powershell|pwsh)$/.test(prog)) {
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i];
      if (w === "-") return STDIN;
      if (!/^[-/]/.test(w)) return ws.slice(i).join(" "); // Windows PowerShell runs words with no parameter
      const name = w.slice(1).toLowerCase();
      if (isPrefix(name, "command", 1) || name === "cwa" || isPrefix(name, "commandwithargs", 8)) {
        if (ws[i + 1] === "-") return STDIN;
        return i + 1 < ws.length ? ws.slice(i + 1).join(" ") : null;
      }
      if (name === "e" || name === "ec" || name === "ea" || isPrefix(name, "encodedcommand", 2) || isPrefix(name, "encodedarguments", 8)) return ENCODED;
      if (isPrefix(name, "file", 1)) return ws[i + 1] === "-" ? STDIN : null;
      if (PS_VALUE_ALIASES.has(name) || PS_VALUES.some(([full, min]) => isPrefix(name, full, min))) i++;
    }
    return STDIN;
  }
  return null;
}

// Programs that a script file runs ("node .../npm/bin/npm-cli.js ci").
const SCRIPT_NAMES = { "npm-cli": "npm", "npx-cli": "npx" };

const TOO_DEEP = "This command nests shells too deeply to check. The owner approves it.";
const TOO_MANY = "This command is too complex for the guard to check. The owner approves it.";
let budget = 0; // decide() calls left for one top-level command

/** Judges a command text one level deeper. Returns { decision, reason }. */
function deeper(text, depth) {
  if (depth >= 4) return { decision: "ask", reason: TOO_DEEP };
  return judge(text, depth + 1);
}

/** The decision for one list of words: { decision, reason }, or null when it allows. */
function decide(ws, depth, fromStdin, piped) {
  if (--budget < 0) return { decision: "ask", reason: TOO_MANY };
  let ask = null;
  const take = (r) => {
    if (r?.decision === "deny") return r;
    if (r?.decision === "ask") ask ??= r.reason;
    return null;
  };
  const inner = innerCommand(ws);
  if (inner === ENCODED) ask = "This command runs an encoded PowerShell command that the guard cannot read. The owner approves it.";
  else if (inner === STDIN) {
    if (piped) ask = "This command sends text into a shell that the guard cannot read. The owner approves it.";
  } else if (inner) {
    const r = take(deeper(inner, depth));
    if (r) return r;
  }
  // "find . -exec npm ci ;" runs the words after -exec.
  const exec = ws[0] === "find" ? ws.findIndex((w) => /^-(exec|execdir|ok|okdir)$/.test(w)) : -1;
  if (exec > 0) {
    const r = take(deeper(ws.slice(exec + 1).filter((w) => !/^(\{\}|\\?;|\+)$/.test(w)).join(" "), depth));
    if (r) return r;
  }
  // "node path/npm-cli.js ci" is npm.
  if (ws[0] === "node" && ws[1] && !ws[1].startsWith("-")) {
    const name = SCRIPT_NAMES[programName(ws[1])] ?? programName(ws[1]);
    if (known(name)) {
      const r = take(decide([name, ...ws.slice(2)], depth + 1, false, piped));
      if (r) return r;
    }
  }
  const { sub, unsure } = subcommand(ws), pos = positional(ws);
  for (const [prog, test, reason] of DENY) if (prog.test(ws[0]) && (fromStdin || test(sub, pos, unsure))) return { decision: "deny", reason };
  for (const [prog, test, reason] of ASK) if (prog.test(ws[0]) && (fromStdin || test(sub, pos, unsure))) ask ??= reason;
  ask ??= pythonModule(ws, fromStdin);
  ask ??= otherEcosystem(ws, fromStdin);
  // A runner runs a command: "poetry run pip install x", "pnpm exec cargo install x", "conda run -n e pip install".
  // The words after run or exec and its options are judged as a command. The depth limit and the budget bound it.
  const runAt = ws.findIndex((w, k) => k > 0 && /^(run|exec)$/i.test(w));
  if (runAt > 0) {
    let k = runAt + 1;
    while (k < ws.length && ws[k].startsWith("-")) k += VALUE_OPTIONS.has(ws[k]) ? 2 : 1;
    if (k < ws.length) {
      // The quotes were removed; put them back around a word with a space or a shell character ("env -S 'npm ci'",
      // "rg 'npx|yarn'").
      const quote = (w) => (/^[\w@%+=:,./\\-]*$/.test(w) ? w : w.includes("'") ? `"${w}"` : `'${w}'`);
      const r = take(deeper(ws.slice(k).map(quote).join(" "), depth));
      if (r) return r;
    }
  }
  return ask ? { decision: "ask", reason: ask } : null;
}

/** Returns { decision: "deny" | "ask" | "allow", reason } for one command line. */
export function judge(command, depth = 0) {
  if (depth === 0) budget = 2000;
  let ask = null;
  const piped = /[|<]/.test(command);
  for (const seg of segments(command, { groups: true })) {
    const p = parse(seg);
    ask ??= p.unclear;
    const lists = [{ ws: p.ws, weak: false, stdin: p.fromStdin }, ...p.also]; // xargs adds arguments to its program only
    for (const { ws, weak, stdin } of lists) {
      if (!ws.length) continue;
      const r = decide(ws, depth, Boolean(stdin), piped);
      if (r?.decision === "deny" && !weak) return r;
      if (r) ask ??= r.reason;
    }
    for (const text of p.texts) {
      const r = deeper(text, depth);
      if (r.decision === "deny") return r;
      if (r.decision === "ask") ask ??= r.reason;
    }
  }
  return ask ? { decision: "ask", reason: ask } : { decision: "allow", reason: "" };
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const command = JSON.parse(input)?.tool_input?.command;
  if (typeof command !== "string") return;
  const { decision, reason } = judge(command);
  if (decision === "allow") return; // no output: Claude Code's normal permission flow decides
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: `package-guard: ${reason}` },
    }),
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((e) => {
    process.stderr.write(`package-guard failed: ${e.message}\n`);
    process.exit(1);
  });
}
