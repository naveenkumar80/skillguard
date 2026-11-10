# Static security engine

## API and trust boundary

`skillguard_engine.security.scan(files)` accepts the protocol's validated,
bounded `[{"path": relative_label, "content": supplied_text}]` records and returns
`list[dict]` findings conforming to `finding.schema.json`. It does not discover
files or accept filesystem scan roots. Direct Python callers must supply the
same validated records; `handle_request` receives records validated by the
existing stdin protocol. The protocol still accepts **only** `doctor` and `scan`.

For `scan`, `handle_request` passes exactly `request["files"]` to this engine.
It does not open, stat, resolve, import, or execute the supplied paths. A path is
an output label, not authority to read a file. The engine works identically when
all labeled paths are nonexistent. Different bytes at a matching real path have
no effect. The only data resource opened by the rule engine is its own trusted,
versioned metadata catalog.

The scanner never runs a shell or subprocess, loads a skill module, evaluates an
expression, decodes a payload, imports a named input dependency, queries the
environment, accesses a package registry, resolves a hostname, or contacts the
network. Input Python, shell, Markdown, and configuration are all plain text.
References in metadata are inert documentation links. The existing `__main__`
validates every successful response's findings before printing one compact JSON
document and a newline; failures remain safe structured protocol errors.

Doctor and scan advertise capabilities `["doctor", "scan"]` and
`ruleSetVersion: "1.0.0"`. No new commands, options, schemas, or Python report-policy
semantics are introduced.

## Components

- `python/skillguard_engine/security/registry.py`: cached trusted resource loading,
  structural checks, immutable `Catalog` and `Rule` objects.
- `python/skillguard_engine/security/patterns.py`: 13 fixed lexical detectors and
  bounded filters for placeholders, English negation, removal flags, and pins.
- `python/skillguard_engine/security/dependencies.py`: the independent 14th rule,
  inspecting supplied npm/requirements declarations as bounded data only.
- `python/skillguard_engine/security/__init__.py`: finding construction, output
  budgeting, sorting, and the exported `scan` API.
- `packages/protocol/rules/security-v1.json`: the **single canonical metadata
  source** for Python and future CLI rule listings.

The loader checks `importlib.resources.files("skillguard_engine.security")` at
`catalog/security-v1.json`. As with protocol schemas, a Hatch editable install
may import source while force-included data lives in site-packages; the fallback
uses `distribution("skillguard-engine").locate_file(...)` at exactly
`skillguard_engine/security/catalog/security-v1.json`. There is no cwd lookup,
scan-path lookup, repository-relative fallback, environment override, or network
fallback. Missing/corrupt resources fail closed with a content-independent
`INTERNAL_ERROR` at the entry point; resource exhaustion becomes `RESOURCE_LIMIT`.
The metadata loader checks unique ordered IDs, supported versions/enums, bounded
text, and references; scan also checks exact catalog/detector ID agreement.

### Packaging

The parent-owned `pyproject.toml` force-includes:

- Wheel: `packages/protocol/rules/security-v1.json` →
  `skillguard_engine/security/catalog/security-v1.json`.
- Source distribution: `packages/protocol/rules/security-v1.json` →
  `packages/protocol/rules/security-v1.json`, so a wheel built from the sdist has
  the canonical source available for the same mapping.

A directory mapping from `packages/protocol/rules` to the corresponding
`skillguard_engine/security/catalog` wheel directory is also supported.
Reinstall the editable distribution after adding/changing resource mappings.
The installed-resource test compares bytes with the canonical catalog. The shared
doctor golden is parent-owned and advertises both capabilities and version
`1.0.0`; adding declaration analysis does not change it.

## Determinism, locations, and privacy

The same supplied records and catalog produce the same results without clocks,
randomness, hash iteration order, platform-dependent filesystem state, or network
state. Findings are sorted by `(path, line, column, ruleId)` using Python string
ordering. Lexical occurrences are reported individually; overlapping **different**
risks may produce different rule IDs. Declaration rule 014 emits at most one
advisory per physical source line, retaining the first unpinned declaration's
location. No severity policy, suppression, or deduplication across different rules
is applied.

Locations are 1-based Python Unicode **codepoint** positions, not UTF-8 byte,
UTF-16 code-unit, grapheme, or visual tab columns. The location is the start of
the recognized lexical pattern (for encoded shell execution, the decode command;
for package installs, the installer command; for declarations, the first unpinned
JSON version's opening quote or requirements line's first non-whitespace character).
`str.splitlines()` defines logical
lines, including LF, CRLF, CR and Python's other Unicode line separators. A tab,
combining mark, emoji codepoint, and variation selector each occupy their own
codepoint positions. No input normalization is performed.

All evidence is the exact static object
`{"redacted": true, "excerpt": "[REDACTED]"}`. All explanatory fields come from the
catalog, never interpolation of matches, partial tokens, payloads, URIs, or nearby
text. No input content is logged. Paths/locations are retained for review; path
labels are not secret-sanitized, so callers must not encode credentials into
filenames. Errors contain fixed messages and codes rather than Python exception
text, validation instances, or tracebacks. Tests exercise both stdout and stderr,
including overflow after earlier findings have already been accumulated.

## Resource limits

The unchanged protocol enforces 4 MiB of serialized request input, at most 1,000
files, 262,144 codepoints per file, 512-codepoint relative paths, and unique path
labels. Scan only receives that bounded text. Detectors are fixed stdlib regular
expressions applied per line; secret token sizes, URIs, shell argument windows,
flag repetitions, installation windows, and negation lookbehind are bounded.
There are no user-supplied regexes, broad dot-star searches across a document,
nested unbounded quantifiers, or expensive payload decoding. Declaration JSON has
an iterative, quote/escape-aware depth preflight (maximum 32) before stdlib JSON
parsing. Strict duplicate-key/non-finite rejection, ignored numeric conversion,
262,144-character input bounds, and fixed-error exception handling prevent parser
failures from exposing content or appearing as a clean scan. A structural token
walk locates only direct values of the four supported top-level npm dependency
sections; scripts and decoy fields are inert. JSON numbers in irrelevant fields
are not converted to large integers or floats. Requirement lines are capped at
4,096 codepoints, with bounded name/version/hash forms and an iterative marker
syntax checker. No marker is evaluated and no include or URL is followed.
The intent is bounded, linear-ish lexical matching, not a hard real-time guarantee.
The parent's existing subprocess deadline remains an independent defense.

The engine's finding cap is **1,000**, below the response schema's 10,000 ceiling.
It also caps serialized findings and the complete compact ASCII-safe success
response at **1 MiB including the final newline**, matching the existing transport
budget. The finding array is accounted incrementally to avoid building a huge
response; protocol dispatch checks the exact full envelope. JSON escaping of
Unicode paths is included in the budget. Limits are inclusive. When another
finding or the envelope would exceed a budget, the engine raises
`ProtocolError("RESOURCE_LIMIT", fixed_message)`. `__main__` emits a structured
failure with **empty findings**, not a clean-looking truncated scan. There is no
silent truncation or partial success. Sorting is at most `O(F log F)` for the
bounded number of findings.

## Why custom patterns instead of detect-secrets

This release deliberately uses **stdlib-only rule dependencies**, not
`detect-secrets` or a general-purpose secret scanner. Small fixed patterns make
provider shapes, exact boundaries, confidence labels, locations, static evidence,
no-I/O behavior, and resource limits directly reviewable and independently
testable. They also cover instruction and command risks outside the purpose of a
secret-scanning library. This is a scoped implementation choice, **not** a claim
that custom patterns outperform or replace mature secret scanners.

There is no entropy detector, exhaustive provider inventory, secret validity
check, general-purpose source-language parser, dataflow/taint analysis, shell interpretation, dependency
resolver, CVE feed, or comprehensive prompt-injection classifier. Adversaries can
split, obfuscate, encode, or rephrase content to evade these lexical rules, and
benign examples can trigger. Negative findings do not certify safety. Pair these
advisories with reviewed provenance, least privilege, separate secret scanning,
locked dependencies, sandboxing, approvals, and human review. No real-world
precision/recall or false-completeness claim is made.

Rules 013–014 are strictly **offline installation/declaration reproducibility
indicators**. They never install packages, inspect the runtime's installed
dependencies, follow requirement paths, or make vulnerability/CVE claims. Local
workspace/file references are not classified as vulnerabilities. Missing exact
pins are medium-severity advisories; malformed/unsupported declaration syntax
fails with a fixed `INVALID_DEPENDENCY_DECLARATION` error instead of silently
returning a clean success. An error discards all previously accumulated findings,
including lexical findings in other files. There are no protocol/schema or doctor
metadata changes. See
[`SECURITY_RULES.md`](../SECURITY_RULES.md) for every detector's scope and limitations.

## Validation

The versioned fixture corpora provide positive, negative, and boundary examples
for every stable ID, using synthetic values only. Tests assert full finding
schema compatibility and exact catalog metadata, redaction, Unicode locations,
command/identifier boundaries, contextual negation, repeatability, independent
risk reporting, count/byte limits, safe failures, immutable inputs, and canonical
installed resources. Execution/read/network entry points are trapped after the
trusted catalog is loaded; real isolated subprocess scans from unrelated working
directories verify no side-effect markers, byte-for-byte unchanged scripts, and
identical JSON output across processes.

After catalog changes, reinstall resources with
`uv sync --locked --reinstall-package skillguard-engine`. Targeted checks:

```sh
uv run pytest python/tests/test_security.py python/tests/test_protocol.py -q
uv run ruff check python/skillguard_engine/security python/skillguard_engine/protocol/__init__.py python/tests/test_security.py python/tests/test_protocol.py
uv run ruff format --check python/skillguard_engine/security python/skillguard_engine/protocol/__init__.py python/tests/test_security.py python/tests/test_protocol.py
uv run mypy python/skillguard_engine/security python/skillguard_engine/protocol/__init__.py python/tests/test_security.py python/tests/test_protocol.py
```
