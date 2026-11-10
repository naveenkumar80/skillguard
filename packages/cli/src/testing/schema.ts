import { z } from "zod";
import { safeRelative } from "../discovery/filesystem.js";
import { isJsonValue, pathSegments } from "./json-path.js";
import type { JsonValue } from "./json-path.js";

export const MAX_OUTPUT_BYTES = 262_144;
export const labelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
const text = z.string().min(1).max(MAX_OUTPUT_BYTES);
const json = z.custom<JsonValue>(isJsonValue);

export function skillPath(value: string): string {
  return value.startsWith("./") ? value.slice(2) : value;
}

export const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contains"), value: text }).strict(),
  z
    .object({
      type: z.literal("contains_any"),
      values: z.array(text).min(1).max(64),
    })
    .strict(),
  z.object({ type: z.literal("not_contains"), value: text }).strict(),
  z
    .object({
      type: z.literal("regex"),
      value: z.string().min(1).max(256),
      flags: z
        .string()
        .max(4)
        .regex(/^[imsu]*$/u)
        .refine((flags) => new Set(flags).size === flags.length)
        .default(""),
    })
    .strict(),
  z
    .object({
      type: z.literal("json_path_equals"),
      path: z.string().refine((path) => pathSegments(path) !== undefined),
      value: json,
    })
    .strict(),
  z
    .object({
      type: z.literal("max_length"),
      value: z.number().int().min(0).max(MAX_OUTPUT_BYTES),
    })
    .strict(),
]);

export const testSchema = z
  .object({
    id: labelSchema,
    group: labelSchema.optional(),
    description: z.string().max(4096).optional(),
    skill: z
      .string()
      .max(512)
      .refine((path) => path === "." || safeRelative(skillPath(path)))
      .transform(skillPath),
    input: z.object({ prompt: z.string().max(65_536) }).strict(),
    output: json.refine((value) => {
      if (!isJsonValue(value)) return false;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES;
    }),
    assertions: z.array(assertionSchema).min(1).max(64),
  })
  .strict();

export const envelopeSchema = z
  .object({
    version: z.literal(1),
    tests: z.array(z.unknown()).min(1).max(100),
  })
  .strict();

export type Assertion = z.infer<typeof assertionSchema>;
export type RecordedTest = z.infer<typeof testSchema>;
