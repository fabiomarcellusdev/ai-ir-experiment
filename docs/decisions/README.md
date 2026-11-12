# Decision records

One file per significant decision: `NNNN-short-name.md`. Amend a record with a dated note at its end. Never rewrite
what was decided. Records 0001 to 0004 come with the template; a project adopts them, amends them, or replaces them
with a record that says why. The project's own records start at 0005.

| Id | Decision | Status |
|---|---|---|
| [0001](0001-supply-chain.md) | pnpm only, pinned and vetted packages, and every install needs the owner's approval (amended 2026-11-09: one package manager for each ecosystem) | Adopted from the template |
| [0002](0002-agents-and-security.md) | The agent setup, and the defences against prompt injection | Adopted from the template |
| [0003](0003-branch-strategy.md) | A protected main, short task branches, tags for phases | Adopted from the template |
| [0004](0004-task-pipeline-and-owner-approval.md) | The task pipeline, the owner's approval, local checks first, and quiet hours | Adopted from the template |
| [0005](0005-c03-no-go-and-rescope.md) | Gate C0.3 failed (median 0.739): no-go for the MCP as specified; rescope on the same branch | Accepted (owner, 2026-11-11) |
| [0006](0006-html-mcp-server-design.md) | The HTML MCP server's design: a small stdio server, parse5, a worker with a hard time limit, an edit checked by a second parse, html5lib as the C0.1 oracle | Accepted (owner, 2026-11-11) |
| [0007](0007-task-kinds-where-the-view-should-win.md) | After C0.6: test 3 task kinds where the reading view should do better (gates C0.7, C0.8, C0.9), with the server unchanged | Accepted (owner, 2026-11-12) |
| [0008](0008-consolidated-tools.md) | Fewer turns: consolidated tools (`html_find`, `html_change` with a locator, `html_outline`), tested by gates C0.7 to C0.10 | Accepted (owner, 2026-11-12) |
| [0009](0009-size-field-in-html-find.md) | A size field for each large element that `html_find` shows (option B, 1 KB) | Proposed (lead, 2026-11-12) |

## Template

```
# NNNN. Title

**Status:** Proposed | Accepted (who, date) | Superseded by NNNN

## Context
What forces the decision. The evidence, with its conditions.

## Options
Each option, with its cost to build, its cost to maintain, and what it gives.

## Decision
The option chosen, and why.

## Rejected
Each rejected option, and why.

## What would reopen this
The evidence that would change the decision.

## Amendments
Dated notes. Never rewrite the decision above.
```
