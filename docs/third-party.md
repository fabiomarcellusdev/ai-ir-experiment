# Third-party register

Every dependency, tool, font and outside data source: its version, licence, publish date, known vulnerabilities, and
whether it ships. **This is not a legal review.**

The rules for adding and updating a package are in decision 0001: exact versions, 60 days old or more, no known
vulnerability above low, and the owner's yes for each install. "Known vulnerabilities" comes from
`node tools/osv-check.mjs` (osv.dev), with its date.

## Dependencies

| Component | Version | Published | Licence | Ships | Notes |
|---|---|---|---|---|---|
| <name> | <exact> | <date> | <SPDX id> | <Yes or No> | <why it is needed; its vetting report> |

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
