# 0009. A size field for each element that html_find shows

**Status:** Proposed (lead, 2026-11-12). The owner asked for the design (2026-11-12): "yes we can design a size field
for html_find". Nothing is built until the owner agrees to an option.

## Context

The owner asked whether an agent should check how many lines an HTML file has before it reads it. An exploratory
analysis of the 4 v2 gates (`docs/measurements/2026-11-12-size-vs-ratio.md`, 157 tasks; chosen after the results, so
it decides nothing) gave:

1. **The file's size and line count do not predict the token ratio M ÷ B** (Spearman −0.05 and −0.16).
2. **The size of the change does:** 49 of the 50 tasks with a change of 500 characters or more have a ratio below
   1.00; at 8,000 characters or more, the median is 0.28.
3. **Among small changes, the way the task names the target matters, not the size:** by position or by text that is
   not in the source, 0.38 to 0.87; by a quote that Grep finds, 1.03 to 1.23 (C0.10).

Today `html_find` shows each match as one line: its ref, its tag and all its attributes. It says nothing about how
large the element's source is. An agent cannot see, before it acts, whether a target is 50 bytes (Edit is cheap) or
40 KB (Edit must repeat 40 KB of exact text, and a Read of it costs about 10,000 tokens).

Facts that limit what a size field can do:

- **In the gates, arm M already used the server's tools for every edit.** In C0.8, arm M made no Read, Edit, Grep or
  Glob call; in C0.10, every run of arm M used an MCP tool. A size field has little choice left to improve on these
  task sets.
- **C0.10's overhead comes from the tool text, not from a wrong choice.** Both arms needed 3 turns; arm M's first
  request had about 1,050 more tokens of fixed text (analysis check of C0.10). A size field does not remove this; its
  description adds to it.
- **Arm M still read some whole files:** 3 runs in C0.8, 1 in C0.7, 0 in C0.9 and C0.10.

Prior art: Claude Code's Read refuses a file over 25,000 tokens and names the file's token count in the error (the
lead's knowledge of the tool; not checked in the runs, and not a documented interface). Playwright MCP's snapshot gives no size for each node
(`docs/prior-art.md`). The design below gives the size before any read, for each element, at a small cost.

## Options

Each option adds to the server's v2 code in `server/v2.mjs` and to the tool text in `server/tools-v2.json`. Any
change to the server means C0.1 v2 and C0.2 v2 must pass again before a v2 run (`v2ServerProblem`); both are free.

### A. A size on every element line that html_find shows

Each line gets `[3.1 KB, 74 lines]` after its attributes: the element's source range in bytes and in lines.

- **Build:** small. The range is in the parse already. A test for each part, and the golden outputs change.
- **Maintain:** small. The size follows the range rule that `html_change` already uses.
- **Cost in tokens:** about 8 tokens a line, up to 20 matches, and every child line of a find by `id`: up to about
  160 tokens more for each call. Plus about 35 tokens of description in every turn.
- **Gives:** the size of every target, small or large.

### B. A size only on elements of 1 KB or more (recommended)

The same field, but only when the element's source is 1 KB or more. The description says so, and says: "to change a
large element, use html_change with its ref; do not copy it into Edit".

- **Build:** as A, plus the threshold and its test.
- **Maintain:** as A. The threshold is one named number.
- **Cost in tokens:** nothing on a small match. About 8 tokens on each large one. About 40 tokens of description in
  every turn.
- **Gives:** the warning where it matters (a large target), and no cost on small tasks such as C0.10's.
- **The threshold:** 1 KB is a choice between the analysis's bands (500 and 2,000 characters). It was chosen after
  the results, so it is a design value, not a finding.

### C. The file's size in the last line of each html_find result

`1 match; hash …; file 48 KB, 1,210 lines`.

- **Build and maintain:** very small.
- **Cost in tokens:** about 8 tokens a call.
- **Gives:** what the owner first asked for. The analysis found that the file's size does not predict the ratio, so
  the value for tool choice is low. It could still save a failed whole-file Read of a file over 25,000 tokens.

### D. A new tool, `html_stat`, for sizes

- **Rejected:** a fourth tool adds its definition to every turn (C0.10: about 1,050 tokens for 3 tools) and needs an
  extra call.

### E. A size on every line of html_outline

- **Rejected:** an outline page can have thousands of lines; 8 tokens a line would add thousands of tokens to each
  page.

## Decision

Proposed: **option B**, with a 1 KB threshold. Option C is cheap and can be added with B if the owner wants the
file's size too. The lead does not expect B to change the gates' ratios much (see "Context"); its purpose is to keep
an agent from copying or reading a large element when the agent has a choice.

## How to test it (after the owner agrees; each paid step needs the owner's yes)

1. **Free:** unit tests and golden outputs for the field, then C0.1 v2 and C0.2 v2 again on the changed server.
2. **Free:** count the new tool text with Anthropic's free `count_tokens`, against the current text.
3. **Paid, small (about $1.60):** run arm M only, with the size field, on the frozen task sets of C0.7 v2 and C0.10
   v2, and compare with the recorded arm M of those gates. This shows harm (C0.10) and gain (C0.7) for the same tasks.
   It is not a gate: the arms ran on different commits.
4. **Paid, a gate (about $11):** if step 3 shows a gain, a gate with both arms on a mixed task set (small and large
   targets named by a quote), written in `docs/contract.md` before the run.

## Rejected

- **D and E:** see "Options".
- **An estimate of tokens in the field:** a token count depends on the model's tokenizer; bytes and lines are exact
  and the agent's Read works in lines.

## What would reopen this

- Step 1 or 2 shows that the field costs more tokens than estimated.
- Step 3 shows harm on C0.10's tasks, or no change on C0.7's.
- A measurement with tool search on (Claude Code's default) changes how the tool text costs.

## Amendments
