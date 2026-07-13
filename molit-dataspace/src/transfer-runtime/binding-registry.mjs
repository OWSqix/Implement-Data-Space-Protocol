import { readFile } from "node:fs/promises";
import { validateContract } from "./contracts.mjs";
import { RuntimeError } from "../bridge-runtime/errors.mjs";

export async function loadBindingRegistry(path) {
  const registry = validateContract("registry", JSON.parse(await readFile(path, "utf8")));
  const seen = new Set();
  for (const binding of registry.bindings) {
    assertSafeResourceRef(binding.resourceRef);
    const key = bindingKey(binding.datasetId, binding.format);
    if (seen.has(key)) throw new RuntimeError("DUPLICATE_TRANSFER_BINDING", "datasetId and format binding must be unique", { datasetId: binding.datasetId, format: binding.format });
    seen.add(key);
  }
  return registry;
}

const credentialKey = /(?:authorization|api[-_]?key|token|secret|password|cookie)/iu;

export function assertSafeResourceRef(resourceRef) {
  for (const key of Object.keys(resourceRef ?? {})) {
    if (credentialKey.test(key)) throw new RuntimeError("BINDING_SECRET_FORBIDDEN", "resourceRef must contain identifiers only, not credential-like fields", { field: key });
  }
  return resourceRef;
}

export function bindingKey(datasetId, format) {
  return `${datasetId}\u0000${format}`;
}

export function resolveBinding(registry, datasetId, format, { requireEnabled = true } = {}) {
  const binding = registry.bindings.find((candidate) => candidate.datasetId === datasetId && candidate.format === format);
  if (!binding || (requireEnabled && !binding.enabled)) throw new RuntimeError("TRANSFER_BINDING_NOT_FOUND", "no permitted private binding exists for datasetId and format", { datasetId, format });
  return structuredClone(binding);
}
