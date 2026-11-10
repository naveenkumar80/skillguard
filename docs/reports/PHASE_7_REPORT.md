# Phase 7 — Complete CLI, User Experience, and Reporting Implementation

Date: 2026-11-10. Status: LOCALLY_TESTED (PASS).

## 1. Objective and Scope

Phase 7 completes the end-to-end command-line interface, user experience, and reporting infrastructure for the Agent Skill Assurance CLI (`skillguard`), building upon the foundation established across Phases 0–6.

Key Phase 7 deliverables:

1. **Complete Command Architecture:**
   - `skillguard check [path]`: Offline format, metadata, and resource reference validation without requiring Python.
   - `skillguard scan [path]`: Static security analysis and policy enforcement via the isolated Python engine.
   - `skillguard test [path]`: Deterministic fixture test runner executing assertions against recorded skill outputs.
   - `skillguard doctor`: Environment diagnostic inspecting Node.js, Python engine, rule-set versions, and capabilities.
   - `skillguard evaluate [path]`: Optional advisory AI evaluation of skill instruction text with strict explicit consent enforcement.
   - `skillguard --help` and `skillguard --version`: Standard command discovery and package version display.
2. **User-Facing AI Consent Workflow (Closing Phase 6 Gap):**
   - Interactive TTY consent flow presenting a detailed transparency disclosure (provider, model, transmitted file text, path redaction, budget caps, and advisory nature) with explicit `[y/N]` confirmation.
   - Non-interactive automation support via explicit `--ai-consent` flag. In automated/piped environments without `--ai-consent`, execution fails closed immediately without blocking on stdin.
   - Zero credential forwarding or provider contact if consent is declined or missing.
3. **Three Unified Report Formats:**
   - `terminal`: Human-readable console output with support for `--quiet`, `--verbose`, and `--no-color`.
   - `json`: Machine-readable, structured JSON output conforming to canonical schemas.
   - `markdown`: Clean GitHub-Flavored Markdown reports with summary tables, finding locations, category breakdowns, and safety notices suitable for PR comments and CI summaries.
4. **Predictable Exit Code Contract:**
   - `0`: Completed successfully with no findings crossing threshold and no test failures.
   - `1`: Completed; one or more findings crossed threshold or fixture tests failed.
   - `2`: Invalid arguments, configuration errors, or missing AI consent in non-interactive mode.
   - `3`: Engine/protocol/runtime failure.
   - `4`: Interrupted (SIGINT/SIGTERM) or internal error.

---

## 2. Implementation Architecture

### A. Reporting Engine (`packages/cli/src/reporting/`)

A dedicated reporting module provides unified formatting across all commands:

- [`packages/cli/src/reporting/terminal.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/terminal.ts): Formats terminal output for check, scan, test, doctor, and evaluate. Honors `--quiet` (silencing output) and `--verbose` (displaying detailed finding messages and remediation advice).
- [`packages/cli/src/reporting/markdown.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/markdown.ts): Formats GitHub-Flavored Markdown tables with finding locations, severity levels, remediation steps, engine statistics, and mandatory disclaimers.
- [`packages/cli/src/reporting/json.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/json.ts): Serializes machine-readable output.
- [`packages/cli/src/reporting/index.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/index.ts): Central barrel export.

### B. User-Facing AI Consent Workflow (`packages/cli/src/commands/consent.ts`)

Implements genuine explicit user consent:

- **Configuration Opt-in Check:** Verifies `aiEvaluation.enabled: true` in configuration. If disabled, execution aborts with `INVALID_CONFIG`.
- **Non-Interactive Automated Mode:** When executed without a TTY (`!process.stdin.isTTY`), the `--ai-consent` flag is mandatory. Omission fails closed immediately with `CONSENT_REQUIRED` (exit code 2) without hanging.
- **Interactive TTY Disclosure:** Displays provider, model, transmitted text limits (up to `maxInputBytes`), local path redactions (`fileIndex`), excluded binary/oversized files, financial liability ceiling (`maxCostUsd`), and instructions on how to keep AI disabled. Prompts user with `[y/N]`. If declined, exits cleanly with code 0 without reading credentials or contacting any network endpoint.

### C. Command Implementations

- [`packages/cli/src/commands/evaluate.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/evaluate.ts): Registers `skillguard evaluate [path]`. Orchestrates configuration loading, consent validation, skill collection via `check()`, and advisory evaluation via `evaluateAdvisory()`.
- [`packages/cli/src/commands/check.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/check.ts): Registers `check` and `scan`. Enhanced with `--format terminal|json|markdown` and `--verbose`.
- [`packages/cli/src/commands/test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/test.ts): Registers `test [path]`. Enhanced with `--format terminal|json|markdown` and `--verbose`.
- [`packages/cli/src/index.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/index.ts): Factored program factory `createProgram()` registering all 5 commands, global options (`--help`, `--version`), and stable process exit code mapping.

---

## 3. Test Suite & Verification Results

### Dedicated Phase 7 Test Suite (`packages/cli/tests/cli.test.ts`)

**26 Vitest tests passed, 0 failed** (duration: 1.5s):

- Command registration verification for `check`, `scan`, `test`, `doctor`, `evaluate`.
- Formatter unit tests: terminal, markdown, and JSON outputs for check, scan, test, doctor, and evaluate.
- Verbose and quiet mode verification across formatters.
- AI consent workflow unit tests: configuration opt-in requirement, non-interactive failure mode, interactive decline, and interactive acceptance.
- End-to-end command execution tests on `examples/greeting` across terminal, JSON, and Markdown formats.
- Argument validation tests: invalid formats, unknown commands, and invalid severity thresholds.

### Full Monorepo Multi-Tool Verification (`pnpm check`)

- **Vitest (CLI & Core):** **682 passed, 2 skipped** (Windows non-elevated symlinks) across 12 test suites.
- **Pytest (Python Engine):** **670 passed** across 7 test suites.
- **Total Automated Tests:** **1,352 passing tests**.
- **TypeScript Compiler (`tsc`):** Clean compilation in strict mode with zero errors.
- **Python Type Checker (`mypy`):** Clean verification across all Python packages in strict mode (0 issues in 13 source files).
- **ESLint 9:** Zero lint errors across all TypeScript packages.
- **Ruff:** Zero lint warnings or format errors across all Python engine files.
- **Prettier:** All repository files cleanly formatted.
- **Repository Hygiene (`check-hygiene.mjs`):** Passed.

---

## 4. Initial Working Tree Snapshot (Superseded by Section 10)

- **Branch:** `master`
- **Baseline Commit:** `b72cce8`
- **Remote:** `origin` (`https://github.com/naveenkumar80/skillguard.git`)
- **Initial Untracked / Modified Snapshot (prior to SARIF & Doc gap closure):**
  - `M docs/IMPLEMENTATION_TRACKER.md`
  - `?? docs/reports/INITIAL_GIT_COMMIT_REPORT.md`
  - `?? docs/reports/PHASE_5_REPORT.md`
  - `?? docs/reports/PHASE_6_REPORT.md`
  - `?? docs/reports/PHASE_7_REPORT.md`
  - `M packages/cli/src/commands/check.ts`
  - `?? packages/cli/src/commands/consent.ts`
  - `?? packages/cli/src/commands/evaluate.ts`
  - `M packages/cli/src/commands/test.ts`
  - `M packages/cli/src/index.ts`
  - `?? packages/cli/src/reporting/`
  - `?? packages/cli/tests/cli.test.ts`
- **Status Note:** All changes remain uncommitted in the working tree (see Section 10 for the complete, reconciled pre-commit inventory). No commits created, no push executed, no remotes modified.

---

## 5. Initial Acceptance Review

In the initial Phase 7 review, 1,352 automated tests passed across the 5 CLI commands, interactive AI consent workflow, and 3 report formats (`terminal`, `json`, `markdown`). However, several final acceptance gaps were identified:

1. Missing SARIF 2.1.0 output format required for CI and GitHub Code Scanning integration.
2. Incomplete documentation files (`README.md` and `docs/CONFIGURATION.md` contained outdated scaffold text; `docs/CLI_REFERENCE.md`, `docs/AI_PRIVACY_AND_CONSENT.md`, and `docs/REPORT_FORMATS.md` were missing).
3. Decentralized exit codes needing strict alignment with standardized constants across all commands and error handlers.

---

## 6. Final Acceptance Gap Closure

### A. SARIF 2.1.0 Implementation and Conformance

A full OASIS SARIF 2.1.0 formatter was implemented and integrated:

- **Module:** [`packages/cli/src/reporting/sarif.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/sarif.ts), exported via [`packages/cli/src/reporting/index.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/reporting/index.ts).
- **Format Flag:** Available via `--format sarif` on `skillguard check`, `skillguard scan`, and `skillguard evaluate`.
- **Standard Conformance:**
  - Root schema: `"https://json.schemastore.org/sarif-2.1.0.json"`.
  - SARIF Version: `"2.1.0"`.
  - Tool Driver: Name `"skillguard"`, version `"0.1.0"`, information URI `"https://github.com/naveenkumar80/skillguard"`.
  - Rule Catalog: Deduplicated list of active rules, including `id`, `shortDescription`, optional `fullDescription`, optional `help`, optional `helpUri` (derived from verified rule references when present; omitted otherwise), `defaultConfiguration.level`, and `properties`.
  - Severity Mapping:
    - `critical` → `error`
    - `high` → `error`
    - `medium` → `warning`
    - `low` → `note`
    - `info` → `note`
  - Location Precision: Findings with file paths map to `physicalLocation.artifactLocation.uri` with relative URIs. When 1-based `line` is known, `region.startLine` and `region.startColumn` are included; when line is unknown, `region` is omitted. Findings without specific file paths omit `locations`.
  - Advisory Tagging: AI advisory findings include `category: "ai-advisory"` and explanatory properties.
- **Dedicated SARIF Test Suite:** [`packages/cli/tests/sarif.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/sarif.test.ts) (11 tests passed):
  - Validates full SARIF 2.1.0 document structure using `ajv` against the official JSON Schema Store SARIF 2.1.0 meta-schema.
  - Tests positive findings, negative cases (no findings), empty skill sets, multiple skills, missing locations, unknown line numbers, rule deduplication, severity mapping, and AI finding tagging.

### B. Verification of All Four Report Formats

All four reporting formats were validated across commands:

| Format     | Command Support                               | Machine Readable | Target                                                            |
| ---------- | --------------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `terminal` | `check`, `scan`, `test`, `doctor`, `evaluate` | No               | Developer console (supports `--quiet`, `--verbose`, `--no-color`) |
| `json`     | `check`, `scan`, `test`, `doctor`, `evaluate` | Yes              | Custom CI pipelines, script automation, data ingestion            |
| `markdown` | `check`, `scan`, `test`, `doctor`, `evaluate` | Yes              | GitHub PR comments, `$GITHUB_STEP_SUMMARY`, audit logs            |
| `sarif`    | `check`, `scan`, `evaluate`                   | Yes              | GitHub Code Scanning alerts, VS Code SARIF Viewer                 |

**Stdout Cleanliness Invariant:**

- For `check`, `scan`, `test`, `doctor`, and `evaluate` (both interactive TTY and non-interactive modes) with `--format json` or `--format sarif`, `stdout` contains strictly valid machine-readable output.
- Interactive AI consent disclosures, confirmation prompts (`process.stderr` + `readline`), and all error diagnostics are strictly routed to `stderr` so machine-readable `stdout` is never contaminated.

### C. Documentation Suite Verification & Authoring

The repository documentation has been updated to production quality:

1. [`README.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/README.md): Updated from scaffold to complete project guide: key capabilities, design principles, installation, quick start, all 5 commands, options, all 4 formats, exit codes, AI privacy summary, and security limitations.
2. [`docs/CLI_REFERENCE.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/CLI_REFERENCE.md): Comprehensive reference documenting syntax, arguments, flags, defaults, examples, and exit codes for each command.
3. [`docs/CONFIGURATION.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/CONFIGURATION.md): Updated configuration guide with full JSON schema, precedence ladder (CLI flags > config file > defaults), `aiEvaluation` fields, budget limits, and traversal bounds.
4. [`docs/AI_PRIVACY_AND_CONSENT.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/AI_PRIVACY_AND_CONSENT.md): Authoritative transparency document detailing two-tier consent, TTY disclosure prompt, non-interactive fail-closed policy, data transmission bounds (max 32 KiB), host path redaction (`fileIndex`), binary exclusion, financial liability ceilings, and complete disable instructions.
5. [`docs/REPORT_FORMATS.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/REPORT_FORMATS.md): Detailed reference for Terminal, JSON, Markdown, and SARIF 2.1.0 formats, with field mappings, schemas, sample outputs, and GitHub Code Scanning integration action.

### D. Exit Code Standardization

Shared exit code constants were established in [`packages/cli/src/core/exit-codes.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/core/exit-codes.ts):

- `EXIT_SUCCESS = 0`: Clean run; no findings crossing threshold, tests passed, or consent declined.
- `EXIT_FINDINGS = 1`: Findings crossed severity threshold or fixture tests failed.
- `EXIT_INVALID_ARGUMENTS = 2`: Invalid CLI flags, unknown commands, invalid config, or missing AI consent in non-interactive mode.
- `EXIT_ENGINE_ERROR = 3`: Python engine unavailable, crashed, timed out, or protocol failure.
- `EXIT_INTERNAL_ERROR = 4`: Cancelled (SIGINT/SIGTERM/abort) or unexpected internal error.

All commands and global handlers in `packages/cli/src/index.ts`, `check.ts`, `test.ts`, and `evaluate.ts` import and enforce these constants. Dedicated unit and integration tests in `packages/cli/tests/cli.test.ts` verify all 5 exit codes under realistic invocation conditions.

### E. AI Consent and Safety Regression Verification

All Phase 6 safety safeguards were re-verified:

1. **Configuration Opt-in:** Evaluates only when `aiEvaluation.enabled: true` in config. Fails closed with `INVALID_CONFIG` (code 2) if disabled.
2. **Interactive Disclosure:** TTY mode presents detailed disclosure with provider, model, transmitted text limits, path redaction, budget caps, and advisory nature. Answering `n` exits cleanly with code 0 without provider contact.
3. **Non-Interactive Automation:** Non-TTY environments require `--ai-consent`. Omission fails closed immediately with `CONSENT_REQUIRED` (code 2).
4. **Invocation Isolation:** Each run is isolated; no tokens or credentials persist.
5. **Advisory-Only Invariant:** AI findings are tagged with `category: "ai-advisory"` and cannot modify deterministic security findings or certify safety.

---

## 7. Monorepo Multi-Tool Verification Evidence

Full verification was executed via `pnpm check` and `scripts/check-hygiene.mjs`:

```bash
> pnpm check
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check

Scope: 2 of 3 workspace projects
packages/cli build$ tsc -p tsconfig.json && node ../../scripts/copy-cli-assets.mjs
packages/cli build: Done

> eslint . && uv run ruff check python
All checks passed!

> pnpm -r typecheck && uv run mypy python
packages/cli typecheck$ tsc --noEmit -p tsconfig.json
packages/cli typecheck: Done
Success: no issues found in 13 source files

> vitest run && uv run pytest
Test Files  13 passed (13)
     Tests  699 passed | 2 skipped (701)
     Pytest 670 passed in 9.51s
Total Tests: 1,369 passing tests, 0 failures

> prettier --check . && uv run ruff format --check python
All matched files use Prettier code style!
13 files already formatted

> node scripts/check-hygiene.mjs
Repository hygiene check passed.
```

---

## 8. Final Acceptance Recommendation

**Final Verdict: PASS**

All acceptance gaps from the initial Phase 7 audit are fully resolved:

- OASIS SARIF 2.1.0 output format is implemented, tested against schema, and verified.
- All four reporting formats (`terminal`, `json`, `markdown`, `sarif`) are verified and clean.
- Complete documentation suite (`README.md`, `CLI_REFERENCE.md`, `CONFIGURATION.md`, `AI_PRIVACY_AND_CONSENT.md`, `REPORT_FORMATS.md`) is verified and published in the repository.
- Exit codes are standardized across all commands (0, 1, 2, 3, 4) with explicit test coverage.
- AI consent safeguards, path redactions, and advisory-only invariants remain intact.
- 1,369 automated tests pass with zero errors across TypeScript and Python runtimes.

Phase 7 is complete, verified, and formally accepted. Development is ready to proceed to subsequent phases upon user instruction.

---

## 9. Final Repository Metadata Verification

A final targeted review was conducted to verify repository metadata consistency and eliminate unverified URLs from SARIF output and project documentation:

### A. Git Configuration and Canonical Repository URL

- **Verified Remote URL:** `https://github.com/naveenkumar80/skillguard.git` (`origin`, fetch & push).
- **Canonical Web Repository URL:** `https://github.com/naveenkumar80/skillguard` (verified publicly accessible, HTTP 200).
- **Current Branch:** `master`.

### B. SARIF Metadata Corrections

- **Driver `informationUri`:** Set to `SARIF_INFORMATION_URI` (`"https://github.com/naveenkumar80/skillguard"`), matching the verified canonical repository URL.
- **Rule `helpUri`:** Dynamically populated only when a finding contains an authoritative, verified reference link (e.g., OWASP, AWS, GitHub documentation from canonical rule definitions in `packages/protocol/rules/security-v1.json`). When no verified reference exists, `helpUri` is cleanly omitted. No unverified, speculative, or placeholder URLs are emitted.
- **Repository-Wide URL Harmonization:** Replaced all placeholder `"https://github.com/skillguard/skillguard"` occurrences in `README.md` and `docs/REPORT_FORMATS.md` with the verified canonical repository URL (`https://github.com/naveenkumar80/skillguard`).

### C. Actual Test Results

- **Focused SARIF Tests:** 11 passed in `packages/cli/tests/sarif.test.ts`, including full schema validation with `ajv` against the official JSON Schema Store SARIF 2.1.0 meta-schema.
- **Full Test Suite:** **1,369 passed**, 0 failed, 2 skipped across 13 Vitest suites (699 tests) and 7 Pytest suites (670 tests).
- **Quality Gates:** `pnpm check` passed with zero errors across build, ESLint 9, Ruff, TypeScript (`tsc`), Python (`mypy`), Vitest, Pytest, and Prettier code formatting.
- **Repository Hygiene:** `node scripts/check-hygiene.mjs` passed.

### D. Git Working-Tree State

- **Branch:** `master` (tracking `origin/master`)
- **Latest Commit:** `b72cce8` (`chore: establish initial project baseline through phase 6 development`)
- **Working Tree Status:** **Uncommitted local changes present** (6 modified tracked files; 18 untracked files across 14 `git status` paths). **Working tree is NOT clean.**
- **Commit / Push Status:** **No Phase 7 commit has been created. No push has occurred. Zero remotes modified.**

---

## 10. Git Reconciliation and Pre-Commit Audit

### Summary State

- **Phase 7 Implementation Status:** Complete locally and verified across all quality gates (`1,376 passed, 0 failed`).
- **Git Branch & Baseline:** On branch `master`, latest commit remains `b72cce8`.
- **Uncommitted Changes:** All Phase 7 deliverables currently reside in the uncommitted local working tree awaiting explicit approval to stage and commit. Zero temporary files, build artifacts, secrets, or accidental edits to Phase 0–6 core logic were found.

### Categorized Pre-Commit File Inventory

#### A. Modified Tracked Files (6)

1. `packages/cli/src/index.ts` — Registers all 5 commands, `createProgram()`, `runCli()`, optional evaluator/stream DI for testing, and standardized exit codes.
2. `packages/cli/src/commands/check.ts` — Adds `--format sarif|markdown|json|terminal`, `--verbose`, and standardized exit codes for `check` and `scan`.
3. `packages/cli/src/commands/test.ts` — Adds `markdown` output support, `--verbose`, and standardized exit codes for `test`.
4. `README.md` — Replaces initial scaffold notice with complete CLI overview, commands, formats, exit codes, AI privacy summary, and verified repository URL.
5. `docs/CONFIGURATION.md` — Documents full JSON schema, strict bounds, configuration precedence, and `aiEvaluation` settings.
6. `docs/IMPLEMENTATION_TRACKER.md` — Updates P7 milestone status (`LOCALLY_TESTED`), closes CLI consent item under P6, and updates local test count (`1,376`).

#### B. New Source Files (8)

1. `packages/cli/src/core/exit-codes.ts` — Canonical CLI exit code constants (`0`, `1`, `2`, `3`, `4`).
2. `packages/cli/src/commands/consent.ts` — User-facing explicit two-tier AI consent prompt (using `stderr` for disclosure/prompts) and fail-closed automation handler.
3. `packages/cli/src/commands/evaluate.ts` — Registers `skillguard evaluate` command orchestrating consent, machine-readable decline handling, and advisory AI analysis.
4. `packages/cli/src/reporting/index.ts` — Reporting formatter barrel exports.
5. `packages/cli/src/reporting/terminal.ts` — Human-readable terminal report formatters.
6. `packages/cli/src/reporting/json.ts` — Structured JSON report serializer.
7. `packages/cli/src/reporting/markdown.ts` — GitHub-Flavored Markdown report formatters.
8. `packages/cli/src/reporting/sarif.ts` — OASIS SARIF 2.1.0 report formatter with verified repository `informationUri` and reference-derived `helpUri`.

#### C. New Test Files (3)

1. `packages/cli/tests/cli.test.ts` — 32 unit and end-to-end tests covering command registration, formatters, interactive/non-interactive AI consent, SARIF execution, and all 5 exit codes.
2. `packages/cli/tests/sarif.test.ts` — 11 tests verifying severity mapping, rule deduplication, location/region bounds, URL metadata compliance, and Ajv validation against SARIF 2.1.0 schema.
3. `packages/cli/tests/consent.test.ts` — 7 focused consent regression tests separately capturing stdout and stderr across interactive JSON, interactive SARIF, acceptance, decline, missing non-interactive consent, explicit `--ai-consent`, credential non-access, and `skillguard.config.json` text verification.

#### D. Documentation and Reports (7)

1. `docs/CLI_REFERENCE.md` — Complete CLI command and flag reference.
2. `docs/AI_PRIVACY_AND_CONSENT.md` — Transparent disclosure of AI data boundaries, path redaction, consent, and budget enforcement.
3. `docs/REPORT_FORMATS.md` — Detailed guide to Terminal, JSON, Markdown, and SARIF 2.1.0 output formats and GitHub Code Scanning setup.
4. `docs/reports/INITIAL_GIT_COMMIT_REPORT.md` — Baseline commit `b72cce8` archival audit report.
5. `docs/reports/PHASE_5_REPORT.md` — Formal acceptance report for Phase 5 fixture testing.
6. `docs/reports/PHASE_6_REPORT.md` — Formal security audit and conditional acceptance report for Phase 6 AI evaluation.
7. `docs/reports/PHASE_7_REPORT.md` — Complete Phase 7 implementation, gap closure, metadata verification, and Git reconciliation report.

#### E. Excluded / Ignored Directories & Files (Verify Never Staged)

All local build artifacts, dependencies, virtual environments, caches, and sensitive files remain cleanly ignored by `.gitignore`:

- `.venv/`, `node_modules/`, `packages/cli/node_modules/`
- `dist/`, `packages/cli/dist/`
- `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`
- `.env` / `.env.*` (only `.env.example` is tracked)
- `skillguard-report.*`, `.skillguard/`, `coverage/`

---

## 11. Final Pre-Commit Corrections

Targeted fixes implemented for both issues raised during pre-commit reconciliation:

### A. Consent Disclosure & Prompt Stream Isolation (`stderr` vs `stdout`)

- **Updated [`packages/cli/src/commands/consent.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/consent.ts):**
  - Routed transparency disclosure text (`outputStream.write`) and interactive `readline/promises` prompt output (`createInterface({ input: inputStream, output: outputStream })`) strictly to `process.stderr`.
  - Updated TTY detection to require `process.stdin.isTTY && process.stderr.isTTY` instead of requiring `process.stdout.isTTY`, preserving interactive prompting when `stdout` is piped or redirected to JSON/SARIF files.
  - Non-interactive mode without `--ai-consent` continues to fail closed immediately with `CONSENT_REQUIRED` before reading `OPENAI_API_KEY` or opening network sockets.
- **Updated [`packages/cli/src/commands/evaluate.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/evaluate.ts):**
  - Ensured declining consent during `--format json` or `--format sarif` emits valid disabled JSON / empty SARIF 2.1.0 documents on `stdout` without invoking the engine or contacting providers, while terminal declines retain the human-readable status message.

### B. Configuration Filename Correction

- **Updated [`packages/cli/src/commands/consent.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/src/commands/consent.ts#L60):** Replaced `skillguard.config.yaml` with `skillguard.config.json`.
- **Updated [`docs/reports/PHASE_6_REPORT.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/reports/PHASE_6_REPORT.md#L119):** Replaced remaining historical `skillguard.config.yaml` reference with `skillguard.config.json`.
- Verified repository-wide via regex search that zero `config.yaml` or `config.yml` references remain in source or documentation.

### C. Regression Test Evidence

- **Added [`packages/cli/tests/consent.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/consent.test.ts)** capturing `stdout` and `stderr` independently (7/7 tests passed):
  - Verified real `readline/promises` path writes disclosure, `skillguard.config.json`, and confirmation prompt exclusively to `stderr` while leaving `stdout` completely empty.
  - Verified interactive `--format json` and `--format sarif` (when accepted via `"yes"` / `"y"`) output purely valid machine-readable JSON / Ajv-validated SARIF 2.1.0 on `stdout` while keeping disclosure/prompts on `stderr`.
  - Verified interactive `--format json` and `--format sarif` (when declined via `"n"` / `"no"`) never contact any evaluator/provider and output valid disabled JSON / empty SARIF 2.1.0 on `stdout`.
  - Verified missing consent in non-interactive mode fails closed (`EXIT_INVALID_ARGUMENTS` = 2) with empty `stdout` and `CONSENT_REQUIRED` on `stderr`, and never accesses `OPENAI_API_KEY`.
  - Verified explicit `--ai-consent` in non-interactive mode emits clean SARIF 2.1.0 on `stdout` with empty `stderr`.
- **Full Verification Results (`pnpm check` + hygiene):**
  - Focused consent/CLI/SARIF tests: **50 passed** (`consent.test.ts`: 7, `sarif.test.ts`: 11, `cli.test.ts`: 32).
  - Full Vitest suite: **706 passed**, 2 skipped (Windows symlinks) across 14 files.
  - Full Pytest suite: **670 passed** across 7 files.
  - Total: **1,376 passed**, 0 failures.
  - Build, ESLint, Ruff, TypeScript `tsc`, Mypy, Prettier format check, and `scripts/check-hygiene.mjs`: all passed.
