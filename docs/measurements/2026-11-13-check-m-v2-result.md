# The arm-M check of decisions 0009 and 0010: the text saving is real and does no harm; the size field never showed

**PAID, NOT a gate; it decides nothing.** The owner chose option A (2026-11-13): arm M only, on the server with the
size field (decision 0009) and the shorter tool text (decision 0010), on the frozen task sets of C0.7 v2 and C0.10
v2, against each gate's recorded arm M. The analysis and its reading rules were fixed before the run
(`docs/measurements/2026-11-13-check-m-v2-run-plan.md`).

| Measure | C0.7 v2 tasks (large targets) | C0.10 v2 tasks (small edits) |
|---|---|---|
| New arm M ÷ recorded arm M, median over 40 tasks | **0.977** (interval 0.976 to 0.977) | **0.978** (interval 0.977 to 0.978) |
| Median tokens of a run, recorded → new | 17,251 → 16,855 (−396) | 17,081 → 16,746 (−335) |
| Median first request (`firstInput`), recorded → new | 5,456 → 5,328 (**−128**) | 5,443 → 5,315 (**−128**) |
| Median turns, recorded → new | 3 → 3 | 3 → 3 |
| Success, recorded → new | 100% → 100% | 100% → 100% |
| Failed runs (new) | 0 | 0 |
| Whole-file reads, recorded → new | 1 → 0 | 0 → 1 |
| New arm M ÷ recorded arm B (a comparison only) | 0.393 (the gate: 0.403) | 1.190 (the gate: 1.207) |
| Cost | $0.80 | $0.70 |

## The reading, by the rules fixed before the run

1. **The text saving is shown.** The median first request dropped by exactly 128 tokens on both task sets. This is
   the drop that `count_tokens` predicted for the tool text (1,337 to 1,209 tokens; decision 0010). The rule asked for
   100 tokens or more on both.
2. **No harm.** Success stayed at 100% on both, with 0 failed runs, and the median turns stayed at 3.
3. **The token change is outside the noise, but small.** Both intervals lie far from 1.00 and are very narrow: arm
   M's runs repeat almost the same tokens. The new arm M uses about 2.3% fewer tokens than the recorded one.
4. **The size field was never shown, so this run cannot measure it** (found by the analysis check). 0 of the 238
   `html_find` results had a size note. `html_find` with `text` gives the deepest elements that hold the text, with
   a size; their ancestors show as outline lines, with no size. A C0.7 target is a large ancestor (a `section`, for
   example) of the text that the agent searches for, so its size cannot show this way. Every C0.7 find was by `text`.
   On C0.7's tasks the median run dropped by 396 tokens against the 384 that the text saving gives (128 × 3 turns);
   the other 12 tokens are noise. The whole-file reads (1 → 0 on C0.7, 0 → 1 on C0.10) are too few to read anything
   from. Decision 0009 records the design gap.
5. **Against the recorded arm B** (a comparison across 2 commits and 2 runs, not a gate ratio): C0.7's tasks give
   0.393 and C0.10's give 1.190. Decision 0010 estimated about 1.18 for C0.10.

## Conditions

- Date: 2026-11-13 (UTC), 00:33:50 to 00:56:11. NOT timed.
- Commits: C0.7's check on `9218fa6` (the freeze `experiments/c07/run-inputs-check-m-v2.json`, 50 files), C0.10's on
  `cb6304b` (it adds only C0.7's check result). The results were committed as `cb6304b` and `efffa80`.
- Claude Code 2.1.322 from the pinned copy, model `claude-sonnet-5-5`, the gates' flags and limits.
- Commands: `node experiments/c06/run-c06.mjs --check-m-v2-c07 --budget-usd 2.5`, then `--check-m-v2-c10
  --budget-usd 1.5`. Each ran once, with no stop and no retry.
- Runs: arm M only, 3 runs of each of the 40 tasks, 120 for each task set.
- Tool calls, recorded → new: C0.7's tasks: `html_find` 111 → 120, `html_change` 130 → 123, `html_outline` 1 → 0.
  C0.10's tasks: `html_find` 107 → 118, `html_change` 101 → 94, `html_outline` 0 → 1.
- Raw results: `experiments/c07/check-m-v2-c07-result.json` and `check-m-v2-c10-result.json` (no file text).
- Cost: **$1.50** in all (estimate: about $1.60).

## What these numbers do not show

- **A gate result.** Arm B did not run again; the comparisons with arm B mix 2 commits and 2 runs.
- **The size field's effect.** It never showed (reading 4).
- **Each change alone.** The run has both changes; the text's share is known from `count_tokens` and from the first
  request.
- **Other models, harnesses, or tool search on.**

## Independent check

The `analysis-checker` agent recomputed every number from the raw runs and the transcripts, before it read the
files' `comparison` field. Every number matches to rounding (the interval end points differ by 0.0002 or less, from
the random generator).

1. **Integrity:** 120 records per mode, 40 tasks × 3 runs of arm M, 1 attempt each, each on its result's commit; 0
   stops; every transcript reports 2.1.322 and lists the 3 v2 tools; tokens, turns, cost, `firstInput` and tool calls
   match the transcripts. The server is the same for both modes (`cb6304b` adds only C0.7's result).
2. **The text saving per task:** the first request dropped by 127 to 130 tokens on every task.
3. **The size note:** 0 of 120 `html_find` results (C0.7) and 0 of 118 (C0.10) showed one (reading 4).
4. **A change in behaviour:** the new arm M called `html_find` in more runs. On C0.7's tasks, the runs with no
   `html_find` went from 9 to 0 (Fisher's test, p = 0.003), and so did the runs of 2 turns. On C0.10's, the runs with
   no `html_find` went from 13 to 4 (p = 0.04); the runs of 2 turns from 43 to 34 (p = 0.27). The error `give "hash"
   with "ref"` went from 10 to 3 (C0.7) and from 11 to 4 (C0.10). The median turns stayed at 3, so the plan's harm
   rule is not met; that rule uses the median only and cannot see a change in the mix of turns.
5. **The risks to watch:** 0 inputs held `&amp;amp;`, and 0 errors were about `file`. One run (C0.10 `1-text`, M,
   run 1) searched `html_find` for "Free pickup &amp; drop-off", got 0 matches, and passed on its 6th turn. No
   recorded run did this.
6. **New M ÷ recorded B, with intervals:** C0.7's tasks 0.393 (0.310 to 0.453) over 37 tasks; C0.10's 1.190 (1.176
   to 1.194).
7. **Gaps in the plan:** whether the C0.7 rule counts per run or per task (−12 or −15 tokens); the harm rule's use of
   the median only; no rule for an interval that leaves out 1.00 by exactly the expected saving; and the assumption
   that `html_find` would show the size of the large targets.
