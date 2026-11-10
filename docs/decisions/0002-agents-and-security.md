# 0002. The agent setup, and the defences against prompt injection

**Status:** Adopted from the template. Record the owner and the date when the project accepts it.

## Context

1. **Every agent costs tokens.** A sub-agent reads its own context again, and its report drops detail. An agent earns
   its place by what it gives for its cost.
2. **Prompt injection is the main agent risk.** A project reads untrusted text all the time: web pages, package
   metadata, issues, outside repositories, model output. Text can carry instructions. An attack needs three things
   together: **untrusted input**, **access to private data**, and **a way to send data out**. The defence is to never
   give one agent all three, and to make each risky action visible to the owner.

## Options

| Option | What it gives | Cost |
|---|---|---|
| A. One agent per hat | Clear roles | Many times the tokens; hat conflicts settled in handoffs nobody sees |
| B. One lead that wears the hats, and a few specialists where independence or a clean context pays | Independent tests and reviews; research kept out of the lead's context | Seven agent files and five skills to keep |
| C. The lead alone | Cheapest | No independent oracle or review |

## Decision

Option B.

### The specialists (`.claude/agents/`)

| Agent | Tools | Untrusted input | Private data | Way out |
|---|---|---|---|---|
| `scout` | Read, Grep, Glob | Repository files | Told not to read | None |
| `researcher` | WebSearch, WebFetch | Web pages | **None (no file tools)** | Web |
| `oracle-writer` | Read, Write, Edit (under `tests/`) | Spec and tests | Told not to read | None |
| `adversarial-reviewer` | Read, Bash | The diff | Told not to read | Shell, told: no network |
| `security-reviewer` | Read, Bash | The diff | Told not to read | Shell, told: no network |
| `bench-runner` | Read, Bash, Write | Script output | Told not to read | Shell, told: named scripts only |
| `analysis-checker` | Read, Bash | Raw results | Told not to read | Shell, told: compute only |

A package-vetting agent was rejected: it would hold untrusted registry text and a shell together. A script
(`tools/vet-package.mjs`) does the checks with no model in the loop.

### The defences

| Layer | What it does |
|---|---|
| Separation | No agent holds untrusted input, private data and a way out together |
| Package guard | Refuses npm installs, npx, Yarn and Bun; holds every install for the owner |
| Security guard | Holds for the owner: a command that names a private or secret file; one that sends data to a host outside the allow list; a fetch whose URL looks like it carries data; publishing. Refuses a download piped into a shell. Fails closed. |
| Permission rules | Refuse reads of `.env` files, keys and credential stores; ask before reading private notes, committing, pushing, and editing the guards, agents, skills, checks and pnpm's settings |
| Text is data | Every agent file and `AGENTS.md` say it; suspected injections are reported with their location |
| Outside data | Fetched by version into a folder outside the repository; its scripts never run |
| Machine checks | `tools/check.mjs` at every commit, push and gate; a weakened guard fails it |
| Private notes | `CLAUDE.local.md` and `private-docs/` are git-ignored; the privacy lint fails if a private term reaches a tracked file |
| Plugins | Read before install; narrowest scope; hooks or servers only with the owner's yes |

## Rejected

- **Option A** and **option C:** see the table.
- **Detecting injection by pattern-matching text:** easy to evade and noisy. Limiting what each agent can do is
  stronger. The guards hold actions, not words.

## Limits

- The hooks read command text. A command inside a script file, an alias or an encoded string is not seen.
- An agent with a shell can do anything the shell can; its instructions, the guards and the owner's prompts limit it.
  A command sandbox would add a hard limit.
- The lead holds untrusted input, private data and a way out. It is the trust anchor, and the guards make its risky
  actions visible.
- Other AI tools do not run Claude Code's hooks. For them, the git hooks, CI and `AGENTS.md` are the shared layers.
- No hook or rule replaces a real security review before a public release.

## What would reopen this

- A suspected or real prompt injection.
- An agent whose cost is higher than its value in practice.
- A command sandbox that works with the project's tools.

## Amendments

- **2026-11-08, mattpocock-skills** (owner, from a project made from this template). The owner asked to install the plugin
  `mattpocock-skills` 1.3.1 (27 skills, MIT). Two `security-reviewer` agents first read every file the plugin would
  install, as `AGENTS.md`, "Agents and security", 8 requires. They found no hidden instruction, but many conflicts:
  11 skills start without a command, and some of them read and write `.env` secrets, combine web input with file
  tools, write a second decision folder, or advise deleting prohibitions from `AGENTS.md`; others, on command, run a
  stranger's pull request, commit to the current branch, merge, or push without asking. The plugin installs as one
  unit, its npm lockfile makes Claude Code run an npm install that no setting stops (against decision 0001), and its
  marketplace updates it without a review. **Decision:** do not install it. Four skills (`grilling`,
  `diagnosing-bugs`, `tdd`, `wait-what`) are adapted into `.claude/skills/` under the MIT licence, changed where they
  conflicted with the template's rules, and reviewed like any other change.
  **Rejected:** the install with a rule that the template's rules win (the automatic skills still start on ordinary
  tasks); no copy at all (it loses methods that fit any project).
- **2026-11-08, secrets and the agent roster** (owner, from a project made from this template). The owner asked for an
  agent that checks every change for exposed secrets. **Decision:** a script, not an agent (`tools/secret-scan.mjs`, in
  `check.mjs` and the push hook, so CI covers each pull request). A machine checks first: the formats are well known, a
  script finds them the same way every time, and an agent would have to read the secret, which copies it into its
  transcript and to the model provider. `AGENTS.md`, "If a secret appears", sets the response: stop, rotate first,
  remove, check the history, then delete the conversation as a partial last step. The owner also asked that the lead
  offer considerations about the agent roster at setup and at each phase gate (`AGENTS.md`, "Agents and security",
  10); the owner decides, and no agent changes without the owner's yes.
- **2026-11-09, design rules and setup options** (owner). The owner wants the template to fit a project in any
  programming language, and asked which named software principles to adopt. **Decision:** six language-neutral rules
  join `AGENTS.md`, each with a check: no dependency cycles, build only what the current task needs, the rule of
  three, find why before you remove, fail fast, and idempotent repeatable operations. Rules for one paradigm or one
  ecosystem move to `docs/setup-options.md`, which sessions do not load; at setup and at each phase gate, the lead
  offers the sections whose trigger matches, and the owner approves each one. The first section is "Object-oriented
  design" (the owner set the inheritance depth at 4). The `adversarial-reviewer` agent checks the new rules, the
  `decision-record` skill asks for each option's cost to maintain, and an operations hat waits for the first deployed
  service. **Rejected:** the object-oriented rules in `AGENTS.md` for the owner to delete at setup (every project
  pays their tokens until someone deletes them); Postel's law (it conflicts with the security hat); the Boy Scout rule
  (it conflicts with one concern a commit); a long list of principles without checks (an agent cannot fail an
  attitude).
- **2026-11-10, user interface rules** (owner). The owner asked whether to adopt `nextlevelbuilder/ui-ux-pro-max-skill`
  (MIT). It is a design skill with a library of styles, palettes and font pairings in CSV files and a Python search
  script. It also has six more skills and an npm installer. **Decision:** adapt its measurable rules, not the skill.
  `docs/setup-options.md` gains a "User interfaces" section, triggered by a graphical user interface, with each rule's primary source (WCAG
  2.2, Apple, Android, axe, web.dev, Nielsen) and a check. `tools/contrast.mjs` computes the WCAG contrast ratio, so
  "check the contrast with a script" has a script. **Rejected:** installing the skill. Its install routes need the
  owner's yes under decision 0001, and the CLI's dependencies and most scripts were not read. Its catalogue of named
  styles works against the `frontend-design` skill, which forbids generic defaults. It cites no sources, and its text
  has visible errors (a duplicated frontmatter block, an empty heading, a rule its own example breaks). No text or
  data was copied from it.
