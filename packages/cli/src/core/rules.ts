import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { RuleMetadata } from "./models.js";
import { formatRules } from "../validators/format.js";
import { structureRules } from "../discovery/filesystem.js";
import { referenceRules } from "../validators/references.js";

const require = createRequire(import.meta.url);
const metadata = z
  .object({
    id: z.string().regex(/^SG-SEC-\d{3}$/),
    version: z.string(),
    title: z.string(),
    category: z.literal("security"),
    defaultSeverity: z.enum(["info", "low", "medium", "high", "critical"]),
    confidence: z.enum(["low", "medium", "high"]),
    description: z.string(),
    remediation: z.string(),
    references: z.array(z.string()),
  })
  .strict();
export async function allRules(): Promise<RuleMetadata[]> {
  const data: unknown = JSON.parse(
    await readFile(
      require.resolve("@skillguard/protocol/rules/security-v1.json"),
      "utf8",
    ),
  );
  const catalog = z
    .object({ version: z.literal("1.0.0"), rules: z.array(metadata).min(10) })
    .strict()
    .parse(data);
  const rules: RuleMetadata[] = [
    ...formatRules,
    ...structureRules,
    ...referenceRules,
    ...catalog.rules,
  ];
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
    throw new Error("Rule identifiers must be unique");
  return rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
