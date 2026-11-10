# Engine protocol 1.0

Source of truth: `packages/protocol/schema/`. Both runtimes reject unknown fields,
invalid enum values and incompatible versions. No schema URLs are fetched.

## Request

```json
{
  "protocolVersion": "1.0",
  "command": "doctor",
  "files": []
}
```

`scan` accepts `files: [{"path": "example/SKILL.md", "content": "untrusted text"}]`.
Files are data, never executed. Paths are relative POSIX labels, not Python file
access instructions. Reject absolute, drive, UNC, backslash, dot/traversal,
NUL/control paths and duplicate paths. Limit 1000 files, 262144 characters per
file, 512-character path and 4 MiB serialized request. Doctor requires no files.

## Responses

Success includes `protocolVersion`, `ok: true`, `findings`, and `engine`
(`version`, `capabilities`, nullable `ruleSetVersion`). Failure includes
`ok: false`, empty findings, and `error` (`code`, safe `message`, `retryable`).
Success cannot have an error; failure cannot have engine metadata or findings.
Engine stdout is one JSON document plus newline. Diagnostics use stderr only.
The engine exits 0 on success and 3 on structured errors.

Findings contain schemaVersion, stable ruleId, title, category, severity,
confidence, relative path, 1-based line/column, message, redacted evidence,
remediation and references. Evidence must be marked redacted. Schema validation
cannot itself prove redaction: rule tests and report sanitization remain required.

## Taxonomy

Categories: spec, structure, quality, security, test, ai-evaluation.
Severity describes potential impact: info (context), low (minor risk), medium
(review required), high (serious security/integrity risk), critical (urgent
credential or destructive-impact concern). Confidence is low, medium or high and
reflects detector reliability, not impact. A match is never proof of maliciousness.
AI findings are advisory and excluded from deterministic threshold decisions.

## Transport and errors

TypeScript uses asynchronous spawn with argument arrays and `shell: false`,
`python -I -m skillguard_engine`, neutral cwd and explicit environment allowlist.
`SKILLGUARD_PYTHON` or doctor `--python` selects a trusted executable only, not a
shell command; `.env` is not auto-loaded. Allowed environment names (case-insensitive
for Windows): PATH, SYSTEMROOT, WINDIR, SYSTEMDRIVE, TEMP, TMP, LANG, LC_ALL.
No API keys or Python hooks are inherited. The engine never reads scan paths.

Default timeout 15000 ms (1–120000 configurable), AbortSignal cancellation,
1 MiB stdout and 64 KiB stderr caps. Limits terminate the direct child and the
caller waits for close. No skill-created descendant processes are supported.
Caller errors: ENGINE_UNAVAILABLE, TIMEOUT, CANCELLED, OUTPUT_LIMIT,
INVALID_JSON, INVALID_RESPONSE, UNSUPPORTED_PROTOCOL, ENGINE_CRASH,
REQUEST_TOO_LARGE, INVALID_REQUEST, INVALID_OPTIONS. Engine failures include
INVALID_ENCODING, INVALID_JSON, INVALID_REQUEST, RESOURCE_LIMIT, NOT_IMPLEMENTED
and INTERNAL_ERROR. Raw input, stderr, and arbitrary engine error messages never
appear in CLI diagnostics.

Python strictly rejects duplicate JSON keys, non-finite numbers and invalid UTF-8.
Golden fixtures are shared across languages. Unknown protocol versions are rejected
rather than silently coerced; future compatibility changes require an ADR/tests.

After changing schemas: `uv sync --reinstall-package skillguard-engine`.
See ADR 0002 for rationale and packaging constraints.
