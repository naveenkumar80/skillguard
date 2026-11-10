# Local development

## Requirements

- Node.js 22 LTS or newer (CI uses 22).
- pnpm 9.15.0. If absent, prefix commands with `npx --yes pnpm@9.15.0`.
- Python 3.11+ and uv 0.11.28 (CI uses Python 3.11).
- Git. No external AI credentials are needed.

From the repository root:

```sh
npx --yes pnpm@9.15.0 install --frozen-lockfile
uv sync --locked
npx --yes pnpm@9.15.0 check
node scripts/check-hygiene.mjs
```

`uv sync` creates `.venv` locally; activation is unnecessary with `uv run`.
On Windows the interpreter is `.venv/Scripts/python.exe`; on POSIX it is
`.venv/bin/python`. Installations download dependencies, not scanned skills.
No telemetry or AI requests are enabled. `.env` is not automatically loaded.

## Individual checks

```sh
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 format:check
uv run python -c "import skillguard_engine; print(skillguard_engine.__version__)"
uv build
```

Formatting: `npx --yes pnpm@9.15.0 format`. Do not format unrelated user work.
Engine invocation and CLI capabilities are documented in the phase reports;
commands are not considered implemented just because they appear in the roadmap.

## Publication hold

Do not install this project from the provisional npm name: it belongs to an
unrelated project. Source development only. Package identity, repository owner,
private security reporting contact, and release approval remain unresolved.
