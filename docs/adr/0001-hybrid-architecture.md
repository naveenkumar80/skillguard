# ADR 0001: Hybrid TypeScript and Python Architecture

- Status: Accepted for MVP
- Date: 2026-11-09

## Context

SkillGuard needs a CLI that fits modern JavaScript/agent development workflows, while benefiting from Python's security-analysis and AI-provider ecosystem. A single-language implementation would simplify packaging, but the project has explicitly selected a hybrid design.

## Decision

- TypeScript owns the CLI, configuration, discovery, deterministic format checks, fixture-based test runner, report aggregation, and user experience.
- Python owns advanced static security analyzers and optional LLM evaluation adapters.
- The two runtimes communicate through a versioned JSON-over-stdin/stdout protocol defined by shared JSON Schema.
- The Python engine is optional for basic checks; advanced scanning and AI features require it.
- No scanned skill code is executed.

## Consequences

Positive:

- CLI integrates naturally with Node-based agent workflows.
- Python security and AI ecosystem can be used where it adds value.
- Protocol boundary enables independent tests and future language adapters.

Costs:

- Two package ecosystems and release processes.
- Subprocess startup and protocol maintenance.
- More complex installation and cross-platform CI.
- Need explicit compatibility/version policy.

## Alternatives considered

1. TypeScript only: simpler install and maintenance, but less direct reuse of Python security/AI libraries.
2. Python only: simpler security engine, but less natural integration for Node-first users.
3. Long-running local service: unnecessary operational complexity for a CLI MVP.

## Revisit when

If the hybrid boundary causes high install friction or low adoption, measure it and consider consolidating the engine. Do not change languages based only on preference; use contributor feedback, install success, and maintenance cost.
