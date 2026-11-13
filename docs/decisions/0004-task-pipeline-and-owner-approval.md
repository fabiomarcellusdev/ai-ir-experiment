# 0004. The task pipeline, the owner's approval, local checks first, and quiet hours

**Status:** Adopted from the template. Record the owner and the date when the project accepts it.

## Context

1. Agents should do as much of the work as they safely can.
2. A pull request is merged only with the owner's explicit approval, after every local check and every CI check passed.
3. Every check runs locally before a branch is pushed for CI.
4. The owner may set quiet hours: no work inside them unless the owner approves each instance.
5. Every output is 80% of the way to ASD-STE100.

Working hours and time zones are personal details, and the repository may be public.

## Options

| Option | What it gives | Cost |
|---|---|---|
| A. Rules in the instruction files only | Simple | Nothing enforces them |
| B. A pipeline skill, guards in Claude Code, and the same rules in git hooks | Automation up to the pull request; the owner's steps refused to agents; the branch and time rules enforced by git for every tool | Two small scripts, a hook and their tests |
| C. B plus a bot account that opens pull requests | GitHub can then require the owner's formal review, because an author cannot approve their own pull request | A second account and its token to keep safe |

## Decision

Option B; option C stays open.

1. **The pipeline** (`AGENTS.md`, "The task pipeline"; the `task-pipeline` skill): quiet-hours check, task branch,
   build, every check locally, independent review, commit, push, pull request, CI on three systems, a report to the
   owner. It stops there.
2. **The owner's approval is the merge.** Agents never merge, approve, turn on auto-merge, push to `main`, or rewrite
   or delete a pushed branch. The security guard refuses these commands; `.claude/settings.json` denies `gh pr merge`
   and force pushes; the git hooks refuse commits and pushes to `main`. Set the repository to squash merges only,
   delete merged branches, and keep auto-merge off. Branch protection (`.github/rulesets/protect-main.json`) requires
   CI on all three systems before a merge.
3. **Local checks first:** the push hook runs `tools/git-guard.mjs pre-push`, then `check.mjs full`, before CI sees
   the branch. git-guard checks every pushed commit: no private or secret file, no private term in an added line, no
   `.github/` change without the owner's override (CI runs workflow files with the repository's token), UTC dates, a
   fast-forward, and the pinned repository URL (`tools/git-guard.config.json`).
4. **One approval to publish:** the pipeline runs the push of the task branch and `gh pr create` as one command, and
   the owner approves it with one prompt. That prompt is the checkpoint before anything leaves the machine. A
   prompt-free push was rejected: it would give an agent that reads untrusted text a silent way to send data out, and
   GitHub keeps a pull request's commits even after a squash merge.
5. **Quiet hours** live in `.local/quiet-hours.json` (git-ignored), never in a tracked file. `tools/quiet-hours.mjs`
   uses an IANA time zone, so daylight-saving changes are handled. Inside the hours, the `quiet-hours-guard` hook asks
   before each tool call (in the main session and in subagents), and the git hooks refuse commits and pushes unless
   `QUIET_HOURS_APPROVED=1` is set for that one command. An invalid file counts as quiet; no file means no quiet hours.
6. **Writing:** the output style `ASD-STE100` applies the rules to every reply; each agent file repeats them.
7. **Other AI tools:** the git hooks and CI enforce the branch rules, the quiet hours and the checks for every tool and
   every person.

## Rejected

- **Option A:** a rule nothing enforces is a wish.
- **Requiring an approving review while the owner's account opens the pull requests:** nothing could merge without a
  bypass.
- **Quiet hours in a tracked file:** they would become public.

## Limits

- The hooks read command text; a command hidden in a script file passes them. The git hooks run on local machines
  only; CI and branch protection are the server-side layer.
- The override variables guard against mistakes, not against a hostile process. The security guard refuses them to
  agents in Claude Code; another tool's agent is limited only by the server side.
- The privacy check of pushed commits finds the listed terms only; encoded text passes it.
- Commit dates are UTC, but commit times still show working patterns.
- An output style is an instruction, not a guarantee.

## How this design was tested

Before it was adopted, two independent reviews (an adversarial reviewer and a security reviewer) attacked the first
draft. They found owner-only commands in other spellings (`git -C . push`, `bash -c`, `gh pr -R o/r merge`, gh
aliases, `gh api` writes), a secret published through `gh pr create --body-file .env`, overrides set by the agent,
hooks that failed open, and time-zone details in messages and commit dates. Each finding is now a test.

## What would reopen this

- The owner wants GitHub to record formal approvals (option C).
- A tool the owner uses does not run git hooks.

## Amendments

- **2026-11-10, the guard hooks are removed** (owner; decision 0002, amendment of 2026-11-10). These statements above
  no longer hold: "The security guard refuses these commands" (Decision, 2); the quiet-hours hook's ask before each
  tool call (Decision, 5; the git hooks still refuse commits and pushes in the hours); "The security guard refuses
  them to agents" for the override variables (Limits); and "Each finding is now a test" (How this design was tested:
  the hook tests are deleted). The deny rules in `.claude/settings.json` still refuse `gh pr merge` and force pushes
  in their plain spelling, and the git hooks still refuse commits and pushes on `main`.
- **2026-11-10, one work branch per milestone** (owner). The owner found one branch and one pull request for each
  small change too slow. **Decision:** the work for one milestone goes on one work branch. Each task still runs the
  quiet-hours check, the local checks and the independent review, and ends with a local commit. The push, the pull
  request, CI and the owner's merge happen once, at a significant milestone (for example a gate result or a go or
  no-go decision). **What is lost:** CI runs less often, so a failure on macOS or Linux shows later; and a pull request
  is larger to review. **Rejected:** a pull request for each task (the old rule; too slow for the owner).
