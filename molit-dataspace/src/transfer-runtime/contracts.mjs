import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "../bridge-runtime/errors.mjs";

const root = new URL("../../contracts/", import.meta.url);

async function compile(file) {
  const schema = JSON.parse(await readFile(new URL(file, root), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const validators = {
  event: await compile("provider-transfer-event.v1.schema.json"),
  registry: await compile("transfer-binding-registry.v1.schema.json"),
  result: await compile("provider-transfer-result.v1.schema.json"),
};

export function validateContract(kind, value) {
  const validator = validators[kind];
  if (!validator) throw new Error(`unknown transfer contract: ${kind}`);
  if (!validator(value)) {
    throw new RuntimeError("TRANSFER_CONTRACT_INVALID", `${kind} contract is invalid`, {
      errors: validator.errors.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message })),
    });
  }
  return value;
}

export const contractDirectory = fileURLToPath(root);
