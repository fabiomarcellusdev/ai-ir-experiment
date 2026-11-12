# 0007. After C0.6: test the task kinds where the reading view should do better

**Status:** Accepted (owner, 2026-11-12). The owner agreed to the direction, to hypotheses H1, H2 and H4, and to the
gate text in `docs/contract.md` ("Phase 0, second rescope"), after an independent review of 13 points.

## Context

Gate C0.6 failed: real agents with the MCP server used a median of 1.40 times the baseline's tokens (pass at 0.70 or
less), at equal success (`docs/measurements/2026-11-12-c06-result.md`). The reasons in the data:

- **Each task quoted a text that appears in the target's source as written.** The baseline found it with 1 Grep call
  and edited the line: a clean baseline edit took 3 turns. The MCP agent took 5 turns (Glob, `html_find`, `html_read`,
  `html_edit`, the reply). Tokens grow with turns, because each turn sends the conversation again.
- **The file names helped the MCP arm.** An exploratory check after the gate found that in 50 of 120 baseline runs
  and 17 of 120 MCP runs, the agent called a tool with the file name without its number (`build.html` for
  `1-build.html`). Without those runs, the ratio is 1.96, and no task is at 0.70 or less. The check does not show the
  cause; 60 of the 67 misread names came right after a Grep call.
- **The ideal path still favours the view:** C0.5 passed at 0.374 on work tokens.

So the view lost on the task kind where Grep is strongest. The owner asked on 2026-11-12 whether to test the task
kinds where the view should do better, each as a hypothesis with its own gate. The lead proposed 6 kinds; the owner
chose 3:

| Hypothesis | Task kind | Why the view should win with the current server |
|---|---|---|
| H1 | Remove a large element, or replace it with small HTML | Edit must send the whole old text, after a read of it. `html_edit` sends only the ref and the new HTML. |
| H2 | A target named by its position, with no quoted text | Grep cannot find a position. The outline shows the structure with refs. |
| H4 | A quoted text that is visible on the page but not in the source as written (an inline tag, an entity or a line break inside it) | Grep for the quote finds nothing. `html_find` matches the visible text. |

The lead's guess, not a measurement: H1 has the best chance. H2 has the most risk, because `html_find` cannot find an
`id`, and the outline page is large.

## Options

1. **Stop here.** Build cost: 0. Maintain cost: 0. Gives: the C0.6 verdict as the end of the experiment.
2. **Change the server first** (one call that finds and edits, no Glob step). Build cost: a new design, C0.1 and C0.2
   again. Maintain cost: as now. Gives: a lower turn count, but the lead's estimate is about 0.75 on C0.6's task kind,
   still a fail. A new design and new task kinds together cannot show which change caused a result.
3. **Keep the server as it is, and test the 3 task kinds,** each with a gate written before its run, on fresh
   inputs. Build cost: 3 draws, 3 task makers, runner modes, an analysis parameter, previews and gate runs (paid,
   about $12 to $25 in all). Maintain cost: the branch and its records grow. Gives: an answer for each task kind, with
   the server and its tool text unchanged.

## Decision

Option 3 (owner, 2026-11-12, "Yes to recommendations"):
1. C0.6 stays FAILED. The viability verdict for C0.6's task kind does not change.
2. The server, its tool text and the harness settings stay as they were in C0.6. The task kind changes. So do the
   files (a fresh draw for each gate), the seeds, the file names and the pass rule (stricter); the contract lists
   each change. The plain names remove a cost that the baseline paid in C0.6.
3. Each hypothesis gets a gate in `docs/contract.md`, agreed by the owner before any task of its gate is drawn.
4. A preview for each gate uses C0.5's files, which are not gate inputs, and decides nothing.
5. Each file keeps a plain name in the run folder, and the runner reports each missing-file error of any tool.
6. **The claim gets narrower.** A pass shows that the view helps on that task kind, with this model and harness. The
   report says that the lead chose the kinds after C0.6, to favour the view.
7. The work stays on `p0/feat-hir-viability`, with no push until the owner asks.

## Rejected

- **Option 1:** the owner chose to continue.
- **Option 2:** it changes two things at once. It can come after option 3, when a task kind shows a gain that a
  better tool could increase.
- **The other 3 kinds** (minified files, the same change in many places, questions about structure): not chosen now.
  Minified files and edits to more than one node are in the contract's list "What the gates do not judge"; a later
  amendment can add them.

## What would reopen this

- A gate of this rescope passes. Then option 2 on that task kind becomes the next question.
- All 3 gates fail. Then the experiment has no task kind left where the current view wins, and the owner decides
  whether to stop.
- A harness that loads MCP tool definitions only when they are used, or a change in how the gate counts cached tokens.

## Amendments

**2026-11-12 (owner): option 2 follows option 3's previews.** The owner asked whether fewer, consolidated tools
would cut the token overhead. Research (Claude Code tool search, the API's tool search, code execution with MCP,
Anthropic's "Writing effective tools for agents") and C0.6's records show that the turns, not the definitions,
decide the count: with no definition tokens at all, C0.6's ratio would be about 1.21, not 1.40. The owner chose to
run only the C0.7 and C0.9 previews with the current server, then to design the consolidated tools (option 2) and
amend gates C0.7 to C0.9 to test them (`docs/contract.md`, "Amendments of the second rescope").
