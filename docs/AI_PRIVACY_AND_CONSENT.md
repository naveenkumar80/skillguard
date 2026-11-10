# SkillGuard AI Evaluation: Privacy, Consent, and Safeguards

This document explains the security, privacy, transparency, and consent controls governing SkillGuard's optional AI evaluation capability.

---

## 1. Core Principles

1. **Advisory-Only:** AI evaluations provide heuristic observations and advice. They cannot override deterministic findings, certify a skill as safe, or modify severity levels.
2. **Disabled by Default:** SkillGuard never contacts an AI provider, reads API credentials, or sends skill content to any network service unless explicitly enabled and confirmed.
3. **Zero Implicit Inheritance:** AI evaluation cannot be accidentally triggered by environment variables alone. Explicit configuration and explicit consent are required for every invocation.
4. **Data Minimization and Redaction:** Content sent to providers is strictly bounded, binary-excluded, and stripped of absolute host filesystem paths.
5. **Strict Budget Caps:** Evaluations enforce hard token and cost ceilings. An evaluation that would exceed the configured budget is rejected before execution.

---

## 2. Two-Tier Consent Model

SkillGuard requires two separate, independent consent gates before any skill content is passed to an external provider:

```
+-----------------------------------------------------------+
| Tier 1: Configuration Opt-In                              |
|   skillguard.config.json: "aiEvaluation.enabled": true    |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| Tier 2: Invocation Consent                                |
|   Interactive TTY?                                        |
|     ├── Yes: Interactive Transparency Prompt (y/N)        |
|     └── No (CI/pipes): Explicit `--ai-consent` CLI flag   |
+-----------------------------+-----------------------------+
                              |
                              v
       Only upon passing BOTH gates: Provider Contact
```

### Interactive Transparency Prompt

When executed in an interactive terminal (TTY) with AI evaluation enabled, SkillGuard presents a detailed disclosure prior to contacting the provider:

```text
=== SkillGuard AI Evaluation Transparency Disclosure ===

AI evaluation is an optional, advisory-only capability.
Before proceeding, please review what will happen:

  • Provider & Model:      openai (model: gpt-4o-mini)
  • Transmitted Content:   Skill file text up to 32768 bytes.
                           Local filesystem paths are redacted (mapped to fileIndex: 0, 1...).
  • Excluded Content:      Binary files, files exceeding size limits, unindexed resources.
  • Financial Liability:   Worst-case budget cap is $1.00 USD.
                           (Input: $0.15/M tokens, Output: $0.60/M tokens, Max retries: 0).
  • Advisory Nature:       AI findings are heuristic suggestions and CANNOT certify safety
                           or modify deterministic security findings.
  • Disabling:             Keep 'aiEvaluation.enabled: false' in skillguard.config.json.

Do you grant consent to evaluate this skill using external AI? (y/N):
```

- **If the user enters `y` or `yes`:** Evaluation proceeds under strict budget and size limits.
- **If the user enters `n`, `no`, or presses Enter:** Consent is cleanly declined, no network calls are made, and the CLI exits cleanly with code `0`.

### Non-Interactive / CI Fail-Closed Policy

In automated environments (such as CI/CD pipelines, background daemons, or redirected stdin where `process.stdin.isTTY` is `false`):

- Prompting is impossible.
- If `--ai-consent` is present, consent is recorded.
- If `--ai-consent` is omitted, SkillGuard **fails closed** immediately with error code `INVALID_CONFIG` and exit code `2` (`EXIT_INVALID_ARGUMENTS`).

---

## 3. Data Transmission and Privacy Safeguards

### What Is Sent to the Provider

- Skill text files (`SKILL.md`, referenced text/script files) up to a hard ceiling of 32,768 bytes total per evaluation request.
- Metadata describing the skill (name, description from frontmatter).
- Redacted relative path markers (`fileIndex: 0`, `fileIndex: 1`).

### What Is NEVER Sent to the Provider

- Absolute filesystem paths from your host machine (e.g. `/home/user/...` or `C:\Users\...` are stripped).
- Binary assets (images, compiled binaries, archives, audio/video).
- Files larger than 256 KiB or skills exceeding total byte limits.
- Symlinked contents pointing outside the skill root.
- Environment variables or secrets from the host (only `OPENAI_API_KEY` is passed to the engine subprocess when evaluation is opted in).
- Unreferenced files or files matched by `.gitignore` / `exclude` patterns.

---

## 4. Financial Liability and Budget Enforcement

To prevent unexpected billing or runaway API costs:

1. **Mandatory Cost Cap (`maxCostUsd`):** Each run enforces an absolute spending cap (e.g. `$1.00`).
2. **Pricing Schedule Verification:** The configuration specifies `inputPricePerMillion` and `outputPricePerMillion` tokens.
3. **Pre-Flight Estimation:** The engine calculates worst-case token costs from payload size and model maximum token generation. If the estimated cost exceeds `maxCostUsd`, evaluation aborts before making any API calls.
4. **Invocation Isolation:** Each CLI invocation runs in its own process lifecycle. API keys and state are not persisted across invocations.

---

## 5. How to Disable AI Evaluation Completely

To guarantee that no AI evaluation ever takes place:

1. **Configuration:** Ensure `aiEvaluation.enabled` is `false` (or omit the `aiEvaluation` block entirely from `skillguard.config.json`).
2. **Environment:** Ensure no `OPENAI_API_KEY` is defined in your environment if you do not want it accessible.
3. **Doctor Verification:** Run `skillguard doctor` to confirm status:
   ```bash
   skillguard doctor
   # Output displays: "AI Evaluation: disabled (advisory only)"
   ```
