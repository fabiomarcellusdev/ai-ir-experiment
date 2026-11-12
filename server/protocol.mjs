// The MCP protocol layer: JSON-RPC 2.0, one message per line on stdio (decision 0006, "The protocol"). Pure
// functions: the main thread gives it the lines and a function that runs a tool.
import { StringDecoder } from 'node:string_decoder';
import RAW_TOOLS from '../experiments/c03/mcp-tools.json' with { type: 'json' };

export const SERVER_INFO = { name: 'html', version: '0.1.0' };
/** The MCP protocol versions this server knows, oldest first. */
export const KNOWN_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
/** The longest message line the server accepts: 8 MB of text. */
export const MAX_LINE = 8 * 1024 * 1024;

/**
 * The largest text result that Claude Code shows inline, in characters: one outline page (60,000) and its header line.
 * Without it, Claude Code saves a result over 50,000 characters to a file (C0.6 run plan; contract, C0.4: "The MCP
 * output limit must be at least the outline page size"). Claude Code reads `_meta`; it is not the tool text.
 */
export const MAX_RESULT_CHARS = 65_000;

/**
 * The tool definitions of experiments/c03/mcp-tools.json, frozen for gate C0.6: the `mcp__html__` prefix removed and
 * `input_schema` renamed to `inputSchema`. The name, description and schema do not change; `_meta` holds the size.
 */
export const TOOLS = RAW_TOOLS.map((t) => ({
  name: t.name.replace(/^mcp__html__/, ''),
  description: t.description,
  inputSchema: t.input_schema,
  _meta: { 'anthropic/maxResultSizeChars': MAX_RESULT_CHARS },
}));

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * Handles one message line. Returns the response, or null when no response is due.
 * @param {string} line @param {(name: string, args: object) => Promise<object>} callTool
 */
export async function handle(line, callTool) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return error(null, -32700, 'Parse error');
  }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return error(null, -32600, 'Invalid Request');
  }
  const hasId = 'id' in msg && (typeof msg.id === 'string' || Number.isInteger(msg.id));
  if (typeof msg.method !== 'string') {
    // A response from the client: this server sends no requests, so nothing is due.
    if ('result' in msg || 'error' in msg) return null;
    return error(hasId ? msg.id : null, -32600, 'Invalid Request');
  }
  if (!('id' in msg)) return null; // A notification, for example notifications/initialized.
  if (!hasId) return error(null, -32600, 'Invalid Request');
  const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (msg.method) {
    case 'initialize': {
      const v = KNOWN_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : KNOWN_VERSIONS.at(-1);
      return reply(msg.id, { protocolVersion: v, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    }
    case 'ping':
      return reply(msg.id, {});
    case 'tools/list':
      return reply(msg.id, { tools: TOOLS });
    case 'tools/call':
      if (!TOOLS.some((t) => t.name === p.name)) return error(msg.id, -32602, `Unknown tool: ${String(p.name)}`);
      return reply(msg.id, await callTool(p.name, p.arguments ?? {}));
    default:
      return error(msg.id, -32601, 'Method not found');
  }
}

/** A tool result for the text of a tool or of its named error. */
export const toolResult = (text, isError = false) =>
  (isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] });

/** Splits a byte stream into lines. A line longer than MAX_LINE is dropped, and onTooLong runs once for it. */
export class LineSplitter {
  /** @param {(line: string) => void} onLine @param {() => void} onTooLong @param {number} max */
  constructor(onLine, onTooLong, max = MAX_LINE) {
    this.onLine = onLine;
    this.onTooLong = onTooLong;
    this.max = max;
    this.decoder = new StringDecoder('utf8');
    this.buf = '';
    this.dropping = false;
  }

  /** @param {Buffer} chunk */
  push(chunk) {
    let s = this.decoder.write(chunk);
    for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n')) {
      const part = s.slice(0, i);
      s = s.slice(i + 1);
      if (this.dropping) {
        this.dropping = false;
        this.buf = '';
        continue;
      }
      const line = (this.buf + part).replace(/\r$/, '');
      this.buf = '';
      if (line.length > this.max) this.onTooLong();
      else if (line.trim()) this.onLine(line);
    }
    if (this.dropping) return;
    this.buf += s;
    if (this.buf.length > this.max) {
      this.buf = '';
      this.dropping = true;
      this.onTooLong();
    }
  }
}
