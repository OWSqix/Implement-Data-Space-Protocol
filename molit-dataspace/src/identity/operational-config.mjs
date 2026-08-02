import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertIdentity, unavailable } from "./errors.mjs";
import { parseStrictJson } from "./strict-json.mjs";

let validatorPromise;

async function identityConfigValidator() {
  validatorPromise ??= (async () => {
    const schema = parseStrictJson(await readFile(new URL("../../contracts/identity-runtime-config.v1.schema.json", import.meta.url), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    return ajv.compile(schema);
  })();
  return validatorPromise;
}

function endpointOrigins(config) {
  if (config.mode === "oidc-jwt") return [new URL(config.oidcJwt.discoveryUrl).origin];
  return [new URL(config.introspection.introspectionUrl).origin];
}

export async function loadOperationalIdentityConfig(path, { production = true } = {}) {
  const absolutePath = resolve(path);
  const config = parseStrictJson(await readFile(absolutePath, "utf8"));
  const validate = await identityConfigValidator();
  assertIdentity(validate(config), "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "identity runtime configuration does not satisfy its schema", {
    status: 500,
    details: { errors: validate.errors },
  });
  const allowedOrigins = new Set(config.network.allowedOrigins);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    assertIdentity(url.origin === origin && !url.username && !url.password && !url.search && !url.hash,
      "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "identity network origins must be bare origins", { status: 500 });
    assertIdentity(!production || url.protocol === "https:", "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "production identity origins require HTTPS", { status: 500 });
  }
  for (const origin of endpointOrigins(config)) {
    assertIdentity(allowedOrigins.has(origin), "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "identity endpoint origin is not in the allowed origin set", { status: 500 });
  }
  const issuer = new URL(config.policy.issuer);
  assertIdentity(!issuer.username && !issuer.password && !issuer.search && !issuer.hash,
    "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "identity issuer URL contains a forbidden component", { status: 500 });
  if (production) {
    assertIdentity(config.network.allowInsecureLoopback === false, "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "production identity configuration cannot allow insecure loopback endpoints", { status: 500 });
    assertIdentity(issuer.protocol === "https:", "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "production identity issuer requires HTTPS", { status: 500 });
    assertIdentity(config.mode === "rfc7662-introspection", "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "production identity requires RFC 7662 introspection until a durable JWT revocation registry is configured", { status: 500 });
  }
  if (config.mode === "rfc7662-introspection") {
    const secret = new URL(config.introspection.clientSecretRef);
    assertIdentity(secret.protocol === "file:" && !secret.hostname && !secret.username && !secret.password && !secret.search && !secret.hash,
      "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "introspection clientSecretRef must be an unadorned file URL", { status: 500 });
  }
  Object.defineProperty(config, "sourcePath", { value: absolutePath, enumerable: false });
  Object.defineProperty(config, "sourceDirectory", { value: dirname(absolutePath), enumerable: false });
  return config;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw unavailable("IDENTITY_SECRET_UNAVAILABLE", "secret read was aborted");
}

export class BoundedFileSecretProvider {
  constructor({ maxBytes = 8_192 } = {}) {
    assertIdentity(Number.isSafeInteger(maxBytes) && maxBytes >= 16 && maxBytes <= 1_048_576,
      "IDENTITY_SECRET_CONFIGURATION_INVALID", "secret byte limit is invalid", { status: 500 });
    this.maxBytes = maxBytes;
  }

  async get(reference, { signal } = {}) {
    throwIfAborted(signal);
    let path;
    try {
      const url = new URL(reference);
      assertIdentity(url.protocol === "file:" && !url.hostname && !url.username && !url.password && !url.search && !url.hash,
        "IDENTITY_SECRET_REFERENCE_INVALID", "secret reference must be an unadorned file URL", { status: 500 });
      path = fileURLToPath(url);
    } catch (error) {
      if (error?.code?.startsWith?.("IDENTITY_")) throw error;
      throw unavailable("IDENTITY_SECRET_REFERENCE_INVALID", "secret reference is not a valid file URL", error);
    }
    let handle;
    try {
      handle = await open(path, "r");
      const before = await handle.stat();
      assertIdentity(before.isFile() && before.size > 0 && before.size <= this.maxBytes,
        "IDENTITY_SECRET_UNAVAILABLE", "secret file is empty, non-regular, or exceeds its byte limit", { status: 503 });
      const bytes = await handle.readFile();
      const after = await handle.stat();
      assertIdentity(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs,
        "IDENTITY_SECRET_UNAVAILABLE", "secret file changed while it was being read", { status: 503 });
      throwIfAborted(signal);
      const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/(?:\r?\n)$/u, "");
      assertIdentity(value.length > 0 && !value.includes("\0"), "IDENTITY_SECRET_UNAVAILABLE", "secret file contains invalid material", { status: 503 });
      return value;
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      if (error?.code?.startsWith?.("IDENTITY_")) throw error;
      throw unavailable("IDENTITY_SECRET_UNAVAILABLE", "secret file could not be read", error);
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}
