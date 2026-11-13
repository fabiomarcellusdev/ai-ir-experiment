# 0011. A sentence that tells the agent to change an element by its quoted text directly

**Status:** Accepted for a check (owner, 2026-11-13): the owner chose "Yes, a separate check" for this sentence. It
stays in the server only if the check supports it (see "What would reopen this").

## Context

- **Arm M takes a turn that it does not need.** On small edits (C0.10 v2), arm M nearly always called `html_find`,
  then `html_change` by ref: 3 turns. `html_change` already accepts the quoted text as a locator (`text`, with `tag`
  when needed), so 1 call, in 2 turns, can do the same edit when the text names one element.
- **The turn decides the ratio.** At equal turns, arm M costs about 20% more than arm B, because the tool definitions
  are in every request. With 1 turn fewer, it can cost less: in C0.10 v2, arm M's 2-turn runs had a median of 11,253
  tokens, against 14,043 for arm B's 3-turn runs.
- **Built-in tools are no answer.** Arm M never used the built-in tools: 0 of 120 runs in C0.7 v2 and in C0.10 v2.

## Options

1. **A. One sentence in html_change's description (chosen for the check).** The sentence: "When the task quotes
   visible text inside the element, call html_change with `text` (and `tag`) directly; html_find is not needed
   first."
   - **Build and maintain:** text only.
   - **Cost:** about 20 tokens in every turn; the count is measured with `count_tokens` when the sentence is
     committed.
   - **Risk:** a quote can fit several elements. html_change then changes nothing and lists the matches; the agent
     loses the turn that it tried to save.
2. **B. The same advice in html_find's description.** Rejected: the agent reads html_find's text when it already
   plans to call it.
3. **C. Remove html_find.** Rejected: C0.8 and C0.9 tasks need it to see the structure or the attributes.

## Decision

Option A, for the check in `docs/measurements/2026-11-13-check-ts-loc-run-plan.md` ("loc"), against the baseline
check "now" of the same server without the sentence. C0.1 v2 and C0.2 v2 must
pass again on the server with the sentence before the check.

## What would reopen this

- **Harm in the check:** more failed runs or a higher median of turns. The lead then removes the sentence.
- **No gain:** the check's C0.10 tokens do not drop beyond the noise. The sentence then costs tokens for nothing, and
  the lead proposes to remove it.

## Amendments

**2026-11-13 (lead): the sentence as committed for the "loc" check, corrected after its review.** The independent
review replayed the 3 task sets with `text` only: on C0.7 v2, 39 of 40 tasks changed a wrong element with no error,
because the deepest element that holds a quote is usually a heading inside the `section` or `div` that the task
names. With `tag`, all 40 were right (C0.10 v2: 30 of 30; C0.9 v2: 30 of 30). "(and `tag`)" read as optional, so the
lead changed the sentence to: "When the task quotes visible text inside the element, call html_change with that
`text`, and with `tag` when the task names the element's tag; html_find is not needed first." It ends html_change's
description. The 3 tools' text is 1,210 tokens with it, against 1,161 without (`count_tokens`, `claude-sonnet-5-5`, by
`experiments/c07/analysis/count-tools.mjs`): **49 tokens** in every turn, against "about 20" in option A's estimate.
The check "loc" runs after C0.1 v2 and C0.2 v2 pass on this server. The baseline "now" (the same server without the
sentence) ran first: arm M ÷ recorded arm B 0.363 (C0.7 tasks) and 1.180 (C0.10 tasks), 3 turns on both.
