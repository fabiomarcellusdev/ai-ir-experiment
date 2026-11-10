---
name: monthly-update-review
description: The monthly dependency review of decision 0001, and the same-day review when an advisory names a pinned version. Finds update candidates 60 days old or more, researches them, and reports to the owner. Updates nothing by itself.
---

# Monthly update review

1. **Scan:** `node tools/osv-check.mjs <each pnpm-lock.yaml>`, and the audit tool of each other ecosystem section in
   `AGENTS.md` on its lock file. A finding above low is urgent: report it today.
2. **Expired exceptions:** `node tools/check.mjs fast` fails when a `minimumReleaseAgeExclude` entry has passed its
   removal date. Remove the entry (with the owner's yes) and record it in decision 0001.
3. **Candidates:** list newer versions of each direct dependency and of pnpm (`npm view <pkg> time --json`, run
   outside a project folder; for another ecosystem, its registry). Keep only versions 60 days old or more. For a
   manager whose age setting is a fixed date, move the date forward at this review.
4. **Research each candidate** with the `vet-package` skill; the changelog between the pinned and
   the candidate version (the `researcher` agent may help); new or changed dependencies; new install scripts;
   provenance; a change of publisher.
5. **Report** to the owner, one row per candidate: what it fixes or adds, the risks, a recommendation. Record each
   candidate and its research date under "Update candidates" in `docs/third-party.md`.
6. **Wait for the owner's yes per package.** Then pin the exact version, install under the machine rules in `CLAUDE.local.md`, if any, run
   `node tools/check.mjs full`, re-run any measurement whose parser changed, and commit with the reason.

**Security exception:** a fix younger than 60 days for a vulnerability above low goes to the owner with the
advisory. A yes adds the package to `minimumReleaseAgeExclude` with a removal date in a comment, and a dated note in
decision 0001.
