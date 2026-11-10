# Development Standards

## 1. Repository conventions

- Use a monorepo with `pnpm` for TypeScript workspaces and `uv` for Python dependency management.
- Keep public interfaces small and documented.
- Do not introduce a runtime dependency without explaining why it is needed.
- Pin CI tool versions; use lockfiles for reproducible installs.
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `security:`.

## 2. TypeScript

- Enable `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Avoid `any`; use `unknown` at trust boundaries and validate it.
- Validate all config and subprocess output at runtime.
- Keep CLI presentation separate from domain logic.
- Use async filesystem APIs and explicit encoding.
- Normalize paths; never concatenate untrusted path fragments into shell commands.
- Do not use `exec` with interpolated user-controlled strings. Prefer `spawn` with argument arrays and `shell: false`.
- Use `node:test` or Vitest consistently; do not mix frameworks without a reason.

## 3. Python

- Support Python 3.11+ for the first release.
- Use type hints for public functions and data models.
- Use Ruff for lint/format and mypy for static typing.
- Use Pydantic or explicit validation for protocol payloads.
- Never use `eval`, `exec`, `pickle`, or dynamic imports on scanned skill content.
- Never execute skill scripts during scanning.
- Keep provider SDKs optional extras.

## 4. Cross-language protocol

- JSON Schema is the contract source of truth.
- Every request/response includes `protocolVersion`.
- Protocol changes require schema updates, golden fixtures, and compatibility tests.
- Stdout contains protocol JSON only; stderr contains diagnostics.
- Errors are structured (`code`, `message`, `retryable`, optional safe details).
- Reject unknown major protocol versions.

## 5. Security and privacy

- Treat all scanned content as untrusted input.
- Redact secrets from logs, terminal output, and reports by default.
- Do not upload skill content to external services unless AI evaluation is explicitly enabled and disclosed.
- No telemetry in MVP.
- Do not log environment variables or provider credentials.
- Use bounded file sizes, timeouts, and recursion depth.
- Never follow symlinks outside the scan root.
- Avoid shell execution; any future subprocess feature requires a separate security review.

## 6. Testing and quality

- Every rule requires positive, negative, and boundary fixtures.
- Security rules require benign-lookalike fixtures to measure false positives.
- Bug fixes add a regression test.
- Keep tests deterministic and offline by default.
- LLM tests use mocked providers in normal CI; live-provider tests are opt-in and never required for PR approval.
- Track rule precision/recall against a versioned labelled corpus where feasible.
- Do not claim “secure”, “safe”, or “malware-free” based on a clean scan.

## 7. Pull requests

A PR should:

- Explain problem, design, and alternatives.
- Link an issue where practical.
- Include tests and docs.
- State security/privacy implications.
- Include sample output for CLI UX changes.
- Avoid unrelated formatting churn.
- Pass all required CI checks.

## 8. Release discipline

- Follow semantic versioning.
- Treat CLI flags, exit codes, rule IDs, and report schemas as public interfaces.
- Document rule changes and false-positive implications.
- Publish an SBOM and provenance attestations when the release pipeline supports them.
