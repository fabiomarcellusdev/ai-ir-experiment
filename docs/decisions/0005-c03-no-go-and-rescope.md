# 0005. Gate C0.3 no-go, and a rescope on the same branch

**Status:** Accepted (owner, 2026-11-11). The owner agreed to the rescope gates C0.5 and C0.6 on 2026-11-11 (amendment below).

## Context

Gate C0.3 asked: on ideal paths, does the MCP cost at most 0.50 of the baseline's cheapest path (median per task)?

- **The verdict:** FAIL. The median ratio is 0.739 (`count_tokens`, `claude-sonnet-5-5`, 10 files, 40 tasks,
  `docs/measurements/2026-11-11-c03-result.md`). 2 of 40 tasks are at 0.50 or less. The `analysis-checker`
  recomputed every number and found 0 differences.
- **The cheapest paths:** in all 40 tasks, the baseline's cheapest path was Grep plus a 41-line read, and the MCP's
  was `html_find` plus `html_read`. The outline path cost about 2 times the baseline.
- **A diagnostic after the verdict (exploratory, not a gate number):** `count_tokens` on the tool definitions alone.
  - The baseline's 4 tools cost 2,795 tokens; the MCP arm's 6 tools (Grep, Glob and the 4 MCP tools) cost 2,506.
  - They are 67% of the baseline's median count and 82% of the MCP's.
  - If the MCP's work cost 0 tokens, the median ratio would still be 0.603. So C0.3, as written, could not pass with
    these definitions, whatever the reading view does.
  - Without the tool definitions, the median ratio of the work alone is 0.392 (median work: baseline 1,361 tokens,
    MCP 551). This number comes from the same 40 tasks that decided the gate, so it is a hypothesis, not evidence.
- **What C0.3 did not model:** a real session sends the tool definitions with every request, and an MCP server adds
  its definitions to the harness's tools; it does not replace Read and Edit. A real agent may also read more than the
  ideal path. Gate C0.4 measures real agents, and it has not run.

Prior art (`docs/prior-art.md`) shows structural edit tools for source files and compact views for live pages. None
measured an HTML reading view against a Grep-capable agent with the tool definitions counted. This result adds that.

## Options

1. **Stop the experiment.** Build cost: 0. Maintain cost: 0. Gives: the no-go, recorded.
2. **Record the no-go, then rescope on the same branch.** Build cost: a new question, a new gate written before its
   run, and new inputs. Maintain cost: the branch and its records grow until the owner ends the experiment. Gives:
   an answer to a narrower question that the C0.3 data points to.
3. **Move C0.3's number, or change its analysis, and call it a pass.** Build cost: small. Maintain cost: every later
   claim loses its value.

## Decision

Option 2 (owner, 2026-11-11):
1. C0.3 stays FAILED, with its numbers. The MCP server, as C0.3 specified it, is a no-go.
2. The experiment continues on `p0/feat-hir-viability` until the owner says otherwise.
3. The rescope is a new question with a new gate, written in `docs/contract.md` before its run, and agreed by the
   owner.
4. A new gate does not reuse C0.3's 40 tasks to judge itself: those tasks shaped the new question. It uses a new
   draw (a new seed, and new files where possible).

## Rejected

- **Option 1:** the owner chose to continue.
- **Option 3:** a threshold chosen after the results is a description, not a gate (`AGENTS.md`, hat 2).

## What would reopen this

- A new gate result that passes on fresh inputs, and then a real-agent result (C0.4 or its successor).
- A harness that loads MCP tool definitions only when they are used. Then the fixed cost that sank C0.3 changes.

## Amendments

**2026-11-11 (owner):** the owner agreed to gates C0.5 (work tokens, ≤ 0.50) and C0.6 (real agents with the MCP added, ≤ 0.70, success within 5 points). An independent review then led to procedural fixes, with no number changed (`docs/contract.md`, "Amendments of the rescope").
