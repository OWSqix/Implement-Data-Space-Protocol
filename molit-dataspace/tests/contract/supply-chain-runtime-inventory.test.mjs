import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { RELEASE_ARTIFACTS } from "../../tools/supply-chain/lib.mjs";

const root = new URL("../..", import.meta.url);
const loadJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const inventory = await loadJson("deploy/supply-chain/runtime-image-inventory.v1.json");
const schema = await loadJson("contracts/supply-chain-runtime-image-inventory.v1.schema.json");
const byService = new Map(inventory.artifacts.map((artifact) => [artifact.service, artifact]));

test("COM-SUP-INVENTORY-001: the runtime image inventory is schema-valid and complete", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(schema);
  assert.equal(validate(inventory), true, JSON.stringify(validate.errors));
  assert.deepEqual([...byService.keys()].sort(), [
    "caas",
    "dsaas",
    "edc-control-plane",
    "edc-data-plane",
    "edc-schema-migration",
    "fencing-webhook",
    "otel-collector",
    "postgres-operand",
  ]);
  assert.deepEqual(Object.fromEntries(inventory.artifacts.map(({ service, runtimeClass, productionEligible, provenanceMode }) => [
    service,
    { runtimeClass, productionEligible, provenanceMode },
  ])), RELEASE_ARTIFACTS);
  assert.deepEqual({ apiVersion: inventory.admissionPolicy.apiVersion, kind: inventory.admissionPolicy.kind }, {
    apiVersion: "policies.kyverno.io/v1",
    kind: "ImageValidatingPolicy",
  });
});

test("COM-SUP-INVENTORY-002: every managed production image binding has one inventory owner", async () => {
  const staticFiles = [
    "deploy/kubernetes/ha/control-plane.template.yaml",
    "deploy/kubernetes/control-store-migration-job.yaml",
    "deploy/kubernetes/control-store-runtime-bootstrap-job.yaml",
    "deploy/kubernetes/fencing-webhook.template.yaml",
    "deploy/kubernetes/ha/postgres.template.yaml",
    "deploy/kubernetes/ha/observability.template.yaml",
  ];
  const discovered = new Set();
  for (const path of staticFiles) {
    const content = await readFile(new URL(path, root), "utf8");
    for (const match of content.matchAll(/@@[A-Z_]*IMAGE@@|__WEBHOOK_IMAGE__/gu)) discovered.add(`${path}\0${match[0]}`);
  }
  const dynamicPath = "src/caas/kubernetes-provisioner.mjs";
  const dynamic = await readFile(new URL(dynamicPath, root), "utf8");
  for (const binding of ["images.controlPlane", "images.dataPlane", "schema.migrationImage"]) {
    assert.match(dynamic, new RegExp(binding.replace(".", "\\."), "u"));
    discovered.add(`${dynamicPath}\0${binding}`);
  }

  const declared = new Set(inventory.artifacts.flatMap((artifact) => artifact.deploymentUses
    .map((usage) => `${usage.path}\0${usage.imageBinding}`)));
  assert.deepEqual([...declared].sort(), [...discovered].sort());

  for (const artifact of inventory.artifacts) {
    for (const usage of artifact.deploymentUses) {
      const content = await readFile(new URL(usage.path, root), "utf8");
      assert.equal(content.includes(usage.imageBinding), true, `${usage.id} does not identify a real image binding`);
    }
  }
});

test("COM-SUP-INVENTORY-003: P1-blocked EDC runtime images cannot claim production eligibility", async () => {
  for (const runtimeClass of ["edc-control-plane", "edc-data-plane"]) {
    assert.equal(byService.get(runtimeClass).productionEligible, false);
    assert.ok(byService.get(runtimeClass).blockers.length > 0);
  }
  assert.deepEqual(inventory.forbiddenDockerTargets, ["smoke-control-plane", "smoke-data-plane"]);
  const runtimeArtifacts = await loadJson("deploy/edc/runtime-artifacts.v1.json");
  for (const target of inventory.forbiddenDockerTargets) {
    assert.equal(runtimeArtifacts.artifacts[target].productionEligible, false);
    assert.equal(runtimeArtifacts.artifacts[target].smokeOnly, true);
  }
});

test("COM-SUP-INVENTORY-004: third-party operands use digest-preserving external adoption", () => {
  for (const runtimeClass of ["postgres-operand", "otel-collector"]) {
    const artifact = byService.get(runtimeClass);
    assert.equal(artifact.provenanceMode, "external-adoption");
    assert.match(artifact.upstreamImage, /@sha256:[0-9a-f]{64}$/u);
    assert.match(artifact.releaseCommand, /^deploy\/images\/adopt-sign-verify\.ps1 /u);
    assert.equal(artifact.productionEligible, true);
  }
});

test("COM-SUP-INVENTORY-005: vulnerability waivers are forbidden in the P0 release path", () => {
  assert.equal(inventory.vulnerabilityExceptionPolicy, "no-waiver");
  for (const artifact of inventory.artifacts) assert.equal(artifact.admissionRequired, true);
});

test("COM-SUP-INVENTORY-006: database tool use is the schema-migration runtime class, not an untracked ninth artifact", () => {
  const schemaMigration = byService.get("edc-schema-migration");
  assert.deepEqual(schemaMigration.deploymentUses.filter((usage) => usage.imageBinding === "@@DATABASE_TOOL_IMAGE@@").map((usage) => usage.id).sort(), [
    "control-store-database-tool-bootstrap",
    "control-store-database-tool-migration",
  ]);
  assert.equal(byService.has("database-tool"), false);
});

test("COM-SUP-INVENTORY-007: schema rejects duplicate, missing, and misclassified runtime entries", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(schema);
  const duplicate = structuredClone(inventory);
  duplicate.artifacts[0].runtimeClass = "dsaas-control-plane";
  assert.equal(validate(duplicate), false);
  const swapped = structuredClone(inventory);
  [swapped.artifacts[0].runtimeClass, swapped.artifacts[1].runtimeClass] = [swapped.artifacts[1].runtimeClass, swapped.artifacts[0].runtimeClass];
  assert.equal(validate(swapped), false);
  const externalBuild = structuredClone(inventory);
  externalBuild.artifacts.find((entry) => entry.service === "postgres-operand").provenanceMode = "source-build";
  assert.equal(validate(externalBuild), false);
  const eligibleEdc = structuredClone(inventory);
  eligibleEdc.artifacts.find((entry) => entry.service === "edc-control-plane").productionEligible = true;
  assert.equal(validate(eligibleEdc), false);
});
