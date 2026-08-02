#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { canonicalJson, createReleaseBundle, SupplyChainError } from "./lib.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function load(path) { return JSON.parse(await readFile(path, "utf8")); }

try {
  const names = ["image-name", "image-digest", "source-digest", "dockerfile", "base-image", "build-image", "sbom-generator-image", "scanner-image", "signer-image", "builder-id", "invocation-id", "started-on", "finished-on", "spdx", "cyclonedx", "scan", "scan-raw", "private-key", "output", "service", "runtime-class", "production-eligible", "provenance-mode"];
  const args = Object.fromEntries(names.map((name) => [name, argument(name)]));
  if (names.some((name) => !args[name])) throw new SupplyChainError("SUP_ARGUMENT_REQUIRED", `required arguments: ${names.map((name) => `--${name}`).join(", ")}`);
  if (!["true", "false"].includes(args["production-eligible"])) throw new SupplyChainError("SUP_ARGUMENT_INVALID", "--production-eligible must be true or false");
  const bundle = createReleaseBundle({
    imageName: args["image-name"], imageDigest: args["image-digest"], sourceDigest: args["source-digest"], dockerfile: args.dockerfile,
    toolchain: { baseImage: args["base-image"], buildImage: args["build-image"], sbomGeneratorImage: args["sbom-generator-image"], scannerImage: args["scanner-image"], signerImage: args["signer-image"] }, builderId: args["builder-id"], invocationId: args["invocation-id"], startedOn: args["started-on"], finishedOn: args["finished-on"],
    spdx: await load(args.spdx), cycloneDx: await load(args.cyclonedx), scan: await load(args.scan), rawScan: await load(args["scan-raw"]),
    artifact: { service: args.service, runtimeClass: args["runtime-class"], productionEligible: args["production-eligible"] === "true" },
    provenanceMode: args["provenance-mode"],
    paths: { spdx: basename(args.spdx), cycloneDx: basename(args.cyclonedx), scan: basename(args.scan), scanRaw: basename(args["scan-raw"]) },
    privateKeyPem: await readFile(args["private-key"], "utf8"),
  });
  await writeFile(args.output, `${canonicalJson(bundle)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: args.output, artifact: bundle.artifact, image: bundle.image, keyid: bundle.dsse.signatures[0].keyid })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code ?? "SUP_ATTEST_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
