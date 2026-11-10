# Project structure

| Location                     | Responsibility                                                              |
| ---------------------------- | --------------------------------------------------------------------------- |
| `packages/cli/src`           | TypeScript CLI, configuration, discovery, validators, testing and reporting |
| `packages/cli/src/engine`    | Bounded subprocess orchestration, no shell invocation                       |
| `packages/protocol/schema`   | Canonical versioned JSON Schema boundary contracts                          |
| `packages/protocol/fixtures` | Cross-language golden protocol inputs and outputs                           |
| `python/skillguard_engine`   | Python package: protocol, static security rules and optional AI adapters    |
| `python/tests`               | Python unit, schema compatibility and security tests                        |
| `tests`                      | Integration, fixture corpus and repository hygiene tests                    |
| `scripts`                    | Portable development and repository validation utilities                    |
| `docs`                       | Product contracts, decisions, implementation tracking and setup             |
| `reports`                    | Redacted implementation and validation records, not private scan artifacts  |
| `.github`                    | Least-privilege CI and contribution templates                               |

`package.json` and `pnpm-workspace.yaml` own JavaScript workspace configuration.
Root `pyproject.toml` owns the single Python project; an extra Python workspace
would add no isolation. The nested starter manifest was removed to prevent
conflicting build/test roots. Both dependency ecosystems have lockfiles.

Do not add empty directories to imply implementation. Public package names remain
provisional; workspace packages are private. Generated scan artifacts belong in
ignored `.skillguard/`, not tracked implementation reports.
