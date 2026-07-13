import Ajv2019 from "ajv/dist/2019.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "./errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(HERE, "../../standards/vendor/dsp/2025-1-err1");

export async function verifyDspVendorSnapshot(root = SNAPSHOT) {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    const actual = createHash("sha256").update(await readFile(resolve(root, entry.path))).digest("hex");
    if (actual !== entry.sha256) throw new RuntimeError("DSP_SNAPSHOT_DIGEST_MISMATCH", `DSP vendor file digest differs: ${entry.path}`);
  }
  return manifest;
}

export async function createDspSchemaValidators(root = SNAPSHOT) {
  const manifest = await verifyDspVendorSnapshot(root);
  const ajv = new Ajv2019({ allErrors: true, strict: false, validateFormats: false });
  for (const entry of manifest.files.filter(({ path }) => path.endsWith("-schema.json"))) {
    ajv.addSchema(JSON.parse(await readFile(resolve(root, entry.path), "utf8")));
  }
  const ids = {
    catalogRequest: "https://w3id.org/dspace/2025/1/catalog/catalog-request-message-schema.json",
    catalog: "https://w3id.org/dspace/2025/1/catalog/catalog-schema.json",
    contractRequest: "https://w3id.org/dspace/2025/1/negotiation/contract-request-message-schema.json",
    negotiation: "https://w3id.org/dspace/2025/1/negotiation/contract-negotiation-schema.json",
    transferRequest: "https://w3id.org/dspace/2025/1/transfer/transfer-request-message-schema.json",
    transferProcess: "https://w3id.org/dspace/2025/1/transfer/transfer-process-schema.json",
  };
  const validators = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, ajv.getSchema(id)]));
  return {
    validate(name, value) {
      const valid = validators[name]?.(value);
      if (!valid) throw new RuntimeError("DSP_SCHEMA_VIOLATION", `${name} violates the official DSP 2025-1-err1 schema`, { errors: validators[name]?.errors });
      return value;
    },
  };
}
