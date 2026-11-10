# Test Strategy

## 1. Goals

Prove that the deterministic core is reproducible, parsers are robust, filesystem boundaries are respected, findings are actionable, and optional AI functionality cannot weaken deterministic results.

## 2. Test layers

### Unit tests

- YAML frontmatter parsing and metadata validation.
- Markdown link/reference extraction.
- Path normalization and symlink policy.
- Rule matching, severity, confidence, and redaction.
- Configuration validation and defaults.
- JSON Schema protocol validation.
- Exit-code calculation and report serialization.

### Integration tests

- CLI invocation against fixture directories.
- TypeScript-to-Python subprocess protocol.
- Engine missing, timeout, crash, malformed JSON, and version mismatch.
- Config discovery in nested repositories.
- JSON/Markdown output snapshots.

### End-to-end tests

- Fresh installation in a clean environment.
- `init` -> `check` -> `scan` -> `test` workflow.
- GitHub Actions sample workflow on a small fixture repository.
- Cross-platform paths and line endings on Linux, macOS, and Windows.

### Security tests

- `../` traversal and absolute paths.
- Symlink to a file outside scan root.
- Huge files, deep directories, malformed encodings.
- Secret candidates with redaction assertions.
- Dangerous shell pattern positives and benign lookalikes.
- Prompt injection attempts in skill content.
- Engine stdout/stderr contamination and oversized protocol output.

### LLM evaluation tests

- Mock provider is the default in CI.
- Test budget exhaustion, timeout, retries, malformed model output, and provider errors.
- Include adversarial skill content that attempts to instruct the evaluator.
- Assert LLM output is labelled advisory and never changes deterministic pass/fail.
- Live provider tests are opt-in, manually triggered, and use a dedicated low-privilege key.

## 3. Fixture corpus

Organize fixtures by intent:

```text
tests/fixtures/
  valid/
  invalid-frontmatter/
  broken-references/
  traversal/
  symlinks/
  secrets/
  suspicious-instructions/
  benign-lookalikes/
  oversized/
  ai-adversarial/
```

Every security rule must have:

- At least one positive fixture.
- At least one negative/benign-lookalike fixture.
- At least one boundary fixture where applicable.
- Expected rule ID, severity, and evidence location.

Never place real credentials or personal data in fixtures.

## 4. Determinism

- Core checks must run offline.
- Sort discovered paths and findings consistently.
- Fix locale/timezone assumptions in tests.
- Avoid timestamps in snapshot comparisons or normalize them.
- Pin parser and rule-set versions.
- Use recorded provider responses for deterministic AI adapter tests.

## 5. Coverage and quality gates

Initial targets:

- 100+ automated tests before v0.1.
- 80% statement coverage for core logic as a target, not a substitute for meaningful tests.
- 100% fixture coverage for released rules.
- No known high/critical defect open at release.
- All supported OS CI jobs pass.
- Security regression tests required for every security bug fix.

## 6. Performance tests

Benchmark:

- 10, 100, and 1,000 small skills.
- Large Markdown and YAML files near configured limits.
- Deep nested resources.
- Many local references.
- Python engine cold start and repeated invocation.

Track wall time and peak memory. Set budgets after collecting baseline measurements on CI runners.

## 7. Release test checklist

- [ ] Clean install from published package.
- [ ] CLI version and doctor commands work.
- [ ] Core check works without Python.
- [ ] Python engine protocol is compatible.
- [ ] No skill scripts execute.
- [ ] Secret redaction verified end-to-end.
- [ ] JSON and Markdown schemas/snapshots reviewed.
- [ ] Linux/macOS/Windows CI green.
- [ ] Example GitHub Actions workflow succeeds.
- [ ] Known limitations and false-positive notes updated.
