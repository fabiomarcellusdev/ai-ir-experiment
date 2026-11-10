# agentic-project-template

A starting point for software projects built with AI coding agents. It gives a new repository, on day one:

- **Instructions every agent reads.** `AGENTS.md` is tool-neutral (Claude Code, Codex, Cursor, GitHub Copilot, Gemini
  CLI and others). `CLAUDE.md` imports it and adds Claude Code's agents, skills and hooks.
- **Hats:** named areas of expertise that the agent wears, each with rules that a check can fail
  (`docs/hats.md`).
- **A documentation system:** current work, a roadmap with gates fixed before the work, decision records, known gaps,
  measurements, prior art, a third-party register and a writing voice.
- **For any programming language.** Rules for one paradigm, one ecosystem or one kind of project (object-oriented
  design, user interfaces, pnpm, uv, cargo, Go modules, NuGet) are opt-in sections in `docs/setup-options.md`. A
  project copies only the sections that apply, so the others cost no tokens.
- **Supply-chain rules for every ecosystem:** one package manager each, exact pins and a lock file, packages 60 days
  old or more, no known vulnerability above low, no install scripts where the manager can refuse them, and the
  owner's approval for every install. A guard hook holds the common install commands of more than 30 package
  managers and installers.
- **Defences against prompt injection:** agents never hold untrusted input, private data and a way out together;
  guard hooks hold risky commands for the owner; private notes stay out of git.
- **Checks at every milestone:** one command per level (commit, push, phase gate), run by git hooks and by CI on
  Windows, macOS and Linux. Each check has a negative control that shows it can fail.
- **A branch strategy:** a protected `main`, short task branches, squash merges, phases as tags.
- **An automated task pipeline that stops at the owner:** agents branch, build, run every check locally, review,
  push, open a pull request and wait for CI; only the owner approves and merges. Optional quiet hours stop agent work
  at set times unless the owner approves each instance.
- **One writing standard for every output:** 80% of the way to ASD-STE100 (Simplified Technical English), applied to
  every reply by a Claude Code output style.
- **Anthropic's frontend-design plugin,** enabled for the project, and a `visual-direction` procedure: the owner
  chooses a user interface's look from two to four directions drawn with the real content, asks for changes, and
  then records the choice.

Everything runs on Node's standard library. The template installs no package.

## Use it

1. On GitHub, choose **Use this template**, or run
   `gh repo create <owner>/<name> --private --template <owner>/agentic-project-template`.
2. Follow `SETUP.md`. It takes about an hour, most of it writing the project's own hats, roadmap and gates.

## What is inside

| Path | What it is |
|---|---|
| `AGENTS.md` | The rules for every agent and person: hats, packages, agent security, quality rules, writing, branches |
| `CLAUDE.md` | Claude Code: imports `AGENTS.md`; lists the agents, skills and guards |
| `CLAUDE.local.md.example` | What goes in the git-ignored private notes |
| `SETUP.md` | The adoption checklist |
| `.claude/` | Settings, three guard hooks (with tests), seven agents, eleven skills, the ASD-STE100 output style |
| `.githooks/` | The commit hook and the push hook: branch and quiet-hours rules (`git-guard.mjs`), then `check.mjs` |
| `.github/` | CI on three systems, a pull request template, the main-branch ruleset |
| `tools/` | `check.mjs` (milestone checks), `git-guard.mjs`, `quiet-hours.mjs`, `osv-check.mjs` (known vulnerabilities), `github-security-check.mjs` (GitHub's scanners on or off), `vet-package.mjs`, `voice-lint.mjs`, `contrast.mjs` (WCAG contrast of two colours) |
| `package.json`, `pnpm-workspace.yaml` | pnpm pinned by hash, and its supply-chain settings |
| `docs/` | The documentation system, with templates and three adopted decisions |

## Check it

```
node tools/check.mjs fast
```

## Licence

Not chosen yet. A template is most useful with a permissive licence (MIT, or the public-domain CC0 or 0BSD), so that
projects made from it carry no obligation.
