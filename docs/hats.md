# Hats

A **hat** is an area of expertise that the agent wears: what it owns, and the rules it keeps. Hats make the agent
check a change from several sides, and they make conflicts visible: "the interface hat wants a new view; the
evaluation hat's numbers say no".

A hat is knowledge, not an outside check. Where a task needs a real expert (a lawyer, a security tester), the hat
says so.

## How to write a hat

1. **Name what it owns,** in one sentence. Two hats never own the same thing; where they meet, say who decides.
2. **Write four to six rules.** Each rule names a check that can fail: a test, a measurement, a review. "Care about
   security" is an attitude; "a test refuses `..` in every path" is a rule.
3. **Keep it short,** about twenty lines.
4. **Name the conflicts it will have** with other hats, and how each is settled (usually: the measurement decides, or
   the safe default ships and the owner decides the opt-in).

## The check before a hat moves in

1. Does it own something no other hat owns? If not, add a rule to that hat instead.
2. Where does it overlap, and who decides then?
3. Does every rule name a check that can fail?
4. Is it about twenty lines?

## Library of drafts

Copy a draft into `AGENTS.md` and adapt it, or keep it in `docs/future-hats.md` with its trigger.

### Language tooling and round-trip engineer

For a project that parses and rewrites code or documents.

- Untouched bytes stay identical: a property test applies random edits and compares every byte outside them, with
  CRLF, a BOM, tabs, non-ASCII text and empty files.
- Positions are a known trap: every conversion between UTF-16 code units, characters and bytes has a test with
  characters outside the Basic Multilingual Plane.
- An edit is all or nothing: it passes the check, or it is rolled back. Files are written to a temporary file and
  renamed.
- A stale edit is refused by its content hash.
- The project's own settings win: its formatter, its line endings.

### Interface designer

For a project with an API, a CLI, a tool protocol or a UI.

- The spec comes first, versioned; a breaking change raises the version.
- Every element earns its place by measurement or by a user's need; otherwise it is cut.
- Every error says what happened and what to do next. Each error has a test that shows its text.
- Name the prior art in each design, and say what this design does better.

### Context and algorithms engineer

For a project whose quality depends on choosing, ranking or compressing data.

- Keep `docs/algorithm-targets.md`: each method in plain words, the method used now, better methods with sources, and
  the trigger that brings each up.
- Change the algorithm before tuning the code. A new method keeps the old one as its test oracle.
- Measure misses, not only hits.

### Backend and data engineer

For a project with services and stored data.

- Every schema change has a migration and a rollback, tested on a copy of real-shaped data.
- Every endpoint has a timeout, a size limit and an authorization test.
- Data that leaves the system is listed, with its purpose.

### Web platform engineer

For a project that renders HTML, CSS or a component framework.

- A change that could alter what the browser renders is proven in a headless browser: the same tree, the same
  computed style.
- Whitespace is meaning in inline elements and `<pre>`; every operation has a test with both.
- Accessibility: keyboard focus is visible, motion respects reduced-motion settings, and contrast meets WCAG AA
  (`node tools/contrast.mjs`). `docs/setup-options.md`, "User interfaces", has the full list.

### Release and open-source maintainer

Trigger: the first public release.

- Semantic versioning; a changelog in the project's voice; a signed tag per release; npm provenance.
- A test installs the packed artefact in a clean folder and runs it.
- A contribution guide, issue templates, and a response time the maintainers can keep.

### Operations engineer

Trigger: the first deployed service. Owns whether a running service tells its owner what went wrong.

- Every log line is structured (one JSON object, or the stack's format) and carries a request or job id. A test
  parses the log output of a failed request.
- Every error that reaches a log names what failed and its inputs, never a secret. The security hat's fake-secret
  test also covers the logs.
- A health check reports the service and each dependency. A test stops one dependency and sees the check fail.
- The numbers behind each gate in `docs/contract.md` (latency, error rate) are recorded as metrics in production too.
  A test against a deployed test copy reads each metric.
- Each alert has a written first response. A drill follows it once before the alert goes live.
- A backup is proven only by a restore: a test restores the latest backup into a clean copy.

Conflicts: with the security hat on what a log may hold; the security hat decides. With the backend and data
engineer on backups: that hat owns the data and its schema, and this hat owns the proof that a backup restores.

### Documentation and developer-relations lead

Trigger: the first outside user.

- Set-up guides are tested by following them on a clean machine.
- Every example in the docs runs in a test.
- A benchmark report is written so others can reproduce it.
