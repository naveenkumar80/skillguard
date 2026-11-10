# Cross-Platform CI Portability Fix Report (P0)

- **Date:** 2026-11-10
- **Baseline Commit:** `234fa51c76f8ca10b850bd296a7c34f7f06d5651` (`master`)
- **Failed Hosted Reference Run:** `https://github.com/naveenkumar80/skillguard/actions/runs/42781198016`
- **Status:** Implemented locally and verified across unit, integration, `pnpm check`, hygiene, and disposable `core.autocrlf=true` clone checks. Pending commit review and hosted CI confirmation across `ubuntu-latest`, `macos-latest`, and `windows-latest`.

---

## 1. Root Causes Addressed

### Issue 1 — Ubuntu & macOS Python Path Failure

- **Cause:** [`packages/cli/tests/cli.test.ts` line 33](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/cli.test.ts#L33) hardcoded `resolve(".venv/Scripts/python.exe")`, which only exists on Windows (`uv sync --locked` creates `.venv/bin/python` on Ubuntu and macOS). That caused four integration tests (`doctor`, `scan`, `scan --format sarif`, and `EXIT_SUCCESS` doctor test) to fail with `ENGINE_UNAVAILABLE`.
- **Previous Duplication:** [`packages/cli/tests/engine-integration.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/engine-integration.test.ts) and [`packages/cli/tests/security-integration.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/security-integration.test.ts) implemented separate `process.platform` checks inline.

### Issue 2 — Windows Prettier Line-Ending Failure

- **Cause:** All 158 tracked repository files are stored with `LF` (`i/lf`) and [`.editorconfig`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/.editorconfig) enforces `end_of_line = lf` (matching Prettier's default `endOfLine: "lf"`). Because no `.gitattributes` file existed and Git for Windows defaults to `core.autocrlf=true` on `windows-latest`, `actions/checkout` checked out text files with `CRLF` (`w/crlf`), failing `prettier --check .` on all 112 Prettier-checked files.

---

## 2. Files Changed

| File                                                                                                                                                                | Change   | Purpose                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/cli/tests/helpers/python.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/helpers/python.ts)                       | Created  | Single shared cross-platform Python interpreter resolver (`SKILLGUARD_PYTHON` override + OS `.venv` detection + actionable missing-binary diagnostics).                     |
| [`packages/cli/tests/python-helper.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/python-helper.test.ts)               | Created  | 7 unit and host-filesystem tests covering Windows, Linux/macOS, `SKILLGUARD_PYTHON` path/PATH overrides, missing binary errors, NUL/empty validation, and spaced paths.     |
| [`packages/cli/tests/cli.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/cli.test.ts)                                   | Modified | Replaced hardcoded `.venv/Scripts/python.exe` with `resolveTestPython()`.                                                                                                   |
| [`packages/cli/tests/engine-integration.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/engine-integration.test.ts)     | Modified | Replaced duplicated inline `fileURLToPath` block with `resolveTestPython()`.                                                                                                |
| [`packages/cli/tests/security-integration.test.ts`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/packages/cli/tests/security-integration.test.ts) | Modified | Replaced duplicated inline `fileURLToPath` block with `resolveTestPython()`.                                                                                                |
| [`.gitattributes`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/.gitattributes)                                                                   | Created  | Enforces `eol=lf` for repository text files, preserves `eol=crlf` for `.bat`/`.cmd` if added, and explicitly guards binary extensions (`binary`).                           |
| [`docs/IMPLEMENTATION_TRACKER.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/IMPLEMENTATION_TRACKER.md)                                   | Modified | Recorded `.gitattributes`, `helpers/python.ts`, and `python-helper.test.ts` under `P0-05` (retaining `LOCALLY_TESTED` status) and updated total local test count (`1,383`). |
| [`docs/reports/CROSS_PLATFORM_CI_FIX_REPORT.md`](file:///c:/Users/navee/Downloads/skillguard-starter/skillguard/docs/reports/CROSS_PLATFORM_CI_FIX_REPORT.md)       | Created  | This verification and audit report.                                                                                                                                         |

_(Zero workflow YAML files, Prettier configs, ESLint rules, lockfiles, or production CLI source files were modified.)_

---

## 3. Design Decisions

1. **Single Shared Test Resolver (`resolveTestPython`):**
   - Precedence: explicit `SKILLGUARD_PYTHON` environment variable (rejecting NUL bytes or blank strings; checking file existence for path-like values and `PATH` resolution for bare command names) > project `.venv` resolved relative to repository root derived from `import.meta.url` (independent of `process.cwd()`).
   - Selects `.venv/Scripts/python.exe` on `win32` and `.venv/bin/python` on POSIX (`linux`/`darwin`), using platform-matched `win32` / `posix` path utilities so cross-platform unit tests behave deterministically on any host OS.
   - Fails immediately with an explicit, actionable diagnostic message referencing missing paths or `uv sync --locked`.
   - Zero shell execution; existing `client.ts` security controls (`shell: false`, `cwd: tmpdir()`, env allowlist) remain intact.

2. **Conservative `.gitattributes` Policy:**
   - `* text=auto eol=lf` combined with explicit LF rules for repository text extensions (`*.ts`, `*.js`, `*.mjs`, `*.cjs`, `*.py`, `*.json`, `*.md`, `*.yml`, `*.yaml`, `*.toml`, `*.lock`, `*.txt`, `*.sh`).
   - Explicit `*.bat text eol=crlf` and `*.cmd text eol=crlf` exceptions for Windows batch scripts.
   - Explicit `binary` attributes for image, archive, package, and executable binary extensions (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.ico`, `*.pdf`, `*.zip`, `*.gz`, `*.tgz`, `*.tar`, `*.whl`, `*.bin`, `*.exe`, `*.dll`, `*.so`, `*.dylib`, `*.wasm`).
   - Checked all 158 existing tracked files: 0 contain NUL bytes, all 158 use `i/lf` in the Git index, and none require CRLF.

---

## 4. Verification Results

### Focused Resolver & Integration Suites

Executed `npx vitest run packages/cli/tests/python-helper.test.ts packages/cli/tests/cli.test.ts packages/cli/tests/engine-integration.test.ts packages/cli/tests/security-integration.test.ts`:

- `python-helper.test.ts`: **7 passed**
- `cli.test.ts`: **32 passed**
- `security-integration.test.ts`: **9 passed**
- `engine-integration.test.ts`: **4 passed**
- **Total Focused:** **52 passed** across 4 test files.

### Disposable Clone Verification (`core.autocrlf=true`)

Simulated Windows CI checkout in an isolated temporary clone with `git -c core.autocrlf=true clone` containing the proposed `.gitattributes`, test changes, and a synthetic binary asset (`tests/fixtures/synthetic-binary.png` containing `\r\n` and `\x00` bytes):

- Tracked files checked in disposable clone: **162**
- Text files checked out with CRLF (`w/crlf`): **0** (all text files checked out as `w/lf`)
- Binary asset classification (`git ls-files --eol`): `i/-text w/-text attr/-text`
- Binary asset SHA-256 verification: Exact byte-for-byte match (`6092d74b1a223be6bfbf14c52d1db8dd5f6169061547f3b7ded8009a9b8b1dc4`, `\r\n` preserved)
- Prettier check (`prettier --check .` inside disposable `core.autocrlf=true` clone): **Exit code 0 — `All matched files use Prettier code style!`** (resolving the prior 112-file Windows CI failure).

### Full Local Quality Gate (`pnpm check` + `check-hygiene.mjs`)

- `node scripts/check-hygiene.mjs`: Passed (`Repository hygiene check passed.`).
- `npx pnpm check`: Exit code `0`:
  - `pnpm -r build`: Done
  - `eslint . && uv run ruff check python`: All checks passed
  - `pnpm -r typecheck && uv run mypy python`: Clean (`Success: no issues found in 13 source files`)
  - Vitest: **15 test files passed**, **713 passed**, 2 skipped (Windows non-elevated symlink privilege tests)
  - Pytest: **670 passed**
  - **Total Automated Tests:** **1,383 passed**, 0 failed
  - `prettier --check . && uv run ruff format --check python`: Clean

---

## 5. Remaining Limitations & Readiness

- **Hosted Runner Confirmation Required:** Ubuntu and macOS `.venv/bin/python` execution paths were tested via host-independent unit mocks (`resolveTestPython`) and static inspection (`import.meta.url`), while real subprocess invocation ran on this Windows host. Live hosted execution across `ubuntu-latest`, `macos-latest`, and `windows-latest` in GitHub Actions is still required after commit review/push before promoting `P0-05` to `HOSTED_CI_VERIFIED`.
- **Commit Readiness:** Changes are strictly scoped, verified, clean under `git diff --check`, and **ready for a separate commit review**.
