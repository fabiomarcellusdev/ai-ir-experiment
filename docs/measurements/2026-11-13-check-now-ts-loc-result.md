# The arm-M checks "now", "ts" and "loc": the direct-locator sentence wins; tool search does not pay

**PAID, NOT gates; they decide nothing but arm M's setup for the mixed gate.** The plan, its analysis and its reading
rules were fixed before the runs (`docs/measurements/2026-11-13-check-ts-loc-run-plan.md`). Each mode ran arm M only,
3 runs of each of the 40 tasks, on the frozen task sets of C0.7 v2 (large elements) and C0.10 v2 (small edits).

| Check | Tasks | New M ÷ recorded B | New M ÷ "now" (interval) | Median turns (mix) | Median first request | Runs with an `html_*` call | Success | Cost |
|---|---|---|---|---|---|---|---|---|
| **now**: the current server, tool search off | C0.7 | 0.363 | – | 3 | 5,280 | 120 of 120 | 100% | $0.78 |
| | C0.10 | 1.180 | – | 3 | 5,268 | 120 of 120 | 100% | $0.68 |
| **ts**: tool search on | C0.7 | 0.509 | 1.516 (1.475 to 1.902) | 5 | 5,148 | 113 of 120 | 99.2% (1 failed run) | $2.13 |
| | C0.10 | 1.160 | 0.985 (0.979 to 0.991) | 3 | 5,136 | **21 of 120** | 100% | $0.89 |
| **loc**: decision 0011's sentence | C0.7 | **0.259** | **0.659** (0.659 to 0.661) | **2** (111 runs of 2, 9 of 3) | 5,329 | 120 of 120 | 100% | $0.54 |
| | C0.10 | **0.787** | **0.664** (0.663 to 0.836) | **2** (103 of 2, 17 of 3) | 5,317 | 120 of 120 | 100% | $0.53 |

The recorded arm B is the one of the v2 gates (C0.7 v2 and C0.10 v2); the ratios against it mix 2 commits and 2 runs,
so they are comparisons, not gate ratios. On C0.7's tasks, `compareM` uses the gate's 37 qualifying tasks (arm B failed
all 3 runs of `1-removal-1`, `1-removal-2` and `3-removal-2`); on all 40 tasks the values are 0.376 ("now"), 0.521
("ts") and 0.261 ("loc"). The selection does not change. Total cost of the 6 modes: **$5.55** (estimate: about $4.90; "ts" added
turns on C0.7's tasks).

## The reading, by the rules fixed before the runs

1. **Deferral (rule 1): not shown.** With tool search on, the median first request dropped by only about 130 tokens
   against "now" (5,148 and 5,136, against arm B's 4,405 and 4,392: about 740 tokens above, where the rule allows 300).
   Claude Code's `ToolSearch` tool has its own definition, which takes most of the space that the 3 HTML tools gave up.
2. **With tool search on, the agent did not load the tools on the small edits** (rule 1's wording): only 21 of 120
   runs (17.5%) used an `html_*` tool, under the rule's 90%; the rest used Grep (112 calls) and Edit (81). On the large
   elements, 113 of 120 runs (94.2%) loaded them, which cost 2 more turns (median 5). So the agent chose its tools by
   the task, but that did not pay: the small edits still cost 1.16 times arm B, and the large ones rose from 0.363 to
   0.509. Against "now", "ts" on C0.10's tasks is 0.985 (0.979 to 0.990), a decrease of 1.5% by rule 4; with the mean
   of each task's 3 runs in place of the median, it is 1.026 (0.990 to 1.096), no difference. The plan does not fix
   that choice.
3. **Harm (rule 2): none in "loc".** Success 100% with 0 failed runs on both task sets, and fewer turns (2, against 3).
   "ts" had 1 failed run on C0.7's tasks (0.8 points, under the 5-point limit).
4. **The setup for the mixed gate (rule 3): "loc".** Among the setups with no harm and a C0.7 ratio of 0.50 or less
   ("now" 0.363, "loc" 0.259; "ts" 0.509 is out), "loc" has the lowest C0.10 ratio: 0.787, against 1.180 for "now".
5. **"loc" against "now" (rule 4):** both intervals lie far below 1.00. The sentence cuts arm M's tokens by about a
   third on both task sets, because the agent now changes the element in 1 call: `html_find` was called in only 9 of
   120 runs on C0.7's tasks and 47 of 120 on C0.10's.

## The other numbers of the fixed analysis

| Mode | New M ÷ recorded M (interval) | Whole-file reads | Changes inside the target by hand | Tool calls |
|---|---|---|---|---|
| now C0.7 | 0.969 (0.968 to 0.969) | 0 | 0 | html_find 113, html_change 120 |
| now C0.10 | 0.969 (0.969 to 0.969) | 1 | 0 | html_find 114, html_change 91, html_outline 1 |
| ts C0.7 | 1.468 (1.429 to 1.775) | 1 | 5 | Grep 117, ToolSearch 113, html_change 113, Read 78, html_find 33, Edit 9, Glob 4, other 1 |
| ts C0.10 | 0.961 (0.947 to 1.132) | 0 | 23 | Grep 112, Edit 81, ToolSearch 22, Read 13, html_find 12, html_change 9, Glob 7 |
| loc C0.7 | 0.638 (0.636 to 0.640) | 0 | 0 | html_change 120, html_find 9 |
| loc C0.10 | 0.682 (0.643 to 0.976) | 0 | 0 | html_change 90, html_find 47 |

- **The 1 failed run** ("ts", C0.7 `3-removal-2`, run 1): the agent warned that the removal would be very large, asked
  first, and changed nothing. The judge: "the canonical DOM is not the expected file's".
- **The "other" call** ("ts", C0.7 `10-removal-1`, run 1): a `Bash` call (`sed -i`) that the harness refused ("No such
  tool available"); the agent then used `html_change`, and the run passed.
- **`tag` in "loc":** on C0.7's tasks, all 111 calls with `text` also gave the task's `tag` (9 calls used `ref`). On
  C0.10's, 29 calls had `text` and no `tag`, all on "text" tasks whose prompts name no tag, and all passed.

## The free reruns before "loc"

The sentence changed the server's text, so C0.1 v2 and C0.2 v2 ran again first, on committed code:

| Run | Commit | Verdict | Numbers |
|---|---|---|---|
| C0.1 v2 | `2fb5748` | **PASS** | 0 failures in 1,664 changes; every control failed as it must |
| C0.2 v2 (TIMED) | `f247435` | **PASS** | 0 failures in 1,290 calls; p50 2 ms, p99 299 ms, max 424 ms; all controls ok |

## Conditions

- Date: 2026-11-13 (UTC). "now" and "ts" from 02:28 to 03:21 on `d8974c2` and the result commits after it; the
  reruns from 03:29 to 03:43; "loc" from 03:43 to 04:00 on `b36e8f9` and `370cf03`. NOT timed, except C0.2 v2.
- Claude Code 2.1.322 from the pinned copy, model `claude-sonnet-5-5`, the gates' flags and limits; "ts" with
  `ENABLE_TOOL_SEARCH=true` and `ToolSearch` in `--tools` and `--allowedTools`.
- The tool text: 1,161 tokens for "now" and "ts"; 1,210 tokens for "loc" (decision 0011's sentence, 49 tokens).
- Freezes: `experiments/c07/run-inputs-check-now-v2.json`, `run-inputs-check-ts-v2.json` and
  `run-inputs-check-loc-v2.json`. Raw results: `experiments/c07/check-{now,ts,loc}-v2-{c07,c10}-result.json`.

## What these numbers do not show

- **A gate result.** Arm B did not run again; the mixed gate C0.11 runs both arms.
- **The sentence on other task kinds.** C0.8 names its targets by an id and a position, so the sentence does not
  apply there; C0.9's quotes are not in the source as written.
- **Silent wrong changes on other tasks.** None happened here: every "loc" run passed, and every `text` call on C0.7's
  tasks gave `tag`. The review of decision 0011 showed that a call with `text` and no `tag` would change a wrong
  element on most C0.7 tasks.
- **Other models, harnesses, or Claude Code's tool search with more tools.**

## Independent check

The `analysis-checker` agent recomputed the 6 modes from the raw runs and the transcripts, before it read the
results' `comparison` fields and this report. It got the same selection, "loc", and found it robust: "loc" wins with
either task basis and either per-task statistic, and also against "ts" if "ts" were let in.

1. **Integrity:** every record on its result's commit; 2.1.322 and `claude-sonnet-5-5` in every run; 40 tasks × 3
   runs, 1 attempt each, 0 stops, no open run; tokens, turns, cost and `firstInput` match the 720 transcripts. "ts":
   `ToolSearch` in the start's tool list and the server connected in 240 of 240 runs. "loc": the transcripts hold no
   tool descriptions, so the sentence shows only by the hashes of `server/tools-v2.json` at the run commits (the "loc"
   freeze's hash, not the "now" and "ts" freezes' hash) and by a first request 49 tokens larger than "now".
2. **Numbers:** every median matches; the interval ends differ only by bootstrap noise.
3. **Noise:** "now" and "loc" are almost deterministic (in 35 to 38 of 40 tasks, the 3 runs differ by less than 2%);
   "ts" on C0.7 is noisy (median spread 29%), and so is the recorded arm B on C0.7 (22%).
4. **Gaps in the plan:** how a task's 3 runs combine (median or mean); which tasks the ratio against recorded B uses;
   no interval for rule 3's 0.50 limit ("ts" C0.7: 0.48 to 0.73); no limit for "ts" in rule 2; no effect of rule 1 on
   the selection; the bootstrap's details; and no way to see the tool text in a transcript.
