# Phase 4 — static security engine

Date: 2026-11-09. Status: TESTED locally; release/security review remains pending.

## Objective and implementation

14 independent static rules SG-SEC-001–014, documented and versioned in canonical
packages/protocol/rules/security-v1.json. Python consumes bounded text only, never
reads scan paths, executes scripts, fetches URLs or invokes tools. TypeScript adds
bounded text inventory from discovered skill directories, including unreferenced
scripts. Binary/non-UTF8 assets are skipped and counted, not declared inspected.

Rules detect GitHub token shapes, AWS access key IDs, private-key markers, quoted
credential assignments, credential-bearing DB URIs, system instruction disclosure,
environment exfiltration, permission bypass, concealment, download-to-shell,
broad forced deletion, encoded execution, unpinned install commands and dependency
declarations. package.json/requirements text are parsed as data, with bounded
syntax/structure; no vulnerability database or CVE claim is made.

Evidence is **always static [REDACTED]**, never a matched secret or excerpt. Messages,
titles/remediation/references are catalog-controlled. Stable ordering, 1-based
Unicode locations, contextual instruction negation and explicit resource failures
are covered. Findings/response caps fail closed rather than truncate cleanly.

Configuration supports explicit severity overrides and exact path+rule suppressions
requiring a nonblank 12–512-character justification. Suppressed findings remain in
an audit list; justifications are represented by SHA256 rather than copied into
reports, to avoid secondary credential leaks. Overrides record original/new
severity. Unknown IDs are rejected. AI cannot create suppression policy.

## Actual tests and results

Before SG-SEC-014, full `pnpm check`: **419 Vitest passed, 1 skipped; 364 pytest
passed**, build/lint/strict types/format all passed. Repository hygiene passed.
After declaration inspection, delegated full Python suite: **555 passed**;
Ruff lint/format and strict mypy passed. Parent will rerun integrated checks after
Phase5 command/build integration; those results belong to the next report.

Security tests exercise positive/negative/boundary fixtures for **every rule**,
severity/confidence, locations, references/remediation, schema validity, redaction
through actual protocol output, contextual false positives, reproducibility,
no-execution/no-network behavior, malformed declarations, response limits and
catalog/implementation agreement. TS integration covers resource collection,
secret redaction, overrides/suppressions, unknown IDs, binaries and oversized files.

## Detection decision and limitations

Custom fixed stdlib patterns were selected for this initial bounded offline rule
set; no established-library completeness is implied. detect-secrets integration
was considered but would add detectors/dependencies and baseline semantics not yet
independently validated. Add providers deliberately with regression fixtures.
Provider-shaped patterns are not credential validation; IDs alone may not be
secrets. Generic literal detection is conservative and misses unquoted/multiline/
novel tokens. Instruction negation and syntax are heuristic and bypassable.
No transitive resolver, CVE database, binary analysis, semantic malware proof or
runtime sandbox exists. Dependency parsing supports documented formats only;
malformed/unsupported supported-file syntax returns a structured error, not clean
success. Scan immutable snapshots; portable filesystem TOCTOU limitations remain.
No true-positive/false-positive precision measurement against real public skills
has yet been performed. A clean scan is not a safety certification.
