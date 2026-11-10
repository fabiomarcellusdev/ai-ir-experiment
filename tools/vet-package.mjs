// vet-package.mjs: the machine part of decision 0001's vetting checklist, for one package version.
//
//   node tools/vet-package.mjs <name> <version> [--min-age-days 60]
//
// It reads the npm registry's metadata and osv.dev, and prints a report. It installs nothing and runs no package
// code. Registry text is untrusted: the report prints structured fields only (never a README), cuts long strings,
// and removes control characters. Exit 0 when every rule passes, 1 when one fails, 2 when it cannot run.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const LICENCES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"]);
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
const DAY = 86400000;

/**
 * npm's package name rule (validate-npm-package-name), cut to URL-safe characters: an optional `@scope/`, then one
 * name, at most 214 characters in all. Capital letters are allowed, because some old packages have them. A scoped
 * name may start its scope or its name with `.` or `_`; an unscoped name may not. Old names with `! ' ( ) *` are
 * refused. A scope or name of only `.` or `..` is refused: it would be a dot segment in the downloads URL.
 * A name that fails is never put into a URL.
 */
const NPM_NAME = /^(?:@(?!\.{1,2}\/)[A-Za-z0-9._~-]+\/(?!\.{1,2}$)[A-Za-z0-9._~-]+|[A-Za-z0-9~-][A-Za-z0-9._~-]*)$/;

export function validName(name) {
  return typeof name === "string" && name.length <= 214 && NPM_NAME.test(name);
}

/** The registry URL of a valid name. A scoped name keeps its one slash encoded as `%2f`, as the registry expects. */
export function registryUrl(name) {
  if (!validName(name)) throw new Error(`not a valid npm package name: ${clean(name)}`);
  return `https://registry.npmjs.org/${name.replaceAll("/", "%2f")}`;
}

/** The weekly downloads URL of a valid name. The npm downloads API takes a scoped name with its slash as it is. */
export function downloadsUrl(name) {
  if (!validName(name)) throw new Error(`not a valid npm package name: ${clean(name)}`);
  return `https://api.npmjs.org/downloads/point/last-week/${name}`;
}

/**
 * Reads `<name> <version> [--min-age-days N]`. The age is 60 days unless the flag is present with a positive number.
 * (An earlier version read the name as the age when the flag was missing, so a package named "5" got 5 days.)
 */
export function parseArgs(args) {
  const [name, version] = args;
  const i = args.indexOf("--min-age-days");
  const n = i >= 2 ? Number(args[i + 1]) : NaN;
  return { name, version, minAgeDays: Number.isFinite(n) && n > 0 ? n : 60 };
}

/** Untrusted text made safe to print: control characters removed, length cut. */
export function clean(s, max = 120) {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Evaluates one version against the rules. `meta` is the registry document of the package, `vulns` the OSV records
 * for that version. Returns { rules: [{ rule, ok, detail }], info: [[label, value]] }.
 */
export function evaluate(meta, version, vulns, { now = new Date(), minAgeDays = 60 } = {}) {
  const v = meta.versions?.[version];
  if (!v) return { rules: [{ rule: "the version exists", ok: false, detail: `${clean(meta.name)}@${clean(version)} is not in the registry` }], info: [] };
  const rules = [];
  const published = meta.time?.[version] ? new Date(meta.time[version]) : null;
  const ageDays = published ? Math.floor((now - published) / DAY) : -1;
  rules.push({ rule: `published ${minAgeDays} days ago or more`, ok: ageDays >= minAgeDays, detail: published ? `${published.toISOString().slice(0, 10)} (${ageDays} days)` : "no publish date" });

  const licence = typeof v.license === "string" ? v.license : v.license?.type;
  rules.push({ rule: "licence on the allow list", ok: LICENCES.has(licence), detail: clean(licence ?? "none") });

  const scripts = INSTALL_SCRIPTS.filter((s) => v.scripts?.[s]);
  rules.push({ rule: "no install scripts", ok: scripts.length === 0, detail: scripts.length ? scripts.map((s) => `${s}: ${clean(v.scripts[s], 60)}`).join("; ") : "none" });

  const sev = (x) => (x.database_specific?.severity ?? "UNRATED").toUpperCase();
  const bad = vulns.filter((x) => sev(x) !== "LOW");
  rules.push({ rule: "no known vulnerability above low", ok: bad.length === 0, detail: vulns.length ? vulns.map((x) => `${clean(x.id, 40)} ${sev(x)}`).join(", ") : "none known" });

  rules.push({ rule: "not deprecated", ok: !v.deprecated, detail: v.deprecated ? clean(v.deprecated) : "no" });

  // Information for the owner; not pass or fail.
  const versions = Object.keys(meta.versions).filter((k) => meta.time?.[k]).sort((a, b) => new Date(meta.time[a]) - new Date(meta.time[b]));
  const prev = versions[versions.indexOf(version) - 1];
  const publisher = v._npmUser?.name;
  const prevPublisher = prev ? meta.versions[prev]?._npmUser?.name : undefined;
  const info = [
    ["provenance (npm attestation)", v.dist?.attestations ? "yes" : "no"],
    ["registry signature", v.dist?.signatures?.length ? "yes" : "no"],
    ["publisher", clean(publisher ?? "unknown")],
    ["publisher of the previous version", prev ? `${clean(prevPublisher ?? "unknown")} (${clean(prev, 30)})${prevPublisher && publisher && prevPublisher !== publisher ? "  <- CHANGED" : ""}` : "none"],
    ["maintainers", clean((meta.maintainers ?? []).map((m) => m.name).join(", "), 200)],
    ["dependencies", clean(Object.entries(v.dependencies ?? {}).map(([n, r]) => `${n} ${r}`).join(", ") || "none", 400)],
    ["integrity", clean(v.dist?.integrity ?? "none", 100)],
    ["repository", clean(typeof v.repository === "string" ? v.repository : v.repository?.url ?? "none")],
  ];
  return { rules, info };
}

async function main() {
  const { name, version, minAgeDays } = parseArgs(process.argv.slice(2));
  if (!validName(name) || !version || !/^\d+\.\d+\.\d+/.test(version)) {
    console.error("Usage: node tools/vet-package.mjs <name> <exact version> [--min-age-days 60]");
    console.error("The name must be a valid npm package name, for example parse5 or @types/node.");
    process.exit(2);
  }
  const res = await fetch(registryUrl(name));
  if (!res.ok) throw new Error(`the registry answered ${res.status} for ${name}`);
  const meta = await res.json();
  const osv = await fetch("https://api.osv.dev/v1/query", { method: "POST", body: JSON.stringify({ package: { name, ecosystem: "npm" }, version }) });
  const vulns = (await osv.json()).vulns ?? [];
  const dl = await fetch(downloadsUrl(name)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

  const { rules, info } = evaluate(meta, version, vulns, { minAgeDays });
  console.log(`Vetting ${clean(name)}@${clean(version)} (${new Date().toISOString().slice(0, 10)}; registry and osv.dev data is untrusted text)\n`);
  for (const r of rules) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.rule}: ${r.detail}`);
  console.log("");
  for (const [k, v] of [...info, ["weekly downloads", String(dl.downloads ?? "unknown")]]) console.log(`info  ${k}: ${v}`);
  console.log("\nStill to do by hand (decision 0001): why it is needed, and the age, licence and vulnerabilities of every package it brings in.");
  process.exit(rules.every((r) => r.ok) ? 0 : 1);
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "vet-package.mjs";
if (isMain) {
  main().catch((e) => {
    console.error(`vet-package could not run: ${clean(e.message, 300)}`);
    process.exit(2);
  });
}
