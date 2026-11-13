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
(`docs/contract.md`, "Phase 0, second rescope"). The scripts are built and reviewed. The C0.7 and C0.9 previews
ran with the current server: 0.513 and 1.194 (`docs/measurements/2026-11-12-c07-c09-previews.md`).

**Done (decision 0008):** the v2 tools (`--tools v2`); the gate text for them (agreed); C0.1 v2 PASS
(`docs/measurements/2026-11-12-c01-v2-result.md`); C0.2 v2 PASS on its second run, after a recorded FAIL
(`docs/measurements/2026-11-12-c02-v2-result.md`).

**Done:** the v2 task rules, C0.10's task script and the v2 run plan; the v2 previews (C0.7 0.380, C0.9 0.793, C0.10
1.209; `docs/measurements/2026-11-12-c07-c10-v2-previews.md`). Rule C.6.3 does not reopen decision 0008.

**Done: the v2 gates (2026-11-12), each with the owner's yes for 240 runs.**
- C0.7 v2 (H1, large elements): **PASS**, median ratio 0.403 (`docs/measurements/2026-11-12-c07-v2-gate.md`).
- C0.9 v2 (H4, a quote not in the source as written): **PASS** by the rule, median 0.690; the margin is inside the
  noise (`docs/measurements/2026-11-12-c09-v2-gate.md`).
- C0.10 v2 (control, C0.6's task kind): **FAIL**, median 1.207 (`docs/measurements/2026-11-12-c10-v2-gate.md`).
- C0.8 v2 (H2, a target named by its position): **PASS**, median 0.517, after the runner fixes and its own freeze
  (`docs/measurements/2026-11-12-c08-v2-gate.md`).
- In all, $16.13. C0.9 and C0.10 each stopped once and went on at their start commit, with the owner's choices.
- Exploratory: the file's size does not predict the ratio; a large change does
  (`docs/measurements/2026-11-12-size-vs-ratio.md`). Research on deferred tool loading: tool search is on by default
  in Claude Code, and the gates turned it off.

**Now:** the server has decision 0010's shorter tool text (1,161 tokens, from the gates' 1,337) and no size field:
the owner removed it on 2026-11-13 (decision 0009, withdrawn). C0.1 v2 and C0.2 v2 passed again on this server
(`docs/measurements/2026-11-13-c01-c02-v2-rerun-2.md`). Next, with the owner's yes (2026-11-13): 3 arm-M checks (the current server, tool search on, decision 0011's
direct-locator sentence; `docs/measurements/2026-11-13-check-ts-loc-run-plan.md`, about $4.90), then a mixed gate on
small and large edits, then the publish.

**Done after the gates:** the size field built, checked and removed (decision 0009); the shorter tool text (decision
0010); C0.1 v2 and C0.2 v2 passed with both (`docs/measurements/2026-11-13-c01-c02-v2-rerun.md`); the paid arm-M check
($1.50): the text saves 128 tokens a request with no harm, and the size note never showed
(`docs/measurements/2026-11-13-check-m-v2-result.md`).

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
