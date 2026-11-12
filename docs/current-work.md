# Current work

Keep this file short. When a task closes, replace its notes with one line and a link.

## Now

Work branch `p0/feat-hir-viability`. The whole HTML reading-view experiment stays on this branch until the owner says
otherwise (decision 0005).

Gate C0.5 PASSED on 2026-11-11: median work ratio 0.374, 95% interval over files 0.258 to 0.472
(`docs/measurements/2026-11-11-c05-result.md`). By the rescope's order, the server comes next, then C0.1 and C0.2 on
it, then the paid C0.6.

The owner agreed to the server's design on 2026-11-11 (decision 0006, with 3 contract changes). The server is built
in `server/` (2026-11-11), with a code review and a security review.

The owner's choice (2026-11-11): no check of a shorter MCP tool text before C0.6. After C0.6, and only if it is
needed, the lead measures shorter tool text with the free `count_tokens`.

Gates C0.1 and C0.2 PASSED on 2026-11-12 (`docs/measurements/2026-11-12-c01-c02-result.md`): C0.1 0 failures in
1,154 edits; C0.2 0 failures in 755 calls, slowest 837 ms. Their development runs found one server defect, fixed
before the gate runs (decision 0006). Next: the paid C0.6. First fix its follow-ups (the runner refuses a second run
and saves the raw noise counts), then announce its cost and wait for the owner's yes.

The owner's rule (2026-11-11): no push and no pull request until every run is complete, the paid C0.6 included, and
the viability verdict is recorded.

## Closed

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
