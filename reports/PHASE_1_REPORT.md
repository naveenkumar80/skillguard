# Phase 1 — architecture and protocol

Date: 2026-11-09. Status: TESTED locally. All Phase1 local acceptance checks passed;
no claim of hosted/cross-platform verification is made.

## Objective and changes

Implemented strict finding/rule metadata models, severity/confidence/categories,
versioned scan/doctor requests and structured responses. Canonical offline JSON
Schemas reject arbitrary properties and invalid findings; bounded content replaces
filesystem authority in the engine. See PROTOCOL, ARCHITECTURE and ADR 0002.

TypeScript uses isolated Python, no shell, an explicit environment allowlist,
neutral cwd, request/output limits, timeout and AbortSignal cancellation. It waits
for child close, validates responses, rejects findings outside the request, and
never prints raw engine diagnostics or arbitrary error messages. Python validates
strict UTF-8 JSON, duplicate keys, non-finite numbers, versions and schemas. Schemas
are packaged into wheels/sdists from one source. Doctor works; unimplemented scan
fails closed rather than returning false clean results.

## Required tests / actual results

`npx --yes pnpm@9.15.0 check`: passed after fixing Ajv strict schema annotations,
normalizing the golden response wire serialization test, and reinstalling editable
schema data. Includes build, lint, typecheck, **96 Vitest and 119 pytest tests**,
format checks. `node scripts/check-hygiene.mjs`: passed.

Tests include valid/invalid/oversized/versioned payloads, paths, duplicate keys,
redaction-safe failure messages, stderr/output caps, unavailable interpreter,
crash, timeout, pre/active cancellation, environment filtering, all finding fields,
AI-advisory threshold semantics, cross-language golden fixtures and actual Python
subprocess round trips. An actual Python child is killed on a 1ms deadline.

CLI smoke: `node packages/cli/dist/index.js doctor --python
.venv/Scripts/python.exe --format json`: passed, reports engine0.1.0 doctor-only,
AI disabled and releaseReady=false. Python wheel/sdist build and fresh offline
wheel install from unrelated cwd passed in delegated validation.

## Remaining / limitations

This phase is a transport foundation, not a scanner. Windows was tested locally;
three-OS CI remains pending. Maximum file size/total protocol size are deliberately
conservative. The direct child is terminated; there is no arbitrary process-tree
execution support. The engine/interpreter installation is trusted and not sandboxed.
Schema updates require editable-package reinstall. Rule implementation, filesystem
discovery, reference checks, report sanitization and optional AI belong to later
phases. Tests exceed the 100-test target numerically but do not substitute for
missing security-rule coverage, real-skill corpus or end-to-end release validation.
