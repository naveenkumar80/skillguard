# Continuous integration and repository hygiene

## Required checks

`.github/workflows/ci.yml` runs the same job on `ubuntu-latest`, `windows-latest`,
and `macos-latest`, using Node.js 22 and Python 3.11. It runs for pull requests,
pushes to `main`, and manual dispatches. Jobs have a 20-minute timeout; a failing
matrix entry does not cancel the others. New runs cancel obsolete runs on the
same ref.

Each job checks repository hygiene before installing dependencies, installs uv
0.11.28 with the selected Python, and executes:

```sh
node scripts/check-hygiene.mjs
python -m pip install --disable-pip-version-check uv==0.11.28
npx --yes pnpm@9.15.0 install --frozen-lockfile
uv sync --locked
npx --yes pnpm@9.15.0 check
```

`UV_PYTHON=3.11` and `UV_PYTHON_DOWNLOADS=never` ensure uv uses the configured
interpreter. The root `check` script actually builds the workspaces, runs ESLint
and Ruff, checks TypeScript and mypy types, runs Vitest and pytest, and checks
Prettier and Ruff formatting. Lockfile drift fails installation rather than
rewriting either lockfile. `npx` selects pnpm 9.15.0 without requiring a pnpm setup
action; pnpm makes itself available to nested package scripts.

For a targeted local test after installing JavaScript dependencies:

```sh
npx --yes pnpm@9.15.0 exec vitest run tests/hygiene.test.ts
```

The tests create small temporary repositories, generate an ephemeral Ed25519
private key in memory, and assemble synthetic tokens at runtime. They do not scan
the real dependency directories or require network access. Directory-symlink
tests use junctions on Windows so developer-mode privileges are unnecessary.

## Permissions and CodeQL

Both workflows use only `contents: read`, disable persisted checkout credentials,
and use `pull_request`, never `pull_request_target`. Fork pull requests receive
no repository secrets and need no write-capable token. Do not add secrets to
these jobs: installing dependencies and running PR code is intentionally
untrusted execution on disposable GitHub-hosted runners.

`.github/workflows/codeql.yml` analyzes JavaScript/TypeScript and Python in
separate Ubuntu jobs, with a 30-minute timeout, on the same events plus a weekly
Monday schedule. Both languages use `build-mode: none`; analysis requires no
package installation or execution of repository build scripts. Dependency and
build directories are excluded from analysis.

CodeQL explicitly uses `upload: never` and `upload-database: false`, disables
combined-SARIF debug artifacts and dependency/TRAP caching, and selects
`CODEQL_OVERLAY_DATABASE_MODE=none` to prevent automatic database-cache uploads.
A guard fails debug-logging reruns before CodeQL initialization: upstream debug
mode would otherwise upload diagnostic reports and databases even when normal
uploads are disabled. Rerun this workflow without the debug-logging option.
Neither workflow uploads artifacts, SARIF, scan reports, or databases. There is no
`security-events: write` permission, including on trusted branches. Results remain
on the ephemeral runner: this validates analysis execution, **not** a
severity-based findings gate or a published Security-tab report. Do not infer
that a green CodeQL job means there are no findings. A later reporting or
findings-gating phase needs an explicit policy and permission review. GitHub's
normal workflow logs and CodeQL service metadata are not secret-report storage.

## Verified action pins

All action references are full upstream commit SHAs. The following were resolved
with read-only `git ls-remote` during implementation. The CodeQL v4 tag is
annotated; its peeled `^{}` commit, not its tag-object SHA, is used.

| Action repository      | Ref               | Commit                                     |
| ---------------------- | ----------------- | ------------------------------------------ |
| `actions/checkout`     | `refs/tags/v4`    | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node`   | `refs/tags/v4`    | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/setup-python` | `refs/tags/v5`    | `a26af69be951a213d495a4c3e4e4022e16d87065` |
| `github/codeql-action` | `refs/tags/v4^{}` | `33d7b85da1a04171e211befe2c739303b9a4c066` |

To refresh pins, resolve the upstream refs again, review the corresponding
upstream changes, and update both workflows and this table together:

```sh
git ls-remote https://github.com/actions/checkout.git 'refs/tags/v4' 'refs/tags/v4^{}'
git ls-remote https://github.com/actions/setup-node.git 'refs/tags/v4' 'refs/tags/v4^{}'
git ls-remote https://github.com/actions/setup-python.git 'refs/tags/v5' 'refs/tags/v5^{}'
git ls-remote https://github.com/github/codeql-action.git 'refs/tags/v4' 'refs/tags/v4^{}'
```

CodeQL's pinned action inputs and upstream post-action/debug/overlay code were
also checked for upload behavior and the controls above. Action runtimes are
separate from the project's Node.js version; the
CodeQL v4 action uses Node.js 24 internally while project checks use Node.js 22.

## Hygiene policy

`scripts/check-hygiene.mjs` is portable, dependency-free Node.js. Run it directly;
it does not need a package script or a Git executable. The default root is the
repository containing the script, independent of the current working directory.
An optional positional root is useful for isolated checks:

```sh
node scripts/check-hygiene.mjs /path/to/source
```

The scanner walks all source files on disk, including untracked files and ignored
local environment files. This is a superset of committed source; local `.env`
files must be kept outside this tree when running the check. It does not inspect
Git history. The rules are:

- Reject files, directories, or symlinks named `.env` or `.env.*`, except the exact
  basename `.env.example` (case-insensitive). An allowed example is still scanned
  for credentials; `.env.example.local` is not allowed.
- Detect complete matching PEM private-key blocks, including RSA, EC, DSA,
  OpenSSH, and encrypted variants, with at least 64 base64 characters and valid
  base64 shape. Traditional PEM encryption headers are supported. Public keys,
  short examples, and non-base64 placeholders are not private-key findings.
- Detect common recognizable GitHub classic/OAuth/app and fine-grained tokens,
  npm tokens, PyPI tokens, and Slack tokens. These checks recognize formats, not
  whether a credential is live. Unknown token formats, generic passwords,
  encrypted archives, binary/UTF-16 files, and obfuscated secrets are outside this
  baseline. This is not a replacement for dedicated secret scanning or rotation.
- Report only relative paths and rule names, never matched values, source lines,
  or file contents. Exit nonzero on findings or an unreadable root/source file.
  Binary files containing NUL bytes are skipped. Symlinks are not followed,
  including symlinks to files; a forbidden environment-file symlink still fails.

At every depth, the walker excludes `.git`, `node_modules`, `.venv`, `dist`,
`coverage`, `__pycache__`, `.cache`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`,
`.pnpm-store`, `.turbo`, `.next`, `.nuxt`, `.parcel-cache`, `.tox`, and `.nox`.
It also skips `*.egg-info` directories, after checking for forbidden environment
names. No broad `tests/`, `fixtures/`, or documentation exclusion exists.

### Narrow synthetic-fixture exception

Only `tests/fixtures/hygiene/synthetic-secrets.txt` may contain these two exact
synthetic values without a finding:

1. A generic `PRIVATE KEY` PEM block whose whitespace-stripped body is exactly
   128 uppercase `A` characters.
2. A GitHub classic-token-shaped string assembled from `ghp_` followed by exactly
   36 uppercase `A` characters.

The exception is value-specific **and** path-specific. Real generated keys,
other token values, other key labels, other fixture paths, and `.env` paths are
never exempt. No fixture file needs to be committed: tests exercise the helper
with that virtual path. Do not broaden the exception to directories or suppression
comments. Tests verify both the positive detections and the negative cases,
filesystem exclusions, failure exit codes, symlink handling, and redacted output.
If a real credential is found, remove it and rotate it; do not add an exception.
