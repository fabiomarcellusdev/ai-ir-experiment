---
name: decision-record
description: Write or amend a decision record in docs/decisions/. Use for a significant decision - a design choice, a rule from the owner, a trade-off between hats - before the code that depends on it.
---

# Decision record

1. Take the next number: `docs/decisions/NNNN-short-name.md`. Use the template in `docs/decisions/README.md`:
   context with its evidence, the options with their cost, the decision, the rejected options and why, and what would
   reopen it.
2. Give each option two costs: to build, and to maintain (updates, debugging, hosting, teaching it to a new person).
   An option that is quick to build but costly to maintain shows both costs.
3. Name who decided and when ("owner, 2026-11-07"). A proposal is "Proposed" until the owner agrees.
4. Name the prior art the design builds on (`docs/prior-art.md`), and say what this design does better.
5. Write 80% of the way to ASD-STE100 (`AGENTS.md`), with the terms in `docs/voice.md`.
6. Add the record to the table in `docs/decisions/README.md`.
7. **Amend, never rewrite:** a later change is a dated note under "Amendments" at the end of the record.
