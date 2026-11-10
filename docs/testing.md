# Testing: the checks that must pass at each milestone

A milestone is not reached until every check for it passes. A failing check is fixed or, if it is flaky, quarantined
with a row in `docs/follow-ups.md`. It is never re-run until it passes, and never skipped (`--no-verify`) without the
owner's yes.

One command runs each level: `node tools/check.mjs <fast|full|gate>`, configured by `tools/check.config.json`. It uses
Node's standard library only.

## The milestones

| Milestone | Level | Runs where | What it adds |
|---|---|---|---|
| Every commit | `fast` | `.githooks/pre-commit`, after `git-guard` (no commit on `main`, none in the quiet hours) | Unit tests; voice lint; package and agent guards intact; expired security exceptions; privacy lint; secret scan |
| Every push and pull request | `full` | `.githooks/pre-push`, after `git-guard` (no push to `main`, no deletion, none in the quiet hours); then CI on Windows, macOS and Linux, and once a month | `fast` + golden outputs + known vulnerabilities (osv.dev) |
| Every pull request and push to `main` | Code scanning | GitHub's CodeQL, when the owner turned it on (`SETUP.md`, section 4); the `task-pipeline` skill reads the pull request's open alerts before it hands over | Static analysis for known unsafe patterns (injection, incomplete escaping, unsafe paths) that unit tests and reviews can miss |
| Every merge | The owner's review | GitHub | The owner merges only after the local checks and CI passed (decision 0004) |
| Every phase gate | `gate` | The `gate-check` skill | `full` + the gate tests in `tests/gates/` + the gate's measurement + independent reviews |
| Every release | `gate` + release checks | The release hat | Install the packed artefact in a clean folder and run it; the notices of every shipped dependency |

Turn the git hooks on once per clone: `git config core.hooksPath .githooks`.

## What each check proves, and its negative control

Every check must be able to fail. The negative control is the broken input that shows it does.

| Check | Proves | Negative control |
|---|---|---|
| `package-guard` tests | npx, Yarn, Bun and npm commands that are not read-only are refused; installs wait for the owner | Deny and ask cases (prefixes, wrappers, `bash -c`, `cmd /c`, PowerShell, `$(...)`, quotes, shell grammar), allow cases that must not be blocked, and a timing case for a long command |
| `security-guard` tests | Private files, data sent out, piped installers and publishing wait for the owner | Deny and ask cases (`curl ... \| sh`, `cat .env`, `git push`), and allow cases |
| `osv-check` tests | The lockfile reader finds every package | An empty lockfile; a CRLF lockfile; an unrated advisory counts as a failure |
| `vet-package` tests | Each vetting rule fails when it should | A young version, an install script, an unknown licence, a high advisory, a deprecated version, a publisher change |
| `check` tests | A weakened guard or an expired exception fails `fast` | Eight weakenings (a caret range, a 30-day age, scripts allowed, ...) and a removed hook |
| `worktree` and `main-checkout` tests | The main checkout is found from a worktree in the tool's layout; in a worktree, the push hook finds a private term and the quiet hours apply, both read from the main checkout; a rewritten, redirected or deleted `.git` file, a changed back-link, a junction on the `.worktrees` folder with a decoy record, a decoy `.git` that borrows the real objects and refs, or a copied record as a `.git` folder makes the guards fail closed; `add` refuses a `.worktrees` folder that is a link; `worktree.mjs add` copies the owner's local files, refuses non-task branch names and a fourth worktree; `remove` keeps a worktree with changes; `sync` writes through no link; `check.mjs fast` fails in a worktree that lacks a local file, and on a weakened worktree config | Real worktrees in temporary repositories. Without the main checkout's terms file, the same push passes; the four attack tests fail with a version that trusts the `.git` file, and the decoy tests fail without the `commondir` and borrow checks |
| `quiet-hours` and `git-guard` tests | The quiet hours by time zone and weekday (also past midnight), fail-closed on a bad config; no commit on `main`; in every pushed commit no private file, private term, `.github/` change or non-UTC date; no push to `main`, deletion, rewrite or foreign URL | The edge minutes; daylight-saving cases that a fixed-offset version fails; a bad zone, a BOM; end-to-end runs of `git-guard pre-push` in throwaway repositories |
| Structure checks | Each guard runs as a PreToolUse hook on its tools, as `node <guard>`, blocking on failure; each git hook runs `git-guard` before the checks | A matcher that matches nothing, a hook moved to PostToolUse, a command that only echoes, `onFailure: continue`, a git hook without `git-guard` |
| Voice lint | No banned term from `docs/voice.md` in the docs | A test line with a banned word; a sync test that every banned word is in `docs/voice.md` |
| Privacy lint | No private term in a file that git would publish | Runs where `private-docs/privacy-terms.txt` exists; plant a term in a scratch file to see it fail |
| Secret scan (`secret-scan` tests; `check.mjs`; the push hook) | No key, token, private key or password in a file that git would publish, nor in a line that any pushed commit adds; the output shows only a secret's first 4 characters | One fake of each of 19 formats, built at run time so no test file holds one; quoted and unquoted assignments; placeholders, environment reads and ordinary code that must pass; a 200,000-character hostile line in under a second; a `++ ` line inside a hunk; UTF-16 files; a large file reported; an allow-list entry without a reason; a push whose later commit removes the secret, and a secret in a commit message, are still refused. Five fixes put back one at a time each fail a test (2026-11-08) |
| Golden outputs | Configured outputs are unchanged | Any change to the output; an intended change re-pins with `update-golden` in the same commit |
| Known vulnerabilities | No locked package has a known vulnerability above low | A lockfile with a known-vulnerable version fails the scanner |
| `contrast` tests | The WCAG 2.2 contrast ratio and the 4.5:1 and 3:1 limits | Published values (black on white 21:1; #767676 passes and #777777 fails on white; red, green and blue on white); a dark channel on the linear part of the formula; a ratio of 4.4976:1 that would pass if rounded; #949494 (3.03:1) passes and #959595 (2.995:1) fails the 3:1 limits; a ratio equal to the limit passes; transparent and malformed colours refused; the exit codes. Nine faults put back one at a time each fail a test (2026-11-10) |
| `vet-package-names` tests | No package name changes a URL's host or path; `--min-age-days` is read only when present | `a/b/c`, `../../-/user` and `@scope/..` as names; a package named `5` |
| Code scanning (CodeQL) | No known unsafe pattern that CodeQL can find | The CodeQL alert of 2026-11-07 on the vet tool's URL, in code that the unit tests and the reviews had passed |

## Added by later phases

| Phase | Tests added | Gate test |
|---|---|---|
| <n> | <unit, property, hostile-input and golden tests> | <C<n>: the file in `tests/gates/`> |
