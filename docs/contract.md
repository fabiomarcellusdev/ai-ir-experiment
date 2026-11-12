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
| C0.6 | 0 | Rescope: C0.4 with the MCP tools added to the baseline's tools: at most 0.70 of the tokens, success not more than 5 points below | The fresh sets, 3 runs per task and arm; Claude Sonnet 5.5 | Agreed (owner, 2026-11-11) |
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
