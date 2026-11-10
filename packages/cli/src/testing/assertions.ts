import { isDeepStrictEqual } from "node:util";
import { isJsonValue, pathSegments, traverse } from "./json-path.js";
import type { JsonValue } from "./json-path.js";
import { boundedRegex } from "./regex.js";
import type { Assertion } from "./schema.js";

export async function assertionFailure(
  output: JsonValue,
  assertion: Assertion,
): Promise<string | undefined> {
  if (assertion.type === "json_path_equals") {
    let json: unknown = output;
    if (typeof output === "string") {
      try {
        json = JSON.parse(output) as unknown;
      } catch {
        return "json_path_equals requires valid JSON output.";
      }
    }
    if (!isJsonValue(json))
      return "json_path_equals requires bounded, prototype-safe JSON output.";
    const segments = pathSegments(assertion.path);
    if (!segments) return "json_path_equals has an unsupported path.";
    const selected = traverse(json, segments);
    return selected.found && isDeepStrictEqual(selected.value, assertion.value)
      ? undefined
      : "json_path_equals assertion failed.";
  }
  if (typeof output !== "string")
    return `${assertion.type} assertion requires a string output.`;
  switch (assertion.type) {
    case "contains":
      return output.includes(assertion.value)
        ? undefined
        : "contains assertion failed.";
    case "contains_any":
      return assertion.values.some((value) => output.includes(value))
        ? undefined
        : "contains_any assertion failed.";
    case "not_contains":
      return !output.includes(assertion.value)
        ? undefined
        : "not_contains assertion failed.";
    case "max_length":
      return output.length <= assertion.value
        ? undefined
        : "max_length assertion failed.";
    case "regex": {
      const result = await boundedRegex(
        assertion.value,
        assertion.flags,
        output,
      );
      switch (result) {
        case "matched":
          return undefined;
        case "not_matched":
          return "regex assertion failed.";
        case "invalid":
          return "regex assertion has an invalid pattern or exceeds its input limit.";
        case "timed_out":
          return "regex assertion timed out after 100 ms.";
        case "unavailable":
          return "regex assertion could not run safely in its worker.";
      }
    }
  }
}
