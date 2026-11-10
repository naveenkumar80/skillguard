# SkillGuard Technical Specification

- Status: Proposed, approved for MVP implementation
- Version: 0.1.0 design baseline
- Last updated: 2026-11-09

## 1. Product goal

Provide a reproducible local and CI workflow for validating AI agent skills before use. SkillGuard focuses on conformance, integrity, static security analysis, and testability—not skill discovery, installation, or publishing.

### Primary users

- Authors maintaining one or more skills.
- Teams reviewing third-party skills before enabling them.
- Maintainers integrating skill checks into pull-request CI.
- Agent-framework/tooling developers who need machine-readable validation output.

### Non-goals for MVP

- Executing arbitrary skill scripts.
- Proving that a skill is benign or safe.
- Automatically rewriting or approving skills.
- Hosting a skill registry or marketplace.
- Supporting every proprietary agent-specific extension.
- Guaranteeing behavioral correctness of arbitrary natural-language instructions.

## 2. Supported input model

A skill is a directory containing a `SKILL.md` file. The parser recognises YAML frontmatter and Markdown body. Optional subdirectories such as `scripts/`, `references/`, and `assets/` are treated as resources; exact compatibility rules are versioned and documented.

The baseline format profile requires:

- A parseable YAML frontmatter block.
- `name` and `description` fields.
- A valid skill directory and `SKILL.md` file.
- Metadata values meeting the selected format profile's constraints.

The format profile must be traceable to the upstream Agent Skills specification. Do not invent mandatory fields. Rules beyond the upstream requirements must be marked as `quality` or `security`, not `spec`.

## 3. User-facing commands

| Command                    | Purpose                                     | MVP |
| -------------------------- | ------------------------------------------- | --- |
| `skillguard init`          | Create starter config and sample tests      | Yes |
| `skillguard check <path>`  | Run format, structure, and reference checks | Yes |
| `skillguard scan <path>`   | Run static security rules                   | Yes |
| `skillguard test <path>`   | Run deterministic skill test cases          | Yes |
| `skillguard report <path>` | Render a saved JSON result                  | Yes |
| `skillguard rules`         | List rule IDs, severities, and categories   | Yes |
| `skillguard doctor`        | Check runtime and engine availability       | Yes |

Common flags:

- `--config <path>`
- `--format terminal|json|markdown`
- `--severity-threshold info|low|medium|high|critical`
- `--strict` (fail on configured warnings as well as errors)
- `--no-color`
- `--quiet`
- `--version`

Exit codes:

- `0`: completed; no findings above the configured failure threshold.
- `1`: completed; one or more findings crossed the failure threshold.
- `2`: invalid arguments or configuration.
- `3`: engine/protocol/runtime failure.
- `4`: interrupted or internal unexpected error.

Exit codes must remain stable across minor releases.

## 4. Hybrid architecture

### 4.1 TypeScript layer

Responsibilities:

- CLI argument parsing and UX.
- Skill discovery and safe path handling.
- Configuration loading and validation.
- Deterministic format/metadata/reference checks.
- Deterministic fixture-based test runner.
- Report aggregation and rendering.
- Python engine lifecycle and protocol validation.

Suggested dependencies:

- Node.js 22 LTS or newer supported LTS.
- TypeScript strict mode.
- `commander` for CLI parsing.
- `zod` for runtime config validation.
- `ajv` for JSON Schema protocol validation.
- `vitest` for tests.

### 4.2 Python engine

Responsibilities:

- Additional static security analyzers.
- Secret scanning adapter and custom rules.
- Script/dependency metadata inspection without execution.
- Optional LLM evaluation adapters and structured evaluation results.

Suggested dependencies:

- Python 3.11+.
- `pydantic` for internal models.
- `PyYAML` for YAML parsing where required.
- `pytest` for tests.
- Optional provider SDKs behind extras; no provider SDK is mandatory for core installation.

### 4.3 Runtime boundary

The CLI invokes the engine as a subprocess and exchanges one JSON request and one JSON response over stdin/stdout. Standard output is reserved for protocol JSON; diagnostics go to stderr. The protocol is versioned and defined in `packages/protocol/schema/`.

The CLI must:

- Set a bounded execution timeout.
- Pass an explicit environment allowlist.
- Avoid passing API keys unless an AI evaluation was explicitly requested.
- Validate the response against the protocol schema.
- Reject unsupported protocol versions.
- Terminate the child process on timeout or cancellation.
- Never invoke skill-supplied commands.

### 4.4 Data flow

1. Discover candidate skill directories.
2. Resolve and validate paths without following unsafe links outside the selected root.
3. Read `SKILL.md` and permitted resource files as data.
4. Run deterministic TypeScript validators.
5. If requested and available, send normalized file metadata/content to Python security analyzers.
6. If explicitly enabled, run LLM evaluation using configured provider and budget.
7. Normalize findings and test results.
8. Render reports and determine exit status.

## 5. Finding model

Each finding must include:

```json
{
  "schemaVersion": "1.0",
  "ruleId": "SG-SEC-001",
  "category": "security",
  "severity": "high",
  "confidence": "medium",
  "title": "Potential credential detected",
  "message": "A string resembles a credential.",
  "path": "skills/example/SKILL.md",
  "line": 18,
  "column": 1,
  "evidence": {
    "redacted": true,
    "excerpt": "token = [REDACTED]"
  },
  "recommendation": "Remove the credential and rotate it if it was real.",
  "references": []
}
```

Rules:

- Evidence must be minimal and secrets must be redacted.
- Paths must be relative to the scan root and normalized.
- `ruleId` is stable; changing semantics requires a new ID or documented migration.
- `confidence` describes detector confidence, not severity.
- A finding is not a verdict that a skill is malicious.

## 6. Rule taxonomy

- `spec`: required by a pinned upstream format profile.
- `structure`: filesystem and resource integrity.
- `quality`: optional authoring guidance.
- `security`: potential security or privacy risk.
- `test`: failed declared behavioral assertion.
- `ai-evaluation`: advisory model-based assessment.

Every rule has: ID, title, category, default severity, confidence guidance, description, remediation, references, and test fixtures.

Initial rule families:

- Frontmatter parse and required metadata.
- Name/directory consistency where required by the profile.
- Missing local references.
- Path traversal and references escaping the skill root.
- Duplicate or malformed resource paths.
- High-entropy/token-pattern secret candidates.
- Dangerous shell patterns and suspicious download/execute chains.
- Script/dependency inventory and risky patterns.
- Prompt-injection-like instructions targeting secrets, policy, or tool boundaries.

Security pattern matches must be contextualized and must not be described as proof of maliciousness.

## 7. Configuration

File: `skillguard.config.json` (YAML support may be added later).

Example:

```json
{
  "$schema": "https://skillguard.dev/schemas/config-v1.json",
  "profile": "agent-skills-current",
  "paths": ["./skills"],
  "exclude": ["**/node_modules/**", "**/.git/**"],
  "checks": {
    "spec": true,
    "structure": true,
    "quality": false,
    "security": true
  },
  "severityThreshold": "high",
  "strict": false,
  "engine": {
    "enabled": true,
    "timeoutMs": 15000
  },
  "aiEvaluation": {
    "enabled": false,
    "provider": null,
    "model": null,
    "maxCostUsd": 0
  }
}
```

Unknown configuration keys should fail with an actionable message unless explicitly placed under an extension namespace.

## 8. Deterministic test format

File: `skillguard.tests.yaml`.

```yaml
version: 1
tests:
  - id: greeting-basic
    skill: ./skills/greeting
    description: The skill should explain its supported greeting workflow.
    input:
      prompt: "Help me greet a new teammate."
    assertions:
      - type: contains_any
        values: ["hello", "welcome", "greet"]
```

MVP test runner uses deterministic fixtures and assertions over supplied expected outputs or adapter-produced recorded outputs. It does not execute a real agent by default.

Supported initial assertions:

- `contains`
- `contains_any`
- `not_contains`
- `regex`
- `json_path_equals`
- `max_length`

LLM evaluation is a separate optional mode with explicit model/provider selection, budget ceiling, prompt/version recording, and advisory result labels. It must never make the deterministic suite appear to pass when it fails.

## 9. AI analysis contract

AI analysis is opt-in and advisory. The request must:

- Include only the minimum content required.
- Warn users before sending skill content to an external provider.
- Support provider-neutral adapter interfaces.
- Apply request timeout, retry ceiling, and cost/token budget.
- Store provider/model, prompt template version, timestamp, and evaluation metadata.
- Treat skill content as untrusted data, not instructions to the evaluator.
- Never permit the model to execute tools or scripts.
- Never allow model output to suppress deterministic findings.

No provider key is collected, stored, or transmitted unless the user explicitly enables AI analysis.

## 10. Reporting

MVP formats:

- Terminal: concise summary and finding locations.
- JSON: stable machine-readable schema.
- Markdown: human-readable report suitable for PR artifacts.

Later:

- SARIF 2.1.0 for code-scanning integrations.
- GitHub Actions annotations.

Reports must state the SkillGuard version, rule-set version, format profile, scan timestamp, scanned paths, exclusions, and whether AI analysis ran.

## 11. Performance and reliability targets

Initial targets (to be validated, not guaranteed):

- Scan 100 small skills / 10 MB total content in under 10 seconds on a typical developer laptop, excluding optional LLM calls.
- Bound file size and total scan size; configurable with safe defaults.
- Avoid loading binary assets into memory.
- Cancellation should stop child processes and close file handles.
- Stable output ordering for reproducibility.

## 12. Compatibility and versioning

- Public CLI behavior follows semantic versioning.
- JSON schemas are versioned independently and support a documented compatibility window.
- Rule IDs are stable API.
- Node and Python supported versions are declared in package metadata and CI.
- Format profiles are pinned and updated deliberately; release notes describe changed conformance behavior.

## 13. MVP acceptance criteria

A v0.1 release is ready only when:

- Core check works without the Python engine.
- Python engine integration is optional and protocol-validated.
- At least 15 documented deterministic rules exist.
- At least 10 documented security rules exist, with fixture coverage.
- No skill-provided script is executed by any scan/check command.
- JSON and Markdown reports are stable and tested.
- At least 100 automated tests pass.
- Linux, macOS, and Windows CI pass.
- Documentation explains false positives, false negatives, and limits.
- A clean install and example workflow are verified by a contributor who did not author the feature.
