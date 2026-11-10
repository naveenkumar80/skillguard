# Project status

Development only; **not release-ready**. No public repository, package, or release
is authorized. SkillGuard is a working name, not an approved identity.

The initial source audit found documentation and a scaffold, not a working scanner.
Foundation implementation is under validation. See
[the implementation tracker](IMPLEMENTATION_TRACKER.md) and `reports/` for measured
progress. Do not use this checkout as a security gate until scanning and its
regression tests are implemented.

## External blockers

- npm `@skillguard/cli` is already registered to another project (registry checked
  2026-11-09). Do not use README commands from unrelated products.
- Multiple GitHub projects already use SkillGuard for agent-skill scanning.
- PyPI `skillguard-engine` returned HTTP 404 on 2026-11-09; availability is not
  guaranteed or reserved. GitHub owner and desired slug are unspecified.
- A maintainer-approved identity and private reporting contact are required.
- Hosted CI and three-OS evidence require a repository/runner; local checks are
  not a substitute for observed hosted CI success.

No AI provider calls or spending have occurred. No skill scripts are executed.
