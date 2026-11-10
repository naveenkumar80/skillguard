import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import type { Node } from "yaml";
import type { Finding, RuleMetadata } from "../core/models.js";

const specification =
  "https://raw.githubusercontent.com/agentskills/agentskills/83021e2be457a9b6679148719c1f6074f0ad975e/docs/specification.mdx";
const maxFrontmatterLength = 262_144;
const maxNodes = 10_000;
const maxDepth = 64;
const maxAliases = 100;

function rule(
  id: string,
  title: string,
  description: string,
  remediation: string,
  category: RuleMetadata["category"] = "spec",
): RuleMetadata {
  return {
    id,
    version: "1.0.0",
    title,
    category,
    defaultSeverity: category === "quality" ? "info" : "high",
    confidence: "high",
    description,
    remediation,
    references: [specification],
  };
}

const frontmatterRule = rule(
  "SG-SPEC-001",
  "Invalid YAML frontmatter",
  "Frontmatter must be a delimited, syntactically valid YAML mapping with unique mapping keys.",
  "Provide a valid YAML mapping between opening and closing delimiter lines; correct malformed syntax, unresolved aliases, or duplicate mapping keys.",
);
const nameRule = rule(
  "SG-SPEC-002",
  "Invalid skill name",
  "A name must contain 1–64 lowercase Unicode letters, numbers, or single interior hyphens.",
  "Provide a string name of 1–64 Unicode code points using lowercase letters, numbers, and single interior hyphens.",
);
const directoryRule = rule(
  "SG-SPEC-003",
  "Skill name does not match its directory",
  "A valid skill name must exactly match the containing directory name.",
  "Make the skill name and its containing directory name identical.",
);
const descriptionRule = rule(
  "SG-SPEC-004",
  "Invalid skill description",
  "A description must be a nonblank string of 1–1024 Unicode code points.",
  "Provide a nonblank string description of at most 1024 Unicode code points.",
);
const compatibilityRule = rule(
  "SG-SPEC-005",
  "Invalid compatibility declaration",
  "If present, compatibility must be a string of 1–500 Unicode code points.",
  "Omit compatibility or provide a string of 1–500 Unicode code points.",
);
const metadataRule = rule(
  "SG-SPEC-006",
  "Invalid additional metadata",
  "If present, metadata must map string keys to string values.",
  "Omit metadata or provide a mapping whose keys and values are all strings.",
);
const licenseRule = rule(
  "SG-SPEC-007",
  "Invalid license declaration",
  "If present, license must be a string.",
  "Omit license or provide a string license name or reference.",
);
const toolsRule = rule(
  "SG-SPEC-008",
  "Invalid allowed tools declaration",
  "If present, the experimental allowed-tools field must be a string.",
  "Omit allowed-tools or provide a space-separated string of tools.",
);
const parserSafetyRule = rule(
  "SG-STRUCT-008",
  "Parser safety limit or unsupported YAML construct",
  "Frontmatter exceeds local parser safety limits or uses a YAML construct unsupported by this parser profile; this is not a specification violation.",
  "Reduce frontmatter size, nesting, nodes, or alias references, and replace unsupported tags or cyclic aliases with plain YAML values.",
  "structure",
);
const lengthRule = rule(
  "SG-QUAL-001",
  "Consider shortening the skill document",
  "Documents longer than 500 lines may benefit from progressive disclosure; this is not a format requirement.",
  "Consider moving detailed material into referenced files to keep the main document near or below 500 lines.",
  "quality",
);

export const formatRules: RuleMetadata[] = [
  frontmatterRule,
  nameRule,
  directoryRule,
  descriptionRule,
  compatibilityRule,
  metadataRule,
  licenseRule,
  toolsRule,
  parserSafetyRule,
  lengthRule,
];

function children(node: Node): Node[] {
  if (isMap(node)) {
    return node.items.flatMap((pair) => [pair.key, pair.value].filter(isNode));
  }
  return isSeq(node) ? node.items.filter(isNode) : [];
}

/** Inspect the graph without materializing aliases or constructing JS objects. */
function inspect(root: Node): {
  resolve: (node: unknown) => unknown;
  issue: { rule: RuleMetadata; offset: number } | null;
} {
  const anchors = new Map<string, Node>();
  const targets = new Map<Node, Node>();
  const nodes: Node[] = [];
  const pending = [{ node: root, depth: 1 }];
  let aliases = 0;
  const resolve = (node: unknown): unknown =>
    isAlias(node) ? targets.get(node) : node;

  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    const { node, depth } = entry;
    nodes.push(node);
    if (nodes.length > maxNodes || depth > maxDepth) {
      return {
        resolve,
        issue: { rule: parserSafetyRule, offset: node.range?.[0] ?? 0 },
      };
    }
    if (node.anchor) anchors.set(node.anchor, node);
    if (isAlias(node)) {
      const target = anchors.get(node.source);
      if (!target) {
        return {
          resolve,
          issue: { rule: frontmatterRule, offset: node.range?.[0] ?? 0 },
        };
      }
      if (++aliases > maxAliases) {
        return {
          resolve,
          issue: { rule: parserSafetyRule, offset: node.range?.[0] ?? 0 },
        };
      }
      targets.set(node, target);
    }
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index--) {
      const child = nested[index];
      if (child) pending.push({ node: child, depth: depth + 1 });
    }
  }

  const active = new Set<Node>();
  const depths = new Map<Node, number>();
  let invalidOffset: number | null = null;
  function graphDepth(node: Node, depth: number): number {
    if (depth > maxDepth || active.has(node)) {
      invalidOffset = node.range?.[0] ?? 0;
      return maxDepth + 1;
    }
    const cached = depths.get(node);
    if (cached !== undefined) return cached;
    active.add(node);
    const target = targets.get(node);
    let height = 1;
    for (const child of target ? [target] : children(node)) {
      height = Math.max(height, 1 + graphDepth(child, depth + 1));
      if (invalidOffset !== null) break;
    }
    active.delete(node);
    depths.set(node, height);
    if (height > maxDepth) invalidOffset ??= node.range?.[0] ?? 0;
    return height;
  }
  graphDepth(root, 1);
  if (invalidOffset !== null) {
    return {
      resolve,
      issue: { rule: parserSafetyRule, offset: invalidOffset },
    };
  }

  // Intern structural identities instead of expanding complex or aliased keys.
  const scalarIds = new Map<unknown, number>();
  const collectionIds = new Map<string, number>();
  const identities = new Map<Node, number>();
  let nextId = 0;
  function identity(value: unknown): number {
    const node = resolve(value);
    if (!isNode(node)) return -1;
    const cached = identities.get(node);
    if (cached !== undefined) return cached;
    let id: number;
    if (isScalar(node)) {
      id = scalarIds.get(node.value) ?? nextId++;
      scalarIds.set(node.value, id);
    } else {
      const signature = isMap(node)
        ? `map:${node.items
            .map((pair) => `${identity(pair.key)}:${identity(pair.value)}`)
            .sort()
            .join(",")}`
        : `seq:${children(node).map(identity).join(",")}`;
      id = collectionIds.get(signature) ?? nextId++;
      collectionIds.set(signature, id);
    }
    identities.set(node, id);
    return id;
  }
  for (const node of nodes) {
    if (!isMap(node)) continue;
    const keys = new Set<number>();
    for (const pair of node.items) {
      const key = identity(pair.key);
      if (keys.has(key)) {
        return {
          resolve,
          issue: {
            rule: frontmatterRule,
            offset: isNode(pair.key) ? (pair.key.range?.[0] ?? 0) : 0,
          },
        };
      }
      keys.add(key);
    }
  }
  return { resolve, issue: null };
}

function stringValue(node: unknown): string | null {
  return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

function hasLength(value: string, minimum: number, maximum: number): boolean {
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

export function validateFormat(
  content: string,
  relativePath: string,
  directoryName: string,
  quality = false,
): {
  findings: Finding[];
  name: string | null;
  body: string;
  bodyStartLine: number;
} {
  const findings: Finding[] = [];
  const result = {
    findings,
    name: null as string | null,
    body: content,
    bodyStartLine: 1,
  };
  const lineStarts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") lineStarts.push(index + 1);
  }
  function location(offset: number): { line: number; column: number } {
    const bounded = Math.max(0, Math.min(offset, content.length));
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if ((lineStarts[middle] ?? 0) <= bounded) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: bounded - (lineStarts[low] ?? 0) + 1 };
  }
  function report(metadata: RuleMetadata, offset = 0): void {
    findings.push({
      schemaVersion: "1.0",
      ruleId: metadata.id,
      title: metadata.title,
      category: metadata.category,
      severity: metadata.defaultSeverity,
      confidence: metadata.confidence,
      path: relativePath,
      ...location(offset),
      message: metadata.description,
      evidence: { redacted: true, excerpt: "[REDACTED]" },
      remediation: metadata.remediation,
      references: [...metadata.references],
    });
  }

  const lineCount = lineStarts.length - (content.endsWith("\n") ? 1 : 0);
  if (quality && lineCount > 500) report(lengthRule, lineStarts[500]);

  const opening = /^\uFEFF?---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!opening) {
    report(frontmatterRule);
    return result;
  }
  const closingPattern = /^---[ \t]*(?:\r?\n|$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(content);
  if (!closing) {
    report(frontmatterRule);
    return result;
  }
  const start = opening[0].length;
  const frontmatter = content.slice(start, closing.index);
  result.body = content.slice(closing.index + closing[0].length);
  result.bodyStartLine = location(closing.index).line + 1;
  if (frontmatter.length > maxFrontmatterLength) {
    report(parserSafetyRule, start);
    return result;
  }

  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(frontmatter, {
      version: "1.2",
      schema: "core",
      customTags: [],
      resolveKnownTags: false,
      merge: false,
      strict: true,
      uniqueKeys: true,
      prettyErrors: false,
      // "silent" suppresses MULTIPLE_DOCS errors in yaml 2.9.1.
      logLevel: "error",
    });
  } catch {
    report(parserSafetyRule, start);
    return result;
  }
  const resourceProblem = document.errors.find(
    (problem) => problem.code === "RESOURCE_EXHAUSTION",
  );
  const problem = resourceProblem ?? document.errors[0] ?? document.warnings[0];
  if (problem) {
    report(
      resourceProblem || document.errors.length === 0
        ? parserSafetyRule
        : frontmatterRule,
      start + problem.pos[0],
    );
    return result;
  }
  if (!isMap(document.contents)) {
    report(frontmatterRule, start + (document.contents?.range?.[0] ?? 0));
    return result;
  }
  const { resolve, issue } = inspect(document.contents);
  if (issue) {
    report(issue.rule, start + issue.offset);
    return result;
  }
  function field(key: string): {
    present: boolean;
    value: unknown;
    offset: number;
  } {
    const pair =
      document.contents && isMap(document.contents)
        ? document.contents.items.find(
            (item) => stringValue(resolve(item.key)) === key,
          )
        : undefined;
    return {
      present: pair !== undefined,
      value: resolve(pair?.value),
      offset: start + (isNode(pair?.key) ? (pair.key.range?.[0] ?? 0) : 0),
    };
  }

  const name = field("name");
  const nameValue = stringValue(name.value);
  if (
    nameValue === null ||
    !hasLength(nameValue, 1, 64) ||
    !/^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$/u.test(nameValue)
  ) {
    report(nameRule, name.offset);
  } else {
    result.name = nameValue;
    if (nameValue !== directoryName) report(directoryRule, name.offset);
  }

  const description = field("description");
  const descriptionValue = stringValue(description.value);
  if (
    descriptionValue === null ||
    !descriptionValue.trim() ||
    !hasLength(descriptionValue, 1, 1024)
  ) {
    report(descriptionRule, description.offset);
  }

  const compatibility = field("compatibility");
  const compatibilityValue = stringValue(compatibility.value);
  if (
    compatibility.present &&
    (compatibilityValue === null || !hasLength(compatibilityValue, 1, 500))
  ) {
    report(compatibilityRule, compatibility.offset);
  }

  const metadata = field("metadata");
  if (metadata.present) {
    if (!isMap(metadata.value)) report(metadataRule, metadata.offset);
    else {
      for (const pair of metadata.value.items) {
        if (
          stringValue(resolve(pair.key)) === null ||
          stringValue(resolve(pair.value)) === null
        ) {
          report(
            metadataRule,
            start +
              (isNode(pair.key)
                ? (pair.key.range?.[0] ?? 0)
                : metadata.offset - start),
          );
          break;
        }
      }
    }
  }

  for (const [key, metadata] of [
    ["license", licenseRule],
    ["allowed-tools", toolsRule],
  ] as const) {
    const item = field(key);
    if (item.present && stringValue(item.value) === null)
      report(metadata, item.offset);
  }
  return result;
}
