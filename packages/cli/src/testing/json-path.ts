export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

export function isJsonValue(value: unknown): value is JsonValue {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 20_000 || item.depth > 32) return false;
    if (
      item.value === null ||
      typeof item.value === "string" ||
      typeof item.value === "boolean"
    )
      continue;
    if (typeof item.value === "number") {
      if (!Number.isFinite(item.value)) return false;
      continue;
    }
    if (typeof item.value !== "object") return false;
    if (
      !Array.isArray(item.value) &&
      Object.getPrototypeOf(item.value) !== Object.prototype &&
      Object.getPrototypeOf(item.value) !== null
    )
      return false;
    for (const [key, child] of Object.entries(item.value)) {
      if (forbiddenKeys.has(key)) return false;
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
}

// No quoted keys, wildcards, recursive descent, expressions or inherited access.
export function pathSegments(path: string): (string | number)[] | undefined {
  if (path.length > 512 || path[0] !== "$") return undefined;
  const segments: (string | number)[] = [];
  let offset = 1;
  while (offset < path.length) {
    const tail = path.slice(offset);
    const property = /^\.([A-Za-z_][A-Za-z0-9_]*)/u.exec(tail);
    if (property) {
      const key = property[1]!;
      if (forbiddenKeys.has(key)) return undefined;
      segments.push(key);
      offset += property[0].length;
    } else {
      const index = /^\[(0|[1-9][0-9]{0,8})\]/u.exec(tail);
      if (!index) return undefined;
      segments.push(Number(index[1]));
      offset += index[0].length;
    }
    if (segments.length > 32) return undefined;
  }
  return segments;
}

export function traverse(
  value: JsonValue,
  segments: readonly (string | number)[],
): { found: true; value: JsonValue } | { found: false } {
  let current = value;
  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== "object" ||
      (typeof segment === "number"
        ? !Array.isArray(current)
        : Array.isArray(current)) ||
      !Object.hasOwn(current, segment)
    )
      return { found: false };
    current = (current as { [key: string]: JsonValue })[String(segment)]!;
  }
  return { found: true, value: current };
}
