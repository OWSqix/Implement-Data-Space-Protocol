import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

async function readSchema(relativeUrl) {
  const bytes = await readFile(new URL(relativeUrl, import.meta.url));
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    const error = new Error("validation report schema is not valid UTF-8", { cause });
    error.code = "INVALID_UTF8";
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    const error = new Error("validation report schema is not valid JSON", { cause });
    error.code = "INVALID_REPORT_SCHEMA";
    throw error;
  }
}

const [schema, publicationCheckSchema] = await Promise.all([
  readSchema("../../contracts/shacl-validation-report.v1.schema.json"),
  readSchema("../../contracts/publication-check-report.v1.schema.json"),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const validatePublicationCheck = ajv.compile(publicationCheckSchema);

function validationErrors(validator) {
  return validator.errors?.map(({ instancePath, keyword, message, schemaPath }) => ({
    instancePath,
    keyword,
    message,
    schemaPath,
  })) ?? [];
}

export function assertValidationReport(report) {
  if (validate(report)) return report;
  const error = new Error("generated validation report violates its JSON Schema");
  error.code = "INVALID_GENERATED_VALIDATION_REPORT";
  error.details = { errors: validationErrors(validate) };
  throw error;
}

export function assertPublicationCheckReport(report) {
  if (validatePublicationCheck(report)) return report;
  const error = new Error("generated publication-check report violates its JSON Schema");
  error.code = "INVALID_GENERATED_PUBLICATION_CHECK_REPORT";
  error.details = { errors: validationErrors(validatePublicationCheck) };
  throw error;
}
