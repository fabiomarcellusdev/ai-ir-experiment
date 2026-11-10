# Roadmap

<One paragraph: the product, and the order in which it is built. Say that the estimates are estimates.>

Decision points are phases where the project continues only if the gate holds. The gates' exact numbers are in
`docs/contract.md`.

| Phase | Name | Weeks (estimate) | Decision point |
|---|---|---|---|
| 0 | Measure before building | <n> | Yes |
| <n> | Visual direction (a project with a user interface only) | <n> | Yes |
| 1 | Skeleton and core | <n> | |
| <n> | <name> | <n> | <Yes, if the project's go or no-go is here> |

---

## Phase 0. Measure before building

Check that the idea holds on real data before writing the product.

**Work**
- <The measurement, on real inputs pinned by version.>

**Deliverable:** a results file in `docs/measurements/` and a short report.

**Gate (C0):** <the number that must hold, and on what>. If not, stop or rescope.

## Phase <n>. Visual direction (a project with a user interface only)

Settle how the interface looks before the first screen is built. Delete this phase if the project has no user
interface.

**Work**
- Two to four directions drawn with the real content, then the owner's rounds of changes (`AGENTS.md`, "Structure";
  in Claude Code, the `visual-direction` skill).

**Deliverable:** a decision record with the layout of the key screens and the design tokens.

**Gate:** the owner says the direction is final. Contrast passes WCAG AA for every text pair, checked by a script.

## Phase 1. Skeleton and core

**Work**
- The package: build, unit tests, lint, a formatter, the module-boundary check, CI on three systems, the licence.
- <The core parts every later phase depends on, specified first in `docs/spec/`.>

**Gate (C1):** <the property that must hold, tested by a property test>.

## Phase <n>. <Name>

**Work**
- <...>

**Gate (C<n>):** <...>
