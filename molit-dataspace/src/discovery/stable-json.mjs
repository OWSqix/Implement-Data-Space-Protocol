import { createHash } from "node:crypto";

export function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  return value;
}

export function stableStringify(value, space = 0) {
  return JSON.stringify(stableValue(value), null, space);
}

export function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
