---
name: diagnosing-bugs
description: A strict loop for a hard bug or a slowdown - build a test command that fails on the bug, shrink it, test ranked hypotheses, then fix with a regression test. Use when a test fails for an unknown reason, a result is wrong, or something throws or is slow and the cause is not obvious.
---

# Diagnosing bugs

Adapted from `mattpocock/skills` (MIT; `.claude/skills/LICENSE.mattpocock-skills.txt`).

Skip a stage only when you say why. Work on a task branch through the `task-pipeline` skill.

## Redact

You will show commands, outputs and captured data. Before you show them:

- Write `<REDACTED>` in place of every secret. Keep credentials in environment variables, never in a command you show.
- Show no content of `CLAUDE.local.md` or `private-docs/`, no local path with the user name, and no private term.
- Quote only the lines that carry the signal.

If the redacted output is not enough to find the cause, say so and ask the owner.

## Stage 1: a test command that fails on this bug

**This stage is the skill.** With a fast test command that fails on this bug, the other stages are mechanical.
Without one, reading code does not find the cause.

Ways to build the test command, in about this order:

1. A failing test at the boundary that reaches the bug (unit, integration, end to end).
2. The program or a script with a fixture input, compared with a known-good output.
3. A replay of captured input (a file, a request, an event log) through the code path alone.
4. A minimal harness: the smallest part of the system that runs the bug's code path.
5. A property or fuzz loop for "sometimes wrong": many random inputs until one fails.
6. A bisection: `git bisect run <test command>` between a good and a bad commit. **Run it only in a worktree from
   `node tools/worktree.mjs add`, never in the main checkout:** a bisect checks out old commits, and in an old commit
   a git hook or a permission rule can be missing or older, so it stops guarding. Follow the maintainer's local notes for heavy work.
7. A differential run: the same input through the old and the new version, outputs compared.
8. **Last:** the owner runs a manual step. Give numbered steps, one action each, and ask for the redacted output.

**Limits:** a new package (a browser driver, a profiler) needs the `vet-package` skill and the owner's yes
(`AGENTS.md`, "Packages"). A request to a new host needs the owner's yes (`AGENTS.md`, "Agents and security", 6).

**Make the test command tight:**
- **Faster:** cache the setup, and narrow the scope.
- **Sharper:** assert the exact symptom, not "it did not crash".
- **Deterministic:** pin the time, seed random numbers, use a temporary folder, and use no network.

**A bug that does not always occur:** raise the rate at which it occurs (repeat it 100 times, add load, narrow the
timing), until it occurs often enough to debug.

**When you cannot build a test command:** stop and say so. List what you tried. Ask the owner for access, a redacted
artifact, or permission for temporary logging. Do not guess at causes without a test command.

**Stage 1 is done** when you can name one test command that you have already run, with its redacted output, and it
is:
- **able to fail on this bug:** it runs the bug's code path and asserts the reported symptom;
- **deterministic:** the same result each run;
- **fast:** seconds, not minutes;
- **unattended:** you can run it alone, except for way 8.

If you catch yourself reading code to build a theory before this test command exists, stop.

## Stage 2: reproduce, then shrink

1. Run the test command, and see it fail.
2. Confirm that it fails with the reported symptom, not a nearby one. A wrong bug gives a wrong fix.
3. Record the exact symptom: the error text, the wrong output, or the time.
4. Shrink the case. Remove one input, caller, setting or step at a time, and run the test command after each cut.
5. Stop when each remaining part is needed: removing any one of them makes the test command pass.

## Stage 3: ranked hypotheses

Write 3 to 5 hypotheses, ranked, before you test one. Each states its prediction: "If X is the cause, changing Y
removes the bug." A hypothesis without a prediction is a guess; sharpen it or drop it.

Show the ranked list to the owner before you test. The owner may know which one to try first.

## Stage 4: probes

- Each probe tests one prediction. Change one variable at a time.
- Prefer a debugger. Then a few logs at the boundaries that separate the hypotheses. Never log everything.
- Tag every debug log with one unique prefix, for example `[DEBUG-a4f2]`, so one search finds them all at the end.
- **For a slowdown:** measure first. A timing is a TIMED run (`AGENTS.md`, "Measurement"): say so before it starts,
  and name the machine.

## Stage 5: fix, with a regression test

1. Turn the shrunk case into a failing test at a boundary that runs the real bug pattern.
2. Run it, and see it fail.
3. Fix the bug.
4. Run the test, and see it pass.
5. Put the bug back for a moment, and see the test fail again. Then remove it (`AGENTS.md`, "Correctness": every bug
   fix has a regression test, shown to fail with the bug put back).
6. Run the Stage 1 test command on the original, full case.

**For a slowdown,** the regression guard is not a unit test: a benchmark is a separate script, and CI never times
anything (`AGENTS.md`, "Measurement" and "Version control and CI"). Add or update the benchmark script, run it as a
TIMED run, and record the before and after numbers in `docs/measurements/` with the machine.

If no boundary can show the real bug pattern, say so. That gap is a finding: add a row to `docs/follow-ups.md`.

## Stage 6: clean up

- [ ] The original case no longer fails.
- [ ] The regression test passes, or the missing boundary is in `docs/follow-ups.md`.
- [ ] No `[DEBUG-...]` log remains: search for the prefix.
- [ ] Throwaway files are deleted.
- [ ] The commit message names the hypothesis that was right, so the next person learns from it.
- [ ] `node tools/check.mjs full` passes, then the pipeline continues.
