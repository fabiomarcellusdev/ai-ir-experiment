// The module boundaries of the server (decision 0006, "Modules"; AGENTS.md, "Structure"): only workspace.mjs
// touches files, and no two modules import each other in a cycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULES = readdirSync(DIR).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'testkit.mjs');

/** The import specifiers of a module's source: static imports, re-exports and dynamic imports. */
export function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

const FILE_ACCESS = /^(node:)?(fs|fs\/promises)$/;

test('only workspace.mjs imports the file system', () => {
  assert.ok(MODULES.includes('workspace.mjs') && MODULES.length >= 8, MODULES.join(', '));
  for (const f of MODULES) {
    const bad = importsOf(readFileSync(path.join(DIR, f), 'utf8')).filter((s) => FILE_ACCESS.test(s));
    if (f === 'workspace.mjs') assert.ok(bad.length > 0, 'the check finds the import in workspace.mjs');
    else assert.deepEqual(bad, [], f);
  }
});

/** The first import cycle in a graph of module names, or null. */
export function findCycle(graph) {
  const state = new Map();
  const visit = (f, trail) => {
    if (state.get(f) === 'done') return null;
    if (state.get(f) === 'open') return [...trail.slice(trail.indexOf(f)), f];
    state.set(f, 'open');
    for (const g of graph.get(f) ?? []) {
      const c = visit(g, [...trail, f]);
      if (c) return c;
    }
    state.set(f, 'done');
    return null;
  };
  for (const f of graph.keys()) {
    const c = visit(f, []);
    if (c) return c;
  }
  return null;
}

test('the server modules have no import cycle', () => {
  const graph = new Map(MODULES.map((f) => [f, importsOf(readFileSync(path.join(DIR, f), 'utf8'))
    .filter((s) => s.startsWith('./')).map((s) => s.slice(2))]));
  assert.equal(findCycle(graph), null);
});

test('negative controls: the checks find a file-system import and a cycle', () => {
  assert.deepEqual(importsOf("import { readFileSync } from 'node:fs';\nimport x from './a.mjs';").filter((s) => FILE_ACCESS.test(s)), ['node:fs']);
  assert.deepEqual(importsOf("const m = await import('fs/promises');"), ['fs/promises']);
  assert.deepEqual(importsOf("export { x } from './b.mjs';"), ['./b.mjs']);
  // A real cycle, a longer one, and a graph with none (review, gap 7).
  assert.deepEqual(findCycle(new Map([['a.mjs', ['b.mjs']], ['b.mjs', ['a.mjs']]])), ['a.mjs', 'b.mjs', 'a.mjs']);
  assert.deepEqual(findCycle(new Map([['a.mjs', ['b.mjs']], ['b.mjs', ['c.mjs']], ['c.mjs', ['b.mjs']]])), ['b.mjs', 'c.mjs', 'b.mjs']);
  assert.equal(findCycle(new Map([['a.mjs', ['b.mjs', 'c.mjs']], ['b.mjs', ['c.mjs']], ['c.mjs', []]])), null);
});
