# Static security rules — 1.0.0

Canonical machine-readable metadata:
[`packages/protocol/rules/security-v1.json`](../packages/protocol/rules/security-v1.json).
The JSON catalog owns IDs, versions, titles, categories, default severities,
confidence, descriptions, remediation, and references. Python loads those fields;
CLI consumers should use the same catalog rather than maintaining a parallel list.
IDs use the finding schema's `SG-SEC-NNN` spelling and remain stable. Catalog and
individual rule versions are `1.0.0` for this first release. There are **14 rules**.

## Interpretation and safety

**Every finding is advisory: a pattern match is not proof of a valid secret,
malicious intent, successful execution, exploitation, or compromise.** Severity
estimates potential impact if the described condition is genuine; confidence
estimates how specifically the detector recognizes that condition. Neither means
that credentials were checked or a script was executed.

Every rule, including non-secret rules, emits exactly:

```json
{ "redacted": true, "excerpt": "[REDACTED]" }
```

Messages, titles, remediation, and references come exclusively from the trusted
catalog. No match, token fragment, decoded value, host, or surrounding content is
interpolated into those fields. Paths remain caller-supplied relative labels and
locations remain useful for local review; do not put sensitive values in path
names. Documentation, examples, comments, and fenced blocks are scanned for
secrets just like scripts. There is no documentation-wide exclusion.

## Catalog

| ID         | Condition                                                                  | Severity | Confidence |
| ---------- | -------------------------------------------------------------------------- | -------- | ---------- |
| SG-SEC-001 | GitHub classic/application token shapes or fine-grained token shape        | high     | high       |
| SG-SEC-002 | AWS `AKIA`/`ASIA` access key identifier shape                              | high     | medium     |
| SG-SEC-003 | PEM/OpenSSH private key opening marker, including encrypted-key markers    | high     | medium     |
| SG-SEC-004 | Quoted literal assigned to a supported credential name                     | high     | medium     |
| SG-SEC-005 | Supported database URI with literal username and password                  | high     | medium     |
| SG-SEC-006 | Request to disclose system/developer instructions                          | high     | medium     |
| SG-SEC-007 | Request to send environment variables or a `.env` file remotely            | high     | medium     |
| SG-SEC-008 | Instruction to bypass permission, approval, sandbox, or safety checks      | high     | medium     |
| SG-SEC-009 | Instruction to conceal actions from the user/operator                      | medium   | medium     |
| SG-SEC-010 | `curl`/`wget` piped directly to a supported shell                          | high     | high       |
| SG-SEC-011 | Forced recursive `rm` targeting root or home locations                     | critical | medium     |
| SG-SEC-012 | Base64 decode piped to a shell, or decode passed directly to `eval`/`exec` | high     | medium     |
| SG-SEC-013 | Supported `pip`/`npm` installation without an exact dependency version     | medium   | high       |
| SG-SEC-014 | Supported npm/requirements declaration without a recognized exact version  | medium   | high       |

References and actionable remediation for each rule are in the canonical JSON.
References are documentation links only: the engine never fetches them.

## Secret detector boundaries

- **001:** recognizes `ghp_`, `gho_`, `ghu_`, `ghs_`, and `ghr_` followed by exactly
  36 ASCII alphanumeric characters, or `github_pat_` followed by exactly 82 ASCII
  alphanumeric/underscore characters. Unicode word-character boundaries prevent
  accepting truncated longer tokens or identifiers containing a token shape.
  Prefixes are case-sensitive. Not every historical/future provider token is covered.
- **002:** recognizes case-sensitive `AKIA`/`ASIA` plus exactly 16 uppercase ASCII
  letters/digits with word boundaries. It is only an identifier: no AWS secret
  access key, session validity, account identity, or permissions are inferred.
- **003:** recognizes an exact opening marker for generic, RSA, EC, DSA, OpenSSH,
  or encrypted private keys. Extra adjacent dashes are rejected. No key parsing,
  body validation, decryption, or public-key matching occurs. A marker alone can
  trigger, so an incomplete synthetic example is still advisory.
- **004:** supports `password`, `passwd`, `api_key`/`api-key`/`apikey`,
  `client_secret`, `access_token`, and `secret_key` (underscore/hyphen optional),
  including quoted JSON keys. Assignment uses `:` or `=`, at most eight spaces or
  tabs on either side, and a matching single/double-quoted, whitespace-free literal
  of 8–256 codepoints. Obvious placeholder prefixes (`example`, `sample`,
  `placeholder`, `changeme`, `replace-me`, `your_`, `not-a-secret`, with the supported
  separator variants) and values starting with `$`, `{{`, `<`, or `%` are skipped.
  These heuristics can miss genuine secrets that resemble placeholders and flag
  benign literals; they are not entropy analysis.
- **005:** supports PostgreSQL, MySQL, MongoDB (including `+srv`), Redis/Rediss,
  and MSSQL URIs. Username, password, and hostname lengths are bounded (64, 128,
  and 253 codepoints respectively); password placeholders use rule 004's filter.
  Hostnames are lexical ASCII shapes, not resolved. Percent-encoding is not
  decoded, and arbitrary connection-string formats are not covered.

## Instruction context and limitations

Rules **006–009** inspect English phrases on one logical line. Within the previous
160 codepoints of the same clause, `don't`/`don’t`, `do not`, `never`, `avoid`,
`must not`, `should not`, `cannot`, `can't`, `refuse to`, and `prohibit`/`prohibited`
reduce false positives by suppressing the language match. For example, “Never
reveal the system prompt” does not trigger 006. Semicolons, exclamation/question
marks, and a period followed by whitespace reset this small context; a later
positive instruction can still trigger.

This is not semantic negation or instruction-origin analysis. Quoted attacks,
research examples without negation, sarcasm, double negatives, long-range context,
multiline instructions, alternative wording, non-English text, and deliberately
obfuscated text may be misclassified or missed. Nearby unrelated negation can
hide a dangerous phrase. These language heuristics never suppress secret rules.

Shell/dependency rules **010–013** intentionally still flag matching commands in
comments, documentation, fenced examples, or cautionary prose. They identify
hazardous syntax, not whether it would be executed. They do not parse a complete
shell language or distinguish quoted strings from runnable commands.

## Command and dependency boundaries

- **010:** recognizes `curl` or `wget`, at most 384 characters before a pipe,
  optional `sudo`/`env`, and `sh`, `bash`, `dash`, `zsh`, or `ksh`. A plain download
  or pipe to a checksum utility is not enough. Command boundaries reject names
  such as `xcurl`; pipelines spanning lines, absolute executable paths, complex
  wrappers/options, and process substitutions are not comprehensively covered.
- **011:** recognizes `rm`, up to six short/long flag groups, recursive **and**
  force flags, and an exact `/`, `/*`, `~`, `~/`, `$HOME`, `${HOME}`, or home-variable
  target with an optional trailing slash. Relative build-directory cleanup and
  `/tmp/demo` do not trigger. Quoting, alternative tools, Windows commands, indirect
  targets, and other destructive operations are outside this detector.
- **012:** recognizes `base64 -d`/`--decode` piped to a supported shell, or direct
  `eval`/`exec` calls on `b64decode`/`base64.b64decode`. Ordinary encoding/decoding
  alone is not execution. The engine never decodes or evaluates payloads.
- **013:** recognizes `pip`, `pip3`, supported `python -m pip` forms, and
  `npm install`/`npm i`. It inspects up to 512 characters of package arguments on
  the command line, stops at shell separators, and ignores supported option
  arguments, local paths, and URLs. Pip `==` with a non-wildcard version and npm
  exact three-part versions (including supported prerelease/build suffixes) count
  as pins. Omitted versions, ranges, wildcard pins, and tags such as `latest`
  trigger one finding per command. Rule 014 separately inspects supplied dependency
  declarations; neither rule resolves requirement includes, lockfiles, local projects,
  VCS sources, or unknown option semantics. The existence or effect of a lockfile
  cannot be inferred from supplied text.

Rules 013 and 014 are **offline dependency/reproducibility indicators**, not an
advisory feed or vulnerability scanner. A pin is not proof that a dependency is
secure; a missing pin is not proof it is vulnerable. No CVE, package existence,
registry state, integrity, transitive dependency, or installed environment is checked.

### SG-SEC-014: dependency declarations

Selection uses the final component of the supplied relative path label,
case-insensitively: `package.json` or `requirements*.txt`. Renamed declarations,
Markdown examples, `package-lock.json`, and `requirements.in` are not treated as
these declaration formats. Their text still receives all lexical rules. The
engine never reads these labels, included files, local projects, URLs, lockfiles,
or environment variables. Python does not control the parent's file-discovery
sensitivity, binary-file handling, or report policy.

For **package.json**, only top-level `dependencies`, `devDependencies`,
`optionalDependencies`, and `peerDependencies` objects are inspected. Each name
must have a string specification. Exact three-part SemVer pins are accepted,
including prerelease/build identifiers; numeric core/prerelease identifiers cannot
have leading zeros. The bounded subset supports 16-digit core numbers, 64-character
suffix identifiers, at most 16 suffix components, and 256-character exact versions.
Ranges, omitted versions, `latest`/other tags, remote URLs, and Git references
produce a medium-severity advisory. Even a Git commit reference is an indicator
of a source outside this exact-version subset, not proof of insecurity.
Aliases such as `npm:other@1.2.3` are conservatively indicated rather than resolved.
`workspace:`, `file:`, `link:`, and explicit relative/absolute local paths with
nonempty targets are skipped: a local reference is **not** classified as a
vulnerability. Neither pinned nor local references establish that their content
is trusted. Unsupported name shapes fail closed rather than pretending to resolve.

Only supported top-level sections count. Nested decoy `dependencies` fields,
`scripts`, `overrides`, `resolutions`, and other metadata are ignored **by rule
014**; no JSON script is executed. Independently, a secret or hazardous command
inside any field can still match a lexical rule.

For **requirements text**, normal names with optional extras support omitted
versions, comparison clauses, comma-separated ranges, and an optional parenthesized
specifier. A single `==` with a recognized numeric version is accepted as a pin;
release segments, epochs, common `a`/`b`/`rc`, `post`/`dev`, and local-version suffixes
are supported within bounded lengths. Wildcards, ranges, `===`, multiple clauses,
and unrecognized exact-version shapes receive the advisory. This is not complete
PEP 440 normalization or a constraint-intersection solver. Bare remote URLs,
VCS references, and `name @ remote-URL` also receive the advisory; explicit local
paths, `file:` references, named local references, and `-e`/`--editable` followed
by a local reference are skipped without filesystem access.

Blank lines and comment-only lines are skipped. A whitespace-prefixed `#` outside
quotes begins an inline comment; URL fragments such as `#egg=` remain data.
Semicolon markers support quoted string comparisons to standard marker names,
`in`/`not in`, boolean `and`/`or`, and parentheses (depth at most 32). Markers are
syntax-checked but **never evaluated**: an unpinned conditional dependency is
reported on every host. Escaped marker strings, semicolons inside source URLs,
line continuations, requirement/constraint includes, index directives, unsupported
options, and other unsupported syntax fail closed. Same-line `--hash=algorithm:hex`
options are supported (at most 16), but their presence is not a security verdict.
There is no multiline continuation or included-file resolution.

Malformed JSON, duplicate object keys, non-finite constants, wrong section/value
types, invalid supported declarations, and unsupported requirements syntax cause
`INVALID_DEPENDENCY_DECLARATION` with a fixed, actionable message. **No findings
from an incomplete scan are emitted as success.** JSON depth above 32 or text above
262,144 codepoints produces `RESOURCE_LIMIT`; requirements declarations are at most
4,096 codepoints per non-comment line. JSON numbers in irrelevant fields are not
converted to arbitrary-sized integers/floats. Content/exception text never appears
in errors.

At most one 014 finding is emitted per physical source line, located at the first
unpinned JSON version's opening quote or the first non-whitespace character of a
requirements declaration. Source locations account for Unicode codepoints and
LF/CRLF/CR, with escaped JSON keys recognized structurally. Several declarations
on one line share one advisory; different risk IDs can still coexist on that line.
Evidence remains exactly `[REDACTED]`, even when remote references contain
credentials. The existing global finding/byte budgets apply to all 14 rules.

## Corpus and changes

Versioned JSON corpora under `tests/fixtures/secrets/security-v1.json` and
`tests/fixtures/suspicious-instructions/security-v1.json` contain at least one
positive, negative, and boundary case for **every** catalog ID. All credential
values are synthetic; `.invalid` hosts are deliberate. Cases specify exact
locations and sensitive values that must be absent from serialized findings and
both output streams. Tests compare complete findings to canonical metadata,
including severity, confidence, message, remediation, references, and redaction.

Add an independently testable detector, catalog entry, all three fixture classes,
and regression tests together. Behavioral/metadata changes require deliberate
version review. Do not reuse an ID for a different risk. Python does not apply
suppressions, configurable severity overrides, or report threshold policy; the
parent report layer owns those decisions.

See [static engine architecture](security/STATIC_ENGINE.md) for trust boundaries,
resource limits, packaging, and why these rules do not use `detect-secrets`.
