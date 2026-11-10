// contrast.mjs: the WCAG 2.2 contrast ratio of two colours, and whether it meets a limit.
//
//   node tools/contrast.mjs <foreground> <background> [text | large | non-text]
//
// Colours are hex: #rgb or #rrggbb. A colour with transparency is refused: composite it on its background first.
// Limits (WCAG 2.2, level AA): text 4.5:1 (SC 1.4.3); large text 3:1 (SC 1.4.3: 24 px, or about 18.5 px bold); user
// interface components and graphical objects 3:1 (SC 1.4.11). The ratio is not rounded before the comparison:
// 4.499:1 fails 4.5:1.
// Exit 0 when the ratio meets the limit, 1 when it does not, 2 on a usage error. Uses Node built-ins only.

import path from "node:path";

export const LIMITS = { text: 4.5, large: 3, "non-text": 3 };

/** The [r, g, b] channels (0 to 255) of "#rgb" or "#rrggbb". Throws on anything else. */
export function parseColor(input) {
  const s = String(input ?? "").trim();
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(s)) {
    throw new Error(`"${s}" has transparency; composite it on its background first, then give the solid colour`);
  }
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) throw new Error(`"${s}" is not a colour in #rgb or #rrggbb form`);
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The relative luminance of an sRGB colour (WCAG 2.2 glossary). The threshold is the sRGB value 0.04045; older WCAG
 * text says 0.03928. No 8-bit channel value lies between the two, so the results are the same.
 */
export function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast ratio (L1 + 0.05) / (L2 + 0.05), with L1 the lighter colour: 1 to 21. */
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG asks for a ratio of "at least" the limit, so a ratio equal to the limit meets it. */
export const meets = (r, limit) => r >= limit;

/** { ratio, limit, pass, text } for two colour strings and a kind of content. Throws on bad input. */
export function check(fg, bg, kind = "text") {
  if (!Object.hasOwn(LIMITS, kind)) throw new Error(`"${kind}" is not a kind; use text, large or non-text`);
  const r = ratio(parseColor(fg), parseColor(bg));
  const limit = LIMITS[kind];
  const pass = meets(r, limit);
  // Show two decimals, rounded down, so that a failing ratio never prints as the limit (4.499 prints 4.49).
  const shown = (Math.floor(r * 100) / 100).toFixed(2);
  return { ratio: r, limit, pass, text: `${shown}:1 for ${kind}: ${pass ? "PASS" : "FAIL"} (the limit is ${limit}:1)` };
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "contrast.mjs";
if (isMain) {
  const [fg, bg, kind = "text", ...extra] = process.argv.slice(2);
  let code;
  try {
    if (!fg || !bg || extra.length) throw new Error("usage: node tools/contrast.mjs <foreground> <background> [text | large | non-text]");
    const r = check(fg, bg, kind);
    console.log(r.text);
    code = r.pass ? 0 : 1;
  } catch (e) {
    console.error(`contrast: ${e.message}`);
    code = 2;
  }
  process.exit(code);
}
