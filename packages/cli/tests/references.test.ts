import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config/config.js";

import type { CheckContext } from "../src/core/check.js";
import * as filesystem from "../src/discovery/filesystem.js";
import { isFinding } from "../src/engine/protocol.js";
import {
  referenceRules,
  validateReferences,
} from "../src/validators/references.js";

const roots: string[] = [];
const fixtures = fileURLToPath(
  new URL("../../../tests/fixtures/", import.meta.url),
);
const config = () => parseConfig({});
const quality = () => parseConfig({ checks: { quality: true } });
const skill = (body: string) =>
  `---\nname: demo\ndescription: A useful skill.\n---\n\n${body}\n`;
async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillguard-references-"));
  roots.push(root);
  return root;
}
async function file(
  root: string,
  path: string,
  content: string | Buffer,
): Promise<void> {
  await mkdir(join(root, posix.dirname(path)), { recursive: true });
  await writeFile(join(root, path), content);
}
// Keep a full inventory snapshot so reference-specific budgets can be tested
// independently of discovery truncation and the parent's integration.
async function context(
  root: string,
  options = config(),
): Promise<CheckContext> {
  const inventory = await filesystem.inventory(root, options.exclude);
  const contents = new Map<string, string>();
  for (const entry of inventory.files)
    if (posix.basename(entry.path) === "SKILL.md")
      contents.set(
        entry.path,
        await filesystem.readText(
          inventory.root,
          entry.path,
          filesystem.defaultLimits.maxFileBytes,
        ),
      );
  return {
    inventory,
    contents,
    report: {
      schemaVersion: "1.0",
      tool: { name: "skillguard", version: "0.1.0" },
      ruleSetVersion: "1.0.0",
      profile: options.profile,
      complete: inventory.complete,
      skills: [...contents.keys()].map((path) => ({
        path,
        name: null,
        valid: true,
      })),
      findings: [...inventory.findings],
      aiEvaluation: "disabled",
    },
  };
}
async function setup(body: string): Promise<CheckContext> {
  const root = await temp();
  await file(root, "SKILL.md", skill(body));
  return context(root);
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("reference fixtures and parser", () => {
  it.each([
    ["broken-references", "SG-REF-001", 3],
    ["traversal", "SG-REF-002", 11],
    ["benign-lookalikes", "", 0],
  ] as const)("validates %s", async (name, id, count) => {
    const input = await context(join(fixtures, name));
    const findings = await validateReferences(input, quality());
    expect(findings).toHaveLength(count);
    expect(findings.every((item) => item.ruleId === id)).toBe(true);
    if (name === "benign-lookalikes") {
      expect(input.contents.has("guide.md")).toBe(true);
      expect(input.contents.has("version..txt")).toBe(false);
    }
  });

  it("parses full, collapsed, shortcut and image reference links", async () => {
    const input = await setup(
      [
        '[Inline](one.md "a title")',
        "",
        "![Image](two.png)",
        "",
        "[Full][destination]",
        "",
        "[Collapsed][]",
        "",
        "[Shortcut]",
        "",
        "![Image ref][picture]",
        "",
        "[destination]: three.md",
        "[Collapsed]: four.md",
        "[Shortcut]: five.md",
        "[picture]: six.png",
      ].join("\n"),
    );
    const findings = await validateReferences(input, config());
    expect(findings.map((item) => item.ruleId)).toEqual(
      Array<string>(6).fill("SG-REF-001"),
    );
    expect(findings.map((item) => item.line)).toEqual([6, 8, 10, 12, 14, 16]);
  });

  it("uses conservative containing-token lines for multiline links, tables and quotes", async () => {
    const input = await setup(
      "Paragraph starts\n[late](missing.md)\n\n> [quoted](other.md)\n\n| Resource |\n| --- |\n| [cell](table.md) |",
    );
    const findings = await validateReferences(input, config());
    expect(findings.map((item) => item.line)).toEqual([6, 9, 13]);
    expect(findings.every((item) => item.column === 1)).toBe(true);
  });

  it("retains BOM/CRLF line coordinates while excluding frontmatter", async () => {
    const input = await setup("");
    input.contents.set(
      "SKILL.md",
      "\uFEFF---\r\nname: demo\r\ndescription: '[secret](metadata.md)'\r\n---\r\n\r\n[body](missing.md)\r\n",
    );
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-001", line: 6, column: 1 },
    ]);
  });

  it("does not mistake links in code, unused definitions or image alt text for resources", async () => {
    const input = await setup(
      "`scripts/missing.py`\n\n`[x](missing.md)`\n\n```md\n[x](missing.md)\n```\n\n[unused]: missing.md\n\n![alt [not a hyperlink](missing.md)](real.png)",
    );
    await file(input.inventory.root, "real.png", Buffer.from([0, 255]));
    input.inventory.files.push({ path: "real.png", size: 2 });
    expect(await validateReferences(input, config())).toEqual([]);
  });

  it("ignores remote and fragment-only references without filesystem or network activity", async () => {
    const input = await setup(
      "[Web](hTtPs://example.invalid/a?secret=x)\n\n<http://example.invalid/>\n\n[Mail](MAILTO:a@example.invalid)\n\n![Remote](https://example.invalid/a.png)\n\n[Anchor](#not-checked)",
    );
    const safe = vi.spyOn(filesystem, "assertSafePath");
    const read = vi.spyOn(filesystem, "readText");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network"));
    expect(await validateReferences(input, config())).toEqual([]);
    expect(safe).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("path and scheme safety", () => {
  it.each([
    "../outside.md",
    "refs/../inside.md",
    "./../outside.md",
    "%2e%2e/outside.md",
    ".%2E/outside.md",
    "%252e%252e/outside.md",
    "%25252e%25252e/outside.md",
    "%252foutside.md",
    "refs%2finside.md",
    "refs%5cinside.md",
    "%5c%5cserver%5cshare.md",
    "/absolute.md",
    "//server/share.md",
    "C:/Windows/private.md",
    "C:relative.md",
    "c%3a/private.md",
    String.raw`C:\Windows\private.md`,
    String.raw`\\server\share\private.md`,
    String.raw`refs\private.md`,
    "file:///private.md",
    "data:text/plain,secret",
    "javascript:alert(1)",
    "vbscript:secret",
    "ftp://example.invalid/private",
    "custom:secret",
    "javascript%3asecret",
    "jav&#x61;script:secret",
    "file&#58;///private.md",
    "&#46;&#46;/outside.md",
    "refs//file.md",
    "bad%00name.md",
    "bad%0aname.md",
    "bad%7fname.md",
    "%ff.md",
    "%E0%A4%A.md",
    "bad%.md",
    "name%23fragment.md",
    "name%3fquery.md",
    "%2520.md",
    "",
    ".",
    "./",
    "?query-only",
  ])(
    "rejects unsafe destination %# before filesystem access",
    async (target) => {
      const input = await setup(`[label](<${target}>)`);
      const safe = vi.spyOn(filesystem, "assertSafePath");
      const read = vi.spyOn(filesystem, "readText");
      const findings = await validateReferences(input, config());
      expect(findings).toMatchObject([
        {
          ruleId: "SG-REF-002",
          category: "structure",
          severity: "high",
          path: "SKILL.md",
        },
      ]);
      expect(findings).toHaveLength(1);
      expect(safe).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("normalizes only harmless dots and safely decodes ordinary filename characters", async () => {
    const root = await temp();
    await file(
      root,
      "demo/SKILL.md",
      skill(
        "[Space](./refs/./a%20b.md?private=x#one)\n\n[Unicode](refs/caf%C3%A9.md)\n\n[Dots](version..txt)\n\n[Plus](a+b.txt)",
      ),
    );
    await file(root, "demo/refs/a b.md", "# Space");
    await file(root, "demo/refs/café.md", "# Café");
    await file(root, "demo/version..txt", "ordinary asset");
    await file(root, "demo/a+b.txt", "ordinary asset");
    const input = await context(root);
    expect(await validateReferences(input, config())).toEqual([]);
    expect([...input.contents.keys()]).toEqual([
      "demo/SKILL.md",
      "demo/refs/a b.md",
      "demo/refs/café.md",
    ]);
  });

  it("rejects entry into a nested skill even when both files are in inventory", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Other skill](nested/guide.md)"));
    await file(root, "nested/SKILL.md", skill("[Own guide](guide.md)"));
    await file(root, "nested/guide.md", "# Guide");
    const input = await context(root);
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-002", path: "SKILL.md" },
    ]);
    expect(input.contents.has("nested/guide.md")).toBe(true);
  });

  it("rejects parent traversal into sibling skills, despite an existing inventory target", async () => {
    const root = await temp();
    await file(root, "first/SKILL.md", skill("[Sibling](../second/guide.md)"));
    await file(root, "second/SKILL.md", skill(""));
    await file(root, "second/guide.md", "PRIVATE_OTHER_SKILL");
    const input = await context(root);
    const read = vi.spyOn(filesystem, "readText");
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-002", path: "first/SKILL.md" },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(input.contents.has("second/guide.md")).toBe(false);
  });
});

describe("inventory, assets and symlinks", () => {
  it("checks binary assets and scripts for existence without reading or executing them", async () => {
    const root = await temp();
    await file(
      root,
      "SKILL.md",
      skill(
        "![Image](image.png)\n\n[Script](scripts/run.py)\n\n[Archive](archive.zip)",
      ),
    );
    await file(root, "image.png", Buffer.from([0, 255, 128]));
    await file(root, "archive.zip", Buffer.from([0, 255]));
    await file(
      root,
      "scripts/run.py",
      "raise RuntimeError('MUST_NOT_EXECUTE')",
    );
    const input = await context(root);
    const read = vi.spyOn(filesystem, "readText");
    expect(await validateReferences(input, config())).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect([...input.contents.keys()]).toEqual(["SKILL.md"]);
  });

  it("explicitly reports excluded targets without probing or reading them", async () => {
    const root = await temp();
    await file(
      root,
      "SKILL.md",
      skill(
        "[Custom](private/secret.md)\n\n[Default](node_modules/secret.md)\n\n[Missing excluded](private/missing.md)",
      ),
    );
    await file(root, "private/secret.md", "PRIVATE_EXCLUDED");
    await file(root, "node_modules/secret.md", "PRIVATE_DEFAULT");
    const options = parseConfig({ exclude: ["**/private/**"] });
    const input = await context(root, options);
    const safe = vi.spyOn(filesystem, "assertSafePath");
    const read = vi.spyOn(filesystem, "readText");
    const findings = await validateReferences(input, options);
    expect(findings.map((item) => item.ruleId)).toEqual(
      Array<string>(3).fill("SG-REF-005"),
    );
    expect(findings.every((item) => item.message.includes("omitted"))).toBe(
      true,
    );
    expect(safe).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(input.contents.size).toBe(1);
  });

  it("rechecks exclusions even if a caller supplied an inventory containing the target", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Secret](secret.md)"));
    await file(root, "secret.md", "PRIVATE_EXCLUDED");
    const input = await context(root);
    const read = vi.spyOn(filesystem, "readText");
    expect(
      await validateReferences(input, parseConfig({ exclude: ["secret.md"] })),
    ).toMatchObject([{ ruleId: "SG-REF-005" }]);
    expect(read).not.toHaveBeenCalled();
  });

  it("honors exclusions on ancestor directories even with a stale inclusive inventory", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Secret](private/secret.md)"));
    await file(root, "private/secret.md", "PRIVATE_EXCLUDED");
    const input = await context(root);
    const safe = vi.spyOn(filesystem, "assertSafePath");
    const read = vi.spyOn(filesystem, "readText");
    expect(
      await validateReferences(input, parseConfig({ exclude: ["private"] })),
    ).toMatchObject([{ ruleId: "SG-REF-005" }]);
    expect(safe).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read existing targets absent from an incomplete inventory", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Omitted](omitted.md)"));
    await file(root, "omitted.md", "PRIVATE_UNINDEXED");
    const input = await context(root);
    input.inventory.files = input.inventory.files.filter(
      (entry) => entry.path !== "omitted.md",
    );
    input.inventory.complete = false;
    const read = vi.spyOn(filesystem, "readText");
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-005" },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(input.contents.has("omitted.md")).toBe(false);
  });

  it("does not accept an unindexed ordinary directory as a valid asset", async () => {
    const input = await setup("[Directory](folder)");
    await mkdir(join(input.inventory.root, "folder"));
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-005" },
    ]);
  });

  it("detects inventoried files removed before reference validation", async () => {
    const root = await temp();
    await file(
      root,
      "SKILL.md",
      skill("![Asset](asset.png)\n\n[Text](guide.md)"),
    );
    await file(root, "asset.png", Buffer.from([0]));
    await file(root, "guide.md", "# Guide");
    const input = await context(root);
    await rm(join(root, "asset.png"));
    await rm(join(root, "guide.md"));
    expect(
      (await validateReferences(input, config())).map((item) => item.ruleId),
    ).toEqual(["SG-REF-001", "SG-REF-001"]);
  });

  it.each([false, true])(
    "rejects intermediate symlinks (stale inventory: %s)",
    async (stale) => {
      const root = await temp();
      const outside = await temp();
      await file(
        root,
        "SKILL.md",
        skill(
          "[Private](linked/private.md)\n\n![Private asset](linked/private.png)",
        ),
      );
      await file(outside, "private.md", "PRIVATE_OUTSIDE");
      await file(outside, "private.png", Buffer.from([0, 255]));
      if (stale) {
        await file(root, "linked/private.md", "# Safe before replacement");
        await file(root, "linked/private.png", Buffer.from([0]));
      }
      const before = stale ? await context(root) : undefined;
      if (stale) await rm(join(root, "linked"), { recursive: true });
      await symlink(
        outside,
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const input = before ?? (await context(root));
      const read = vi.spyOn(filesystem, "readText");
      const findings = await validateReferences(input, config());
      expect(findings.map((item) => item.ruleId)).toEqual([
        "SG-REF-003",
        "SG-REF-003",
      ]);
      expect(read).not.toHaveBeenCalled();
      expect(input.contents.size).toBe(1);
      expect(JSON.stringify(findings)).not.toContain("PRIVATE_OUTSIDE");
    },
  );

  it("rejects in-root directory symlinks as well as outside links", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Alias](alias/guide.md)"));
    await file(root, "real/guide.md", "# Guide");
    await symlink(
      join(root, "real"),
      join(root, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      await validateReferences(await context(root), config()),
    ).toMatchObject([{ ruleId: "SG-REF-003" }]);
  });

  it("rejects a final file symlink without following it", async (test) => {
    const root = await temp();
    const outside = await temp();
    await file(root, "SKILL.md", skill("[Alias](alias.md)"));
    await file(outside, "private.md", "PRIVATE_OUTSIDE");
    try {
      await symlink(
        join(outside, "private.md"),
        join(root, "alias.md"),
        "file",
      );
    } catch (error) {
      if (
        process.platform === "win32" &&
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        test.skip();
        return;
      }
      throw error;
    }
    const input = await context(root);
    const read = vi.spyOn(filesystem, "readText");
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-003" },
    ]);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("recursive Markdown and resource budgets", () => {
  it("resolves nested resources relative to their containing Markdown file and ignores loops", async () => {
    const root = await temp();
    await file(
      root,
      "SKILL.md",
      skill(
        "[Guide](refs/a.md)\n\n[Again](./refs/a.md#other)\n\n[Self](SKILL.md#top)",
      ),
    );
    await file(root, "refs/a.md", "# A\n\n[Next](b.MD)\n\n[Self](a.md)");
    await file(
      root,
      "refs/b.MD",
      "# B\n\n[Cycle](a.md)\n\n![Image](plot.png)\n\n[Missing](missing.md)",
    );
    await file(root, "refs/plot.png", Buffer.from([0, 255]));
    const input = await context(root);
    const read = vi.spyOn(filesystem, "readText");
    expect(await validateReferences(input, config())).toMatchObject([
      { ruleId: "SG-REF-001", path: "refs/b.MD", line: 7 },
    ]);
    expect(read.mock.calls.map((call) => call[1])).toEqual([
      "refs/a.md",
      "refs/b.MD",
    ]);
    expect([...input.contents.keys()]).toEqual([
      "SKILL.md",
      "refs/a.md",
      "refs/b.MD",
    ]);
  });

  it.each([
    ["oversize", { maxFileBytes: 100 }, "x".repeat(101)],
    ["aggregate", { maxTotalBytes: 100 }, "x".repeat(60)],
    ["count", { maxFiles: 1 }, "# Guide"],
    ["depth", { maxDepth: 0 }, "# Guide"],
  ] as const)(
    "reports %s limits without reading or adding the target",
    async (_name, limits, text) => {
      const root = await temp();
      await file(root, "SKILL.md", skill("[Guide](guide.md)"));
      await file(root, "guide.md", text);
      const input = await context(root);
      const read = vi.spyOn(filesystem, "readText");
      expect(
        await validateReferences(input, parseConfig({ limits })),
      ).toMatchObject([
        { ruleId: "SG-REF-004", severity: "high", path: "SKILL.md" },
      ]);
      expect(read).not.toHaveBeenCalled();
      expect(input.contents.size).toBe(1);
    },
  );

  it("counts existing skill text toward the total budget and bounds actual grown-file reads", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Guide](guide.md)"));
    await file(root, "guide.md", "a");
    const input = await context(root);
    const initial = Buffer.byteLength(input.contents.get("SKILL.md") ?? "");
    await file(root, "guide.md", "é".repeat(20));
    const read = vi.spyOn(filesystem, "readText");
    expect(
      await validateReferences(
        input,
        parseConfig({ limits: { maxTotalBytes: initial + 10 } }),
      ),
    ).toMatchObject([{ ruleId: "SG-REF-004" }]);
    expect(read).toHaveBeenCalledWith(input.inventory.root, "guide.md", 10);
    expect(input.contents.has("guide.md")).toBe(false);
  });

  it("enforces the per-file cap when Markdown grows after inventory", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Guide](guide.md)"));
    await file(root, "guide.md", "small");
    const input = await context(root);
    await file(root, "guide.md", "x".repeat(101));
    expect(
      await validateReferences(
        input,
        parseConfig({ limits: { maxFileBytes: 100 } }),
      ),
    ).toMatchObject([{ ruleId: "SG-REF-004" }]);
    expect(input.contents.has("guide.md")).toBe(false);
  });

  it.each([Buffer.from([0, 1]), Buffer.from([255])])(
    "does not cache binary or invalid UTF-8 Markdown %#",
    async (bytes) => {
      const root = await temp();
      await file(
        root,
        "SKILL.md",
        skill("[Binary](guide.md)\n\n[Retry](guide.md#different)"),
      );
      await file(root, "guide.md", bytes);
      const input = await context(root);
      const read = vi.spyOn(filesystem, "readText");
      expect(
        (await validateReferences(input, config())).map((item) => item.ruleId),
      ).toEqual(["SG-REF-004", "SG-REF-004"]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(input.contents.size).toBe(1);
    },
  );

  it.each(["bytes", "count"] as const)(
    "charges failed reads to the aggregate %s budget",
    async (limit) => {
      const root = await temp();
      await file(root, "SKILL.md", skill("[Bad](bad.md)\n\n[Good](good.md)"));
      await file(root, "bad.md", Buffer.from([0, 1]));
      await file(root, "good.md", "# Good");
      const input = await context(root);
      const initial = Buffer.byteLength(input.contents.get("SKILL.md") ?? "");
      const options = parseConfig({
        limits:
          limit === "bytes" ? { maxTotalBytes: initial + 10 } : { maxFiles: 2 },
      });
      const read = vi.spyOn(filesystem, "readText");
      expect(
        (await validateReferences(input, options)).map((item) => item.ruleId),
      ).toEqual(["SG-REF-004", "SG-REF-004"]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(input.contents.has("good.md")).toBe(false);
    },
  );

  it("uses byte counts, not JavaScript string length, at the exact total limit", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[Guide](guide.md)"));
    await file(root, "guide.md", "é");
    const input = await context(root);
    const initial = Buffer.byteLength(input.contents.get("SKILL.md") ?? "");
    expect(
      await validateReferences(
        input,
        parseConfig({ limits: { maxTotalBytes: initial + 2 } }),
      ),
    ).toEqual([]);
    expect(input.contents.get("guide.md")).toBe("é");
  });

  it("stops at recursive depth and attributes incomplete validation to the referring resource", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[A](a.md)"));
    await file(root, "a.md", "[B](b.md)");
    await file(root, "b.md", "# B");
    const input = await context(root);
    expect(
      await validateReferences(input, parseConfig({ limits: { maxDepth: 1 } })),
    ).toMatchObject([{ ruleId: "SG-REF-004", path: "a.md" }]);
    expect(input.contents.has("a.md")).toBe(true);
    expect(input.contents.has("b.md")).toBe(false);
  });

  it("allocates bounded reads deterministically and visits the shortest path before deep paths", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[A](a.md)\n\n[B](b.md)"));
    await file(root, "a.md", "[B](b.md)");
    await file(root, "b.md", "[A](a.md)");
    const first = await context(root);
    const second = await context(root);
    second.inventory.files.reverse();
    const options = parseConfig({ limits: { maxDepth: 1, maxFiles: 3 } });
    expect(await validateReferences(first, options)).toEqual([]);
    expect(await validateReferences(second, options)).toEqual([]);
    expect([...second.contents]).toEqual([...first.contents]);
  });

  it("reports already-exhausted supplied content budgets without parsing more resources", async () => {
    const input = await setup("[Missing](missing.md)");
    expect(
      await validateReferences(
        input,
        parseConfig({ limits: { maxTotalBytes: 1 } }),
      ),
    ).toMatchObject([{ ruleId: "SG-REF-004", line: 1 }]);
  });
});

describe("advice, privacy and contract", () => {
  it("emits only opt-in quality advice for duplicate normalized local references", async () => {
    const root = await temp();
    await file(
      root,
      "SKILL.md",
      skill(
        "[A](./guide.md)\n\n[B](guide.md)\n\n[C](guide.md#one)\n\n[D](./guide.md#two)\n\n[E](guide.md#one)\n\n[F](guide.md?x=1)\n\n[G](guide.md?x=2)",
      ),
    );
    await file(root, "guide.md", "# Guide");
    const input = await context(root);
    expect(await validateReferences(input, config())).toEqual([]);
    const findings = await validateReferences(input, quality());
    expect(findings).toMatchObject([
      { ruleId: "SG-REF-006", severity: "info", category: "quality", line: 8 },
      { ruleId: "SG-REF-006", severity: "info", category: "quality", line: 14 },
    ]);
    expect(findings).toHaveLength(2);
  });

  it("detects duplicates within each source, not across separate Markdown documents", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[A](a.md)\n\n[Guide](guide.md#one)"));
    await file(root, "a.md", "[Guide](guide.md#one)");
    await file(root, "guide.md", "# Guide");
    expect(await validateReferences(await context(root), quality())).toEqual(
      [],
    );
  });

  it("returns findings without mutating the report, skill results or inventory", async () => {
    const root = await temp();
    await file(root, "SKILL.md", skill("[A](a.md)\n\n[Missing](missing.md)"));
    await file(root, "a.md", "# A");
    const input = await context(root);
    const before = JSON.stringify({
      report: input.report,
      inventory: input.inventory,
    });
    Object.freeze(input.report.skills);
    Object.freeze(input.report.findings);
    Object.freeze(input.report);
    Object.freeze(input.inventory.files);
    Object.freeze(input.inventory);
    const findings = await validateReferences(input, config());
    expect(findings).toHaveLength(1);
    expect(input.contents.has("a.md")).toBe(true);
    expect(
      JSON.stringify({ report: input.report, inventory: input.inventory }),
    ).toBe(before);
  });

  it("never emits labels, destinations, titles, credentials, absolute roots or raw filesystem errors", async () => {
    const secret = "PRIVATE_LINK_TOKEN_91";
    const input = await setup(
      `[${secret}](missing-${secret}.md?token=${secret}#${secret} "${secret}")\n\n[${secret}](data:text/plain,${secret})`,
    );
    const findings = await validateReferences(input, config());
    expect(findings).toHaveLength(2);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(input.inventory.root);
    expect(findings.every((item) => isFinding(item))).toBe(true);
    expect(findings.every((item) => item.path === "SKILL.md")).toBe(true);
    expect(
      findings.every(
        (item) =>
          item.evidence.redacted && item.evidence.excerpt === "[REDACTED]",
      ),
    ).toBe(true);
    vi.spyOn(filesystem, "assertSafePath").mockRejectedValue(new Error(secret));
    const failed = await validateReferences(input, config());
    expect(failed[0]?.ruleId).toBe("SG-REF-004");
    expect(JSON.stringify(failed)).not.toContain(secret);
  });

  it("keeps safety findings independent of quality and spec flags", async () => {
    const input = await setup("[Unsafe](../outside.md)");
    const options = parseConfig({ checks: { spec: false, quality: false } });
    expect(await validateReferences(input, options)).toMatchObject([
      { category: "structure", severity: "high" },
    ]);
  });

  it("exports unique stable reference rule metadata, never specification rules", () => {
    expect(referenceRules.map((item) => item.id)).toEqual([
      "SG-REF-001",
      "SG-REF-002",
      "SG-REF-003",
      "SG-REF-004",
      "SG-REF-005",
      "SG-REF-006",
    ]);
    for (const rule of referenceRules) {
      expect(rule.version).toBe("1.0.0");
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
      expect(rule.remediation.length).toBeGreaterThan(0);
      expect(rule.confidence).toBe("high");
      expect(rule.category).toBe(
        rule.id === "SG-REF-006" ? "quality" : "structure",
      );
      expect(rule.defaultSeverity).toBe(
        rule.id === "SG-REF-006" ? "info" : "high",
      );
      expect(rule.references).toEqual([]);
    }
  });
});
