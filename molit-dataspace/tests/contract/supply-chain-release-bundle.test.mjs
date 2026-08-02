import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalJson, createReleaseBundle, decorateCycloneDx, decorateSpdx, evaluateVulnerabilityGate, normalizeTrivy, sanitizeTrivyReport, verifyReleaseBundle } from "../../tools/supply-chain/lib.mjs";

const IMAGE = `sha256:${"1".repeat(64)}`;
const SOURCE = `sha256:${"2".repeat(64)}`;
const BASE = `node@sha256:${"3".repeat(64)}`;
const SCANNER = `aquasec/trivy@sha256:${"4".repeat(64)}`;
const SBOM_GENERATOR = `anchore/syft@sha256:${"5".repeat(64)}`;
const BUILD = `node-build@sha256:${"6".repeat(64)}`;
const SIGNER = `sigstore/cosign@sha256:${"7".repeat(64)}`;
const NOW = new Date("2026-07-14T10:00:00.000Z");

function fixture() {
  const spdx = decorateSpdx({ spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: "image", documentNamespace: "https://example.invalid/spdx/test", creationInfo: { created: NOW.toISOString(), creators: ["Tool: test"] }, packages: [{ SPDXID: "SPDXRef-Package", name: "app", versionInfo: "1" }] }, IMAGE, NOW.toISOString());
  const cycloneDx = decorateCycloneDx({ bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000001", version: 1, metadata: { timestamp: NOW.toISOString() }, components: [{ type: "application", name: "app", version: "1" }] }, IMAGE);
  const rawScan = { SchemaVersion: 2, Metadata: { ImageID: IMAGE }, Results: [] };
  const scan = normalizeTrivy(rawScan, { Version: "0.72.0" }, { imageDigest: IMAGE, scannerImage: SCANNER, databaseMetadata: { Version: 2, UpdatedAt: "2026-07-14T09:30:00.000Z" }, scannedAt: NOW.toISOString() });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { spdx, cycloneDx, scan, rawScan: sanitizeTrivyReport(rawScan), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey: publicKey.export({ type: "spki", format: "pem" }) };
}

async function writeArtifacts(directory, values) {
  await writeFile(join(directory, "image.spdx.json"), `${canonicalJson(values.spdx)}\n`);
  await writeFile(join(directory, "image.cyclonedx.json"), `${canonicalJson(values.cycloneDx)}\n`);
  await writeFile(join(directory, "image.scan.json"), `${canonicalJson(values.scan)}\n`);
  await writeFile(join(directory, "trivy.raw.json"), `${canonicalJson(values.rawScan)}\n`);
}

function createBundle(values) {
  return createReleaseBundle({ imageName: "registry.example/molit-caas", imageDigest: IMAGE, sourceDigest: SOURCE, dockerfile: "deploy/images/Dockerfile.caas", artifact: { service: "caas", runtimeClass: "caas-control-plane", productionEligible: true }, provenanceMode: "source-build", toolchain: { baseImage: BASE, buildImage: BUILD, sbomGeneratorImage: SBOM_GENERATOR, scannerImage: SCANNER, signerImage: SIGNER }, builderId: "https://builder.example/v1", invocationId: "00000000-0000-4000-8000-000000000002", startedOn: "2026-07-14T09:59:00.000Z", finishedOn: NOW.toISOString(), spdx: values.spdx, cycloneDx: values.cycloneDx, scan: values.scan, rawScan: values.rawScan, paths: { spdx: "image.spdx.json", cycloneDx: "image.cyclonedx.json", scan: "image.scan.json", scanRaw: "trivy.raw.json" }, privateKeyPem: values.privateKey, now: NOW });
}

const EXPECTED_ARTIFACT = { service: "caas", runtimeClass: "caas-control-plane", productionEligible: true };

test("release bundle validates against schema and verifies every signed subject", async () => {
  const values = fixture();
  const directory = await mkdtemp(join(tmpdir(), "molit-supply-chain-"));
  await writeArtifacts(directory, values);
  const bundle = createBundle(values);
  const schema = JSON.parse(await readFile(new URL("../../contracts/supply-chain-release-bundle.v1.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  assert.equal(ajv.validate(schema, bundle), true, JSON.stringify(ajv.errors));
  const result = await verifyReleaseBundle({ bundle, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: SOURCE, expectedArtifact: EXPECTED_ARTIFACT, now: NOW });
  assert.equal(result.verified, true);
  assert.deepEqual(result.artifacts.sort(), ["cycloneDx", "spdx", "vulnerabilityScan", "vulnerabilityScanRaw"]);
});

test("signature, SBOM, source, and scan changes fail closed", async () => {
  const values = fixture();
  const directory = await mkdtemp(join(tmpdir(), "molit-supply-chain-"));
  await writeArtifacts(directory, values);
  const bundle = createBundle(values);
  const alteredSignature = structuredClone(bundle);
  alteredSignature.dsse.signatures[0].sig = Buffer.alloc(64).toString("base64");
  await assert.rejects(() => verifyReleaseBundle({ bundle: alteredSignature, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: SOURCE, expectedArtifact: EXPECTED_ARTIFACT, now: NOW }), { code: "SUP_SIGNATURE_INVALID" });
  await assert.rejects(() => verifyReleaseBundle({ bundle, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: `sha256:${"9".repeat(64)}`, expectedArtifact: EXPECTED_ARTIFACT, now: NOW }), { code: "SUP_SOURCE_SUBJECT_MISMATCH" });
  const unsignedReference = structuredClone(bundle);
  unsignedReference.artifacts.spdx.sha256 = "8".repeat(64);
  await assert.rejects(() => verifyReleaseBundle({ bundle: unsignedReference, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: SOURCE, expectedArtifact: EXPECTED_ARTIFACT, now: NOW }), { code: "SUP_ARTIFACT_PROVENANCE_MISMATCH" });
  const relabeled = structuredClone(bundle);
  relabeled.artifact = { service: "edc-control-plane", runtimeClass: "edc-control-plane", productionEligible: false };
  await assert.rejects(() => verifyReleaseBundle({ bundle: relabeled, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: SOURCE, expectedArtifact: relabeled.artifact, now: NOW }), { code: "SUP_ARTIFACT_PROVENANCE_MISMATCH" });
  const extraField = structuredClone(bundle);
  extraField.untrusted = true;
  await assert.rejects(() => verifyReleaseBundle({ bundle: extraField, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: SOURCE, expectedArtifact: EXPECTED_ARTIFACT, now: NOW }), { code: "SUP_BUNDLE_INVALID" });
  await writeFile(join(directory, "image.spdx.json"), "{}\n");
  await assert.rejects(() => verifyReleaseBundle({ bundle, publicKeyPem: values.publicKey, artifactDirectory: directory, expectedImageName: "registry.example/molit-caas", expectedImageDigest: IMAGE, expectedSourceDigest: SOURCE, expectedArtifact: EXPECTED_ARTIFACT, now: NOW }), { code: "SUP_ARTIFACT_TAMPERED" });
});

test("blocking findings and stale scanner DB cannot produce a release", () => {
  const values = fixture();
  values.scan.findings.push({ scanner: "vulnerability", target: "lib", id: "CVE-test", severity: "HIGH" });
  assert.equal(evaluateVulnerabilityGate(values.scan, { now: NOW }).decision, "blocked");
  assert.throws(() => createBundle(values), { code: "SUP_VULNERABILITY_GATE_BLOCKED" });
  values.scan.findings.length = 0;
  values.scan.databaseUpdatedAt = "2026-07-12T00:00:00.000Z";
  assert.throws(() => evaluateVulnerabilityGate(values.scan, { now: NOW }), { code: "SUP_SCANNER_DB_STALE" });
});

test("Trivy evidence keeps finding identity but removes secret match and source code", () => {
  const sanitized = sanitizeTrivyReport({
    SchemaVersion: 2,
    Metadata: { ImageID: IMAGE },
    Results: [{ Target: "layer", Class: "secret", Type: "secret", Secrets: [{ RuleID: "private-key", Category: "key", Severity: "CRITICAL", StartLine: 2, EndLine: 4, Match: "actual-secret-value", Code: { Lines: [{ Content: "actual-secret-value" }] } }] }],
  });
  assert.equal(JSON.stringify(sanitized).includes("actual-secret-value"), false);
  assert.equal(sanitized.Results[0].Secrets[0].RuleID, "private-key");
});

test("observability schemas compile and reject incomplete operational configuration", async () => {
  const paths = ["observability-config.v1.schema.json", "observability-audit-outbox.v1.schema.json", "observability-audit-record.v1.schema.json", "observability-worm-receipt.v1.schema.json"];
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  let validateConfig;
  for (const path of paths) {
    const schema = JSON.parse(await readFile(new URL(`../../contracts/${path}`, import.meta.url), "utf8"));
    const validator = ajv.compile(schema);
    if (path === "observability-config.v1.schema.json") validateConfig = validator;
    assert.equal(typeof validator, "function");
  }
  assert.equal(validateConfig({ schemaVersion: "molit.observability-config/1" }), false);
});
