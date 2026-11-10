import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { inspectFile, scanRepository } from "../scripts/check-hygiene.mjs";

const script = fileURLToPath(
  new URL("../scripts/check-hygiene.mjs", import.meta.url),
);
const syntheticFixture = "tests/fixtures/hygiene/synthetic-secrets.txt";
const syntheticToken = "ghp_" + "A".repeat(36);
const syntheticKey = [
  "-----BEGIN PRIVATE KEY-----",
  "A".repeat(128),
  "-----END PRIVATE KEY-----",
].join("\n");
const privateKey = generateKeyPairSync("ed25519").privateKey.export({
  type: "pkcs8",
  format: "pem",
});
const temporaryRoots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "skillguard-hygiene-"));
  temporaryRoots.push(root);
  return root;
}

async function put(root: string, path: string, content = "") {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("hygiene content checks", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.example.local",
    ".env.egg-info",
    "packages/cli/.env.production",
    "nested\\.env.test",
    ".ENV",
  ])("rejects the environment file %s", (path) => {
    expect(inspectFile(path, "")).toEqual([
      { path: path.replaceAll("\\", "/"), rule: "environment-file" },
    ]);
  });

  it.each([
    ".env.example",
    "nested/.env.example",
    "environment.ts",
    ".environment",
  ])("allows the non-secret path %s", (path) => {
    expect(inspectFile(path, "API_KEY=replace-me")).toEqual([]);
  });

  it("still scans the allowed environment example for credentials", () => {
    expect(inspectFile(".env.example", privateKey)).toEqual([
      { path: ".env.example", rule: "private-key" },
    ]);
  });

  it("detects an actual generated private key with LF or CRLF line endings", () => {
    for (const content of [privateKey, privateKey.replaceAll("\n", "\r\n")]) {
      expect(inspectFile("source.txt", content)).toEqual([
        { path: "source.txt", rule: "private-key" },
      ]);
    }
  });

  it("detects an actual traditional encrypted RSA key with PEM metadata", () => {
    const key = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({
      type: "pkcs1",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: "synthetic-test-only",
    });
    expect(inspectFile("key.pem", key)).toEqual([
      { path: "key.pem", rule: "private-key" },
    ]);
  });

  it("ignores PEM documentation placeholders and public keys", () => {
    expect(
      inspectFile(
        "docs/keys.md",
        [
          "-----BEGIN PRIVATE KEY-----\n<your private key>\n-----END PRIVATE KEY-----",
          "-----BEGIN PRIVATE KEY-----\nshort\n-----END PRIVATE KEY-----",
          "-----BEGIN PUBLIC KEY-----\n" +
            "A".repeat(128) +
            "\n-----END PUBLIC KEY-----",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it.each([
    ["github-token", "ghp_" + "b".repeat(36)],
    ["github-token", "gho_" + "b".repeat(36)],
    ["github-token", "github_pat_" + "b".repeat(82)],
    ["npm-token", "npm_" + "b".repeat(36)],
    ["pypi-token", "pypi-" + "b".repeat(64)],
    ["slack-token", "xoxb-" + "1".repeat(24)],
  ])("detects %s without returning the credential", (rule, token) => {
    const issues = inspectFile("source.txt", `credential = "${token}"`);
    expect(issues).toEqual([{ path: "source.txt", rule }]);
    expect(JSON.stringify(issues)).not.toContain(token);
  });

  it("does not flag token prefixes, placeholders, or embedded identifiers", () => {
    expect(
      inspectFile(
        "docs/tokens.md",
        "ghp_REPLACE_ME npm_example pypi-placeholder xoxb-demo",
      ),
    ).toEqual([]);
    expect(
      inspectFile("source.txt", "prefix_" + syntheticToken + "_suffix"),
    ).toEqual([]);
  });

  it("deduplicates repeated matches and remains deterministic across calls", () => {
    for (let count = 0; count < 2; count += 1) {
      expect(
        inspectFile("source.txt", `${syntheticToken}\n${syntheticToken}`),
      ).toEqual([{ path: "source.txt", rule: "github-token" }]);
    }
  });

  it("exempts only exact synthetic values at the exact fixture path", () => {
    expect(
      inspectFile(syntheticFixture, `${syntheticKey}\n${syntheticToken}`),
    ).toEqual([]);
    expect(
      inspectFile(syntheticFixture.replaceAll("/", "\\"), syntheticKey),
    ).toEqual([]);
    expect(inspectFile("tests/fixtures/other.txt", syntheticKey)).toEqual([
      { path: "tests/fixtures/other.txt", rule: "private-key" },
    ]);
    expect(inspectFile("source.txt", syntheticToken)).toEqual([
      { path: "source.txt", rule: "github-token" },
    ]);
    expect(inspectFile(syntheticFixture, privateKey)).toEqual([
      { path: syntheticFixture, rule: "private-key" },
    ]);
    expect(
      inspectFile(
        syntheticFixture,
        syntheticKey.replaceAll("PRIVATE KEY", "RSA PRIVATE KEY"),
      ),
    ).toEqual([{ path: syntheticFixture, rule: "private-key" }]);
    expect(inspectFile(syntheticFixture, "ghp_" + "b".repeat(36))).toEqual([
      { path: syntheticFixture, rule: "github-token" },
    ]);
    expect(
      inspectFile("tests/fixtures/hygiene/.env", syntheticToken),
    ).toContainEqual({
      path: "tests/fixtures/hygiene/.env",
      rule: "environment-file",
    });
  });
});

describe("hygiene filesystem and CLI checks", () => {
  it("scans nested source but excludes dependencies, build output, Git, and caches", async () => {
    const root = await temporaryRoot();
    for (const directory of [
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
      "package.egg-info",
    ]) {
      await put(root, `nested/${directory}/.env`, syntheticToken);
      await put(root, `nested/${directory}/key.txt`, privateKey);
    }
    await put(root, "nested/source.txt", privateKey);
    await put(root, "nested/.env.local", "SECRET=hidden-value");
    await put(root, ".env.example", "API_KEY=replace-me");
    await put(root, "asset.bin", "\0" + syntheticToken);
    expect(await scanRepository(root)).toEqual([
      { path: "nested/.env.local", rule: "environment-file" },
      { path: "nested/source.txt", rule: "private-key" },
    ]);
  });

  it("does not let metadata exclusions bypass forbidden environment paths", async () => {
    const root = await temporaryRoot();
    await put(root, ".env.egg-info");
    await put(root, ".env.example.local");
    expect(await scanRepository(root)).toEqual([
      { path: ".env.egg-info", rule: "environment-file" },
      { path: ".env.example.local", rule: "environment-file" },
    ]);
  });

  it("does not follow directory symlinks, but rejects a symlink named .env", async () => {
    const root = await temporaryRoot();
    const external = await temporaryRoot();
    await put(external, "key.txt", privateKey);
    await symlink(
      external,
      join(root, "linked-source"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      external,
      join(root, ".env"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await scanRepository(root)).toEqual([
      { path: ".env", rule: "environment-file" },
    ]);
  });

  it("exits successfully for clean source from an unrelated working directory", async () => {
    const root = await temporaryRoot();
    await put(root, "source.txt", "Nothing sensitive here.");
    const output = execFileSync(process.execPath, [script, root], {
      cwd: tmpdir(),
      encoding: "utf8",
    });
    expect(output).toContain("Repository hygiene check passed.");
  });

  it("fails for forbidden files and secrets without exposing file contents", async () => {
    const root = await temporaryRoot();
    await put(root, ".env", "SECRET=do-not-print-this");
    await put(root, "key.txt", privateKey);
    await put(root, "token.txt", syntheticToken);
    const result = spawnSync(process.execPath, [script, root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("environment-file");
    expect(result.stderr).toContain("private-key");
    expect(result.stderr).toContain("github-token");
    expect(result.stderr).not.toContain("do-not-print-this");
    expect(result.stderr).not.toContain(privateKey);
    expect(result.stderr).not.toContain(syntheticToken);
    expect(result.stdout).toBe("");
  });

  it("fails closed when the root cannot be read", async () => {
    const root = await temporaryRoot();
    const result = spawnSync(
      process.execPath,
      [script, join(root, "missing")],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not complete");
    expect(result.stdout).toBe("");
  });
});
