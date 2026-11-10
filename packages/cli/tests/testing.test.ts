import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/config.js";
import { ScanError } from "../src/discovery/filesystem.js";
import { runTests } from "../src/testing/index.js";
import { boundedRegex } from "../src/testing/regex.js";

type Spec = Record<string, unknown>;
const roots: string[] = [];
const config = parseConfig({});
const byteLimit = 262_144;
const suiteLimit = 1024 * 1024;
const totalLimit = 4 * suiteLimit;
const definition =
  "---\nname: greeting\ndescription: Recorded greeting fixture.\n---\n\nNever execute me.\n";

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillguard-testing-"));
  roots.push(root);
  return root;
}
async function file(
  root: string,
  path: string,
  content: string | Buffer,
): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
function record(overrides: Spec = {}): Spec {
  return {
    id: "greeting-basic",
    skill: "greeting",
    input: { prompt: "PROMPT_PRIVATE_METADATA" },
    output: "Hello teammate!",
    assertions: [{ type: "contains", value: "Hello" }],
    ...overrides,
  };
}
function suite(tests: unknown[] = [record()]): string {
  return JSON.stringify({ version: 1, tests });
}
async function setup(content = suite()): Promise<string> {
  const root = await temp();
  await file(root, "greeting/SKILL.md", definition);
  await file(root, "skillguard.tests.yaml", content);
  return root;
}
async function evaluate(output: unknown, assertion: Spec): Promise<boolean> {
  const root = await setup(
    suite([record({ output, assertions: [assertion] })]),
  );
  const result = await runTests(root, config);
  expect(result.results).toHaveLength(1);
  expect(result.passed + result.failed).toBe(1);
  return result.results[0]!.passed;
}
async function invalid(content: string, message?: string): Promise<ScanError> {
  const root = await setup(content);
  try {
    await runTests(root, config);
  } catch (error) {
    expect(error).toBeInstanceOf(ScanError);
    expect(error).toMatchObject({ code: "INVALID_TEST_SUITE" });
    if (message) expect((error as ScanError).message).toContain(message);
    return error as ScanError;
  }
  throw new Error("Expected INVALID_TEST_SUITE");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("recorded deterministic assertions", () => {
  const cases: {
    name: string;
    output: unknown;
    assertion: Spec;
    passed: boolean;
  }[] = [
    {
      name: "contains positive",
      output: "Hello teammate!",
      assertion: { type: "contains", value: "teammate" },
      passed: true,
    },
    {
      name: "contains negative and case-sensitive",
      output: "Hello",
      assertion: { type: "contains", value: "hello" },
      passed: false,
    },
    {
      name: "contains boundary at first and last character",
      output: "x",
      assertion: { type: "contains", value: "x" },
      passed: true,
    },
    {
      name: "contains empty output boundary",
      output: "",
      assertion: { type: "contains", value: "x" },
      passed: false,
    },
    {
      name: "contains_any positive",
      output: "Welcome!",
      assertion: { type: "contains_any", values: ["Hello", "Welcome"] },
      passed: true,
    },
    {
      name: "contains_any negative",
      output: "Bye!",
      assertion: { type: "contains_any", values: ["Hello", "Welcome"] },
      passed: false,
    },
    {
      name: "contains_any singleton boundary",
      output: "x",
      assertion: { type: "contains_any", values: ["x"] },
      passed: true,
    },
    {
      name: "contains_any last of 64 boundary",
      output: "x",
      assertion: {
        type: "contains_any",
        values: [...Array<string>(63).fill("no"), "x"],
      },
      passed: true,
    },
    {
      name: "not_contains positive",
      output: "Hello",
      assertion: { type: "not_contains", value: "Bye" },
      passed: true,
    },
    {
      name: "not_contains negative",
      output: "Hello",
      assertion: { type: "not_contains", value: "Hello" },
      passed: false,
    },
    {
      name: "not_contains empty output boundary",
      output: "",
      assertion: { type: "not_contains", value: "x" },
      passed: true,
    },
    {
      name: "regex positive with explicit flags",
      output: "HELLO\nthere",
      assertion: { type: "regex", value: "^hello$", flags: "im" },
      passed: true,
    },
    {
      name: "regex negative",
      output: "Bye",
      assertion: { type: "regex", value: "^Hello$" },
      passed: false,
    },
    {
      name: "regex empty input boundary",
      output: "",
      assertion: { type: "regex", value: "^$" },
      passed: true,
    },
    {
      name: "regex 256-character pattern boundary",
      output: "a".repeat(254),
      assertion: { type: "regex", value: `^${"a".repeat(254)}$` },
      passed: true,
    },
    {
      name: "regex 262144-byte input boundary",
      output: "a".repeat(byteLimit),
      assertion: { type: "regex", value: "^a+$" },
      passed: true,
    },
    {
      name: "json_path_equals positive object equality",
      output: { foo: { bar: [{ b: 2, a: [1, true, null] }] } },
      assertion: {
        type: "json_path_equals",
        path: "$.foo.bar[0]",
        value: { a: [1, true, null], b: 2 },
      },
      passed: true,
    },
    {
      name: "json_path_equals negative no coercion",
      output: { n: 1 },
      assertion: { type: "json_path_equals", path: "$.n", value: "1" },
      passed: false,
    },
    {
      name: "json_path_equals zero-index and null boundary",
      output: '{"items":[null]}',
      assertion: { type: "json_path_equals", path: "$.items[0]", value: null },
      passed: true,
    },
    {
      name: "json_path_equals missing is not null",
      output: { items: [] },
      assertion: { type: "json_path_equals", path: "$.items[0]", value: null },
      passed: false,
    },
    {
      name: "json_path_equals root boundary",
      output: false,
      assertion: { type: "json_path_equals", path: "$", value: false },
      passed: true,
    },
    {
      name: "json_path_equals negative deep equality",
      output: { a: [1, 2] },
      assertion: { type: "json_path_equals", path: "$", value: { a: [2, 1] } },
      passed: false,
    },
    {
      name: "max_length positive",
      output: "Hi",
      assertion: { type: "max_length", value: 3 },
      passed: true,
    },
    {
      name: "max_length negative",
      output: "Hello",
      assertion: { type: "max_length", value: 4 },
      passed: false,
    },
    {
      name: "max_length exact boundary",
      output: "Hello",
      assertion: { type: "max_length", value: 5 },
      passed: true,
    },
    {
      name: "max_length zero boundary",
      output: "",
      assertion: { type: "max_length", value: 0 },
      passed: true,
    },
    {
      name: "max_length UTF16 boundary",
      output: "😀",
      assertion: { type: "max_length", value: 2 },
      passed: true,
    },
    {
      name: "max_length configured ceiling boundary",
      output: "a".repeat(byteLimit),
      assertion: { type: "max_length", value: byteLimit },
      passed: true,
    },
  ];
  it.each(cases)("$name", async ({ output, assertion, passed }) => {
    expect(await evaluate(output, assertion)).toBe(passed);
  });

  it.each(["contains", "contains_any", "not_contains", "regex", "max_length"])(
    "%s never coerces a structured output into text",
    async (type) => {
      const assertion =
        type === "contains_any"
          ? { type, values: ["1"] }
          : { type, value: type === "max_length" ? 5 : "1" };
      expect(await evaluate({ n: 1 }, assertion)).toBe(false);
    },
  );
  it.each([
    ["not JSON", "$.n"],
    ['{"n":1}', "$.missing"],
    ['{"n":1}', "$.toString"],
    ["[1]", "$.length"],
    ['{"0":1}', "$[0]"],
    ['{"__proto__":{"polluted":true}}', "$"],
    ["[".repeat(40) + "0" + "]".repeat(40), "$"],
    ["1e999", "$"],
  ])(
    "fails closed for JSON output/traversal boundary %#",
    async (output, path) => {
      expect(
        await evaluate(output, { type: "json_path_equals", path, value: null }),
      ).toBe(false);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    },
  );
});

describe("strict suite schema and redacted reports", () => {
  it("preserves suite and failure order, grouping, stable totals and JSON roundtrips", async () => {
    const root = await setup(
      suite([
        record({
          id: "z-first",
          group: "smoke",
          description: "PRIVATE_DESCRIPTION",
        }),
        record({
          id: "a-second",
          assertions: [
            { type: "contains", value: "EXPECTED_PRIVATE" },
            { type: "not_contains", value: "Hello" },
            { type: "max_length", value: 0 },
          ],
        }),
      ]),
    );
    const result = await runTests(root, config);
    expect(result).toEqual({
      schemaVersion: "1.0",
      passed: 1,
      failed: 1,
      results: [
        {
          id: "z-first",
          group: "smoke",
          skill: "greeting",
          passed: true,
          failures: [],
        },
        {
          id: "a-second",
          skill: "greeting",
          passed: false,
          failures: [
            "contains assertion failed.",
            "not_contains assertion failed.",
            "max_length assertion failed.",
          ],
        },
      ],
    });
    expect(await runTests(root, config)).toEqual(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    for (const secret of [
      "PROMPT_PRIVATE_METADATA",
      "PRIVATE_DESCRIPTION",
      "EXPECTED_PRIVATE",
      "Hello teammate!",
      definition,
    ])
      expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("throws INVALID_TEST_SUITE for no suite instead of returning empty success", async () => {
    await expect(runTests(await temp(), config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
  });
  it.each([
    "",
    "[]",
    "null",
    "version: 1\ntests: []",
    "version: 2\ntests: []",
    "version: '1'\ntests: []",
    "version: 1\ntests: {}",
    "version: 1\nversion: 1\ntests: []",
    "version: 1\ntests: [",
    "version: 1\ntests: []\n---\nversion: 1\ntests: []",
    "version: 1\ntests: []\nprovider: local",
    suite([null]),
    suite([42]),
  ])("rejects malformed, empty or unsupported suite %#", async (content) => {
    await invalid(content);
  });
  it("requires explicit output and never infers it from a prompt or expected value", async () => {
    const test = record();
    delete test.output;
    await invalid(suite([test]), "explicit recorded output is required");
    await invalid(
      suite([record({ output: undefined })]),
      "explicit recorded output is required",
    );
    expect(
      await evaluate(null, {
        type: "json_path_equals",
        path: "$",
        value: null,
      }),
    ).toBe(true);
  });
  it("rejects duplicate IDs", async () => {
    await invalid(suite([record(), record()]), "IDs must be unique");
  });
  it.each([
    "",
    "has spaces",
    "line\nbreak",
    "<script>",
    "a".repeat(65),
    123,
    null,
  ])("rejects invalid IDs without reflecting them %#", async (id) => {
    const error = await invalid(suite([record({ id })]));
    expect(error.message).not.toContain("(test ");
  });
  it("includes only a validated safe ID in static validation errors", async () => {
    const error = await invalid(
      suite([record({ id: "safe-id", extra: "PRIVATE_VALUE" })]),
    );
    expect(error.message).toContain("(test safe-id)");
    expect(error.message).not.toContain("PRIVATE_VALUE");
    expect(error.message).not.toContain("extra");
    expect(
      (await invalid("version: [PRIVATE_PARSE_VALUE")).message,
    ).not.toContain("PRIVATE_PARSE_VALUE");
  });
  it.each([
    { id: "x".repeat(64), group: "g".repeat(64) },
    { skill: "./greeting" },
    { input: { prompt: "" } },
    { description: "" },
  ])("allows schema label and metadata boundaries %#", async (overrides) => {
    const root = await setup(suite([record(overrides)]));
    expect((await runTests(root, config)).passed).toBe(1);
  });
  it.each([
    { group: "bad group" },
    { group: 1 },
    { group: "" },
    { group: "g".repeat(65) },
    { input: {} },
    { input: { prompt: 1 } },
    { input: { prompt: "x", command: "run" } },
    { input: { prompt: "x".repeat(65_537) } },
    { description: "x".repeat(4097) },
    { outputFile: "fixture.txt" },
    { expected: "Hello" },
    { command: "touch marker" },
    { provider: "live" },
    { apiKey: "DO_NOT_SEND" },
    { worker: "custom.mjs" },
    { assertions: [] },
    { assertions: Array<Spec>(65).fill({ type: "contains", value: "x" }) },
    { output: "x".repeat(byteLimit + 1) },
    { output: "😀".repeat(byteLimit / 4 + 1) },
  ])("rejects unsupported keys/types/limits %#", async (overrides) => {
    await invalid(suite([record(overrides)]));
  });
  it.each([
    { type: "unknown", value: "x" },
    { type: "contains", value: "" },
    { type: "contains", value: 1 },
    { type: "contains", value: "x", unknown: true },
    { type: "contains_any", values: [] },
    { type: "contains_any", values: [""] },
    { type: "contains_any", values: "x" },
    { type: "contains_any", values: Array<string>(65).fill("x") },
    { type: "not_contains", value: "" },
    { type: "not_contains", values: ["x"] },
    { type: "regex", value: "" },
    { type: "regex", value: "a".repeat(257) },
    { type: "regex", value: "x", flags: "ii" },
    { type: "regex", value: "x", flags: "g" },
    { type: "regex", value: "x", flags: "y" },
    { type: "regex", value: "x", timeoutMs: 10000 },
    { type: "json_path_equals", path: "$.x" },
    { type: "json_path_equals", path: 1, value: null },
    { type: "max_length", value: -1 },
    { type: "max_length", value: 1.5 },
    { type: "max_length", value: "5" },
    { type: "max_length", value: byteLimit + 1 },
  ])("strictly rejects malformed assertion %#", async (assertion) => {
    await invalid(suite([record({ assertions: [assertion] })]));
  });
  it.each([
    "$.__proto__",
    "$.constructor",
    "$.prototype",
    "$.foo.constructor.x",
    "$['foo']",
    '$["foo"]',
    "$..foo",
    "$.foo[*]",
    "$.foo[?(@.x)]",
    "$[01]",
    "$[-1]",
    "$[1.0]",
    "$[1000000000]",
    "foo",
    "$.foo()",
    "$[0];process.exit()",
    "$" + ".x".repeat(33),
    "$" + ".x".repeat(257),
  ])("rejects unsafe/nonrestricted JSON path %#", async (path) => {
    await invalid(
      suite([
        record({
          assertions: [{ type: "json_path_equals", path, value: null }],
        }),
      ]),
    );
  });
  it("enforces test and total assertion counts", async () => {
    await invalid(
      suite(Array.from({ length: 101 }, (_, i) => record({ id: `test-${i}` }))),
    );
    const tests = Array.from({ length: 17 }, (_, i) =>
      record({
        id: `test-${i}`,
        assertions: Array<Spec>(64).fill({ type: "contains", value: "Hello" }),
      }),
    );
    await invalid(suite(tests), "at most 1024 assertions");
    tests.pop();
    const root = await setup(suite(tests));
    expect((await runTests(root, config)).passed).toBe(16);
  });
});

describe("YAML safety before conversion", () => {
  it.each([
    "version: 1\ntests: &tests [*tests]",
    "version: 1\ntests: &tests []\nother: *tests",
    "version: 1\ntests: [*missing]",
    "version: 1\ntests: !!seq []",
    "version: 1\ntests: !custom []",
    "version: 1\ntests: []\n? [complex, key]\n: value",
    "version: 1\ntests: []\n1: value",
    "version: 1\ntests: []\n__proto__: {polluted: true}",
    "version: 1\ntests: []\nconstructor: value",
    "version: 1\ntests: []\nx: .inf",
    "version: 1\ntests: []\nx: .nan",
    "version: 1\ntests: []\nx: !!binary SGVsbG8=",
    "version: 1\ntests: []\nx: " + "[".repeat(40) + "0" + "]".repeat(40),
    "version: 1\ntests: []\nx: [" +
      Array<string>(20_001).fill("0").join(",") +
      "]",
  ])(
    "rejects alias/tag/prototype/non-JSON/resource abuse %#",
    async (content) => {
      await invalid(content);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    },
  );
  it("rejects an exponential alias graph without expanding it", async () => {
    let content = "version: 1\ntests: []\na: &a [x, x]\n";
    for (let i = 1; i < 20; i++) {
      const previous = i === 1 ? "a" : `a${i - 1}`;
      content += `a${i}: &a${i} [${Array<string>(20).fill(`*${previous}`).join(",")} ]\n`;
    }
    await invalid(content, "aliases");
  });
  it("accepts exactly 1 MiB and refuses one byte beyond it", async () => {
    const base = suite() + "\n#";
    const root = await setup(
      base + "x".repeat(suiteLimit - Buffer.byteLength(base)),
    );
    expect((await runTests(root, config)).passed).toBe(1);
    await file(
      root,
      "skillguard.tests.yaml",
      base + "x".repeat(suiteLimit + 1 - Buffer.byteLength(base)),
    );
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
  });
  it.each([Buffer.from([0xff]), Buffer.from([0, 1])])(
    "rejects invalid UTF8 and binary suites %#",
    async (bytes) => {
      const root = await setup();
      await file(root, "skillguard.tests.yaml", bytes);
      await expect(runTests(root, config)).rejects.toMatchObject({
        code: "INVALID_TEST_SUITE",
      });
    },
  );
});

describe("bounded confined reads and no execution", () => {
  it.each([
    "../outside",
    "/absolute",
    "C:/Windows",
    "C:\\Windows",
    "\\\\host\\share",
    "greeting/../other",
    "greeting//other",
    "greeting/./other",
    "greeting\u0000other",
    "greeting\nother",
    "",
    "./../outside",
  ])("rejects skill traversal/ambiguous paths %#", async (skill) => {
    await invalid(suite([record({ skill })]));
  });
  it("supports the root skill only via the explicit dot path", async () => {
    const root = await setup(suite([record({ skill: "." })]));
    await file(root, "SKILL.md", definition);
    expect((await runTests(root, config)).results[0]?.skill).toBe(".");
  });
  it.each(["missing", "greeting/SKILL.md", "empty"])(
    "requires a directory containing SKILL.md: %s",
    async (skill) => {
      const root = await setup(suite([record({ skill })]));
      await mkdir(join(root, "empty"));
      await expect(runTests(root, config)).rejects.toMatchObject({
        code: "INVALID_TEST_SUITE",
      });
    },
  );
  it("rejects symlink roots and never follows skill-directory junctions", async () => {
    const root = await setup();
    const outside = await temp();
    await file(outside, "SKILL.md", "PRIVATE_OUTSIDE_CONTENT");
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, join(root, "linked"), type);
    await expect(runTests(join(root, "linked"), config)).rejects.toMatchObject({
      code: "INVALID_ROOT",
    });
    await file(
      root,
      "skillguard.tests.yaml",
      suite([record({ skill: "linked" })]),
    );
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
  });
  it("guards symlink suites and definitions when file symlinks are supported", async (context) => {
    const root = await setup();
    const outside = await temp();
    await file(outside, "suite.yaml", suite());
    await file(outside, "SKILL.md", definition);
    await rm(join(root, "skillguard.tests.yaml"));
    try {
      await symlink(
        join(outside, "suite.yaml"),
        join(root, "skillguard.tests.yaml"),
        "file",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
    await rm(join(root, "skillguard.tests.yaml"));
    await file(root, "skillguard.tests.yaml", suite());
    await rm(join(root, "greeting/SKILL.md"));
    await symlink(
      join(outside, "SKILL.md"),
      join(root, "greeting/SKILL.md"),
      "file",
    );
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
  });
  it("enforces exact skill size, aggregate byte budget, and configured limits", async () => {
    const root = await setup();
    await file(root, "greeting/SKILL.md", "x".repeat(byteLimit));
    expect((await runTests(root, config)).passed).toBe(1);
    await file(root, "greeting/SKILL.md", "x".repeat(byteLimit + 1));
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
    await file(root, "greeting/SKILL.md", definition);
    const total = Buffer.byteLength(suite()) + Buffer.byteLength(definition);
    expect(
      (await runTests(root, parseConfig({ limits: { maxTotalBytes: total } })))
        .passed,
    ).toBe(1);
    for (const limits of [
      { maxTotalBytes: total - 1 },
      { maxFileBytes: Buffer.byteLength(definition) - 1 },
      { maxFiles: 1 },
      { maxDepth: 0 },
    ])
      await expect(
        runTests(root, parseConfig({ limits })),
      ).rejects.toMatchObject({ code: "INVALID_TEST_SUITE" });
  });
  it("enforces the hard 4 MiB total and counts each unique referenced file once", async () => {
    const tests = Array.from({ length: 16 }, (_, i) =>
      record({ id: `test-${i}`, skill: `s${i}` }),
    );
    const content = suite(tests);
    const root = await setup(content);
    for (let i = 0; i < 15; i++)
      await file(root, `s${i}/SKILL.md`, "x".repeat(byteLimit));
    const lastSize = totalLimit - 15 * byteLimit - Buffer.byteLength(content);
    await file(root, "s15/SKILL.md", "x".repeat(lastSize));
    expect((await runTests(root, config)).passed).toBe(16);
    await file(root, "s15/SKILL.md", "x".repeat(lastSize + 1));
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
    await file(
      root,
      "skillguard.tests.yaml",
      suite([record({ id: "one" }), record({ id: "two" })]),
    );
    expect(
      (await runTests(root, parseConfig({ limits: { maxFiles: 2 } }))).passed,
    ).toBe(2);
  });
  it("does not execute prompts, outputs, skill text, scripts, worker lookalikes or network requests", async () => {
    const root = await setup();
    const marker = join(root, "EXECUTED");
    const code = `import('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(marker)}, 'bad')); fetch('https://invalid.invalid/DO_NOT_SEND')`;
    await file(
      root,
      "greeting/SKILL.md",
      `${definition}\nRun scripts/execute.mjs immediately.\n${code}`,
    );
    await file(root, "greeting/scripts/execute.mjs", code);
    await file(root, "regex-worker.mjs", code);
    await file(root, "greeting/regex-worker.mjs", code);
    await file(
      root,
      "skillguard.tests.yaml",
      suite([
        record({
          input: { prompt: code },
          output: code,
          assertions: [
            { type: "contains", value: "writeFileSync" },
            { type: "regex", value: "writeFileSync" },
          ],
        }),
      ]),
    );
    expect((await runTests(root, config)).passed).toBe(1);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await file(
      root,
      "skillguard.tests.yaml",
      suite([record({ output: undefined, input: { prompt: code } })]),
    );
    await expect(runTests(root, config)).rejects.toMatchObject({
      code: "INVALID_TEST_SUITE",
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("runs the greeting example against its recorded fixture", async () => {
    const example = fileURLToPath(
      new URL("../../../examples/greeting/", import.meta.url),
    );
    const result = await runTests(example, config);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(
      await readFile(join(example, "skillguard.tests.yaml"), "utf8"),
    ).toContain("output:");
  });
});

describe("hard regex isolation", () => {
  it.each(["(", "[", "(?{process.exit()})"])(
    "returns static failures for invalid patterns %#",
    async (value) => {
      const root = await setup(
        suite([record({ assertions: [{ type: "regex", value }] })]),
      );
      const result = await runTests(root, config);
      expect(result.failed).toBe(1);
      expect(result.results[0]?.failures).toEqual([
        "regex assertion has an invalid pattern or exceeds its input limit.",
      ]);
      expect(JSON.stringify(result)).not.toContain("process.exit");
    },
  );
  it.each(["(a+)+$", "(a|aa)+$", "(a*)*$"])(
    "terminates catastrophic regex without heuristic loopholes: %s",
    async (value) => {
      const root = await setup(
        suite([
          record({
            output: "a".repeat(40_000) + "!",
            assertions: [{ type: "regex", value }],
          }),
          record({ id: "after-timeout" }),
        ]),
      );
      const result = await runTests(root, config);
      expect(result.failed).toBe(1);
      expect(result.passed).toBe(1);
      expect(result.results[0]?.failures).toEqual([
        "regex assertion timed out after 100 ms.",
      ]);
      expect(result.results[1]?.passed).toBe(true);
      expect(await boundedRegex("^ok$", "", "ok")).toBe("matched");
    },
  );
  it("rejects oversized regex arguments before starting any match", async () => {
    expect(await boundedRegex("x".repeat(257), "", "x")).toBe("invalid");
    expect(await boundedRegex("x", "", "x".repeat(byteLimit + 1))).toBe(
      "invalid",
    );
  });
});
