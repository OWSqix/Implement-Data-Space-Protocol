import { createHash, timingSafeEqual } from "node:crypto";
import { CaaSError, assertCaas } from "./errors.mjs";

export function resolveEnvironmentSecret(reference, env = process.env) {
  const match = /^env:\/\/([A-Z_][A-Z0-9_]*)$/u.exec(reference ?? "");
  assertCaas(match, "CAAS_SECRET_REF_INVALID", "control-plane authentication requires an env:// secret reference", { status: 500 });
  const value = env[match[1]];
  assertCaas(typeof value === "string" && value.length >= 16, "CAAS_SECRET_UNAVAILABLE", "referenced authentication secret is unavailable or too short", { status: 503 });
  return value;
}

export function validateDeploymentSecretReference(reference) {
  if (/^env:\/\/[A-Z_][A-Z0-9_]*$/u.test(reference ?? "")) return reference;
  const match = /^vault:\/\/([A-Za-z0-9][A-Za-z0-9._/-]{0,239})$/u.exec(reference ?? "");
  const segments = match?.[1].split("/") ?? [];
  assertCaas(match && segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "CAAS_SECRET_REF_INVALID", "deployment credentials require an exact env name or canonical vault logical path", { status: 400 });
  return reference;
}

export function bearerToken(header) {
  const match = /^Bearer ([^\s]+)$/u.exec(header ?? "");
  if (!match) throw new CaaSError("CAAS_UNAUTHORIZED", "valid bearer authentication is required", { status: 401 });
  return match[1];
}

export function secretEqual(left, right) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
