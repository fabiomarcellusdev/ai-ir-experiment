# Run plan: the arm-M check of decisions 0009 and 0010

**PAID, NOT a gate.** The owner chose option A (2026-11-13): arm M only, on the server with the size field (decision
0009) and the shorter tool text (decision 0010), on the frozen task sets of C0.7 v2 and C0.10 v2. It compares the new
arm M with the arm M that each gate recorded. It decides nothing; its result informs the owner.

## The question

1. **The shorter text:** does arm M's fixed text drop as `count_tokens` predicts, with no extra turns and no new
   failures? The 3 tools' text went from 1,337 tokens (the gates) to 1,209 (decision 0010, amendments): 128 fewer.
2. **The size field:** does arm M handle large targets differently (C0.7: whole-file reads, turns, tokens) once
   `html_find` shows the size of an element of 1 KB or more?

## What stays as in the gates

Everything in `docs/measurements/2026-11-12-c07-c10-v2-run-plan.md` (with its amendment for C0.8) and in the second
rescope's plan `docs/measurements/2026-11-12-c07-c09-run-plan.md`, except the points below: Claude Code 2.1.322 from
the pinned copy `.local/harness/claude-2.1.322.exe` (SHA-256 checked), model `claude-sonnet-5-5`, the flags, the
isolation, the limits, the run order seed `20261112`, the judge, the stop rules and the 3 runs of each task.

## What changes

| Point | Value |
|---|---|
| Modes | `node experiments/c06/run-c06.mjs --check-m-v2-c07` and `--check-m-v2-c10` (`MODES` in `experiments/c06/run-c06.mjs`) |
| Arms | M only (`arms: ['M']`). 40 tasks × 3 runs = 120 runs per mode, 240 in all |
| The server | The current one: decisions 0009 and 0010. C0.1 v2 and C0.2 v2 passed on it (`docs/measurements/2026-11-13-c01-c02-v2-rerun.md`) |
| The comparison | `compareM` in `experiments/c06/analysis.mjs`, against `experiments/c07/gate-v2-c07-result.json` and `gate-v2-c10-result.json` |
| Results | `experiments/c07/check-m-v2-c07-result.json` and `check-m-v2-c10-result.json`; each mode runs once |
| The freeze | `node experiments/c07/freeze.mjs --check-m-v2` writes `experiments/c07/run-inputs-check-m-v2.json`: the gates-v2 files, this plan and the 2 gate results |

## The analysis, fixed before the run

For each mode:

1. **The ratio of each task:** the median tokens of the new passed runs ÷ the median tokens of the recorded arm M's
   passed runs. The median over the tasks, and its 95% bootstrap interval over files (seed `20261112`, 10,000
   resamples, as in the gates).
2. **The fixed text:** the median `firstInput` (the tokens of the first request) of the new and the recorded arm M.
   The expected drop is about 128 tokens; Claude Code's own wrapping of the tool text can change it.
3. **The rest:** median turns, success, the failed runs with their reasons, whole-file reads, changes inside the
   target by hand, missing-file errors, and the calls of each tool, old and new.
4. **A comparison only:** the median of the new arm M ÷ the recorded arm B. It mixes 2 commits and 2 runs, so it is
   not a gate ratio.

How the lead reads it (decided now):

- **The text saving is shown** when the median `firstInput` drops by 100 tokens or more on both modes.
- **Harm** is: success of the new arm M more than 5 points below the recorded arm M on a mode, or a higher median of
  turns. The lead then reports harm, with the failed runs, and the owner decides whether to undo a decision.
- **No difference** in the token ratio is reported when its interval holds 1.00.
- **The size field's effect** cannot be separated from the text's in this run. The lead reports the C0.7 change
  beyond the expected text saving (128 tokens × the new turns) as "the size field and noise", not as the size
  field's effect.
- **Risks to watch** (decision 0010, amendments): a value written as `&amp;amp;`, and errors about `file`.

## The cost

The recorded arm M cost $0.86 (C0.7 v2, 120 runs) and $0.71 (C0.10 v2, 120 runs). With the shorter text, about the
same: **about $1.60** in all. Budget stops: `--budget-usd 2.5` for C0.7 and `--budget-usd 1.5` for C0.10 ($4 in all,
as the owner agreed). A stop follows the stop rule of the gates: the mode goes on later, on the same commit.

## What this run does not show

- A gate result: arm B is not run again.
- Each change alone: the run has the size field and the shorter text together.
- Other models, harnesses, or tool search on.
