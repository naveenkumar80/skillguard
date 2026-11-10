import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { EngineRequest, EngineResponse, Finding } from "../core/models.js";

const require = createRequire(import.meta.url);
const schema = (name: string): object =>
  JSON.parse(
    readFileSync(
      require.resolve(`@skillguard/protocol/schema/${name}.schema.json`),
      "utf8",
    ),
  ) as object;
const ajv = new Ajv2020({ strict: true, allErrors: false });
ajv.addSchema(schema("finding"));
const requestValidator = ajv.compile<EngineRequest>(schema("engine-request"));
const responseValidator = ajv.compile<EngineResponse>(
  schema("engine-response"),
);
const findingValidator = ajv.getSchema<Finding>(
  "urn:skill-assurance:finding:1.0",
);
if (!findingValidator) throw new Error("Finding schema unavailable");

export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
export function validateRequest(value: unknown): EngineRequest {
  if (!requestValidator(value))
    throw new EngineError(
      "INVALID_REQUEST",
      "Request does not match protocol schema",
    );
  const paths = value.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length)
    throw new EngineError(
      "INVALID_REQUEST",
      "Request file paths must be unique",
    );
  return value;
}
export function validateResponse(value: unknown): EngineResponse {
  if (
    typeof value === "object" &&
    value !== null &&
    "protocolVersion" in value &&
    value.protocolVersion !== "1.0"
  ) {
    throw new EngineError(
      "UNSUPPORTED_PROTOCOL",
      "Engine protocol version is incompatible",
    );
  }
  if (!responseValidator(value))
    throw new EngineError(
      "INVALID_RESPONSE",
      "Engine response does not match protocol schema",
    );
  return value;
}
export const isFinding = findingValidator;
