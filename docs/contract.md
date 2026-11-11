# Contract: the pass/fail gates

Each gate is a number fixed before the run it judges. A gate is moved only by a dated amendment with its reason,
never after the results are in. A missed gate is recorded as missed, with its numbers.

| Id | Phase | Gate | Judged on | Status |
|---|---|---|---|---|
| C0.1 | 0 | `html_edit` writes exactly the bytes before the node, the new HTML, and the bytes after the node: 0 failures | The task set's edits and 1,000 random edits; an independent HTML5 parser finds each node | Agreed (owner, 2026-11-10) |
| C0.2 | 0 | Hostile files cause no wrong edit, no forged or stale ref, no path escape and no hang: 0 failures | The hostile file set; a script | Agreed (owner, 2026-11-10); amended (owner, 2026-11-10) |
| C0.3 | 0 | Ideal-path tokens with the MCP are at most 0.50 of the baseline's cheapest ideal path (median per task) | The file set and the task set; `count_tokens` | **FAILED** (2026-11-11): median 0.739, `docs/measurements/2026-11-11-c03-result.md` |
| C0.4 | 0 | With the MCP, an agent uses at most 0.70 of the baseline's tokens per task (median), and its success rate is not more than 5 points below the baseline's | The file set, the task set, 3 runs per task and arm; Claude Sonnet 5.5 | Agreed (owner, 2026-11-10); amended (owner, 2026-11-10) |
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

1. C0.3 runs first, on a prototype (amendment of 2026-11-10, "C0.3 first"). C0.1 and C0.2 must pass before C0.4
   runs.
2. When a correctness gate (C0.1, C0.2) fails, the miss stays recorded. Each failed case becomes a regression test.
   Then the gate runs again.
3. When C0.3 fails, the work stops before the paid run. This is the owner's choice to save cost, not a proof that
   C0.4 would fail.
4. C0.3 and C0.4 run once each. A run is not repeated to get a better number.

### The two arms

Both arms use the same model, the same harness, the same settings and the same prompt. Only the tools differ.

- **Baseline (B):** the harness's file tools Read, Edit, Grep and Glob.
- **MCP (M):** the MCP server's four tools, plus Grep and Glob:
  1. `html_outline(file)`: the reading view, one element on each line, with an `@n` ref. It returns pages of at most
     20,000 tokens and a file hash.
  2. `html_find(file, text)`: finds `text` as a literal, case-sensitive string. It refuses an empty `text`.
     - An element's visible text is its text nodes joined in order, with entities decoded and runs of ASCII
       whitespace as one space. Text inside hidden content (the list in C0.2), `script`, `style`, `svg` and
       `template` is not visible text.
     - A match is a deepest element whose visible text contains `text`: no child element of a match also contains it.
     - For each match, the output holds the outline line of the match and of each ancestor. It holds no line of a
       descendant. A line that two matches share appears once.
     - It returns at most 20 matches, in document order, and the total count of matches. Its output is at most 20,000
       tokens. It also returns the file hash.
  3. `html_read(file, ref, hash)`: one node, as the bytes of the original file.
  4. `html_edit(file, ref, hash, html)`: replaces the bytes of one node. It refuses a stale hash and a fragment that
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
- **The `html_find` cases:**
  1. A search text that is only in hidden content. The expected count is 0.
  2. A search text that matches text in `pre`, where that text looks like an element line with a ref.
  3. A search text that is in 10,000 elements. The expected count is 10,000, as the oracle counts it.
  4. A file that holds the literal text `.*(a+)+$` once, and the text `'a'.repeat(30) + '!'` once. The search text
     is `.*(a+)+$`. The expected count is 1.
  5. An empty search text.
- **The stale-ref case:**
  1. Run `html_outline`, and separately `html_find`.
  2. Change the file.
  3. Call `html_edit` with the old hash.
- **The path cases:** `..`, an absolute path, a UNC path, a Windows device name, an alternate data stream, and a link
  or junction out of the workspace. Each case runs with each of the 4 tools.
- **Pass:** all of these hold.
  1. Each line of `html_outline` and `html_find` output, after its indent, starts with `@<n> ` (an element) or `| `
     (text). In `html_outline`, each ref appears once. Each ref names an element that the oracle finds.
  2. A `<` that comes from text appears as `&lt;` in the view.
  3. Hidden content (the list above) is left out of `html_outline`, or marked `(hidden)`. `html_find` never matches
     it, and its count leaves it out.
  4. `html_find` gives the expected count in each of its cases, returns at most 20 matches, and refuses the empty
     search text with a named error.
  5. A `data:` URI longer than 100 characters is shortened, with its length named.
  6. The stale-ref call and every path case fail with a named error. No file changes.
  7. Each call returns, or fails with a named error, within 2 s. A call that the harness kills counts as a failure.
     Each case runs 5 times. The report names the machine and gives p50 and p99.
- **Negative controls.** Each of these must make C0.2 fail:
  - the POC's current view, on the nested `pre` case (condition 1);
  - a planted backtracking regex (condition 7);
  - an `html_find` that reads its search text as a regular expression (condition 4);
  - an `html_find` that matches hidden content (condition 3);
  - an `html_find` with no limit on matches (condition 4).

**C0.3, ideal-path tokens (no model run; `count_tokens` is free but needs an API key and the owner's yes).**

- **The model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), the same as in C0.4.
- **For each task, a script builds each arm's shortest path as text:**
  - **B:** the cheaper of 2 paths.
    1. Read the whole file, in as many read calls as the harness's read limits need. The run plan names those limits.
    2. One Grep for the quoted words, then one read of the matched lines with 20 lines before and after them.
  - **M:** the cheaper of 2 paths.
    1. `html_outline` (all its pages), then `html_read` of the target.
    2. `html_find` with the quoted words, then `html_read` of the target.
  - **Both:** the path ends with the edit call, or with the `ANSWER:` line for a question. Each path includes the
    arm's tool definitions and the arm's edit payload: B's Edit sends the old and new strings; `html_edit` sends the
    new node.
- **When a path is valid:**
  - B's path 2 is valid only when Grep finds the quoted words in at least one line, and the read holds the target's
    start tag.
  - M's path 2 is valid only when the target is among the matches that `html_find` returns.
  - An arm with one valid path uses that path.
- **The ratio:**
  - The ratio of a task is M ÷ B.
  - The gate takes the median over the 40 tasks: the mean of the 20th and 21st values.
- **Pass:** the median is ≤ 0.50.
- **The report also gives** the median ratio of each M path alone. It does not change the verdict.

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

- **C0.3 at 0.50:** an ideal path that does not save half leaves too little for the real path's extra turns. When the
  owner set the number, the evidence was the POC's view: 60% smaller (median) than minified HTML, in proxy tokens, on
  live pages. After the amendment below, C0.3 judges the server's cheapest path (outline or find), not the outline
  alone.
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

### Amendments

**2026-11-10 (owner): `html_find` added, before any gate run.**
- **Reason:** a risk check outside the gate's file set (`docs/measurements/2026-11-10-c03-risk-check.md`) showed that
  the baseline's Grep path is cheap. On 3 small synthetic files (proxy tokens, 50 seeds, with tool definitions and
  edit payloads):
  - With the outline as its only way to find a node, the MCP's ideal path cost a median of 0.49 to 0.89 of the
    baseline. 2 of the 3 files passed 0.50 in no seed.
  - With a find tool, it cost a median of 0.31 to 0.73. 2 of the 3 files passed in most seeds; 1 failed in most.
  - So a find tool makes C0.3 uncertain, where the outline alone would probably fail. It does not make C0.3 likely to
    pass.
- **The change:**
  1. M has a fourth tool, `html_find`, with the definition above.
  2. In C0.3, M's ideal path is the cheaper of outline + read and find + read. C0.3 now judges the server, not the
     outline alone. The report gives each path's median.
  3. C0.3 counts the edit payloads, and states when each path is valid.
  4. C0.2 has 5 more hostile cases and 3 more negative controls, for `html_find`. The path cases run with each tool.
- **No number changed.** No gate input (file set, task set) was chosen or looked at.

The owner approved the corrected text of this amendment on 2026-11-10.

**2026-11-10 (owner): C0.3 first, on a prototype, before any gate run.**
- **Reason:** C0.3 is the cheapest gate that can stop the work, and it needs only the text of the tools' outputs, not
  a working server. The risk check made C0.3 uncertain, so its answer should come before the cost of a server.
- **The change:**
  1. C0.3 runs before C0.1 and C0.2.
  2. A prototype makes the outputs of `html_outline`, `html_find` and `html_read` from the definitions in this
     contract, with the independent HTML5 parser. It does not write files. The server, if it is built, must give the
     same outputs on the file set; a test compares them.
  3. C0.1 and C0.2 must still pass before C0.4.
- **No number changed.** No gate input (file set, task set) was chosen or looked at.

**2026-11-11 (owner): a proxy preview of C0.3 before its gate run.**
- **Reason:** the owner wants to see an early result before the API key is set up.
- **The change:**
  1. All C0.3 inputs and code are committed and frozen first (`experiments/c03/run-inputs.json`).
  2. A preview counts each path with the POC's two offline proxies on the frozen inputs. It is labelled "PREVIEW, not
     the gate verdict", and it decides nothing.
  3. The gate run then uses `count_tokens` on the same commit, and gives the verdict. Rule 4 of "Order of the gates"
     still holds: the gate run is not repeated.
  4. A change to any frozen input after the preview needs a dated amendment that says it came after the preview. The
     report then calls the result weaker.
- **No number changed.**

**2026-11-11 (owner): C0.3 failed; no-go, and a rescope.**
- **The result:** median 0.739 against 0.50 (`docs/measurements/2026-11-11-c03-result.md`). C0.3 stays failed. By
  rule 3 of "Order of the gates", C0.1, C0.2 and C0.4 do not run for the server as specified.
- **The next step:** a new question and a new gate, written in this file before their run (decision 0005).
- **No number changed.**
