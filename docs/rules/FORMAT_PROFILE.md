# Agent Skills format profile

Profile/rule version: **1.0.0**. Implemented by
`packages/cli/src/validators/format.ts`; covered by
`packages/cli/tests/format.test.ts` and
`tests/fixtures/invalid-frontmatter/`.

## Pinned authority

This profile follows the [Agent Skills specification at commit
`83021e2be457a9b6679148719c1f6074f0ad975e`](https://raw.githubusercontent.com/agentskills/agentskills/83021e2be457a9b6679148719c1f6074f0ad975e/docs/specification.mdx).
The commit URL, not the moving main branch, is the authority for these rules.
Parser safety restrictions below are local implementation limits, not additional
upstream authoring requirements.

Only `name` and `description` are mandatory metadata. Unknown fields are allowed:
the pinned specification does not clearly prohibit them. The Markdown body has
**no required heading, section, or minimum length**; an empty body is valid,
including the upstream minimal example. Directory discovery and filesystem
checks are outside this pure validator.

## API and ownership

```ts
validateFormat(
  content: string,
  relativePath: string,
  directoryName: string,
  quality = false,
): {
  findings: Finding[];
  name: string | null;
  body: string;
  bodyStartLine: number;
};

formatRules: RuleMetadata[];
```

- The caller supplies already-read content, a safe report-relative path, and the
  actual containing directory name. There is no filesystem, network, discovery,
  path resolution, or execution in the validator. The supplied path is carried
  unchanged into findings; path validation/redaction belongs to the caller.
- `name` is returned only when its syntax and length are valid. It can be used by
  the caller for duplicate detection, even if the directory differs or another
  field is invalid. Malformed/unsafe YAML returns `null`. Duplicate detection is
  not performed here. The name is never interpolated into a finding.
- `body` preserves the exact substring after the closing delimiter, including
  its original line endings. `bodyStartLine` is its **1-based** original starting
  line, including when the body is empty or the closing delimiter is at EOF.
- If delimiters can be found, body extraction succeeds even when the YAML is
  invalid. If either delimiter is missing, the complete original content is
  returned as `body`, with `bodyStartLine: 1`; no boundary is guessed.
- The opening delimiter must be the first line, optionally preceded by a UTF-8
  BOM decoded as U+FEFF. Both delimiters are standalone `---` lines; trailing
  spaces/tabs are accepted. LF and CRLF are supported. The closing delimiter may
  be at EOF. Indented `---` within a block scalar does not end frontmatter.

## Stable rules

All `SG-SPEC-*` findings have category `spec`, severity `high`, and confidence
`high`. `SG-STRUCT-008` has category `structure`, severity `high`, and confidence
`high`; it is independent of the quality flag. `SG-QUAL-001` has category
`quality`, severity `info`, and confidence `high`, and is emitted only with
`quality: true`. Every rule includes a remediation and the pinned reference in
`formatRules` and its findings.

| ID              | Constraint                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SG-SPEC-001`   | Required delimited YAML mapping; reject actual malformed YAML, unresolved/forward aliases, and duplicate mapping keys.                               |
| `SG-SPEC-002`   | Required string `name`, 1–64 Unicode code points; lowercase Unicode letters or numbers with optional single interior hyphens.                        |
| `SG-SPEC-003`   | A syntactically valid name must exactly equal the containing directory name supplied by the caller.                                                  |
| `SG-SPEC-004`   | Required string `description`, 1–1024 Unicode code points and not whitespace-only.                                                                   |
| `SG-SPEC-005`   | Optional `compatibility`, a string of 1–500 Unicode code points if present.                                                                          |
| `SG-SPEC-006`   | Optional `metadata`, a YAML mapping from string keys to string values.                                                                               |
| `SG-SPEC-007`   | Optional `license`, a string if present.                                                                                                             |
| `SG-SPEC-008`   | Optional experimental `allowed-tools`, a string if present.                                                                                          |
| `SG-STRUCT-008` | Parser safety limit or unsupported YAML construct: local size/node/depth/alias caps, unsupported tags, cyclic aliases, and parser resource failures. |
| `SG-QUAL-001`   | Optional advice when the complete `SKILL.md` exceeds 500 lines; never a specification violation.                                                     |

The registry order is stable. For malformed or unsupported YAML, field checks
are skipped to avoid cascading or misleading diagnostics. Invalid names do not
also cause directory mismatch findings. Optional quality advice is independent
and, when applicable, is emitted before specification or structure findings.

**Caller integration:** `format.findings` now includes `structure` as well as
`spec` and optional `quality` findings. The parent's `check.ts` must retain the
structure category when consuming this result; a filter accepting only `spec`
and `quality` would silently discard parser safety failures. Keep
`SG-STRUCT-008` in `formatRules`; the parent's separate `structureRules` owns
`SG-STRUCT-001` through `SG-STRUCT-007`.

### Interpretation of character and field constraints

The upstream name wording says “unicode lowercase alphanumeric” but also gives
ASCII examples `a-z` and `0-9`. This profile explicitly interprets that as
**Unicode general categories `Ll` (lowercase letter) and `N` (number)**, not an
ASCII-only restriction. The exact pattern is:

```text
^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$
```

For example, `école-١٢` is accepted. Uppercase/titlecase letters, uncased letters
(such as Chinese ideographs), combining marks, whitespace, underscores, emoji,
and leading/trailing/consecutive hyphens are not accepted by this interpretation.
No Unicode normalization or case folding is performed; directory comparison is
exact. Composed `é` is accepted, while `e` followed by a separate combining accent
is not. Lengths count decoded Unicode code points, not UTF-16 code units or YAML
source characters; supplementary-plane lowercase letters count as one.

YAML values must actually have the required type: an unquoted numeric value is
not coerced to a string. Quote numeric names and metadata versions. An optional
field explicitly set to YAML `null` is present and invalid, rather than omitted.
Empty metadata mappings and empty string metadata keys/values are allowed.
`description` is rejected if whitespace-only, but its original whitespace counts
toward its length limit. `compatibility` has only its stated type/length checks;
a one-character whitespace string meets those checks. No additional minimum or
maximum length is invented for `license` or `allowed-tools`, so empty strings
are accepted. Tools syntax and tool availability are not enforced; the field is
experimental upstream.

## YAML safety profile

The existing CLI dependency `yaml@2.9.1` is used through `parseDocument`:

- YAML 1.2 core schema, strict parsing, and unique mapping keys.
- No custom tags, legacy known-tag resolution, or merge-key expansion. Explicit
  core tags such as `!!str` work. Unsupported tag warnings cause a generic
  `SG-STRUCT-008` rejection rather than silently trusting a coerced value or
  incorrectly declaring a specification violation.
- `prettyErrors: false` and `logLevel: "error"`. `parseDocument` returns diagnostics
  without printing them; neither exceptions nor diagnostics are forwarded to the
  caller or console. Do not change this to `"silent"`: in `yaml@2.9.1` that setting
  suppresses the multiple-document error, silently accepting trailing documents.
- No `toJS`, `toJSON`, JavaScript object construction from mappings, alias
  expansion, or parser-provided recursive alias resolution. Prototype-like keys
  are inert AST data, not object properties.
- Bounded scalar and mapping aliases are supported through an AST graph. Anchors
  are resolved in source order. Forward/unresolved aliases are malformed YAML
  (`SG-SPEC-001`), while cyclic aliases are rejected by the local safety profile
  (`SG-STRUCT-008`), not by an invented upstream constraint. Shared nodes are
  memoized rather than expanded. Duplicate scalar, aliased, and structural
  collection keys are rejected as invalid YAML (`SG-SPEC-001`), including nested
  and unknown-field mappings.

The fixed safety limits are:

| Limit                          | Maximum                                              |
| ------------------------------ | ---------------------------------------------------- |
| Frontmatter source length      | 262,144 UTF-16 code units, excluding delimiter lines |
| Physical AST nodes             | 10,000; mapping pairs themselves are not counted     |
| Physical and alias-graph depth | 64 nodes along any path, with the root mapping at 1  |
| Alias references               | 100 throughout the complete frontmatter              |

Length is bounded before parsing. AST size, depth, and aliases are checked before
field validation; graph inspection never expands aliases. These are resource
limits of this local parser profile, **not claims that upstream forbids all
larger YAML documents**. Inputs beyond them receive `SG-STRUCT-008`, never a
specification violation merely for exceeding a local resource limit. The same
structure rule covers unsupported tags, cyclic aliases, parser warnings, parser
resource-exhaustion errors, and unexpected parser exceptions. A parser failure
alone is not proof that the source violates the specification.

Actual syntax errors and duplicate mappings remain `SG-SPEC-001`. If a document
has both a syntax error and an unsupported-tag warning, the syntax error takes
precedence. A parser resource-exhaustion error instead takes precedence over
potentially cascading syntax diagnostics. No raw diagnostic text is included in
either category.

## Evidence and source locations

Every finding has `evidence: { redacted: true, excerpt: "[REDACTED]" }`.
Messages, titles, remediation, and references are fixed rule text. No raw YAML
keys (including arbitrary metadata keys), values, body text, supplied directory
name, or parser error strings are interpolated into findings. Static mentions of
known schema fields in rule descriptions are not copied from input.

All finding positions are **1-based**. Field locations come from AST key ranges,
not regex searches for potentially secret field names. Invalid nested metadata
uses the offending key's range without displaying that key. Parser failures use
only the numeric offset from the parser. Missing fields use the first
frontmatter line; missing delimiters use line 1, column 1. BOM and CRLF offsets
are retained. Columns follow JavaScript/YAML UTF-16 offsets.

The returned `body` and valid `name` are intentionally source data for downstream
validators; they are **not redacted report evidence**. Callers must not dump the
entire return value into logs or reports.

## Quality advice and exclusions

The pinned upstream recommends progressive disclosure and keeping the main file
under 500 lines. This profile uses **more than 500 physical lines** as its advice
threshold, tolerating the exact 500-line boundary. It counts the complete file,
including frontmatter, and does not count a final newline as an extra empty line.
The advice points to line 501. It is disabled by default and does not change the
validity of the body or metadata.

This validator does not require headings, examples, scripts, a license,
compatibility declarations, metadata entries, allowed tools, or any other
invented mandatory fields. It does not reject unknown fields, assess description
quality, inspect links, perform filesystem checks, detect cross-skill duplicate
names, or execute skill content.

## Focused validation commands

From the repository root, with lockfile dependencies installed:

```sh
pnpm exec vitest run packages/cli/tests/format.test.ts
pnpm exec eslint packages/cli/src/validators/format.ts packages/cli/tests/format.test.ts
pnpm --filter @skillguard/cli typecheck
pnpm exec prettier --check packages/cli/src/validators/format.ts packages/cli/tests/format.test.ts docs/rules/FORMAT_PROFILE.md
```

Tests cover every rule's positive/negative behavior and relevant type, length,
and safety boundaries; BOM/CRLF and body extraction; alias graphs and duplicate
mappings; stable IDs; contract-compatible findings; and secret-redaction
regressions. Fixture reads occur only in tests, never in the validator.
