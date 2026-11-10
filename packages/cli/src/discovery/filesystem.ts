import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { minimatch } from "minimatch";
import type { Finding, RuleMetadata } from "../core/models.js";

export const defaultLimits = Object.freeze({
  maxEntries: 10000,
  maxFiles: 1000,
  maxDepth: 16,
  maxFileBytes: 262144,
  maxTotalBytes: 4 * 1024 * 1024,
});
export interface Limits {
  maxEntries: number;
  maxFiles: number;
  maxDepth: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}
export interface IndexedFile {
  path: string;
  size: number;
}
export interface Inventory {
  root: string;
  files: IndexedFile[];
  findings: Finding[];
  complete: boolean;
}
export class ScanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScanError";
  }
}
const definitions = [
  [
    "SG-STRUCT-001",
    "No skill definition found",
    "Add a SKILL.md file or select a directory containing skills.",
  ],
  [
    "SG-STRUCT-002",
    "Symbolic link excluded",
    "Replace symlinks with ordinary files inside the scan root.",
  ],
  [
    "SG-STRUCT-003",
    "Scan resource limit reached",
    "Reduce scan scope or explicitly adjust safe resource limits.",
  ],
  [
    "SG-STRUCT-004",
    "Unsupported filesystem object",
    "Use ordinary files and directories; do not include devices or named pipes.",
  ],
  [
    "SG-STRUCT-005",
    "Duplicate skill name",
    "Give each skill in this scan a distinct name matching its directory.",
  ],
  [
    "SG-STRUCT-006",
    "Unsafe resource path",
    "Remove absolute paths, traversal, control characters and ambiguous separators.",
  ],
  [
    "SG-STRUCT-007",
    "Resource could not be read safely",
    "Check permissions and file encoding; scan an immutable local snapshot.",
  ],
] as const;
export const structureRules: RuleMetadata[] = definitions.map(
  ([id, title, remediation]) => ({
    id,
    title,
    remediation,
    version: "1.0.0",
    category: "structure",
    defaultSeverity: "high",
    confidence: "high",
    description: title,
    references: [],
  }),
);
export function structureFinding(
  id: string,
  path: string,
  line = 1,
  column = 1,
): Finding {
  const rule = structureRules.find((item) => item.id === id);
  if (!rule) throw new Error("Unknown structure rule");
  return {
    schemaVersion: "1.0",
    ruleId: id,
    title: rule.title,
    category: rule.category,
    severity: rule.defaultSeverity,
    confidence: rule.confidence,
    path,
    line,
    column,
    message: rule.description,
    evidence: { redacted: true, excerpt: "[Content omitted]" },
    remediation: rule.remediation,
    references: rule.references,
  };
}
export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}
export function safeRelative(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    !path.startsWith("/") &&
    !/[\\:]/u.test(path) &&
    !Array.from(path).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}
export function normalizedRelative(root: string, absolute: string): string {
  const path = relative(root, absolute).split(sep).join("/");
  if (!isWithin(root, absolute) || !safeRelative(path))
    throw new ScanError(
      "UNSAFE_PATH",
      "Resource path is not safely representable within the scan root",
    );
  return path;
}
export async function canonicalRoot(input: string): Promise<string> {
  try {
    const absolute = resolve(input);
    const stat = await lstat(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Not an ordinary directory");
    return await realpath(absolute);
  } catch {
    throw new ScanError(
      "INVALID_ROOT",
      "Scan root must be an accessible ordinary directory, not a symlink",
    );
  }
}
export async function assertSafePath(
  root: string,
  path: string,
): Promise<string> {
  if (!safeRelative(path))
    throw new ScanError("UNSAFE_PATH", "Unsafe resource path");
  const candidate = resolve(root, ...path.split("/"));
  if (!isWithin(root, candidate))
    throw new ScanError("UNSAFE_PATH", "Resource escapes scan root");
  let current = root;
  for (const component of path.split("/")) {
    current = join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink())
      throw new ScanError("SYMLINK", "Symbolic links are not followed");
  }
  const canonical = await realpath(candidate);
  if (!isWithin(root, canonical))
    throw new ScanError("UNSAFE_PATH", "Resource escapes scan root");
  return candidate;
}
export async function readText(
  root: string,
  path: string,
  maxBytes: number,
): Promise<string> {
  const candidate = await assertSafePath(root, path);
  const before = await lstat(candidate);
  if (!before.isFile() || before.size > maxBytes)
    throw new ScanError(
      "FILE_LIMIT",
      "Resource is not an ordinary file within the configured size limit",
    );
  const handle = await open(
    candidate,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > maxBytes
    )
      throw new ScanError("FILE_CHANGED", "Resource changed while opening");
    await assertSafePath(root, path);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > maxBytes)
      throw new ScanError(
        "FILE_LIMIT",
        "Resource exceeds the configured size limit",
      );
    const bytes = buffer.subarray(0, offset);
    if (bytes.includes(0))
      throw new ScanError(
        "BINARY_FILE",
        "Binary content is not parsed as text",
      );
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ScanError(
        "INVALID_ENCODING",
        "Resource is not valid UTF-8 text",
      );
    }
  } finally {
    await handle.close();
  }
}
export const defaultExclusions = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.venv/**",
  "**/dist/**",
  "**/coverage/**",
];
export function excluded(path: string, patterns: readonly string[]): boolean {
  return [...defaultExclusions, ...patterns].some(
    (pattern) =>
      minimatch(path, pattern, {
        dot: true,
        nocase: process.platform === "win32",
      }) ||
      minimatch(`${path}/`, pattern, {
        dot: true,
        nocase: process.platform === "win32",
      }),
  );
}
export async function inventory(
  input: string,
  exclusions: readonly string[] = [],
  limits: Limits = defaultLimits,
): Promise<Inventory> {
  const root = await canonicalRoot(input);
  const result: Inventory = { root, files: [], findings: [], complete: true };
  let count = 0;
  let limited = false;
  const fail = (id: string, path: string): void => {
    result.complete = false;
    result.findings.push(
      structureFinding(id, safeRelative(path) ? path : "SKILL.md"),
    );
  };
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (limited) return;
    const location =
      relative(root, directory).split(sep).join("/") || "SKILL.md";
    if (depth > limits.maxDepth) {
      fail("SG-STRUCT-003", location);
      return;
    }
    try {
      if (directory !== root)
        await assertSafePath(root, normalizedRelative(root, directory));
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (++count > limits.maxEntries) {
          fail("SG-STRUCT-003", location);
          limited = true;
          break;
        }
        const absolute = join(directory, entry.name);
        let path: string;
        try {
          path = normalizedRelative(root, absolute);
        } catch {
          fail("SG-STRUCT-006", location);
          continue;
        }
        if (excluded(path, exclusions)) continue;
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) {
          fail("SG-STRUCT-002", path);
          continue;
        }
        if (stat.isDirectory()) await walk(absolute, depth + 1);
        else if (stat.isFile()) {
          if (result.files.length >= limits.maxFiles) {
            fail("SG-STRUCT-003", path);
            limited = true;
            break;
          }
          result.files.push({ path, size: stat.size });
        } else fail("SG-STRUCT-004", path);
      }
    } catch {
      fail("SG-STRUCT-007", location);
    }
  };
  await walk(root, 0);
  result.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!result.files.some((file) => basename(file.path) === "SKILL.md"))
    fail("SG-STRUCT-001", "SKILL.md");
  return result;
}
