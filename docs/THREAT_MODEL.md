# SkillGuard Threat Model

- Status: initial design; revisit before v0.1 and after any execution capability is proposed.

## 1. Security objective

Help users identify malformed, risky, or suspicious skill content while ensuring that scanning itself does not execute untrusted skill code or leak sensitive content.

SkillGuard is an analyzer, not a sandbox and not a guarantee of safety.

## 2. Assets

- User source code and skill files.
- Local credentials and environment variables.
- CI secrets and repository tokens.
- Scan reports, including potentially sensitive snippets.
- Integrity of the SkillGuard CLI, Python engine, rules, and release artifacts.
- AI provider credentials and any content submitted for optional evaluation.

## 3. Trust boundaries

1. User machine / CI runner to scanned repository.
2. TypeScript CLI to Python subprocess.
3. SkillGuard process to filesystem.
4. SkillGuard to optional external AI provider.
5. Maintainer/release pipeline to package registries.

Scanned skill content is untrusted data at every boundary.

## 4. Threat actors and scenarios

| Threat                 | Example                                               | Impact                         |
| ---------------------- | ----------------------------------------------------- | ------------------------------ |
| Malicious skill author | Skill instructs agent to exfiltrate secrets           | User/agent compromise          |
| Path manipulation      | Reference uses `../../` or symlink escape             | Unauthorized file read         |
| Secret exposure        | Scanner prints matched API key                        | Credential leak                |
| Resource exhaustion    | Huge/deep files or pathological Markdown              | CI hang or memory exhaustion   |
| Protocol injection     | Malformed engine output                               | CLI crash or misleading report |
| Prompt injection       | Skill content tells evaluator to reveal system prompt | AI evaluator manipulation      |
| Dependency compromise  | Malicious dependency or compromised package           | Supply-chain compromise        |
| False assurance        | Clean scan interpreted as proof of safety             | Unsafe deployment              |
| CI credential abuse    | Workflow runs untrusted PR code with write token      | Repository compromise          |
| Report leakage         | PR artifact includes secrets or private skill text    | Information disclosure         |

## 5. Mitigations

### Filesystem and parser

- Resolve paths against an explicit scan root.
- Reject or flag traversal and symlink escapes.
- Enforce file count, file size, total bytes, and nesting limits.
- Parse content as data; do not import, evaluate, or execute it.
- Handle malformed YAML/Markdown with bounded error messages.

### Process boundary

- Invoke Python using argument arrays and `shell: false`.
- Use a minimal environment allowlist.
- Set execution timeout and terminate on cancellation.
- Validate protocol JSON against a versioned schema.
- Reserve stdout for machine protocol; cap output size.

### Secrets and reports

- Redact matched secret values.
- Do not print full file contents.
- Use minimal excerpts and configurable report redaction.
- Never log provider keys or environment dumps.
- Make report upload a user-controlled CI step.

### AI evaluation

- Disabled by default.
- Explicit user consent and disclosure before sending content.
- Minimize and bound content; set cost/token limits.
- Treat skill content as quoted untrusted data.
- No tools, code execution, or autonomous actions for the evaluator.
- AI findings remain advisory and cannot override static findings.
- Document provider retention/data-use terms rather than assuming uniform policies.

### CI and supply chain

- Use least-privilege workflow permissions.
- Do not expose write tokens to untrusted fork PR code.
- Pin third-party actions to full commit SHAs.
- Use dependency lockfiles and automated vulnerability updates.
- Protect release credentials with environment approvals and short-lived tokens.
- Publish checksums/provenance when feasible.

## 6. Residual risks

- Static analysis cannot understand every natural-language instruction.
- Pattern-based detectors will have false positives and false negatives.
- A skill can be harmful through context or tool interactions not visible in files.
- AI evaluators can be manipulated or produce inconsistent results.
- A compromised dependency or release pipeline can undermine the tool.
- User configuration can disable important checks.

## 7. Security testing requirements

- Traversal, symlink, oversized-file, malformed-frontmatter, and binary-file fixtures.
- Secret-redaction tests asserting the original value never appears in output.
- Protocol fuzzing and invalid-version tests.
- Prompt-injection adversarial fixtures for optional AI evaluation.
- CI workflow review for fork permissions and token exposure.
- Dependency and package integrity checks before release.

## 8. Vulnerability reporting

Report vulnerabilities privately using GitHub Security Advisories when enabled, or the private contact route documented in `SECURITY.md`. Do not publish exploit details before maintainers coordinate a fix.
