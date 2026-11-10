# SkillGuard CLI Reference

`skillguard` is the command-line interface for the Agent Skill Assurance toolkit. It validates skill structure and metadata, validates references and resource integrity, scans for security risks, runs fixture assertions, checks engine diagnostics, and performs optional AI-assisted advisory evaluations.

---

## Global Syntax and Options

```bash
skillguard <command> [path] [options]
```

### Global Options

| Option          | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `-V, --version` | Output the version number (`0.1.0`). Exits with code `0`.     |
| `-h, --help`    | Display help for command or overall CLI. Exits with code `0`. |

---

## Commands

### 1. `skillguard check`

Validate Agent Skills for specification conformance and resource/reference integrity without executing code or calling the Python engine.

```bash
skillguard check [path] [options]
```

#### Arguments

- `[path]` _(optional)_: Path to skill directory or directory containing skills. Defaults to paths configured in `skillguard.config.json` (or `./skills`).

#### Options

- `--config <file>`: Path to custom UTF-8 JSON configuration file (max 64 KiB).
- `--python <executable>`: Accepted by shared option parser (Python is not invoked in `check` mode).
- `--format <format>`: Output format: `terminal`, `json`, `markdown`, or `sarif` (default: `terminal`).
- `--strict`: Fail on any deterministic finding regardless of severity threshold.
- `--severity-threshold <level>`: Minimum severity to trigger failure: `info`, `low`, `medium`, `high`, `critical` (default: `high`).
- `--quiet`: Suppress terminal output; preserve machine-readable JSON, Markdown, or SARIF.
- `--verbose`: Show detailed finding messages and remediation advice.
- `--no-color`: Disable terminal colors.

#### Exit Codes

- `0` (`EXIT_SUCCESS`): All skills are valid and no findings meet the failure threshold.
- `1` (`EXIT_FINDINGS`): One or more findings meet or exceed the severity threshold, or `--strict` was set.
- `2` (`EXIT_INVALID_ARGUMENTS`): Invalid arguments, unsupported format, or invalid configuration.
- `4` (`EXIT_INTERNAL_ERROR`): Cancelled or unexpected internal error.

---

### 2. `skillguard scan`

Perform read-only static security analysis on skills using the Python security engine, detecting secrets, unsafe commands, prompt injections, and script issues without executing skill scripts.

```bash
skillguard scan [path] [options]
```

#### Arguments

- `[path]` _(optional)_: Path to skill directory or directory containing skills. Defaults to configured paths.

#### Options

- `--config <file>`: Path to custom UTF-8 JSON configuration file (engine timeout is controlled via `engine.timeoutMs` in config).
- `--python <executable>`: Path to trusted Python interpreter (can also be set via `SKILLGUARD_PYTHON`).
- `--format <format>`: Output format: `terminal`, `json`, `markdown`, or `sarif` (default: `terminal`).
- `--strict`: Fail on any deterministic finding.
- `--severity-threshold <level>`: Minimum severity to trigger failure: `info`, `low`, `medium`, `high`, `critical` (default: `high`).
- `--quiet`: Suppress terminal output; preserve machine-readable JSON, Markdown, or SARIF.
- `--verbose`: Show detailed finding messages and remediation advice.
- `--no-color`: Disable terminal colors.

#### Exit Codes

- `0` (`EXIT_SUCCESS`): Clean scan; no security or spec findings meet threshold.
- `1` (`EXIT_FINDINGS`): Security or spec findings meet threshold.
- `2` (`EXIT_INVALID_ARGUMENTS`): Invalid arguments or configuration.
- `3` (`EXIT_ENGINE_ERROR`): Python engine unavailable, crashed, timed out, or protocol violation.
- `4` (`EXIT_INTERNAL_ERROR`): Operation cancelled or internal crash.

---

### 3. `skillguard test`

Execute deterministic fixture-based assertions defined in `skillguard.tests.yaml` files inside skill directories.

```bash
skillguard test [path] [options]
```

#### Arguments

- `[path]` _(optional)_: Path to skill directory or test file. Defaults to configured paths.

#### Options

- `--config <file>`: Path to custom UTF-8 JSON configuration file.
- `--format <format>`: Output format: `terminal`, `json`, or `markdown` (default: `terminal`).
- `--quiet`: Suppress terminal output.
- `--verbose`: Show detailed test execution output.
- `--no-color`: Disable terminal colors.

#### Exit Codes

- `0` (`EXIT_SUCCESS`): All test fixtures passed.
- `1` (`EXIT_FINDINGS`): One or more assertions failed.
- `2` (`EXIT_INVALID_ARGUMENTS`): Invalid test suite syntax, missing config, or invalid arguments.
- `4` (`EXIT_INTERNAL_ERROR`): Cancelled or unexpected internal error.

---

### 4. `skillguard doctor`

Inspect and diagnose the runtime environment, checking Node.js and the Python security engine without reading skill files.

```bash
skillguard doctor [options]
```

#### Options

- `--python <executable>`: Path to trusted Python interpreter (or `SKILLGUARD_PYTHON`).
- `--timeout <milliseconds>`: Engine deadline in milliseconds (default: `15000`).
- `--format <format>`: Output format: `terminal`, `json`, or `markdown` (default: `terminal`).
- `--quiet`: Suppress terminal output.
- `--verbose`: Show detailed rule set version and runtime details.
- `--no-color`: Disable terminal colors.

#### Exit Codes

- `0` (`EXIT_SUCCESS`): Node.js and Python engine are operational.
- `2` (`EXIT_INVALID_ARGUMENTS`): Invalid options or timeout.
- `3` (`EXIT_ENGINE_ERROR`): Python interpreter not found or engine failed doctor check.
- `4` (`EXIT_INTERNAL_ERROR`): Operation cancelled.

---

### 5. `skillguard evaluate`

Perform optional, advisory-only AI behavioral evaluation of skills. Requires explicit two-tier consent.

```bash
skillguard evaluate [path] [options]
```

#### Arguments

- `[path]` _(optional)_: Path to skill directory or directory containing skills.

#### Options

- `--config <file>`: Path to custom configuration file enabling `aiEvaluation` (timeout controlled via `aiEvaluation.timeoutMs` in config).
- `--python <executable>`: Path to trusted Python interpreter.
- `--format <format>`: Output format: `terminal`, `json`, `markdown`, or `sarif` (default: `terminal`).
- `--ai-consent`: Explicit non-interactive consent flag (mandatory for CI / non-TTY executions).
- `--quiet`: Suppress terminal output.
- `--verbose`: Show detailed advisory evaluation findings.
- `--no-color`: Disable terminal colors.

#### Consent Requirement

1. **Config Opt-In:** Configuration must contain `aiEvaluation.enabled: true`, a valid provider (`openai`), model, and budget.
2. **Explicit Consent:**
   - In interactive terminal (TTY): user is prompted with transparency disclosure and must type `yes` or `y`. If user types `no` or `n`, consent is declined, no network calls occur, and exit code `0` is returned.
   - In non-interactive environment (CI): `--ai-consent` flag must be passed. If omitted, command fails immediately with exit code `2` (`EXIT_INVALID_ARGUMENTS`).

#### Exit Codes

- `0` (`EXIT_SUCCESS`): Evaluation completed or consent cleanly declined.
- `1` (`EXIT_FINDINGS`): Evaluation failed or returned critical advisory failures.
- `2` (`EXIT_INVALID_ARGUMENTS`): AI not enabled in config, missing `--ai-consent` in non-interactive mode, or invalid arguments.
- `3` (`EXIT_ENGINE_ERROR`): Python engine or AI adapter failure.
- `4` (`EXIT_INTERNAL_ERROR`): Cancelled or internal crash.

---

## Standardized Exit Codes

SkillGuard uses standardized, predictable exit codes across all commands:

| Code | Constant                 | Meaning                                                                                               | Typical Resolution                                                        |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `0`  | `EXIT_SUCCESS`           | Clean execution. No findings meeting failure threshold, tests passed, or consent declined cleanly.    | No action required.                                                       |
| `1`  | `EXIT_FINDINGS`          | Actionable findings or failed tests detected.                                                         | Inspect findings in report and remediate skill issues.                    |
| `2`  | `EXIT_INVALID_ARGUMENTS` | Command line arguments, format options, or configuration invalid; non-interactive AI consent missing. | Check command options, `--format`, `--config`, or provide `--ai-consent`. |
| `3`  | `EXIT_ENGINE_ERROR`      | Python subprocess error, interpreter missing, timeout, or protocol failure.                           | Run `skillguard doctor --python <path>` to diagnose Python engine.        |
| `4`  | `EXIT_INTERNAL_ERROR`    | Subprocess cancelled (SIGINT/SIGTERM), abort requested, or unexpected internal error.                 | Retry without interrupting the process.                                   |
