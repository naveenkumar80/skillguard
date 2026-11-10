# Resource and reference validation

Rule version: **1.0.0**. Implementation:
`packages/cli/src/validators/references.ts`. Focused tests:
`packages/cli/tests/references.test.ts`. Fixtures live in
`tests/fixtures/broken-references/`, `tests/fixtures/traversal/`, and
`tests/fixtures/benign-lookalikes/`.

These are local filesystem safety, structure, and optional quality checks, **not
additional Agent Skills specification requirements**. They do not assess whether
a referenced script is safe to run.

## API and ownership

```ts
export async function validateReferences(
  context: CheckContext,
  config: Config,
): Promise<Finding[]>;

export const referenceRules: RuleMetadata[];
```

The caller supplies a canonical inventory root, inventory-relative file labels,
and safely read Markdown in `context.contents`, normally the initial `SKILL.md`
files. A full inventory is essential: referenced files do not become eligible
for reading merely because they happen to exist on disk.

The validator returns findings. It **does not mutate** `context.report`, skill
results, inventory entries, completeness flags, or the root. Its only context
mutation is adding safely read, linked `.md` text to `context.contents`. The
parent owns invocation, rule-registry integration, adding/filtering findings,
skill validity, completeness policy, and reports. In particular, the parent must
retain high-severity structure findings and must not claim complete resource
coverage when references were omitted, symlinked, unreadable, or limited.

Structure/safety findings are returned independently of the spec and quality
flags. Duplicate-reference advice is emitted only when
`config.checks.quality === true`; the parent owns any broader check selection.

## Stable rules

All rules have confidence `high` and version `1.0.0`. Findings include static
remediation text and an empty external-references array; no upstream authority
is claimed for these local restrictions.

| ID           | Category    | Severity | Meaning                                                                                           |
| ------------ | ----------- | -------- | ------------------------------------------------------------------------------------------------- |
| `SG-REF-001` | `structure` | `high`   | A local target is missing, including a previously inventoried file that has disappeared.          |
| `SG-REF-002` | `structure` | `high`   | Unsafe path, unsupported scheme, ambiguous encoding, or entry into another skill's boundary.      |
| `SG-REF-003` | `structure` | `high`   | A symlink occurs at the target or any intermediate component; it is not followed.                 |
| `SG-REF-004` | `structure` | `high`   | Validation is incomplete because of limits, unreadable/invalid Markdown, or parser/read failures. |
| `SG-REF-005` | `structure` | `high`   | The target is excluded or exists but is absent from inventory; validation is explicitly omitted.  |
| `SG-REF-006` | `quality`   | `info`   | Optional, low-impact duplicate-reference advice within one Markdown document.                     |

Missing, unsafe, omitted, or unreadable targets are never silently considered
valid. An unindexed target is checked for existence and symlinks with
`assertSafePath`, but **never read**. A missing unindexed target receives
`SG-REF-001`; an existing unindexed target receives `SG-REF-005`, even if the
inventory is marked complete. An excluded target receives `SG-REF-005` without
filesystem probing, regardless of whether it exists. Exclusions apply both to
the target and each ancestor directory, matching discovery's directory pruning.

## Markdown parsing and positions

The installed **`markdown-it@15.0.3`** parses links; link discovery is not a regex
scan. The validator handles inline links, image destinations, full reference
links, collapsed references, shortcut references, and explicit autolinks.
Reference definitions are resolved by the parser; unused definitions and
undefined reference labels do not themselves become resource references.

HTML parsing and automatic bare-URL linkification are disabled. The parser's
link validation is deliberately overridden so normally rejected schemes such as
`javascript:` and `data:` still produce tokens and can be **reported**, not
silently ignored. URL normalization is disabled to inspect parser-unescaped
local destinations without browser-style normalization. No output is rendered.

A delimited leading YAML frontmatter block is blanked before Markdown parsing;
its text is not inspected as Markdown. Opening and closing delimiters must be
unindented `---` lines, optionally with trailing spaces/tabs; an initial BOM is
supported. If the envelope is not closed, the complete document is parsed rather
than guessing where its Markdown begins. Linked resource Markdown does not need
frontmatter or a `SKILL.md` name.

Every finding points to the **referring Markdown file**, not the destination.
Lines come from token maps and are conservative, **1-based** block/inline
starting lines. A multiline paragraph's link may be attributed to its first
line, not the exact line of the link. Tokens without their own map, such as table
cells, inherit the nearest preceding mapped block's starting line. Frontmatter
blanking retains original line counts, including BOM/CRLF inputs. Columns are
always `1`; exact inline columns are not claimed.

Fenced/indented code, inline code, escaped link syntax, image alt-text hyperlinks,
and raw HTML attributes are not inspected as links. In particular, a plain code
span such as **`scripts/name.py` is unsupported** as a resource reference; write
an actual Markdown link if it should be checked. Malformed syntax that the
Markdown parser treats as text is likewise not treated as a link. Heading/anchor
existence and remote URL availability are not validated.

## Local path policy

- Explicit `http:`, `https:`, and `mailto:` schemes are ignored, case
  insensitively, without fetching. Fragment-only destinations beginning with
  `#` are also ignored. There is no DNS, network, or script execution.
- All other explicit schemes are rejected, including `file:`, `data:`,
  `javascript:`, drive-letter paths, and unknown/custom schemes. Scheme-relative
  URLs (`//host/path`) are not treated as remote URLs: they are rejected as
  ambiguous absolute/UNC paths.
- For local references, the literal query/fragment suffix is stripped before
  filesystem resolution. It cannot make an unsafe pathname safe. Empty or
  query-only paths are rejected; use a fragment-only reference for an anchor in
  the current document.
- Pathname percent encoding is decoded **once**, with malformed sequences and
  invalid UTF-8 rejected. Ordinary encoded filenames, such as `a%20b.md` and
  `caf%C3%A9.md`, work. Encoded separators (`%2f`, `%5c`), decoded colons,
  query/fragment delimiters, controls, NUL, and replacement characters are
  rejected. Remaining percent-escape triplets are rejected as ambiguous/double
  encoding; repeated decoding is never used to turn a suspicious path into an
  accepted path. This intentionally also rejects multiply encoded benign names.
- All slash-delimited `..` components are rejected **before normalization**, even
  if they would remain inside the scan root. Encoded and double-encoded parent
  traversal is rejected as well. Literal `version..txt` is not traversal.
- Absolute paths, drive-relative paths, UNC paths, all backslashes, empty path
  components, and ambiguous repeated separators are rejected on every platform.
  Harmless `.` components, such as `./guide.md` or `refs/./guide.md`, are removed;
  parent components are never removed. Final labels must satisfy the existing
  `safeRelative` filesystem policy, including its length/control restrictions.
- Resolution is relative to the **containing Markdown file**, not always to
  `SKILL.md`. The target must remain in the scan root and in the same nearest
  skill directory, determined from inventoried `SKILL.md` locations. Linking
  from a parent skill into an inventoried nested skill is rejected. Nested skill
  boundaries apply even when that skill's definition could not be read.
- Inventory lookup and visitation keys are case insensitive on Windows and
  otherwise case sensitive. No Unicode normalization is performed. Inventory
  spellings, rather than raw destinations, are used for cached resource labels.

## Filesystem checks and recursion

Only the shared `assertSafePath` and `readText` helpers access target filesystem
state. `assertSafePath` checks every intermediate component with `lstat`, rejects
symlinks, and checks canonical containment. `readText` performs the existing
bounded, ordinary-file UTF-8 read and rejects binary/NUL-containing Markdown.
Both checks use the same canonical scan root; no outside resource is read.

Ordinary inventoried non-Markdown assets (including images, archives, scripts,
and other binary resources) receive existence/symlink checks **without reading
their contents**. No script, shell command, subprocess, or network request is
launched by this validator. A resource ending in `.md` (case insensitive) is
read as Markdown only if it is inventoried, not excluded, within the same skill,
and within the configured budgets.

Traversal uses a FIFO queue, sorted initial source labels, Markdown token order,
and a visited set. This gives deterministic shortest-reference-depth-first
processing and stable budget allocation independent of inventory insertion
order. Each new Markdown resource is read at most once per invocation. Cached
read failures remain failures at other referring links; already visited
successful resources, self-links, and resource cycles are benign and are not
recursively expanded again. Findings are sorted by referring path, line, and
rule ID.

The existing `config.limits` controls additional Markdown processing:

- `maxFileBytes`: per-file UTF-8 byte cap, checked against inventory size and
  enforced during `readText`.
- `maxTotalBytes`: includes all already supplied `context.contents` bytes and
  successfully added Markdown. A failed read conservatively consumes its entire
  read allowance because the shared helper does not return a consumed-byte
  count on failure. Reads are bounded by the remaining byte budget, so growth
  after inventory cannot silently overfill the content cache and malformed
  Markdown cannot bypass aggregate budgeting. The shared reader uses one extra
  lookahead byte to detect oversize input; this is not an exact physical-I/O cap.
- `maxFiles`: includes existing cached entries and attempted new Markdown reads,
  including failed reads. Binary asset checks do not consume Markdown read slots.
- `maxDepth`: maximum new Markdown reference depth, with supplied cached sources
  at depth `0`. A cached/visited target does not become an error merely because
  a cycle reaches it through a deeper path.

Discovery separately owns inventory entry count, inventory file count,
directory depth, and its completeness findings; this validator does not build a
second inventory or read omitted resources to work around discovery limits.
Limits produce `SG-REF-004` on the referring link; already over-budget supplied
content or parser failure produces it at line `1` of that source.

**Mutable-filesystem residual risk:** these shared checks reduce unsafe reads
but do not provide a race-proof filesystem capability sandbox. Components may
change between checks; behavior and available open flags vary by OS. Use an
immutable local snapshot for hostile inputs. Inventory metadata and the cached
source text are snapshots, not an atomic guarantee about subsequent disk state.

## Duplicate semantics

`SG-REF-006` is opt-in `quality`/`info`, not `spec`, a safety finding, or an invalid
skill declaration. It compares references **within each referring document**
after safe pathname normalization. Links and images share the comparison set.
Remote references and rejected unsafe references do not participate.

The comparison key includes the normalized target path **and the exact original
query/fragment suffix**. Thus `./guide.md` and `guide.md` are duplicates;
`guide.md#one` and `guide.md#two` are **not**. Different queries, differently
encoded fragments, and an absent versus explicitly empty fragment are distinct.
This deliberately avoids guessing anchor/query equivalence. Repeated missing or
omitted safe references may receive both a high-severity structural finding and
this optional advice. Self-links/cycles alone do not produce duplicate advice.

## Diagnostic privacy and validation

Titles, messages, remediation, and evidence are static. All evidence is
`{ redacted: true, excerpt: "[REDACTED]" }`. Link labels, destinations, titles,
queries, fragments, source snippets, and raw filesystem/parser errors are never
interpolated into findings. The only source-derived label is the caller's safe
inventory-relative **referring file path**; as with other validators, those
filenames themselves are not anonymized.

Run from the repository root (the direct Node forms work without a `pnpm` shim):

```sh
node node_modules/vitest/vitest.mjs run packages/cli/tests/references.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json
node node_modules/eslint/bin/eslint.js packages/cli/src/validators/references.ts packages/cli/tests/references.test.ts
node node_modules/prettier/bin/prettier.cjs --check packages/cli/src/validators/references.ts packages/cli/tests/references.test.ts docs/rules/REFERENCES.md
```

Tests cover positive and negative parser cases, token locations, Windows paths,
traversal and double encoding, missing/excluded/unindexed targets, ordinary binary
assets, recursive reads and cycles, shortest-depth traversal, byte/count/depth
budgets, stale inventory and file growth, privacy, metadata, and parent-owned
state. Directory symlinks use Windows junctions where needed. The final-file
symlink test skips on Windows when file-symlink creation is denied (`EPERM`);
intermediate and in-root/outside directory-link tests still run.
