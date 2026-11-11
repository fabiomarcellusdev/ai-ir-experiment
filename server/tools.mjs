// The 4 tools: argument checks, then the view or the edit. It reads files through the workspace and writes none:
// html_edit returns the new bytes, and the main thread writes them (decision 0006, "The edit").
import { fail } from './errors.mjs';
import { load, outlinePage, findText, readRef } from './view.mjs';
import { editBytes } from './edit.mjs';
import { MAX_BYTES } from './workspace.mjs';

export const TOOL_NAMES = ['html_outline', 'html_find', 'html_read', 'html_edit'];

/**
 * Runs one tool. Returns `{ text }`, or for html_edit `{ write: { real, bytes, oldHash, id } }`.
 * @param {ReturnType<import('./workspace.mjs').openWorkspace>} ws @param {string} name @param {object} args
 */
export function runTool(ws, name, args) {
  if (!TOOL_NAMES.includes(name)) fail(`the tool ${name} does not exist`);
  const a = args && typeof args === 'object' ? args : {};
  const str = (k) => (typeof a[k] === 'string' ? a[k] : fail(`the argument "${k}" is not a string`));
  const int = (k) => (Number.isInteger(a[k]) ? a[k] : fail(`the argument "${k}" is not an integer`));

  const file = str('file');
  const page = name === 'html_outline' && a.page !== undefined ? int('page') : 1;
  const text = name === 'html_find' ? str('text') : '';
  const ref = name === 'html_read' || name === 'html_edit' ? int('ref') : 0;
  const hash = name === 'html_read' || name === 'html_edit' ? str('hash') : '';
  const html = name === 'html_edit' ? str('html') : '';
  // Before any parse (security review, other finding 2).
  if (Buffer.byteLength(html) > MAX_BYTES) fail('the new HTML is larger than 2 MB');

  const f = ws.read(file);
  const m = load(f.text, f.hash);
  switch (name) {
    case 'html_outline':
      return { text: outlinePage(m, page) };
    case 'html_find':
      return { text: findText(m, text) };
    case 'html_read':
      if (hash !== f.hash) fail('the file changed since the hash');
      return { text: readRef(m, ref) };
    default:
      return { write: { real: f.real, bytes: editBytes(m, f.bytes, ref, hash, html), oldHash: f.hash, id: f.id } };
  }
}
