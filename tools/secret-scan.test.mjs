// Tests for secret-scan.mjs. Every fake secret here is built from pieces at run time, so this file itself holds no
// text the scanner would flag, and no real secret.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PATTERNS, scanLine, scanText, scanAddedLines, entropy, mask, decode, loadAllow, scanRepository } from "./secret-scan.mjs";

const j = (...parts) => parts.join("");
const R = "Zq8vK2pX7mN4bT9wL3cY6hR1dF5gJ0sA"; // 32 random-looking characters, not a key of any service
const FAKES = {
  "private key": j("-----BEGIN ", "RSA PRIVATE KEY-----"),
  "Anthropic API key": j("sk-", "ant-", "api03-", R),
  "OpenAI API key": j("sk-", "proj-", R, R.slice(0, 8)),
  "GitHub token": j("gh", "p_", R, "Ab12"),
  "GitLab token": j("gl", "pat-", R.slice(0, 20)),
  "AWS access key": j("AK", "IA", "Q3XN7RZ2KD4MWP6T"),
  "Azure storage key": j("Account", "Key=", R, R, "Ab3+=="),
  "Google API key": j("AI", "za", R, "Ab3"),
  "Google OAuth client secret": j("GOC", "SPX-", R.slice(0, 28)),
  "Hugging Face token": j("h", "f_", R, "Ab"),
  "Slack token": j("xo", "xb-", "1234567890-", R.slice(0, 12)),
  "Slack webhook": j("https://hooks.", "slack.com/services/", "T0ABC1234/", "B0DEF5678/", R.slice(0, 24)),
  "Stripe key": j("sk", "_live_", R.slice(0, 24)),
  "Stripe webhook secret": j("wh", "sec_", R),
  "SendGrid key": j("S", "G.", R.slice(0, 22), ".", R, R.slice(0, 11)),
  "npm token": j("np", "m_", R, "Ab12"),
  "PyPI token": j("py", "pi-AgE", R, R),
  "JSON Web Token": j("ey", "JhbGciOiJIUzI1NiJ9.", "ey", "JzdWIiOiIxMjM0NTY3ODkwIn0.", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
  "password in a URL": j("postgres://admin:", "S3cr3tPassw0rd", "@db.internal:5432/app"),
};

test("each well-known secret format is found, with its kind", () => {
  for (const [name, fake] of Object.entries(FAKES)) {
    const hits = scanLine(`const value = "${fake}";`);
    assert.ok(hits.some((h) => h.name === name), `${name}: ${JSON.stringify(hits)}`);
  }
  assert.equal(PATTERNS.length, Object.keys(FAKES).length, "every pattern has a fake in this test");
});

test("the output never holds the secret; a password or an assigned value shows its length only", () => {
  const fake = FAKES["Anthropic API key"];
  const [hit] = scanLine(`key=${fake}`);
  assert.equal(hit.masked, `${fake.slice(0, 4)}… (${fake.length} characters)`);
  assert.ok(!JSON.stringify(scanText(`a\nkey=${fake}\n`)).includes(fake.slice(4, 20)));
  assert.equal(scanLine(`DB=${FAKES["password in a URL"]}`)[0].masked, "(14 characters)");
  assert.equal(scanLine(j('const apiKey = "', "9fK2xQ7mZ4vB8nT3wL6c", '";'))[0].masked, "(20 characters)");
  assert.equal(mask("abcdefgh"), "abcd… (8 characters)");
});

test("an assigned random value: quoted or not, .env and YAML style, and names that end in a secret word", () => {
  for (const line of [
    j('const apiKey = "', "9fK2xQ7mZ4vB8nT3wL6c", '";'),
    j('  "client_secret": "', "q8Z2mX7vK4nB9tW3", '",'),
    j("API_KEY=", "9fK2xQ7mZ4vB8nT3wL6c"),
    j("password: ", "q8Z2mX7vK4nB9tW3pL5"),
    j("SECRET_KEY = '", "q8Z2mX7vK4nB9tW3pL5", "'"),
    j("aws_secret_access_key = ", "q8Z2mX7vK4nB9tW3pL5r6T"),
  ]) assert.equal(scanLine(line).length, 1, line);
});

test("placeholders, environment reads, code and ordinary words are not secrets", () => {
  for (const quiet of [
    'const apiKey = "your-api-key-goes-here";',
    "const token = process.env.GITHUB_TOKEN;",
    "API_KEY=${API_KEY_FROM_VAULT}",
    'password: "correcthorsebatterystaple",',
    'const secret = "${SECRET_FROM_VAULT}";',
    'apiKey: "<YOUR_KEY_HERE_1234567>"',
    'const tokenizer = "o200k_base_tokenizer_v2";',
    'const authorName = "Ada Lovelace";',
    "const key = getKey(user.id2025);",
    "const url = `postgres://${user}:${pass}@${host}/db`;",
    "aws_access_key_id = AKIAIOSFODNN7EXAMPLE",
    "import { createHash } from 'node:crypto';",
    "const re = /sk-ant-[A-Za-z0-9_-]{20,}/;",
    "See https://example.com/docs and git@github.com:owner/repo.git",
    "The mask shows sk-a… (56 characters).",
    "const id = 'f3a9c2e1b7d84a6f9e0c1b2a3d4e5f60';",
  ]) assert.deepEqual(scanLine(quiet), [], quiet);
});

test("a long hostile line is scanned in linear time (no catastrophic backtracking)", () => {
  for (const line of ["a.".repeat(100_000), "x".repeat(200_000) + "://", "api_key".repeat(30_000), "-".repeat(200_000)]) {
    const t = performance.now();
    scanLine(line);
    assert.ok(performance.now() - t < 1000, `took ${Math.round(performance.now() - t)} ms on a line of ${line.length}`);
  }
});

test("entropy: random text scores high, a repeated or wordy text scores low", () => {
  assert.ok(entropy(R) > 4);
  assert.ok(entropy("aaaaaaaaaaaaaaaa") === 0);
  assert.ok(entropy("passwordpassword") < 3);
});

test("added lines of a patch: the file of each hit; removed lines ignored; a '++ ' line inside a hunk is content", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1,3 @@",
    `-const old = "${FAKES["GitHub token"]}";`,
    `+const key = "${FAKES["Anthropic API key"]}";`,
    `+++ ${FAKES["Stripe key"]}`,
    "+const ok = 1;",
  ].join("\n");
  assert.deepEqual(scanAddedLines(patch).map((h) => [h.file, h.name]), [["src/a.ts", "Anthropic API key"], ["src/a.ts", "Stripe key"]]);
});

test("UTF-16 text is decoded by its BOM; other bytes with a NUL are binary", () => {
  const text = `key=${FAKES["npm token"]}\n`;
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const be = Buffer.from(le); be.swap16();
  assert.equal(decode(le), text);
  assert.equal(decode(be), text);
  assert.equal(decode(Buffer.from([0, 1, 2])), null);
  assert.equal(decode(Buffer.from("plain")), "plain");
});

test("the repository scan: UTF-16 files, a large file reported, git-ignored files left out, the allow list with reasons", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  spawnSync("git", ["init", "-q"], { cwd: dir, env });
  fs.mkdirSync(path.join(dir, "tools"));
  fs.writeFileSync(path.join(dir, "config.ts"), `export const key = "${FAKES["Stripe key"]}";\n`);
  fs.writeFileSync(path.join(dir, "fixture.txt"), `${FAKES["private key"]}\n`);
  fs.writeFileSync(path.join(dir, "out.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`t=${FAKES["npm token"]}\n`, "utf16le")]));
  fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, ...Buffer.from(FAKES["npm token"])]));
  fs.writeFileSync(path.join(dir, "big.log"), "x".repeat(2 * 1024 * 1024 + 1));
  const files = (r) => r.hits.map((h) => h.split(" ")[0]);
  let r = scanRepository(dir);
  assert.deepEqual(files(r), ["config.ts:1", "fixture.txt:1", "out.txt:1"]);
  assert.deepEqual(r.skipped, ["big.log: over 2 MB, not scanned"]);
  fs.writeFileSync(path.join(dir, "tools", "secret-scan.allow.json"), JSON.stringify([{ path: "fixture.txt", kind: "private key", reason: "a test fixture" }]));
  assert.deepEqual(files(scanRepository(dir)), ["config.ts:1", "out.txt:1"]);
  fs.writeFileSync(path.join(dir, "tools", "secret-scan.allow.json"), JSON.stringify([{ path: "config.ts", kind: "Stripe key", reason: " " }]));
  assert.throws(() => loadAllow(dir), /reason/);
  fs.writeFileSync(path.join(dir, ".gitignore"), "config.ts\n");
  fs.rmSync(path.join(dir, "tools", "secret-scan.allow.json"));
  assert.deepEqual(files(scanRepository(dir)), ["fixture.txt:1", "out.txt:1"], "a git-ignored file is not published, so it is not scanned");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("check.mjs runs the secret scan at every level", () => {
  const text = fs.readFileSync(new URL("./check.mjs", import.meta.url), "utf8");
  assert.match(text, /privacy\(cfg\); secrets\(\);\n\s+if \(mode !== "fast"\)/);
});

test("this repository holds no secret (the same scan as check.mjs)", () => {
  assert.deepEqual(scanRepository().hits, []);
});
