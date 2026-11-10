# Implementation Plan and Backlog

The sequence below prioritizes a usable, safe deterministic core before AI features. Issue IDs are suggested labels; create one GitHub issue per task or cohesive task group.

## Milestone 0 — Repository foundation

- [ ] SG-001 Create pnpm workspace and Python package layout.
- [ ] SG-002 Add MIT license, README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT.
- [ ] SG-003 Add TypeScript strict config, lint, format, and test scripts.
- [ ] SG-004 Add Python pyproject, Ruff, mypy, pytest configuration.
- [ ] SG-005 Add GitHub Actions for TypeScript, Python, docs, and cross-platform CI.
- [ ] SG-006 Define shared protocol JSON Schema and compatibility tests.
- [ ] SG-007 Add issue templates, PR template, labels, and release workflow.

**Exit gate:** clean clone installs, lint/test commands run, CI is green.

## Milestone 1 — Skill discovery and format validation

- [ ] SG-010 Implement safe skill directory discovery.
- [ ] SG-011 Implement SKILL.md parsing and YAML frontmatter diagnostics.
- [ ] SG-012 Implement required metadata validation against a pinned profile.
- [ ] SG-013 Implement metadata length/character constraints only when supported by the pinned spec.
- [ ] SG-014 Implement structure checks for supported resource directories.
- [ ] SG-015 Add stable rule registry and finding model.
- [ ] SG-016 Add terminal output and exit-code contract.
- [ ] SG-017 Add fixtures for valid, malformed, and boundary-case skills.

**Exit gate:** `skillguard check ./skills` validates fixture corpus deterministically.

## Milestone 2 — References and filesystem integrity

- [ ] SG-020 Parse Markdown local links and known resource references.
- [ ] SG-021 Detect missing local references.
- [ ] SG-022 Detect path traversal and references escaping the skill root.
- [ ] SG-023 Define symlink policy and test it on all supported operating systems.
- [ ] SG-024 Add excludes and monorepo discovery configuration.
- [ ] SG-025 Add JSON and Markdown report formats.

**Exit gate:** broken and unsafe references are detected without reading outside allowed roots.

## Milestone 3 — Static security engine

- [ ] SG-030 Define Python engine package and versioned stdin/stdout protocol.
- [ ] SG-031 Implement TypeScript subprocess launcher, timeout, cancellation, env allowlist.
- [ ] SG-032 Implement Python protocol validation and structured errors.
- [ ] SG-033 Add secret candidate detection with redaction.
- [ ] SG-034 Add suspicious shell/download/execute pattern rules.
- [ ] SG-035 Add script and dependency inventory without execution.
- [ ] SG-036 Add prompt-injection/social-engineering pattern rules with confidence labels.
- [ ] SG-037 Add security rule documentation and false-positive fixtures.
- [ ] SG-038 Add engine-absent and incompatible-version behavior.

**Exit gate:** scanning is read-only; no skill script is executed; all findings include actionable evidence.

## Milestone 4 — Deterministic behavioral tests

- [ ] SG-040 Define and validate `skillguard.tests.yaml`.
- [ ] SG-041 Implement fixture-based test runner.
- [ ] SG-042 Implement initial assertions: contains, contains_any, not_contains, regex, json_path_equals, max_length.
- [ ] SG-043 Add test report model and stable IDs.
- [ ] SG-044 Add sample skill and sample test suite.
- [ ] SG-045 Add negative tests for malformed test definitions.

**Exit gate:** tests are reproducible and do not invoke arbitrary tools.

## Milestone 5 — Optional LLM evaluation

- [ ] SG-050 Define provider-neutral evaluation interface.
- [ ] SG-051 Implement explicit opt-in and preflight disclosure.
- [ ] SG-052 Implement budget, timeout, retry, and content-size limits.
- [ ] SG-053 Record provider/model/prompt-template version and cost metadata.
- [ ] SG-054 Add prompt-injection-resistant evaluator instructions and adversarial tests.
- [ ] SG-055 Ensure AI results are advisory and cannot suppress deterministic findings.
- [ ] SG-056 Document privacy/data handling for each provider adapter.

**Exit gate:** AI evaluation is disabled by default, bounded, auditable, and separate from deterministic pass/fail.

## Milestone 6 — CI and release

- [ ] SG-060 Add GitHub Actions example and reusable workflow.
- [ ] SG-061 Add strict mode and configurable severity thresholds.
- [ ] SG-062 Add release build and package provenance checks.
- [ ] SG-063 Test install paths on Linux/macOS/Windows.
- [ ] SG-064 Test against a curated corpus of real public skills with permission-respecting usage.
- [ ] SG-065 Publish docs for rules, config, protocol, limitations, and contribution.
- [ ] SG-066 Release v0.1.0 only after acceptance gates pass.

## Suggested first 10 issues

1. Workspace and package skeleton (SG-001)
2. Shared finding model (SG-015)
3. Frontmatter parser and diagnostics (SG-011)
4. Required metadata rules (SG-012)
5. Safe skill discovery (SG-010)
6. Terminal reporter and exit codes (SG-016)
7. Valid/malformed fixtures (SG-017)
8. Local reference parser (SG-020)
9. JSON report schema (SG-025)
10. Python protocol design and golden tests (SG-030)

## Definition of done

A task is done when implementation, tests, docs, error handling, and compatibility notes are included; CI passes; no secrets or user data are added to fixtures; and the PR explains limitations and behavior changes.
