// osv-check.mjs: checks every package in a pnpm lockfile against the OSV vulnerability database (osv.dev).
//
//   node tools/osv-check.mjs <path/to/pnpm-lock.yaml>
//
// Exit 0: no known vulnerability above low. Exit 1: at least one moderate, high, critical or unrated vulnerability.
// Exit 2: the check could not run (no lockfile, no network). An unrated advisory counts as a failure, because no one
// has shown that it is low. Decision record: docs/decisions/0001-supply-chain.md.
//
// Uses Node built-ins only (fetch is built into Node 18 and later). It sends package names and versions to osv.dev,
// and nothing else.

import fs from "node:fs";

/** The "name@version" keys of the lockfile's packages: section. */
export function lockedPackages(lockText) {
  const out = new Map();
  let inPackages = false;
  for (const line of lockText.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = line.trim() === "packages:";
    if (!inPackages) continue;
    const m = line.match(/^ {2}'?((?:@[^@/'\s]+\/)?[^@'\s]+)@([^'():\s]+)'?:/);
    if (m) out.set(`${m[1]}@${m[2]}`, { name: m[1], version: m[2] });
  }
  return [...out.values()];
}

const RANK = { LOW: 1, MODERATE: 2, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** The severity word of one OSV record; UNRATED when the record gives none. */
export function severityOf(vuln) {
  const s = (vuln.database_specific?.severity ?? vuln.affected?.[0]?.database_specific?.severity ?? "").toUpperCase();
  return RANK[s] ? s : "UNRATED";
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error("Give the path of a pnpm-lock.yaml file: node tools/osv-check.mjs <pnpm-lock.yaml>");
    process.exit(2);
  }
  const pkgs = lockedPackages(fs.readFileSync(file, "utf8"));
  if (!pkgs.length) {
    console.error(`No packages found in ${file}. Check that it is a pnpm lockfile.`);
    process.exit(2);
  }
  const body = { queries: pkgs.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })) };
  const res = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`osv.dev answered ${res.status}`);
  const { results } = await res.json();

  let worst = 0;
  for (const [i, p] of pkgs.entries()) {
    const ids = (results[i]?.vulns ?? []).map((v) => v.id);
    if (!ids.length) {
      console.log(`ok        ${p.name}@${p.version}`);
      continue;
    }
    for (const id of ids) {
      const v = await (await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)).json();
      const sev = severityOf(v);
      worst = Math.max(worst, RANK[sev] ?? 5);
      console.log(`${sev.padEnd(9)} ${p.name}@${p.version}  ${id}  ${v.summary ?? ""}`);
    }
  }
  console.log(`\n${pkgs.length} packages checked against osv.dev on ${new Date().toISOString().slice(0, 10)}.`);
  if (worst > RANK.LOW) {
    console.log("FAIL: a known vulnerability above low. Do not install; report it to the owner (decision 0001).");
    process.exit(1);
  }
  console.log(worst === RANK.LOW ? "PASS with LOW findings: each needs the owner's yes and a note in docs/third-party.md." : "PASS: no known vulnerabilities.");
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/osv-check.mjs")) {
  main().catch((e) => {
    console.error(`osv-check could not run: ${e.message}`);
    process.exit(2);
  });
}
