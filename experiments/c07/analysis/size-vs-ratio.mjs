// Exploratory, after the 4 v2 gates (owner's question, 2026-11-12): does the size of the file or of the change predict
// a task's token ratio? Reads the committed results and task sets; decides nothing. Run: node <this file> <repository root>
import { readFileSync } from 'node:fs';
const root = process.argv[2];
const med = (a) => { a = [...a].sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (x, y) => { const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length; let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy); };
const rows = [];
for (const g of ['c07', 'c08', 'c09', 'c10']) {
  const r = JSON.parse(readFileSync(`${root}/experiments/c07/gate-v2-${g}-result.json`, 'utf8'));
  const tasks = JSON.parse(readFileSync(`${root}/experiments/c07/v2-${g}-tasks.json`, 'utf8')).tasks;
  const t = {};
  for (const x of r.runs) if (x.pass) (t[x.task] ??= { B: [], M: [] })[x.arm].push(x.tokens);
  for (const task of tasks) {
    const v = t[task.id]; if (!v || !v.B.length || !v.M.length) continue;
    const rg = task.range; const chars = rg ? (rg.end ?? rg[1]) - (rg.start ?? rg[0]) : null;
    const file = readFileSync(`${root}/${task.file}`, 'utf8');
    rows.push({ g, id: task.id, type: task.type, chars, fileChars: file.length, lines: file.split('\n').length, ratio: med(v.M) / med(v.B), B: med(v.B) });
  }
}
const ok = rows.filter((r) => Number.isFinite(r.chars));
console.log('tasks with a ratio', rows.length, 'with a target range', ok.length);
for (const [label, key] of [['target chars', 'chars'], ['file chars', 'fileChars'], ['file lines', 'lines'], ['baseline tokens', 'B']]) {
  const x = ok.map((r) => r[key]), y = ok.map((r) => r.ratio);
  console.log(`Spearman(${label}, ratio) = ${pearson(rank(x), rank(y)).toFixed(3)}`);
}
const bins = [[0, 500], [500, 2000], [2000, 8000], [8000, 1e9]];
for (const [lo, hi] of bins) { const b = ok.filter((r) => r.chars >= lo && r.chars < hi); if (b.length) console.log(`target ${lo}-${hi < 1e9 ? hi : '∞'} chars: ${b.length} tasks, median ratio ${med(b.map((r) => r.ratio)).toFixed(3)}, share below 1.00 ${(b.filter((r) => r.ratio < 1).length / b.length).toFixed(2)}, gates ${[...new Set(b.map((r) => r.g))].join(',')}`); }
for (const g of ['c07', 'c08', 'c09', 'c10']) { const b = ok.filter((r) => r.g === g); console.log(g, 'target chars median', med(b.map((r) => r.chars)), 'range', Math.min(...b.map((r) => r.chars)), '-', Math.max(...b.map((r) => r.chars))); }
// within the small-target tasks only: does size still matter?
const small = ok.filter((r) => r.chars < 2000);
console.log('within targets < 2000 chars: Spearman(chars, ratio) =', pearson(rank(small.map((r) => r.chars)), rank(small.map((r) => r.ratio))).toFixed(3), 'n', small.length);
const byGateType = {}; for (const r of ok) (byGateType[`${r.g} ${r.type}`] ??= []).push(r);
for (const [k, v] of Object.entries(byGateType)) console.log(k.padEnd(18), 'n', v.length, 'median chars', String(med(v.map((r) => r.chars))).padStart(6), 'median ratio', med(v.map((r) => r.ratio)).toFixed(3));
