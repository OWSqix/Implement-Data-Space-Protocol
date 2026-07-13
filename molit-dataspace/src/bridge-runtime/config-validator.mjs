import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "./errors.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function validateRuntimeDocuments(config, approvals) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const [name, value, path] of [
    ["runtime config", config, "contracts/bridge-runtime-config.v1.schema.json"],
    ["approval registry", approvals, "contracts/dispatch-approval-registry.v1.schema.json"],
  ]) {
    const validate = ajv.compile(JSON.parse(await readFile(resolve(ROOT, path), "utf8")));
    if (!validate(value)) throw new RuntimeError("RUNTIME_CONFIG_INVALID", `${name} is invalid`, { errors: validate.errors });
  }
  const ids = approvals.entries.map(({ approvalId }) => approvalId);
  if (new Set(ids).size !== ids.length) throw new RuntimeError("RUNTIME_CONFIG_INVALID", "approval IDs must be unique");
}
