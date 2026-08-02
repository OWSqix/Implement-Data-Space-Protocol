import { readFile } from "node:fs/promises";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

async function json(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${error.message}`);
  }
}

const schemaPath = argument("--schema");
const inputPath = argument("--input");
const [schema, input] = await Promise.all([
  json(schemaPath, "evidence schema"),
  json(inputPath, "evidence document"),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(input)) {
  process.stderr.write(`${JSON.stringify(validate.errors, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`Evidence schema valid: ${inputPath}\n`);
