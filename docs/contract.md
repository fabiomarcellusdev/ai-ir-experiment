# Contract: the pass/fail gates

Each gate is a number fixed before the run it judges. A gate is moved only by a dated amendment with its reason,
never after the results are in. A missed gate is recorded as missed, with its numbers.

| Id | Phase | Gate | Judged on | Status |
|---|---|---|---|---|
| C0.1 | 0 | `html_edit` writes exactly the bytes before the node, the new HTML, and the bytes after the node: 0 failures | The task set's edits and 1,000 random edits; an independent HTML5 parser finds each node | Agreed (owner, 2026-11-10) |
| C0.2 | 0 | Hostile files cause no wrong edit, no forged or stale ref, no path escape and no hang: 0 failures | The hostile file set; a script | Agreed (owner, 2026-11-10) |
| C0.3 | 0 | Ideal-path tokens with the MCP are at most 0.50 of the baseline's cheapest ideal path (median per task) | The file set and the task set; `count_tokens` | Agreed (owner, 2026-11-10) |
| C0.4 | 0 | With the MCP, an agent uses at most 0.70 of the baseline's tokens per task (median), and its success rate is not more than 5 points below the baseline's | The file set, the task set, 3 runs per task and arm; Claude Sonnet 5.5 | Agreed (owner, 2026-11-10) |
| C1 | 1 | <...> | <...> | Tentative |

Status: **Tentative** means that the owner has not agreed to the gate yet. **Agreed** names the owner and the date.

## Rules for every gate

1. A number names how it was measured and on what.
2. A model result names the model and its version, the task set, the number of tasks and runs, and the spread.
3. A timing names the machine and the input size, and gives p50 and p99.
4. A difference smaller than the noise between repeated runs is reported as no difference.
5. A result from a small sample never reads as if it held in general.
6. The analysis of a gate is written here before its run: how the number is computed, the number of runs, and how the
   noise is judged.

## Phase 0: is an HTML reading-view MCP server viable?

MCP is the Model Context Protocol: a standard way to give an AI agent tools. The question: does an MCP server with a
reading view of HTML files reduce an agent's tokens on those files? It must not lower the agent's success.

The use case is an agent that reads and edits `.html` files in a project (owner, 2026-11-10). The proof of concept
(POC) behind this question is on the branch `exp/html-ir-poc` (pull request #1).

### Order of the gates

1. C0.1 and C0.2 must pass before C0.3 and C0.4 run.
2. When a correctness gate (C0.1, C0.2) fails, the miss stays recorded. Each failed case becomes a regression test.
   Then the gate runs again.
3. When C0.3 fails, the work stops before the paid run. This is the owner's choice to save cost, not a proof that
   C0.4 would fail.
4. C0.3 and C0.4 run once each. A run is not repeated to get a better number.

### The two arms

Both arms use the same model, the same harness, the same settings and the same prompt. Only the tools differ.

- **Baseline (B):** the harness's file tools Read, Edit, Grep and Glob.
- **MCP (M):** the MCP server's three tools, plus Grep and Glob:
  1. `html_outline(file)`: the reading view, one element on each line, with an `@n` ref. It returns pages of at most
     20,000 tokens and a file hash.
  2. `html_read(file, ref, hash)`: one node, as the bytes of the original file.
  3. `html_edit(file, ref, hash, html)`: replaces the bytes of one node. It refuses a stale hash and a fragment that
     does not parse to a closed set of nodes.

Both arms have no Bash, no subagent tool, no web tool and no other MCP server. The run plan names the mechanism that
removes them (for example `--disallowedTools`). The token count of M includes the MCP's tool definitions.

### The inputs, fixed before any run

All sizes use 1 KB = 1,000 bytes. The random seed for every draw is `20261110`.

**The file set: 10 `.html` source files, 2 of each kind.**

1. The lead runs these GitHub repository searches, sorted by stars:

   | Kind | Search |
   |---|---|
   | Marketing page | `landing page language:HTML` |
   | Documentation page | `documentation site language:HTML` |
   | Email template | `email templates language:HTML` |
   | App page or dashboard | `admin dashboard language:HTML` |
   | Blog or article page | `blog template language:HTML` |

2. For each kind, the candidates are the tracked `.html` files of the first 20 repositories with an OSI-approved
   licence.
3. The lead removes each candidate that matches one of these rules:
   - smaller than 10 KB or larger than 500 KB;
   - a path with `dist/`, `build/`, `_site/`, `out/`, `node_modules/`, `vendor/` or `gh-pages`;
   - a line longer than 2,000 characters (a minified file);
   - a comment or a `meta name="generator"` that says the file is generated;
   - a file from the POC's 5 pages.
4. The script draws 2 files for each kind with the seed.
5. The lead commits the candidate list, the rules' result and the draw before any token count or view runs on a
   candidate. The list names each file's repository, commit hash, path and SHA-256.
6. The file copies go in `experiments/gate-files/` (git-ignored): they are other people's content.

**The task set: 4 tasks for each file, 40 tasks in total.**

The independent parser (see C0.1) finds the candidate targets: the elements inside `body` that hold at least one word
of visible text. The script draws one target for each task with the seed, and writes the prompt from a fixed
template. Each prompt quotes up to 6 words of the target's visible text, so that the agent can find it.

| Type | Draw | Prompt template |
|---|---|---|
| 1. Question | One attribute of the target, `class` included | "What is the value of the `<attr>` attribute of the `<tag>` element that contains the text "<quote>"? End your reply with the line `ANSWER: <value>`." |
| 2. Text change | A text node of 3 words or more inside the target | "Change the text "<quote>" to "<new text>". Change nothing else." |
| 3. Attribute change | One attribute of the target, `class` included | "In the `<tag>` element that contains the text "<quote>", set the `<attr>` attribute to "<new value>". Change nothing else." |
| 4. Structure change | Even file numbers: insert; odd file numbers: remove | "After the `<tag>` element that contains the text "<quote>", add `<p>New text</p>`." / "Remove the `<tag>` element that contains the text "<quote>"." |

The script makes each expected result from the original bytes and the parser's source positions:

- **The target range** is the drawn element, from the start of its start tag to the end of its end tag. For an
  insertion, the target range is the empty range right after the drawn element.
- **The expected file** is the original file with one change inside the target range.
- The lead commits the task list and the SHA-256 of each expected file before the first run. The files themselves
  are not committed.

**How a result passes:**

1. A question passes when its last `ANSWER:` line, after trimming and decoding entities, equals the expected value. It
   fails when any file in the run's folder changed.
2. An edit passes when both of these hold:
   - every byte outside the target range equals the original;
   - the result's canonical DOM equals the expected file's canonical DOM.
3. The canonical DOM is the independent parser's tree, with entities decoded, attributes sorted, and runs of ASCII
   whitespace collapsed to one space outside `pre`, `textarea`, `script` and `style`.
4. Changed bytes inside the target range that do not change the DOM (indentation, quote style, attribute order) do
   not fail an edit. The report gives their count for each arm.

### How each gate is computed

**C0.1, edit fidelity (no model, no cost).**

- **The oracle:** an HTML5 parser that passes the html5lib tree-construction tests and is not the MCP's own parser.
  It needs a package, so it needs vetting and the owner's yes first.
- **The edits:**
  - every expected edit of the task set;
  - 1,000 random edits;
  - 2 files of the set also get CRLF, BOM and non-BMP copies, and the random edits include them.
- **One random edit:**
  1. Take a fresh copy of the file.
  2. Draw a ref from all refs, with the seed.
  3. Draw the new HTML from this list: the empty string, `<p>x</p>`, text with CRLF, text with a character outside
     the BMP, `</div><div>`, `<!--`, `<script>`.
- **Pass:** for each edit, both of these hold.
  1. The result equals the original bytes before the oracle's node, plus the new HTML, plus the original bytes after
     it.
  2. An unbalanced fragment (`</div><div>`, `<!--`, `<script>`) gets a named error, and the file stays unchanged.
- **Negative controls.** Each of these broken versions of `html_edit` must make C0.1 fail:
  - a version that moves the node by 1 byte;
  - a version that writes the whole file again from the tree;
  - a version that changes CRLF to LF.

**C0.2, hostile files (no model, no cost).**

- **The hostile file set** (committed in `tests/gates/`):
  1. Text in `pre` and `textarea`, at depth 0 and nested, that looks like an element line with a ref.
  2. Hidden content that holds instructions to the agent. "Hidden" is this closed list:
     - the `hidden` attribute;
     - `aria-hidden="true"`;
     - an inline `style` with `display:none` or `visibility:hidden`;
     - `<input type="hidden">`;
     - `<template>`.
  3. Text that becomes markup when an element between two text nodes is removed (`x <` + `<script>` + `b>y`).
  4. A `data:` URI of 100 KB.
  5. Attribute values with line breaks and with both quote kinds.
  6. An unclosed comment and an unclosed `script`.
  7. Nesting of 513 levels (the POC's limit is 512).
  8. A 25 MB file.
  9. The two backtracking inputs of the POC's security review: `'<a' + ' x="1"'.repeat(40)` and
     `'<p><a' + ' x="1"'.repeat(40) + ' "bad">l</a></p>'`.
- **The stale-ref case:**
  1. Run `html_outline`.
  2. Change the file.
  3. Call `html_edit` with the old hash.
- **The path cases:** `..`, an absolute path, a UNC path, a Windows device name, an alternate data stream, and a link
  or junction out of the workspace.
- **Pass:** all of these hold.
  1. Each line of `html_outline` output, after its indent, starts with `@<n> ` (an element) or `| ` (text). Each ref
     appears once, and names an element that the oracle finds.
  2. A `<` that comes from text appears as `&lt;` in the view.
  3. Hidden content (the list above) is left out, or marked `(hidden)`.
  4. A `data:` URI longer than 100 characters is shortened, with its length named.
  5. The stale-ref call and every path case fail with a named error. No file changes.
  6. Each call returns, or fails with a named error, within 2 s. A call that the harness kills counts as a failure.
     Each case runs 5 times. The report names the machine and gives p50 and p99.
- **Negative controls:**
  - The POC's current view must fail condition 1 on the nested `pre` case.
  - A planted backtracking regex must fail condition 6.

**C0.3, ideal-path tokens (no model run; `count_tokens` is free but needs an API key and the owner's yes).**

- **The model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), the same as in C0.4.
- **For each task, a script builds each arm's shortest path as text:**
  - **B:** the cheaper of 2 paths.
    1. Read the whole file, in as many read calls as the harness's read limits need. The run plan names those limits.
    2. One Grep for the quoted words, then one read of the matched lines with 20 lines before and after them.
  - **M:** `html_outline` (all its pages), then `html_read` of the target.
  - **Both:** the path ends with the edit call, or with the `ANSWER:` line for a question. Each path includes the
    arm's tool definitions.
- **The ratio:**
  - The ratio of a task is M ÷ B.
  - The gate takes the median over the 40 tasks: the mean of the 20th and 21st values.
- **Pass:** the median is ≤ 0.50.

**C0.4, agent tasks (PAID: the lead announces the cost estimate first, and waits for the owner's yes).**

- **The runs:**
  - Each of the 40 tasks runs 3 times in each arm: 240 runs.
  - The script numbers each task's runs 1 to 3 in each arm. Run k of all tasks is round k.
  - The run order is random with the seed.
- **Isolation:**
  - Each run starts in a new temporary folder that holds only the task's file.
  - The harness loads no project instructions, no user settings and no private notes.
  - The run plan names the harness version, and turns automatic updates off.
- **Limits:**
  - A run has at most 40 turns and 10 minutes.
  - A run that hits a limit counts as failed, with the tokens it used.
  - An API error before the first tool call gets one more run.
  - Any other error counts as failed, a crash of the MCP server included.
- **Tokens of a run:** the API's usage report, over all turns and all models of the run. The count is the sum of
  input, cache-write, cache-read and output tokens. A cached token counts as one token, so prompt caching cannot
  change the ratio.
- **The token ratio:**
  - The ratio uses only the tasks where each arm passed at least once.
  - For each of those tasks: the median tokens of M's passed runs ÷ the median tokens of B's passed runs.
  - The gate takes the median over those tasks, as in C0.3. This keeps a fast failure from lowering the ratio.
  - When fewer than 20 tasks qualify, C0.4 fails.
  - The report also gives the ratio over all runs.
- **Success rate:** passed runs ÷ 120, for each arm.
- **Pass:** all of these hold, on the point estimates.
  1. The median token ratio is ≤ 0.70.
  2. M's success rate is ≥ B's success rate − 5 points.
  3. No task type has an M success rate more than 15 points below B's.
- **Noise (it is reported; it does not change the verdict):**
  - A paired bootstrap over the 40 tasks: 10,000 resamples with the seed, and a 95% interval.
  - The bootstrap covers the success difference (M passes − B passes for each task) and the median token ratio.
  - A difference whose interval contains 0 is reported as "no difference".
- **The report also gives:**
  - the result for each task type;
  - the result for each file size: 10 KB to 50 KB, and over 50 KB;
  - the number of turns;
  - the byte changes inside the target range;
  - the cost in dollars.
- **The run plan:** the lead commits it before the run. It names the harness and its version, and the harness's
  read limit and MCP output limit. The MCP output limit must be at least the outline page size. The plan also names
  the tool settings of each arm and the machine.

### Why these numbers

- **C0.3 at 0.50:** on the POC's 5 live pages, the view with refs was 60% smaller (median) than minified HTML. That
  number used proxy tokens, not Claude's tokenizer, and live pages are not the use case here. An ideal path that does
  not save half leaves too little for the real path's extra turns.
- **C0.4 at 0.70:** the agent's fixed text (its system prompt and tool definitions) repeats on every turn, and the
  number of turns can differ between the arms. Its size is not measured yet; the run plan measures it. A large fixed
  text needs a much larger saving on the file content to save 30% in total.
- **Success within 5 points:** a tool that saves tokens but fails more tasks costs more in retries and in review.

### What the gates do not judge

- Templates (JSX, Vue, Jinja, Handlebars). The view reads plain HTML only.
- Files under 10 KB, generated files and minified files.
- Edits to more than one node, or to more than one file.
- Edits inside `script` or `style` content.
- A session in which the file is already in the agent's context.
- Hidden content that comes from CSS in a stylesheet or a class. The view cannot see it.
- Live web pages.
- Models and harnesses other than the ones in the run plan.
