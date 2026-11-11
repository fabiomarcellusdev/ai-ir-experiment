# 0006. The design of the HTML MCP server

**Status:** Accepted (owner, 2026-11-11), with its 4 owner decisions. The contract changes are in `docs/contract.md`,
amendment "the server's design". The install of the oracle's Python packages still needs a vetting and its own yes.

## Context

Gate C0.5 passed on 2026-11-11 (median work ratio 0.374, `docs/measurements/2026-11-11-c05-result.md`). The
rescope's order (`docs/contract.md`, "Phase 0, rescope") is: build the server, run C0.1 and C0.2 on it and on the new
file set, then the paid C0.6.

What the server must do:

- **The 4 tools** of `docs/contract.md`, "The two arms": `html_outline`, `html_find`, `html_read` and `html_edit`.
- **C0.1:** `html_edit` writes exactly the bytes before the node, the new HTML, and the bytes after the node. An
  independent HTML5 parser checks it.
- **C0.2:** hostile files cause no wrong edit, no forged or stale ref, no path escape and no hang. Each call ends
  within 2 s.
- **C0.6:** the tool definitions are byte-identical to `experiments/c03/mcp-tools.json`. The server sends no server
  instructions, and its outputs give no advice on how to work.

What exists: the prototype `experiments/c03/html.mjs` (117 lines, parse5 8.0.1). It makes the outputs of
`html_outline`, `html_find` and `html_read`. It writes no file. C0.5 measured its outputs, and C0.3 and C0.5 froze its
hash, so it does not change.

**A probe of parse5 8.0.1 (2026-11-11, NOT timed, the owner's Windows 11 laptop, Node 24.22.1):**

1. The source offsets are UTF-16 positions in the original string. A CRLF stays 2 positions. A BOM stays at
   position 0. A character outside the BMP is 2 positions. So the server must map positions to bytes.
2. Elements that the parser creates have no source position: an implied `html`, `head`, `body` or `tbody`, and the
   copy that the adoption agency makes (`<b><p>x</b>y</p>`).
3. Some source ranges do not hold exactly their subtree. In `<b><p>x</b>y</p>`, `b` is 0 to 11 and its child `p` is
   3 to 16. In `<table><b>f</b><tr>…`, the fostered `b` sits before `table` in the tree, but its bytes are inside the
   table's range.
4. An element with an implied end tag ends where the next token starts (`<li>a<li>b`: the first `li` is `<li>a`).
5. Parse time of simple markup: 1 MB 84 ms, 4 MB 227 ms, 10 MB 562 ms. 20,000 nested `div` elements take 1,022 ms,
   so the time grows faster than the depth.

**The oracle (research, 2026-11-11, `researcher` agent, sources in its report):** no maintained parser was found that
passes the html5lib tree-construction tests and also gives the source range of each element. jsoup (Java) gives
ranges, but its html5lib results are not confirmed. html5lib (Python, pure Python, the suite's reference
implementation), lexbor (C) and html5ever (Rust) build trees with no ranges. No conforming JavaScript parser other
than parse5 was confirmed; jsdom uses parse5.

Prior art (`docs/prior-art.md`): MCP servers edit HTML by CSS selector or line range (fast-html-mcp), and tree-sitter
servers edit nodes in source code. None found gives an HTML reading view with refs, a stale-hash check, and an edit
that a second parser verifies.

## Options

### 1. The MCP protocol layer

| Option | Build | Maintain | Gives |
|---|---|---|---|
| **A. A small stdio server, no new package** | About 150 lines: JSON-RPC 2.0, one message per line, 5 methods | Follow the MCP protocol versions by hand | Full control of every byte that the harness gets; no supply-chain risk |
| B. The official MCP SDK (`@modelcontextprotocol/sdk`) | Less protocol code | A vetting of the SDK and each dependency it brings (from memory, not verified: a schema library, an HTTP stack); a monthly review of each | The protocol versions follow the SDK |

### 2. The parser

| Option | Build | Maintain | Gives |
|---|---|---|---|
| **A. parse5 8.0.1** | Already vetted and in the lock file | One package | The browser's tree; the view that C0.5 measured |
| B. htmlparser2 | A new package | One package | A tree that is not the browser's tree on broken HTML |

### 3. The time limit (C0.2: each call ends within 2 s)

| Option | Build | Maintain | Gives |
|---|---|---|---|
| **A. A size limit and a worker thread with a hard stop** | About 60 lines | Low | A hard limit for every input, also the inputs that nobody thought of |
| B. Size and depth limits only | Less code | Each new slow input needs a new limit | No limit for an input that is slow in a new way |

### 4. How `html_edit` refuses a bad fragment

| Option | Build | Maintain | Gives |
|---|---|---|---|
| **A. Write the splice in memory, parse it again, and compare the tree outside the element** | A second parse per edit | Low | One rule for every way a fragment can change its surroundings (`</div><div>`, `<!--`, `<script>`, a `<div>` inside a `<p>`) |
| B. Parse the fragment alone, in its parent's context | Less work per edit | Each context effect needs its own rule | Misses effects on the surroundings: a `<p>` inside a `<p>` parses closed alone, but closes the outer `p` in the file |

### 5. The oracle for C0.1 (it must not be parse5)

| Option | Build | Maintain | Gives |
|---|---|---|---|
| **A. html5lib 1.1 (Python), with a comment marker** | Python is installed (3.14.8); 3 packages (html5lib 1.1, six, webencodings) in a virtual environment, with hashes | Python packages under decision 0001; html5lib is dormant (last release 2020) | The suite's reference parser; finds each node by the tree, not by ranges (see "The oracle check" below) |
| B. jsoup (Java), with its source ranges | A Java toolchain install and a build tool | A second toolchain | Direct ranges; html5lib results not confirmed |
| C. lexbor (C) or html5ever (Rust) | A native build | A toolchain and its updates | A conforming tree; no ranges |

## Decision (proposed)

Options 1A, 2A, 3A, 4A and 5A. The details follow.

### Modules (`server/`)

| Module | Job | File access |
|---|---|---|
| `server/main.mjs` | The entry: reads `--root`, runs the protocol loop, supervises the worker | None |
| `server/protocol.mjs` | JSON-RPC framing and the MCP methods, as pure functions | None |
| `server/workspace.mjs` | The path checks, the file read with its limits, the atomic write | The only module that touches files |
| `server/view.mjs` | Parse, refs, clean ranges, `html_outline`, `html_find`, `html_read` | None |
| `server/edit.mjs` | The splice and the check after the edit | None |
| `server/worker.mjs` | Runs the view and edit work in the worker thread | None |

- A unit test reads each module's imports and fails when a module other than `workspace.mjs` imports `node:fs`, or
  when two modules import each other (the module-boundary rule of `AGENTS.md`).
- `view.mjs` starts as a copy of the prototype. The prototype stays frozen.

### The protocol (option 1A)

- **Transport:** stdio, one JSON-RPC 2.0 message per line. Nothing else goes to stdout. The server writes no file
  content to stderr.
- **Methods:** `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`. Another method gets
  the JSON-RPC error -32601. A line that is not JSON gets -32700. A line longer than 8 MB gets a named error.
- **`initialize`:** the server name is `html`, so the harness names the tools `mcp__html__html_outline` and so on. The
  reply has no `instructions` field. The server answers with the client's protocol version when it knows that version,
  and otherwise with its newest known version.
- **`tools/list`:** the server reads `experiments/c03/mcp-tools.json`, removes the `mcp__html__` prefix and renames
  `input_schema` to `inputSchema`. It changes nothing else. A test compares the result with the file.
- **Errors of a tool:** an MCP result with `isError: true` and the text `html_<tool>: <what failed>`. The texts form a
  closed list, and each one has a test. They name what failed. They give no advice.

### The workspace (`server/workspace.mjs`)

- **The root** is the `--root` argument, resolved to its real path at start.
- **A path** is relative to the root, or absolute inside the root (see "Owner decisions", 2).
- **The server refuses**, with a named error:
  1. a `..` segment;
  2. a UNC path, `\\?\` and `\\.\`;
  3. a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM0` to `COM9`, `LPT0` to `LPT9`), also with an extension
     or with trailing dots or spaces;
  4. a `:` after the drive letter (an alternate data stream);
  5. a real path outside the root's real path (a link or a junction);
  6. a name that does not end in `.html` or `.htm`. So `html_find` cannot show the text of a `.env` file.
- **Limits before the parse:** the file is at most 4 MB (the C0.5 files are at most 296 KB). The bytes are valid UTF-8,
  checked with a fatal decoder that keeps the BOM.
- **The atomic write:** the server writes a temporary file in the same folder. It reads the target again and checks
  its hash. Then it renames the temporary file over the target. A failure removes the temporary file.

### The view (`server/view.mjs`)

- **The outputs are the prototype's outputs:** the same refs (a preorder number over all elements), the same lines,
  the same pages of 60,000 characters, the same hash (the first 16 hex characters of the SHA-256 of the bytes).
- **Safety fixes,** each with a test:
  1. Text and attribute values escape every line break that a reader can see: CR, LF, tab, vertical tab, form feed,
     U+0085, U+2028 and U+2029, and the other C0 control characters. The prototype escapes CR, LF and tab in values
     only. So no line of output can start with a forged `@n`.
  2. `html_find` finds the deepest matches in linear time over the elements. The prototype checks every element
     against every other element.
  3. No recursion over the tree. A depth over 512 gives a named error.
  4. No regular expression with nested quantifiers. A test runs the 2 backtracking inputs of C0.2 and 1 MB inputs of
     each regular expression's worst case.
- **A clean range:** an element has a clean range when it has a source position, its range holds the ranges of all its
  descendants, and no other located node starts inside its range. `html_read` and `html_edit` refuse an element with
  no clean range, with a named error. This covers the elements of facts 2 and 3 of the probe.
- **The equality test:** for each file of C0.3 and C0.5, the server's outputs equal the prototype's outputs, except the
  lines that a safety fix changes. The test lists each changed line. So C0.5's result stays valid for the server.

### The edit (`server/edit.mjs`, option 4A)

1. Read the bytes, and refuse a hash that is not the file's hash ("stale hash").
2. Find the element by its ref. Refuse a ref out of range or an element with no clean range.
3. Map the element's range to bytes. Build the new bytes: the bytes before, the UTF-8 of `html`, the bytes after.
   The server changes no line ending.
4. Parse the new text. Compare it with the expected tree: the old tree, with the element replaced by the nodes of
   `html` parsed in the parent's context. The comparison uses parse5's serializer, so adjacent text merges the same
   way on both sides.
5. When the two trees differ, refuse: "the new HTML changes the document outside the element". The file stays
   unchanged.
6. Otherwise the main thread writes the new bytes (the atomic write) and returns `ok; hash <new hash>`.

The worker computes the new bytes. The main thread writes them. So a stopped worker never leaves half a file.

### The time limit (option 3A)

- One worker thread does all parse work. When a call takes more than 1.5 s, the main thread stops the worker, starts a
  new one, and returns a named error.
- The server reads every file again on each call. It keeps no cache, so a cached tree can never be stale.

### The oracle check for C0.1 (option 5A)

html5lib gives no source ranges. So the oracle finds each node by the tree:

1. The oracle parses the original file. It numbers the elements in preorder, and checks that each ref names an element
   with the same tag as the server's element.
2. The script reads the server's result. The result must equal the original bytes, minus one range `[s, e)`, plus the
   new HTML at `s`.
3. The oracle parses the original with `[s, e)` replaced by a comment with a unique text. That tree must equal the
   original tree with the ref's element replaced by that comment. A range that is 1 byte too long or too short
   changes a text node, so the trees differ. A comment can stand in every place where an element can, so foster
   parenting does not move it.
4. For each refusal, the oracle parses the splice and confirms that the tree outside the element changes. For each
   accepted edit, it confirms that the tree outside does not change.

Before the oracle is used, the script runs it on the html5lib tree-construction tests at a pinned commit and records
each failure. Where html5lib and parse5 disagree on a file of the set, the report names it.

### What the server does not do

No cache, no other MCP feature (resources, prompts), no HTTP transport, no insert or append tool, no detection of
content that a stylesheet hides (an open row in `docs/follow-ups.md`). No type checker: the project has no TypeScript
package, and adding one needs the owner's yes. A new row in `docs/follow-ups.md` records this gap.

### Owner decisions in this proposal

1. **The design as a whole,** with options 1A to 5A.
2. **An absolute path inside the workspace is accepted.** Claude Code's agents give absolute paths to tools, and the
   frozen tool text cannot tell them otherwise. C0.2's absolute-path case then uses a path outside the workspace.
   This changes how C0.2's case list is read, so it is a contract amendment.
3. **`html_edit` refuses a fragment that changes the document outside the element,** and the oracle confirms each
   refusal and each acceptance (check step 4). C0.1 now lists 3 fragments as unbalanced. Under this rule, a random
   `<p>x</p>` that replaces an element inside a `p` is also refused. This is a contract amendment to C0.1.
4. **The oracle:** html5lib 1.1 with the comment-marker check, in place of "the original bytes before the oracle's
   node". This is a contract amendment to C0.1. It needs a vetting of 3 Python packages, a Python section of
   `docs/setup-options.md` copied into `AGENTS.md`, and the owner's yes for the install (decision 0001).

## Rejected

- **The SDK (1B):** it brings packages that each need vetting and a monthly review. It does not make C0.6's
  byte-identical tool text easier to check.
- **htmlparser2 (2B):** its tree is not the browser's tree on broken HTML, and C0.5 did not measure its view.
- **Limits only (3B):** the probe showed one slow input (deep nesting) that a size limit alone does not stop. A hard
  stop also covers the next one.
- **The fragment check alone (4B):** it accepts a `<p>` inside a `<p>`, which changes the surrounding tree in the file.
- **jsoup (5B), lexbor or html5ever (5C):** each needs a new toolchain, and jsoup's html5lib results are not
  confirmed.
- **A change to the prototype:** C0.3 and C0.5 froze its hash.

## What would reopen this

- Claude Code cannot connect to the small stdio server, or a new MCP protocol version breaks it: then option 1B.
- html5lib fails more than a few tree-construction tests, or disagrees with parse5 on files of the set: then option
  5B or 5C.
- C0.1 shows that check 4A refuses edits that a browser parses the same way: then the comparison changes.
- C0.2's timing fails with the worker: then the limits change.

## Amendments

- **2026-11-11 (owner):** the owner agreed to the design and its 4 owner decisions.
- **2026-11-11 (lead, from the code review and the security review of the first build):** these changes hold. The
  owner is told in the hand-over.
  1. **The size limit is 2 MB, not 4 MB.** A 4 MB file of dense markup took 1.2 s to parse, so an edit (two parses)
     could pass the 1.5 s limit. The largest C0.5 file is 296 KB.
  2. **The edit check compares the trees directly.** The first build parsed the new HTML alone in the parent's
     context. That parse does not know the document's mode or the open elements, so it refused 1.4% of edits that
     changed nothing. The server now parses the new file, and checks that the tree outside the parent is equal, and
     that the siblings before and after the element are equal. Text next to the element may merge with new text.
  3. **A leading BOM is not content.** parse5 read it as text, which put the document in quirks mode. The server now
     parses the text after the BOM, and adds 1 to each offset. No gate file starts with a BOM.
  4. **The read uses one file handle,** and refuses a file with more than one hard link. **The write checks again**
     that the folder is itself and inside the root, and that the file has the same device and inode as at the read.
     It keeps the file's mode, and refuses a read-only file.
  5. **Output limits:** each output line is cut at 10,000 characters, with its length named. `html_find` output stops
     at 60,000 characters, and its last line says so.
  6. **Hidden content:** an inline style is read with its CSS comments removed and its CSS escapes decoded.
  7. **Tag names** escape each character outside letters, digits, `.`, `_`, `:` and `-`.
  8. **Error texts** name a file-system error by its code only, never by a path.
  9. **The result of an edit** must not nest deeper than 512 levels.
