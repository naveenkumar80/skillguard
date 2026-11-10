# Configuration

`skillguard.config.json` is strict JSON, at most 64 KiB. Pass `--config <file>`
explicitly; there is currently no implicit parent-directory discovery. Paths in
configuration resolve relative to the config file; an explicit CLI path resolves
relative to the working directory. Unknown keys/types/ranges fail with exit2.

Defaults are illustrated by `skillguard.config.example.json`. Profile
`agent-skills-current` is an alias to a **pinned** revision, not a moving network
lookup: see rules/FORMAT_PROFILE. Dependencies are installed from lockfiles; core
checks make no network requests.

- paths: nonempty list, default `['./skills']`; supports monorepos.
- exclude: additional minimatch glob patterns. Default exclusions always include
  node_modules, .git, .venv, dist and coverage. Hidden directories otherwise count.
- checks.spec: metadata conformance, default true.
- checks.structure: resource/reference checks, default true. Filesystem safety
  limits, forbidden object types, root boundaries and parser safety cannot be
  disabled. Duplicate names are always surfaced.
- checks.quality: optional advice, default false; never invents mandatory spec rules.
- checks.security: controls security scanning once implemented, not Python-free check.
- severityThreshold: info/low/medium/high/critical, default high.
- strict: fail on any deterministic finding, default false. AI remains advisory.
- engine: enabled true, timeoutMs15000, valid range1–120000. Basic check never invokes
  Python. Select a trusted interpreter with doctor --python or SKILLGUARD_PYTHON;
  never take an executable from skill content.
- aiEvaluation: currently only disabled settings accepted (enabled false, provider
  null, model null, maxCostUsd0). Live providers are not implemented. No API key
  is required, loaded, logged or forwarded.

Optional `limits` keys and defaults:

| Key           | Default | Accepted range |
| ------------- | ------- | -------------- |
| maxEntries    | 10000   | 1–100000       |
| maxFiles      | 1000    | 1–10000        |
| maxDepth      | 16      | 0–64           |
| maxFileBytes  | 262144  | 1–262144       |
| maxTotalBytes | 4194304 | 1–4194304      |

Limits bound discovery and text reads. A protocol request also has a 4MiB serialized
byte limit, including JSON escaping/metadata overhead. Exceeding a limit yields an
incomplete scan and a finding; it must not be interpreted as a successful clean
scan. Symlinks are excluded even if their destination is inside the root. Binary
assets are checked for existence, not parsed as text. Invalid UTF-8 definitions
fail closed. Reports omit raw skill evidence, but are still potentially sensitive
metadata: do not upload them automatically.
