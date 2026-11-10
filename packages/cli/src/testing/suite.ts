import { lstat } from "node:fs/promises";
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import type { Config } from "../config/config.js";
import {
  assertSafePath,
  canonicalRoot,
  readText,
  ScanError,
} from "../discovery/filesystem.js";
import { forbiddenKeys } from "./json-path.js";
import { envelopeSchema, labelSchema, testSchema } from "./schema.js";
import type { RecordedTest } from "./schema.js";

export function invalidSuite(message: string, id?: string): ScanError {
  const label =
    id !== undefined && labelSchema.safeParse(id).success
      ? ` (test ${id})`
      : "";
  return new ScanError(
    "INVALID_TEST_SUITE",
    `Invalid test suite${label}: ${message}`,
  );
}

function parseYaml(content: string): unknown {
  try {
    const document = parseDocument(content, {
      version: "1.2",
      schema: "core",
      customTags: [],
      resolveKnownTags: false,
      merge: false,
      strict: true,
      uniqueKeys: true,
      prettyErrors: false,
      logLevel: "error",
    });
    if (document.errors.length || document.warnings.length)
      throw invalidSuite(
        "expected one valid YAML 1.2 document with unique string keys.",
      );

    const pending: { node: unknown; depth: number }[] = [
      { node: document.contents, depth: 0 },
    ];
    let count = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++count > 20_000 || depth > 32)
        throw invalidSuite("YAML exceeds the node or nesting limit.");
      if (node === null) continue;
      if (!isNode(node) || isAlias(node) || node.anchor || node.tag)
        throw invalidSuite(
          "YAML aliases, anchors and explicit tags are not supported.",
        );
      if (isMap(node)) {
        for (const pair of node.items) {
          if (
            !isScalar(pair.key) ||
            typeof pair.key.value !== "string" ||
            forbiddenKeys.has(pair.key.value)
          )
            throw invalidSuite(
              "YAML keys must be safe strings, not prototype keys.",
            );
          pending.push({ node: pair.key, depth: depth + 1 });
          pending.push({ node: pair.value, depth: depth + 1 });
        }
      } else if (isSeq(node)) {
        for (const item of node.items)
          pending.push({ node: item, depth: depth + 1 });
      } else if (
        !isScalar(node) ||
        (node.value !== null &&
          typeof node.value !== "string" &&
          typeof node.value !== "boolean" &&
          !(typeof node.value === "number" && Number.isFinite(node.value)))
      ) {
        throw invalidSuite(
          "YAML values must be finite JSON-compatible values.",
        );
      }
    }
    // Conversion happens only after inspecting the entire bounded AST.
    return document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch (error) {
    if (error instanceof ScanError) throw error;
    throw invalidSuite("cannot parse a bounded YAML document.");
  }
}

export async function loadSuite(
  root: string,
  config: Config,
): Promise<RecordedTest[]> {
  const canonical = await canonicalRoot(root);
  const totalLimit = Math.min(config.limits.maxTotalBytes, 4 * 1024 * 1024);
  const fileLimit = Math.min(config.limits.maxFileBytes, 262_144);
  let total = 0;
  let files = 0;
  async function read(path: string, limit: number): Promise<string> {
    if (++files > Math.min(config.limits.maxFiles, 1000))
      throw invalidSuite("referenced files exceed the file-count limit.");
    try {
      const content = await readText(
        canonical,
        path,
        Math.min(limit, totalLimit - total),
      );
      total += Buffer.byteLength(content, "utf8");
      return content;
    } catch {
      throw invalidSuite(
        "a required file is missing, unsafe, unreadable or exceeds a byte limit.",
      );
    }
  }

  const content = await read("skillguard.tests.yaml", 1024 * 1024);
  const envelope = envelopeSchema.safeParse(parseYaml(content));
  if (!envelope.success)
    throw invalidSuite(
      "expected version: 1 and a nonempty tests array (at most 100 tests); unknown keys are not allowed.",
    );

  const tests: RecordedTest[] = [];
  const ids = new Set<string>();
  let assertions = 0;
  for (const raw of envelope.data.tests) {
    const id =
      raw !== null &&
      typeof raw === "object" &&
      "id" in raw &&
      typeof raw.id === "string"
        ? raw.id
        : undefined;
    if (
      raw !== null &&
      typeof raw === "object" &&
      !Object.hasOwn(raw, "output")
    )
      throw invalidSuite(
        "an explicit recorded output is required; input.prompt is metadata, never agent execution.",
        id,
      );
    const test = testSchema.safeParse(raw);
    if (!test.success)
      throw invalidSuite(
        "unsupported keys, types, labels, paths, assertion fields or fixture sizes.",
        id,
      );
    if (ids.has(test.data.id))
      throw invalidSuite("test IDs must be unique.", test.data.id);
    ids.add(test.data.id);
    assertions += test.data.assertions.length;
    if (assertions > 1024)
      throw invalidSuite("a suite may contain at most 1024 assertions.");
    tests.push(test.data);
  }

  // Validate all records before reading definitions or starting regex workers.
  const seen = new Set<string>();
  for (const test of tests) {
    if (seen.has(test.skill)) continue;
    const depth = test.skill === "." ? 0 : test.skill.split("/").length;
    if (depth > config.limits.maxDepth)
      throw invalidSuite(
        "skill path exceeds the directory-depth limit.",
        test.id,
      );
    try {
      const directory =
        test.skill === "."
          ? canonical
          : await assertSafePath(canonical, test.skill);
      if (!(await lstat(directory)).isDirectory())
        throw invalidSuite(
          "skill must be an ordinary directory containing SKILL.md.",
          test.id,
        );
      await read(
        test.skill === "." ? "SKILL.md" : `${test.skill}/SKILL.md`,
        fileLimit,
      );
    } catch {
      throw invalidSuite(
        "skill must be a safe, readable directory containing a bounded ordinary SKILL.md file.",
        test.id,
      );
    }
    seen.add(test.skill);
  }
  return tests;
}
