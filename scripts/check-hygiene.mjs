import console from "node:console";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  ".venv",
  "dist",
  "coverage",
  "__pycache__",
  ".cache",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".pnpm-store",
  ".turbo",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".tox",
  ".nox",
]);

const syntheticFixture = "tests/fixtures/hygiene/synthetic-secrets.txt";
const syntheticToken = "ghp_" + "A".repeat(36);
const syntheticKeyBody = "A".repeat(128);

const tokenRules = [
  [
    "github-token",
    /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g,
  ],
  [
    "github-token",
    /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{82}(?![A-Za-z0-9_])/g,
  ],
  ["npm-token", /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g],
  ["pypi-token", /(?<![A-Za-z0-9_])pypi-[A-Za-z0-9_-]{50,}(?![A-Za-z0-9_-])/g],
  [
    "slack-token",
    /(?<![A-Za-z0-9_])xox[baprs]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9_-])/g,
  ],
];

// Only these two exact synthetic values, at this one path, are exempt. A fixture
// directory or comment must never become a blanket exception for real secrets.
export function inspectFile(relativePath, content) {
  const path = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const rules = new Set();
  if (
    (name === ".env" || name.startsWith(".env.")) &&
    name !== ".env.example"
  ) {
    rules.add("environment-file");
  }

  const keyBlocks =
    /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----[ \t]*\r?\n([\s\S]*?)\r?\n-----END \1-----/g;
  for (const match of content.matchAll(keyBlocks)) {
    const body = match[2]
      .replace(/^(?:Proc-Type|DEK-Info):[^\r\n]*\r?\n/gm, "")
      .replace(/\s/g, "");
    if (
      body.length < 64 ||
      body.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body)
    ) {
      continue;
    }
    if (
      path === syntheticFixture &&
      match[1] === "PRIVATE KEY" &&
      body === syntheticKeyBody
    ) {
      continue;
    }
    rules.add("private-key");
  }

  for (const [rule, pattern] of tokenRules) {
    for (const match of content.matchAll(pattern)) {
      if (path !== syntheticFixture || match[0] !== syntheticToken) {
        rules.add(rule);
      }
    }
  }

  return [...rules].map((rule) => ({ path, rule }));
}

// Scan source on disk, including ignored/untracked .env files, without requiring
// Git. Never follow symlinks into dependencies or outside the requested root.
export async function scanRepository(root) {
  const issues = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (excludedDirectories.has(entry.name)) {
        continue;
      }
      const relativePath = prefix + entry.name;
      const path = resolve(directory, entry.name);
      const pathIssues = inspectFile(relativePath, "");
      if (pathIssues.length > 0) {
        issues.push(...pathIssues);
      } else if (entry.isDirectory()) {
        if (!entry.name.endsWith(".egg-info")) {
          await visit(path, relativePath + "/");
        }
      } else if (entry.isFile()) {
        const content = await readFile(path);
        if (!content.includes(0)) {
          issues.push(...inspectFile(relativePath, content.toString("utf8")));
        }
      }
    }
  }
  await visit(resolve(root));
  return issues;
}

async function main() {
  if (process.argv.length > 3) {
    console.error("Usage: node scripts/check-hygiene.mjs [root]");
    process.exitCode = 1;
    return;
  }
  const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
  try {
    const issues = await scanRepository(root);
    for (const issue of issues) {
      console.error(`${JSON.stringify(issue.path)}: ${issue.rule}`);
    }
    if (issues.length > 0) {
      console.error(
        "Repository hygiene check failed. Remove forbidden files or credentials.",
      );
      process.exitCode = 1;
    } else {
      console.log("Repository hygiene check passed.");
    }
  } catch {
    console.error(
      "Repository hygiene check could not complete. Check file access and retry.",
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
