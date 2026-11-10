// Regression tests for a CodeQL alert (js/incomplete-sanitization, 2026-11-07) and the security review of its fix:
// the vet tool once replaced only the first "/" of a package name before it built a URL, and read the name as the
// minimum age when the age flag was missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validName, registryUrl, downloadsUrl, parseArgs } from "./vet-package.mjs";

test("validName accepts real npm names", () => {
  for (const n of ["parse5", "postcss", "js-tiktoken", "@types/node", "@scope/a.b_c~d", "JSONStream", "a",
    "@scope/_private", "@_scope/x", "@.scope/x", "@scope/.x"]) {
    assert.equal(validName(n), true, n);
  }
});

test("validName refuses names that could change a URL", () => {
  for (const n of ["", "a/b/c", "@scope/a/b", "../x", "x/../y", "x?y", "x#y", "x y", "x%2fy", "@/x", "@scope/",
    ".hidden", "_under", "@scope/..", "@scope/.", "@../x", "@./x", "a".repeat(215), undefined, null, 5]) {
    assert.equal(validName(n), false, String(n));
  }
});

test("registryUrl encodes the one slash of a scoped name and refuses a second one", () => {
  assert.equal(registryUrl("parse5"), "https://registry.npmjs.org/parse5");
  assert.equal(registryUrl("@types/node"), "https://registry.npmjs.org/@types%2fnode");
  // The old code put "a/b/c" into the URL as "a%2fb/c". Since validName refuses a second slash, `replace` and
  // `replaceAll` now give the same result; validName is the defence this test holds.
  assert.throws(() => registryUrl("a/b/c"), /not a valid npm package name/);
  assert.throws(() => registryUrl("../../-/user"), /not a valid npm package name/);
});

test("every accepted name keeps both URLs on their host and path, with no dot segment", () => {
  const names = ["parse5", "@types/node", "@scope/_p", "@.s/.x", "@s/.x.", "a.b", "a..b", "@s/a..b", "~", "-"];
  for (const n of names) {
    for (const [url, prefix] of [[registryUrl(n), "/"], [downloadsUrl(n), "/downloads/point/last-week/"]]) {
      const u = new URL(url);
      assert.ok(["registry.npmjs.org", "api.npmjs.org"].includes(u.host), url);
      assert.equal(u.search + u.hash, "", url);
      assert.ok(u.pathname.startsWith(prefix), `${url} -> ${u.pathname}`);
      assert.equal(u.href, url, `the URL parser changed ${url}`);
    }
  }
  assert.throws(() => downloadsUrl("@scope/.."), /not a valid npm package name/);
});

test("parseArgs reads the age flag only when it is there", () => {
  // The old code read args[0] (the name) as the age when the flag was missing: a package named "5" got 5 days.
  assert.equal(parseArgs(["5", "1.0.0"]).minAgeDays, 60);
  assert.equal(parseArgs(["parse5", "7.1.2"]).minAgeDays, 60);
  assert.equal(parseArgs(["parse5", "7.1.2", "--min-age-days", "90"]).minAgeDays, 90);
  assert.equal(parseArgs(["parse5", "7.1.2", "--min-age-days"]).minAgeDays, 60);
  assert.equal(parseArgs(["parse5", "7.1.2", "--min-age-days", "-3"]).minAgeDays, 60);
  assert.equal(parseArgs(["--min-age-days", "7.1.2"]).minAgeDays, 60);
});
