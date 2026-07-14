import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { CaaSError } from "./errors.mjs";

const root = new URL("../../contracts/", import.meta.url);

async function compile(file) {
  const schema = JSON.parse(await readFile(new URL(file, root), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const validators = {
  config: await compile("caas-config.v1.schema.json"),
  registration: await compile("caas-tenant-registration.v1.schema.json"),
  desiredState: await compile("caas-desired-state.v1.schema.json"),
  ensure: await compile("caas-connector-ensure.v1.schema.json"),
  ensureResponse: await compile("caas-connector-ensure-response.v1.schema.json"),
};

export function validateCaasContract(kind, value) {
  const validate = validators[kind];
  if (!validate) throw new Error(`unknown CaaS contract: ${kind}`);
  if (!validate(value)) {
    throw new CaaSError("CAAS_CONTRACT_INVALID", `${kind} document is invalid`, {
      status: 400,
      details: validate.errors.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message })),
    });
  }
  return value;
}
