# Contract: the pass/fail gates

Each gate is a number fixed before the run it judges. A gate is moved only by a dated amendment with its reason,
never after the results are in. A missed gate is recorded as missed, with its numbers.

| Id | Phase | Gate | Judged on | Status |
|---|---|---|---|---|
| C0.1 | 0 | `html_edit` writes exactly the bytes before the node, the new HTML, and the bytes after the node: 0 failures | The task set's edits and 1,000 random edits; an independent HTML5 parser finds each node | Agreed (owner, 2026-11-10); amended (owner, 2026-11-11, decision 0006) |
| C0.2 | 0 | Hostile files cause no wrong edit, no forged or stale ref, no path escape and no hang: 0 failures | The hostile file set; a script | Agreed (owner, 2026-11-10); amended (owner, 2026-11-10; 2026-11-11, decision 0006) |
| C0.3 | 0 | Ideal-path tokens with the MCP are at most 0.50 of the baseline's cheapest ideal path (median per task) | The file set and the task set; `count_tokens` | **FAILED** (2026-11-11): median 0.739, `docs/measurements/2026-11-11-c03-result.md` |
| C0.4 | 0 | With the MCP, an agent uses at most 0.70 of the baseline's tokens per task (median), and its success rate is not more than 5 points below the baseline's | The file set, the task set, 3 runs per task and arm; Claude Sonnet 5.5 | Not run: C0.3 failed; C0.6 replaces it |
| C0.5 | 0 | Rescope: ideal-path work tokens (tool definitions and the prompt left out) with the MCP are at most 0.50 of the baseline's (median per task) | A fresh file set and task set; `count_tokens` | **PASSED** (2026-11-11): median 0.374, `docs/measurements/2026-11-11-c05-result.md` |
| C0.6 | 0 | Rescope: C0.4 with the MCP tools added to the baseline's tools: at most 0.70 of the tokens, success not more than 5 points below | The fresh sets, 3 runs per task and arm; Claude Sonnet 5.5 | **FAILED** (2026-11-12): median 1.40, `docs/measurements/2026-11-12-c06-result.md` |
| C0.7 | 0 | Second rescope (H1): C0.6 on the removal or replacement of a large element: at most 0.70 of the tokens, the interval below 1.00, success not more than 5 points below, and no task type more than 15 points below | Its own fresh draw, 40 tasks, 3 runs per task and arm; Claude Sonnet 5.5 | Agreed (owner, 2026-11-12) |
| C0.8 | 0 | Second rescope (H2): C0.6 on a target named by its position, with the same pass rule as C0.7 | Its own fresh draw, 40 tasks, 3 runs per task and arm | Agreed (owner, 2026-11-12) |
| C0.9 | 0 | Second rescope (H4): C0.6 on a quote that is not in the source as written, with the same pass rule as C0.7 | Its own fresh draw, 40 tasks, 3 runs per task and arm | Agreed (owner, 2026-11-12) |
| C0.10 | 0 | Second rescope, v2 tools (decision 0008): C0.6's task kind (a quote in the source as written) with the v2 tools, with the pass rule of C0.7 | Its own fresh draw, 40 tasks, 3 runs per task and arm; Claude Sonnet 5.5 | Agreed (owner, 2026-11-12) |
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
  rule 3 of "Order of the gates", C0.4 does not run. C0.1 and C0.2 run only as the rescope's order says.
- **The next step:** a new question and a new gate, written in this file before their run (decision 0005).
- **No number changed.**

## Phase 0, rescope: does the reading view cut the work? (decision 0005)

C0.3 failed (median 0.739). A diagnostic after its verdict showed that the tool definitions were 67% to 82% of each
count. With C0.5's definition of work tokens (below), C0.3's 40 tasks give a median of 0.374, and 35 of 40 tasks are
at 0.50 or less. That number came from the tasks that decided C0.3, so it is a hypothesis. The rescope tests it on
fresh inputs, and then with real agents.

### Order of the rescope gates

1. C0.5 runs first. It is free.
2. When C0.5 fails, the rescope stops before the server and the paid run.
3. When C0.5 passes, the server is built. C0.1 and C0.2 then run on it, on the new file set.
4. C0.6 runs only after C0.1, C0.2 and C0.5 pass, the lead announces its cost, and the owner says yes.
5. C0.5 and C0.6 run once each. A run is not repeated to get a better number. A run that stops with no verdict (the
   API's retries run out, or a work count is not above 0) may start again on the same commit; the report says so.

### The new inputs (a fresh draw)

- **The pool:** the candidates of C0.3's committed record (`experiments/c03/file-set.json`) that passed the path
  rules, at the same pinned commits. The size limits are already applied, on the tree's blob size; the draw does not
  check them again.
- **Removed from the pool:**
  - every repository whose owner is the owner of a C0.3 pick (7 owners), so no near-copy of a C0.3 file comes back;
  - in a later kind, each repository that an earlier kind of this draw picked.
- **The rules for a downloaded file, in this order:**
  1. C0.3's content rules (a line over 2,000 characters, a generator `meta`, a "generated" comment).
  2. **The template rule:** the file holds `{{`, `{%`, `<%` or `<?php` anywhere. "What the gates do not judge"
     leaves out templates.
  3. **The task rule:** the file can give all 4 task types with the C0.3 task rules, both as an odd file (a removal)
     and as an even file (an insertion).
- **The draw, for each kind in C0.3's order, with the C0.3 generator in one stream, seed `20261111`:**
  1. Sort the pool's repositories by their full `owner/repo` name (UTF-16 code-unit order), and shuffle them
     (Fisher-Yates). Take them in that order.
  2. In a repository, sort its files by path, and shuffle them. Read them in that order. The first file that passes
     the rules is the repository's pick. A repository with no passing file gives no pick.
  3. Stop at 2 picks.
  4. When the repositories run out with 1 pick, the second pick is the next passing file of the first pick's
     repository, in the same order. With 0 picks, the draw stops with an error, and the rescope needs an amendment.
- **The script:** `experiments/c05/draw-files.mjs`, committed before its first run. The record holds the SHA-256 of
  the script and of each module whose rules it uses, and the parser's version. The draw runs once: the script refuses
  to run when a record exists or its inputs have uncommitted changes.
- **The task rule is an existence check:** for each task type, the script tests every candidate target with the C0.3
  rules. `makeTasks` draws at random with at most 10,000 tries, so it can still miss a rare target. If the task set
  then fails, the draw's record stands, and the rescope needs an amendment.
- **The task set:** 4 tasks for each file, 40 in total, from the C0.3 task rules and templates, with the seed
  `20261111` (`experiments/c05/tasks.mjs`).
- The lead commits the record and the task set before any token count or view on them, as for C0.3.

### What C0.5 freezes

- The prototype and the tools stay byte-identical to their hashes in C0.3's committed result
  (`experiments/c03/c03-result.json`): `html.mjs`, `mcp-tools.json`, `baseline-tools.json` and `run-c03.mjs`.
- `experiments/c05/run-inputs.json` freezes the task set, the record, the draw, task and run scripts,
  `make-tasks.mjs` and `select-files.mjs`. The runner has the list in its code, and it makes the task set again from
  the drawn files and compares.
- `make-tasks.mjs` changes in one way only: `makeTasks` takes the seed as a parameter, with C0.3's seed as the
  default. C0.3's task set comes out byte for byte the same.
- Any other change to these files needs a dated amendment.

### How the rescope gates are computed

**C0.5, ideal-path work tokens (no model run; `count_tokens` is free, with the owner's key).**

- **The tools:** C0.3's arms. B has Read, Edit, Grep and Glob. M has Grep, Glob and the 4 MCP tools.
- **The paths:** the 4 paths of C0.3 (B1, B2, M1, M2), with the same validity rules and closing turn. For a
  question, 2 short paths also count:
  - **B3, Grep alone:** valid when one matched line holds the target's whole start tag, within the first 2,000
    characters of the line.
  - **M3, `html_find` alone:** valid when the target is among the first 20 matches, and its outline line shows the
    attribute: the attribute is `id` or one that the view keeps, and the view does not shorten its value.
- **The work tokens of a path:** the path's `count_tokens` result, minus the `count_tokens` result of the same arm's
  tools with only the task's first user message. So the work tokens leave out the tool definitions and the prompt.
  They hold every call, every result, the final edit or answer and the closing turn.
- **The ratio:** for each task, M's cheapest valid work tokens ÷ B's cheapest valid work tokens. The gate takes the
  median over the 40 tasks: the mean of the 20th and 21st values.
- **Pass:** the median is ≤ 0.50.
- **Noise:**
  1. **The count:** before the run, the script counts the first 5 tasks' M2 path (B2 when M2 is not valid) 3 times
     each. When every repeat gives the same number, the run counts each request once. Otherwise it counts each
     request 3 times and uses the median, and the report says so.
  2. **The sample:** the report gives a 95% interval of the median from a bootstrap over files: 10,000 resamples of
     the 10 files with replacement, each file with its 4 tasks, with the seed. It does not change the verdict. When
     the interval contains 0.50, the report says that the result is not shown beyond the spread between files.
- **The report also gives:** the median ratio as C0.3 computed it (the paths B1, B2, M1 and M2, with the tool
  definitions and the prompt), each arm's fixed cost (the tool definitions; also for C0.6's M arm), the median ratio
  of each M path alone, the number of valid B3 and M3 paths, and the result for each task type. The script prints no
  number for a single task, except in the error that stops a run.

**C0.6, agent tasks with the MCP added (PAID: the lead announces the cost estimate first, and waits for the owner's
yes).**

- **The rules of C0.4 hold**, with these changes:
  1. The inputs are the rescope's file set and task set.
  2. **The MCP arm keeps the baseline's tools.** M has Read, Edit, Grep and Glob, plus the 4 MCP tools. This replaces
     M's tool list in "The two arms". Both arms still have no Bash, no subagent tool, no web tool and no other MCP
     server.
  3. **The MCP text is fixed:** the tool definitions are byte-identical to `experiments/c03/mcp-tools.json`. The
     server sends no server instructions, and its outputs give no advice on how to work. The run plan turns off the
     harness's deferred loading of tool definitions, and names the setting.
  4. **The noise:** the bootstrap resamples files, each with its 4 tasks, in place of tasks.
- **The report also gives:**
  - the share of M's runs that call at least one MCP tool;
  - each arm's fixed text per turn;
  - how often each arm reads a whole file. A run reads a whole file when it has a Read call with no `offset` and no
    `limit`, Read calls that together cover every line, or `html_outline` calls that return every page.
- **Pass:** as C0.4: the median token ratio is ≤ 0.70, M's success rate is ≥ B's − 5 points, and no task type has an
  M success rate more than 15 points below B's.

### Why these numbers

- **C0.5 at 0.50:** the same aim as C0.3, to halve the cost, applied to the work that the reading view can change.
  The hypothesis from C0.3's tasks is 0.374, so C0.5 is a check on fresh files, not a hard test.
- **C0.6 at 0.70:** as C0.4. The MCP arm now pays more fixed text per turn (its 4 tool definitions, about 1,000 tokens
  measured with `count_tokens` on 2026-11-11). So C0.6 passes only when real agents read much more than the ideal
  path, for example whole files.

### What the rescope gates do not judge

- The items of "What the gates do not judge" above.
- A harness that loads MCP tool definitions only when they are used.
- The dollar cost: C0.6 counts a cached token as one token, as C0.4 does. The report gives the dollar cost.

### Amendments of the rescope

**2026-11-11 (owner): review fixes before any run.** The owner approved these fixes on 2026-11-11. An independent review of the gate text
found 17 points. The changes, before any draw, view or count on the new inputs:
1. The draw is fixed step by step, its script is committed before its first run, and its hash is recorded. "Or view"
   is back in the commit rule.
2. A file that cannot give the 4 task types is removed by a rule, and the draw has a fixed fallback when a kind runs
   out of repositories.
3. Templates are removed by a rule, to match "What the gates do not judge".
4. The prototype, the tools and C0.3's paths are frozen at C0.3's hashes.
5. B3 and M3 are added: for a question, Grep alone or `html_find` alone can answer.
6. The hypothesis is computed again with C0.5's own definition: 0.374, not 0.39.
7. The sample noise is reported with a bootstrap over files, for C0.5 and C0.6.
8. C0.6 fixes the MCP text, forbids server instructions, turns off deferred loading and defines a whole-file read.
9. The C0.3 amendment now says that C0.1 and C0.2 can run again for the rescope.
10. C0.5 names its tool sets. The same repository cannot be picked in 2 kinds. Owners of C0.3 picks are removed.
    The size rule, an aborted run, the noise requests and the table row are stated.
11. A second review, of the C0.5 code, led to: a task rule that checks every candidate, a draw that refuses to run
    twice or from uncommitted inputs, a freeze list in the runner's code with C0.3's hashes from its result, a check
    that remakes the task set, M3 not valid when the view does not show the attribute, and the report fields above.
- **No number changed:** C0.5 at 0.50, C0.6 at 0.70, 5 points and 15 points.

**2026-11-11 (owner): the server's design (decision 0006).** The owner agreed to decision 0006 on 2026-11-11, with
its 3 contract changes. They hold before any server code, and before C0.1 and C0.2 run:
1. **C0.1, the oracle:** html5lib 1.1 (Python) finds each node by the tree, with a comment marker (decision 0006,
   "The oracle check for C0.1"). The result must equal the original bytes minus one range, plus the new HTML at the
   range's start. The oracle confirms that the range holds exactly the ref's element. The script first runs html5lib
   on the html5lib tree-construction tests at a pinned commit, and records each failure.
2. **C0.1, the refusal rule:** `html_edit` refuses every fragment that changes the tree outside the element, with a
   named error, and the file stays unchanged. The 3 listed fragments (`</div><div>`, `<!--`, `<script>`) are examples
   of this rule. For each refusal, the oracle confirms that the splice changes the tree outside the element. For each
   accepted edit, it confirms that the tree outside does not change. A refusal that the oracle does not confirm is a
   failure.
3. **C0.2, the absolute path:** the server accepts an absolute path inside the workspace. The absolute-path case uses
   a path outside the workspace. The other path cases do not change.
- **No number changed.**

**2026-11-11 (owner): the C0.1 marker and draw, after the server build.** The server's property test showed that a
comment marker gives false failures: at the start of a document, the parser puts a comment in the document node. The
owner agreed to these changes on 2026-11-11, before the C0.1 script exists:
1. **The marker** of amendment "the server's design", 1, is an empty element with the element's own tag and one
   marker attribute (no end tag for a void element), not a comment. The parser places it as it placed the element.
2. **The 1,000 random edits** draw from all refs except the `html`, `head` and `body` elements. `html_edit` refuses
   these 3 by design (decision 0006), and the marker check cannot place them.
3. **The oracle uses html5lib's parser only.** A check fails when the C0.1 script imports html5lib's serializer, its
   sanitizer or its filters.
- **No number changed.**

**2026-11-11 (owner): the C0.1 oracle, the elements with no clean range, and the listed fragments, before the gate
run.** The C0.1 script's development runs (`--dev`, no result file) raised 3 questions. The owner decided them on
2026-11-11, before the gate run:
1. **The oracle stays html5lib 1.1.** At the pinned commit `9329e64` of `html5lib/html5lib-tests` (the last commit
   that holds the tree-construction tests), html5lib fails 180 of 1,792 tests and skips 63: mostly `template` (100),
   the `select` rules of 2025 (35) and `ruby` (13). Decision 0006 named this as a reason to reopen the oracle. On all
   10 files of the set and their 6 copies, html5lib's tree equals parse5's tree, token for token. The run also
   compares the two parsers on every marked and every spliced document, and the report names each one where they
   differ.
2. **An element with no clean range is not in the random draw.** These are elements that the parser creates (an
   implied `tbody`), and elements whose source range holds other nodes (misnested or fostered markup). The server
   refuses them by design (decision 0006, "A clean range"). A separate check tries every such element in the 16 files:
   each must get a named error, the file stays unchanged, and where the element has a source range, the oracle
   confirms that the range does not hold exactly the element.
3. **The 3 listed fragments are examples of the refusal rule**, as amendment "the server's design", 2 says. When the
   server accepts one (for example `</div><div>` inside a `select`, which the parser ignores, or `<script>` inside an
   `svg`, which is an SVG element), the edit passes when the oracle confirms that the tree outside the element does not
   change. The report lists each such edit.
- **The random draw:** the seed is `20261110` ("The inputs"). The 2 files with copies are drawn first, then each edit
  takes a file of the 16, a ref of that file, and a new HTML of the list, in this order, from one stream of the C0.3
  generator. The copies: CRLF line ends; a leading BOM; U+1F600 before each `</`.
- **No number changed.**

**2026-11-11 (lead): how the C0.2 script reads the gate, before the gate run.** No number changes. Two points are
stricter than the text; the owner is told in the hand-over.
1. **The hostile file set** is `tests/gates/hostile.mjs`: the small files are written out in it, and code makes the
   3 large ones (the 100 KB `data:` URI, the 10,000 elements, the 25 MB file), so that git holds no 25 MB file. The
   result records the SHA-256 of each file. "Nesting of 513 levels" is 513 nested `div` elements.
2. **Stricter: a call that reaches the server's time limit fails condition 7.** The server stops a call after 1.5 s
   and returns a named error (decision 0006, option 3A). Read literally, that error passes condition 7, and the
   planted backtracking regex could not make C0.2 fail. So the script counts it as a failure.
3. **Stricter: a call fails when its output holds the text of the file outside the workspace**, and when the server
   gives an internal error.
4. **Condition 1** applies to the content lines. The first line of `html_outline` (`page N of M; hash H`) and the last
   line of `html_find` (`N matches; hash H`) must match their own formats. `html_find` shows element lines only.
5. **The "no wrong edit" check:** for each hostile file that the server reads, one `html_read` and one `html_edit` of
   a fixed element. An accepted edit must give the bytes before, the new HTML and the bytes after. In
   `markup-join.html`, removing the `script` must be refused: the splice `x <b>y` makes a new element.
6. **"Each case runs 5 times":** the whole case list runs 5 times, each time with a new server process and a new
   workspace. The p50 and p99 are over all calls of the 5 runs. The link case uses a directory junction (a symbolic
   link outside Windows).
7. **The oracle** is html5lib 1.1, parser only (`experiments/c02/oracle_c02.py`, which uses the parse of
   `experiments/c01/oracle.py`). It gives the elements in ref order, and counts the `html_find` matches from the
   definition in "The two arms". Its list of text that is not visible is the contract's list; the server also leaves
   out `noscript`, which no hostile file holds.
8. **The negative controls:** the POC's view is the file `experiments/html-ir/ir.mjs` at commit `748a75d` (branch
   `exp/html-ir-poc`). Each other control is a copy of the server with one line of `server/view.mjs` changed. Each
   control must fail the condition that the contract names for it.

**2026-11-11 (lead): the C0.1 marker keeps the element's attributes, after the script's review, before the gate run.**
The owner is told in the hand-over. No number changes.
1. **The marker** of amendment "the C0.1 marker and draw", 1, is an empty element with the element's own tag, the
   element's own attributes, and one marker attribute. A `plaintext` marker also gets no end tag. Without the
   attributes, the premise "the parser places it as it placed the element" is false in 3 cases of the HTML standard:
   `<input type="hidden">` stays in a table only with its `type`; `<font>` with `color`, `face` or `size` leaves SVG
   and MathML; `</plaintext>` is text. The server's own marker check (decision 0006, last amendment) uses the same
   marker.
2. **The parser-only rule** checks the whole text of `oracle.py` except its module docstring (comments too), and, at
   run time, that no html5lib filter or sanitizer module is loaded. html5lib's package start loads its serializer and
   tree-walker modules; the oracle never calls them.
3. **An extra negative control:** a server whose range rule calls every located element clean. It must make C0.1
   fail. The byte check takes each range from the server's own view, and only the marker check confirms it; this
   control shows that a wrong range rule is found.

**2026-11-11 (lead): the C0.2 checks after the script's review, before the gate run.** No number changes; each point
makes a check stricter. The owner is told in the hand-over.
1. **`html_find` output** gets the checks of condition 1 too: element lines only, and each ref an element of the
   oracle with its tag. Condition 5 also applies to it.
2. **A file that the server must read** must give every `html_outline` page and the `html_find` call. A refusal there
   is a failure. The 2 files over the limits (`nest-513.html`, `large-25mb.html`) must be refused with their reason.
3. **Each refusal must give its reason:** each path case (`..`, outside, UNC, device name, stream, link), the stale
   hash, the removal in `markup-join.html`, and the files over the limits. The UNC case (`\?\` plus the outside
   path) and the stream case (a stream that holds the secret, on NTFS) point at real data.
4. **Condition 3** also fails when the outline shows the line of a hidden element, or of an element inside one, from
   the oracle's list of hidden elements.
5. **The hostile edits** are confirmed by the C0.1 oracle: the ref's tag, the exact range, and the tree outside.
6. **The stale-ref case** checks that `html_outline` and `html_find` each give the file's hash, and uses both hashes.
7. **Negative control 1** checks only the lines of the POC's nested `pre`, so that another POC line cannot make it
   fail.
8. **An extra hostile file,** `fostered-2mb.html` (1.9 MB): table rows that all need the server's marker parse
   (decision 0006, last amendment). It measures the worst case of that parse against the 2 s limit.

**2026-11-12 (owner): the lead's readings of C0.1 and C0.2 confirmed, after the gate runs.** The owner confirmed the
4 lead amendments of 2026-11-11 that the C0.1 and C0.2 verdicts depend on: the marker with the element's attributes;
the parser-only rule as checked (html5lib's own start loads its serializer module); the stricter C0.2 readings; and
the C0.2 checks after the review. The owner also saw the accepted `</div><div>` in place of an `img` in a table cell.
- **No number changed.**

**2026-11-12 (lead): C0.6's MCP output limit, before any C0.6 run.** Claude Code saves a text result over 50,000
characters to a file, whatever `MAX_MCP_OUTPUT_TOKENS` is, unless the tool declares a larger size. An outline page
holds up to 60,000 characters. So the server declares `_meta["anthropic/maxResultSizeChars"] = 65000` in `tools/list`,
to meet C0.4's rule "The MCP output limit must be at least the outline page size". The model-visible tool text (name,
description, input schema) stays byte-identical to `experiments/c03/mcp-tools.json`, as C0.6, rule 3 requires. The
run plan is `docs/measurements/2026-11-12-c06-run-plan.md`. The owner is told before the pilot.
- **No number changed.**

**2026-11-12 (owner): 3 C0.6 rules, after the review of the runner, before any C0.6 run.** The owner decided these on
2026-11-12. No run of C0.6 has started.
1. **Layout whitespace (amends "How a result passes", 2 and 3):** the canonical DOM leaves out a text node of only
   ASCII whitespace outside `pre`, `textarea`, `script` and `style`. The byte rule allows changes to the ASCII
   whitespace right next to the target range. So an insertion on its own indented line, or a removal of an element
   with its line, passes. Any other byte outside the range must stay the same, and the DOM rule still applies.
2. **An API or harness error stops the gate (amends C0.4, "Limits", for C0.6):** a run that ends with an API or
   harness error, after its one retry before the first tool call or after its first tool call, gets no record. The
   gate stops with no verdict (rescope order, 5), and that run runs again when the gate goes on, on the same commit.
   The report lists each such stop.
3. **A third run limit:** each run stops at $5 (`--max-budget-usd`). A run that reaches it fails, with its tokens, as
   a run that reaches 40 turns or 10 minutes.
- **The lead's reading of "Run k of all tasks is round k":** the 3 rounds run in turn; the order inside each round is
  random with the seed `20261111`.
- **No number changed.**

**2026-11-12 (owner): a C0.6 preview on C0.3's tasks, before the C0.6 gate run.**
- **Reason:** the owner wants an early, smaller look at the result before the 240 runs.
- **The preview:** C0.3's 40 tasks on C0.3's 10 files, which are not C0.6 inputs, with the C0.6 runner, harness and
  analysis at the committed run plan; 1 run of each task in each arm (80 runs), in one random order with the seed
  `20261111`. Its result (`experiments/c06/preview-result.json`) is labelled "PREVIEW": it decides nothing, and it
  runs once.
- **The C0.6 gate stays as written.** A change to the runner, the run plan or a C0.6 rule after the preview needs a
  dated amendment that says it came after the preview, and the report then calls the gate's result weaker.
- **No number changed.**

**2026-11-12: C0.6 failed; the viability verdict.**
- **The result:** median token ratio 1.40 over 39 tasks, against 0.70 or less (95% interval over files 1.14 to 1.92);
  success B 117 of 120, M 120 of 120 (`docs/measurements/2026-11-12-c06-result.md`). The `analysis-checker` agrees.
  C0.6 stays failed. By the rescope's order, 5, it does not run again.
- **The verdict of the experiment, as its gates define it:** the reading view, as an MCP server for an agent that
  edits HTML files, does not reduce the agent's tokens; with Claude Code 2.1.322 and `claude-sonnet-5-5`, it
  increases them. The next step is the owner's decision.
- **No number changed.**

**2026-11-12 (owner): a second rescope, for 3 task kinds (decision 0007).** C0.6 stays FAILED. The owner chose to
test 3 task kinds where the reading view should do better, and agreed to gates C0.7, C0.8 and C0.9 below on
2026-11-12, after an independent review of 13 points.

## Phase 0, second rescope: task kinds where the reading view should do better (decision 0007)

C0.6 failed at 1.40. Its tasks quoted a text that the C0.3 rules found in the target's source as written, and that
appears once in the visible text: the case where Grep is strongest. Each gate below tests one task kind where Grep is
weaker. **The lead chose these kinds after C0.6, to favour the view.** A pass shows a gain on that task kind only,
with this model and this harness.

### What stays the same as C0.6

- **The arms:** B has Read, Edit, Grep and Glob. M has the same, plus the 4 MCP tools.
- **The server and its text:** `server/` stays byte-identical to commit `d4f9927` (unchanged since C0.6's commit
  `7994dfa`), and the tool text to `experiments/c03/mcp-tools.json`. The server sends no server instructions.
- **The harness and its settings:** C0.6's run plan, `docs/measurements/2026-11-12-c06-run-plan.md`, except the points
  in "Allowed changes to the code" below.
- **The runs:** 40 tasks, 3 runs of each task in each arm (240 runs), in 3 rounds, in a random order inside each
  round.
- **The judge and how a result passes:** C0.4's rules, with the owner's C0.6 rule on layout whitespace.
- **The limits:** 40 turns, 10 minutes and $5 for a run; an API or harness error stops the gate.
- **The analysis:** C0.6's token ratio (passed runs, median over tasks, at least 20 tasks), success rates and
  bootstrap over files.

### Allowed changes to the code

C0.6's runner and analysis cannot run these gates unchanged. Only these changes are allowed:
1. One runner mode and one result file for each gate and for each preview.
2. The task types of each gate, as a parameter of the analysis. The 15-point rule then applies to those types.
3. The interval check of pass rule 2 below.
4. The seed `20261112` for the run order and the bootstrap.
5. The storage of the files under plain names (below).
6. The count of missing-file errors (`experiments/c06/wrong-name.mjs`), in the runner's records.

The lead writes a new run plan, `docs/measurements/<date>-c07-c09-run-plan.md`, with these changes only. It also names
the harness's limit of output tokens for one turn. Tests cover each change, and an independent review checks it.

### The inputs

1. **The seeds:** `20261112` for C0.7, `20261113` for C0.8 and `20261114` for C0.9.
2. **A fresh file draw for each gate:** 10 files, 2 of each kind. Each gate's draw uses C0.5's draw rules ("The new
   inputs"), with these changes:
   - The pool also loses every repository whose owner is the owner of a C0.5 pick: 17 owners in total, 7 of C0.3 and
     10 of C0.5.
   - **The name rule** (a path rule, before a file is read): the base name matches `^[A-Za-z0-9._-]+\.html$`, it is
     not a Windows device name, and it does not end in a dot.
   - **The task rule** is the gate's own: the file can give the gate's 4 tasks.
   - A file can be a pick of more than one gate. The gates are separate questions.
   - **The fallback:** when a kind gives 1 pick, C0.5's fallback applies. When a kind gives 0 picks, the gate uses
     the other kinds' files only (8 files, 32 tasks), and the report says so.
3. **Plain file names:** each file is stored in its own folder, under its base name in its repository (for example
   `experiments/gate-files/c07/c07/3/index.html`). Each gate keeps its expected files in its own folder. A run folder
   holds the file under that base name, with no number before it.
4. **The task sets:** one script for each gate, in `experiments/c07/`. Each script finds the full list of valid
   targets for each task, and draws from that list with the gate's seed. So the task rule and the draw cannot
   disagree. Each target has a clean range: html5lib 1.1 confirms that the source range from its start tag to its
   end tag holds exactly the element.
5. **"Visible text" and "shown"** come from the server's own view, `server/view.mjs` at `d4f9927`: what the M arm sees.
6. **Every edit task is one that `html_edit` can do.** For each edit task, the server's own check must accept the
   edit that gives the expected file, and html5lib must confirm that the tree outside the target does not change:
   - a removal: the target's range replaced with nothing;
   - a replacement: the range replaced with `<p>New text</p>`;
   - an insertion: the target replaced with its own bytes plus `<p>New text</p>`.

   This rule leaves out tasks that the server refuses, for example `<p>New text</p>` in place of a table row. That is
   a limit of the claim: the report gives the number of candidate targets that this rule removed.
7. **The freeze:** `experiments/c07/run-inputs.json` holds the SHA-256 of the draw script, the task scripts, every
   module whose rules they use, the records and the task sets. A task script refuses to run when its task set exists.
   The runner makes each task set again from the drawn files and compares, as C0.5's runner does.
8. **All 3 gates' scripts, records, task sets, the runner and the run plan are committed and frozen before the first
   paid run of this rescope,** the previews included.

### Pass rule of each gate

A gate passes only when all of these hold:
1. The median token ratio is ≤ 0.70.
2. **The upper end of the 95% interval of the median token ratio (bootstrap over files) is below 1.00.**
3. M's success rate is ≥ B's − 5 points.
4. No task type has an M success rate more than 15 points below B's.

The report also gives, for each arm: the runs with a missing-file error of any tool, the calls of each tool, and the
runs that read a whole file.

### C0.7: remove or replace a large element (H1)

- **The target:** an element inside `body`, not `html`, `head` or `body`, whose source range is at least 40 lines,
  at least 2,000 bytes and at most 50,000 bytes. The Read output of the target's lines (with Read's line numbers) is
  under 25,000 tokens, as `count_tokens` counts it (free, with the owner's key). The task script records each count.
- **The quote:** 3 to 6 consecutive words of the target's visible text, from start to end of words.
  - The quote appears exactly once in the file's visible text.
  - It appears exactly once in the source bytes, and that match lies inside one text node of the deepest element that
    holds the quote. So Grep finds the right place.
  - **The target is the only element with the target's tag on the path from the target down to the deepest element
    that holds the quote, that element included.**
  - The quote holds no `"` and no backtick.
- **The tasks:** 2 of each type in each file, with 4 different targets.

  | Type | Prompt template |
  |---|---|
  | Removal | "Remove the `<tag>` element that contains the text "<quote>". If several `<tag>` elements contain it, remove the innermost one." |
  | Replacement | "Replace the `<tag>` element that contains the text "<quote>" with `<p>New text</p>`. If several `<tag>` elements contain it, replace the innermost one." |

- **Why the view should win:** Edit must send the whole old text, after a read of it. `html_edit` sends the ref and the
  new HTML only.

### C0.8: a target named by its position (H2)

- **The parent:** an element whose `id` is the `id` of exactly one element in the file (template content included).
  The id matches `^[A-Za-z][A-Za-z0-9_-]*$`.
- **The target:** the k-th child element of the parent with tag T, in source order, with k ≥ 2. The prompt quotes none
  of its text.
- **Rules for the parent and all its child elements,** so that the outline, the tree and the source count the same:
  1. Each of them is shown in the outline: none is hidden content, `script`, `style`, `noscript`, `template`, `link`
     or `meta`, and none is inside an `svg`.
  2. Each child element has a clean range with an explicit end tag (or is a void element).
  3. html5lib's tree and parse5's tree give the same list of child elements.
- **The tasks:** one of each type in each file, with 4 different targets. Each task draws its parent, T and k from the
  full list of valid targets. A question and an attribute change draw one attribute of the target that has a
  source location, whose value is not empty and holds no `"`.
- **The ordinal:** English, with digits: "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd".

  | Type | Prompt template |
  |---|---|
  | Question | "In the element with id "<id>", take the <k-th> child element that is a `<tag>` element. What is the value of its `<attr>` attribute? End your reply with the line `ANSWER: <value>`." |
  | Attribute change | "In the element with id "<id>", take the <k-th> child element that is a `<tag>` element. Set its `<attr>` attribute to "<new value>". Change nothing else." |
  | Removal | "In the element with id "<id>", remove the <k-th> child element that is a `<tag>` element." |
  | Insertion | "In the element with id "<id>", take the <k-th> child element that is a `<tag>` element. After it, add `<p>New text</p>`." |

- **Why the view should win:** Grep cannot count elements, so the baseline must read the parent. The outline shows the
  children with their refs.
- **The lead's expectation:** this gate has the most risk. `html_find` cannot find an `id`, so M must read an outline
  page, and a page can hold up to 20,000 tokens.

### C0.9: a quote that is not in the source as written (H4)

- **The target:** C0.3's rule: the deepest element whose visible text holds the quote, and no other element with its
  tag holds the quote.
- **The quote:** 3 to 6 consecutive words of the target's visible text, from start to end of words. It appears
  exactly once in the file's visible text, and nowhere in the source bytes as written. It is not inside `pre` or
  `textarea`.
- **The causes, a closed list.** Each quote has at least one; the report counts each cause, and the quotes with 2 or
  more:
  1. **An inline tag:** an element of this list starts or ends inside the quote: `a`, `abbr`, `b`, `code`, `em`, `i`,
     `small`, `span`, `strong`, `sub`, `sup`, `u`. Each element boundary inside the quote lies next to ASCII
     whitespace in the visible text, so no words are joined.
  2. **An entity:** a named or numeric character reference that decodes to an allowed character (below).
  3. **Whitespace:** a line break, a tab or 2 or more spaces inside the quote in the source.

  A quote with a comment, a `br`, a `wbr` or another element inside it is not valid.
- **The allowed characters:** printable ASCII other than `"` and the backtick; letters (Unicode category L); and
  U+2013, U+2014, U+2018, U+2019 and U+2026. So U+00A0, U+00AD, U+200B to U+200D, U+2060 and U+FEFF are not allowed.
- **The tasks:** C0.4's 4 types and templates, one of each in each file (structure: insertion in even files, removal
  in odd files), with 4 different targets.
- **A text change** needs a quote inside one text node, so its cause is an entity or whitespace. The expected file
  replaces the source bytes that decode to the quote (entity text and line breaks included) with the new text.
- **Why the view should win:** Grep for the quote finds nothing. `html_find` matches the visible text, with entities
  decoded and whitespace collapsed.

### Order of the second rescope

1. The owner agrees to this text.
2. The lead writes the draw and task scripts and the code changes, with tests and an independent review.
3. The 3 draws run once each, and the lead commits the records and the task sets. The freeze (inputs, 8) holds from
   then on.
4. **A preview for each gate:** C0.5's 10 files (not inputs of these gates), stored under plain names. The gate's task
   script makes one task from each file, with the gate's seed:
   - C0.7: a removal in odd files, a replacement in even files;
   - C0.8: question, attribute change, removal and insertion, in turn by file number (file 1 a question, file 5 a
     question again);
   - C0.9: question, text change, attribute change and structure, in turn by file number (structure: insertion in
     even files, removal in odd files).

   A file that cannot give its task is skipped, and the report names it. A preview with fewer than 6 tasks does not
   run. Each task runs once in each arm. A preview decides nothing, and runs once. The lead announces its cost, and
   waits for the owner's yes.
5. **Each gate runs only after the owner's yes,** with its cost announced from its preview's measured cost. The gates
   are separate: the result of one does not decide another. Each gate runs once (rescope order, 5).
6. **A change after a preview** to the runner, the run plan, a task set or a rule of this rescope needs a dated
   amendment that says it came after the preview. The gate's report then calls its result weaker.

### Why these numbers

- **0.70, 5 points and 15 points:** as C0.4 and C0.6, so the results compare.
- **The interval below 1.00:** with 3 gates, one can pass by chance more easily than one gate alone. A percentile
  bootstrap over 10 files gives a narrow interval, so this rule is a minimum check, not a proof.
- **The size limits of C0.7:** 40 lines and 2,000 bytes make the element large enough that the baseline must read
  more than a few lines. The `count_tokens` limit keeps the element inside one Read call (25,000 tokens a call, the
  run plan).

### What the second rescope does not judge

- The items of "What the gates do not judge" and "What the rescope gates do not judge".
- Tasks that the server refuses (inputs, 6).
- How common each task kind is in real work.
- Other server designs (decision 0007, option 2).

### Cost (an estimate)

- **The basis:** C0.6 cost $2.62 for 240 runs, mostly cache reads.
- **3 previews:** about $0.20 to $0.50 each (about 20 runs).
- **C0.7 and C0.9:** about $3 to $6 each. C0.7's baseline sends larger edits, which are output tokens.
- **C0.8:** about $4 to $10. The M arm can read outline pages of up to 20,000 tokens, and each later turn sends them
  again.
- **In all:** about $12 to $25. The lead estimates each gate again from its preview's measured cost. Each run stops at
  $5, and the runner stops a gate at $40.

### Amendments of the second rescope

**2026-11-12 (owner): the previews first; the gates wait for a new tool design.** No preview or gate run has started.
1. **The draws stopped.** The 3 draws ran on commit `d2a24b1` and each stopped before it wrote a record, on a case
   that "The inputs", 2 does not cover: C0.7 and C0.8 had a second kind with no file (blog), and C0.9 had 1 file in
   the email kind. No file is drawn. The lead proposes to fill missing files from the other kinds, in C0.3's kind
   order with the same stream, so that each gate keeps 10 files. The owner decides this rule with item 3.
2. **The previews run before the draws.** They use C0.5's files only, so they need no draw. Their freeze
   (`experiments/c07/run-inputs-previews.json`) covers the previews' inputs, the scripts and the runner; the gates'
   records and task sets are not in it. "The inputs", 8 holds for the gates when they are drawn.
3. **The gates do not run with the current server.** After the C0.7 and C0.9 previews, the lead proposes a server
   with fewer, consolidated tools (decision 0007, option 2), in a decision record. Gates C0.7 to C0.9 are then
   amended to test it, on fresh draws, before any gate run. Reason: the previews and C0.6 show the cost of the extra
   turns, and the full gates with the current server would mostly measure that again.
4. **C0.8 has no preview:** C0.5's files give 4 C0.8 tasks, under the minimum of 6. Its cost is estimated from the
   measured cost of the C0.7 and C0.9 previews, and C0.8 runs only after the owner's yes for that estimate.
- **No number changed.**

**2026-11-12 (owner): the new tool design, a gate C0.10, and the draw's fill rule (decision 0008).** The C0.7 and
C0.9 previews ran with the current server (`docs/measurements/2026-11-12-c07-c09-previews.md`: 0.513 and 1.194,
$0.73). Then the owner decided:
1. **The server changes to decision 0008, option D:** `html_find` (a text or an id), `html_change` (a ref or a
   locator that must match exactly 1 element; remove, replace, insert after, set an attribute, replace a text) and
   `html_outline`; `file` is optional when the workspace holds one `.html` file. C0.1 and C0.2 run again on it before
   any gate.
2. **Gates C0.7, C0.8 and C0.9 test the new server,** not the server of commit `d4f9927`. "What stays the same as
   C0.6" holds except the server and its tool text, which are frozen by hash before the first preview of the new
   server.
3. **A new gate C0.10:** C0.6's task kind (C0.4's 4 types and templates, a quote that is in the target's source as
   written) on its own fresh draw, with the new server and the second rescope's pass rule.
4. **The fill rule of the draws:** when a kind gives fewer than 2 files, the missing files come from the other kinds,
   in C0.3's kind order, with the same stream, until the gate has 10 files or the pool runs out. The report names the
   kinds of the files. A gate with fewer than 6 files does not run.
5. **The gate text for the new tools** (the prompts, the task rules that depend on the server, C0.10's rules, and
   the previews of the new server) is written as an amendment before any draw, and the owner agrees to it first.
- **No number changed:** 0.70, the interval below 1.00, 5 points and 15 points.

**2026-11-12 (owner): the gate text for the v2 tools.** The owner agreed to it on 2026-11-12, after an independent
review of 12 points and a revision. The v2 tools exist (`server/v2.mjs`, `server/source.mjs`, `server/tools-v2.json`,
served with `node server/main.mjs --root <folder> --tools v2`; commits `f409dae`, `3c39e53` and `d56165d`, after a
correctness review and a security review). v1's behaviour does not change, but files under `server/` changed after
`d4f9927`; the results of C0.1, C0.2 and C0.6 stay with their own commits.

**A. C0.1 v2: edit fidelity of the 5 operations (no model, no cost).**
1. **The script and the oracle:** `experiments/c01/run-c01-v2.mjs` drives the real server with `--tools v2`, as C0.1
   does. Its checks use html5lib 1.1, parser only (`experiments/c01/oracle_v2.py`, built on `oracle.py`). Both are
   committed, with their tests, before the run.
2. **The inputs:** C0.1's 16 files, C0.5's 30 edits of the task set (each as its v2 operation), the fixed cases of 9,
   and 1,000 random changes with the seed `20261116`.
3. **The targets** of a random change: all refs except `html`, `head` and `body`, that have a clean range (C0.1,
   amendment "the elements with no clean range", 2). The elements with no clean range get C0.1's separate check with
   `html_change`: a named error, and the file unchanged.
4. **One random change** draws, in this order, from one stream: the file, the target, the operation (uniform over
   the 5), the arguments, and the locator.
   - `replace` and `insert_after`: the new HTML from C0.1's list.
   - `set_attribute`: the name from (`class`, `data-x`, `title`, or one of the target's own attributes in its source
     spelling, for example `xlink:href`), and the value from (`v`, `a "q" & b`, `é😀`, the empty string).
   - `replace_text`: `old` is a run of 1 to 6 whole words of the target's visible text, which the oracle finds exactly
     once in the target's visible text nodes taken together. Words are split at ASCII whitespace. The visible text
     nodes are all descendant text nodes outside `script`, `style`, `svg`, `template`, `noscript` and the contract's
     hidden content (C0.2), with ASCII whitespace runs as one space. `new` comes from (`x`, `A & B <c>`, `😀`, the empty
     string). When the target has no such run, the change takes the next target of the stream, at most 100 times.
5. **The locator:** half of the changes use `ref` and `hash`. The other half take the first of these that names only
   the target, by the oracle's own text and tree, not by the server's code:
   1. `text` and `tag`: the target's first run of 3 to 6 whole words that occurs exactly once in the file's visible
      text, when the target is the innermost element of its tag that holds it;
   2. `text` alone: the same run, when the target is the deepest element that holds it;
   3. `id`: the target's id, when exactly 1 shown element has it (template content counted, as C0.8 counts);
   4. `id`, `child` and `n`: the parent's unique id, the target's tag and its place among the parent's child elements
      of that tag;
   5. else `ref` and `hash`.
   One locator change in ten also sends the right `hash`.
6. **Pass, for each accepted change.** Checks 1 to 3 run on the drawn target's range, from the view and confirmed by
   the oracle's marker check. The server's note (`changed @n`) is an extra check only.
   1. Every byte outside the range is unchanged.
   2. The bytes inside the range:
      - `remove`, `replace`: C0.1's byte rule (the new HTML in place of the range);
      - `insert_after`: the range, then the new HTML;
      - `set_attribute`: only that attribute's source span changes, to `name="value"` with `&` and `"` escaped; or,
        for a new attribute, ` name="value"` comes right after the tag name;
      - `replace_text`: only the source span of the matched part changes, to `new` with `&` and `<` escaped.
   3. html5lib's tree of the result:
      - `remove`, `replace`: C0.1's rule;
      - `insert_after`: the target's subtree is unchanged, the parse of the new HTML follows it as siblings, and all
        else is unchanged;
      - `set_attribute`: the original tree with that one attribute (name and namespace) set to the value;
      - `replace_text`: the original tree, except one text node of the target: its part whose text (ASCII whitespace
        runs as one space) equals `old` is replaced by `new`. A text node that becomes empty counts as no text node.
   4. parse5 and html5lib agree on the result, or the report names it (as C0.1).
7. **Each refusal is a failure, unless its reason is on this closed list and the script confirms it:**
   - the splice changes the tree outside the element (`remove`, `replace`, `insert_after`): the oracle's C0.1 check;
   - no end tag (`insert_after`): the range does not end with `</tag>` (any case), and the element is not void;
   - `replace_text`: a bound inside one character reference, a RAWTEXT parent (`xmp`, `iframe`, `noembed`,
     `noframes`, `plaintext`), a text node with no exact source map, or a line break at the start of `pre`,
     `textarea` or `listing`: each confirmed from the bytes;
   - the result nests deeper than 512 levels.
   The report counts the refusals by their reason.
8. **A minimum:** at least 100 accepted random changes of each operation. With fewer, the run gives no verdict, and
   the owner decides.
9. **The fixed cases** (`tests/gates/v2-cases.mjs`, written before the run), each with its expected result:
   - an unquoted value that ends in `/` (`<a href=/docs/>`) with a new attribute;
   - `insert_after` after an unclosed `<p>` and an unclosed `<li>` (a refusal);
   - `replace_text` with a bound inside `&copy2` (a refusal), in `<pre>abc\ndef</pre>` with `old` `abc` and `new`
     empty (a refusal), and in `xmp` (a refusal);
   - a text that 2 elements hold, and an id that 2 elements have: a refusal that lists the matches, and the file
     unchanged;
   - an id on a hidden element (not found).
10. **Negative controls.** Each must make C0.1 v2 fail, on the random changes or on its fixed case:
    - C0.1's 4 controls, on the v2 operations: a move by 1 byte; the file written again from the tree; CR LF changed
      to LF; every range called clean;
    - `set_attribute` that adds before `/>`;
    - `insert_after` without the end-tag check;
    - `replace_text` that ignores the bounds of a character reference;
    - a text locator that takes the first of several matches.
11. **Pass:** 0 failures, and the minimum of 8.

**B. C0.2 v2: hostile files (no model, no cost).** C0.2's hostile file set and conditions, with the v2 tools, and
these additions (`tests/gates/hostile-v2.mjs`):
1. The path cases with each v2 tool, with `file` given.
2. Without `file`: a folder with 0 `.html` files, with 2, with 1 and a dot file, and with a link named `x.html` as
   the only one. Each gives its named error, or the call works on the 1 plain file (checked by its hash).
3. **The output formats.** Condition 1 holds for every content line of `html_find` with `text` and with `id`, and
   of a locator's error. A content line starts, after its indent, with `@<n> ` or `| `, or is the line
   `… output cut at 60,000 characters`. The last line is `N matches; hash H` (with `text`), or
   `1 match; N child elements; hash H` (with `id`). A locator's error starts with `N elements match; give a ref:` or
   `N elements have the id "…"; give a ref:`, and ends with `hash H`.
4. **Hidden content:** ids on hidden elements, on their parents, and on a `template`. Condition 3 holds: a hidden
   element is not found by its id, and a hidden child is listed as `@n tag (hidden)`, with no attribute or text.
5. **The stale hash:** a change by `ref` and a change by a locator, each with an old hash, are refused.
6. **Time:** each call returns within 2 s (condition 7), `html_change` with each operation included, on: the
   1.9 MB fostered file, 20,000 elements of one tag (the `tag` locator), an element with an id and 80,000 children,
   and a long text node for `replace_text`.
7. **Bad arguments:** over 10,000 characters, over 2 MB, a lone surrogate, `n` of 0 or below, and wrong types each
   give a named error.
8. **No wrong edit:** for each hostile file that the server reads, `html_find` with a text, and `html_change` with
   each operation on a fixed element, checked as in A.6.
9. **Negative controls.** Each must make C0.2 v2 fail: C0.2's 5 controls, on v2's `html_find`; an `id` listing with
   no output cap; a locator that ignores the hash; an `id` listing that shows hidden children.
10. **Pass:** 0 failures.

**C. Gates C0.7 to C0.10 with the v2 tools.**
1. **The M arm:** the built-in Read, Edit, Grep and Glob, plus the 3 v2 tools. The server's files and
   `server/tools-v2.json` have the hashes on which C0.1 v2 and C0.2 v2 passed. The server sends no server
   instructions.
2. **The prompts:** as above for C0.7, C0.8 and C0.9. C0.10 uses C0.4's 4 types and templates.
3. **The task rules that depend on the server** use the v2 operations, by `ref`: a removal (`remove`), a replacement
   (`replace` with `<p>New text</p>`), an insertion (`insert_after` with `<p>New text</p>`), an attribute change
   (`set_attribute`), and a text change (`replace_text` with the quote as `old`). html5lib then confirms each target
   and each expected change, as before.
4. **C0.10** has its own task script (`experiments/c07/tasks-c10.mjs` or a C0.10 part of `tasks.mjs`). It applies
   C0.3's task rules (`experiments/c03/make-tasks.mjs`: the quote is in the target's own text node as written, the
   target is the deepest holder, no other element of its tag holds it; insertion in even files, removal in odd files)
   on the server's view, finds the full list of valid targets, and adds the v2 check of 3. Its file rule: the file
   can give the 4 tasks with 4 different targets, both as an odd and as an even file. Its seed is `20261115`. Its
   preview takes C0.4's types in turn by file number, as C0.9's.
5. **Allowed changes to the code, in addition to the first list:**
   - the runner's expected and known tool names for the v2 tools;
   - the MCP command with `--tools v2`;
   - the question rule "the run edited the file" also counts a successful `html_change`;
   - `rules.mjs` and `tasks.mjs` use the v2 operations for "the server accepts";
   - the draw's rule modules include `server/v2.mjs` and `server/source.mjs`;
   - "visible text" comes from `server/view.mjs` at the frozen commit;
   - a run plan for the v2 runs (a new file).
6. **The order:**
   1. C0.1 v2 and C0.2 v2 pass.
   2. **The v2 previews first:** C0.7, C0.9 and C0.10 on C0.5's files, with new task sets made by the v2 rules and
      their own freeze. C0.8's preview runs only if it reaches 6 tasks. Each preview needs the owner's yes (about $1
      to $2 in all). These are new runs, not repeats of the v1 previews, which stay recorded.
   3. When the v2 previews show no fewer turns than the v1 previews, decision 0008 reopens before any draw.
   4. Then the draws (with the fill rule), the task sets and the gates' freeze. Each gate needs the owner's yes.
   5. The rule "a change after a preview makes the result weaker" applies to the v2 previews and their gates.
7. **The cost of the gates:** about $3 to $6 each for C0.7, C0.9 and C0.10 (the v1 previews cost $0.012 to $0.035 a
   run), and $3 to $10 for C0.8, whose M arm can read large outline pages. Each is estimated again from its v2
   preview.
8. **A correction:** C0.8's "`html_find` cannot find an `id`" holds for v1 only; v2's `html_find` takes an id.
- **No number changed.**

**2026-11-12 (owner): C0.1 v2 draws 1,500 random changes, not 1,000.** A development run of C0.1 v2 (`--dev`, no
result file) on commit `704255e` reached the minimum of A.8 for 4 operations but not for `replace`: 91 accepted of
216. C0.1's list of new HTML holds 3 fragments that the server refuses by design (`</div><div>`, `<!--`,
`<script>`). The run had no failure of the server; 2 failures came from the script's own checks of a change to the
same text, which are fixed. All 8 negative controls failed as they must. The owner chose a longer draw with the same
lists and rules, so that no rule gets weaker. The gate run's report says that this count was set after a development
run.
- **No number changed** except the count of random changes: 1,000 becomes 1,500.

**2026-11-12 (owner): 2 points of C0.1 v2's text, after the review of its script (16 points).**
1. **The fixed case of a reference bound (A.9):** `&fjlig;`, one reference that decodes to 2 characters ("fj"), in
   place of `&copy2`. HTML reads `&copy2` as the reference `&copy` and the plain text "2" (the server's decoder
   follows this since commit `d6ed5ce`), so a change at "2" is valid. A case with `&copy2024`, whose "2024" is
   changed, is added as an accepted case.
2. **The text locator (A.5):** when rules 1 (`text` and `tag`) and 2 (`text` alone) both name only the target, the
   stream picks one of the two (one more draw). As written, rule 2 could never be drawn: a deepest holder is also the
   innermost holder of its own tag.
- **No number changed.**

**2026-11-12 (owner): C0.10's text change needs a quote that occurs once in the file's source.** The v2 preview of
C0.10 (`docs/measurements/2026-11-12-c07-c10-v2-previews.md`) had an ambiguous task: `10-text` asked to change "Share
on Facebook" in a `span`, and the same words are the `aria-label` and the `title` of the next button. Both arms
changed them too, and both failed. C0.3's text rule checks only the visible text of other elements. The owner agreed
to the lead's proposal:
1. **A C0.10 text change** also needs its quote to occur exactly once in the file's source, as written. The other
   rules of C0.10 (amendment "the gate text for the v2 tools", C.4) stay.
2. **The rule changes after C0.10's preview.** The preview's task set and result stay as they were. The rule "a change
   after a preview makes the result weaker" applies: the C0.10 gate report names this change.
- **No number changed.**

**2026-11-12 (owner): the fill rule takes one file from each kind in turn.** The fill rule (amendment of decision
0008, item 4) says that the missing files come "from the other kinds, in C0.3's kind order". An independent review
found two readings: each kind until it runs out, or one file from each kind in turn. C0.3's first kind (marketing)
has 20 repositories, so the first reading could give a gate mostly marketing files. The owner chose the second
reading: in rounds, each kind in C0.3's order gives at most 1 file, until the gate has 10 files or a full round gives
no file. A fill takes no repository that the draw already picked, so the same-repository fallback of "The inputs", 2
does not apply in a fill.
- **No number changed.**

**2026-11-12 (owner): the runner's own stops, a pinned harness and C0.8's own freeze, before the C0.8 v2 run.** The
gates C0.7, C0.9 and C0.10 with the v2 tools ran first (`docs/measurements/2026-11-12-c07-v2-gate.md`,
`2026-11-12-c09-v2-gate.md`, `2026-11-12-c10-v2-gate.md`). C0.9 stopped when the lead committed during the run, and
C0.10 stopped when the installed Claude Code updated itself. The owner agreed to these 3 points, which the lead
proposed for C0.8:
1. **A stop by the runner's own checks is a stop under C0.6 rule 2.** The checks are: an input or HEAD changed (before
   each run, after its attempts, and before each judge call), another harness version or no version in a run's start
   message, another tool list, loaded skills or a plugin other than the built-in ones, the canary, project notes above
   the run folder, and a stored or expected file that is not the recorded one.
   The run gets no record. The runner writes a stop line with the run's cost, and the run runs again when the gate
   goes on, on the same commit. Before this amendment, a changed HEAD left a run with no outcome.
2. **The harness is a pinned file.** The runner starts the git-ignored copy `.local/harness/claude-2.1.322` (with
   `.exe` on Windows), not the `claude` command on the PATH. Before a gate starts, the runner checks the copy's
   SHA-256 against the plan, and only then runs it for its exact version (`2.1.322 (Claude Code)`). Each run's start
   message must also report exactly `2.1.322`.
3. **C0.8 has its own freeze,** `experiments/c07/run-inputs-v2-c08.json`, with the same file list as
   `run-inputs-v2.json`. It is written once and committed before C0.8's first paid run. The 3 gates that ran keep
   `run-inputs-v2.json`; their results name their commits.
- **No number changed.**
