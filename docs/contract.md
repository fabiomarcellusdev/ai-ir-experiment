# Contract: the pass/fail gates

Each gate is a number fixed before the run it judges. A gate is moved only by a dated amendment with its reason,
never after the results are in. A missed gate is recorded as missed, with its numbers.

| Id | Phase | Gate | Judged on | Status |
|---|---|---|---|---|
| C0 | 0 | <what must hold, with its number> | <the inputs, pinned by version; the tool that measures> | Tentative |
| C1 | 1 | <...> | <...> | Tentative |

## Rules for every gate

1. A number names how it was measured and on what.
2. A model result names the model and its version, the task set, the number of tasks and runs, and the spread.
3. A timing names the machine and the input size, and gives p50 and p99.
4. A difference smaller than the noise between repeated runs is reported as no difference.
5. A result from a small sample never reads as if it held in general.
6. The analysis of a gate is written here before its run: how the number is computed, the number of runs, and how the
   noise is judged.
