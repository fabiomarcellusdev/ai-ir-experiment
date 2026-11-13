// Draws gate C0.3's task set (docs/contract.md, "The task set") from the committed file set, before any token count.
// Usage, from the repository root: node experiments/c03/make-tasks.mjs
// Writes experiments/c03/tasks.json (committed) and the expected files to experiments/gate-files/expected/
// (git-ignored). The draw uses one generator with seed 20261110, over the files in the record's order and the
// task types in the contract's order.
//
// Rules this script adds where the contract leaves a choice (recorded in the run plan before the run):
// - A target has an explicit end tag (parse5 gives no exact end for an implied one).
// - A target is a deepest element that holds its quote, and no other element of its tag holds the quote, so that
//   "the <tag> element that contains the text" names one element.
// - For a text change, the text node is a direct child of the target, its quote (its first 6 words) is in no other
//   element's visible text outside the target's ancestors, and the quote is in the node's source as written.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { load, norm } from './html.mjs';

export const SEED = 20261110;
const words = (s) => s.trim().split(' ').filter(Boolean);
const quoteOf = (s) => words(norm(s)).slice(0, 6).join(' ');

/**
 * The quote of an element: the first 6 words of its first direct text node that has a word, when those words are in
 * the node's source as written (so one Grep can find them on a line). Review, 2026-11-11: a quote from the whole
 * visible text could join the text of child elements, which no line holds.
 */
export function quoteFor(m, el) {
  for (const c of el.childNodes) {
    if (c.nodeName !== '#text') continue;
    const q = quoteOf(c.value);
    if (!q) continue;
    const loc = c.sourceCodeLocation;
    const at = loc ? m.src.indexOf(q, loc.startOffset) : -1;
    return at >= 0 && at + q.length <= loc.endOffset ? q : null;
  }
  return null;
}

export function candidates(m) {
  const body = m.els.find((e) => e.tagName === 'body');
  const inBody = (e) => { for (let p = m.parent.get(e); p; p = m.parent.get(p)) if (p === body) return true; return false; };
  return m.els.filter((e) => {
    if (!m.shown.has(e) || !inBody(e) || !e.sourceCodeLocation?.endTag) return false;
    const q = quoteFor(m, e);
    if (!q) return false;
    // The target is a deepest holder of its quote, and no other element of its tag holds the quote.
    if (m.els.some((c) => m.parent.get(c) === e && m.shown.has(c) && (m.vt.get(c) ?? '').includes(q))) return false;
    if (m.els.some((o) => o !== e && o.tagName === e.tagName && m.shown.has(o) && (m.vt.get(o) ?? '').includes(q))) return false;
    e.quote = q;
    return true;
  });
}

/** The number of <p> elements in a document, to check that an insertion survives parsing. */
const countP = (src) => load(src).els.filter((e) => e.tagName === 'p').length;

export function makeTasks(files, seed = SEED) {
  let s = seed;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >>> 16) % n; };
  const draw = (list, ok) => {
    for (let i = 0; i < 10_000; i++) { const x = list[rnd(list.length)]; const r = ok(x); if (r) return r; }
    throw new Error('no element meets the task rules');
  };
  const tasks = [];
  files.forEach((f, fi) => {
    const m = load(f.src);
    const cands = candidates(m);
    const n = fi + 1;
    const base = (type, el) => ({ id: `${n}-${type}`, fileNumber: n, file: f.file, type, ref: el.ref, tag: el.tagName,
      quote: el.quote, range: [el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset] });
    const pCount = countP(f.src);
    // 1. Question
    tasks.push(draw(cands, (el) => {
      if (!el.attrs.length) return null;
      const a = el.attrs[rnd(el.attrs.length)];
      const t = base('question', el);
      return { ...t, attr: a.name, answer: a.value,
        prompt: `What is the value of the \`${a.name}\` attribute of the \`${el.tagName}\` element that contains the text "${t.quote}"? End your reply with the line \`ANSWER: <value>\`.` };
    }));
    // 2. Text change
    tasks.push(draw(cands, (el) => {
      const texts = el.childNodes.filter((c) => c.nodeName === '#text' && words(norm(c.value)).length >= 3);
      if (!texts.length) return null;
      const tn = texts[rnd(texts.length)];
      const q = quoteOf(tn.value);
      const holders = m.els.filter((o) => m.shown.has(o) && (m.vt.get(o) ?? '').includes(q));
      if (holders.some((o) => o !== el && !isAncestor(m, o, el))) return null;
      const loc = tn.sourceCodeLocation;
      const at = m.src.indexOf(q, loc.startOffset);
      if (at < 0 || at + q.length > loc.endOffset) return null;
      const t = { ...base('text', el), quote: q, newText: `Updated wording ${n}` };
      return { ...t, change: [at, at + q.length, t.newText],
        prompt: `Change the text "${q}" to "${t.newText}". Change nothing else.` };
    }));
    // 3. Attribute change
    tasks.push(draw(cands, (el) => {
      if (!el.attrs.length) return null;
      const a = el.attrs[rnd(el.attrs.length)];
      const loc = el.sourceCodeLocation.attrs?.[a.name];
      if (!loc) return null;
      const t = { ...base('attribute', el), attr: a.name, newValue: `updated-value-${n}` };
      return { ...t, change: [loc.startOffset, loc.endOffset, `${a.name}="${t.newValue}"`],
        prompt: `In the \`${el.tagName}\` element that contains the text "${t.quote}", set the \`${a.name}\` attribute to "${t.newValue}". Change nothing else.` };
    }));
    // 4. Structure change: even file numbers insert, odd file numbers remove.
    tasks.push(draw(cands, (el) => {
      const t = base('structure', el);
      const [a, b] = t.range;
      // An insertion must give one more <p> after parsing (review, 2026-11-11: inside a <select>, parse5 drops it).
      if (n % 2 === 0 && countP(applyChange(f.src, [b, b, '<p>New text</p>'])) !== pCount + 1) return null;
      return n % 2 === 0
        ? { ...t, op: 'insert', change: [b, b, '<p>New text</p>'], range: [b, b],
          prompt: `After the \`${el.tagName}\` element that contains the text "${t.quote}", add \`<p>New text</p>\`.` }
        : { ...t, op: 'remove', change: [a, b, ''],
          prompt: `Remove the \`${el.tagName}\` element that contains the text "${t.quote}".` };
    }));
  });
  return tasks;
}

export function isAncestor(m, a, d) { for (let p = m.parent.get(d); p; p = m.parent.get(p)) if (p === a) return true; return false; }
export const applyChange = (src, [a, b, text]) => src.slice(0, a) + text + src.slice(b);

if (process.argv[1] && process.argv[1].endsWith('make-tasks.mjs')) {
  const record = JSON.parse(readFileSync('experiments/c03/file-set.json', 'utf8'));
  const files = record.kinds.flatMap((k) => k.picks).map((p) => ({ file: p.file, sha256: p.sha256, src: readFileSync(p.file, 'utf8') }));
  for (const f of files) {
    if (createHash('sha256').update(f.src, 'utf8').digest('hex') !== f.sha256) throw new Error(`${f.file} changed since the draw`);
  }
  const tasks = makeTasks(files);
  mkdirSync('experiments/gate-files/expected', { recursive: true });
  for (const t of tasks) {
    if (!t.change) continue;
    const exp = applyChange(files[t.fileNumber - 1].src, t.change);
    writeFileSync(`experiments/gate-files/expected/${t.id}.html`, exp);
    t.expectedSha256 = createHash('sha256').update(exp, 'utf8').digest('hex');
  }
  writeFileSync('experiments/c03/tasks.json', JSON.stringify({ seed: SEED, offsetUnit: 'UTF-16 code units of the file as text', tasks }, null, 1) + '\n');
  for (const t of tasks) console.log(t.id.padEnd(12), t.tag.padEnd(8), JSON.stringify(t.quote).slice(0, 50).padEnd(52), t.attr ?? t.op ?? '');
}
