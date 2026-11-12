# 0008. Fewer turns: consolidated tools for the HTML MCP server

**Status:** Proposed (lead, 2026-11-12). It follows the owner's choice of decision 0007, option 2 (amendment of
2026-11-12). Nothing is built until the owner agrees.

## Context

The evidence, all with Claude Code 2.1.322 and `claude-sonnet-5-5`:

- **C0.6 (240 runs, FAIL 1.40):** tokens grow with turns, because each turn sends the conversation again. The MCP
  agent took 5 turns where the baseline took 3.5. Without its 720 definition tokens a request, the ratio would still
  be about 1.21 (an estimate from the records). So shorter definitions cannot pass a gate; fewer turns can.
- **Research (2026-11-12, `researcher` agent; sources in its report):** tool search and deferred loading help with
  10 or more tools and add a turn for fewer; code execution with MCP needs a sandbox that headless Claude Code does
  not give to MCP tools; Anthropic's guidance ("Writing effective tools for agents") is a few consolidated tools that
  each do a whole workflow, and it warns that tools which overlap distract the agent.
- **The previews (`docs/measurements/2026-11-12-c07-c09-previews.md`, 1 run per task, decide nothing):**
  - Large elements (H1), 0.513: `html_find` gave the ancestors' refs, and `html_edit` changed the element by its ref
    with no read. Glob, find, edit: 3 calls.
  - Quotes not in the source (H4), 1.194: for a small change, `html_edit` needs the whole element again, so the
    agent called `html_read` first. Glob, find, read, edit: 4 calls, where the baseline needed Grep and Edit.

So 3 calls of the MCP arm do not depend on the task: Glob (to learn the file name), `html_read` (to send the element
back) and the final reply. Only the first two can go.

## Options

| Option | Build | Maintain | Gives (calls before the reply, estimated) |
|---|---|---|---|
| A. Keep the 4 tools | 0 | 0 | Measured: Glob, find, read, edit (H4 and C0.6); Glob, find, edit (H1) |
| B. Change the outputs only: `file` optional when the workspace holds one `.html` file; `html_find` also gives each match's attributes | Small: 2 changes in `server/`, C0.1 and C0.2 again | Small | find, read, edit; a question: find |
| C. Consolidated tools: `html_find`, `html_change` with operations on a ref, `html_outline`; no `html_read` | Medium: new operations, their checks, new tool text, C0.1 and C0.2 again | Medium: 5 operations to keep correct | find, change; a question: find |
| **D. C, and `html_change` also takes a locator in place of a ref** | Medium-high: C, plus a locator that must match exactly 1 element | Medium | **change; a question: find** |
| E. One tool for each task kind (H1 to H6) | High: 6 tools | High: 6 tools to keep apart | Like D, but 6 definitions in every request, and tools that overlap |

**The tools of option D:**

1. `html_find(text | id, file?)`: as now, the deepest elements whose visible text holds `text`, with their
   ancestors' lines and refs. New: an `id` in place of `text` gives that element and its child elements' lines; each
   match also gives its own attributes, values in full up to a limit; `file` is optional when the workspace holds one
   `.html` file.
2. `html_change(target, operation, file?)`: `target` is a ref with its hash, or a locator: `{text}` (the deepest
   element that holds it, optionally with its tag) or `{id, child, n}` (the n-th child with a tag). A locator that
   matches 0 elements or more than 1 changes nothing, and returns the matches as `html_find` does. Operations:
   `remove`, `replace` (new HTML), `insert_after` (new HTML), `set_attribute` (name, value), `replace_text` (old visible
   text, new text, inside one text node). Every operation keeps the checks of decision 0006: the clean range, the
   tree outside the element kept, the stale hash, the time limit.
3. `html_outline(file?, page)`: as now, for questions about structure.

`html_read` goes, because no operation needs the element's bytes; the built-in Read stays in the M arm.

## Decision (proposed)

Option D, because it removes the 2 calls that do not depend on the task. A change of a target that the prompt
quotes would take 1 call and the reply: 2 turns, where the clean baseline takes 3. That is the lead's estimate, not
a measurement.

**What would make it fail:**
- The agent may still call `html_find` first, to see the target before it changes it. Then the gain is 1 turn, not 2.
- The definitions grow (a locator and 5 operations). The lead estimates about 900 to 1,100 tokens for the 3 tools,
  against 720 for the 4 now. That costs about 300 tokens a turn.
- A locator that matches the wrong element would be a wrong edit. The rule "exactly 1 match, else no change" and C0.1
  guard against it.

## The gates (to be written in `docs/contract.md` after the owner agrees)

1. C0.1 and C0.2 run again on the new server, with the new operations in their edit lists (free).
2. Gates C0.7, C0.8 and C0.9 test the new server, on fresh draws with the fill rule of the contract's amendment "the
   previews first", 1, and with the pass rule of the second rescope.
3. **A proposed new gate, C0.10:** C0.6's task kind (a quoted text, as in C0.4's templates) on a fresh draw, with the
   new server. It answers whether the new design helps the general case, not only the 3 chosen kinds.
4. A preview of each gate on C0.5's files first (about $1 to $2 in all), then each gate with the owner's yes (about
   $3 to $10 each).

## Rejected

- **A:** measured; it fails on C0.6's task kind and on H4.
- **B:** a smaller step, but it keeps the read before every small change.
- **C:** it keeps the find before every change; D allows it but does not need it.
- **E:** more fixed text in every request, and tools that overlap.

## What would reopen this

- The previews of the new server show no fewer turns: then the agent does not use the locator, and the design must
  change, or the experiment ends.
- A harness that runs MCP tools from code (code execution with MCP): then one script could find and change.

## Amendments
