# Prior art

What exists already, and how this project differs. **Check each row again before a design cites it.** Mark each row
with how it was checked: from the source (paper, repository, documentation) with its date, or "from memory, not
checked".

The rows below come from the `researcher` agent's web search on 2026-11-10 (about 15 searches and 5 page reads). "Read
in source" means that the agent read the claim in the linked source. "Not checked" means that it saw the claim only in
a search summary or a third-party page. Nobody has tried these tools.

## Tools for HTML source files (the project's use case)

| Project | What it does | Reported result | Checked |
|---|---|---|---|
| [@aimino/fast-html-mcp-server](https://glama.ai/mcp/servers/uffvcmyzjo) | An MCP server, mainly for making HTML. It edits by CSS selector (`patch_html`, `set_attribute`) and by line range. No outline, no refs. | None found | Not checked (the npm and listing pages refused the agent) |
| [Serena](https://github.com/oraios/serena) | Finds and edits code by symbol, through language servers. HTML is in its language list. HTML has few named symbols, so it may give little here (a guess). | "Much more token-efficient"; no number | Read in source, 2026-11-10 |
| [Aider repo map](https://aider.chat/docs/languages.html) | A map of a repository's symbols for the model. | The `.html` row has no repo map: HTML is not covered | Read in source, 2026-11-10 |
| [ast-grep MCP server](https://github.com/ast-grep/ast-grep-mcp) | Structural search and rewrite by pattern (from its README). The agent saw no outline tool and no refs. | None found | README read in source; HTML support not checked |
| Tree-sitter edit servers (semantic-edit-mcp, patchloom, ast-editor, treesitter-mcp, ast-mcp-server) | Find a node by name, type or position, then replace, insert or delete it. ast-mcp-server has an outline tool, for TypeScript and JavaScript only. | Claims of 80% and "3x to 5x", with no method | Not checked; no confirmed HTML support |

## Compact page views for browser agents (live pages, not source files)

| Project | What it does | Reported result | Checked |
|---|---|---|---|
| [Playwright MCP](https://playwright.dev/mcp/snapshots) | An accessibility snapshot of the page, with refs for actions. It leaves out hidden and `aria-hidden` elements. | Sizes only in blogs (2,000 to 5,000 tokens per page; 5 KB to 50 KB) | Description read in source, 2026-11-10; sizes not checked |
| [D2Snap](https://arxiv.org/abs/2508.04412) | Reduces DOM snapshots for web agents. | Task success 67% against 65% in one summary, 73% (n=52) in the authors' blog (GPT-4o, Online-Mind2Web) | Not checked |
| [HtmlRAG](https://arxiv.org/abs/2411.02959) | Cleans HTML (no CSS, comments, scripts, long attributes), then prunes a block tree. WWW 2025; arXiv v1 2024-11-05. | HTML beat plain text for question answering. 20 pages: 1.6M tokens raw, 135K cleaned, 4K pruned | Venue and dates read in source; the results not checked |
| Reader tools (Jina Reader, Firecrawl, Readability, Turndown, Trafilatura) | HTML to Markdown or text. They lose structure and cannot write back to the source. | Blog figures of 75% to 98% fewer tokens | Not checked |

## Measured savings of structural edits

No published, controlled measurement of tokens or task success for structural edits of HTML was found. One blog
([fsck.com, 2026-06-30](https://blog.fsck.com/agent-blog/2026/06/30/codex-file-tools-mcp/), not checked) measured a whole-file read at 3,105 tokens and a narrow read at 435: most of the saving comes from
reading a slice, not the whole file. That is the baseline's Grep path in gate C0.3.

## Security of agents that read untrusted HTML

| Source | Finding | Checked |
|---|---|---|
| [arXiv 2507.14799](https://arxiv.org/abs/2507.14799) | Injection through the accessibility tree makes a web agent leak credentials and click ads (Llama-3.1, BrowserGym). | Not checked: only the abstract was read |
| [TRAP, arXiv 2512.23128](https://arxiv.org/abs/2512.23128) | Agents are hijacked in 25% of tasks on average, over six frontier models. | Not checked |
| Playwright MCP write-ups ([one example](https://mythos.one/me/brianswichkow/149777)) | Text in `aria-label` reaches the model; the project says it is not a security boundary. | Not checked |

No source on forged refs was found.

## How this project differs

1. **It works on source files, and is designed to write the original bytes back** (gate C0.1 checks this). The
   browser tools read live pages and act
   through a browser. The reader tools give text that cannot be written back.
2. **It combines an outline with refs, a find tool, a read by ref and an edit by ref, for HTML.** In about 15 web
   searches, no tool was found that does this for HTML. The nearest (fast-html-mcp, not checked) edits by selector,
   with no outline.

## Owed before the design

- A direct GitHub search for HTML edit servers. The web search can miss new or small projects.
- One try of Serena on an `.html` file.
- A read of fast-html-mcp's README and licence.
