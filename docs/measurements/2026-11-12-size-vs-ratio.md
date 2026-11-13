# Does the size of a file or of a change predict the token ratio? (exploratory)

**EXPLORATORY, NOT a gate, FREE.** The owner asked (2026-11-12) whether it is worth checking how many lines an HTML
file has without reading it. This note uses the 4 v2 gates' committed records to ask which size, if any, predicts a
task's token ratio M ÷ B. It was chosen after the results, so it decides nothing: it can only point at a design to
test.

## Conditions

- Inputs: `experiments/c07/gate-v2-c07-result.json`, `-c08-`, `-c09-` and `-c10-`, and their task sets
  `experiments/c07/v2-<gate>-tasks.json`. 157 tasks have a ratio (C0.7 has 3 tasks with no ratio).
- A task's ratio is the median tokens of arm M's passed runs ÷ the median of arm B's passed runs.
- "Change size" is the length of the task's `range`, in UTF-16 code units. It is the span that the change replaces:
  the whole element for a removal or a replacement, the value for an attribute change, 0 for an insertion. It is not
  always the size of the whole target element.
- Script: `node experiments/c07/analysis/size-vs-ratio.mjs <repository root>`. Measure of association: Spearman's
  rank correlation (−1 to 1; 0 is no relation).

## Results

| Size | Spearman with the ratio |
|---|---|
| File size (characters) | −0.05 |
| File lines | −0.16 |
| Change size (characters) | −0.49 |
| Change size, only the 116 tasks under 2,000 characters | −0.12 |
| Arm B's tokens (known only after a run) | −0.91 |

| Change size | Tasks | Median ratio | Share of tasks below 1.00 | Gates |
|---|---|---|---|---|
| Under 500 characters | 107 | 0.795 | 67% | C0.8, C0.9, C0.10 |
| 500 to 2,000 | 9 | 0.547 | 100% | C0.7, C0.8, C0.9 |
| 2,000 to 8,000 | 27 | 0.465 | 96% | C0.7, C0.8, C0.9 |
| 8,000 or more | 14 | 0.283 | 100% | C0.7, C0.8 |

Small changes, by how the task names its target:

| Gate and type | Median change size | Median ratio |
|---|---|---|
| C0.8 (by position): insertion, removal, question, attribute | 0 to 412 | 0.375 to 0.626 |
| C0.9 (a quote not in the source as written): 4 types | 26 to 263 | 0.594 to 0.873 |
| C0.10 (a quote that is in the source): 4 types | 11 to 112 | 1.027 to 1.228 |

## What the numbers suggest

1. **The file's size or line count does not predict the ratio** (−0.05 and −0.16). A line count before a read would
   not have told an agent or a harness which tools to use on these tasks.
2. **A large change predicts a low ratio.** Of the 50 tasks with a change of 500 characters or more, 49 have a ratio
   below 1.00. At 8,000 characters or more, the median is 0.28.
3. **Among small changes, size does not matter, but how the target is named does** (−0.12 inside the small changes).
   With changes of the same small size, a target named by its position or by text that is not in the source gives
   0.38 to 0.87; a target named by a quote that Grep can find gives 1.03 to 1.23.
4. **The best predictor is how much work the baseline needs** (−0.91). That number is known only after a run. It
   stands for how hard the target is to find and change with plain text tools.

## What these numbers do not show

- **Cause.** Each gate has one task kind, and the kinds differ in change size and in how they name the target, so
  the two effects are mixed. A test that varies one of them at a time is needed.
- **The whole element's size for every type.** The change span is a stand-in.
- **Whether a size field helps an agent choose.** No run gave an agent a size before it chose its tools.

## A design this points to (not built)

A size for each match that `html_find` returns (bytes, lines and an estimate of tokens) could let an agent choose
`html_change` by ref for a large target and Grep with Edit for a small one that a quote can find. A new tool is not
recommended: C0.10 showed that the 3 tool definitions cost about 1,050 tokens in each turn. A design would need a
decision record and a gate before it is built.
