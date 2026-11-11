# Third-party register

Every dependency, tool, font and outside data source: its version, licence, publish date, known vulnerabilities, and
whether it ships. **This is not a legal review.**

The rules for adding and updating a package are in decision 0001: exact versions, 60 days old or more, no known
vulnerability above low, and the owner's yes for each install. "Known vulnerabilities" comes from
`node tools/osv-check.mjs` (osv.dev), with its date.

## Dependencies

| Component | Version | Published | Licence | Ships | Notes |
|---|---|---|---|---|---|
| parse5 | 8.0.1 | 2026-04-19 | MIT | No | The HTML5 parser for the gate C0.3 prototype and the C0.1 oracle: source positions, spec-conformant tree. Vetted 2026-11-11 with `tools/vet-package.mjs`: all rules pass; no provenance; registry signature present; same publisher as 8.0.0. |
| entities | 8.1.0 | 2026-09-07 | BSD-2-Clause | No | Brought in by parse5 (`^8.0.0`). Vetted 2026-11-11: all rules pass; no dependencies. |
| html5lib (Python) | 1.1 | 2020-06-22 | MIT | No | Installed 2026-11-11 in the git-ignored `.venv-oracle/` with the owner's yes (hashes checked, wheels only): the oracle of gate C0.1 (decision 0006). Pure-Python wheel `html5lib-1.1-py2.py3-none-any.whl`, sha256 `0d78f8fde1c230e99fe37986a60526d7049ed4bf8a9fadbad5f00e22e58e041d`. OSV (2026-11-11): its 4 records are fixed before 0.999999999; none affect 1.1. Dormant since 2020. Its `setup.py` fails on Python 3.14 (not verified); the wheel has no setup step. Python 3.12 and later need a recent six (not verified). Vetted by the `researcher` agent from PyPI and OSV, 2026-11-11. Snyk is reported to flag 1.1 with one medium XSS issue in the serializer and the sanitizer (reported by the owner, 2026-11-11; not verified by the lead; OSV has no record for 1.1). The oracle uses the parser only: a check fails when the C0.1 script imports the serializer, the sanitizer or the filters (owner, 2026-11-11). Unmaintained: a new issue gets no fix. |
| six (Python) | 1.17.0 | 2024-12-04 | MIT | No | Installed 2026-11-11 in the git-ignored `.venv-oracle/` with the owner's yes (hashes checked, wheels only): brought in by html5lib (`six>=1.9`). Wheel `six-1.17.0-py2.py3-none-any.whl`, sha256 `4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274`. OSV: none found (2026-11-11). |
| webencodings (Python) | 0.5.1 | 2017-04-05 | BSD | No | Installed 2026-11-11 in the git-ignored `.venv-oracle/` with the owner's yes (hashes checked, wheels only): brought in by html5lib. Wheel `webencodings-0.5.1-py2.py3-none-any.whl`, sha256 `a0af1213f3c2226497a97e2b3aa01a7e4bee4f403f95be16fc9acd2947514a78`. OSV: none found (2026-11-11). Version 0.6.1 (2026-08-15) passes the 60-day rule, but it came after 9 years with no release, and its licence field is empty; 0.5.1 is the lead's choice until that release is checked. |

## Tools

| Component | Version | Published | Licence | Notes |
|---|---|---|---|---|
| pnpm | 12.3.4 | 2026-09-04 | MIT | The only package manager (decision 0001). Pinned by SHA-512 in `package.json`. Re-vet when you adopt the template. |

## Claude Code plugins

| Plugin | Version | Licence | Notes |
|---|---|---|---|
| frontend-design@claude-plugins-official | 1.1.1 | Apache-2.0 | Anthropic's design skill for user interfaces. One skill; no hooks, no MCP server, no scripts. Enabled in `.claude/settings.json`; about 80 tokens a session. Read its files again after an update. |

## Adapted text (`.claude/skills/`, not part of the product)

| Component | Version | Licence | Notes |
|---|---|---|---|
| mattpocock/skills: `grilling`, `diagnosing-bugs`, `tdd` (with `tests.md`), `wait-what` | Commit `49dd158` (plugin 1.3.1) | MIT | Adapted to the template's rules, not installed as a plugin (decision 0002, amendment "mattpocock-skills"). The licence text is in `.claude/skills/LICENSE.mattpocock-skills.txt`; keep it with the skills. |

## CI

| Component | Version | Published | Licence | Notes |
|---|---|---|---|---|
| actions/checkout | v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`) | 2026-07-20 | MIT | Pinned by commit hash. Re-vet when you adopt the template. |
| actions/setup-node | v7.0.0 (`820762786026740c76f36085b0efc47a31fe5020`) | 2026-07-14 | MIT | Pinned by commit hash. Re-vet when you adopt the template. |
| Node.js | 24.22.1 | 2026-10-20 | MIT | A security release. Re-check for a newer security release when you adopt the template. |

## Update candidates

Each row: the package, the candidate version and its publish date, the research date, the findings, and the owner's
answer.
