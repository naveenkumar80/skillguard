import { lstat, open } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import {
  defaultLimits,
  safeRelative,
  ScanError,
} from "../discovery/filesystem.js";

const configuration = z
  .object({
    profile: z.literal("agent-skills-current").default("agent-skills-current"),
    paths: z
      .array(z.string().min(1).max(512))
      .min(1)
      .max(100)
      .default(["./skills"]),
    exclude: z.array(z.string().min(1).max(256)).max(100).default([]),
    checks: z
      .object({
        spec: z.boolean().default(true),
        structure: z.boolean().default(true),
        quality: z.boolean().default(false),
        security: z.boolean().default(true),
      })
      .strict()
      .default({}),
    severityThreshold: z
      .enum(["info", "low", "medium", "high", "critical"])
      .default("high"),
    strict: z.boolean().default(false),
    rules: z
      .record(
        z.string().regex(/^SG-SEC-\d{3}$/),
        z.enum(["info", "low", "medium", "high", "critical"]),
      )
      .default({}),
    suppressions: z
      .array(
        z
          .object({
            ruleId: z.string().regex(/^SG-SEC-\d{3}$/),
            path: z.string().refine(safeRelative),
            reason: z.string().trim().min(12).max(512),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    engine: z
      .object({
        enabled: z.boolean().default(true),
        timeoutMs: z.number().int().min(1).max(120000).default(15000),
      })
      .strict()
      .default({}),
    aiEvaluation: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.literal("openai").nullable().default(null),
        model: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
          .nullable()
          .default(null),
        maxCostUsd: z.number().finite().min(0).max(5).default(0),
        inputPricePerMillion: z.number().finite().min(0).max(1000).default(0),
        outputPricePerMillion: z.number().finite().min(0).max(1000).default(0),
        maxOutputTokens: z.number().int().min(1).max(4096).default(512),
        maxInputBytes: z.number().int().min(1).max(32768).default(32768),
        timeoutMs: z.number().int().min(1).max(30000).default(15000),
        maxRetries: z.number().int().min(0).max(2).default(0),
      })
      .strict()
      .refine(
        (ai) =>
          !ai.enabled ||
          (ai.provider === "openai" &&
            ai.model !== null &&
            ai.maxCostUsd > 0 &&
            ai.inputPricePerMillion > 0 &&
            ai.outputPricePerMillion > 0),
      )
      .default({}),
    limits: z
      .object({
        maxEntries: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .default(defaultLimits.maxEntries),
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .default(defaultLimits.maxFiles),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .max(64)
          .default(defaultLimits.maxDepth),
        maxFileBytes: z
          .number()
          .int()
          .min(1)
          .max(262144)
          .default(defaultLimits.maxFileBytes),
        maxTotalBytes: z
          .number()
          .int()
          .min(1)
          .max(4 * 1024 * 1024)
          .default(defaultLimits.maxTotalBytes),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Config = z.infer<typeof configuration>;
export function parseConfig(value: unknown): Config {
  const result = configuration.safeParse(value);
  if (!result.success)
    throw new ScanError(
      "INVALID_CONFIG",
      "Invalid configuration: check supported keys, types, ranges and disabled AI settings in docs/CONFIGURATION.md",
    );
  return result.data;
}
export async function loadConfig(
  path?: string,
): Promise<{ config: Config; base: string }> {
  if (!path) return { config: parseConfig({}), base: process.cwd() };
  const absolute = resolve(path);
  try {
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
      throw new Error("Config must be a small ordinary file");
    const handle = await open(absolute, "r");
    let content: string;
    try {
      const bytes = Buffer.alloc(65537);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 65536) throw new Error("Oversized config");
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytesRead),
      );
    } finally {
      await handle.close();
    }
    return {
      config: parseConfig(JSON.parse(content) as unknown),
      base: dirname(absolute),
    };
  } catch (error) {
    if (error instanceof ScanError) throw error;
    throw new ScanError(
      "INVALID_CONFIG",
      "Cannot read configuration: select a valid UTF-8 JSON file no larger than 64 KiB",
    );
  }
}
