import { posix } from "node:path";
import MarkdownIt from "markdown-it";

import type { Config } from "../config/config.js";
import type { CheckContext } from "../core/check.js";
import type { Finding, RuleMetadata } from "../core/models.js";
import {
  assertSafePath,
  excluded,
  readText,
  safeRelative,
  ScanError,
} from "../discovery/filesystem.js";

function rule(
  id: string,
  title: string,
  description: string,
  remediation: string,
  quality = false,
): RuleMetadata {
  return {
    id,
    version: "1.0.0",
    title,
    description,
    remediation,
    category: quality ? "quality" : "structure",
    defaultSeverity: quality ? "info" : "high",
    confidence: "high",
    references: [],
  };
}

const missingRule = rule(
  "SG-REF-001",
  "Missing local resource",
  "A local Markdown reference points to a resource that does not exist.",
  "Add the intended resource inside this skill or correct the local reference.",
);
const unsafeRule = rule(
  "SG-REF-002",
  "Unsafe resource reference",
  "A Markdown reference uses an unsafe path, unsupported scheme, or crosses a skill boundary.",
  "Use an unambiguous relative path within the same skill, without parent traversal, absolute paths, or unsafe encoding.",
);
const symlinkRule = rule(
  "SG-REF-003",
  "Symbolic link in resource reference",
  "A local Markdown reference encounters a symbolic link; the resource was not followed.",
  "Replace symbolic links, including intermediate directory links, with ordinary resources inside this skill.",
);
const incompleteRule = rule(
  "SG-REF-004",
  "Resource validation incomplete",
  "A referenced resource could not be safely validated within the configured limits.",
  "Check resource size, encoding, permissions, and scan limits; scan an immutable local snapshot.",
);
const omittedRule = rule(
  "SG-REF-005",
  "Referenced resource omitted from inventory",
  "A local Markdown reference targets an excluded or unindexed resource; validation was omitted, not passed.",
  "Review exclusions and inventory limits, then include the intended ordinary resource in the scan.",
);
const duplicateRule = rule(
  "SG-REF-006",
  "Duplicate local reference",
  "This Markdown document repeats a local reference with the same normalized path and query/fragment suffix; this is optional advice, not a specification violation.",
  "Consider consolidating repeated references where doing so improves clarity.",
  true,
);

export const referenceRules: RuleMetadata[] = [
  missingRule,
  unsafeRule,
  symlinkRule,
  incompleteRule,
  omittedRule,
  duplicateRule,
];

function finding(rule: RuleMetadata, path: string, line: number): Finding {
  return {
    schemaVersion: "1.0",
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
    severity: rule.defaultSeverity,
    confidence: rule.confidence,
    path,
    line,
    column: 1,
    message: rule.description,
    evidence: { redacted: true, excerpt: "[REDACTED]" },
    remediation: rule.remediation,
    references: rule.references,
  };
}

// Permit parsing of unsafe schemes so they produce findings instead of silently
// becoming text. Destinations are never rendered, fetched, or executed.
const markdown = new MarkdownIt({ html: false, linkify: false });
markdown.validateLink = () => true;
markdown.normalizeLink = (destination) => destination;

function markdownBody(content: string): string {
  const lines = content.split(/\r\n|\n|\r/u);
  if (!/^\uFEFF?---[ \t]*$/u.test(lines[0] ?? "")) return content;
  const closing = lines.findIndex(
    (line, index) => index > 0 && /^---[ \t]*$/u.test(line),
  );
  if (closing < 0) return content;
  // Blank, rather than remove, frontmatter to retain original token-map lines.
  return lines.map((line, index) => (index <= closing ? "" : line)).join("\n");
}

interface Link {
  destination: string;
  line: number;
}
function links(content: string): Link[] {
  const result: Link[] = [];
  let blockLine = 1;
  const pending: {
    token: ReturnType<typeof markdown.parse>[number];
    line: number;
  }[] = markdown
    .parse(markdownBody(content), {})
    .map((token) => {
      // Some inline tokens (notably table cells) have no map of their own.
      if (token.map) blockLine = token.map[0] + 1;
      return { token, line: blockLine };
    })
    .reverse();
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    const { token } = entry;
    const line = token.map ? token.map[0] + 1 : entry.line;
    const destination =
      token.type === "link_open"
        ? token.attrGet("href")
        : token.type === "image"
          ? token.attrGet("src")
          : null;
    if (destination !== null)
      result.push({ destination: String(destination), line });
    // Image children describe alt text, not rendered hyperlinks.
    if (token.type !== "image")
      for (const child of [...(token.children ?? [])].reverse())
        pending.push({ token: child, line });
  }
  return result;
}

type Destination =
  | { kind: "ignored" }
  | { kind: "unsafe" }
  | { kind: "local"; path: string; suffix: string };
function destination(value: string): Destination {
  if (value.startsWith("#")) return { kind: "ignored" };
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
  if (scheme)
    return {
      kind: ["http", "https", "mailto"].includes(scheme) ? "ignored" : "unsafe",
    };
  const end = value.search(/[?#]/u);
  const encoded = end < 0 ? value : value.slice(0, end);
  const suffix = end < 0 ? "" : value.slice(end);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return { kind: "unsafe" };
  }
  if (
    !decoded ||
    decoded.startsWith("/") ||
    /[\\:?#\uFFFD]/u.test(decoded) ||
    /%[0-9a-f]{2}/iu.test(decoded) ||
    /%2f|%5c/iu.test(encoded) ||
    decoded.split("/").some((part) => part === ".." || part === "")
  )
    return { kind: "unsafe" };
  // Only harmless dot segments are normalized; never normalize away '..'.
  const path = decoded
    .split("/")
    .filter((part) => part !== ".")
    .join("/");
  return safeRelative(path)
    ? { kind: "local", path, suffix }
    : { kind: "unsafe" };
}

const key = (path: string): string =>
  process.platform === "win32" ? path.toLowerCase() : path;
const markdownFile = (path: string): boolean => /\.md$/iu.test(path);
const within = (directory: string, path: string): boolean =>
  directory === "." || key(path).startsWith(`${key(directory)}/`);

function failure(error: unknown): RuleMetadata {
  if (error instanceof ScanError) {
    if (error.code === "SYMLINK") return symlinkRule;
    if (error.code === "UNSAFE_PATH") return unsafeRule;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
    return missingRule;
  return incompleteRule;
}

export async function validateReferences(
  context: CheckContext,
  config: Config,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = new Map(
    context.inventory.files.map((file) => [key(file.path), file]),
  );
  const skillDirectories = context.inventory.files
    .filter((file) => posix.basename(file.path) === "SKILL.md")
    .map((file) => posix.dirname(file.path))
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const owner = (path: string): string | undefined =>
    skillDirectories.find((directory) => within(directory, path));
  const omitted = (path: string): boolean => {
    // Discovery prunes excluded directories before visiting their descendants.
    for (let current = path; current !== "."; current = posix.dirname(current))
      if (excluded(current, config.exclude)) return true;
    return false;
  };
  const queue = [...context.contents.keys()]
    .filter(
      (path) =>
        markdownFile(path) &&
        safeRelative(path) &&
        files.has(key(path)) &&
        !omitted(path) &&
        owner(path) !== undefined,
    )
    .sort()
    .map((path) => ({ path, depth: 0 }));
  const visited = new Set(queue.map(({ path }) => key(path)));
  const failures = new Map<string, RuleMetadata>();
  let count = context.contents.size;
  let totalBytes = [...context.contents.values()].reduce(
    (sum, content) => sum + Buffer.byteLength(content),
    0,
  );

  // FIFO gives the shortest reference depth first; source/token order and
  // inventory-relative labels make both traversal and budget allocation stable.
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    if (!entry) continue;
    const { path, depth } = entry;
    const content = context.contents.get(path);
    if (content === undefined) continue;
    if (
      Buffer.byteLength(content) > config.limits.maxFileBytes ||
      count > config.limits.maxFiles ||
      totalBytes > config.limits.maxTotalBytes
    ) {
      findings.push(finding(incompleteRule, path, 1));
      continue;
    }
    let references: Link[];
    try {
      references = links(content);
    } catch {
      findings.push(finding(incompleteRule, path, 1));
      continue;
    }
    const seen = new Set<string>();
    for (const reference of references) {
      const emit = (rule: RuleMetadata): void => {
        findings.push(finding(rule, path, reference.line));
      };
      const local = destination(reference.destination);
      if (local.kind === "ignored") continue;
      if (local.kind === "unsafe") {
        emit(unsafeRule);
        continue;
      }
      const candidate = posix.join(posix.dirname(path), local.path);
      if (
        !safeRelative(candidate) ||
        owner(candidate) === undefined ||
        key(owner(candidate) ?? "") !== key(owner(path) ?? "")
      ) {
        emit(unsafeRule);
        continue;
      }
      const indexed = files.get(key(candidate));
      const target = indexed?.path ?? candidate;
      const identity = JSON.stringify([key(target), local.suffix]);
      if (config.checks.quality && seen.has(identity)) emit(duplicateRule);
      seen.add(identity);
      if (omitted(target)) {
        emit(omittedRule);
        continue;
      }
      const previousFailure = failures.get(key(target));
      if (previousFailure) {
        emit(previousFailure);
        continue;
      }
      // Even unindexed targets get an existence/symlink check, never a read.
      // assertSafePath checks all components before realpath can follow them.
      try {
        await assertSafePath(context.inventory.root, target);
      } catch (error) {
        const rule = failure(error);
        failures.set(key(target), rule);
        emit(rule);
        continue;
      }
      if (!indexed) {
        emit(omittedRule);
        continue;
      }
      if (!markdownFile(target) || visited.has(key(target))) continue;
      if (
        depth + 1 > config.limits.maxDepth ||
        count >= config.limits.maxFiles ||
        indexed.size > config.limits.maxFileBytes ||
        totalBytes + indexed.size > config.limits.maxTotalBytes
      ) {
        emit(incompleteRule);
        continue;
      }
      visited.add(key(target));
      count++;
      const allowance = Math.min(
        config.limits.maxFileBytes,
        config.limits.maxTotalBytes - totalBytes,
      );
      try {
        const text = await readText(context.inventory.root, target, allowance);
        totalBytes += Buffer.byteLength(text);
        context.contents.set(target, text);
        queue.push({ path: target, depth: depth + 1 });
      } catch (error) {
        // The helper cannot return bytes consumed on failure. Charge its full
        // allowance so malformed resources cannot bypass aggregate read limits.
        totalBytes += allowance;
        const rule = failure(error);
        failures.set(key(target), rule);
        emit(rule);
      }
    }
  }
  return findings.sort((a, b) =>
    a.path < b.path
      ? -1
      : a.path > b.path
        ? 1
        : a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );
}
