# SkillGuard — P0 Corrections and Phase 8 Preflight Report

- **Date:** 2026-11-10
- **Scope:** Baseline verification, P0-01 (Node.js version consistency), P0-02 (CI default branch trigger), Phase 8 GitHub Actions & CodeQL security audit, and Phase 8 implementation plan.
- **Status:** P0 corrections implemented locally and verified (`pnpm check` + hygiene); Phase 8 NOT YET STARTED (awaiting implementation authorization).

---

## Part A — Verified Baseline

Read-only inspection established the exact starting repository state prior to P0 edits:

- **Repository URL:** `https://github.com/naveenkumar80/skillguard` (`origin`: `https://github.com/naveenkumar80/skillguard.git`)
- **Repository Visibility & Default Branch (GitHub API & `git ls-remote`):**
  - `git ls-remote --symref origin HEAD` → `ref: refs/heads/master HEAD`
  - GitHub API (`repos/naveenkumar80/skillguard`) → `default_branch: master`, `visibility: public`, `private: false`
- **Local Git State at Audit Start:**
  - Branch: `master` (`## master...origin/master`)
  - Commits: `7765d7a` (`feat(cli): complete phase 7 CLI and reporting`), `b72cce8` (`chore: establish initial project baseline through phase 6 development`)
  - Initial uncommitted changes: None (clean working tree prior to P0 corrections).
- **Hosted CI Run Observation:**
  - GitHub API (`repos/naveenkumar80/skillguard/actions/runs`) returned `total_count: 0`, confirming that despite committed workflows on GitHub, **zero CI or CodeQL runs had triggered on push** because both workflows filtered on `branches: [main]` instead of `master`.

---

## Part B — P0-01 Resolution: Node.js Version Consistency

### 1. Evidence & Minimum Version Analysis

Inspection of workspace manifests, lockfile, TypeScript configuration, and source APIs established the actual Node.js support envelope:

| Source                                                                                                                     | Previous Value                 | Finding / Evidence                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`package.json`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/package.json#L7)                           | `"node": ">=22"`               | Root workspace engine constraint.                                                                                                                                                                   |
| [`packages/cli/package.json`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/package.json#L8) | `"node": ">=22"`               | CLI package engine constraint.                                                                                                                                                                      |
| [`pnpm-lock.yaml`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/pnpm-lock.yaml)                          | `vite@7.3.8` / `deep-is@0.1.4` | `vite@7.3.8` requires `^20.19.0 \|\| >=22.12.0`; `deep-is@0.1.4` requires `>=20.19.0`; `minimatch@10.2.4` requires `18 \|\| 20 \|\| >=22`. **Node `20.18.0` violates lockfile engine constraints.** |
| `@types/node`                                                                                                              | `22.19.0`                      | Type definitions target Node.js 22 APIs.                                                                                                                                                            |
| [`packages/cli/src/`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src)                     | `ES2022` / `NodeNext`          | Uses `node:readline/promises`, `node:worker_threads`, `TextDecoder`, `AbortSignal`, `Buffer`, `node:fs/promises`.                                                                                   |
| `.github/workflows/ci.yml` & `codeql.yml`                                                                                  | `node-version: "22"`           | CI tests on Node.js 22 across Ubuntu, Windows, macOS.                                                                                                                                               |
| `docs/development/LOCAL_SETUP.md` & `CI.md`                                                                                | `Node.js 22`                   | Setup & CI docs target Node.js 22 LTS or newer.                                                                                                                                                     |
| [`README.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/README.md#L35)                                | `>= 20.18.0`                   | **Inconsistent** (and Node 20 EOL reached April 2026).                                                                                                                                              |
| [`docs/REPORT_FORMATS.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/REPORT_FORMATS.md#L181)     | `node-version: "20"`           | **Inconsistent** workflow example.                                                                                                                                                                  |
| [`docs/TECHNICAL_SPEC.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/TECHNICAL_SPEC.md#L88)      | `Node.js 20 LTS`               | **Inconsistent** baseline dependency note.                                                                                                                                                          |

### 2. Resolution

Preserved `"node": ">=22"` in `package.json` and `packages/cli/package.json` (matching CI Node 22, lockfile requirements `>=22.12.0` under the 22.x line, and active LTS policy) and aligned all inconsistent documentation:

- Updated [`README.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/README.md) prerequisite to `>= 22 (Node.js 22 LTS or newer; CI runs Node.js 22)`.
- Updated [`docs/REPORT_FORMATS.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/REPORT_FORMATS.md) example workflow to `node-version: "22"`, fixed placeholder `npx skillguard` warning (referencing local built CLI prior to Phase 10 package identity resolution), added Python setup, pinned actions, and fork-safe SARIF upload condition.
- Updated [`docs/TECHNICAL_SPEC.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/TECHNICAL_SPEC.md) to `Node.js 22 LTS or newer supported LTS`.

---

## Part C — P0-02 Resolution: CI Default Branch Trigger

1. Confirmed repository default branch is `master` locally and on GitHub.
2. Updated [`.github/workflows/ci.yml`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/ci.yml):
   - Changed `push.branches: [main]` → `push.branches: [master, main]`.
   - Preserved `pull_request` and `workflow_dispatch`.
3. Updated [`.github/workflows/codeql.yml`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/codeql.yml):
   - Changed `push.branches: [main]` → `push.branches: [master, main]`.
   - Preserved `pull_request`, `workflow_dispatch`, and weekly Monday `schedule`.
4. Updated [`docs/development/CI.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/development/CI.md) to document triggers on `master` (default branch) and `main`.
5. Retained `master` as the repository's default branch without renaming or changing GitHub settings.
6. Verified least-privilege `permissions: contents: read`, `persist-credentials: false`, absence of `pull_request_target`, zero secrets exposed, and zero untrusted `${{ }}` expression interpolation in `run:` scripts.

_(Note: [`docs/GITHUB_SETUP.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/GITHUB_SETUP.md) records the historical pre-creation checklist suggesting `main` before the repo was created on `master`; left intact as historical setup notes.)_

---

## Part D — Phase 8 Workflow Audit

Audit of current workflows ([`.github/workflows/ci.yml`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/ci.yml) and [`.github/workflows/codeql.yml`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/codeql.yml)) across all 13 dimensions:

1. **CI Quality Gates:**
   - Pre-install: `node scripts/check-hygiene.mjs` runs prior to `pnpm` or `uv` installs, failing fast without traversing downloaded dependencies.
   - Main gate: `npx --yes pnpm@9.15.0 check` executes `build` (`tsc` + worker copy script), `lint` (`eslint . && uv run ruff check python`), `typecheck` (`tsc --noEmit && uv run mypy python`), `test` (`vitest run && uv run pytest`), and `format:check` (`prettier --check . && uv run ruff format --check python`).
2. **Ubuntu, Windows, and macOS Coverage:**
   - `ci.yml` executes across `[ubuntu-latest, windows-latest, macos-latest]` with `fail-fast: false` and 20-minute timeout.
   - Windows symlink tests skip gracefully (2 skipped in Vitest) without elevated privileges while junction/boundary tests run.
   - _Gap:_ Hosted runners have never executed this matrix yet (`actions/runs` count is 0); live verification on all 3 OS runners is mandatory once P0-02 commits are pushed.
3. **Node.js and Python Version Matrix:**
   - Currently tests single pair `Node 22` + `Python 3.11` with `UV_PYTHON: "3.11"` and `UV_PYTHON_DOWNLOADS: never`.
   - Sufficient for MVP preflight; future release QA (Phase 9) should consider adding secondary compatibility matrix entries (e.g., Node 24 LTS / Python 3.12+) on Ubuntu.
4. **Dependency Installation from Lockfiles:**
   - Strictly deterministic: `pnpm@9.15.0 install --frozen-lockfile`, pinned `uv==0.11.28`, `uv sync --locked`. Lockfile drift immediately fails the build.
5. **Build, Lint, Typecheck, Tests, and Formatting:**
   - All five stages run reliably under `pnpm check`. Local baseline passes 1,376 automated tests (706 Vitest + 670 Pytest).
6. **Repository Hygiene Checks:**
   - `scripts/check-hygiene.mjs` rejects stray `.env.*` files (except `.env.example`), unredacted token shapes, and PEM private keys across tracked and untracked files. Verified passing.
7. **CodeQL Workflow:**
   - Analyzes `[javascript-typescript, python]` on `ubuntu-latest` with `build-mode: none`, `paths-ignore` excluding `node_modules`, `.venv`, and `dist`.
   - Hardened against unintended uploads: `upload: never`, `upload-database: false`, `dependency-caching: false`, `trap-caching: false`, `CODEQL_ACTION_DEBUG_COMBINED_SARIF: "false"`, `CODEQL_OVERLAY_DATABASE_MODE: none`, plus an explicit guard step failing `runner.debug == '1'`.
8. **SARIF Reporting and Upload Possibilities:**
   - **Critical Finding:** `codeql.yml` intentionally does **not** upload findings to GitHub Code Scanning (`upload: never`, no `security-events: write`), and `ci.yml` does not run `skillguard scan --format sarif`. A green CodeQL workflow confirms analysis execution only — it is not a zero-findings gate or Security-tab integration.
   - Enabling CodeQL or SkillGuard SARIF uploads in Phase 8 requires granting `security-events: write` ONLY in trusted non-fork contexts (`push`, or dedicated `workflow_run`/gated job) and acknowledging that public Code Scanning alerts are visible on public repositories.
9. **Fork Pull-Request Security:**
   - Currently strong: both workflows use `pull_request` (never `pull_request_target`), `permissions: contents: read`, `persist-credentials: false`, and zero repository secrets. Fork PR code cannot access repository tokens or modify repository state.
10. **Workflow Permissions:**
    - Top-level `permissions: contents: read` enforced across both workflows. Adding any write capability in Phase 8 (`security-events: write` or PR/summary comments) must use job-level least-privilege scoping and fork guards.
11. **Third-Party Action Pinning:**
    - Checked all 4 upstream SHA pins via `git ls-remote`:
      - `actions/checkout@11d5960a326750d5838078e36cf38b85af677262` (`refs/tags/v4`) — current
      - `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (`refs/tags/v4`) — current
      - `actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065` (`refs/tags/v5`) — current
      - `github/codeql-action@33d7b85da1a04171e211befe2c739303b9a4c066` (`refs/tags/v4^{}`) — current
12. **Artifact Handling and Retention:**
    - Zero artifacts uploaded currently. In Phase 8, if CI uploads optional reports or SARIF files as build artifacts for fork PR inspection, they must contain redacted outputs only (never raw files or host paths) and specify short retention (e.g. `retention-days: 7`).
13. **Failure Reporting:**
    - Currently relies on stdout/stderr logs and non-zero exit codes. Phase 8 should add Markdown `$GITHUB_STEP_SUMMARY` summaries and clean threshold gate messages using SkillGuard's exit codes (`0`–`4`).

---

## Part E — Phase 8 Implementation Plan

### 1. Objectives and Non-Goals

- **Objectives:**
  - Build a secure, reusable SkillGuard CI integration (composite GitHub Action + example workflow + dogfooding CI check) allowing maintainers to validate skills on PRs and pushes without executing skill scripts or exposing AI credentials.
  - Integrate SkillGuard CLI exit codes (`0`–`4`), severity thresholds (`--strict`, `--severity-threshold`), Markdown step summaries (`$GITHUB_STEP_SUMMARY`), and optional SARIF 2.1.0 upload into GitHub Actions.
  - Validate the full CI workflow behavior against valid and intentionally invalid skill fixtures on GitHub-hosted runners.
- **Non-Goals:**
  - Publishing `@skillguard/cli` to npm or `skillguard-engine` to PyPI (blocked until Phase 10 identity approval).
  - Running live AI evaluations in default CI or fork PRs (AI remains disabled by default and requires explicit consent).
  - Executing arbitrary scripts inside scanned skills.

### 2. Proposed Workflow and Action Files

Do not duplicate existing workspace lint/test CI (`ci.yml`) or repository SAST (`codeql.yml`):

1. **Composite GitHub Action (`action.yml` or `.github/actions/skillguard-check/action.yml`):**
   - Inputs: `command` (`check` | `scan` | `test`), `path`, `config`, `severity-threshold`, `strict`, `format` (`terminal` | `json` | `markdown` | `sarif`), `sarif-file`, `upload-sarif`, `step-summary`, `python-version`, `node-version`.
   - Builds/runs SkillGuard from local source workspace (or pinned wheel/dist inside repo) until Phase 10 publication resolves registry package names.
   - Never enables `evaluate` or reads AI API keys.
2. **SkillGuard Self-Check / Dogfooding Workflow (`.github/workflows/skillguard.yml` or job in `ci.yml`):**
   - Runs SkillGuard CLI against `examples/greeting` (`check`, `scan`, `test`) and fixture smoke suite across PRs and `master` pushes.
   - Emits Markdown report to `$GITHUB_STEP_SUMMARY` and generates SARIF 2.1.0 artifact.
   - Enforces configured threshold gates via exit code.
3. **Reusable Starter Example Workflow (`examples/workflows/skillguard.yml` & `docs/guides/GITHUB_ACTIONS.md`):**
   - Copy-pasteable documented workflow for end users showing safe `pull_request` validation, fork-safe conditional SARIF upload, and strict step-summary gating.

### 3. Required Permissions

| Workflow / Job                                      | Trigger                                                 | Required Permissions                                   | Rationale                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Existing `ci.yml`                                   | `push`, `pull_request`, `workflow_dispatch`             | `contents: read`                                       | Untrusted PR code test execution; zero write permissions.                                                                |
| Existing `codeql.yml`                               | `push`, `pull_request`, `schedule`, `workflow_dispatch` | `contents: read`                                       | Ephemeral runner SAST validation; `upload: never`.                                                                       |
| Phase 8 Dogfooding (PR / Fork Check)                | `pull_request`, `push`                                  | `contents: read`                                       | Safe read-only check on PRs & forks; writes Markdown only to runner `$GITHUB_STEP_SUMMARY`.                              |
| Phase 8 SARIF Upload (Optional / Trusted Push Only) | `push` on `master` (or non-fork `if`)                   | `contents: read`, `security-events: write` (job-level) | Required by `github/codeql-action/upload-sarif`; skipped cleanly on fork `pull_request` events where token is read-only. |

### 4. Cross-Platform Test Matrix

- Retain `ci.yml` 3-OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`) on Node 22 and Python 3.11 for core tests & hygiene.
- Run user-facing GitHub Action tests on `ubuntu-latest` (primary action runner) plus smoke verification on `windows-latest` / `macos-latest` CLI path resolution (handling `.venv/Scripts/python.exe` vs `.venv/bin/python`).

### 5. CI Quality Gates and Failure Conditions

- Action inspects exit code from `skillguard`:
  - `0` (`EXIT_SUCCESS`): Pass step, append Markdown summary.
  - `1` (`EXIT_FINDINGS`): Fail workflow after emitting Markdown summary and capturing SARIF output (using `id` / `outcome` or explicit exit capture rather than silent `continue-on-error: true`).
  - `2` (`EXIT_INVALID_ARGUMENTS`): Fail immediately with diagnostic message (no empty SARIF upload attempt).
  - `3` (`EXIT_ENGINE_ERROR`): Fail immediately reporting missing/failed Python engine.
  - `4` (`EXIT_INTERNAL_ERROR`): Fail immediately on cancellation/internal error.

### 6. SARIF Integration Design

- Invoke `skillguard scan <path> --format sarif > skillguard.sarif` (plus `--format markdown > summary.md` or derive summary without running engine twice via JSON/Markdown formatter).
- Verify `skillguard.sarif` exists and is non-empty (`hashFiles('skillguard.sarif') != ''`) before conditional upload.
- Gate `github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066` strictly on non-fork contexts (`github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`) and configured opt-in input `upload-sarif: true`.
- Preserve unique SARIF `category` (e.g., `/skillguard:${{ inputs.path }}`) to avoid overwriting CodeQL categories (`/language:...`).
- Preserve existing `codeql.yml` `upload: never` isolation unless maintainers explicitly authorize CodeQL Security-tab alert publishing separately.

### 7. Fork and Pull-Request Security Model

- **Zero `pull_request_target` with untrusted checkout:** Always trigger PR checks on `pull_request` so untrusted PR workflows run with read-only `GITHUB_TOKEN` and zero secrets.
- **No Script Execution:** Action runs static `check`, `scan`, and recorded fixture `test` commands only — never executes skill scripts.
- **No Implicit AI Evaluation:** `evaluate` is excluded from default CI action; no provider secrets (`OPENAI_API_KEY`) are requested or passed in composite action inputs.
- **Injection Prevention:** Pass all user inputs (`path`, `config`, `severity-threshold`, `format`) to the Node/CLI step via bounded environment variables (`INPUT_PATH`, etc.) and pass directly via argument arrays (`spawn(..., shell: false)` or quoted `"$INPUT_..."`), never interpolating `${{ inputs.* }}` directly into inline shell scripts.

### 8. Test Cases and Acceptance Criteria

1. **Valid Skill Pass Test:** Running action against `examples/greeting` (`check`, `scan`, `test`) succeeds with exit code `0`, renders clean `$GITHUB_STEP_SUMMARY`, and produces valid empty SARIF 2.1.0.
2. **Invalid / Finding Fail Test:** Running action against negative fixture (e.g., `tests/fixtures/` secret candidate or invalid frontmatter) fails the step with exit code `1` while still writing the redacted Markdown summary and non-empty SARIF output.
3. **Threshold / Strict Gating Test:** High finding fails `--severity-threshold high`; medium finding passes `--severity-threshold high` (exit 0) and fails `--strict` or `--severity-threshold medium` (exit 1).
4. **Argument & Engine Failure Test:** Unsupported format returns exit `2`; bad `--python` path returns exit `3`; neither attempts invalid SARIF upload.
5. **Fork PR Simulation Test:** When `upload-sarif` is enabled on a fork `pull_request` condition check, the upload step cleanly skips instead of failing on `Resource not accessible by integration`.
6. **Hygiene & No-Secret Invariant:** Workflow YAML passes shell-injection review (no `${{ inputs.* }}` directly inside `run:`), uses SHA-pinned actions, and passes `check-hygiene.mjs`.

### 9. Hosted CI Verification Steps

1. Push P0-01/P0-02 changes (once approved) to `master` to observe the first real hosted run of `ci.yml` (Ubuntu, Windows, macOS) and `codeql.yml` (JS/TS + Python).
2. Confirm all 3 OS checks and both CodeQL analyses finish green on GitHub Actions.
3. Implement Phase 8 composite action, dogfooding workflow, tests, and documentation on a PR branch or verified branch and observe hosted PR execution.
4. Update [`docs/IMPLEMENTATION_TRACKER.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/IMPLEMENTATION_TRACKER.md) entries from `LOCALLY_TESTED` to `HOSTED_CI_VERIFIED` only after live GitHub runner passes are observed.

### 10. Risks and Mitigations

| Risk                                                            | Impact                                          | Mitigation                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow command injection via `${{ inputs.* }}` or PR metadata | Arbitrary code execution on CI runner           | Pass all inputs through `env:` bindings and double-quoted CLI args; never expand `${{ ... }}` directly inside shell `run:`.                       |
| Fork PR fails with 403 on `upload-sarif`                        | Spurious CI failures for external contributors  | Guard upload step against fork PRs (`head.repo.full_name == github.repository`); emit redacted Markdown `$GITHUB_STEP_SUMMARY` for forks instead. |
| Package identity collision (`npx skillguard`) before Phase 10   | Users install unrelated third-party npm package | Action builds/executes from verified repository source or pinned local archive until Phase 10 package identity resolution completes.              |
| Running CLI twice for SARIF + Markdown                          | Extra latency / inconsistent state              | Run CLI once to JSON (or support file outputs cleanly) or run deterministic checks consistently and document single/dual pass behavior.           |
| Uploading sensitive unredacted artifacts                        | Information disclosure on public Actions        | Enforce redacted outputs only (`evidence.redacted === true`), omit raw skill copies, set `retention-days: 7`, disable CodeQL debug uploads.       |

### 11. Dependencies and Blockers

- **No Technical Blockers for Repo-Internal Phase 8 Work:** CLI commands (`check`, `scan`, `test`, `doctor`), exit codes (`0`–`4`), Markdown formatting, and SARIF 2.1.0 are complete and tested (`1,376` passing tests).
- **External Marketplace Publication Blocker (Phase 10):** External third-party repo consumption via public npm `npx` or GitHub Marketplace action release remains gated by P0-02 (unresolved npm `@skillguard/cli` collision & repo identity approval). Phase 8 should build and validate local composite action & source-based workflows cleanly.

### 12. Exact Phase 8 Implementation Sequence

1. Push verified P0-01 and P0-02 corrections to `master` (upon user approval) and confirm green hosted runs for `ci.yml` and `codeql.yml`.
2. Create composite action (e.g., `.github/actions/skillguard/action.yml`) using env-bound inputs, SHA-pinned runtime setup, locked install, exit-code capture, Markdown step summary, and optional fork-safe SARIF export/upload.
3. Add workflow injection & action harness integration tests (testing exit codes 0/1/2/3, threshold gating, redacted Markdown/SARIF generation, and fork-guard logic).
4. Add dogfooding workflow (`.github/workflows/skillguard.yml`) exercising `examples/greeting` and negative fixtures cleanly.
5. Author user-facing CI documentation (`docs/guides/GITHUB_ACTIONS.md` and starter example workflow).
6. Run `pnpm check`, `node scripts/check-hygiene.mjs`, and verify hosted GitHub Actions execution across PR and `master` push events.
7. Produce `docs/reports/PHASE_8_REPORT.md` with observed local + hosted CI evidence and update `docs/IMPLEMENTATION_TRACKER.md`.

---

## Verification Results (Post-P0 Edits)

- `node scripts/check-hygiene.mjs`: Passed.
- `npx pnpm check`: Passed across build, ESLint, Ruff, TypeScript, Mypy, Vitest (**706 passed**, 2 skipped Windows symlinks), Pytest (**670 passed**), Prettier, and Ruff formatting (**1,376 passing tests**, 0 failures).

---

## Addendum — Updated Phase 8 Preflight Audit (2026-11-11)

- **Audit Date:** 2026-11-11
- **Audit Scope:** Strictly read-only verification of baseline commit `f4b11fe`, hosted 3-OS CI & CodeQL runs, CLI implementation vs documentation, composite GitHub Action feasibility, fork/PR security threat model, dogfooding fixture readiness, acceptance test matrix, and release/identity boundaries.
- **Historical Preservation:** Sections `Part A` through `Verification Results (Post-P0 Edits)` above remain preserved verbatim as historical evidence from `2026-11-10`.

### 1. Exact Baseline SHA and Repository State

- **Repository:** `https://github.com/naveenkumar80/skillguard.git` (`C:\Users\navee\Downloads\skillguard-starter\skillguard`)
- **Branch:** `master` (`## master...origin/master`)
- **HEAD SHA:** `f4b11fe6ff35c18fcc7563bfe7354ebbe192c9c6` (`test: stabilize global AI timeout tests across platforms`)
- **Parent SHA (`HEAD^`):** `8791ba51e2b987a0d213ecee842524fc2e08bcbb` (`fix(ci): resolve cross-platform Python paths and line endings`)
- **Remote Sync (`origin/master` & `git ls-remote origin refs/heads/master`):** Exact match at `f4b11fe6ff35c18fcc7563bfe7354ebbe192c9c6`.
- **Working Tree State Before Audit Edit:** Zero modified tracked files; one pre-existing untracked review artifact (`?? docs/reports/PRE_PUSH_REVIEW_F4B11FE.md`).
- **Active Workflows Verified:**
  - [`.github/workflows/ci.yml`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/ci.yml): Triggers on `push` (`[master, main]`), `pull_request`, `workflow_dispatch`; `permissions: contents: read`; `persist-credentials: false`; runs `check-hygiene.mjs`, `uv==0.11.28`, `pnpm@9.15.0 install --frozen-lockfile`, `uv sync --locked`, and `pnpm@9.15.0 check` across `[ubuntu-latest, windows-latest, macos-latest]` (Node `22`, Python `3.11`).
  - [`.github/workflows/codeql.yml`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/codeql.yml): Triggers on `push` (`[master, main]`), `pull_request`, `workflow_dispatch`, weekly `schedule`; `permissions: contents: read`; analyzes `[javascript-typescript, python]` with `build-mode: none`, `upload: never`, `upload-database: false`, `dependency-caching: false`, `trap-caching: false`, `CODEQL_ACTION_DEBUG_COMBINED_SARIF: "false"`, `CODEQL_OVERLAY_DATABASE_MODE: none`, and an explicit debug-run failure guard.

### 2. Current Hosted CI Evidence (`f4b11fe6ff35c18fcc7563bfe7354ebbe192c9c6`)

Queried via GitHub Actions REST API for `head_sha=f4b11fe6ff35c18fcc7563bfe7354ebbe192c9c6`:

- **Workflow `CI` (Run `43010401150`, event `push`):** `completed` → **`success`**
  - `Check (ubuntu-latest)` (Job `130488262256`): `completed` → **`success`**
  - `Check (macos-latest)` (Job `130488261763`): `completed` → **`success`**
  - `Check (windows-latest)` (Job `130488262618`): `completed` → **`success`**
- **Workflow `CodeQL` (Run `43010401166`, event `push`):** `completed` → **`success`**
  - `Analyze (javascript-typescript)` (Job `130488261997`): `completed` → **`success`**
  - `Analyze (python)` (Job `130488262488`): `completed` → **`success`**

_(Resolves the prior `2026-11-10` Ubuntu/Windows/macOS CI failures verified in `CROSS_PLATFORM_CI_FIX_REPORT.md` and `MACOS_TIMEOUT_TEST_FIX_REPORT.md`.)_

### 3. CLI Implementation Audit

Direct inspection of `packages/cli/src/` and live invocations of `node packages/cli/dist/index.js`:

1. **Commands Verified:**
   - `check [path]` ([`commands/check.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/check.ts)): Offline format (`terminal`, `json`, `markdown`, `sarif`), spec/structure/reference validation (`core/check.ts`), accepts `--python` (unused).
   - `scan [path]` ([`commands/check.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/check.ts), [`core/scan.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/core/scan.ts)): Runs `check()` plus static Python `scan` subprocess; enforces `config.rules` overrides and audited `suppressions` (`reasonSha256`). Neither `check` nor `scan` executes skill scripts.
   - `test [path]` ([`commands/test.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/test.ts), [`testing/suite.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/testing/suite.ts)): Parses bounded YAML 1.2 AST (`<= 20,000` nodes, `<= 32` depth, zero aliases/anchors/tags/prototype keys) and evaluates recorded outputs (`contains`, `contains_any`, `not_contains`, `regex` via bounded worker, `json_path_equals`, `max_length`) in `terminal`, `json`, or `markdown`.
   - `doctor` ([`index.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/index.ts)): Validates `--format` (`terminal|json|markdown`) and `--timeout` (`1..120000` ms) and invokes Python engine `doctor` without reading skill directories.
   - `evaluate [path]` ([`commands/evaluate.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/evaluate.ts), [`commands/consent.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/consent.ts), [`core/evaluate.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/core/evaluate.ts)): Disabled by default (`aiEvaluation.enabled: false`); interactive disclosures write to `process.stderr` leaving stdout clean; non-TTY without `--ai-consent` fails closed (`CONSENT_REQUIRED`, exit `2`); excluded from Phase 8.
2. **Exit Codes `0`–`4` ([`exit-codes.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/core/exit-codes.ts), [`index.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/index.ts#L127-L157)):**
   - `0` (`EXIT_SUCCESS`): Clean check/scan/test/doctor run; declined AI consent; completed AI evaluation (even if advisory findings exist).
   - `1` (`EXIT_FINDINGS`): `!report.complete` or `crossesThreshold()` on `check`/`scan`; `report.failed > 0` on `test`; `evaluate` when `status === "failed"` (note: `core/evaluate.ts#L104-L110` catches `EngineError`/`ScanError`, mapping mid-evaluation `ENGINE_UNAVAILABLE` or `CANCELLED` errors to exit `1` rather than `3`/`4`).
   - `2` (`EXIT_INVALID_ARGUMENTS`): `CommanderError` (except `--help`/`--version` → `0`), `ScanError` (except `CANCELLED`), `EngineError("INVALID_OPTIONS")`, invalid config, invalid test suite, or non-TTY missing `--ai-consent`.
   - `3` (`EXIT_ENGINE_ERROR`): Uncaught `EngineError` in `doctor`/`scan` (missing Python `ENGINE_UNAVAILABLE`, `ENGINE_CRASH`, `TIMEOUT`, `INVALID_JSON`, `INVALID_REQUEST`, `INVALID_RESPONSE`, `UNSUPPORTED_PROTOCOL`, `REQUEST_TOO_LARGE`, `OUTPUT_LIMIT`).
   - `4` (`EXIT_INTERNAL_ERROR`): `SIGINT`/`SIGTERM` `AbortController` cancellation (`CANCELLED` outside `evaluateAdvisory`) or unexpected unhandled exceptions (redacted generic message).
3. **Severity Threshold & Strict Mode:** [`crossesThreshold()`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/core/models.ts#L94-L105) excludes `ai-evaluation` findings and returns `true` if any deterministic finding has `severity >= (strict ? "info" : threshold)` (default `threshold: "high"`, `strict: false`).
4. **Outputs & Stdout Isolation:**
   - `--format json` and `--format sarif` write strictly valid UTF-8 JSON to `stdout` (`check`, `scan`, `test`, `doctor`, `evaluate`, including declined-consent `evaluate` reports).
   - SARIF 2.1.0 ([`reporting/sarif.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/sarif.ts)) sets `$schema: "https://json.schemastore.org/sarif-2.1.0.json"`, `version: "2.1.0"`, relative `uri` with `uriBaseId: "%SRCROOT%"`, maps `critical`/`high` → `error`, `medium` → `warning`, `low`/`info` → `note`, and sorts rules deterministically.
   - `--quiet` suppresses terminal stdout cleanly while still emitting `json`, `markdown`, and `sarif`. Interactive consent writes exclusively to `process.stderr`.
5. **Python Engine Subprocess & Cross-Platform Resolution ([`engine/client.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/engine/client.ts)):**
   - Precedence: `--python` option > `process.env["SKILLGUARD_PYTHON"]` > bare `"python"` command on `PATH`. Relative interpreter paths resolve via `resolve(configured)` prior to switching working directory to `tmpdir()`.
   - Spawns `spawn(executable, ["-I", "-m", "skillguard_engine"], { shell: false, windowsHide: true, cwd: tmpdir(), env: engineEnvironment(...) })`. Environment allowlist passes only `PATH`, `SYSTEMROOT`, `WINDIR`, `SYSTEMDRIVE`, `TEMP`, `TMP`, `LANG`, `LC_ALL` (plus `OPENAI_API_KEY` solely on validated `evaluate` with `enabled && consent`).
   - **Important Phase 8 Gap:** Production `client.ts` does **not** automatically search `.venv/bin/python` or `.venv/Scripts/python.exe` (only [`packages/cli/tests/helpers/python.ts`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/helpers/python.ts) checks `.venv`). CI/actions using `uv sync --locked` MUST pass the `.venv` Python path explicitly via `--python` or `SKILLGUARD_PYTHON`.
6. **Configuration & Safety in Job Summaries:**
   - `--config <file>` reads UTF-8 JSON ordinary non-symlink files `<= 64 KiB` via strict Zod schema; `config.paths` resolve relative to `dirname(configPath)`, whereas CLI `[path]` resolves relative to `process.cwd()`.
   - `check`, `scan`, and `test` outputs redact all evidence (`evidence.redacted === true`), never dump skill content or Python `stderr`, and emit relative `normalizedRelative` paths safe for `$GITHUB_STEP_SUMMARY`. Two caveats: [`formatEvaluateMarkdown()`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/markdown.ts#L145) prints absolute `report.root` (avoided in Phase 8 because `evaluate` is excluded), and [`formatCheckMarkdown()`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/markdown.ts#L34-L46) interpolates `path` into Markdown table cells without escaping `` ` `` or `|`.

### 4. Verified Documentation Discrepancies

| Document                                                                                                                                  | Documented Claim                                                                                                        | Observed Implementation Behavior                                                                                                                                                                                                                      | Severity |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| [`README.md`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/README.md#L98-L113)                                          | `--quiet` preserves JSON or SARIF; `--verbose` prints "evidence snippets"; terminal is "ANSI-styled".                   | `--quiet` also preserves Markdown (`check.ts#L111`); `--verbose` prints `Message` & `Remediation` only (`terminal.ts#L53-L57`); terminal output is plain text with zero ANSI codes.                                                                   | Low      |
| [`docs/CLI_REFERENCE.md`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/docs/CLI_REFERENCE.md#L176-L179)                 | `evaluate` exits `1` on "critical advisory failures" and `3` on engine failure.                                         | `evaluate` is strictly advisory (`0` regardless of AI findings) and `evaluateAdvisory()` catches `EngineError`/`ScanError`, exiting `1` on failures (`evaluate.ts#L152-L153`, `core/evaluate.ts#L104-L110`).                                          | Medium   |
| [`docs/CONFIGURATION.md`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/docs/CONFIGURATION.md#L16-L92)                   | CLI flags always override config; `checks.structure` "Cannot disable boundary safety checks".                           | `--strict` cannot override config `"strict": true` back to `false` (no `--no-strict`); `"structure": false` disables `validateReferences` (`SG-REF-*`) while keeping `inventory` traversal bounds (`check.ts#L49,131`).                               | Low      |
| [`docs/REPORT_FORMATS.md`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/docs/REPORT_FORMATS.md#L26-L209)                | JSON `tool.name: "skillguard"`, `skills[].path` directory, terminal/Markdown layouts, `hashFiles()` SARIF upload check. | `check`/`scan` JSON uses `tool.name: "SkillGuard"` and `SKILL.md` file paths; Markdown omits `## Overview` and conditional `Suppressed Findings`; `hashFiles('file.sarif') != ''` evaluates **truthy** on 0-byte files left by shell `>` redirection! | High     |
| [`docs/AI_PRIVACY_AND_CONSENT.md`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/docs/AI_PRIVACY_AND_CONSENT.md#L53-L81) | Non-TTY omission raises `INVALID_CONFIG` checking `stdin.isTTY`; sends extracted frontmatter metadata.                  | Raises `CONSENT_REQUIRED` checking `!stdin.isTTY \|\| !stderr.isTTY` (`consent.ts#L38-L42`); Python payload transmits `{fileIndex, content}` array only (`ai/__init__.py#L234-L241`).                                                                 | Low      |

### 5. Composite GitHub Action Feasibility (`.github/actions/skillguard/action.yml`)

- **Suitability:** Feasible and recommended. A repository-local composite action running from verified source (`node "<skillguard-root>/packages/cli/dist/index.js"`) avoids unpublished package dependencies (`npx skillguard`) and guarantees lockstep CLI + Python engine compatibility.
- **Reproducible Toolchain & Avoiding Repeated Installs:**
  - Pin `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (`node-version: "22"`, or configurable safe input) and `actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065` (`python-version: "3.11"`).
  - Install `uv==0.11.28`, run `npx --yes pnpm@9.15.0 install --frozen-lockfile`, `uv sync --locked` (`UV_PYTHON_DOWNLOADS: never`), and `pnpm --filter @skillguard/cli build`.
  - Support an explicit opt-in input (e.g. `install-dependencies: "true"` default, settable to `"false"` when preceded by a single setup step or already built) so multi-invocation workflows (such as dogfooding) do not reinstall dependencies repeatedly while external/single-step usage remains zero-config.
- **Cross-Platform Path, Space, and Python Resolution:**
  - Drive CLI execution from a dedicated Node runner script shipped beside `action.yml` (`node "$GITHUB_ACTION_PATH/run.mjs"` with all `${{ inputs.* }}` passed via `env:` variables — never inline `${{ inputs.* }}` inside shell `run:`!).
  - Inside `run.mjs`, use `spawnSync(process.execPath, [cliDistPath, ...args], { shell: false })` so paths containing spaces, Windows backslashes/drive letters, and CRLF never undergo shell splitting or Git-Bash path mangling.
  - Resolve `<skillguard-root>/.venv/Scripts/python.exe` (`win32`) vs `.venv/bin/python` (POSIX) cleanly and pass via `--python` (unless user supplies explicit override).
- **Commands, Exit Codes, Summary, and SARIF Guarding:**
  - Support `command` restricted strictly to `check`, `scan`, or `test` (`evaluate` excluded).
  - Preserve exact exit codes (`0`–`4`) across outputs (`exit-code`) without swallowing failures (`fail-on-error` optional or explicit return propagation after writing summary!).
  - When `step-summary: "true"`, capture `--format markdown` output safely and append to `$GITHUB_STEP_SUMMARY` (even when exiting `1` on findings, before failing the step; never on exit `2`/`3`/`4` crashes).
  - For SARIF (`command` in `check`/`scan`): write `--format sarif` via Node `fs.writeFileSync` **only** when exit code is `0` or `1` AND JSON parses as valid SARIF 2.1.0 (`$schema`, `version === "2.1.0"`, non-empty `runs`). Expose `sarif-file`, `sarif-valid` (`true`/`false`), and `sarif-has-results` (`true`/`false`) outputs so downstream upload jobs never receive 0-byte files or invalid JSON (`hashFiles()` alone does NOT guard against 0-byte files!).
- **Dogfooding & Fixture Readiness (`.github/workflows/skillguard.yml`):**
  - `examples/greeting/` cleanly exercises `check` (exit `0`), `scan` (exit `0`), and `test` (exit `0`, 2 assertions).
  - `tests/fixtures/broken-references/` and `tests/fixtures/traversal/` emit `high` `SG-REF-001` / `SG-REF-002` findings (exit `1`), **not** Python `SG-SEC-*` security rules.
  - **Fixture Gap:** No existing tracked `SKILL.md` fixture triggers a `SG-SEC-*` rule cleanly without `check-hygiene.mjs` overlap, produces a `medium`-only finding (`SG-SEC-009`, `SG-SEC-013`, or `SG-SEC-014`) to verify `--severity-threshold high` (pass) vs `medium`/`--strict` (fail), or asserts a failing `skillguard.tests.yaml` suite. Phase 8 must add small deterministic dogfooding fixtures (avoiding real secret shapes flagged by `scripts/check-hygiene.mjs`).

### 6. Security Findings (Phase 8 Architecture & Codebase)

- **BLOCKER:** None for repo-internal Phase 8 implementation. (External npm/PyPI/Marketplace distribution remains blocked until Phase 10 identity approval.)
- **HIGH:**
  1. **`hashFiles()` 0-byte SARIF hazard:** Using shell redirection `>` plus `hashFiles('file.sarif') != ''` (`REPORT_FORMATS.md#L205`, `PHASE_8_PREFLIGHT_REPORT.md#L169`) evaluates truthy on 0-byte files left by failed `exit 2`/`3`/`4` runs, causing `upload-sarif` failures or false empty uploads. **Mitigation:** Write SARIF in Node only on exit `0`/`1`, validate non-empty SARIF schema, and gate downstream upload on explicit `sarif-valid == 'true'` (and `sarif-has-results` policy).
  2. **Permission & Fork PR boundary for SARIF upload:** Combining `security-events: write` into a `pull_request` job exposes Code Scanning write scope to PR code, and upload fails on fork PRs where tokens are read-only. **Mitigation:** Run scan/check/test jobs strictly with `permissions: contents: read` on `pull_request` / `push`; isolate `security-events: write` into a separate, opt-in trusted upload job guarded by `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository` consuming the redacted SARIF artifact (`retention-days: 7`). Never use `pull_request_target` with untrusted checkout; keep `.github/workflows/codeql.yml` (`upload: never`) unchanged.
  3. **Expression / Shell injection vector in composite action:** Direct `${{ inputs.* }}` or PR title/branch interpolation in `run:` scripts risks runner RCE. **Mitigation:** Bind every action input exclusively through `env:` into a Node wrapper script using `spawn(..., { shell: false })`.
- **MEDIUM:**
  1. **Implicit `.venv` Python resolution gap (`engine/client.ts#L67-L68`):** Production CLI falls back to PATH `"python"` instead of `.venv`, causing `EXIT_ENGINE_ERROR` (`3`) on `actions/setup-python` unless composite action explicitly resolves and passes `.venv` Python path.
  2. **Absolute `report.root` in `formatEvaluateMarkdown()` (`reporting/markdown.ts#L145`):** Exposes host runner paths if `evaluate` were ever written to job summaries; excluded from Phase 8 (`check`/`scan`/`test` only).
  3. **Markdown table pipe/backtick unescaped filenames (`reporting/markdown.ts#L34,46`):** Legal POSIX filenames containing `|` or `` ` `` in fork PRs can disrupt Markdown tables in `$GITHUB_STEP_SUMMARY` (GitHub strips HTML/scripts; sanitize table cells in Phase 8/hardening).
  4. **Missing dogfooding fixtures:** Need deterministic `SG-SEC-*` security, `medium`-severity threshold, and negative `test` skill fixtures.
- **LOW:**
  1. Documentation discrepancies across the 5 audited Markdown guides (`Section 4` above).
  2. GitHub runner deprecation notices on upstream `@v4`/`@v5` SHA-pinned actions (`Node 20` on runners migrating to Node `24`); tracked upstream until SHA pins are intentionally refreshed.

### 7. Proposed Phase 8 Implementation Sequence

1. **Workspace Prep:** Commit/reconcile approved pending report artifacts (`PRE_PUSH_REVIEW_F4B11FE.md` and this preflight addendum) before starting Phase 8 feature work.
2. **Add Dogfooding Fixtures:** Add safe, hygiene-compliant negative fixtures in `tests/fixtures/` covering spec failure, `medium` `SG-SEC-*` rule (e.g. `SG-SEC-013`/`014` unpinned dependency or `SG-SEC-009` concealment wording), `high`/`critical` `SG-SEC-*` pattern (e.g. `SG-SEC-010` piped install wording), and recorded test failure without executing any scripts or storing secret-shaped tokens.
3. **Implement Composite Action (`.github/actions/skillguard/`):**
   - `action.yml`: Inputs (`command`, `path`, `config`, `severity-threshold`, `strict`, `format`, `sarif-file`, `step-summary`, `node-version`, `python-version`, `install-dependencies`), outputs (`exit-code`, `sarif-file`, `sarif-valid`, `sarif-has-results`), SHA-pinned `setup-node` / `setup-python`.
   - Accompanying Node runner (`run.mjs`): Pure `env:` input reading, cross-platform `.venv` Python lookup, `spawnSync(..., { shell: false })`, clean exit capture `0`–`4`, `$GITHUB_STEP_SUMMARY` Markdown emission, validated non-empty SARIF emission, zero `evaluate` or AI key forwarding.
4. **Action Harness & Security Acceptance Tests:** Unit/integration tests for `run.mjs` and YAML workflow static checks covering injection resistance, spaces/Windows paths, exit codes `0`–`4`, threshold vs strict gating, valid vs empty/invalid SARIF handling, fork guard logic, and redacted summaries.
5. **Implement Dogfooding Workflow (`.github/workflows/skillguard.yml`):** `permissions: contents: read` scan/check/test matrix/jobs exercising `examples/greeting`, controlled negative fixtures, threshold toggles, JSON/Markdown/SARIF outputs, and a separate opt-in non-fork SARIF upload job (`security-events: write`) gated cleanly (`retention-days: 7`). Keep `.github/workflows/codeql.yml` (`upload: never`) untouched.
6. **Documentation & Discrepancy Sync:** Add `docs/guides/GITHUB_ACTIONS.md` + `examples/workflows/skillguard.yml`, and correct the verified discrepancies in `README.md`, `CLI_REFERENCE.md`, `CONFIGURATION.md`, `REPORT_FORMATS.md`, and `AI_PRIVACY_AND_CONSENT.md`.
7. **Local & Hosted Verification + Phase 8 Report:** Pass `node scripts/check-hygiene.mjs` and `pnpm check`, observe green hosted GitHub Actions runs on `pull_request` and `push`, update `docs/IMPLEMENTATION_TRACKER.md`, and author `docs/reports/PHASE_8_REPORT.md`.

### 8. Acceptance Criteria & Test Matrix

| Case                                | Expected Behavior                                                                                       | Verification Layers                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Valid skill (`check`/`scan`/`test`) | Exit `0`, valid Markdown summary, clean zero-finding SARIF 2.1.0                                        | Unit + CLI Integration + Hosted Dogfooding            |
| Invalid skill (`check`)             | Exit `1`, spec/ref findings reported in summary & SARIF                                                 | Unit + CLI Integration + Hosted Dogfooding            |
| Security finding at threshold       | Exit `1` at `--severity-threshold high` (or `medium`/`critical`)                                        | CLI Integration + Hosted Dogfooding                   |
| Below-threshold finding             | Exit `0` when finding `< threshold`; exit `1` under `--strict`                                          | Unit + CLI Integration + Hosted Dogfooding            |
| Invalid CLI arg / config            | Exit `2`, clear stderr message, no SARIF file created                                                   | Unit + Integration (`run.mjs`) + CLI tests            |
| Missing Python engine               | Exit `3` (`scan`/`doctor`), no empty SARIF file created                                                 | Unit + Integration (`run.mjs`)                        |
| Cancelled / internal failure        | Exit `4` (`SIGINT`/abort), safe redacted diagnostic                                                     | CLI Unit/Integration (`AbortController`)              |
| Invalid SARIF output                | Rejected by schema/JSON check (`sarif-valid=false`), no upload                                          | Unit (`run.mjs` SARIF validator)                      |
| Empty SARIF (0-byte & 0-result)     | 0-byte rejected (`sarif-valid=false`); 0-result `sarif-has-results=false`, not uploaded when suppressed | Unit + Integration + Workflow condition test          |
| Fork `pull_request` event           | Read-only job succeeds/gates normally; SARIF upload cleanly skipped (never 403)                         | Workflow expression tests + Hosted PR check           |
| Malicious path / input spaces       | No shell expansion or command injection via `${{ }}` / spaces                                           | Unit (`shell: false`, `env:` YAML lint) + Integration |
| Summary content & redaction         | No raw secrets, no `OPENAI_API_KEY`, no absolute host paths (`check`/`scan`/`test`)                     | CLI Integration + Markdown inspection                 |
| No skill script execution           | Untrusted scripts inside fixtures never invoked during scan/test                                        | Existing Python/CLI static engine invariants          |
| AI remains disabled                 | `aiEvaluation: "disabled"`, no `evaluate` invocation or provider env leakage                            | Unit (`engineEnvironment`) + CLI output checks        |

### 9. Explicit Unresolved Dependencies & Boundaries

- **npm Identity (`@skillguard/cli`):** Occupied/unresolved upstream; **no npm publish**.
- **PyPI Identity (`skillguard-engine`):** Unreserved; **no PyPI publish**.
- **GitHub Identity & Marketplace:** Repository name provisional; **no GitHub Marketplace publication, release tags, or public releases**.
- **CodeQL Uploads:** `.github/workflows/codeql.yml` remains strictly `upload: never` with `contents: read`.
- **AI Evaluation:** Excluded completely from default Phase 8 CI actions and workflows; zero external API calls or spending.

### 10. Final Verdict

**CONDITIONAL READY** — The verified baseline commit `f4b11fe6ff35c18fcc7563bfe7354ebbe192c9c6` is green across hosted Ubuntu, macOS, Windows, and CodeQL runs, and all underlying CLI capabilities (`check`, `scan`, `test`, `doctor`, exit codes `0`–`4`, Markdown, JSON, SARIF 2.1.0, and Python subprocess containment) are implemented and tested locally (`1,386` passed, `2` Windows symlink skipped). Repository-internal Phase 8 implementation is ready to proceed immediately **subject to these mandatory implementation conditions**:

1. Build and run exclusively from local repository source (never `npx skillguard`) and resolve `.venv` Python explicitly in the composite action runner (`--python` / `SKILLGUARD_PYTHON`).
2. Add controlled security, medium-threshold, and failing-test fixtures before configuring negative dogfooding assertions.
3. Replace shell-redirected SARIF + `hashFiles()` checks with Node-level post-exit JSON/SARIF validation, separate `security-events: write` into an opt-in non-fork trusted job, and enforce pure `env:`-bound inputs with `shell: false`.
4. Retain Phase 10 external registry/Marketplace blocks until package and repository identities are formally approved.

### 11. Security Remediation Addendum (2026-11-25)

Independent Phase 8 review tightened three controls beyond the initial `2026-11-11` preflight baseline:

1. **Privileged SARIF Upload Boundary (`P0`):** `pull_request` events—including same-repository pull requests—are permanently excluded from `security-events: write`. Only trusted pushes (or explicit manual runs) targeting protected branch `master` may trigger the isolated `upload-sarif` job, which consumes a workflow artifact (`actions/download-artifact`) and runs zero repository checkout, build scripts, or SkillGuard code.
2. **Full Offline OASIS SARIF 2.1.0 Schema Validation (`P1`):** `validateSarifContent` validates SARIF artifacts against the locally pinned official OASIS errata01 JSON Schema (`.github/actions/skillguard/schemas/sarif-schema-2.1.0.json`) via `ajv-draft-04` and `ajv-formats` with zero remote network fetching.
3. **Workspace Path Boundary Enforcement (`P1`):** `path` and `config` inputs enforce canonical workspace confinement, rejecting `..` traversal, UNC paths, non-native/external Windows drive paths, external absolute paths, and symlinks resolving outside the workspace.
