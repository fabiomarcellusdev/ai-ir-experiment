# 0012. A gate on a mix of small and large edits (C0.11)

**Status:** Accepted (owner, 2026-11-13): mix A and the ratio of total tokens. The owner said yes to "a gate on a
realistic mix of small and large edits" (2026-11-13), then chose "A: 50% small edits" and "Total tokens". The gate
text goes into `docs/contract.md` after the arm-M checks end (a contract change during a run stops it); no gate run
happens before the owner sees that text.

## Context

- **Each gate so far tested one task kind.** C0.7 (large elements) 0.403, C0.8 (position) 0.517, C0.9 (a quote not in
  the source) 0.690: PASS. C0.10 (small edits named by a quote) 1.207: FAIL. A developer's work mixes these kinds; no
  gate measured a mix.
- **The measure matters for a mix.** The gates use the median of per-task ratios. It counts a small edit (arm B's
  median: 14,057 tokens in C0.10) the same as a large one (42,651 in C0.7). A developer pays for the total tokens.
- **A free estimate** (exploratory, from the 4 v2 gates' recorded runs on the old server, tool search off; 10,000 draws
  of 40 tasks; script in the lead's scratchpad, to be committed with the gate):

| Mix: C0.10 / C0.7 / C0.8 / C0.9 tasks | Median of per-task ratios | Ratio of total tokens |
|---|---|---|
| A: 20 / 8 / 6 / 6 (50% small) | 0.806 (0.750 to 0.884) | 0.618 (0.512 to 0.715) |
| B: 28 / 4 / 4 / 4 (70% small) | 0.896 (0.876 to 1.186) | 0.772 (0.627 to 0.872) |
| C: 10 / 10 / 10 / 10 | 0.638 (0.556 to 0.712) | 0.527 (0.442 to 0.613) |

- **Nobody knows the real mix.** No source in this project measures how often developers make each kind of edit. The
  mix is the owner's assumption, and the gate report says so.

## Options

### How to make the tasks

1. **A. Draw a fixed mix from the 4 v2 gates' frozen task sets (recommended).** The tasks, their files and their
   expected results exist, are checked, and are frozen. Build: a small script that draws the mix with a new seed, and a
   runner mode. Maintain: nothing new in the task rules.
2. **B. Draw 10 new files, with a mix of task kinds in each file.** New files, but new task code that combines 4 gates'
   rules in one file, and a new draw rule. Build: large; risk: files that cannot give every kind.

### The measure of the pass rule

1. **The median of per-task ratios** (as every gate so far): a small edit counts as much as a large one.
2. **The ratio of total tokens (recommended):** the sum of each task's median tokens in arm M ÷ the same sum in arm B,
   with a 95% bootstrap interval over files. It matches what a developer pays for. The other rules stay: success no
   more than 5 points below, no kind more than 15 points below, and the upper end of the interval below 1.00.

### Arm M's setup

The setup that the 3 arm-M checks select (`docs/measurements/2026-11-13-check-ts-loc-run-plan.md`, reading rule 3):
the current server with tool search off, tool search on, or decision 0011's sentence.

## Decision

- Tasks: option A, 40 tasks, 3 runs of each in each arm: 240 runs.
- Measure: the ratio of total tokens, at 0.70 or less, with the other rules of the second rescope.
- Mix: **A** (owner, 2026-11-13): 20 tasks from C0.10 v2, 8 from C0.7 v2, 6 from C0.8 v2 and 6 from C0.9 v2.
- Cost: by the v2 gates' cost per run of each kind, about $4.

## Rejected

- **Option B for the tasks:** a large build and new risk. New files would avoid reusing the v2 gates' files, but
  reuse does not help an agent: each run starts in a new process, with no memory of earlier runs.

## What would reopen this

- The arm-M checks show that no setup meets reading rule 3.
- The owner wants new files.

## Amendments
