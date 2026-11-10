# Setting up a project from this template

Do the steps in order. Each step is one action. After step 1.5 the git hooks refuse commits on `main`, so do the
setup on a task branch: `git switch -c p0/chore-setup`. The setup changes `.github/`-free files only; if you change a
workflow, push it yourself with `ALLOW_WORKFLOW_CHANGE=1` set for that one push.

## 1. Identity and privacy

1. Set a commit email that is not personal, for this repository only:
   `git config user.email "<id>+<username>@users.noreply.github.com"`. GitHub shows the address under Settings,
   Emails.
2. On GitHub, turn on "Keep my email addresses private" and "Block command line pushes that expose my email".
3. Copy `CLAUDE.local.md.example` to `CLAUDE.local.md` and fill it in.
4. Create `private-docs/privacy-terms.txt` with your private terms (other project names, internal URLs, machine
   details, personal names), one a line.
5. Turn on the git hooks: `git config core.hooksPath .githooks`. From now on, commit with UTC dates
   (`TZ=UTC git commit ...`; PowerShell: `$env:TZ='UTC'`), or the commit hook refuses the commit.
6. Pin the repository's URL in `tools/git-guard.config.json` (`allowedPushUrls`), so a push to any other address is
   refused.
7. If you want quiet hours (no agent work at set times without your approval for each instance), create
   `.local/quiet-hours.json`, for example
   `{ "timeZone": "UTC", "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "start": "09:00", "end": "17:00" }`,
   with your own IANA time zone ("Region/City"). Check it with `node tools/quiet-hours.mjs status`. Add the time zone to
   `private-docs/privacy-terms.txt`, so it never reaches a public file.

## 2. The project's own content

1. Replace every `<...>` placeholder in `AGENTS.md`: the name, the paragraph, the mission and the status.
2. Write the project's hats (`docs/hats.md` explains how). Keep the evaluation and security hats.
3. **Choose the setup options.** Describe the project to the lead: its languages, frameworks and package managers.
   The lead reads `docs/setup-options.md` and lists each section whose trigger matches, with the reason. Approve or
   refuse each section. The lead copies only the approved sections into `AGENTS.md`. A section left out costs no
   tokens, because sessions do not load `docs/setup-options.md`.
4. Write the roadmap: phases, each with its work, deliverable and gate (`docs/roadmap.md`).
5. Write the gates with their numbers and conditions (`docs/contract.md`), before any work they judge.
6. Write the first decision record for the project's shape (`docs/decisions/`, from 0005).
7. Add the project's terms to `docs/voice.md`, and any banned synonym with one meaning to `tools/voice-lint.mjs`.
8. Rename the package in `package.json`.
9. **Review the agents with the lead** (`AGENTS.md`, "Agents and security", 10). The lead reads the hats, the roadmap
   and the agents in `.claude/agents/`, and gives you considerations, each with its reason: which agents fit as they
   are, which to adapt (for example a reviewer whose checks name TypeScript in a Python project), which are missing,
   and which may not pay off. You decide; the lead changes nothing without your yes.

## 3. The supply chain

1. Re-check the pins when you adopt the template: pnpm in `package.json` (version and SHA-512 hash), the actions and
   Node in `.github/workflows/checks.yml`. Each must be 60 days old or more, with no known vulnerability above low
   (`docs/decisions/0001-supply-chain.md`).
2. For each ecosystem whose "Packages" section you copied in section 2, step 3, apply its settings: the lock file,
   the age setting, the audit and the script settings. Add its audit to CI as "Audit tools in CI" in
   `docs/setup-options.md` says, because `check.mjs` audits only `pnpm-lock.yaml`.
3. Add packages only with the `vet-package` procedure and the owner's yes.
4. List each project folder with its own `package.json` in `tools/check.config.json` (`pnpmProjects`).

## 4. GitHub

1. Turn on Dependabot security alerts (notifications only), and keep automatic fix pull requests off.
2. Allow squash merges only, delete merged branches, and keep auto-merge off:
   `gh repo edit --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge --enable-auto-merge=false`.
   Give CI a read-only token that cannot approve pull requests:
   `gh api -X PUT repos/<owner>/<name>/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`.
3. **Ask the owner to turn these on** in the repository's Settings, Advanced Security. An agent cannot judge the
   plan, so it asks and then checks:
   1. **Code scanning:** CodeQL analysis, default setup.
   2. **Secret scanning:** GitHub sells it as part of "Secret Protection".
   3. **Push protection:** blocks a push that contains a secret.

   Run `node tools/github-security-check.mjs <owner>/<name>`. It prints `on`, `off`, `not offered` or `unknown` for
   each setting and changes nothing. All three are free for a public repository. For a private repository they are
   paid add-ons on some plans, and the tab may not show. For each setting that is `not offered`, write a row in
   `docs/follow-ups.md`, and check it again when the plan changes or the repository becomes public.
4. Apply the main-branch ruleset:
   `gh api -X POST repos/<owner>/<name>/rulesets --input .github/rulesets/protect-main.json`. GitHub enforces
   rulesets on a private repository only on a paid plan; on a free plan, apply it when the repository is public.
   The ruleset requires the status check that `checks.yml` really runs. Edit the check names in the file if you add
   or remove a runner, or every merge waits for a check that never runs.
5. **Limit which actions may run, and pin them.** With the owner's yes:
   `gh api -X PUT repos/<owner>/<name>/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true`
   then
   `gh api -X PUT repos/<owner>/<name>/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`.
   Only GitHub's own actions can run. Add another action to the list only after the vetting in decision 0001. Every
   action is pinned to a full commit hash, so a moved tag cannot change what runs.
6. **Remove the `workflow` scope from the daily GitHub login:** `gh auth refresh -h github.com --remove-scopes workflow`.
   With the scope, any program on your PC (a build tool, a test runner, a package) can use your login to push a
   workflow file that copies the repository's secrets. Without it, GitHub refuses that push. To push a change to a
   workflow file, add the scope for that one push (`gh auth refresh -h github.com -s workflow`) and remove it again.
   Do not use an SSH key to push: it skips this check.
7. Check all of it: `node tools/github-security-check.mjs <owner>/<name>`. A required line that is not `on` fails the
   check (exit 1). An advised line that is not `on` is printed and does not change the exit code: Actions limited,
   actions pinned, a ruleset that needs a pull request, and a login without the `workflow` scope.
8. Choose a licence before the repository becomes public.

## 5. Check and merge

1. Delete the `SETUP` comments from `AGENTS.md`.
2. Run `node tools/check.mjs full`. Every check must pass.
3. Commit, push the setup branch, and open a pull request. CI must pass on all three systems.
4. Review the pull request and merge it yourself.
