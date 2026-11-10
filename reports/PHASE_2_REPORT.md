# Phase 2 — discovery and format validation

Date: 2026-11-09. Status: TESTED locally; three-OS execution pending.

## Objective and implementation

Bounded, deterministic recursive discovery, pinned metadata conformance, strict
runtime configuration and useful content-free diagnostics. Core check needs no
Python. Existing valid fixture was corrected by renaming its directory to
example-greeting so it matches its metadata, as the upstream specification requires.

Upstream pin: agentskills/agentskills commit
83021e2be457a9b6679148719c1f6074f0ad975e, docs/specification.mdx, retrieved directly
from raw.githubusercontent.com. No floating runtime network lookups. Unicode
interpretation and upstream ambiguity are documented in rules/FORMAT_PROFILE.md.

Implemented YAML AST-only parsing, bounded aliases/nesting/nodes, duplicate keys,
required names/descriptions and optional compatibility/metadata/license/allowed-tools
types. Body restrictions were not invented. Quality advice and local parser-safety
restrictions are separate from spec rules. Filesystem inventory rejects symlinks,
special objects, unsafe labels and oversized/deep/large inputs. Reads use async
ordinary-file handles with identity checks, no-follow where available, strict
UTF-8 and bounds. Duplicate names, monorepos, exclusions and Windows paths covered.

## Validation

`pnpm check` via pinned npx: passed with **325 Vitest + 119 pytest tests** before
Phase3 integration. Includes build, lint, strict TS/mypy and both format checks.
`node scripts/check-hygiene.mjs`: passed. A temporary-directory test initially
used an uppercase random suffix as a name; corrected the fixture, not the rule.

170 format tests include positives, negatives, boundaries, optional fields,
Unicode, BOM/CRLF, YAML safety, locations and redaction. Discovery/config tests
cover deterministic monorepos, root-only skills, absent SKILL.md, duplicates,
custom/default exclusions, file/depth/entry/aggregate limits, invalid UTF-8/binary,
Windows/UNC/drive/traversal labels, outside-root directory junction and no script
execution. Existing protocol/hygiene tests remain passing.

CLI smoke: `node packages/cli/dist/index.js check tests/fixtures/valid --format
json` returned one valid skill, no findings, complete=true and AI disabled.

## Limitations

Hosted macOS/Linux CI remains unobserved. Filesystem traversal is read-only but
not an OS sandbox; hostile concurrent ancestor replacement cannot be made fully
race-free portably with Node's path APIs. Scan an immutable checkout/snapshot.
Definition-file diagnostics use source locations where available; directory
findings default to line/column1. Missing definitions are detected for a selected
root with no skills; arbitrary monorepo folders are not assumed to be broken skills.
Parser safety rejection is not a claim of upstream nonconformance. Full CLI UX,
reports/security/testing/AI are later phases; early check/doctor expose only
implemented behavior.
