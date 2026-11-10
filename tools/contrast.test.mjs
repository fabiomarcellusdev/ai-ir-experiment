// Tests for contrast.mjs. The oracle is published values: black on white is 21:1 by the WCAG formula's limits, and
// #767676 on white (4.54:1) is the widely cited lightest grey that passes 4.5:1, while #777777 (4.48:1) fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseColor, luminance, ratio, check, meets, LIMITS } from "./contrast.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "contrast.mjs");
const near = (a, b, d = 0.005) => assert.ok(Math.abs(a - b) < d, `${a} is not near ${b}`);

test("the limits of the scale: black on white is 21:1, a colour on itself is 1:1", () => {
  near(ratio(parseColor("#000"), parseColor("#fff")), 21);
  near(ratio(parseColor("#3a7bd5"), parseColor("#3a7bd5")), 1);
  assert.equal(luminance([0, 0, 0]), 0);
  assert.equal(luminance([255, 255, 255]), 1);
});

test("published greys on white: #767676 passes 4.5:1, #777777 does not", () => {
  near(ratio(parseColor("#767676"), parseColor("#ffffff")), 4.54, 0.01);
  near(ratio(parseColor("#777777"), parseColor("#ffffff")), 4.48, 0.01);
  assert.equal(check("#767676", "#fff").pass, true);
  assert.equal(check("#777777", "#fff").pass, false);
  assert.equal(check("#777777", "#fff", "large").pass, true);
  assert.equal(check("#777777", "#fff", "non-text").pass, true);
});

test("published colour values on white: red 4.0:1, green 5.14:1, blue 8.59:1", () => {
  // Each channel has its own weight (0.2126, 0.7152, 0.0722), so a swapped weight changes these.
  near(ratio(parseColor("#ff0000"), parseColor("#ffffff")), 4.0, 0.01);
  near(ratio(parseColor("#008000"), parseColor("#ffffff")), 5.14, 0.01);
  near(ratio(parseColor("#0000ff"), parseColor("#ffffff")), 8.59, 0.01);
});

test("the 3:1 limits hold at their edge: #949494 (3.03:1) passes and #959595 (2.995:1) fails", () => {
  assert.deepEqual(LIMITS, { text: 4.5, large: 3, "non-text": 3 });
  for (const kind of ["large", "non-text"]) {
    assert.equal(check("#949494", "#ffffff", kind).pass, true, kind);
    assert.equal(check("#959595", "#ffffff", kind).pass, false, kind);
    assert.equal(check("#949494", "#ffffff", kind).limit, 3, kind);
  }
  assert.equal(check("#949494", "#ffffff").pass, false); // 3.03:1 is not enough for text
});

test("a ratio equal to the limit meets it (WCAG: at least)", () => {
  assert.equal(meets(4.5, 4.5), true);
  assert.equal(meets(3, 3), true);
  assert.equal(meets(2.9999, 3), false);
});

test("the order of the two colours does not change the ratio", () => {
  assert.equal(ratio(parseColor("#123456"), parseColor("#fedcba")), ratio(parseColor("#fedcba"), parseColor("#123456")));
});

test("#rgb is the same as #rrggbb, and case and spaces do not matter", () => {
  assert.deepEqual(parseColor("#AbC"), [0xaa, 0xbb, 0xcc]);
  assert.deepEqual(parseColor("  #aabbcc "), [0xaa, 0xbb, 0xcc]);
});

test("a ratio just below the limit fails and never prints as the limit", () => {
  // #373737 on #9f9f9f is 4.4976:1. Rounded to two decimals it would be 4.50 and pass.
  near(ratio(parseColor("#373737"), parseColor("#9f9f9f")), 4.4976, 0.0005);
  const r = check("#373737", "#9f9f9f");
  assert.equal(r.pass, false);
  assert.match(r.text, /^4\.49:1 for text: FAIL/);
  assert.match(check("#777777", "#ffffff").text, /^4\.47:1 for text: FAIL/);
});

test("a dark channel uses the linear part of the formula: C / 12.92 at or below 0.04045", () => {
  // Computed by hand from the WCAG 2.2 definition: 10 / 255 = 0.0392 is below 0.04045, so L = 0.0392 / 12.92.
  near(luminance([10, 10, 10]), 10 / 255 / 12.92, 1e-9);
  // 11 / 255 = 0.0431 is above the threshold: ((0.0431 + 0.055) / 1.055) ^ 2.4.
  near(luminance([11, 11, 11]), ((11 / 255 + 0.055) / 1.055) ** 2.4, 1e-9);
  near(ratio(parseColor("#0a0a0a"), parseColor("#000000")), (10 / 255 / 12.92 + 0.05) / 0.05, 1e-9);
});

test("hostile and malformed input is refused with a message", () => {
  assert.deepEqual(parseColor("﻿#ffffff"), [255, 255, 255]); // trim() removes a BOM, as it removes spaces
  for (const bad of ["", "#", "#12", "#1234567", "red", "rgb(0,0,0)", "#gggggg", "#ff ff ff", null, undefined, "#".padEnd(100000, "f")]) {
    assert.throws(() => parseColor(bad), /not a colour/, String(bad).slice(0, 20));
  }
  assert.throws(() => parseColor("#ffff"), /transparency/);
  assert.throws(() => parseColor("#ffffff80"), /transparency/);
  assert.throws(() => check("#fff", "#000", "huge"), /not a kind/);
  assert.throws(() => check("#fff", "#000", "__proto__"), /not a kind/);
});

test("the command exits 0 on a pass, 1 on a fail, 2 on a usage error", () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const pass = run("#767676", "#ffffff");
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /4\.54:1 for text: PASS/);
  const fail = run("#777777", "#ffffff");
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /FAIL \(the limit is 4.5:1\)/);
  assert.equal(run("#777777", "#ffffff", "large").status, 0);
  assert.equal(run("#777777").status, 2);
  assert.equal(run("#fff", "#000", "text", "extra").status, 2);
  assert.match(run("blue", "#000").stderr, /not a colour/);
});
