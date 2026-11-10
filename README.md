# SkillGuard

**Trust your skills before your agents run them.**

SkillGuard is an open-source assurance and static security CLI toolkit for AI Agent Skills. It validates skill structure and metadata, checks resource references and boundary integrity, scans for security risks, runs fixture assertions, and performs optional AI-assisted advisory evaluations before skills are loaded into agent workflows.

---

## Key Capabilities

1. **Format & Metadata Validation (`check`):** Verifies `SKILL.md` frontmatter, naming conventions, descriptions, and schema conformity against pinned specifications.
2. **Resource & Boundary Integrity (`check`):** Checks relative path containment, detects broken references, flags unreferenced scripts, and prevents symlink traversal beyond skill boundaries.
3. **Static Security Scanning (`scan`):** Employs an isolated, read-only Python security engine to detect hardcoded credentials, command injections, prompt manipulation risks, and dangerous scripts without executing them.
4. **Fixture-Based Testing (`test`):** Executes deterministic assertions (`contains`, `contains_any`, `not_contains`, `regex`, `json_path_equals`, `max_length`) against recorded skill outputs.
5. **Environment Diagnostics (`doctor`):** Inspects Node.js and Python engine environments, versions, and security rules without inspecting skills.
6. **Advisory AI Evaluation (`evaluate`):** Optional, opt-in LLM second opinion with mandatory interactive/flag consent, path redaction, and strict cost caps.
7. **Comprehensive Reporting:** Generates Terminal, JSON, Markdown, and SARIF 2.1.0 reports for developer terminals, CI pipelines, and GitHub Code Scanning.

---

## Design Principles

- **Safe by Default:** Skill analysis is strictly static and read-only. SkillGuard **never executes skill scripts** during check or scan.
- **Deterministic Core:** Identical inputs and rule versions produce reproducible findings across all environments.
- **Spec First:** Clear separation between mandatory spec rules, static security rules, and advisory quality recommendations.
- **AI is Strictly Advisory:** Optional AI evaluations provide heuristic guidance and can **never override deterministic findings** or certify safety.
- **Zero Passive Leakage:** AI evaluations require explicit two-tier consent (config opt-in + runtime prompt/flag) and strictly redact local filesystem paths.

---

## Installation & Setup

### Prerequisites

- **Node.js:** >= 22 (Node.js 22 LTS or newer; CI runs Node.js 22)
- **pnpm:** >= 9.15.0
- **Python:** >= 3.11 (with `uv` virtual environment for security engine)

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/naveenkumar80/skillguard.git
cd skillguard

# Install Node dependencies
npx --yes pnpm@9.15.0 install --frozen-lockfile

# Sync Python virtual environment
uv sync --locked

# Build CLI package
npx pnpm --filter @skillguard/cli build

# Run all checks
npx pnpm check
```

---

## Quick Start & Usage

```bash
# Verify local runtime and Python security engine
skillguard doctor

# Validate skill structure, frontmatter, and references
skillguard check ./skills

# Perform static security analysis
skillguard scan ./skills

# Run deterministic fixture tests
skillguard test ./skills

# Run security scan and emit SARIF 2.1.0 for GitHub Code Scanning
skillguard scan ./skills --format sarif > results.sarif
```

---

## Commands & Options

| Command           | Purpose                              | Formats                                 | Python Required |
| ----------------- | ------------------------------------ | --------------------------------------- | --------------- |
| `check [path]`    | Validate skill format and references | `terminal`, `json`, `markdown`, `sarif` | No              |
| `scan [path]`     | Static security analysis             | `terminal`, `json`, `markdown`, `sarif` | Yes             |
| `test [path]`     | Run recorded fixture assertions      | `terminal`, `json`, `markdown`          | No              |
| `doctor`          | Inspect runtime and engine health    | `terminal`, `json`, `markdown`          | Yes             |
| `evaluate [path]` | Advisory AI behavioral evaluation    | `terminal`, `json`, `markdown`, `sarif` | Yes (Opt-in)    |

### Common CLI Options

- `--config <file>`: Path to custom UTF-8 JSON configuration file (max 64 KiB).
- `--format <format>`: Output format (`terminal`, `json`, `markdown`, `sarif`).
- `--strict`: Fail on any deterministic finding regardless of severity threshold.
- `--severity-threshold <level>`: Minimum threshold to fail (`info`, `low`, `medium`, `high`, `critical`). Default: `high`.
- `--quiet`: Suppress terminal output; preserve machine-readable JSON or SARIF on stdout.
- `--verbose`: Include detailed finding explanations, evidence snippets, and remediation.
- `--no-color`: Disable ANSI color escape codes.
- `--python <executable>`: Path to trusted Python interpreter (or `SKILLGUARD_PYTHON`).
- `--timeout <milliseconds>`: Engine deadline for `doctor` in milliseconds (1–120000, default: `15000`).
- `--ai-consent`: Grant explicit non-interactive consent for AI evaluation in CI environments.

For complete flag details, see the [CLI Reference](docs/CLI_REFERENCE.md).

---

## Reporting Formats

SkillGuard provides four distinct output formats:

1. **Terminal (`--format terminal`):** ANSI-styled summaries and findings designed for developer terminals.
2. **JSON (`--format json`):** Strict, machine-readable JSON on stdout conforming to SkillGuard protocol schemas.
3. **Markdown (`--format markdown`):** GitHub Flavored Markdown with tables and remediation steps, ideal for GitHub PR summaries.
4. **SARIF 2.1.0 (`--format sarif`):** Standard Static Analysis Results Interchange Format for GitHub Code Scanning and IDE viewers.

For schemas and examples, see [Report Formats Guide](docs/REPORT_FORMATS.md).

---

## Standardized Exit Codes

| Code | Constant                 | Meaning                                                                                      |
| ---- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `0`  | `EXIT_SUCCESS`           | Clean run; no findings meeting failure threshold, tests passed, or consent cleanly declined. |
| `1`  | `EXIT_FINDINGS`          | Issues found exceeding threshold or test fixture failures.                                   |
| `2`  | `EXIT_INVALID_ARGUMENTS` | Invalid command syntax, unsupported format, invalid config, or missing AI consent in CI.     |
| `3`  | `EXIT_ENGINE_ERROR`      | Python subprocess failure, missing interpreter, or protocol violation.                       |
| `4`  | `EXIT_INTERNAL_ERROR`    | Process cancelled (SIGINT/SIGTERM) or unexpected internal abort.                             |

---

## AI Privacy, Consent & Safeguards

The `evaluate` command provides optional AI evaluation with strict safeguards:

- **Two-Tier Consent:** Requires both configuration opt-in (`aiEvaluation.enabled: true`) and per-invocation consent (interactive prompt or `--ai-consent` flag).
- **Fail-Closed in CI:** Missing `--ai-consent` in non-interactive environments fails immediately with exit code `2`.
- **Path Redaction:** Local host filesystem paths are redacted (`fileIndex: 0, 1...`).
- **Binary Exclusion:** Binary assets and oversized files are excluded.
- **Budget Capping:** Enforces hard cost ceilings (`maxCostUsd`) calculated before provider contact.

See [AI Privacy and Consent](docs/AI_PRIVACY_AND_CONSENT.md) for full details.

---

## Security Limitations

- **Static Analysis, Not a Sandbox:** SkillGuard performs static analysis and fixture evaluation. It does not run skills in an isolated execution sandbox.
- **Heuristic Limitations:** Static analysis cannot detect all possible obfuscated vulnerabilities. A clean scan does not prove absolute safety.
- **Advisory AI:** AI evaluation findings are heuristic suggestions and cannot be used to guarantee safety.

---

## Documentation

- [CLI Reference](docs/CLI_REFERENCE.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [Report Formats Guide](docs/REPORT_FORMATS.md)
- [AI Privacy and Consent](docs/AI_PRIVACY_AND_CONSENT.md)
- [Technical Specification](docs/TECHNICAL_SPEC.md)
- [Security Policy](SECURITY.md)

---

## License

MIT. See [LICENSE](LICENSE).
