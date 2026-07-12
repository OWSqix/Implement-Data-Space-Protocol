import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { assertCanonicalGraphEquivalence } from "../../src/profile/rdf-loader.mjs";
import { loadProfileRelease, resolveReleaseArtifact } from "../../src/profile/registry.mjs";
import { buildPublicationArtifacts } from "../../tools/profile/build-publication-representations.mjs";

const release = await loadProfileRelease("1.0.0-rc.1");

test("PUBLICATION-REP-001: generated HTML, JSON-LD and deployment contract are byte-current", async () => {
  const result = await buildPublicationArtifacts({ check: true, version: release.version });
  assert.equal(result.checked, true);
  assert.deepEqual(result.outputs, [
    "index.html",
    "ontology.html",
    "publication/content-negotiation.json",
    "serializations/molit-dcat-ap.jsonld",
    "serializations/profile-description.jsonld",
  ]);
  for (const key of ["profileHtml", "ontologyHtml"]) {
    const html = await readFile(resolveReleaseArtifact(
      release,
      release.manifest.representationArtifacts[key],
    ), "utf8");
    assert.match(html, /^<!doctype html>/u);
    assert.match(html, /<meta charset="utf-8">/u);
    assert.doesNotMatch(html, /<script|javascript:/iu);
  }
});

test("PUBLICATION-REP-002: content-negotiation contract is strict and remains deployment-gated", async () => {
  const [schema, contract] = await Promise.all([
    readFile("contracts/content-negotiation-contract.v1.schema.json", "utf8").then(JSON.parse),
    readFile(resolveReleaseArtifact(release, release.manifest.publicationContract), "utf8")
      .then(JSON.parse),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors));
  assert.equal(contract.deploymentGate, "RA-NAMESPACE");
  assert.equal(contract.namespaceStatus, "proposed-not-yet-dereferenceable");
});

test("PUBLICATION-REP-003: Turtle and JSON-LD carry exactly the same RDF datasets", async () => {
  const limits = release.manifest.limits;
  for (const [turtleKey, jsonLdKey] of [
    ["profileTurtle", "profileJsonLd"],
    ["ontologyTurtle", "ontologyJsonLd"],
  ]) {
    const turtlePath = release.manifest.representationArtifacts[turtleKey];
    const jsonLdPath = release.manifest.representationArtifacts[jsonLdKey];
    const evidence = await assertCanonicalGraphEquivalence([
      {
        bytes: await readFile(resolveReleaseArtifact(release, turtlePath)),
        format: "text/turtle",
        sourceLabel: turtlePath,
      },
      {
        bytes: await readFile(resolveReleaseArtifact(release, jsonLdPath)),
        format: "application/ld+json",
        sourceLabel: jsonLdPath,
      },
    ], limits);
    assert.equal(evidence.documents.length, 2);
    assert.match(evidence.sha256, /^[0-9a-f]{64}$/u);
  }
});
