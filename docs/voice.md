# Voice and terms

How the project's text sounds: the README, the docs, messages a program prints, tool descriptions, errors and commit
messages.

## Rules

1. Write 80% of the way to ASD-STE100 (the rules are in `AGENTS.md`, "Writing").
2. Say what happened and what to do next. An error names what failed and the next action.
3. Never claim more than was measured. A number names its conditions.
4. Descriptions that a model reads on every request are short, because they cost tokens each time.
5. No marketing words: "blazing", "revolutionary", "seamless", "game-changing".

## Terms

Use these words and only these. One word, one meaning. Add a banned synonym with one meaning to `tools/voice-lint.mjs`
so the machine checks it.

| Term | Meaning | Do not use |
|---|---|---|
| <term> | <its one meaning in this project> | <synonyms to avoid> |
