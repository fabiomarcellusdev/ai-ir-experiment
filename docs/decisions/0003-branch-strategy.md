# 0003. Branch strategy: a protected main, short task branches, tags for phases

**Status:** Adopted from the template. Record the owner and the date when the project accepts it.

## Context

A small team, often one owner, works with AI agents. Phases last weeks. `main` must stay green, and commits must be
small with one concern each. A long-lived phase branch collects weeks of changes, so its pull request is too large to
review, and problems surface late.

## Options

| Option | What it gives | Cost |
|---|---|---|
| A. A branch per phase | One branch to think about | Pull requests of weeks of work; late conflicts |
| B. Trunk-based: short task branches into a protected `main`, phases marked by tags | Small pull requests that CI and reviewers can check; `main` always releasable | One pull request per task |
| C. Git flow (develop, release and hotfix branches) | Separate release preparation | Built for teams with parallel releases |

## Decision

Option B.

1. **`main` is protected** (`.github/rulesets/protect-main.json`): changes arrive only by pull request; the `checks`
   workflow must pass on Windows, macOS and Linux; no force push, no deletion; linear history through squash merges.
2. **One short branch per task,** cut from `main` and merged within days: `p<phase>/<type>-<short-name>`. Types:
   `feat`, `fix`, `test`, `docs`, `bench`, `sec`, `chore`. Delete the branch after the merge.
3. **Other branch kinds:** `deps/<package>-<version>` for one approved dependency update; `exp/<name>` for an
   experiment that is never merged (its result goes in `docs/measurements/`); `fix/<name>` for an urgent fix.
4. **Phases are tags:** `phase-<n>-done` after the gate check passes; releases are `v<semver>`. A missed gate gets no
   tag.
5. **Agents never merge, push to `main`, or delete branches.** The owner merges.
6. **One checkout** until parallel agents on separate branches would pay; then use worktrees, one agent per worktree.

## Rejected

- **Option A:** pull requests too large to review well.
- **Option C:** release branches serve teams that maintain several releases at once.

## Limits

- GitHub enforces rulesets on a private repository only on a paid plan. On a free plan, apply the ruleset when the
  repository is public; until then the rules hold by agreement, and the git hooks still run the checks.

## What would reopen this

- More people join (review rules change).
- Releases must be maintained in parallel (option C).

## Amendments

- **2026-11-08, parallel checkouts** (owner, from a project made from this template). Point 6 ("one checkout") is replaced:
  parallel checkouts are the default. Sessions may work in parallel, each in its own git worktree on its own task
  branch, one session per checkout, at most 3 worktrees. A project keeps one checkout only when parallel work would
  harm it (a shared timed benchmark, one local database or port, a tool licence with one seat), and records why in a
  decision record.
  **The reason:** two sessions in one checkout can overwrite each other's work.
  **What had to change first:** three guards read git-ignored files from their own checkout, so in a new worktree
  they turned off without a word: the private-term scan before a push, the quiet hours, and the local guards that
  Claude Code loads from `.claude/settings.local.json`. Now the push hook, the privacy lint and the quiet hours read
  the private files from the main checkout (`tools/main-checkout.mjs`). It finds the main checkout from the folder
  layout (`<name>.worktrees/<branch>` beside `<name>`) and checks git's records in both directions, because a
  session can rewrite its worktree's `.git` file (a security review showed three ways to redirect a first version
  that trusted that file). Every other case throws, and the guards fail closed. `tools/worktree.mjs add` copies the
  files that Claude Code reads per checkout, and `check.mjs fast` fails in a worktree where one is missing or
  differs. The security guard asks before a direct `git worktree` command, `git -C` into another folder, and a new
  link or junction; the permission rules ask before an edit of a `.git` file or folder.
  **Rejected:** a second clone (each guard would need its own copy of the private files, and a stale copy goes
  unnoticed); a tool's own worktree feature (it does not copy the owner's local files).
  **Second security review** (from the same project). The reviewer moved the whole layout: a junction on the
  `<name>.worktrees` folder led to a decoy folder, and a copied record there passed both checks. Git still used the
  real repository through the record's `commondir` file, so commits and pushes worked, while the guards read the
  decoy. A follow-up check did the same with a decoy `.git` that borrowed the real objects and refs through
  junctions. Now the record's `commondir` must name the main checkout's `.git` folder; a main `.git` whose `objects`
  or `refs` is a link, or that has an alternates file, is refused; and `worktree.mjs add` refuses a `.worktrees`
  folder that is a link. The lookup resolves the real spelling of the path first, so a path in another case cannot
  skip the layout test, and a `.git` folder with a `commondir` file (a copied record) is never a main checkout.
  `sync` checks the real folder directly before each removal. The push hook says when no private-term scan ran. The
  security guard asks for more link commands (`New-Item -ItemType:Junction`, an item type it cannot read,
  splatting, `fsutil hardlink`, `cp -s`, `junction`, the .NET link calls). Each fix has a test that fails without it.
  **The limits of this design:**
  1. A session that can rewrite a `.git` file and create links can point git at a repository it controls, for
     example a full copy of this one with its own config and no hooks. The checks above make that harder, and its
     commits then do not reach the real repository; they do not make it impossible. No local hook is a barrier
     against it.
  2. The guards are files in the checkout. A session can edit `tools/`, `.githooks/` or `.claude/hooks/` in its own
     worktree, as in the main checkout, and so remove a guard.
  3. The permission rules and the security guard ask the owner before a `.git` edit, a link, a guard edit and every
     push. But the security guard reads command text only: a script that makes a link or edits a guard passes it.
  4. The private terms and the quiet hours are local, so CI cannot check them. For these two guards, the last control
     is the owner's approval of each push. Branch protection on GitHub (point 1, once applied) stops a push to
     `main`, and the owner's review of each pull request is the last check of its content.
- **2026-11-10, the guard hooks are removed** (owner; decision 0002, amendment of 2026-11-10). The security guard
  no longer asks before a direct `git worktree` command, `git -C` into another folder, or a new link or junction, and
  `.claude/hooks/` no longer exists. The permission rules still ask before an edit of a `.git` file or folder, and
  `check.mjs fast` still fails in a worktree that lacks the owner's local files. The worktree defence is weaker: the
  owner's approval of each push is now the main control.
- **2026-11-10, one work branch per milestone** (owner; decision 0004, amendment of 2026-11-10). "Each task has a
  short branch" now reads "each milestone has one work branch". The branch names, the protection of `main` and the
  owner's merge are unchanged.
- **2026-11-13, a push skips the commits that the remote already holds** (owner). Pull request #4 conflicted with
  `main`, which holds pull request #3 as one squash commit that GitHub made in the web interface. The fix is a merge
  of `main` into the work branch (a rebase would rewrite a pushed branch). The push guard then refused the merge's
  push: it scanned `main`'s squash commit again, and GitHub had dated that commit -06:00. **Decision:** for a push to
  an existing branch, the guard leaves out the commits that the remote's branches already hold, read from the remote
  with `git ls-remote` (the rule it already used for a new branch). Every commit that the push publishes is still
  scanned. **What is lost:** a commit that someone pushed to another remote branch without the hook is not scanned
  again; that was already true for a new branch, and the hooks guard against mistakes, not a hostile process.
  **Noted:** GitHub's web merges date their commits in a local time zone (4e4579d: -06:00), so `main`'s public history
  already shows the owner's offset (`docs/follow-ups.md`).

