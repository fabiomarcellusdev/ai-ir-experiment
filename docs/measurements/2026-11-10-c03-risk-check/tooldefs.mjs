// Tool definitions for the risk check. M: a first draft of the MCP server's four tools. Both arms' definitions are
// approximations: the gate's run plan names the real ones.
// The baseline's definitions are the harness's own text (Claude Code), so they are not copied into this public
// repository. To run the check again, paste the harness's Read, Edit, Grep and Glob definitions (description and
// input schema) into these four strings. On 2026-11-10 the four together counted 783 proxy tokens, and Grep plus
// Glob counted 291 (with Glob's per-field schema descriptions left out). The four MCP drafts count 274.
export const B_READ = '';
export const B_EDIT = '';
export const GREP = '';
export const GLOB = '';
export const M_TOOLS = `html_outline: The reading view of an HTML file: one element per line, indented by depth, with an @n ref. Scripts, styles, SVG paths, comments and most attributes are left out. Returns pages of at most 20,000 tokens and the file hash.
{"properties":{"file":{"type":"string"},"page":{"type":"integer"}},"required":["file"],"type":"object"}
html_find: The elements whose visible text contains a literal string. For each deepest match: its outline line and its ancestors' lines, with refs. At most 20 matches, the total count, and the file hash.
{"properties":{"file":{"type":"string"},"text":{"type":"string"}},"required":["file","text"],"type":"object"}
html_read: One element, as the original bytes of the file. Needs the hash from html_outline or html_find.
{"properties":{"file":{"type":"string"},"ref":{"type":"integer"},"hash":{"type":"string"}},"required":["file","ref","hash"],"type":"object"}
html_edit: Replaces the bytes of one element with new HTML. Fails on a stale hash or an unbalanced fragment.
{"properties":{"file":{"type":"string"},"ref":{"type":"integer"},"hash":{"type":"string"},"html":{"type":"string"}},"required":["file","ref","hash","html"],"type":"object"}`;
