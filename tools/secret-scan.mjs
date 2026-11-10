// secret-scan.mjs: finds text that looks like a secret (an API key, a token, a private key, a password in a URL or an
// assignment) in the files that git would publish, in the lines a push adds, and in pushed commit messages. A machine
// checks first: an AI agent that read the diff would copy the secret into its transcript (AGENTS.md, "If a secret
// appears").
//
//   node tools/secret-scan.mjs           scans every tracked file and every untracked file that git would add
//
// It prints the file, the line and the kind of secret, never the secret itself: for a known format the first 4
// characters and the length; for a password or an assigned value, the length only. A false alarm goes into
// tools/secret-scan.allow.json with its reason; that file is a guard file, so the owner approves each entry.
// Node's standard library only.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Well-known secret formats. Each needs enough characters after its prefix that a word or a regex cannot match, and
 * every quantifier is bounded, so a long line costs linear time.
 */
export const PATTERNS = [
  { name: "private key", re: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY( BLOCK)?-----/ },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,200}/ },
  { name: "OpenAI API key", re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,200}/ },
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255})/ },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,64}/ },
  { name: "AWS access key", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/ },
  { name: "Azure storage key", re: /\bAccountKey=[A-Za-z0-9+/]{60,120}={0,2}/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Google OAuth client secret", re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/ },
  { name: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,64}\b/ },
  { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,200}/ },
  { name: "Slack webhook", re: /\bhooks\.slack\.com\/services\/T[A-Z0-9]{6,20}\/B[A-Z0-9]{6,20}\/[A-Za-z0-9]{20,40}/ },
  { name: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,200}/ },
  { name: "Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{32,100}/ },
  { name: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "PyPI token", re: /\bpypi-AgE[A-Za-z0-9_-]{50,300}/ },
  { name: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,2000}\.eyJ[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{10,2000}/ },
  { name: "password in a URL", re: /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@"'`]{1,100}:([^\s@/"'`]{6,200})@/i, group: 1, lengthOnly: true },
];

// An assignment such as `apiKey = "..."`, `"token": "..."`, `API_KEY=...` or `password: ...`, judged by the value's
// randomness. The name must END with a secret word: `accessToken`, `client_secret` and `SECRET_KEY` count; `tokenizer`
// and `author` do not. A value without quotes must look like a key (letters, digits, + / = _ -), so code such as
// `token = process.env.TOKEN` or `key = getKey()` does not count.
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]{0,64}(?:api[_-]?key|(?:secret|access|signing|encryption|client|master|private)[_-]?key|secret|token|passw(?:or)?d|pwd|auth|credentials?)`;
const ASSIGNMENT = new RegExp(String.raw`(?:^|[^A-Za-z0-9_.-])(${SECRET_NAME})["']?\s{0,8}[:=]\s{0,8}(?:["'\`]([^"'\`\s]{16,300})["'\`]|([A-Za-z0-9+/=_-]{16,300})(?=[\s;,]|$))`, "i");
const PLACEHOLDER = /example|sample|placeholder|your[_-]|changeme|dummy|fake|redacted|xxxx|\*\*\*|<|>|\$|\{|\}|%s|process\.env|import\.meta\.env|os\.environ/i;

/** Shannon entropy in bits per character. Random keys score above 3.5; words and identifiers score lower. */
export function entropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

/** The first 4 characters and the length; for a short secret (a password), the length only. */
export const mask = (s, { lengthOnly = false } = {}) => (lengthOnly ? `(${s.length} characters)` : `${s.slice(0, 4)}… (${s.length} characters)`);

/** The secrets in one line of text: [{ name, masked }]. */
export function scanLine(line) {
  const hits = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(line);
    if (!m) continue;
    const value = m[p.group ?? 0];
    if (p.name !== "private key" && PLACEHOLDER.test(value)) continue; // AKIAIOSFODNN7EXAMPLE, postgres://u:${pass}@h
    hits.push({ name: p.name, masked: mask(value, { lengthOnly: p.lengthOnly }) });
  }
  const a = ASSIGNMENT.exec(line);
  if (a && !hits.length) {
    const value = a[2] ?? a[3];
    if (!PLACEHOLDER.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value) && entropy(value) >= 3.5) {
      hits.push({ name: `a random value assigned to "${a[1].slice(-40)}"`, masked: mask(value, { lengthOnly: true }) });
    }
  }
  return hits;
}

/** The secrets in a file's text: [{ line, name, masked }]. */
export function scanText(text) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => { for (const h of scanLine(l)) out.push({ line: i + 1, ...h }); });
  return out;
}

/**
 * The secrets in the lines a patch adds (`git log -p` output): [{ file, name, masked }]. A "+++ " line is a file
 * header only between "diff --git" and the first "@@"; inside a hunk, every "+" line is content (an added line that
 * starts with "++ " is still scanned).
 */
export function scanAddedLines(patchText) {
  const out = [];
  let file = null, inHunk = false;
  for (const l of patchText.split(/\r?\n/)) {
    if (l.startsWith("diff --git ")) { inHunk = false; file = null; continue; }
    if (!inHunk && l.startsWith("+++ ")) { file = l.slice(4).replace(/^b\//, "").slice(0, 300); continue; }
    if (l.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk || !l.startsWith("+")) continue;
    for (const h of scanLine(l.slice(1))) out.push({ file, ...h });
  }
  return out;
}

/** A file's bytes as text: UTF-16 by its BOM, UTF-8 otherwise; null for a binary file (a NUL byte, no UTF-16 BOM). */
export function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buf.includes(0) ? null : buf.toString("utf8");
}

/** The allow list: [{ path, kind, reason }]. A hit is allowed when its file and its kind match an entry. */
export function loadAllow(root = ROOT) {
  const f = path.join(root, "tools", "secret-scan.allow.json");
  if (!fs.existsSync(f)) return [];
  const list = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!Array.isArray(list) || list.some((e) => typeof e?.path !== "string" || typeof e?.kind !== "string" || typeof e?.reason !== "string" || !e.reason.trim())) {
    throw new Error("tools/secret-scan.allow.json: every entry needs a path, a kind and a reason");
  }
  return list;
}
export const allowed = (allow, file, name) => allow.some((e) => e.path === file && e.kind === name);

/**
 * Scans the files that git would publish. Returns { hits: ["file:line kind (masked)"], skipped: ["file: why"] }.
 * A text file too large to scan is reported, never silently passed over. UTF-16 text is decoded by its BOM.
 */
export function scanRepository(root = ROOT) {
  const allow = loadAllow(root);
  const r = spawnSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git ls-files failed");
  const hits = [], skipped = [];
  for (const f of r.stdout.split("\0").filter(Boolean)) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (fs.statSync(abs).size > MAX_FILE_BYTES) { skipped.push(`${f}: over 2 MB, not scanned`); continue; }
    const text = decode(fs.readFileSync(abs));
    if (text === null) continue; // a binary file (an image, an archive): not text, so not scanned and not listed
    for (const h of scanText(text)) if (!allowed(allow, f, h.name)) hits.push(`${f}:${h.line} ${h.name} ${h.masked}`);
  }
  return { hits, skipped };
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "secret-scan.mjs";
if (isMain) {
  const { hits, skipped } = scanRepository();
  if (skipped.length) console.log(`Not scanned:\n${skipped.join("\n")}\n`);
  if (hits.length) {
    console.log(hits.join("\n"));
    console.log("\nThese look like secrets. Follow AGENTS.md, \"If a secret appears\": revoke and rotate a real secret first.");
    process.exit(1);
  }
  console.log("No secret found in the files that git would publish.");
}
