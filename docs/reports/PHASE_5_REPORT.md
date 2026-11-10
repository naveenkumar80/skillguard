# Phase 5 — recorded fixture testing

Date: 2026-11-10. Status: TESTED locally, with one platform-permission skip.

## Objective and implementation

Phase 5 evaluates supplied recorded outputs against declared assertions without
running live agents, executing skill scripts, or connecting to external services.
The framework reads `root/skillguard.tests.yaml` in YAML 1.2 format, parses it
strictly with YAML core schema, and rejects anchors, aliases, merge keys, custom
tags, duplicate keys, and prototype pollution keys (`__proto__`, `prototype`,
`constructor`). AST depth is bounded to 32 and node count to 20,000 before
conversion to data.

Six deterministic assertion types are supported:

1. `contains`: case-sensitive substring match in string output.
2. `contains_any`: at least one substring match from a list of 1–64 strings.
3. `not_contains`: substring must be absent from string output.
4. `regex`: pattern match (max 256 code units, flags `i`, `m`, `s`, `u`) executed
   in an isolated `Worker` thread (`regex-worker.mjs`) with 32 MB heap ceiling
   and a 100 ms timeout to prevent catastrophic backtracking (ReDoS).
5. `json_path_equals`: restricted own-property path traversal (`$`, `.key`,
   `[index]`) without wildcards or eval, comparing structured values via deep
   strict equality.
6. `max_length`: string length bound from 0 to 262,144 code units.

Resource limits are strictly enforced: suite file capped at 1 MiB; referenced
definitions capped at 256 KiB; recorded output capped at 256 KiB; total read
budget capped at 4 MiB; file count capped at 1,000; suite size capped at 100
tests; assertions capped at 64 per test and 1,024 per suite. Directory depth
respects `config.limits.maxDepth`. Path traversal (`..`), absolute paths, and
symlink escapes outside canonical root fail fast with `INVALID_TEST_SUITE`.
Test reports omit prompts, outputs, regex patterns, and expected values to prevent
secondary data leaks.

The framework is integrated into the CLI via `skillguard test [path]` with
terminal and JSON output formats, returning exit code 0 for all-passing runs
and exit code 1 when any assertion fails or when a suite is malformed or missing.

## Actual tests and results

- `packages/cli/tests/testing.test.ts`: **176 Vitest passed, 1 skipped**
  (one symlink test skipped on Windows due to non-elevated `EPERM`).
- CLI smoke test on `examples/greeting`: **2 passed, 0 failed** (both text and
  structured JSON fixtures verified).
- Full monorepo check (`pnpm check`): **656 Vitest passed, 2 skipped; 670 pytest
  passed**; build, strict TypeScript (`tsc`), ESLint 9, Ruff check/format, and
  Prettier format checks all passed.
- Monorepo hygiene check (`node scripts/check-hygiene.mjs` and `hygiene.test.ts`):
  **30 tests passed**.

Test suites exercise positive, negative, and boundary cases for every assertion
type; prototype-pollution defense; AST limits; ReDoS timeouts; path traversal;
junction resolution; missing file handling; duplicate key and test ID rejection;
empty/oversized fixtures; and failure message redaction.

## Limitations and boundaries

- Recorded fixture testing evaluates static pre-recorded output only; it makes no
  claim about live agent behavior or whether an agent would actually produce the
  recorded output.
- No live agent adapter, model invocation, or shell execution exists in this runner.
- Hosted CI verification across Linux and macOS runners remains pending.
- On Windows without developer mode or elevated permissions, file symlink creation
  returns `EPERM` and is skipped; directory junction safety is verified.
- The test runner assumes an immutable directory snapshot during evaluation to avoid
  concurrent filesystem replacement races.
