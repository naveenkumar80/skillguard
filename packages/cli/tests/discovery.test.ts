import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32, posix } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { check } from "../src/core/check.js";
import { parseConfig } from "../src/config/config.js";
import {
  inventory,
  defaultLimits,
  readText,
  safeRelative,
  isWithin,
  structureRules,
  structureFinding,
} from "../src/discovery/filesystem.js";
import { isFinding } from "../src/engine/protocol.js";

const roots: string[] = [];
async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillguard-test-"));
  roots.push(root);
  return root;
}
async function file(
  root: string,
  path: string,
  content: string | Buffer,
): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  if (parts.length) await mkdir(join(root, ...parts), { recursive: true });
  await writeFile(join(root, path), content);
}
const valid = (name: string) =>
  `---\nname: ${name}\ndescription: A useful skill.\n---\n\nBody.\n`;
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded deterministic discovery", () => {
  it("discovers a monorepo in lexical order and returns relative labels", async () => {
    const root = await temp();
    await file(root, "z/SKILL.md", valid("z"));
    await file(root, "packages/a/SKILL.md", valid("a"));
    const a = await inventory(root);
    const b = await inventory(root);
    expect(a).toEqual(b);
    expect(a.files.map((entry) => entry.path)).toEqual([
      "packages/a/SKILL.md",
      "z/SKILL.md",
    ]);
    const result = await check(root, parseConfig({}));
    expect(result.report.skills.every((skill) => skill.valid)).toBe(true);
    expect(result.report.findings).toEqual([]);
  });
  it("supports scanning a skill directory directly", async () => {
    const parent = await temp();
    await file(parent, "demo/SKILL.md", valid("demo"));
    expect(
      (await check(join(parent, "demo"), parseConfig({}))).report.findings,
    ).toEqual([]);
  });
  it("flags missing definitions and does not return a complete scan", async () => {
    const root = await temp();
    await file(root, "readme.md", "Not a skill");
    const result = await inventory(root);
    expect(result.complete).toBe(false);
    expect(result.findings[0]?.ruleId).toBe("SG-STRUCT-001");
  });
  it("honors default and custom exclusions including hidden directories", async () => {
    const root = await temp();
    await file(root, "yes/SKILL.md", valid("yes"));
    await file(root, "node_modules/no/SKILL.md", "bad");
    await file(root, ".git/no/SKILL.md", "bad");
    await file(root, ".hidden/no/SKILL.md", "bad");
    const result = await inventory(root, ["**/.hidden/**"]);
    expect(result.files.map((entry) => entry.path)).toEqual(["yes/SKILL.md"]);
  });
  it.each(["maxFiles", "maxEntries", "maxDepth"] as const)(
    "fails closed at %s",
    async (key) => {
      const root = await temp();
      await file(root, "a/SKILL.md", valid("a"));
      await file(root, "b/SKILL.md", valid("b"));
      const result = await inventory(root, [], {
        ...defaultLimits,
        [key]: key === "maxDepth" ? 0 : 1,
      });
      expect(result.complete).toBe(false);
      expect(
        result.findings.some((finding) => finding.ruleId === "SG-STRUCT-003"),
      ).toBe(true);
    },
  );
  it("rejects oversized and invalid UTF8/binary definitions", async () => {
    const root = await temp();
    await file(
      root,
      "huge/SKILL.md",
      "x".repeat(defaultLimits.maxFileBytes + 1),
    );
    await file(root, "binary/SKILL.md", Buffer.from([0, 1]));
    await file(root, "encoding/SKILL.md", Buffer.from([0xff]));
    const result = await check(root, parseConfig({}));
    expect(result.report.complete).toBe(false);
    expect(result.report.skills.every((skill) => !skill.valid)).toBe(true);
    expect(result.contents.size).toBe(0);
  });
  it("enforces aggregate size before and during reads", async () => {
    const root = await temp();
    await file(root, "a/SKILL.md", valid("a"));
    await file(root, "b/SKILL.md", valid("b"));
    const result = await check(
      root,
      parseConfig({ limits: { maxTotalBytes: 60 } }),
    );
    expect(result.report.complete).toBe(false);
    expect(
      result.report.findings.some(
        (finding) => finding.ruleId === "SG-STRUCT-003",
      ),
    ).toBe(true);
  });
  it("detects duplicate names independently of directory mismatch", async () => {
    const root = await temp();
    await file(root, "first/SKILL.md", valid("same"));
    await file(root, "second/SKILL.md", valid("same"));
    const result = await check(root, parseConfig({}));
    expect(
      result.report.findings.some(
        (finding) => finding.ruleId === "SG-STRUCT-005",
      ),
    ).toBe(true);
    expect(result.report.skills.every((skill) => !skill.valid)).toBe(true);
  });
  it("does not execute referenced Python or shell files", async () => {
    const root = await temp();
    await file(root, "good/SKILL.md", valid("good"));
    await file(
      root,
      "good/scripts/danger.py",
      'raise RuntimeError("THIS_MUST_NOT_EXECUTE")',
    );
    await file(root, "good/scripts/danger.sh", "exit 99");
    expect((await check(root, parseConfig({}))).report.findings).toEqual([]);
  });
  it("never follows a directory symlink outside the scan root", async () => {
    const root = await temp();
    const outside = await temp();
    await file(outside, "SKILL.md", "PRIVATE_OUTSIDE_CONTENT");
    await symlink(
      outside,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await inventory(root);
    expect(result.files).toEqual([]);
    expect(result.complete).toBe(false);
    expect(
      result.findings.some((finding) => finding.ruleId === "SG-STRUCT-002"),
    ).toBe(true);
    await expect(readText(root, "linked/SKILL.md", 1024)).rejects.toMatchObject(
      { code: "SYMLINK" },
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE_OUTSIDE_CONTENT");
  });
  it("rejects a symlink as selected root", async () => {
    const root = await temp();
    const outside = await temp();
    await symlink(
      outside,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(inventory(join(root, "linked"))).rejects.toMatchObject({
      code: "INVALID_ROOT",
    });
  });
  it.each([
    "../outside",
    "/absolute",
    "C:/Windows/file",
    "C:\\Windows\\file",
    "a/../b",
    "a\0b",
  ])("does not read unsafe path %s", async (path) => {
    const root = await temp();
    await expect(readText(root, path, 1024)).rejects.toMatchObject({
      code: "UNSAFE_PATH",
    });
  });
  it("rejects missing roots and regular-file roots", async () => {
    const root = await temp();
    await file(root, "file", "text");
    await expect(inventory(join(root, "missing"))).rejects.toMatchObject({
      code: "INVALID_ROOT",
    });
    await expect(inventory(join(root, "file"))).rejects.toMatchObject({
      code: "INVALID_ROOT",
    });
  });
  it("all structure findings conform and omit source text", () => {
    for (const rule of structureRules) {
      const finding = structureFinding(rule.id, "sample/SKILL.md");
      expect(isFinding(finding)).toBe(true);
      expect(finding.evidence.redacted).toBe(true);
      expect(finding.remediation.length).toBeGreaterThan(0);
    }
  });
  it("normalizes path boundaries on the host, not string prefix matches", () => {
    expect(isWithin(join(tmpdir(), "a"), join(tmpdir(), "ab"))).toBe(false);
    expect(isWithin(join(tmpdir(), "a"), join(tmpdir(), "a", "b"))).toBe(true);
    expect(
      win32.relative("C:\\root", "C:\\rooted\\file").startsWith(".."),
    ).toBe(true);
    expect(posix.relative("/root", "/rooted/file").startsWith("..")).toBe(true);
  });
  it.each([
    "../a",
    "a/../b",
    "/absolute",
    "C:/a",
    "C:\\a",
    "\\\\server\\a",
    "a//b",
    "a/./b",
    "a\0b",
    "a\nb",
    "",
  ])("rejects unsafe labels %#", (path) => {
    expect(safeRelative(path)).toBe(false);
  });
  it.each([
    "SKILL.md",
    "skills/example/SKILL.md",
    ".hidden/reference.md",
    "café/参考.md",
  ])("allows unambiguous relative labels %s", (path) => {
    expect(safeRelative(path)).toBe(true);
  });
});
