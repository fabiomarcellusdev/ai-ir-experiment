// Counts the input tokens of MCP tool definitions with Anthropic's free count_tokens (decision 0010). The key never
// reaches the output. Run: node <this file> .local/anthropic-api-key claude-sonnet-5-5 <tools.json> ...
import { readFileSync } from 'node:fs';
const [keyFile, model, ...files] = process.argv.slice(2);
const key = readFileSync(keyFile, 'utf8').trim();
async function count(tools) {
  const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'x' }], ...(tools ? { tools } : {}) }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`count_tokens ${r.status}: ${String(j.error?.message ?? '').split(key).join('[key]')}`);
  return j.input_tokens;
}
const base = await count(null);
console.log('no tools:', base);
for (const f of files) {
  const tools = JSON.parse(readFileSync(f, 'utf8'));
  const all = await count(tools);
  const each = [];
  for (const t of tools) each.push(`${t.name.replace('mcp__html__', '')} ${(await count([t])) - base}`);
  console.log(f.split(/[\/]/).pop().padEnd(18), 'all 3:', all - base, '|', each.join(', '), '| description chars', tools.map((t) => t.description.length).join('/'));
}
