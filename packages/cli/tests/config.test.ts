import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../src/config/config.js";

describe("strict runtime configuration", () => {
  it("provides offline defaults with AI disabled", () => {
    const config = parseConfig({});
    expect(config.profile).toBe("agent-skills-current");
    expect(config.aiEvaluation).toEqual({
      enabled: false,
      provider: null,
      model: null,
      maxCostUsd: 0,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      maxOutputTokens: 512,
      maxInputBytes: 32768,
      timeoutMs: 15000,
      maxRetries: 0,
    });
    expect(config.engine.timeoutMs).toBe(15000);
    expect(config.checks.quality).toBe(false);
  });
  it.each([
    null,
    [],
    "config",
    { unknown: true },
    { profile: "floating-upstream" },
    { strict: "true" },
    { paths: [] },
    { paths: [4] },
    { exclude: ["x".repeat(257)] },
    { checks: { unknown: true } },
    { engine: { timeoutMs: 0 } },
    { engine: { timeoutMs: 120001 } },
    { engine: { enabled: "yes" } },
    { severityThreshold: "warning" },
    { aiEvaluation: { enabled: true } },
    { aiEvaluation: { provider: "live" } },
    { limits: { maxFileBytes: 262145 } },
    { limits: { maxDepth: -1 } },
    { limits: { maxFiles: 1.1 } },
    { limits: { maxEntries: 100001 } },
  ])("rejects invalid config %#", (value) => {
    expect(() => parseConfig(value)).toThrow("Invalid configuration");
  });
  it("uses the explicit configuration directory as path base", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillguard-config-"));
    try {
      const path = join(root, "config.json");
      await writeFile(path, '{"strict":true}');
      const result = await loadConfig(path);
      expect(result.base).toBe(root);
      expect(result.config.strict).toBe(true);
      await writeFile(path, '{"unknown":"PRIVATE_KEY_NOT_FOR_DIAGNOSTICS"}');
      await expect(loadConfig(path)).rejects.not.toThrow(
        "PRIVATE_KEY_NOT_FOR_DIAGNOSTICS",
      );
      await writeFile(path, "x".repeat(65537));
      await expect(loadConfig(path)).rejects.toMatchObject({
        code: "INVALID_CONFIG",
      });
      await writeFile(path, "{bad");
      await expect(loadConfig(path)).rejects.toMatchObject({
        code: "INVALID_CONFIG",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
