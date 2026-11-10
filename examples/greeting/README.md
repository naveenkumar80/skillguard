# Recorded greeting fixtures

This directory is a complete deterministic suite root. `skillguard.tests.yaml`
uses `skill: .` to reference the ordinary `SKILL.md` in this directory.

The two fixtures are hand-authored recorded values. A passing suite means only
that those values satisfy their assertions. No prompt or skill instruction is
executed, and no real model-generated behavior is claimed.

The framework entry point is `runTests(root, config)` from
`packages/cli/src/testing/index.ts`. CLI/report/build wiring is separate.
See [the format and safety guide](../../docs/guides/DETERMINISTIC_TESTS.md).
