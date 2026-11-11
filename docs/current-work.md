# Current work

Keep this file short. When a task closes, replace its notes with one line and a link.

## Now

Work branch `p0/feat-hir-viability` (one branch for the milestone; decision 0004, amendment of 2026-11-10). The
milestone: a go or no-go answer from gate C0.3.

Gate C0.3 FAILED on 2026-11-11: median ratio 0.739 against 0.50 (`docs/measurements/2026-11-11-c03-result.md`).
The owner recorded the no-go and chose to rescope on this branch (decision 0005). The whole experiment stays on this
branch until the owner says otherwise.

Waiting for the owner:
1. The direction of the rescope, then the new gate's numbers, before any run.
2. A yes to publish the branch and its pull request, at a milestone.

## Closed

- 2026-11-11: gate C0.3, FAIL (median 0.739; preview with proxies 0.65). `docs/measurements/2026-11-11-c03-result.md`.

- 2026-11-10: the prior art and a risk check for gate C0.3 (`docs/prior-art.md`,
  `docs/measurements/2026-11-10-c03-risk-check.md`).
- 2026-11-10: guards relaxed, the 60-day age kept (pull request #3, decision 0002, amendment of 2026-11-10).
- 2026-11-10: gates C0.1 to C0.4 agreed by the owner (pull request #2, `docs/contract.md`).
- 2026-11-10: POC of a compact HTML form and a reading view, on `exp/html-ir-poc` (draft pull request #1, never
  merged).
