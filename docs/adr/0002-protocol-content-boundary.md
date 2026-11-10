# ADR 0002 — bounded content protocol

- Status: Accepted for implementation
- Date: 2026-11-09

## Context

The unshipped starter used absolute root and skill paths, untyped finding objects,
and a Python scan that returned success without analysis. The approved architecture
requires JSON Schema, bounded subprocesses and offline deterministic operation.

## Decision

- Retain one JSON request/response and protocol version `1.0` (no released consumers).
- Send normalized relative file paths and bounded text, not filesystem authority.
  TypeScript alone owns discovery, exclusions, root checks and read limits.
- Canonical schemas live in `packages/protocol/schema` with offline URN IDs, not
  fictional public HTTPS schema endpoints. Ajv and jsonschema validate locally.
- Python wheel/sdist bundles those same canonical schemas with no runtime downloads.
- `doctor` declares capabilities. Unsupported scans fail with `NOT_IMPLEMENTED`;
  no empty-success placeholder is allowed.
- Use finding field `remediation` rather than the starter example `recommendation`,
  matching the master contract. No migration is required for unreleased consumers.
- 4 MiB request, 1 MiB stdout, 64 KiB stderr; per-file 262144 characters and 1000
  files. Default 15-second timeout, maximum 120 seconds. No shell or script launch.
- Isolated Python (`-I`) from the OS temporary directory with a minimal environment.
  No credentials, PYTHONPATH, user-site packages, HOME, or Python startup hooks.
- Output errors are content-independent. The caller does not display engine stderr
  or error messages, because they may contain scanned content.

## Alternatives and trade-offs

Passing roots to Python is simpler but duplicates filesystem policy and creates a
second file-read authority. Content transfer duplicates memory and limits large
scans, but is reproducible, independently testable, and reduces attack surface.
Long-running services complicate cancellation, state and installation without an
MVP benefit. A single language violates the approved architecture.

## Consequences

Schemas require reinstalling the editable Python package after changes because
Hatch force-included package data is copied. Use `uv sync --reinstall-package
skillguard-engine`. Installation from a wheel does not need repository paths.
A trusted interpreter must have this engine installed; system Python may not.
The selected runtime/installed package remains trusted; this is not a subprocess
sandbox or protection against a compromised engine. AI keys are never forwarded.
