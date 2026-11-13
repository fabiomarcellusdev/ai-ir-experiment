// The named errors of the 4 tools (decision 0006, "The protocol"). A ToolError becomes an MCP result with
// `isError: true`. Its message names what failed and gives no advice (docs/contract.md, C0.6).

export class ToolError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

/** @param {string} message */
export const fail = (message) => {
  throw new ToolError(message);
};
