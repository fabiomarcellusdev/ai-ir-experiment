# Measurements

One file per run: `YYYY-MM-DD-<name>.md`, with its raw results beside it (`.json` or `.csv`).

Each file has:

1. **The question** and the gate it serves (`docs/contract.md`).
2. **The conditions:** the date, the commit, the script, the inputs and their versions, the machine for a timed run,
   and for model runs the model and its version, the prompts, the number of runs and the spread.
3. **The numbers,** with the raw file beside them.
4. **What the numbers do not show.**

A result that is only partial says so in its first line (for example: "token counts only, accuracy unmeasured").
