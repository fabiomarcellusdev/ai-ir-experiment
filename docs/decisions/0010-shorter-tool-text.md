# 0010. Shorter text for the v2 tools

**Status:** Proposed (lead, 2026-11-12). The owner asked for the design (2026-11-12): "design the shorter tool
descriptions too". Nothing is built until the owner agrees to an option.

## Context

Gate C0.10 v2 failed with a median ratio of 1.207 (`docs/measurements/2026-11-12-c10-v2-gate.md`). Both arms needed
3 turns; arm M's first request had about 1,050 more tokens of fixed text than arm B's (analysis check of C0.10). The
gates sent every tool definition in every turn (`ENABLE_TOOL_SEARCH=false`).

**Measurement** (2026-11-12, Anthropic's free `count_tokens`, model `claude-sonnet-5-5`, one user message "x"; script
`experiments/c07/analysis/count-tools.mjs`). Tokens of the 3 v2 tools together, minus the 9 tokens of the message
alone:

| Tool text | All 3 | html_find | html_change | html_outline | Description characters |
|---|---|---|---|---|---|
| At HEAD before decision 0009 | 1,337 | 538 | 852 | 519 | 428 / 933 / 420 |
| With 0009's size sentence (now in the working copy) | 1,389 | 590 | 852 | 519 | 576 / 933 / 420 |
| Option B's draft below | 1,183 | 530 | 755 | 470 | 416 / 589 / 301 |
| No descriptions (schemas kept, their descriptions removed) | 692 | 364 | 546 | 354 | 0 |
| No descriptions and no arguments | 416 | 329 | 329 | 330 | 0 |

A tool alone counts about 286 tokens of the API's own tool framing (3 tools alone give 989; together 416). Arm B also
has tools (Read, Edit, Grep, Glob), so it pays that framing too. What arm M adds is about 1,389 − 286 ≈ 1,100 tokens a
turn, which agrees with the 1,050 seen in C0.10 before the size sentence. Of these, about 700 are descriptions, about
280 are the argument schemas, and about 130 are the 3 tools' names and structure.

**What shorter text can and cannot do:**

- Even with no descriptions at all, arm M would add about 400 tokens a turn (692 − 286). In C0.10 that is about
  1,200 tokens a run on arm B's median of 14,058: a ratio of about 1.08, if the turns stay the same (an estimate, not
  a measurement). No text change alone brings C0.10 under 1.00, and none brings it near 0.70.
- Each token cut applies to every turn of every task, so it also lowers the ratios that passed (C0.7, C0.8, C0.9).
- Shorter text can make an agent misuse a tool. A failed call costs a turn, which costs more than the tokens saved.

## Options

Each option changes only `server/tools-v2.json` (no code). Any change to the server means C0.1 v2 and C0.2 v2 must
pass again before a v2 run; both are free, and one rerun can cover decisions 0009 and 0010 together.

### A. Keep the text as it is (with 0009's size sentence)

- **Build and maintain:** nothing.
- **Tokens:** 1,389.

### B. The same facts in fewer words, and drop what an error teaches (recommended)

- **Build:** small: the JSON, the tool-text test, and the golden outputs if any.
- **Maintain:** as now.
- **Tokens:** 1,183: 206 fewer a turn than A, and 154 fewer than the text that the C0.10 gate ran with (1,337). In
  C0.10, 154 tokens in each of 3 turns are about 460 tokens a run: a ratio of about 1.18 instead of 1.21 (an
  estimate, if the turns stay the same).
- **What it drops:**
  1. html_change: "(from html_find or html_outline)" after `ref` and `hash`.
  2. html_change: "with entities decoded and whitespace runs as one space" for `old`. This is the riskiest cut: an
     agent may copy `&amp;` from the source. The server's error then names the problem, at the cost of a turn.
  3. html_change: "Fails when the new HTML would change the page outside the element" (the error says it).
  4. html_change: "the tool escapes them" becomes "plain text".
  5. Every tool: "Leave out `file` when the folder holds one .html or .htm file" becomes one property description on
     html_find; the schemas show that `file` is optional.
  6. Property descriptions that repeat the name ("Literal visible text to find", "The id of an element").
- **The draft text:**
  - **html_find:** "Finds elements in an HTML file by `text` (literal visible text, case-sensitive; the deepest
    matches, at most 20) or by `id` (the element and its child elements). Each element shows its @n ref and all its
    attributes; ancestors show as outline lines. An element of 1 KB or more also shows its size, as [12.4 KB, 310
    lines]: change it with html_change by ref, not with Edit. Ends with the match count and the file hash."
  - **html_change:** "Changes one element of an HTML file and saves it; all other bytes stay the same. Name the
    element by `ref` and `hash`; or by `text` (the deepest element that contains it; with `tag`, the innermost of
    that tag); or by `id`, with `child` and `n` for its n-th child of that tag. If the name fits several elements,
    nothing changes and the matches are listed. Operations: remove; replace (`html`); insert_after (`html`);
    set_attribute (`attribute`, `value`); replace_text (`old` is visible text in one text node, `new` replaces it).
    `value` and `new` are plain text. Not for html, head or body."
  - **html_outline:** "The reading view of an HTML file: one element per line with its @n ref, indented by depth;
    text as "| text" lines. Scripts, styles, comments, SVG content, hidden content and most attributes are left out.
    Pages of up to 20,000 tokens, with the file hash. Use html_find when you know some text or an id."

### C. One sentence for each tool

- **Tokens:** not drafted; between 692 (no descriptions) and B's 1,183, perhaps about 850.
- **Risk:** the agent learns the locators and the operations from errors, one failed call at a time. Rejected for
  now; it can follow B if a run shows that B costs no turns.

### D. Fewer arguments for html_change (one `target` argument for the 3 locators)

- **Tokens:** html_change's arguments cost 217 tokens (546 − 329, without descriptions). One `target` argument in
  place of 7 locator arguments would save part of that; how much is not measured.
- **Build:** a change of the tool's interface: new parsing, new tests, new golden outputs, and C0.1 v2's changes
  must be written again. Rejected for now: a large change for a part of 217 tokens.

## Decision

Proposed: **option B**. It saves about 200 tokens a turn at a small risk, and needs no code.

## How to test it (after the owner agrees; each paid step needs the owner's yes)

1. **Free:** `count_tokens` again on the committed text; the tool-text tests; then C0.1 v2 and C0.2 v2 once for
   decisions 0009 and 0010 together.
2. **Paid, about $3:** run arm M only on the frozen task sets of C0.7 v2 and C0.10 v2, twice: once with 0009's size
   field alone, once with the size field and B's text. Compare each with the recorded arm M. The 2 runs separate the
   effect of each change. They are not gates: the arms run on different commits from the recorded ones.

## Rejected

- **C and D:** see "Options".
- **Moving the text into the MCP server's `instructions`:** Claude Code puts a server's instructions into the system
  prompt of every request, as far as the lead knows (not checked), so the tokens move but do not go away.

## What would reopen this

- Step 2 shows more failed calls or more turns with B's text.
- A measurement with tool search on (Claude Code's default) shows that the descriptions are not sent in every turn.

## Amendments
