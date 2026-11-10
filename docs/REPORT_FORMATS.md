# SkillGuard Report Formats Guide

SkillGuard supports four distinct reporting formats designed for developers, automation pipelines, documentation workflows, and security operations:

| Format Flag         | Primary Consumer       | Machine Readable | Use Case                                          |
| ------------------- | ---------------------- | ---------------- | ------------------------------------------------- |
| `--format terminal` | Humans                 | No               | Local interactive development and debugging       |
| `--format json`     | Automation / Parsers   | Yes              | Scripting, custom CI tooling, ingestion pipelines |
| `--format markdown` | Humans / PR Systems    | Yes              | GitHub PR comments, Job Summaries, audit reports  |
| `--format sarif`    | IDEs / GitHub Security | Yes              | GitHub Code Scanning, VS Code SARIF Viewer, Sonar |

All machine-readable formats (`json` and `sarif`) write strictly valid data to `stdout`. All informational logs, interactive prompts, and diagnostic messages are routed to `stderr` or suppressed.

---

## 1. Terminal Format (`--format terminal`)

The default output format. Provides ANSI-styled, readable summaries for local CLI users.

### Variations:

- **Default:** Summary counts, skill validation status, and single-line finding summaries.
- **Verbose (`--verbose`):** Adds detailed finding explanations, evidence snippets (safely redacted), and remediation guidance.
- **Quiet (`--quiet`):** Suppresses terminal stdout completely (useful when relying solely on exit codes).

### Example Output (`skillguard scan`):

```text
Skills: 1; valid: 1; incomplete: false
Files scanned: 3; binary skipped: 0. No skill scripts executed.
AI: disabled

Findings (1):
SKILL.md:10:1 high SG-SEC-001 Plaintext API secret candidate
```

---

## 2. JSON Format (`--format json`)

Outputs a JSON document conforming to SkillGuard protocol schemas.

### Top-Level Fields:

- `schemaVersion`: Protocol version (e.g. `"1.0"`).
- `tool`: Object with `name: "skillguard"` and `version: "0.1.0"`.
- `ruleSetVersion`: Version of the active rule catalog.
- `profile`: Pinned specification profile (e.g. `"agent-skills-current"`).
- `complete`: Boolean indicating whether scanning traversed all files without hitting limits.
- `skills`: Array of evaluated skill roots with validation status.
- `findings`: Array of finding objects with `ruleId`, `severity`, `path`, `line`, `column`, `message`, `evidence`, and `remediation`.
- `security`: Object detailing static analysis statistics (`filesScanned`, `binaryFilesSkipped`, `policy`).
- `aiEvaluation`: String status or advisory details.

### Example JSON Payload:

```json
{
  "schemaVersion": "1.0",
  "tool": {
    "name": "skillguard",
    "version": "0.1.0"
  },
  "ruleSetVersion": "1.0.0",
  "profile": "agent-skills-current",
  "complete": true,
  "skills": [
    {
      "path": "examples/greeting",
      "name": "greeting",
      "valid": true
    }
  ],
  "findings": [],
  "security": {
    "status": "completed",
    "ruleSetVersion": "1.0.0",
    "filesScanned": 3,
    "binaryFilesSkipped": 0,
    "policy": {
      "suppressed": [],
      "severityChanges": []
    }
  },
  "aiEvaluation": "disabled"
}
```

---

## 3. Markdown Format (`--format markdown`)

Generates GitHub Flavored Markdown (GFM) formatted for reading in pull request comments or GitHub Actions Job Summaries (`$GITHUB_STEP_SUMMARY`).

### Structure:

1. **Header & Overview:** Title, summary statistics table with skill count, valid count, and completeness status.
2. **Skills Overview Table:** Per-skill validation table (`Skill Path`, `Name`, `Valid`).
3. **Findings Table:** Tabular summary of all findings (`Severity`, `Rule ID`, `Location`, `Title`).
4. **Detailed Findings Section:** Markdown headers and description blocks for each finding with evidence and actionable remediation steps.
5. **Security Engine Summary:** Scan statistics, files inspected, and disclaimer notices.

### Example Markdown Snippet:

```markdown
# SkillGuard Security Scan Report

## Overview

- **Skills Evaluated:** 1
- **Valid Skills:** 1
- **Complete Scan:** Yes
- **Total Findings:** 0
- **AI Evaluation:** disabled

## Skills Overview

| Path                | Name       | Valid |
| ------------------- | ---------- | ----- |
| `examples/greeting` | `greeting` | Yes   |

## Security Engine Summary

- **Engine Status:** completed
- **Files Scanned:** 3
- **Binary Files Skipped:** 0
- **Suppressed Findings:** 0

> **Notice:** A clean scan does not prove safety. No skill scripts were executed during analysis.
```

---

## 4. SARIF 2.1.0 Format (`--format sarif`)

Static Analysis Results Interchange Format (SARIF) 2.1.0 is the OASIS standard for static analysis tools. SkillGuard SARIF reports conform to `https://json.schemastore.org/sarif-2.1.0.json` and are directly compatible with GitHub Code Scanning alerts, VS Code SARIF Viewer, and enterprise SIEM/SARIF ingestion systems.

### Severity Mapping:

SkillGuard findings map to standard SARIF 2.1.0 result levels:

| SkillGuard Severity | SARIF Level | GitHub Alert State |
| ------------------- | ----------- | ------------------ |
| `critical`          | `error`     | Error / High Alert |
| `high`              | `error`     | Error / High Alert |
| `medium`            | `warning`   | Warning Alert      |
| `low`               | `note`      | Note / Notice      |
| `info`              | `note`      | Note / Notice      |

### SARIF Schema Conformance Details:

- **`$schema`**: Points to `"https://json.schemastore.org/sarif-2.1.0.json"`.
- **`version`**: Exact string `"2.1.0"`.
- **`runs[].tool.driver`**:
  - `name`: `"skillguard"`.
  - `version`: `"0.1.0"`.
  - `informationUri`: `"https://github.com/naveenkumar80/skillguard"`.
  - `rules`: Catalog of unique rules encountered, each containing `id`, `shortDescription`, optional `fullDescription`, optional `help`, optional `helpUri` (derived from verified rule references when present; omitted otherwise), `defaultConfiguration.level`, and `properties` (`category`, `advisory`).
- **`runs[].results`**: Array of result entries:
  - `ruleId`: Stable identifier (e.g. `SG-SEC-001`, `SG-SPEC-001`).
  - `level`: `"error"`, `"warning"`, or `"note"`.
  - `message.text`: Clear explanation of the issue.
  - `locations`: Physical location with relative URI (`uriBaseId: "%SRCROOT%"`) and 1-based line/column regions when known. Findings without specific file paths omit `locations`; findings without known line numbers omit `region`.
  - `properties`: Additional metadata including `category`, `confidence`, and `advisory`.

### GitHub Actions Integration Example:

```yaml
name: SkillGuard Assurance
on: [push, pull_request]

jobs:
  assurance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run SkillGuard Scan
        run: |
          npx skillguard scan ./skills --format sarif > skillguard-results.sarif
        continue-on-error: true

      - name: Upload SARIF Report
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: skillguard-results.sarif
          category: skillguard-static-analysis
```
