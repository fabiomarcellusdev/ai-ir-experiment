// Tests for osv-check.mjs (offline). Run from the repository root: node --test "tools/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedPackages, severityOf } from "./osv-check.mjs";

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      postcss:
        specifier: 8.5.29
        version: 8.5.29

packages:

  '@pnpm/exe.win32-x64@12.10.1':
    resolution: {integrity: sha512-x}

  nanoid@3.3.20:
    resolution: {integrity: sha512-y}

  postcss@8.5.29:
    resolution: {integrity: sha512-z}

snapshots:

  postcss@8.5.29:
    dependencies:
      nanoid: 3.3.20
`;

test("reads scoped and plain packages from the packages: section only", () => {
  assert.deepEqual(
    lockedPackages(LOCK).map((p) => `${p.name}@${p.version}`),
    ["@pnpm/exe.win32-x64@12.10.1", "nanoid@3.3.20", "postcss@8.5.29"],
  );
});

test("reads CRLF lockfiles", () => {
  assert.equal(lockedPackages(LOCK.replace(/\n/g, "\r\n")).length, 3);
});

test("a lockfile with no packages gives an empty list (the CLI then exits 2)", () => {
  assert.deepEqual(lockedPackages("lockfileVersion: '9.0'\n"), []);
});

test("severity comes from database_specific, and a missing one is UNRATED (counts as a failure)", () => {
  assert.equal(severityOf({ database_specific: { severity: "LOW" } }), "LOW");
  assert.equal(severityOf({ database_specific: { severity: "high" } }), "HIGH");
  assert.equal(severityOf({ affected: [{ database_specific: { severity: "MODERATE" } }] }), "MODERATE");
  assert.equal(severityOf({}), "UNRATED");
});
