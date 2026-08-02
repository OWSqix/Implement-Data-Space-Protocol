import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const harnessUrl = new URL("../../deploy/p0/run-local-verification.ps1", import.meta.url);
const schemaUrl = new URL("../../contracts/p0-local-verification.v1.schema.json", import.meta.url);
const runtimeImageSchemaUrl = new URL("../../contracts/runtime-image-local-verification.v1.schema.json", import.meta.url);
const runtimeImageVerifierUrl = new URL("../../deploy/images/verify-local-runtime-images.ps1", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);
const verificationProfileUrl = new URL("../../deploy/p0/verification-steps.v1.json", import.meta.url);

test("P0-VERIFY-001: the local harness covers every P0 source and runtime gate", async () => {
  const [harness, manifest, profile] = await Promise.all([
    readFile(harnessUrl, "utf8"),
    readFile(packageUrl, "utf8").then(JSON.parse),
    readFile(verificationProfileUrl, "utf8").then(JSON.parse),
  ]);
  const commands = [
    "verify",
    "test:control-store:postgres",
    "test:identity",
    "test:identity:keycloak",
    "test:observability",
    "test:observability:collector",
    "test:observability:rules",
    "test:kubernetes",
    "test:kubernetes:kind",
    "test:ha:pitr",
    "test:runtime-images",
    "edc:verify:runtime",
    "test:edc:schema:postgres",
    "test:supply-chain",
    "commercial:status",
  ];
  const profileCommands = new Set(profile.steps.map((step) => step.arguments[1]));
  for (const command of commands) {
    assert.equal(profileCommands.has(command), true, `verification profile omits command: ${command}`);
    assert.equal(typeof manifest.scripts[command], "string", `missing package script: ${command}`);
  }
  assert.match(manifest.scripts["verify:p0:local"], /run-local-verification\.ps1/u);
  assert.match(manifest.scripts["verify:p0:evidence"], /verify-p0-local-evidence\.mjs/u);
  assert.match(harness, /verification-steps\.v1\.json/u);
  assert.deepEqual(profile.steps.find((step) => step.id === "commercial-gate-fail-closed").expectedExitCodes, [2]);
  assert.deepEqual(profile.steps.find((step) => step.id === "kubernetes-kind-30").arguments.slice(3, 5), ["-Cycles", "30"]);
  const edcSchema = profile.steps.find((step) => step.id === "edc-schema-postgres");
  assert.equal(edcSchema.skippable, false);
  assert.deepEqual(edcSchema.arguments.slice(3), ["-EvidencePath", "{{EVIDENCE_DIR}}/edc-schema-postgres.json"]);
  assert.equal(edcSchema.artifacts[0].schema, "contracts/edc-schema-postgres-verification.v1.schema.json");
  assert.match(harness, /immutableReleaseEvidence/u);
  assert.match(harness, /worktree-source-digest\.mjs/u);
  assert.match(harness, /stableDuringRun/u);
  assert.match(harness, /Get-FileHash -LiteralPath \$logPath -Algorithm SHA256/u);
  assert.match(harness, /verify-p0-local-evidence\.mjs/u);
  assert.match(harness, /if \(-not \$complete\)/u);
});

test("P0-VERIFY-002: the evidence schema separates local completion from operating evidence", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "molit.p0-local-verification/1");
  assert.equal(schema.properties.externalOperatingEvidence.const, "not-evaluated-as-pass");
  assert.equal(schema.properties.source.properties.immutableReleaseEvidence.type, "boolean");
  assert.equal(schema.properties.source.properties.stableDuringRun.type, "boolean");
  assert.equal(schema.properties.verificationProfile.properties.path.const, "deploy/p0/verification-steps.v1.json");
  assert.match(schema.properties.source.properties.worktreeDigest.pattern, /64/u);
  assert.deepEqual(schema.properties.steps.items.properties.status.enum, ["passed", "failed"]);
  assert.match(schema.properties.steps.items.properties.log.properties.sha256.pattern, /64/u);
  assert.match(schema.properties.artifacts.items.properties.sha256.pattern, /64/u);
});

test("P0-VERIFY-003: local image evidence covers every P0 deployment artifact", async () => {
  const [schema, verifier] = await Promise.all([
    readFile(runtimeImageSchemaUrl, "utf8").then(JSON.parse),
    readFile(runtimeImageVerifierUrl, "utf8"),
  ]);
  const services = ["caas", "dsaas", "fencing-webhook", "edc-control-plane", "edc-data-plane", "edc-schema-migration"];
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  assert.equal(typeof ajv.compile(schema), "function");
  assert.equal(schema.properties.images.maxItems, services.length);
  for (const service of services) assert.match(verifier, new RegExp(`service = "${service}"`, "u"));
  assert.match(verifier, /--read-only/u);
  assert.match(verifier, /production-eligible/u);
  assert.match(verifier, /runtime-image-inventory\.v1\.json/u);
  assert.match(verifier, /external-adoption/u);
  assert.equal(schema.properties.externalAdoptions.maxItems, 2);
  assert.equal(schema.properties.externalAdoptions.items.properties.releasePathContractDeclared.const, true);
  assert.match(verifier, /releasePathContractDeclared/u);
  assert.doesNotMatch(verifier, /releaseBundleContractVerified/u);
  assert.match(verifier, /validate-json-evidence\.mjs/u);
});
