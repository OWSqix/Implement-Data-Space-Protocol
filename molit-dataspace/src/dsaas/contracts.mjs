import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";

import { RuntimeError } from "../bridge-runtime/errors.mjs";

const SCHEMAS = Object.freeze({
  approvalDecisionRegistry: new URL("../../contracts/dsaas-approval-decision-registry.v1.schema.json", import.meta.url),
  caasEnsureRequest: new URL("../../contracts/caas-connector-ensure.v1.schema.json", import.meta.url),
  caasEnsureResponse: new URL("../../contracts/caas-connector-ensure-response.v1.schema.json", import.meta.url),
  dataspace: new URL("../../contracts/dsaas-dataspace.v1.schema.json", import.meta.url),
  participant: new URL("../../contracts/dsaas-participant.v1.schema.json", import.meta.url),
  serviceRegistry: new URL("../../contracts/dsaas-service-registry.v1.schema.json", import.meta.url),
});

let validatorsPromise;

async function validators() {
  if (!validatorsPromise) {
    validatorsPromise = (async () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      const entries = await Promise.all(Object.entries(SCHEMAS).map(async ([name, url]) => [
        name,
        ajv.compile(JSON.parse(await readFile(url, "utf8"))),
      ]));
      return Object.fromEntries(entries);
    })();
  }
  return validatorsPromise;
}

export async function validateContract(name, value) {
  const validate = (await validators())[name];
  if (!validate) throw new TypeError(`unknown DSaaS contract: ${name}`);
  if (!validate(value)) {
    throw new RuntimeError("DSAAS_CONTRACT_INVALID", `${name} contract is invalid`, {
      contract: name,
      errors: structuredClone(validate.errors),
    });
  }
  return value;
}

const SECRET_FIELD = /(?:authorization|cookie|credential|dataaddress|password|privatekey|secret|token)/u;

function normalizedField(value) {
  return value.toLowerCase().replace(/[^a-z]/gu, "");
}

function parsedUri(value) {
  if (typeof value !== "string") return null;
  try { return new URL(value); } catch { return null; }
}

export function assertCleanUri(value, path, { protocols } = {}) {
  const url = parsedUri(value);
  if (!url) throw new RuntimeError("DSAAS_URI_INVALID", "DSaaS URI is invalid", { path });
  if (url.username || url.password) {
    throw new RuntimeError("DSAAS_SECRET_MATERIAL_FORBIDDEN", "DSaaS URI must not contain userinfo", { path });
  }
  if (url.search || url.hash) {
    throw new RuntimeError("DSAAS_URI_COMPONENT_FORBIDDEN", "DSaaS URI must not contain a query or fragment", { path });
  }
  if (protocols && !protocols.includes(url.protocol)) {
    throw new RuntimeError("DSAAS_URI_INVALID", "DSaaS URI uses a forbidden scheme", { path });
  }
  return url;
}

export function rejectSecretMaterial(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretMaterial(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    const url = parsedUri(value);
    if (url?.username || url?.password) {
      throw new RuntimeError("DSAAS_SECRET_MATERIAL_FORBIDDEN", "DSaaS URI must not contain userinfo", { path });
    }
    if (url && [...url.searchParams.keys()].some((key) => SECRET_FIELD.test(normalizedField(key)))) {
      throw new RuntimeError("DSAAS_SECRET_MATERIAL_FORBIDDEN", "DSaaS URI must not contain credential-like query parameters", { path });
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(normalizedField(key))) {
      throw new RuntimeError("DSAAS_SECRET_MATERIAL_FORBIDDEN", "DSaaS resources may contain secret references, never secret material", {
        path: `${path}.${key}`,
      });
    }
    rejectSecretMaterial(item, `${path}.${key}`);
  }
}
