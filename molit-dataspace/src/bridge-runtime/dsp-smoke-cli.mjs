#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExperimentalDspPollingClient } from "./clients.mjs";
import { createDspSchemaValidators } from "./dsp-schemas.mjs";
import { ResilientHttpClient } from "./http-client.mjs";
import { Telemetry } from "./telemetry.mjs";

function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]?.slice(2)] = argv[index + 1];
  return values;
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!args.config || !args.request || args["ack-nonstandard-extension"] !== "yes") {
    throw new Error("--config, --request and --ack-nonstandard-extension yes are required");
  }
  const [config, request] = await Promise.all([
    readFile(resolve(args.config), "utf8").then(JSON.parse),
    readFile(resolve(args.request), "utf8").then(JSON.parse),
  ]);
  if (config.pollingAgreementIdExtension !== true) throw new Error("pollingAgreementIdExtension must be explicitly enabled");
  const origin = new URL(config.baseUrl).origin;
  const http = new ResilientHttpClient({
    ...(config.http ?? {}),
    policy: { allowedOrigins: [origin], allowHttp: false, allowPrivate: false },
    telemetry: new Telemetry(),
  });
  const client = new ExperimentalDspPollingClient({ config, http, schemas: await createDspSchemaValidators() });
  const result = await client.execute(request, request.operationId);
  process.stderr.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: error.code ?? error.name, message: error.message })}\n`);
  process.exitCode = 1;
});
