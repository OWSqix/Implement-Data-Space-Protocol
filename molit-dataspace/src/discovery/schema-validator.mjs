import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { BridgeError } from "./errors.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv, { mode: "full" });

function load(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const validators = {
  approvalRegistry: ajv.compile(load("../../contracts/approval-registry.v1.schema.json")),
  candidate: ajv.compile(load("../../contracts/connector-registration-candidate.v1.schema.json")),
  discovery: ajv.compile(load("../../contracts/discovery-record.v1.schema.json")),
  metadataBatch: ajv.compile(load("../../contracts/platform-metadata-batch.v1.schema.json")),
  outbox: ajv.compile(load("../../contracts/outbox-envelope.v2.schema.json")),
  projectionConfig: ajv.compile(load("../../contracts/projection-config.v1.schema.json")),
};

function validate(name, value, code) {
  const validator = validators[name];
  if (validator(value)) {
    return;
  }
  throw new BridgeError(code, `${name} failed JSON Schema validation`, {
    field: validator.errors?.[0]?.instancePath || "/",
    keyword: validator.errors?.[0]?.keyword,
  });
}

export function validateApprovalRegistryDocument(value) {
  validate("approvalRegistry", value, "APPROVAL_REGISTRY_SCHEMA_INVALID");
}

export function validateCandidateDocument(value) {
  validate("candidate", value, "CANDIDATE_SCHEMA_INVALID");
}

export function validateMetadataBatchDocument(value) {
  validate("metadataBatch", value, "METADATA_BATCH_SCHEMA_INVALID");
}

export function validateDiscoveryDocument(value) {
  validate("discovery", value, "DISCOVERY_SCHEMA_INVALID");
}

export function validateOutboxDocument(value) {
  validate("outbox", value, "OUTBOX_SCHEMA_INVALID");
}

export function validateProjectionConfigDocument(value) {
  validate("projectionConfig", value, "PROJECTION_CONFIG_SCHEMA_INVALID");
}

export { validators as schemaValidators };
