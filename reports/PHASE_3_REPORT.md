# Phase 3 — resource and reference validation

Date: 2026-11-09. Status: TESTED locally, with one platform-permission skip.

## Objective / implementation

Parse Markdown links and validate local resources without execution or external
access. markdown-it parses inline, image and reference-style links; no regex-only
link extraction. Nested Markdown uses a deterministic visited queue with file,
byte/depth limits. Binary assets are checked for existence without text parsing.

Six documented rules cover missing resources, unsafe paths/schemes, symlinks,
incomplete checks, excluded/unindexed targets and optional duplicate advice.
All dotdot traversal (including encoded forms) is rejected even within the scan
root. Relative dot-prefix links work. Normalized targets stay within the same
nearest skill boundary. No remote links are fetched. Findings omit raw destinations
and content; line mappings are conservative block starts with column1.

Integrated into Python-free check; incomplete reference coverage is preserved in
report.complete, and reference failures invalidate the affected skill. Safety and
spec constraints remain distinct. See docs/rules/REFERENCES.md for policy details.

## Tests and actual results

- Full build/lint/typecheck and test stages passed: **410 Vitest passed, 1 skipped;
  119 pytest passed**.
- Prettier initially rejected two intentionally adversarial Markdown fixtures.
  Fixed the formatter policy to exclude fixture syntax/location data rather than
  rewriting malicious inputs. `pnpm format:check` then passed.
- `node scripts/check-hygiene.mjs`: passed.
- CLI broken-references fixture produced three SG-REF-001 high findings with safe
  messages and source lines, returned exit1 as expected.

Tests cover valid/broken local links, images/reference styles, remote and anchor
ignores, unsafe schemes, traversal/double encoding/drive/UNC paths, resource
recursion/cycles/budgets, binary assets, missing/excluded/unindexed files, context
ownership, source positions, redaction and reproducibility. Directory junction
escape tests passed on Windows. One **file symlink** case skipped because Windows
returned EPERM; no claim of file-symlink runtime verification is made here.

## Remaining / limitations

Linux/macOS hosted CI not observed. Race-free ancestor traversal is not portable
with Node path APIs: use immutable snapshots. Inline code/plain resource mentions,
raw HTML destinations, heading fragments and external URL availability are not
validated. These limitations are documented, not silently treated as covered.
Fixtures are local synthetic examples, not the required real-public-skill corpus.
