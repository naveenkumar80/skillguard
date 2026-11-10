import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { Document } from "yaml";
import { isFinding } from "../src/engine/protocol.js";
import { formatRules, validateFormat } from "../src/validators/format.js";

const path = "skills/example/SKILL.md";
const base = "name: example\ndescription: Example instructions.\n";
const wrap = (yaml = base, body = "") => `---\n${yaml}---\n${body}`;
const validate = (content: string, directory = "example", quality = false) =>
  validateFormat(content, path, directory, quality);
const ids = (content: string, directory = "example", quality = false) =>
  validate(content, directory, quality).findings.map(
    (finding) => finding.ruleId,
  );
const withField = (key: string, yamlValue: string) => {
  const otherFields = base
    .split("\n")
    .filter((line) => line && !line.startsWith(`${key}:`))
    .join("\n");
  return wrap(`${otherFields}\n${key}: ${yamlValue}\n`);
};
const quoted = (value: string) => JSON.stringify(value);

// Fixtures intentionally use a fixed caller-supplied directory, not discovery.
describe("invalid frontmatter fixtures", () => {
  it.each([
    ["missing-frontmatter", "SG-SPEC-001"],
    ["unterminated", "SG-SPEC-001"],
    ["malformed-yaml", "SG-SPEC-001"],
    ["duplicate-keys", "SG-SPEC-001"],
    ["nonmapping", "SG-SPEC-001"],
    ["missing-name", "SG-SPEC-002"],
    ["bad-name", "SG-SPEC-002"],
    ["directory-mismatch", "SG-SPEC-003"],
    ["missing-description", "SG-SPEC-004"],
    ["bad-description", "SG-SPEC-004"],
    ["bad-compatibility", "SG-SPEC-005"],
    ["bad-metadata", "SG-SPEC-006"],
    ["bad-license", "SG-SPEC-007"],
    ["bad-allowed-tools", "SG-SPEC-008"],
    ["unsafe-tag", "SG-STRUCT-008"],
    ["alias-cycle", "SG-STRUCT-008"],
  ])("rejects %s using %s", async (fixture, ruleId) => {
    const content = await readFile(
      new URL(
        `../../../tests/fixtures/invalid-frontmatter/${fixture}.md`,
        import.meta.url,
      ),
      "utf8",
    );
    expect(ids(content)).toEqual([ruleId]);
  });
});

describe("frontmatter envelope and body", () => {
  it("accepts minimal metadata with an empty body", () => {
    expect(validate(wrap())).toEqual({
      findings: [],
      name: "example",
      body: "",
      bodyStartLine: 5,
    });
  });
  it.each([
    "",
    "Plain instructions without headings.",
    "# Any heading\n\nText\n",
    "---\nNot YAML\n---\n",
  ])("does not require or interpret body structure %#", (body) => {
    expect(validate(wrap(base, body))).toEqual({
      findings: [],
      name: "example",
      body,
      bodyStartLine: 5,
    });
  });
  it("supports an initial BOM, CRLF, and trailing delimiter whitespace", () => {
    const body = "Instructions.\r\n\r\n---\r\n";
    const content = `\uFEFF--- \t\r\n${base.replaceAll("\n", "\r\n")}---\t \r\n${body}`;
    expect(validate(content)).toEqual({
      findings: [],
      name: "example",
      body,
      bodyStartLine: 5,
    });
  });
  it("accepts a closing delimiter at EOF", () => {
    expect(validate(`---\n${base}---`)).toEqual({
      findings: [],
      name: "example",
      body: "",
      bodyStartLine: 5,
    });
  });
  it.each([
    "",
    "# Body\n",
    `\n${wrap()}`,
    ` ${wrap()}`,
    "---\nname: example\n",
    "---\r\nname: example\r\n",
  ])(
    "rejects absent or unterminated frontmatter %# without guessing a body",
    (content) => {
      const result = validate(content);
      expect(result).toMatchObject({
        name: null,
        body: content,
        bodyStartLine: 1,
      });
      expect(result.findings.map((finding) => finding.ruleId)).toEqual([
        "SG-SPEC-001",
      ]);
    },
  );
  it.each(["", "# comment only\n", "null\n", "a scalar\n", "[]\n", "[a, b]\n"])(
    "requires a YAML mapping %#",
    (yaml) => expect(ids(wrap(yaml))).toEqual(["SG-SPEC-001"]),
  );
  it("an empty mapping reports only the two required fields", () => {
    expect(ids(wrap("{}\n"))).toEqual(["SG-SPEC-002", "SG-SPEC-004"]);
  });
  it("returns the original body even when YAML is invalid", () => {
    expect(
      validate(wrap("name: [unfinished\n", "Private body\r\n")),
    ).toMatchObject({
      name: null,
      body: "Private body\r\n",
      bodyStartLine: 4,
    });
  });
  it("accepts quoted keys, flow mappings, folded and literal strings", () => {
    expect(ids(wrap('{"name": example, "description": "Example"}\n'))).toEqual(
      [],
    );
    expect(
      ids(
        wrap('"name": example\ndescription: >-\n  First line\n  second line\n'),
      ),
    ).toEqual([]);
    expect(
      ids(wrap("name: example\ndescription: |\n  First line\n  ---\n")),
    ).toEqual([]);
  });
  it("permits unknown fields and does not invent required metadata", () => {
    expect(
      ids(wrap(`${base}unknown-extension: {nested: [1, true, null]}\n`)),
    ).toEqual([]);
  });
});

describe("name (SG-SPEC-002) and directory identity (SG-SPEC-003)", () => {
  it.each(["a", "0", "a-b", "a".repeat(64), "école-١٢", "𐐨".repeat(64)])(
    "accepts a valid Unicode name %#",
    (name) => {
      const result = validate(withField("name", quoted(name)), name);
      expect(result.findings).toEqual([]);
      expect(result.name).toBe(name);
    },
  );
  it.each([
    "",
    "a".repeat(65),
    "𐐨".repeat(65),
    "Example",
    "École",
    "-example",
    "example-",
    "exam--ple",
    "example_name",
    "two words",
    "a/b",
    "a.b",
    "a\nb",
    "a\u0000b",
    "😀",
    "e\u0301",
    "中文",
  ])("rejects invalid name syntax %# without returning it", (name) => {
    const result = validate(withField("name", quoted(name)), name);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "SG-SPEC-002",
    ]);
    expect(result.name).toBeNull();
  });
  it.each(["null", "true", "42", "[]", "{}"])(
    "requires a string, not %s",
    (value) => {
      expect(ids(withField("name", value))).toEqual(["SG-SPEC-002"]);
    },
  );
  it("does not coerce an unquoted numeric name into a string", () => {
    expect(ids(withField("name", "123"), "123")).toEqual(["SG-SPEC-002"]);
    expect(ids(withField("name", '"123"'), "123")).toEqual([]);
  });
  it.each(["other", "Example", "example ", "éxample"])(
    "requires an exact directory match %#",
    (directory) => {
      expect(ids(wrap(), directory)).toEqual(["SG-SPEC-003"]);
    },
  );
  it("returns a syntactically safe name despite other field or directory errors", () => {
    expect(validate(wrap("name: example\n"), "other")).toMatchObject({
      name: "example",
    });
    expect(ids(wrap("name: example\n"), "other")).toEqual([
      "SG-SPEC-003",
      "SG-SPEC-004",
    ]);
  });
});

describe("description (SG-SPEC-004)", () => {
  it.each(["x", "x".repeat(1024), "😀".repeat(1024), " text "])(
    "accepts boundary strings %#",
    (value) => {
      expect(ids(withField("description", quoted(value)))).toEqual([]);
    },
  );
  it.each(["", " ", "\t\r\n", "x".repeat(1025), "😀".repeat(1025)])(
    "rejects blank or oversized strings %#",
    (value) => {
      expect(ids(withField("description", quoted(value)))).toEqual([
        "SG-SPEC-004",
      ]);
    },
  );
  it.each(["null", "true", "42", "[]", "{}"])(
    "rejects non-string %s",
    (value) => {
      expect(ids(withField("description", value))).toEqual(["SG-SPEC-004"]);
    },
  );
});

describe("optional fields", () => {
  it("allows all optional fields to be absent", () =>
    expect(ids(wrap())).toEqual([]));
  it.each(["x", "x".repeat(500), "😀".repeat(500), " "])(
    "accepts compatibility boundaries %#",
    (value) => {
      expect(ids(withField("compatibility", quoted(value)))).toEqual([]);
    },
  );
  it.each([
    '""',
    quoted("x".repeat(501)),
    quoted("😀".repeat(501)),
    "null",
    "false",
    "42",
    "[]",
    "{}",
  ])("rejects invalid compatibility %# (SG-SPEC-005)", (value) =>
    expect(ids(withField("compatibility", value))).toEqual(["SG-SPEC-005"]),
  );
  it.each([
    "{}",
    '{author: "me", version: "1.0"}',
    '{"": "", "__proto__": "inert", constructor: "inert"}',
  ])("accepts string metadata mapping %#", (value) =>
    expect(ids(withField("metadata", value))).toEqual([]),
  );
  it.each([
    "null",
    '"text"',
    "[]",
    "42",
    "{a: 1}",
    "{1: text}",
    "{a: null}",
    "{a: true}",
    "{a: []}",
    "{a: {b: text}}",
    "{? [a, b]: text}",
  ])("rejects invalid metadata %# (SG-SPEC-006)", (value) =>
    expect(ids(withField("metadata", value))).toEqual(["SG-SPEC-006"]),
  );
  it.each([
    ["license", "SG-SPEC-007"],
    ["allowed-tools", "SG-SPEC-008"],
  ])(
    "validates the optional %s type without inventing length constraints",
    (key, ruleId) => {
      for (const value of ["", "Read Bash(git:*)", "x".repeat(1025)]) {
        expect(ids(withField(key, quoted(value)))).toEqual([]);
      }
      for (const value of ["null", "true", "42", "[]", "{}"]) {
        expect(ids(withField(key, value))).toEqual([ruleId]);
      }
    },
  );
  it("allows the experimental tools string without enforcing a tool grammar", () => {
    expect(
      ids(
        withField(
          "allowed-tools",
          quoted("Read\tBash(git:*)\nCustom(anything)"),
        ),
      ),
    ).toEqual([]);
  });
});

describe("YAML syntax (SG-SPEC-001) and parser safety (SG-STRUCT-008)", () => {
  it.each([
    `${base}name: duplicate\n`,
    `${base}metadata: {key: one, key: two}\n`,
    `${base}extension: {key: one, key: two}\n`,
    `${base}extension: {"key": one, key: two}\n`,
    `${base}extension: {? [a, b]: one, ? [a, b]: two}\n`,
    `${base}extension: {? {a: b, c: d}: one, ? {c: d, a: b}: two}\n`,
    `${base}extension: {&key secret: one, *key: two}\n`,
  ])(
    "rejects duplicate mappings, including complex and aliased keys %#",
    (yaml) => {
      expect(ids(wrap(yaml))).toEqual(["SG-SPEC-001"]);
    },
  );
  it.each([
    [`${base}extra: !custom secret\n`, "SG-STRUCT-008"],
    [`${base}extra: !!js/function secret\n`, "SG-STRUCT-008"],
    [`${base}extra: !!timestamp 2026-01-01\n`, "SG-STRUCT-008"],
    [`${base}extra: !!binary c2VjcmV0\n`, "SG-STRUCT-008"],
    [`${base}extra: *missing\n`, "SG-SPEC-001"],
    [`${base}extra: &cycle [*cycle]\n`, "SG-STRUCT-008"],
    [`${base}extra: &cycle {nested: *cycle}\n`, "SG-STRUCT-008"],
    [`${base}extra: [unterminated\n`, "SG-SPEC-001"],
    [`${base}...\nname: second-document\n`, "SG-SPEC-001"],
    [`${base}extra: !custom [unterminated\n`, "SG-SPEC-001"],
    [`${base}extra: !custom secret\nname: duplicate\n`, "SG-SPEC-001"],
  ])(
    "distinguishes unsupported constructs from malformed YAML %#",
    (yaml, ruleId) => {
      const result = validate(wrap(yaml));
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        ruleId,
        category: ruleId === "SG-STRUCT-008" ? "structure" : "spec",
        severity: "high",
      });
    },
  );
  it("emits parser safety findings by default without declaring a spec violation", () => {
    const content = wrap(
      `${base}extra: &PRIVATE_ANCHOR [*PRIVATE_ANCHOR]\n`,
      "Private body\r\n",
    );
    const result = validate(content);
    expect(result).toMatchObject({
      name: null,
      body: "Private body\r\n",
      bodyStartLine: 6,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "SG-STRUCT-008",
      category: "structure",
      severity: "high",
      evidence: { redacted: true, excerpt: "[REDACTED]" },
      line: 4,
    });
    expect(
      result.findings.filter((finding) => finding.category === "spec"),
    ).toEqual([]);
    expect(JSON.stringify(result.findings)).not.toContain("PRIVATE_ANCHOR");
    expect(JSON.stringify(result.findings)).not.toContain("Private body");
    expect(ids(content, "example", true)).toEqual(["SG-STRUCT-008"]);
  });
  it("accepts explicit core string tags and inert prototype-like unknown keys", () => {
    expect(
      ids(
        wrap(
          "name: !!str example\ndescription: !!str 123\n__proto__: {polluted: true}\nconstructor: unknown\n",
        ),
      ),
    ).toEqual([]);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
  it("accepts bounded scalar and mapping aliases without toJS conversion", () => {
    const spy = vi.spyOn(Document.prototype, "toJS").mockImplementation(() => {
      throw new Error("Object conversion must not occur");
    });
    try {
      expect(
        ids(
          wrap(
            "shared: &text example\nname: *text\ndescription: *text\nshared-map: &meta {author: *text}\nmetadata: *meta\n",
          ),
        ),
      ).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("does not expand exponentially shared collections", () => {
    let yaml = `${base}a0: &a0 scalar\n`;
    for (let index = 1; index <= 25; index++) {
      yaml += `a${index}: &a${index} [*a${index - 1}, *a${index - 1}]\n`;
    }
    expect(ids(wrap(yaml))).toEqual([]);
  });
  it("honors anchor redefinition in source order", () => {
    expect(
      ids(
        wrap(
          "first: &text example\nname: *text\nsecond: &text Instructions\ndescription: *text\n",
        ),
      ),
    ).toEqual([]);
  });
  it("rejects forward aliases without echoing their names", () => {
    expect(
      ids(wrap(`${base}earlier: *private\nlater: &private value\n`)),
    ).toEqual(["SG-SPEC-001"]);
  });
  it.each([100, 101])("bounds alias references at 100 (%i)", (count) => {
    const yaml = `${base}shared: &value example\nextra: [${Array<string>(count).fill("*value").join(", ")}]\n`;
    expect(ids(wrap(yaml))).toEqual(count === 100 ? [] : ["SG-STRUCT-008"]);
  });
  it.each([62, 63])(
    "bounds structural nesting at depth 64 (%i collections)",
    (count) => {
      const yaml = `${base}extra: ${"[".repeat(count)}0${"]".repeat(count)}\n`;
      expect(ids(wrap(yaml))).toEqual(count === 62 ? [] : ["SG-STRUCT-008"]);
    },
  );
  it("bounds graph depth across alias edges as well as physical nesting", () => {
    let yaml = `${base}a0: &a0 scalar\n`;
    for (let index = 1; index <= 40; index++) {
      yaml += `a${index}: &a${index} [*a${index - 1}]\n`;
    }
    expect(ids(wrap(yaml))).toEqual(["SG-STRUCT-008"]);
  });
  it.each([9993, 9994])(
    "bounds AST nodes at 10000 (%i sequence items)",
    (count) => {
      const yaml = `${base}extra: [${Array<string>(count).fill("x").join(", ")}]\n`;
      expect(ids(wrap(yaml))).toEqual(count === 9993 ? [] : ["SG-STRUCT-008"]);
    },
  );
  it.each([262144, 262145])(
    "bounds frontmatter UTF-16 length (%i)",
    (length) => {
      const prefix = `${base}extra: `;
      const yaml = `${prefix}${"x".repeat(length - prefix.length - 1)}\n`;
      expect(ids(wrap(yaml))).toEqual(
        length === 262144 ? [] : ["SG-STRUCT-008"],
      );
    },
  );
  it("rejects pathological depth without throwing or leaking parser errors", () => {
    const yaml = `${base}extra: ${"[".repeat(2000)}0${"]".repeat(2000)}\n`;
    expect(ids(wrap(yaml))).toEqual(["SG-STRUCT-008"]);
  });
});

describe("locations and diagnostic privacy", () => {
  it("locates a quoted known field without searching its text in comments", () => {
    const content = wrap(
      '# name: not the field\n"name": false\ndescription: fine\n',
    );
    expect(validate(content).findings[0]).toMatchObject({ line: 3, column: 1 });
  });
  it("reports parser offsets in original BOM/CRLF coordinates", () => {
    const content =
      "\uFEFF---\r\nname: example\r\ndescription: fine\r\nname: duplicate\r\n---\r\n";
    expect(validate(content).findings[0]).toMatchObject({ line: 4, column: 1 });
  });
  it("locates a nested metadata key without exposing it", () => {
    const content = wrap(`${base}metadata:\n  PRIVATE_KEY_SENTINEL: 42\n`);
    const result = validate(content);
    expect(result.findings[0]).toMatchObject({ line: 5, column: 3 });
    expect(JSON.stringify(result.findings)).not.toContain(
      "PRIVATE_KEY_SENTINEL",
    );
  });
  it("uses an AST range for fields in a flow mapping", () => {
    const content = wrap("{name: example, description: false}\n");
    expect(validate(content).findings[0]).toMatchObject({
      line: 2,
      column: 17,
    });
  });
  it("anchors missing fields at the first frontmatter line", () => {
    expect(
      validate(wrap("{}\n")).findings.every(
        (finding) => finding.line === 2 && finding.column === 1,
      ),
    ).toBe(true);
  });
  it.each([
    "PRIVATE_KEY_SENTINEL: [PRIVATE_VALUE_SENTINEL\n",
    `${base}PRIVATE_KEY_SENTINEL: one\nPRIVATE_KEY_SENTINEL: PRIVATE_VALUE_SENTINEL\n`,
    `${base}metadata: {PRIVATE_KEY_SENTINEL: [PRIVATE_VALUE_SENTINEL]}\n`,
    `${base}extra: !PRIVATE_KEY_SENTINEL PRIVATE_VALUE_SENTINEL\n`,
    `${base}extra: *PRIVATE_KEY_SENTINEL\n`,
    "name: PRIVATE_VALUE_SENTINEL\ndescription: []\n",
  ])(
    "never includes source values, keys, or parser diagnostics in findings %#",
    (yaml) => {
      const result = validate(
        wrap(yaml, "PRIVATE_BODY_SENTINEL"),
        "PRIVATE_DIRECTORY_SENTINEL",
      );
      expect(result.findings.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(result.findings);
      for (const secret of [
        "PRIVATE_KEY_SENTINEL",
        "PRIVATE_VALUE_SENTINEL",
        "PRIVATE_BODY_SENTINEL",
        "PRIVATE_DIRECTORY_SENTINEL",
      ]) {
        expect(serialized).not.toContain(secret);
      }
      for (const finding of result.findings) {
        expect(isFinding(finding)).toBe(true);
        expect(finding.evidence).toEqual({
          redacted: true,
          excerpt: "[REDACTED]",
        });
        expect(finding.path).toBe(path);
        expect(finding.line).toBeGreaterThanOrEqual(1);
        expect(finding.column).toBeGreaterThanOrEqual(1);
      }
    },
  );
  it("does not echo a valid name on a directory mismatch", () => {
    const name = "private-valid-name";
    const result = validate(withField("name", quoted(name)));
    expect(result.name).toBe(name);
    expect(JSON.stringify(result.findings)).not.toContain(name);
  });
  it("is deterministic and has no parser console output", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const content = wrap(`${base}extra: !private-tag private-value\n`);
      expect(validate(content)).toEqual(validate(content));
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("optional quality advice (SG-QUAL-001)", () => {
  it.each([499, 500, 501])(
    "separates the 500-line recommendation from spec rules (%i lines)",
    (lines) => {
      const content = wrap(
        base,
        Array<string>(lines - 4)
          .fill("Instructions.")
          .join("\n"),
      );
      expect(ids(content)).toEqual([]);
      const result = validate(content, "example", true);
      expect(result.findings.map((finding) => finding.ruleId)).toEqual(
        lines > 500 ? ["SG-QUAL-001"] : [],
      );
      if (lines > 500) {
        expect(result.findings[0]).toMatchObject({
          category: "quality",
          severity: "info",
          line: 501,
          column: 1,
        });
      }
    },
  );
  it("does not count a final line terminator as another line", () => {
    const content = wrap(base, "Instructions.\r\n".repeat(496)).replaceAll(
      /(?<!\r)\n/g,
      "\r\n",
    );
    expect(ids(content, "example", true)).toEqual([]);
  });
  it("keeps even a long document with an empty body format-valid", () => {
    const content = wrap(`${base}${"# comment\n".repeat(501)}`);
    expect(validate(content).body).toBe("");
    expect(ids(content)).toEqual([]);
    expect(ids(content, "example", true)).toEqual(["SG-QUAL-001"]);
  });
});

describe("rule registry", () => {
  it("exports stable, unique IDs and complete metadata", () => {
    expect(formatRules.map((rule) => rule.id)).toEqual([
      "SG-SPEC-001",
      "SG-SPEC-002",
      "SG-SPEC-003",
      "SG-SPEC-004",
      "SG-SPEC-005",
      "SG-SPEC-006",
      "SG-SPEC-007",
      "SG-SPEC-008",
      "SG-STRUCT-008",
      "SG-QUAL-001",
    ]);
    for (const rule of formatRules) {
      expect(rule.version).toBe("1.0.0");
      expect(rule.category).toBe(
        rule.id.startsWith("SG-QUAL")
          ? "quality"
          : rule.id.startsWith("SG-STRUCT")
            ? "structure"
            : "spec",
      );
      expect(rule.defaultSeverity).toBe(
        rule.category === "quality" ? "info" : "high",
      );
      expect(rule.title).not.toBe("");
      expect(rule.description).not.toBe("");
      expect(rule.remediation).not.toBe("");
      expect(rule.confidence).toBe("high");
      expect(rule.references).toEqual([
        "https://raw.githubusercontent.com/agentskills/agentskills/83021e2be457a9b6679148719c1f6074f0ad975e/docs/specification.mdx",
      ]);
    }
  });
});
