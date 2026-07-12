import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildVocabularyRegistry } from "../../tools/profile/build-vocabulary-registry.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(
  root,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const registry = JSON.parse(await readFile(
  path.join(releaseRoot, "vocabulary/registry-metadata.json"),
  "utf8",
));
const schema = JSON.parse(await readFile(
  path.join(root, "contracts/controlled-vocabulary-registry.v1.schema.json"),
  "utf8",
));

test("VOCAB-REG-001: every projected code has explicit lifecycle metadata", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(registry), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(new Set(registry.entries.map(({ iri }) => iri)).size, registry.entries.length);
  const registryIris = new Set(registry.registries.map(({ iri }) => iri));
  for (const entry of registry.entries) {
    assert.ok(registryIris.has(entry.scheme), `unregistered scheme: ${entry.scheme}`);
    assert.ok(entry.notation);
    assert.ok(entry.preferredLabel.length > 0);
    assert.ok(entry.status);
    assert.match(entry.validFrom, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(Object.hasOwn(entry, "validTo"));
    assert.ok(entry.source.authorities.length > 0);
    assert.ok(Object.hasOwn(entry, "replacedBy"));
  }
});

test("VOCAB-REG-002: the registry covers each P0 domestic profile category", () => {
  const requiredCategories = [
    "coordinate-reference-system",
    "dataspace-offering-readiness",
    "domestic-identifiers-and-licences",
    "molit-domain",
    "network-edition",
    "network-element-type",
    "quality-semantics",
    "quality-status-and-metric",
    "qudt-measurement-unit",
    "transport-measurement-unit",
    "transport-observation",
  ];
  for (const category of requiredCategories) {
    assert.ok(registry.categoryCounts[category] > 0, category);
  }
  assert.ok(registry.registries.some(({ iri }) => iri.endsWith("/organization")));
  assert.ok(registry.registries.some(({ iri }) => iri.endsWith("/administrative-area")));
  assert.ok(registry.registries.some(({ iri }) => iri.endsWith("/legal-resource")));
  assert.ok(registry.registries.some(({ iri }) => iri.endsWith("/kogl-license")));
});

test("VOCAB-REG-003: checked-in JSON is the exact deterministic RDF projection", async () => {
  assert.deepEqual(await buildVocabularyRegistry("1.0.0-rc.1"), registry);
});
