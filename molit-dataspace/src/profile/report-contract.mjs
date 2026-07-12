import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaBytes = await readFile(
  new URL("../../contracts/shacl-validation-report.v1.schema.json", import.meta.url),
);
let schemaSource;
try {
  schemaSource = new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes);
} catch (cause) {
  const error = new Error("validation report schema is not valid UTF-8", { cause });
  error.code = "INVALID_UTF8";
  throw error;
}
const schema = JSON.parse(schemaSource);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export function assertValidationReport(report) {
  if (validate(report)) return report;
  const error = new Error("generated validation report violates its JSON Schema");
  error.code = "INVALID_GENERATED_VALIDATION_REPORT";
  error.details = {
    errors: validate.errors?.map(({ instancePath, keyword, message, schemaPath }) => ({
      instancePath,
      keyword,
      message,
      schemaPath,
    })) ?? [],
  };
  throw error;
}
