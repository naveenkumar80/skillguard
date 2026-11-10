# Contributing to SkillGuard

Thanks for helping improve SkillGuard.

## Before opening an issue

Search existing issues and include:

- SkillGuard version and runtime versions.
- Operating system.
- Minimal reproduction or fixture.
- Expected and actual behavior.
- Whether the report contains sensitive content (do not paste credentials).

## Pull requests

1. Discuss substantial changes in an issue first.
2. Keep PRs focused.
3. Add tests, fixtures, and documentation.
4. Include security and privacy impact.
5. Run the relevant lint and test commands.
6. Do not add real secrets, private skill content, or personal data.

## Rule contributions

Every rule must include a stable ID, category, default severity, rationale, remediation, references, positive fixture, negative/benign fixture, and boundary fixture where applicable. Avoid rules that claim to prove intent or maliciousness from a single phrase.

## Development status

The project is under active implementation, not release-ready. Follow
[local setup](docs/development/LOCAL_SETUP.md), run `pnpm check` and
`node scripts/check-hygiene.mjs`, and review
[the implementation tracker](docs/IMPLEMENTATION_TRACKER.md). APIs may change
before v0.1.0; released rule IDs will be stable. Use conventional commit prefixes
and do not publish packages, create public repositories, or release without approval.
