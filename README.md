# SkillGuard

**Trust your skills before your agents run them.**

SkillGuard is an open-source assurance toolkit for AI agent skills. It validates skill structure and metadata, checks references and resources, scans for security risks, and runs repeatable tests before skills are used in an agent workflow.

> Status: architecture and project scaffold. The first executable release is not yet implemented.

## Why SkillGuard?

Agent skills can contain instructions, scripts, references, and other resources. A skill that looks plausible may still be malformed, reference missing files, expose secrets, or recommend unsafe operations. SkillGuard aims to make these risks visible in local development and CI.

SkillGuard is not a sandbox, malware detector, or guarantee that a skill is safe. Findings are evidence and guidance for human review.

## Design principles

- **Spec first:** separate format conformance from optional quality guidance.
- **Safe by default:** scanning never executes skill-provided scripts.
- **Deterministic core:** identical inputs and rule versions should produce reproducible findings.
- **Explainable findings:** every finding has a rule ID, evidence location, severity, and remediation.
- **AI is advisory:** optional LLM analysis never overrides deterministic results or suppresses critical findings.
- **Portable:** local CLI and GitHub Actions are first-class workflows.

## Planned capabilities

1. Validate `SKILL.md` frontmatter and required metadata.
2. Check directory structure and local references.
3. Detect likely secrets and risky instruction/script patterns.
4. Run deterministic fixture-based tests.
5. Optionally run LLM-assisted behavioral evaluations.
6. Emit terminal, JSON, Markdown, and later SARIF reports.

## Architecture

- `packages/cli`: TypeScript CLI and orchestration layer.
- `packages/protocol`: versioned JSON Schema contracts shared across runtimes.
- `python/skillguard_engine`: Python security-analysis engine and optional AI evaluation adapters.
- `tests/fixtures`: known-good, malformed, and adversarial sample skills.

The TypeScript CLI is the user-facing entry point. It invokes the Python engine through a versioned JSON-over-stdin/stdout protocol for checks implemented in Python. Python is an optional runtime dependency for basic format checks; advanced security and AI features require the engine.

## Source development (no public release)

```bash
npx --yes pnpm@9.15.0 install --frozen-lockfile
uv sync --locked
npx --yes pnpm@9.15.0 check
```

See [local setup](docs/development/LOCAL_SETUP.md) and the
[implementation tracker](docs/IMPLEMENTATION_TRACKER.md). The npm name
`@skillguard/cli` is occupied by an unrelated project; do not install it expecting
this code. Package names and repository identity require explicit approval.
No packages or public repositories have been published by this project.

## Project documents

- [Technical specification](docs/TECHNICAL_SPEC.md)
- [Architecture decision records](docs/adr/0001-hybrid-architecture.md)
- [Implementation backlog](docs/IMPLEMENTATION_PLAN.md)
- [Development standards](docs/DEVELOPMENT_STANDARDS.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [GitHub repository setup](docs/GITHUB_SETUP.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Current limitations

The initial scaffold does not yet implement the commands or security rules described above. Do not use it as a security gate until the implementation and test suite exist. Detection is necessarily incomplete and may produce false positives and false negatives.

## License

MIT. See [LICENSE](LICENSE).
