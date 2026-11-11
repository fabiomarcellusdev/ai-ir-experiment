# 0001. pnpm only, pinned and vetted packages, and every install needs the owner's approval

**Status:** Adopted from the template. Record the owner and the date when the project accepts it.

## Context

A package can run code on the machine when it installs (install scripts). A new release of a popular package can be
malicious for a few days before it is found and removed. An old release can have flaws found later. Agents install
packages quickly and without being asked unless something stops them.

**No check makes a package safe.** These rules lower the risk and make each install a visible decision.

## Options

| Option | What it gives | Cost |
|---|---|---|
| A. A written rule only | Simple | Nothing checks it. An agent can forget it. |
| B. A rule, pnpm's safety settings, a vulnerability check, a vetting script, and guard hooks | The package manager refuses young and risky packages; scripts find known vulnerabilities; the hooks hold every install for the owner | Small scripts and their tests to keep |
| C. B plus a private registry proxy that scans packages | Strongest | A service to run |

## Decision

Option B.

1. **pnpm only,** pinned by version and SHA-512 hash in `package.json` (`packageManager`, and
   `devEngines.packageManager` with `onFail: error`, which makes npm refuse to run in the project). Where pnpm is not
   on the path, run it through Corepack (`corepack pnpm`), which checks the hash.
2. **pnpm's settings** (`pnpm-workspace.yaml`): a 60-day minimum release age, strict; `trustPolicy: no-downgrade`;
   no exotic sources for transitive packages; no install scripts; no automatic installs before `pnpm run`, of peer
   dependencies, or of another pnpm version; exact versions; engine checks.
3. **The vulnerability limit:** no known vulnerability above low (`tools/osv-check.mjs`, osv.dev; `pnpm audit` as a
   second source). An unrated advisory counts as a failure.
4. **The security exception:** when the only clean version is younger than 60 days, the owner decides. A yes adds the
   package to `minimumReleaseAgeExclude` with the comment "Remove this entry on or after YYYY-MM-DD";
   `tools/check.mjs` fails after that date.
5. **Vetting before an add:** `tools/vet-package.mjs` checks age, licence, install scripts, known vulnerabilities and
   deprecation, and shows provenance, the publisher and any change of publisher, the maintainers and the dependencies.
   A person or agent adds: why the package is needed, and the same checks for every package it brings in.
6. **Updates by hand only:** once a month, or the same day an advisory names a pinned version. Candidates are 60 days
   old or more; each is researched, reported, and installed only after the owner's yes. No automatic update tool.
   Security alerts that only notify are allowed.
7. **CI is part of the supply chain:** actions are pinned by full commit hash and vetted like packages.
8. **Guard hooks** refuse other package managers and hold every install for the owner (decision 0002).

## Rejected

- **Option A:** a rule nothing checks is a wish.
- **Option C:** a service to run; revisit with outside contributors.
- **`npx only-allow pnpm` as a `preinstall` script:** it downloads a package to stop downloads, and installs run with
  `--ignore-scripts`, so it would not run.

## Limits

- OSV knows only reported vulnerabilities. A new malicious release is not in it; the 60-day age is the guard for that.
- The age rule delays security fixes; the security exception handles that.

## What would reopen this

- pnpm changes the meaning or the default of a setting above.
- A malicious package passes these checks.
- Outside contributors join (option C).

## Amendments

- **2026-11-09, language-neutral** (owner). The template must fit a project in any programming language, but the rules
  above named pnpm only. **Decision:** `AGENTS.md`, "Packages", states the rules in general terms: one package manager
  for each ecosystem, exact pins and a committed lock file, no known vulnerability above low, the 60-day age, no
  install or build scripts where the manager can refuse them, vetting, updates by hand, and the owner's yes for every
  install. `docs/setup-options.md` holds one section for each ecosystem (pnpm, uv and pip, cargo, Go modules, NuGet)
  with its settings; the project copies only its own. pnpm stays the only JavaScript package manager, and the
  template's `package.json` and `pnpm-workspace.yaml` stay in every project. `.claude/hooks/package-guard.mjs` now
  also holds the common install commands of the other ecosystems for the owner. It reads more command forms
  (prefixes with options such as `sudo -E` and `env FOO=1`, `start`, `xargs`, `bash -lc`, `cmd /r`, PowerShell
  without `-Command`, `$x =`, `if` and `do`), which also closes routes past the npm refusal. npm may now run only
  a list of read-only subcommands, so a global option before the subcommand cannot hide an install. **Limits:**
  `tools/osv-check.mjs` reads `pnpm-lock.yaml` only, and `tools/vet-package.mjs` reads the npm registry only; both
  wait until a project needs another ecosystem (`docs/follow-ups.md`). The guard does not hold a build or a run that
  resolves packages by itself, or Maven and Gradle, which fetch on every build. **Rejected:** extend
  `osv-check.mjs` and `vet-package.mjs` now (new parsers and registry clients for ecosystems that no project uses
  yet); keep the pnpm rules in `AGENTS.md` (they load in every session of a project that does not use them).
- **2026-11-10, a short vetting check** (owner). The owner found the rules too slow for this proof-of-concept
  project. **Decision:** vetting is a short check of the licence, install scripts, age and known vulnerabilities
  (`tools/vet-package.mjs`), with a row in `docs/third-party.md`. The `package-guard` hook is removed (decision 0002,
  amendment of 2026-11-10); the settings ask before `pnpm add`, `pnpm install` and `pnpm dlx`, and refuse npm installs,
  npx, Yarn and Bun. The other rules stay: the 60-day age, exact pins and a lock file, no install scripts, no known
  vulnerability above low, and the owner's yes for each install. **Rejected:** a 7-day age (the lead proposed it; the
  owner kept 60 days); installs without the owner's yes (a bad package then runs with no human check).
