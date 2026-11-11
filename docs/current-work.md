# Current work

Keep this file short. When a task closes, replace its notes with one line and a link.

## Now

Work branch `p0/feat-hir-viability` (one branch for the milestone; decision 0004, amendment of 2026-11-10). The
milestone: a go or no-go answer from gate C0.3.

Waiting for the owner:
1. A yes on the corrected `html_find` amendment in `docs/contract.md`.
2. The order of the gates: run C0.3 first with a prototype, keep the agreed order, or stop.

## Next

1. Propose the design of the MCP server (`AGENTS.md`, "Structure"): its parser, its four tools, and the fixes for the
   reading view's safety findings (`docs/follow-ups.md` on `exp/html-ir-poc`). Wait for the owner's agreement.
2. Vet an HTML5 parser package for the server or for gate C0.1's oracle, then ask the owner.
3. Gates C0.1 and C0.2 (no cost), then C0.3 (free, needs an API key), then C0.4 (paid, after the owner's yes).

## Closed

- 2026-11-10: the prior art and a risk check for gate C0.3 (`docs/prior-art.md`,
  `docs/measurements/2026-11-10-c03-risk-check.md`).
- 2026-11-10: guards relaxed, the 60-day age kept (pull request #3, decision 0002, amendment of 2026-11-10).
- 2026-11-10: gates C0.1 to C0.4 agreed by the owner (pull request #2, `docs/contract.md`).
- 2026-11-10: POC of a compact HTML form and a reading view, on `exp/html-ir-poc` (draft pull request #1, never
  merged).
