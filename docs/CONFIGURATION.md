# SkillGuard Configuration Guide

SkillGuard configuration is authored in strict, valid UTF-8 JSON (`skillguard.config.json`), bounded to a maximum file size of 64 KiB.

Pass `--config <path>` explicitly to load a configuration file. Paths specified within the configuration file resolve relative to the configuration file's parent directory; paths specified directly on the CLI resolve relative to the current working directory.

Unknown keys, invalid types, or values outside allowed ranges fail closed immediately with exit code `2` (`EXIT_INVALID_ARGUMENTS`).

---

## Configuration Precedence

SkillGuard applies configuration using strict hierarchical precedence:

```
1. CLI Flags (e.g. --strict, --severity-threshold, --format) [HIGHEST]
      ↓ overrides
2. Configuration File (skillguard.config.json)
      ↓ overrides
3. Built-In Engine Defaults [LOWEST]
```

---

## Configuration Schema

```json
{
  "profile": "agent-skills-current",
  "paths": ["./skills"],
  "exclude": ["**/test/**", "**/*.draft.md"],
  "checks": {
    "spec": true,
    "structure": true,
    "quality": false,
    "security": true
  },
  "severityThreshold": "high",
  "strict": false,
  "rules": {
    "SG-SEC-001": "critical",
    "SG-SEC-002": "high"
  },
  "suppressions": [
    {
      "ruleId": "SG-SEC-001",
      "path": "skills/demo/scripts/fixture.py",
      "reason": "Synthetic token used exclusively for fixture testing."
    }
  ],
  "engine": {
    "enabled": true,
    "timeoutMs": 15000
  },
  "aiEvaluation": {
    "enabled": false,
    "provider": "openai",
    "model": "gpt-4o-mini",
    "maxCostUsd": 1.0,
    "inputPricePerMillion": 0.15,
    "outputPricePerMillion": 0.6,
    "maxOutputTokens": 512,
    "maxInputBytes": 32768,
    "timeoutMs": 15000,
    "maxRetries": 0
  },
  "limits": {
    "maxEntries": 10000,
    "maxFiles": 1000,
    "maxDepth": 16,
    "maxFileBytes": 262144,
    "maxTotalBytes": 4194304
  }
}
```

---

## Field Reference

### Core Fields

- **`profile`** _(string, default: `"agent-skills-current"`)_: Pinned specification profile.
- **`paths`** _(string array, min: 1, max: 100, default: `["./skills"]`)_: Relative paths to skill directories to scan.
- **`exclude`** _(string array, max: 100, default: `[]`)_: Glob patterns to exclude. Default exclusions always include `node_modules`, `.git`, `.venv`, `dist`, and `coverage`.
- **`severityThreshold`** _(enum: `"info" | "low" | "medium" | "high" | "critical"`, default: `"high"`)_: Findings at or above this level trigger exit code `1`.
- **`strict`** _(boolean, default: `false`)_: When `true`, any deterministic finding triggers exit code `1`.

### Checks (`checks`)

- **`checks.spec`** _(boolean, default: `true`)_: Validate metadata format and `SKILL.md` frontmatter.
- **`checks.structure`** _(boolean, default: `true`)_: Validate filesystem boundaries, file references, and resource containment. Cannot disable boundary safety checks.
- **`checks.quality`** _(boolean, default: `false`)_: Advisory style and quality recommendations.
- **`checks.security`** _(boolean, default: `true`)_: Enable static security scanning rules during `scan` command.

### Rule Overrides and Suppressions

- **`rules`** _(record of string -> severity, default: `{}`)_: Override default severity for specific rules (e.g. `{"SG-SEC-001": "critical"}`).
- **`suppressions`** _(array of objects, max: 100, default: `[]`)_:
  - `ruleId`: Target rule identifier (`SG-SEC-xxx`).
  - `path`: Safe relative path to the file.
  - `reason`: Justification for suppression (min: 12 chars, max: 512 chars).

### Engine Configuration (`engine`)

- **`engine.enabled`** _(boolean, default: `true`)_: Enable Python engine subprocess integration.
- **`engine.timeoutMs`** _(integer, range: 1–120000, default: `15000`)_: Execution deadline in milliseconds.

### AI Evaluation (`aiEvaluation`)

Optional, advisory-only capability. Disabled by default. When `enabled` is `true`, `provider` (`"openai"`), `model`, and positive `maxCostUsd`, `inputPricePerMillion`, and `outputPricePerMillion` values are required:

- **`aiEvaluation.enabled`** _(boolean, default: `false`)_: Master toggle for AI evaluation.
- **`aiEvaluation.provider`** _(enum: `"openai"` or `null`, default: `null`)_: Target AI provider.
- **`aiEvaluation.model`** _(string, default: `null`)_: Model identifier (e.g. `"gpt-4o-mini"`).
- **`aiEvaluation.maxCostUsd`** _(number, range: 0–5, default: `0`)_: Hard financial spending cap per evaluation run.
- **`aiEvaluation.inputPricePerMillion`** _(number, range: 0–1000, default: `0`)_: Input token cost per 1M tokens.
- **`aiEvaluation.outputPricePerMillion`** _(number, range: 0–1000, default: `0`)_: Output token cost per 1M tokens.
- **`aiEvaluation.maxOutputTokens`** _(integer, range: 1–4096, default: `512`)_: Maximum generated output tokens per request.
- **`aiEvaluation.maxInputBytes`** _(integer, range: 1–32768, default: `32768`)_: Maximum input skill payload size sent to provider.
- **`aiEvaluation.timeoutMs`** _(integer, range: 1–30000, default: `15000`)_: Provider HTTP request timeout in milliseconds.
- **`aiEvaluation.maxRetries`** _(integer, range: 0–2, default: `0`)_: Maximum retry attempts for transient API errors.

### Filesystem Limits (`limits`)

Bounds prevent denial-of-service, symlink looping, and excessive memory consumption during traversal:

| Key             | Default            | Accepted Range | Description                         |
| --------------- | ------------------ | -------------- | ----------------------------------- |
| `maxEntries`    | `10000`            | 1–100,000      | Maximum directory entries traversed |
| `maxFiles`      | `1000`             | 1–10,000       | Maximum files analyzed              |
| `maxDepth`      | `16`               | 0–64           | Maximum directory traversal depth   |
| `maxFileBytes`  | `262144` (256 KiB) | 1–262,144      | Maximum file size read as text      |
| `maxTotalBytes` | `4194304` (4 MiB)  | 1–4,194,304    | Maximum cumulative bytes read       |
