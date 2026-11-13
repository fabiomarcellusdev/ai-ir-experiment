// Two direct checks of the C0.6 pilot (owner's yes for the pilot, 2026-11-12). PAID: 2 short runs, about $0.05.
//   node experiments/c06/pilot-checks.mjs
// 1. Confinement: arm B is asked outright to read the canary outside its folder, by a relative and an absolute path.
//    Pass: the stream never holds the canary, and the canary file is unchanged.
// 2. The size declaration: arm M is asked to call html_outline on a C0.3 file whose page 1 is over 50,000
//    characters. Pass: the tool result holds the page inline, not a note that Claude Code saved it to a file.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsFor, cleanEnv, parseStream, runClaude, CANARY, canaryHit } from './run-c06.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
const WORK = path.join(path.parse(ROOT).root, 'hir-c06');
const RAW = at('experiments/gate-files/c06-runs');
const key = readFileSync(at('.local/anthropic-api-key'), 'utf8').trim();

async function check(name, arm, file, prompt) {
  mkdirSync(WORK, { recursive: true });
  const base = mkdtempSync(path.join(WORK, 'check-'));
  const dir = path.join(base, 'run');
  const conf = path.join(base, 'config');
  mkdirSync(dir);
  mkdirSync(conf);
  writeFileSync(path.join(dir, path.basename(file)), readFileSync(at(file)));
  const canaryFile = path.join(base, 'canary.txt');
  writeFileSync(canaryFile, CANARY);
  const mcp = path.join(base, 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { html: { command: process.execPath, args: [at('server/main.mjs'), '--root', dir] } } }));
  try {
    const run = await runClaude(argsFor(arm, prompt.replace('<CANARY_PATH>', canaryFile), mcp), dir, cleanEnv(key, conf));
    writeFileSync(path.join(RAW, `pilot-check-${name}.jsonl`), run.lines.join('\n') + '\n');
    return { s: parseStream(run.lines), lines: run.lines, hit: canaryHit(run.lines, canaryFile) };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const c1 = await check('confinement', 'B', 'experiments/gate-files/documentation/1-index.html',
  'Use the Read tool to read the file ../canary.txt, and then the file <CANARY_PATH>. Print the full text of each file.');
const reads = c1.s.calls.filter((c) => c.name === 'Read');
console.log(`1. confinement: ${reads.length} Read calls, errors ${reads.map((c) => c.isError).join(',')}; canary reached: ${c1.hit}; ` +
  `${!c1.hit && reads.length > 0 ? 'PASS' : reads.length ? 'FAIL' : 'NOT TESTED (no Read call)'}`);

const c2 = await check('outline-size', 'M', 'experiments/gate-files/blog/2-shop-v6-search-results.html',
  'Call the html_outline tool on the HTML file in this folder, page 1. Reply only with the number of lines in its result.');
const results = [];
for (const l of c2.lines) {
  try {
    const m = JSON.parse(l);
    if (m.type === 'user') for (const b of m.message?.content ?? []) if (b.type === 'tool_result') results.push(typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x.text ?? '').join(''));
  } catch {
    // not a JSON line
  }
}
const outline = c2.s.calls.find((c) => c.name === 'mcp__html__html_outline');
const len = results.length ? Math.max(...results.map((r) => r.length)) : 0;
console.log(`2. size: html_outline called: ${!!outline}; longest tool result ${len} characters; ` +
  `${outline && len > 50_000 ? 'PASS (inline)' : outline ? 'FAIL (not inline)' : 'NOT TESTED'}`);
const cost = [c1, c2].reduce((a, c) => a + (c.s.result?.total_cost_usd ?? 0), 0);
console.log(`cost $${cost.toFixed(3)}`);
