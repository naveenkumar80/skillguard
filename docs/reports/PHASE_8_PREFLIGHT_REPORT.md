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
