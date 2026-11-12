# Current work

Keep this file short. When a task closes, replace its notes with one line and a link.

## Now

Work branch `p0/feat-hir-viability`. The whole HTML reading-view experiment stays on this branch until the owner says
otherwise (decision 0005).

**The viability verdict (2026-11-12): FAIL.** Gate C0.6 failed: real agents with the reading-view MCP server used a
median of 1.40 times the baseline's tokens (pass at 0.70 or less), at equal success
(`docs/measurements/2026-11-12-c06-result.md`). An exploratory check after the gate found that the file names
favoured the MCP arm: without the runs that misread a file name, the ratio is 1.96.

**Now (owner, 2026-11-12): the second rescope** (decision 0007). The owner agreed to gates C0.7 (remove or replace a
large element), C0.8 (a target named by its position) and C0.9 (a quote not in the source as written)
(`docs/contract.md`, "Phase 0, second rescope"). Next: the draw and task scripts and the runner changes, with tests
and a review; then the draws; then a paid preview for each gate, with the owner's yes.

The owner's rule (2026-11-11, extended 2026-11-12): no push and no pull request until the owner asks for one.

## Closed

- 2026-11-12: gate C0.6, FAIL (median ratio 1.40); the viability verdict. `docs/measurements/2026-11-12-c06-result.md`.
- 2026-11-12: C0.6 preview on C0.3's tasks (ratio 1.45; decides nothing). `docs/measurements/2026-11-12-c06-preview.md`.
- 2026-11-12: gates C0.1 and C0.2, PASS. `docs/measurements/2026-11-12-c01-c02-result.md`.
- 2026-11-11: gate C0.5, PASS (median 0.374). `docs/measurements/2026-11-11-c05-result.md`.
- 2026-11-11: rescope gates C0.5 and C0.6 agreed, with review fixes (decision 0005, `docs/contract.md`).
- 2026-11-11: gate C0.3, FAIL (median 0.739; preview with proxies 0.65). `docs/measurements/2026-11-11-c03-result.md`.
- 2026-11-10: the prior art and a risk check for gate C0.3 (`docs/prior-art.md`,
  `docs/measurements/2026-11-10-c03-risk-check.md`).
- 2026-11-10: guards relaxed, the 60-day age kept (pull request #3, decision 0002, amendment of 2026-11-10).
- 2026-11-10: gates C0.1 to C0.4 agreed by the owner (pull request #2, `docs/contract.md`).
- 2026-11-10: POC of a compact HTML form and a reading view, on `exp/html-ir-poc` (draft pull request #1, never
  merged).
