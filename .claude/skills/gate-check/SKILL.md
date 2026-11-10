---
name: gate-check
description: Close a phase, or another milestone in docs/testing.md, only when every required check passes. Use before saying a phase is done, before merging a phase branch, and before a release.
---

# Gate check

1. Read the phase in `docs/roadmap.md`, its gate in `docs/contract.md`, and the milestone's checks in
   `docs/testing.md`.
2. Run `node tools/check.mjs gate` under the machine rules in `CLAUDE.local.md`, if any. Every check must pass. Do not skip a check, and do not
   re-run a failing check until it passes: a flaky check is a bug.
3. Run the gate's own measurement with the `measurement-run` skill. Compare the result with the gate's number, fixed
   before the run.
4. Ask the `adversarial-reviewer` agent to review the phase's changes, and the `security-reviewer` agent for phases
   3, 4 and 9 and any change to file access, config loading, hooks or dependencies.
5. Report: each check with PASS or FAIL, the gate's number against its threshold, the reviewers' findings, and the
   open rows in `docs/follow-ups.md` that the phase leaves behind. Add the agent review for the next phase
   (`AGENTS.md`, "Agents and security", 10): which agents fit its work, which to adapt, add or remove, each with its
   reason. These are considerations; the owner decides. Also check the triggers in `docs/setup-options.md`: offer
   each section whose trigger now matches, and the removal of each copied section whose trigger no longer holds.
6. A missed gate is recorded as missed in `docs/contract.md` and `docs/current-work.md`. The owner decides what
   happens next.
