#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { canonicalJson, decorateCycloneDx, decorateSpdx, normalizeTrivy, sanitizeTrivyReport, SupplyChainError } from "./lib.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function load(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

try {
  const kind = argument("kind");
  const input = argument("input");
  const output = argument("output");
  const imageDigest = argument("image-digest");
  if (!kind || !input || !output || !imageDigest) throw new SupplyChainError("SUP_ARGUMENT_REQUIRED", "--kind, --input, --output, and --image-digest are required");
  let document;
  if (kind === "spdx") document = decorateSpdx(await load(input), imageDigest);
  else if (kind === "cyclonedx") document = decorateCycloneDx(await load(input), imageDigest);
  else if (kind === "canonical-json") document = await load(input);
  else if (kind === "trivy-evidence") document = sanitizeTrivyReport(await load(input));
  else if (kind === "trivy") {
    const versionPath = argument("version");
    const databaseMetadataPath = argument("database-metadata");
    const scannerImage = argument("scanner-image");
    if (!versionPath || !databaseMetadataPath || !scannerImage) throw new SupplyChainError("SUP_ARGUMENT_REQUIRED", "Trivy normalization requires --version, --database-metadata, and --scanner-image");
    document = normalizeTrivy(await load(input), await load(versionPath), { imageDigest, scannerImage, databaseMetadata: await load(databaseMetadataPath) });
  } else throw new SupplyChainError("SUP_KIND_INVALID", "--kind must be spdx, cyclonedx, canonical-json, trivy-evidence, or trivy");
  await writeFile(output, `${canonicalJson(document)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output, kind, imageDigest })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code ?? "SUP_NORMALIZE_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
