# SkillGuard GitHub Composite Action

Run SkillGuard static security scanning, validation checks, and recorded fixture tests inside GitHub Actions workflows without shell interpolation, external AI calls, or network schema fetching.

## Scope & Prerequisites

- **Source-based execution:** This composite action executes directly from a checked-out SkillGuard repository (`./.github/actions/skillguard`). Callers must check out the repository (for example with a SHA-pinned `actions/checkout`) before invoking this action.
- **No published package / Marketplace distribution:** It does not install `skillguard` from npm or PyPI (`npx skillguard` is not used).
- **No AI `evaluate` execution:** The action supports `check`, `scan`, and `test` only. Passing `command: evaluate` fails validation with exit code `2`.
- **No direct SARIF upload from this action:** `upload-sarif` defaults to `"false"` and setting `upload-sarif: "true"` fails validation with exit code `2`. Privileged SARIF uploads (`security-events: write`) must run in a separate job that runs only on trusted default-branch pushes (or explicit default-branch manual runs), never on pull requests, and never checks out or runs repository code.

## Supported Commands

- `scan` — Run specification checks plus Python static security analysis (`skillguard_engine`, requires Python >= 3.11) against target skill files or directories.
- `check` — Run offline SkillGuard specification, structure, and Markdown reference checks (Python not required by CLI core, though `auto` dependency check still verifies runtime readiness unless configured).
- `test` — Run SkillGuard deterministic recorded fixture tests (supports `terminal`, `json`, or `markdown` formats; rejects `--strict`, `--severity-threshold`, and `sarif-file`).

## Inputs

| Input                  | Description                                                                                                                                                | Default    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `command`              | Command to run (`check`, `scan`, or `test`). `evaluate` is disabled.                                                                                       | `scan`     |
| `path`                 | Target skill directory or file path inside the workspace.                                                                                                  | `""`       |
| `config`               | Optional path inside the workspace to a strict UTF-8 JSON (`skillguard.config.json`) configuration file (max 64 KiB). YAML config files are not supported. | `""`       |
| `severity-threshold`   | Minimum finding severity (`info`, `low`, `medium`, `high`, `critical`) (`check`/`scan`).                                                                   | `""`       |
| `strict`               | Treat any deterministic finding at `info` or above as failing (`"true"` or `"false"`) (`check`/`scan`).                                                    | `"false"`  |
| `format`               | Output format (`terminal`, `json`, `markdown`, or `sarif`; `test` omits `sarif`).                                                                          | `terminal` |
| `sarif-file`           | Workspace-relative path to write validated SARIF 2.1.0 output (`check`/`scan`).                                                                            | `""`       |
| `step-summary`         | Write a sanitized Markdown summary to `$GITHUB_STEP_SUMMARY` (`"true"` or `"false"`).                                                                      | `"true"`   |
| `upload-sarif`         | Reserved flag; must remain `"false"` in this action step.                                                                                                  | `"false"`  |
| `quiet`                | Suppress secondary terminal noise (`"true"` or `"false"`).                                                                                                 | `"false"`  |
| `verbose`              | Emit verbose diagnostics (`"true"` or `"false"`).                                                                                                          | `"false"`  |
| `install-dependencies` | Dependency setup policy (`"auto"`, `"true"`, or `"false"`).                                                                                                | `"auto"`   |
| `node-version`         | Node.js version (`>= 22`) installed when setup is required.                                                                                                | `"22"`     |
| `python-version`       | Python version (`>= 3.11`) installed when setup is required.                                                                                               | `"3.11"`   |

## Outputs

| Output              | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `exit-code`         | Exact exit code produced by SkillGuard or input/artifact validation (`0`–`4`).                 |
| `sarif-file`        | Validated workspace-relative SARIF file path when written, or empty string.                    |
| `sarif-valid`       | `"true"` if SARIF output passed full OASIS SARIF 2.1.0 schema validation; otherwise `"false"`. |
| `sarif-has-results` | `"true"` if validated SARIF output contains one or more results; otherwise `"false"`.          |

## Exit Codes

| Exit Code | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `0`       | Success; no failing findings at or above threshold.              |
| `1`       | Security findings or failing check/test threshold breached.      |
| `2`       | Invalid action arguments, disallowed options, or unsafe paths.   |
| `3`       | Engine unavailable or runtime execution failure.                 |
| `4`       | Internal error, unexpected subprocess termination, or bad SARIF. |

## Security Controls

- **Pure Env-Bound Inputs:** All GitHub Action inputs in `action.yml` pass strictly through step `env:` variables rather than `${{ inputs.* }}` shell interpolation inside `run:` blocks.
- **No Shell Execution & Option Injection Defense:** `run.mjs` invokes Node and the SkillGuard CLI via literal argument arrays with `shell: false`, rejects leading `-` on `path`/`config`, and passes positional targets after `--`.
- **Workspace Path Boundaries:** `path`, `config`, and `sarif-file` are resolved against the canonical workspace root. Parent traversal (`..`), UNC/network share paths (`\\`, `//`), non-native or drive-relative Windows drive paths, external absolute paths, dangling/looping symlinks, and symlinks escaping the canonical workspace are rejected with exit code `2`. Valid nested paths and paths with spaces inside the workspace remain supported.
- **Environment Isolation:** The CLI subprocess environment uses a strict allowlist (`PATH`, `SYSTEMROOT`, `WINDIR`, `SYSTEMDRIVE`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`, `LC_ALL`, `SKILLGUARD_PYTHON`) and strips `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, and all non-allowlisted secrets.
- **Offline OASIS SARIF 2.1.0 Schema Validation:** SARIF output is validated both in memory and after disk write against the locally pinned official OASIS SARIF 2.1.0 errata01 JSON Schema (`.github/actions/skillguard/schemas/sarif-schema-2.1.0.json`) using Ajv (`ajv-draft-04` + `ajv-formats`) with zero network schema loading, a `<= 10 MiB` byte limit, non-empty `runs` / `tool.driver.name` enforcement, symlink/junction blocking, `O_NOFOLLOW` writes, and stale file cleanup on error.
- **Redacted Summaries:** Markdown step summaries and stderr diagnostics redact runner/workspace host paths and common secret patterns, and escape Markdown table metacharacters.
- **Reproducible Bootstrap:** When setup is required (`install-dependencies: auto` or `true`), `action.yml` checks requested `node-version` (`>= 22`) and `python-version` (`>= 3.11`), CLI + `regex-worker.mjs` build outputs, `@skillguard/cli` runtime dependencies (including `ajv-draft-04` and `ajv-formats`), `.venv` `jsonschema`/`skillguard_engine` imports, and an isolated PEP 668-safe `uv==0.11.28` bootstrap.

## Security Limitations

- Local `.github/actions/skillguard` execution requires a checked-out SkillGuard repository or built workspace until package distribution is approved in a later phase.
- On Windows without Developer Mode, OS-level symlink creation restrictions may limit local symlink traversal unit tests while runtime symlink defense checks remain active.

## Example Usage (Local Repository)

```yaml
jobs:
  skillguard-scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Run SkillGuard scan
        id: skillguard
        uses: ./.github/actions/skillguard
        with:
          command: scan
          path: examples/greeting
          format: sarif
          sarif-file: reports/skillguard.sarif
          severity-threshold: high
          strict: "true"
```
