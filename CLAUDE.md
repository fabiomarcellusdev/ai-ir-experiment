@AGENTS.md

# Claude Code

`AGENTS.md` above holds every rule. This part adds only what is specific to Claude Code.

## Output

**Every reply is 80% of the way to ASD-STE100.** The project output style `ASD-STE100`
(`.claude/output-styles/asd-ste100.md`, selected by `outputStyle` in `.claude/settings.json`) applies the rules of
`AGENTS.md`, "Writing", to every reply. Output styles do not reach subagents, so each agent file repeats the rules.

## The task pipeline

Run every change with the `task-pipeline` skill (`AGENTS.md`, "The task pipeline"). It automates the work; the owner
approves one prompt to publish the branch and its pull request, then reviews and merges after CI passed.

## Agents (decision 0002)

You are the lead: you wear the hats, talk to the owner and make the edits. Specialists in `.claude/agents/` do work
where independence or a clean context pays:

| Agent | Model | Tools | Use it for |
|---|---|---|---|
| `scout` | Haiku | Read, Grep, Glob | "Where is X": `file:line` answers, so you do not load whole files |
| `researcher` | Sonnet | WebSearch, WebFetch (no file tools) | Sourced research: prior art, specs, changelogs |
| `oracle-writer` | Opus | Read, Write and Edit under `tests/` | Tests and a reference implementation from the spec alone |
| `adversarial-reviewer` | Opus | Read, run tests | A review of each change, not anchored on your reasoning |
| `security-reviewer` | Opus | Read, run tests | The security hat's independent review |
| `bench-runner` | Sonnet | Read, Bash, Write in `docs/measurements/` | Measurements, one at a time, recorded the same way |
| `analysis-checker` | Opus | Read, compute | Recomputes the numbers that decide a gate |

## Skills

`.claude/skills/` holds fixed procedures: `task-pipeline`, `vet-package`, `monthly-update-review`,
`measurement-run`, `gate-check`, `decision-record`, `visual-direction`.

`visual-direction` settles how a user interface looks before it is built: two to four directions drawn on one
Artifact canvas with the real content, rounds of the owner's changes on the chosen one, then a decision record with
the design tokens (`AGENTS.md`, "Structure"). It asks the owner before the first publish to the canvas.

Four more skills are adapted from `mattpocock/skills` (MIT; `.claude/skills/LICENSE.mattpocock-skills.txt`) to the
template's rules (decision 0002, amendment "mattpocock-skills"):
- `grilling`: question the owner in rounds until a plan has no open decision, before a decision record.
- `diagnosing-bugs`: a test command that fails on the bug first, then ranked hypotheses, then a fix with a regression
  test.
- `tdd`: one failing test, then the least code, one slice at a time, with tests that can fail.
- `wait-what` (the owner types `/wait-what`): explain the last message again, in plainer words.

## Plugins

The project enables `frontend-design@claude-plugins-official` (Anthropic's design skill for user interfaces) in
`.claude/settings.json`; Claude Code offers to install it when the project opens. It is one skill, with no hooks, no
MCP server and no scripts. The `visual-direction` skill uses it for every direction it draws. Read a plugin's files
before you add another (decision 0002).

## Guards

- `.claude/hooks/quiet-hours-guard.mjs` (every tool, also in subagents) asks the owner before each action inside the
  quiet hours of `.local/quiet-hours.json`.
- `.claude/hooks/package-guard.mjs` refuses npx, Yarn, Bun and every npm command that is not read-only, and holds
  every install for the owner.
- `.claude/hooks/security-guard.mjs` holds for the owner any command that names a private or secret file, sends data
  to a host outside its allow list, fetches a URL that looks like it carries data, or publishes. It refuses a download
  piped into a shell, and the owner's steps: a merge, an approval, a push to `main`, a force push, a branch deletion,
  `--no-verify`, a changed hooks path or push URL, and the owner's overrides. It parses git and gh the way they read
  their arguments, and looks inside `bash -c` and `cmd /c`. Every publishing step asks, the pipeline's too.
- Every guard hook has `onFailure: "block"`: a crash, a timeout or a missing `node` blocks the call.
- `.claude/settings.json` refuses reads of `.env` files, keys and credential stores, and asks before reading private
  notes, committing, pushing, and editing any guard, agent, skill or check.
- Do not try to work around a held call; explain it to the owner.

## If a secret appears in a Claude Code session

Follow `AGENTS.md`, "If a secret appears": stop, have the owner revoke and rotate it, remove it, check the history.
Then recommend these steps to the owner for the conversation itself:

1. End the session. `/clear` starts a new context, but it deletes no file.
2. Delete the session's transcript. Claude Code keeps each session as a `.jsonl` file under
   `~/.claude/projects/<the project's path, with every character other than a letter or digit as a dash>/` (a session
   in a worktree has its own folder there). The session's file and any folder with the same name hold the secret. The
   newest file there is usually the session that just ended.
3. Check Claude Code's other local copies, and delete the entries that hold the secret. As far as known (2026-11):
   `~/.claude/history.jsonl` (typed prompts), `~/.claude/paste-cache/` (pasted text), `~/.claude/file-history/` (file
   backups for rewind), `~/.claude/tasks/` (agent transcripts and command output) and `~/.claude/shell-snapshots/`.
   The owner searches them; an agent never searches for the secret itself, because the search would repeat it.
4. If the session also ran in the claude.ai app or on the web (remote control), delete the conversation there too.
5. Claude Code also deletes old transcripts by itself after `cleanupPeriodDays` (a setting); a shorter period limits
   what a future leak can expose.

None of this undoes what the model provider received: rotation is the fix.

## Private notes

`CLAUDE.local.md` (git-ignored; Claude Code loads it after this file) holds the owner's machine and personal notes.
`CLAUDE.local.md.example` shows what goes there. Private documents go in `private-docs/` (git-ignored).
