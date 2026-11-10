# Phase 0 — repository audit and foundation

Date: 2026-11-09. Status: TESTED locally; hosted CI and identity approval pending.

## Objective and audit

Establish a reproducible development foundation without representing the starter
as a working scanner. All starter paths were inventoried; technical specification,
threat model, implementation plan, development standards, test strategy, ADR and
source were read. Valid architecture/community documentation and MIT license kept.
No pre-existing Git repository or user changes were present. `git init` created
local metadata only; no commit, branch, remote, publication or release was made.

## Implementation

- Locked pnpm workspace with strict TypeScript, ESLint, Prettier and Vitest.
- Canonical root pyproject, Hatchling wheel/sdist, uv lock and local virtualenv,
  pytest/Ruff/mypy; removed conflicting nested manifest and unused dependencies.
- Added portable repository hygiene scanner/tests and credential-free env example.
- Replaced TODO CI with pinned, least-privilege three-OS checks; report uploads off.
- Implementation records are no longer gitignored; private scan artifacts remain ignored.
- Added roadmap/tracker/setup/structure/changelog; corrected misleading npm installation.

## Executed acceptance checks

- `npx --yes pnpm@9.15.0 install` and frozen-lockfile install: passed.
- `uv sync --locked`: passed (agent validation).
- `npx --yes pnpm@9.15.0 check`: passed on Windows (Node 26.4.0;
  final pytest process reports Python 3.11.15).
- Included build, ESLint, Ruff lint, strict TS/mypy, **30 Vitest + 4 pytest tests**,
  Prettier and Ruff format checks: passed.
- `node scripts/check-hygiene.mjs`: passed. This is pattern-based hygiene, not proof
  that no possible secret exists.
- Python import, wheel/sdist build, lock consistency: passed in delegated validation.
- Initial Ruff import/format issue in scaffold **main** fixed; no functional scan yet.

## Naming and release hold

npm registry `https://registry.npmjs.org/@skillguard%2fcli` confirms the name is
occupied by an unrelated package. `https://pypi.org/pypi/skillguard-engine/json`
returned 404; this is not a reservation or publishing authorization. GitHub search
found several same-domain SkillGuard projects (including OSSAfrica/skillguard,
stella/skillguard and Lionberg/SkillGuard). Owner/slug is unspecified. Explicit
identity approval remains required; all JS packages stay private.

## Remaining / limitations

Hosted CI has not been run; macOS/Linux execution cannot be claimed. The local
Node runtime is newer than CI's Node22; CI compatibility remains unobserved.
ESLint9 installed with an upstream support/deprecation warning; review tooling
support before release. The engine and doctor were placeholders at audit time;
Phase1 must replace false-success behavior. No scan rules, AI providers, coverage
measurements, real-skill corpus or performance claims exist in this phase.
Security policy/private contact and code-of-conduct enforcement contact need owner
approval before public release. No gate is labelled VERIFIED based on scaffolding.
