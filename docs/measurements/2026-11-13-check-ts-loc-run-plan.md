# Run plan: the arm-M checks of the current server, of tool search on, and of the direct-locator sentence

**PAID, NOT gates.** The owner said yes (2026-11-13) to a run with tool search on, to a separate check of one sentence
in the tool text that tells the agent to call `html_change` with the quoted text directly (decision 0011), and to a
baseline check of the current server with tool search off. Each check runs arm M only, 3 runs of each of the 40
tasks, on the frozen task sets of C0.7 v2 and C0.10 v2. They decide nothing; their purpose is to choose arm M's setup
for the mixed gate that the owner also said yes to.

## Why

In the v2 gates, arm M never used Read, Edit, Grep or Glob: 0 of 120 runs in C0.7 and in C0.10. At equal turns it
costs about 20% more than arm B, because the 3 tools' definitions are in every request: about 875 tokens a request on
the current server (an estimate: the first check's 923, less the 48 tokens of the removed size sentence). Two ways can
lower that cost:

1. **Tool search on:** the MCP definitions are not in the context until the agent loads them with Claude Code's
   `ToolSearch` tool. Claude Code's tool-search page (read 2026-11-12) says that `ENABLE_TOOL_SEARCH` set to "true",
   or not set, turns it on; this is not checked for 2.1.322, so the check sets "true". A small edit could then cost
   almost what arm B costs. Each run that uses an MCP tool must first call `ToolSearch`, so most runs get 1 more turn.
2. **Fewer turns:** arm M calls `html_find`, then `html_change` (3 turns), but `html_change` already takes a `text`
   locator. In C0.10 v2, arm M's 2-turn runs had a median of 11,253 tokens, against 14,043 for arm B's 3-turn runs.

## The 3 checks

| Check | Modes | What changes | Server text |
|---|---|---|---|
| Baseline ("now") | `--check-now-v2-c07`, `--check-now-v2-c10` | nothing: the current server, tool search off | decision 0010's text, no size field (1,161 tokens), as at `d1679e6` |
| Tool search on ("ts") | `--check-ts-v2-c07`, `--check-ts-v2-c10` | `ENABLE_TOOL_SEARCH=true`; arm M gets `ToolSearch` in `--tools` and `--allowedTools`; its start message must list `ToolSearch`, with or without the deferred MCP tools, and show the server `html` connected | the same as "now" |
| Direct locator ("loc") | `--check-loc-v2-c07`, `--check-loc-v2-c10` | decision 0011's sentence in html_change's text; tool search off | the same, plus that sentence; C0.1 v2 and C0.2 v2 must pass on it first |

The runner refuses a check whose server text does not fit: "loc" without decision 0011's sentence, or "now" and "ts"
with it (`sentenceProblem` in `experiments/c06/run-c06.mjs`). The order is "now", then "ts", then the sentence, the
C0.1 v2 and C0.2 v2 reruns, and "loc". Each check has its own freeze: `node experiments/c07/freeze.mjs --check-now-v2`
(and `--check-ts-v2`, `--check-loc-v2`), which also pins this plan, the 2 gate results and the first check's 2
results.

Everything else is as in the first arm-M check (`docs/measurements/2026-11-13-check-m-v2-run-plan.md`): the pinned
Claude Code 2.1.322, `claude-sonnet-5-5`, the flags, the limits, the seed `20261112`, the judge, the stop rules,
`compareM` against `experiments/c07/gate-v2-<gate>-result.json`, and each mode once.

If arm M's start message in "ts" does not fit, the first run stops the mode (a stop under C0.6 rule 2) at a cost of
about $0.01; the lead then reports it, and the owner decides.

## The analysis, fixed before the runs

For each mode, the numbers of `compareM`: the ratio new M ÷ recorded M per task, its median and its interval over
files; the median `firstInput`; turns; success; failed runs with reasons; whole-file reads; tool calls (with
`ToolSearch` counted by name); and new M ÷ recorded B. The report also sets each "ts" and "loc" mode against the "now"
mode of the same task set, with the same per-task ratio, median and interval: new M ÷ "now" M.

**Reading rules (decided now):**

1. **Deferral works** when, on both modes of "ts", the median `firstInput` of arm M is at most 300 tokens above arm B's
   recorded median `firstInput` (C0.7 v2: 4,405; C0.10 v2: 4,392), and arm M called an `html_*` tool in at least 90%
   of the runs. With fewer, the report says that the agent did not load the tools.
2. **Harm** is success more than 5 points below "now" on a mode. For "loc", a higher median of turns than "now" is
   also harm. For "ts", 1 more turn is expected and is not harm by itself; the token ratio counts.
3. **The setup for the mixed gate's arm M** is the one of the 3 ("now", "ts", "loc") with the lowest median new M ÷
   recorded B on C0.10's tasks, among the setups that meet both: no harm on either mode, and a median new M ÷ recorded
   B of 0.50 or less on C0.7's tasks. "now" counts as meeting "no harm". The owner can choose otherwise.
4. A difference of medians whose interval over files holds 1.00 (new M ÷ "now" M) is reported as no difference.

## The cost

The first check cost $0.80 (C0.7) and $0.70 (C0.10). "now" about $1.50; "ts" adds about 1 turn to most runs, about
$2; "loc" can remove a turn, about $1.40. In all, about **$4.90**. Budget stops: "now" `--budget-usd 2.5` (C0.7) and
`1.5` (C0.10); "ts" `3` and `2`; "loc" `2.5` and `1.5`.

## What these checks do not show

- A gate result: arm B is not run again.
- How the setups do on a mix of small and large edits: that is the mixed gate's question.
- Other models or harnesses.
