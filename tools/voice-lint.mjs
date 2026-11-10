// voice-lint.mjs: finds words that docs/voice.md says not to use, in the project's prose.
//
//   node tools/voice-lint.mjs
//
// Only words with one meaning are checked by machine. Add a project's banned terms to BANNED as docs/voice.md
// grows; a test checks that each one is written in docs/voice.md. To keep a listed word on purpose, add the marker
// voice-ok anywhere on that line.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Each entry is a word from docs/voice.md, and what to use instead. */
export const BANNED = [
  ["blazing", "(no marketing words)"],
  ["revolutionary", "(no marketing words)"],
  ["seamless", "(no marketing words)"],
  ["game-changing", "(no marketing words)"],
];

/** Hits of banned words in a text: { line, word, use }. */
export function lint(text, banned = BANNED) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes("voice-ok")) return;
    for (const [word, use] of banned) {
      if (new RegExp(`\\b${word}\\b`, "i").test(line)) hits.push({ line: i + 1, word, use });
    }
  });
  return hits;
}

function files() {
  const out = ["README.md", "AGENTS.md", "CLAUDE.md", "SETUP.md"];
  (function walk(dir) {
    if (!fs.existsSync(path.join(ROOT, dir))) return;
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".md") && rel !== "docs/voice.md") out.push(rel);
    }
  })("docs");
  return out.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "voice-lint.mjs";
if (isMain) {
  const hits = [];
  for (const f of files()) for (const h of lint(fs.readFileSync(path.join(ROOT, f), "utf8"))) hits.push(`${f}:${h.line}  "${h.word}": use ${h.use}`);
  if (hits.length) {
    console.log(hits.join("\n"));
    process.exit(1);
  }
  console.log(`${files().length} files checked; no banned words.`);
}
