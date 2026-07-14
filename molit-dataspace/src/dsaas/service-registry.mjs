import { readFile } from "node:fs/promises";

import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { digest } from "../discovery/stable-json.mjs";
import { assertCleanUri, validateContract, rejectSecretMaterial } from "./contracts.mjs";

async function readRegistryDocument(path) {
  try {
    const registry = JSON.parse(await readFile(path, "utf8"));
    await validateContract("serviceRegistry", registry);
    return registry;
  } catch (error) {
    const causeCode = typeof error?.code === "string" ? error.code : error instanceof SyntaxError ? "JSON_INVALID" : "READ_FAILED";
    throw new RuntimeError("DSAAS_SERVICE_REGISTRY_REFRESH_FAILED", "trusted service registry could not be read, parsed, or validated", { causeCode });
  }
}

function instant(value, code, field) {
  const milliseconds = Date.parse(value);
  assertRuntime(Number.isFinite(milliseconds), code, `${field} is not a valid date-time`);
  return milliseconds;
}

function registryFreshness(registry, now, maxAgeSeconds) {
  const nowMs = now instanceof Date ? now.getTime() : instant(now, "DSAAS_SERVICE_REGISTRY_STALE", "current time");
  const issuedAt = instant(registry.issuedAt, "DSAAS_SERVICE_REGISTRY_STALE", "service registry issuedAt");
  const validUntil = instant(registry.validUntil, "DSAAS_SERVICE_REGISTRY_STALE", "service registry validUntil");
  return {
    fresh: issuedAt <= nowMs
      && nowMs <= validUntil
      && nowMs - issuedAt <= maxAgeSeconds * 1000,
    issuedAt,
    nowMs,
    validUntil,
  };
}

export async function loadServiceRegistry(path, expectedSha256, { clock = () => new Date(), maxAgeSeconds = 86_400 } = {}) {
  const registry = await readRegistryDocument(path);
  rejectSecretMaterial(registry);
  for (let index = 0; index < registry.services.length; index += 1) {
    assertCleanUri(registry.services[index].endpoint, `$.services[${index}].endpoint`, { protocols: ["https:"] });
  }
  const actualSha256 = digest(registry);
  assertRuntime(actualSha256 === expectedSha256, "DSAAS_SERVICE_REGISTRY_DIGEST_MISMATCH", "trusted service registry digest does not match configuration", {
    actualSha256,
    expectedSha256,
  });
  const freshness = registryFreshness(registry, clock(), maxAgeSeconds);
  assertRuntime(freshness.fresh, "DSAAS_SERVICE_REGISTRY_STALE", "trusted service registry is expired, not yet valid, or older than the configured maximum age", {
    issuedAt: registry.issuedAt,
    maxAgeSeconds,
    validUntil: registry.validUntil,
  });
  const byId = new Map();
  for (const service of registry.services) {
    if (byId.has(service.serviceId)) throw new RuntimeError("DSAAS_SERVICE_REGISTRY_DUPLICATE", "trusted service registry contains a duplicate serviceId", { serviceId: service.serviceId });
    byId.set(service.serviceId, structuredClone(service));
  }
  return Object.freeze({
    actualSha256,
    byId,
    issuedAt: registry.issuedAt,
    maxAgeSeconds,
    registry: structuredClone(registry),
    validUntil: registry.validUntil,
  });
}

export function evaluateRequiredServices(requiredServiceIds, serviceRegistry, now = new Date()) {
  const maxAgeSeconds = serviceRegistry.maxAgeSeconds ?? 86_400;
  const registryDocument = serviceRegistry.registry ?? {
    issuedAt: serviceRegistry.issuedAt,
    validUntil: serviceRegistry.validUntil,
  };
  const registryStatus = registryFreshness(registryDocument, now, maxAgeSeconds);
  const services = requiredServiceIds.map((serviceId) => {
    const service = serviceRegistry.byId.get(serviceId);
    if (!service) return { serviceId, status: "MISSING", effectiveStatus: "MISSING" };
    const observedAt = instant(service.evidence.observedAt, "DSAAS_SERVICE_REGISTRY_STALE", "service evidence observedAt");
    const evidenceFresh = observedAt <= registryStatus.nowMs
      && registryStatus.nowMs - observedAt <= maxAgeSeconds * 1000
      && observedAt <= registryStatus.validUntil;
    return {
      ...structuredClone(service),
      effectiveStatus: registryStatus.fresh && evidenceFresh ? service.status : "STALE",
    };
  });
  return {
    ready: services.every(({ effectiveStatus }) => effectiveStatus === "READY"),
    registryFresh: registryStatus.fresh,
    services,
  };
}
