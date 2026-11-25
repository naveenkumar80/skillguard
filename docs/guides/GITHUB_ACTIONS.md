# SkillGuard GitHub Actions Integration Guide

This guide documents the official GitHub Actions integration for SkillGuard. It explains how to incorporate automated agent skill specification checking, static security scanning, and recorded fixture testing into your continuous integration (CI) workflows.

---

## Table of Contents

1. [Overview & Design Principles](#1-overview--design-principles)
2. [Quickstart Workflow](#2-quickstart-workflow)
3. [Supported Commands](#3-supported-commands)
4. [Action Inputs Reference](#4-action-inputs-reference)
5. [Action Outputs Reference](#5-action-outputs-reference)
6. [Exit Codes Reference](#6-exit-codes-reference)
7. [Security Architecture & Path Boundaries](#7-security-architecture--path-boundaries)
8. [SARIF & Trusted Code Scanning Upload Policy](#8-sarif--trusted-code-scanning-upload-policy)
9. [Job Step Summaries](#9-job-step-summaries)
10. [Example Workflows](#10-example-workflows)
11. [Security Limitations & Troubleshooting](#11-security-limitations--troubleshooting)

---

## 1. Overview & Design Principles

The SkillGuard GitHub Action (`.github/actions/skillguard`) provides a secure, reusable composite action designed for enterprise CI/CD environments.

Key design principles:

- **Strict Offline Operation:** SkillGuard executes static analyses locally without sending skill content, prompts, or metadata to external AI services, cloud backends, or remote schema hosts.
- **Subprocess Safety:** All subprocesses execute via direct argument vectors (`shell: false`). User inputs are bound via step environment variables (`INPUT_*`) and never undergo shell parameter expansion or `${{ inputs.* }}` interpolation.
- **CLI Option Injection & Path Boundary Defense:** `path` and `config` inputs are validated against leading hyphens, control characters, UNC paths, external Windows drive paths, parent directory traversal (`..`), and symlinks escaping the canonical workspace before being passed behind an explicit `--` terminator.
- **Environment Isolation:** Ambient environment variables are sanitized through an explicit allowlist. API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and repository tokens (`GITHUB_TOKEN`, `GH_TOKEN`) are stripped before invoking the CLI subprocess.
- **Full Offline OASIS SARIF 2.1.0 Schema Validation:** SARIF outputs are validated both in memory and after disk write against the locally pinned official OASIS SARIF 2.1.0 errata01 JSON Schema via `ajv-draft-04` and `ajv-formats`, enforcing a 10 MiB limit and zero network schema loading.
- **Zero PR Write Exposure:** Pull request workflows (both external fork PRs and same-repository PRs) execute strictly with read-only permissions (`contents: read`) and never trigger privileged SARIF upload jobs.

---

## 2. Quickstart Workflow

Create `.github/workflows/skillguard.yml` in your repository:

```yaml
name: SkillGuard

on:
  push:
    branches: [main, master]
  pull_request:

permissions:
  contents: read

jobs:
  validate:
    name: Check & Scan Skills
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Validate skill specification
        uses: naveenkumar80/skillguard/.github/actions/skillguard@master
        with:
          command: check
          path: .
          step-summary: true

      - name: Scan skills for security risks
        uses: naveenkumar80/skillguard/.github/actions/skillguard@master
        with:
          command: scan
          path: .
          severity-threshold: high
          step-summary: true
```

---

## 3. Supported Commands

The action supports three core offline CLI commands:

| Command | Description                                                                                                            | Supported Formats                       |
| :------ | :--------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| `check` | Validates `SKILL.md` frontmatter, schema adherence, directory naming, and local file references.                       | `terminal`, `json`, `markdown`, `sarif` |
| `scan`  | Runs specification checks plus offline Python static security scanning (`skillguard_engine`, requires Python >= 3.11). | `terminal`, `json`, `markdown`, `sarif` |
| `test`  | Evaluates assertions against recorded fixture runs defined in `skillguard.tests.yaml`.                                 | `terminal`, `json`, `markdown`          |

> [!NOTE]
> The `evaluate` command (which performs live LLM evaluation) is intentionally disabled in the GitHub Action runner to guarantee deterministic, offline execution and eliminate network and token exfiltration risks. Passing `command: evaluate` fails fail-closed with exit code `2`.

---

## 4. Action Inputs Reference

| Input                  | Required |  Default   | Description                                                                                                   |
| :--------------------- | :------: | :--------: | :------------------------------------------------------------------------------------------------------------ |
| `command`              |    No    |   `scan`   | SkillGuard command to run: `check`, `scan`, or `test`.                                                        |
| `path`                 |    No    |    `""`    | Target skill directory or file path inside the workspace.                                                     |
| `config`               |    No    |    `""`    | Optional path inside the workspace to strict UTF-8 JSON `skillguard.config.json` (max 64 KiB).                |
| `severity-threshold`   |    No    |    `""`    | Minimum finding severity causing non-zero exit (`check`/`scan`): `info`, `low`, `medium`, `high`, `critical`. |
| `strict`               |    No    | `"false"`  | When `"true"`, any deterministic finding causes a non-zero exit code (`check`/`scan`).                        |
| `format`               |    No    | `terminal` | Output format: `terminal`, `json`, `markdown`, or `sarif` (`test` omits `sarif`).                             |
| `sarif-file`           |    No    |    `""`    | Destination workspace-relative path for OASIS SARIF 2.1.0 validated output (`check`/`scan`).                  |
| `step-summary`         |    No    |  `"true"`  | Appends a sanitized Markdown summary table to `$GITHUB_STEP_SUMMARY`.                                         |
| `upload-sarif`         |    No    | `"false"`  | Reserved flag; must remain `"false"` (passing `"true"` fails closed with exit code `2`).                      |
| `quiet`                |    No    | `"false"`  | Suppresses secondary terminal output noise.                                                                   |
| `verbose`              |    No    | `"false"`  | Enables verbose diagnostic output when supported.                                                             |
| `install-dependencies` |    No    |  `"auto"`  | Dependency setup mode: `"auto"` (install if missing), `"true"` (force setup), or `"false"`.                   |
| `node-version`         |    No    |   `"22"`   | Node.js version (`>= 22`) installed when setup is required.                                                   |
| `python-version`       |    No    |  `"3.11"`  | Python version (`>= 3.11`) installed when setup is required.                                                  |

---

## 5. Action Outputs Reference

| Output              |      Type      | Description                                                                                   |
| :------------------ | :------------: | :-------------------------------------------------------------------------------------------- |
| `exit-code`         | integer string | Process exit code (`0`, `1`, `2`, `3`, or `4`).                                               |
| `sarif-file`        |     string     | Safe relative path of the generated SARIF file, or empty string if not generated.             |
| `sarif-valid`       | boolean string | `"true"` if SARIF output passed full OASIS SARIF 2.1.0 schema and size validation; `"false"`. |
| `sarif-has-results` | boolean string | `"true"` if valid SARIF contains one or more findings; otherwise `"false"`.                   |

---

## 6. Exit Codes Reference

SkillGuard follows a strictly codified exit code contract across all environments:

| Code | Constant                 | Meaning                                                                      | Action Behavior                                 |
| :--: | :----------------------- | :--------------------------------------------------------------------------- | :---------------------------------------------- |
| `0`  | `EXIT_SUCCESS`           | Clean run; no findings at or above configured threshold, all tests passed.   | Step passes.                                    |
| `1`  | `EXIT_FINDINGS`          | Validation findings detected, threshold exceeded, or test assertions failed. | Step fails; summary rendered.                   |
| `2`  | `EXIT_INVALID_ARGUMENTS` | Invalid CLI options, nonexistent paths, or workspace boundary violation.     | Step fails with diagnostic message.             |
| `3`  | `EXIT_ENGINE_ERROR`      | Python analysis engine missing, inaccessible, or failed to start.            | Step fails with setup remediation instructions. |
| `4`  | `EXIT_INTERNAL_ERROR`    | Malformed CLI output, SARIF schema violation, or internal runner failure.    | Step fails with fallback summary; fails closed. |

---

## 7. Security Architecture & Path Boundaries

### Subprocess & Environment Isolation

- All CLI processes execute via `spawnSync(..., { shell: false })`.
- Inputs pass exclusively via `env:` bindings into `run.mjs`; direct `${{ inputs.* }}` shell interpolation is prohibited.
- Child process environments filter through a strict allowlist: `PATH`, `SYSTEMROOT`, `WINDIR`, `SYSTEMDRIVE`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`, `LC_ALL`, `SKILLGUARD_PYTHON`. Repository tokens (`GITHUB_TOKEN`, `GH_TOKEN`) and AI keys are stripped.

### Strict Workspace Path Boundaries (`path`, `config`, `sarif-file`)

All user-supplied paths are resolved against the canonical workspace root (`realpathSync(workspaceRoot)`):

- **Rejected:** Leading hyphens (`-`), control characters (`\r`, `\n`, `\0`), parent directory traversal (`..`), UNC/network share paths (`\\...`, `//...`), Windows drive paths on POSIX or drive-relative paths (`C:foo`), external absolute paths outside the workspace, broken/looping symlinks, and any symlink in the path chain resolving outside the canonical workspace.
- **SARIF Target Strictures:** `sarif-file` additionally rejects all symlinks and junctions (even intra-workspace), root `.` or directory targets, and opens files with `O_NOFOLLOW` checks before unlinking any stale output on error.
- **Preserved:** Valid nested workspace paths and paths containing spaces (for example `skills/my cool skill/SKILL.md` or `configs/my config.json`).

### Python Runtime & Dependency Installation

- `scan` requires Python `>= 3.11` with `skillguard_engine` and `jsonschema` installed (resolved automatically from `.venv/bin/python` or `.venv\Scripts\python.exe` unless overridden by `SKILLGUARD_PYTHON`).
- When `install-dependencies: auto` detects missing CLI builds, dependencies, or `.venv`, it bootstraps a pinned `uv==0.11.28` inside an isolated virtual environment under `$RUNNER_TEMP`, installs lockfile-verified npm and Python dependencies, and builds `@skillguard/cli`.

---

## 8. SARIF & Trusted Code Scanning Upload Policy

### Offline OASIS SARIF 2.1.0 JSON Schema Validation

SkillGuard validates every SARIF document against the locally pinned official OASIS SARIF 2.1.0 errata01 JSON Schema (`.github/actions/skillguard/schemas/sarif-schema-2.1.0.json`) via Ajv (`ajv-draft-04` and `ajv-formats`):

1. Enforces UTF-8 JSON parsing, a 10 MiB maximum size ceiling, `version === "2.1.0"`, explicit SARIF 2.1.0 `$schema` reference, and non-empty `runs` array with `tool.driver.name` and `results`.
2. Validates the entire document structure, property types, enums, formats (`uri`, `uri-reference`, `date-time`), and forbidden `additionalProperties` offline with zero remote schema fetching.
3. Re-validates the written file on disk (`validateSarifFile`), automatically cleaning up stale files if validation fails.

### Trusted Upload Architecture (No Pull Request Write Scope)

Pull request events—including **same-repository pull requests**—can modify workflow files, build scripts, or tests, so PR validation runs strictly read-only (`contents: read`) and never receives `security-events: write`.

Privileged SARIF uploads are isolated into a separate job with these mandatory invariants:

- Trigger guard restricts execution to trusted pushes (or explicit manual runs) strictly on the protected default branch (e.g., `github.ref == 'refs/heads/master' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')`).
- Consumes a deterministically named artifact (`skillguard-sarif-${{ github.run_id }}-${{ github.run_attempt }}`) produced by the unprivileged validation job.
- **Zero repository code execution in the upload job:** Does not invoke `actions/checkout`, dependency installers, build scripts, or SkillGuard itself—only `actions/download-artifact` and `github/codeql-action/upload-sarif`.
- `pull_request_target` is never used.

```yaml
jobs:
  validate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Run SkillGuard Scan
        id: sg
        uses: naveenkumar80/skillguard/.github/actions/skillguard@master
        with:
          command: scan
          path: .
          format: sarif
          sarif-file: results.sarif

      - name: Archive validated SARIF artifact
        if: >-
          always() &&
          steps.sg.outputs.sarif-valid == 'true' &&
          github.ref == 'refs/heads/master' &&
          (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: skillguard-sarif-${{ github.run_id }}-${{ github.run_attempt }}
          path: results.sarif
          retention-days: 7
          if-no-files-found: error

  upload-sarif:
    name: Upload SARIF to Code Scanning
    needs: [validate]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    if: >-
      !cancelled() &&
      github.ref == 'refs/heads/master' &&
      (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          name: skillguard-sarif-${{ github.run_id }}-${{ github.run_attempt }}
          path: sarif-upload
      - uses: github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066 # v4
        with:
          sarif_file: sarif-upload/results.sarif
          category: skillguard
```

---

## 9. Job Step Summaries

When `step-summary: true` (the default), SkillGuard writes an escaped, host-path-redacted and token-redacted Markdown summary table directly to `$GITHUB_STEP_SUMMARY`. On CLI/engine failures (exit codes `2`, `3`, or `4`), a fail-safe fallback summary reports the diagnostic category cleanly.

---

## 10. Example Workflows

- [`examples/workflows/skillguard.yml`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/examples/workflows/skillguard.yml) — Production starter workflow enforcing PR read-only isolation and trusted artifact upload. Note that `@master` in this example is a mutable branch reference; external callers should replace it with an immutable full 40-character commit SHA once an approved commit exists.
- [`.github/workflows/skillguard.yml`](file:///C:/Users/navee/Downloads/skillguard-starter/skillguard/.github/workflows/skillguard.yml) — Three-OS dogfooding workflow verifying positive checks, negative fixture assertions, and trusted `master` SARIF upload. In this workflow, the `upload-sarif` job uploads the clean zero-findings `examples/greeting` SARIF report (`results-greeting.sarif`) as an **upload-pipeline smoke test** rather than uploading negative-fixture findings; negative findings are exercised and asserted inside the read-only `validate` matrix.

---

## 11. Security Limitations & Troubleshooting

### Security Limitations

- **Buffered CLI Execution Limits:** `run.mjs` caps CLI stdio buffering at `16 MiB` (`MAX_CLI_BUFFER_BYTES`) and SARIF artifacts at `10 MiB` (`MAX_SARIF_BYTES`), and relies on workflow job `timeout-minutes` plus CLI engine/regex timeouts rather than a separate `spawnSync` timeout parameter.
- Hosted GitHub Actions execution verification occurs when pushed to GitHub; local tests verify action runner invariants and YAML workflow structure.
- Windows runners without Developer Mode deny unprivileged symlink creation at the OS level, skipping OS symlink-creation tests while runtime boundary protections remain enforced.
- Repository-local action invocation (`./.github/actions/skillguard`) requires a checked-out workspace with lockfile dependencies, and `@master` references in external examples are mutable until pinned to an approved commit SHA.

### Q: Why does the action fail with exit code 3 (`ENGINE_UNAVAILABLE`)?

Ensure `python-version: "3.11"` (or higher) is available and `install-dependencies: auto` (or manual `.venv` setup with `SKILLGUARD_PYTHON`) has installed `skillguard_engine` and `jsonschema`.

### Q: Why does `upload-sarif` stay skipped on Pull Requests?

By design: `pull_request` events (including same-repo PRs) cannot run `security-events: write`. PRs validate skills and publish findings in the read-only GitHub Job Step Summary without writing to Code Scanning alerts until merged into the protected default branch.
