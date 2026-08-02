#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SupplyChainError, verifyReleaseBundle } from "./lib.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  const bundlePath = argument("bundle");
  const publicKeyPath = argument("public-key");
  const imageName = argument("image-name");
  const imageDigest = argument("image-digest");
  const sourceDigest = argument("source-digest");
  const service = argument("service");
  const runtimeClass = argument("runtime-class");
  const productionEligible = argument("production-eligible");
  if (!bundlePath || !publicKeyPath || !imageName || !imageDigest || !sourceDigest || !service || !runtimeClass || !["true", "false"].includes(productionEligible)) throw new SupplyChainError("SUP_ARGUMENT_REQUIRED", "bundle, key, image, source, service, runtime class, and production eligibility arguments are required");
  const result = await verifyReleaseBundle({ bundle: JSON.parse(await readFile(bundlePath, "utf8")), publicKeyPem: await readFile(publicKeyPath, "utf8"), artifactDirectory: resolve(dirname(bundlePath)), expectedImageName: imageName, expectedImageDigest: imageDigest, expectedSourceDigest: sourceDigest, expectedArtifact: { service, runtimeClass, productionEligible: productionEligible === "true" } });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code ?? "SUP_VERIFY_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
