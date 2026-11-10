---
name: tdd
description: Test-first development - one failing test, then the least code that passes it, one slice at a time, with tests that can fail for the right reason. Use when building a feature or fixing a bug test-first.
---

# Test-first development

Adapted from `mattpocock/skills` (MIT; `.claude/skills/LICENSE.mattpocock-skills.txt`). The project's rules win where
they differ: `AGENTS.md`, "What 'working' means" and "Correctness".

The loop is red, then green: a failing test, then the code that makes it pass. This skill makes the loop give tests
worth keeping. Read every section before the first cycle, not after the last.

## A good test

- **It checks behaviour through a public interface,** not the inside of a module. The code can change completely;
  the test does not. A good test reads like a line of the spec: "an expired session is refused" says what the
  system does. When the project writes files or messages, their exact bytes are a public output too.
- **Its expected value comes from an independent source:** a literal you worked out, a worked example, the spec, or
  an oracle (a reference tool's output, a real browser, the `oracle-writer` agent's second implementation). It never
  recomputes the answer the way the code does.
- **It can fail.** Name the broken code that would make it fail. A test for an absence (no secret leaks, no untrusted
  code runs) has a negative control: the same call and the same assertion with the protection turned off, which must
  fail. That shows the test can see the leak or the code run.

Examples: [tests.md](tests.md).

## Where tests go

A boundary is a public interface where you can see behaviour without reaching inside. Tests go at boundaries.

1. Before the first test, list the boundaries under test. For each, say in one line what it catches and what it misses.
2. When the shape of the interface is itself open, stop. Propose the design first (`AGENTS.md`, "Structure").
3. Every boundary also gets the project's hostile and odd input (`AGENTS.md`, "Correctness"): empty and huge input,
   CRLF, a BOM, invalid UTF-8, characters outside the Basic Multilingual Plane, malformed data and deep nesting. Edge
   cases are part of the work, not extra.
4. Every operation that transforms data gets a property test with random input (`AGENTS.md`, "Correctness").

## Bad tests

- **Coupled to the inside:** it mocks the module's own parts, tests private functions, counts calls, or checks a
  side channel instead of the interface. Sign: a refactor breaks it, and behaviour did not change.
- **Tautological:** the expected value repeats the code's own computation, so it passes by construction.
- **Horizontal slices:** all tests first, then all code. Such tests check an imagined shape. Work in vertical slices:
  one test, one piece of code, then the next test, each one informed by what the last one taught.
- **Vacuous:** no broken code could make it fail.

## Mocks

Mock only at the system's edges: the network, time, random numbers, and sometimes the file system. Never mock the
project's own modules. Design those edges so a test can pass in a fake: give a function its client as an argument,
and prefer one function per outside operation over one generic fetch function.

## The rules of the loop

1. **Red before green.** Write the failing test. Run it, and see it fail for the expected reason.
2. **Then the least code** that makes it pass. No speculative features.
3. **One slice at a time:** one boundary, one test, one piece of code per cycle.
4. **Refactor after green,** with every test passing before and after.
5. **A bug fix starts with its regression test,** shown to fail with the bug put back (the `diagnosing-bugs` skill,
   stage 5).
6. **A flaky test is a bug.** Never re-run it until it passes. Fix it, or quarantine it with a row in
   `docs/follow-ups.md`.
7. When the slices are done, run `node tools/check.mjs full`. The `task-pipeline` skill then continues with its review
   step.
