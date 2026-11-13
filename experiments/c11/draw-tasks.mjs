// Gate C0.11's task set (docs/contract.md, "Gate C0.11"; decision 0012): 40 tasks drawn with the seed 20261117 from
// the 4 frozen v2 task sets, 20 from C0.10 v2, 8 from C0.7 v2, 6 from C0.8 v2 and 6 from C0.9 v2. Each set's draw is a
// uniform shuffle of its tasks, then its first n tasks. A task keeps all its fields; its id gets its set's name in
// front, and `kind` names the set. The file set lists each drawn task's file once, with its record from its set.
//   node experiments/c11/draw-tasks.mjs   writes experiments/c11/c11-tasks.json and experiments/c11/c11-file-set.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generator, shuffle } from '../c05/draw-files.mjs';
import { PATHS } from '../c07/tasks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (...p) => path.join(ROOT, ...p);
/** The seed and the mix (owner, 2026-11-13: mix A), in the order of the draw. */
export const C11 = { seed: 20261117, mix: [['c10', 20], ['c07', 8], ['c08', 6], ['c09', 6]] };
export const C11_PATHS = { tasks: 'experiments/c11/c11-tasks.json', fileSet: 'experiments/c11/c11-file-set.json' };

/**
 * The draw, from the 4 sets' tasks and file sets (`sets[g] = { tasks, record }`). One stream of the seed, used set by
 * set in the order of the mix. Returns the task set and the file set.
 */
export function drawMix(sets, mix = C11.mix, seed = C11.seed) {
  const rnd = generator(seed);
  const tasks = [];
  const kinds = [];
  for (const [g, n] of mix) {
    const pool = sets[g].tasks;
    if (pool.length < n) throw new Error(`${g}: ${pool.length} tasks, under ${n}`);
    const picked = shuffle(pool, rnd).slice(0, n);
    for (const t of picked) tasks.push({ ...t, id: `${g}.${t.id}`, kind: g, source: { set: g, id: t.id } });
    const files = new Set(picked.map((t) => t.file));
    const picks = sets[g].record.kinds.flatMap((k) => k.picks).filter((p) => files.has(p.file));
    if (picks.length !== files.size) throw new Error(`${g}: a drawn task's file is not in its file set`);
    kinds.push({ kind: g, picks });
  }
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) throw new Error('2 drawn tasks have the same id');
  return {
    tasks: { gate: 'C0.11', tools: 'v2', seed, mix: Object.fromEntries(mix), offsetUnit: 'UTF-16 code units', tasks },
    record: { gate: 'C0.11', seed, from: Object.fromEntries(mix.map(([g]) => [g, PATHS.fileSet(g)])), kinds },
  };
}

/**
 * Why the committed task set or file set is not the draw that the seed gives, or null (contract: "the runner makes it
 * again from the seed before the run"). `tasks` and `record` are the committed JSON values.
 */
export function mixProblem(tasks, record, sets) {
  const again = drawMix(sets);
  if (JSON.stringify(again.tasks) !== JSON.stringify(tasks)) return 'the task set drawn again differs from the committed one';
  if (JSON.stringify(again.record) !== JSON.stringify(record)) return 'the file set drawn again differs from the committed one';
  return null;
}

/** The 4 sets as committed. */
export function committedSets() {
  return Object.fromEntries(C11.mix.map(([g]) => [g, {
    tasks: JSON.parse(readFileSync(at(PATHS.tasks(g, false)), 'utf8')).tasks,
    record: JSON.parse(readFileSync(at(PATHS.fileSet(g)), 'utf8')),
  }]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const p of Object.values(C11_PATHS)) if (existsSync(at(p))) throw new Error(`${p} exists: the draw is written once`);
  const { tasks, record } = drawMix(committedSets());
  writeFileSync(at(C11_PATHS.tasks), `${JSON.stringify(tasks, null, 1)}\n`);
  writeFileSync(at(C11_PATHS.fileSet), `${JSON.stringify(record, null, 1)}\n`);
  const count = {};
  for (const t of tasks.tasks) count[t.kind] = (count[t.kind] ?? 0) + 1;
  console.log(`${tasks.tasks.length} tasks (${Object.entries(count).map(([k, n]) => `${k} ${n}`).join(', ')}); ${record.kinds.reduce((a, k) => a + k.picks.length, 0)} file records`);
}
