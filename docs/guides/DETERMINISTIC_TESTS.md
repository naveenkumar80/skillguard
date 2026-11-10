# Deterministic recorded-fixture tests

Phase 5 checks supplied recorded values, **not live agent behavior**. There is no
agent adapter, shell execution, network request, model provider, or API key.
`input.prompt` is metadata only. Neither prompts nor `SKILL.md` instructions are
executed. A passing fixture does not prove that an agent would produce it.

## Entry point

```ts
import { runTests } from "../../packages/cli/src/testing/index.js";

const result = await runTests(root, config);
```

The framework exports `runTests(root: string, config: Config): Promise<TestRun>`
and the `TestRun`/`TestResult` types. The import above is illustrative; resolve it
relative to your caller. CLI, report, config and build integration are separate
from this framework.

The runner loads exactly `root/skillguard.tests.yaml`. A missing, empty, malformed,
unsafe or unsupported suite throws `ScanError` with code `INVALID_TEST_SUITE`;
it never returns an empty successful run. Invalid roots retain the shared
filesystem helper's `INVALID_ROOT` error. Errors are static except for an optional
validated test ID. They do not include parser excerpts, unknown keys, paths,
fixture contents, patterns or expected values. Line numbers may be unavailable.

## Version 1 format

```yaml
version: 1
tests:
  - id: greeting-basic
    group: smoke
    skill: skills/greeting
    description: Check a hand-authored recorded response.
    input:
      prompt: Help me greet a new teammate.
    output: "Hello, teammate! Welcome aboard."
    assertions:
      - type: contains
        value: "Hello"
      - type: contains_any
        values: ["Hello", "Welcome"]
      - type: not_contains
        value: "Goodbye"
      - type: regex
        value: '^Hello, teammate! Welcome aboard\.$'
      - type: max_length
        value: 40
```

- `version` must be the number `1`, not the string `"1"`.
- `tests` is nonempty, with at most 100 records, in report order.
- `id` is unique across the suite. IDs and optional `group` use
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. Grouping is a label, not an execution filter.
- `skill` identifies an ordinary directory inside the selected root. It must
  contain a readable, bounded, ordinary `SKILL.md`. `.` means the root itself;
  a single leading `./` is normalized away for other paths. Absolute paths,
  traversal, backslashes, control characters and ambiguous components are
  rejected. All path components are checked for symbolic links.
- Optional `description` has at most 4096 UTF-16 code units.
- `input` has exactly one key, `prompt`, a string of at most 65,536 UTF-16 code
  units. It may be empty and is never submitted to anything.
- `output` is **required**, including when its value is explicitly `null`. It is
  a recorded string or JSON-compatible value. Missing output fails clearly;
  the runner never infers it from a prompt, assertion or skill definition.
- `outputFile` is deliberately unsupported. Keep fixtures inline. Unknown fields
  at every schema level are rejected, including provider, API-key, script,
  command, custom worker, timeout and execution settings.
- `assertions` has 1–64 entries per record, at most 1024 entries per suite.

## Assertions

All schemas are strict. No assertion accepts unspecified extra fields.

| Type               | Required fields after `type`                             | Semantics                                                         |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `contains`         | `value`: nonempty string                                 | Case-sensitive literal substring                                  |
| `contains_any`     | `values`: 1–64 nonempty strings                          | At least one literal substring matches                            |
| `not_contains`     | `value`: nonempty string                                 | Literal substring must be absent                                  |
| `regex`            | `value`: nonempty pattern, at most 256 UTF-16 code units | JavaScript regex match in an isolated static worker               |
| `json_path_equals` | `path`: restricted path, `value`: JSON value             | Own-property traversal and type-sensitive deep equality           |
| `max_length`       | `value`: integer from 0 through 262,144                  | String length is at most the bound, measured in UTF-16 code units |

Text assertions require string output. Structured JSON output is **not** coerced
to text. Literal strings are at most 262,144 UTF-16 code units. Regex accepts an
optional `flags` string containing each of `i`, `m`, `s`, `u` at most once; the
default is empty. Global, sticky and other flags are unsupported. Invalid regex
syntax, timeouts and worker failures produce static assertion failures, never a
pass. There is no nested-quantifier heuristic or trusted-regex bypass.

`json_path_equals` accepts native JSON output or a string containing valid JSON.
For example:

```yaml
output:
  items:
    - message: "Hello"
      tags: ["welcome"]
assertions:
  - type: json_path_equals
    path: $.items[0]
    value:
      tags: ["welcome"]
      message: "Hello"
```

Paths start at `$`, followed only by `.identifier` and/or nonnegative `[index]`
segments. Identifiers use ASCII letters/underscore followed by letters, digits
or underscore. Indices have no leading zeros (except `0`) and at most nine
digits. A path has at most 512 characters and 32 segments. `$` selects the entire
JSON value. Quoted keys, wildcards, filters, recursive descent, expressions and
function calls are unsupported. `__proto__`, `prototype`, and `constructor` are
forbidden keys and path segments. Traversal never accesses inherited properties
or treats array properties as object members. Missing values fail, even when the
expected value is `null`. Object key order is ignored; array order and value
types matter. Invalid, over-deep or prototype-unsafe JSON strings fail statically.
There is no `eval`, dynamic script generation or executable JSONPath engine.

## Resource and filesystem boundaries

- Suite file: at most **1 MiB**, valid UTF-8 text, no binary NUL bytes.
- Referenced `SKILL.md`: at most **262,144 bytes**, or the smaller configured
  `limits.maxFileBytes`.
- Total bytes: suite plus unique referenced definitions, at most **4 MiB**, or
  the smaller configured `limits.maxTotalBytes`. Reused definitions count once.
  Reads are bounded by the remaining budget before loading file content.
- File count includes the suite and unique definitions. The smaller of 1000 and
  configured `limits.maxFiles` applies. Configured `limits.maxDepth` bounds the
  relative skill-directory depth (`.` is depth zero).
- The runner reads only the suite and required definitions, not unrelated
  scripts/assets. It uses shared canonical-root, safe-path and bounded-read
  helpers; it does not follow symlinks. As with other filesystem checks, scan
  an immutable local snapshot to avoid concurrent directory replacement races.
- YAML ASTs are inspected **before** `toJS`: aliases, anchors, explicit tags,
  non-string/complex keys, prototype keys and non-finite/non-JSON values are
  rejected. Unique keys are mandatory. There are at most 20,000 AST nodes and
  nesting depth 32. JSON structures also have node/depth limits.
- Each recorded output has at most 262,144 UTF-8 bytes (raw string bytes, or JSON
  serialization bytes for non-string values). Regex input additionally has at
  most 262,144 UTF-16 code units.
- Each regex runs sequentially in the shipped `regex-worker.mjs`, with a
  **100 ms execution timeout**. Static worker startup has a separate 5-second
  bound. Timed-out and completed workers are terminated and termination is
  awaited before evaluation continues. The suite cannot choose worker code,
  flags outside the allowlist, timeout, scripts or execution options.

These checks validate the whole suite and its referenced definitions before any
assertions run. An unreadable later definition cannot turn an earlier subset
into a successful partial run.

## Result contract and privacy

```json
{
  "schemaVersion": "1.0",
  "passed": 1,
  "failed": 0,
  "results": [
    {
      "id": "greeting-basic",
      "group": "smoke",
      "passed": true,
      "failures": [],
      "skill": "skills/greeting"
    }
  ]
}
```

Every test counts once, even with multiple failed assertions. Results retain
suite order; failures retain assertion order. An absent `group` is omitted.
There are no timestamps, durations, random IDs or absolute root paths. Identical
completed evaluations yield identical serializable reports. Regexes near the
execution budget can fail under load; avoid patterns that approach the timeout.

Results and error messages omit prompts, descriptions, output, expected values,
regex patterns and skill text. `failures` contains only static messages such as
`contains assertion failed.` or `regex assertion timed out after 100 ms.` IDs,
groups and skill labels are intentionally retained; do not put secrets in them.
The suite file itself still contains its fixtures and should be reviewed before
committing or sharing.

## Example and integration boundary

[`examples/greeting`](../../examples/greeting) contains a root skill and two
matching recorded fixtures exercising all six assertions. They are hand-authored
examples, not actual generated responses. The framework regression tests are in
`packages/cli/tests/testing.test.ts`.

**Parent build requirement:** TypeScript compilation does not copy `.mjs` files.
The CLI build must copy `packages/cli/src/testing/regex-worker.mjs` unchanged to
`packages/cli/dist/testing/regex-worker.mjs` beside `regex.js`. Source-based Vitest
runs resolve the worker directly using `new URL("./regex-worker.mjs",
import.meta.url)`. Missing compiled worker assets fail the affected assertions
closed; there is no main-thread regex fallback. Parent CLI/config/report wiring
is intentionally not implemented in these framework files.
