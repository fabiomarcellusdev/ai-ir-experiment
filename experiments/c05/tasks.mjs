// Draws gate C0.5's task set from its committed file set, with the C0.3 task rules and the seed 20261111
// (docs/contract.md, "The new inputs (a fresh draw)"). Run before any token count.
// Usage, from the repository root: node experiments/c05/tasks.mjs
// Writes experiments/c05/tasks.json (committed) and the expected files to experiments/gate-files/c05/expected/
// (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { makeTasks, applyChange } from '../c03/make-tasks.mjs';
import { SEED } from './draw-files.mjs';

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const record = JSON.parse(readFileSync('experiments/c05/file-set.json', 'utf8'));
  const files = record.kinds.flatMap((k) => k.picks).map((p) => ({ file: p.file, sha256: p.sha256, src: readFileSync(p.file, 'utf8') }));
  for (const f of files) if (sha(f.src) !== f.sha256) throw new Error(`${f.file} changed since the draw`);
  const tasks = makeTasks(files, SEED);
  mkdirSync('experiments/gate-files/c05/expected', { recursive: true });
  for (const t of tasks) {
    if (!t.change) continue;
    const exp = applyChange(files[t.fileNumber - 1].src, t.change);
    writeFileSync(`experiments/gate-files/c05/expected/${t.id}.html`, exp);
    t.expectedSha256 = sha(exp);
  }
  writeFileSync('experiments/c05/tasks.json', JSON.stringify({ seed: SEED, offsetUnit: 'UTF-16 code units of the file as text', tasks }, null, 1) + '\n');
  console.log(`${tasks.length} tasks written to experiments/c05/tasks.json`);
}
