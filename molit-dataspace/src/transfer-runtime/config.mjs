import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";

export async function loadTransferConfig(path) {
  const config = JSON.parse(await readFile(path, "utf8"));
  const schema = JSON.parse(await readFile(new URL("../../contracts/provider-transfer-runtime-config.v1.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(config)) throw new RuntimeError("TRANSFER_CONFIG_INVALID", "provider transfer runtime config is invalid", { errors: validate.errors });
  if (config.environment === "production") {
    assertRuntime(config.network.allowHttp === false && config.network.allowPrivate === false, "TRANSFER_CONFIG_INVALID", "production forbids HTTP and the broad allowPrivate bypass; use exact HTTPS allowedOrigins/privateOrigins");
    assertRuntime(config.connector.auth, "TRANSFER_CONFIG_INVALID", "production connector management API requires env-backed authentication");
    for (const [id, provisioner] of Object.entries(config.provisioners)) assertRuntime(provisioner.auth, "TRANSFER_CONFIG_INVALID", "production provisioner requires env-backed authentication", { provisionerId: id });
  }
  const origins = [config.connector.baseUrl, ...Object.values(config.provisioners).map(({ baseUrl }) => baseUrl)].map((value) => new URL(value).origin);
  for (const origin of origins) assertRuntime(config.network.allowedOrigins.includes(origin), "TRANSFER_CONFIG_INVALID", "every adapter origin must be explicitly allowlisted", { origin });
  config.journalPath = resolve(dirname(resolve(path)), config.journalPath);
  return config;
}
