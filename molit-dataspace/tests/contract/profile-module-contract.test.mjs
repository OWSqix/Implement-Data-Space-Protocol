import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DataFactory, Parser, Store } from "n3";
import {
  loadProfileRelease,
  resolveReleaseArtifact,
} from "../../src/profile/registry.mjs";

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const DCT_HAS_VERSION = namedNode("http://purl.org/dc/terms/hasVersion");
const DCT_IS_VERSION_OF = namedNode("http://purl.org/dc/terms/isVersionOf");
const PROF_PROFILE = namedNode("http://www.w3.org/ns/dx/prof/Profile");
const PROF_RESOURCE_DESCRIPTOR = namedNode("http://www.w3.org/ns/dx/prof/ResourceDescriptor");
const PROF_HAS_RESOURCE = namedNode("http://www.w3.org/ns/dx/prof/hasResource");
const PROF_HAS_ARTIFACT = namedNode("http://www.w3.org/ns/dx/prof/hasArtifact");
const release = await loadProfileRelease("1.0.0-rc.1");
const description = new Store(new Parser().parse(await readFile(
  resolveReleaseArtifact(release, release.manifest.profileDescription),
  "utf8",
)));
const cases = JSON.parse(await readFile(
  resolveReleaseArtifact(release, release.manifest.conformanceCases),
  "utf8",
));

function publishedProfiles(manifest = release.manifest) {
  return Object.entries(manifest.profiles).filter(([, profile]) => (
    profile.kind !== "diagnostic"
  ));
}

function stableProfileIri(name) {
  return name === "core"
    ? release.manifest.profileIri
    : `${release.manifest.profileIri}/${name}`;
}

function assertProfileDescriptionContract(store) {
  for (const [name, profile] of publishedProfiles()) {
    const versionIri = namedNode(profile.conformanceIri);
    const stableIri = namedNode(stableProfileIri(name));
    const descriptor = namedNode(
      `${release.manifest.versionIri}/resource/${profile.bundle}-shacl`,
    );
    const artifact = namedNode(
      `https://data.molit.go.kr/shape/molit-dcat-ap/${release.version}/${profile.bundle}.ttl`,
    );
    assert.equal(store.countQuads(versionIri, RDF_TYPE, PROF_PROFILE, null), 1, name);
    assert.equal(store.countQuads(stableIri, RDF_TYPE, PROF_PROFILE, null), 1, name);
    assert.equal(store.countQuads(stableIri, DCT_HAS_VERSION, versionIri, null), 1, name);
    assert.equal(store.countQuads(versionIri, DCT_IS_VERSION_OF, stableIri, null), 1, name);
    assert.equal(store.countQuads(versionIri, PROF_HAS_RESOURCE, descriptor, null), 1, name);
    assert.equal(store.countQuads(descriptor, RDF_TYPE, PROF_RESOURCE_DESCRIPTOR, null), 1, name);
    assert.equal(store.countQuads(descriptor, PROF_HAS_ARTIFACT, artifact, null), 1, name);
  }
}

test("PROFILE-MODULE-001: seven published profiles have unique identities, bundles and examples", async () => {
  const profiles = publishedProfiles();
  assert.deepEqual(profiles.map(([name]) => name).sort(), [
    "core",
    "dataspace-offering",
    "geo",
    "network",
    "observation",
    "publication-policy",
    "quality",
  ]);
  assert.equal(new Set(profiles.map(([, profile]) => profile.conformanceIri)).size, 7);
  assert.equal(new Set(profiles.map(([, profile]) => profile.bundle)).size, 7);
  assert.equal(new Set(profiles.map(([, profile]) => (
    release.manifest.publishedBundles[profile.bundle]
  ))).size, 7);
  assert.equal(new Set(profiles.map(([, profile]) => profile.example)).size, 7);

  for (const [name, profile] of profiles) {
    assert.equal((await stat(resolveReleaseArtifact(release, profile.example))).isFile(), true, name);
    const matching = cases.fixtureCases.filter((item) => (
      item.path === profile.example
        && item.expectedOutcome === "conforms"
        && item.conformanceClass.includes(name)
    ));
    assert.ok(matching.length > 0, `${name}: positive example is not registered`);
  }

  const evidencePointers = {
    approvalProvenance: "publication/institutional-approval-provenance.candidate.json",
    domesticStandardsAlignment: "mappings/domestic-standards-alignment.md",
    domesticStandardsCrosswalk: "mappings/domestic-standards-crosswalk.csv",
    localNormativeClauses: "requirements/local-normative-clauses.json",
    networkEditionLifecycleCases: "examples/source-evidence/network-edition-lifecycle-cases.json",
    networkReferencePolicy: "policy/network-reference-policy.json",
    ontologyTermGovernance: "ontology/term-governance.json",
    tombstoneRegistry: "publication/tombstones.json",
    upstreamRequirementsRegistry: "requirements/upstream-requirement-inventory.json",
    upstreamRequirementsCsv: "requirements/upstream-profile-requirements.csv",
  };
  for (const [key, expected] of Object.entries(evidencePointers)) {
    assert.equal(release.manifest[key], expected, key);
    assert.equal((await stat(resolveReleaseArtifact(release, expected))).isFile(), true, key);
  }
});

test("PROFILE-MODULE-002: PROF lineage and SHACL descriptors agree with the manifest", () => {
  assertProfileDescriptionContract(description);
});

test("PROFILE-MODULE-003: a missing or substituted descriptor fails the PROF contract", () => {
  const missing = new Store(description);
  const publication = release.manifest.profiles["publication-policy"];
  const descriptor = namedNode(
    `${release.manifest.versionIri}/resource/${publication.bundle}-shacl`,
  );
  missing.removeQuads(missing.getQuads(descriptor, PROF_HAS_ARTIFACT, null, null));
  assert.throws(() => assertProfileDescriptionContract(missing));

  const substituted = new Store(description);
  const qualityIri = namedNode(release.manifest.profiles.quality.conformanceIri);
  substituted.removeQuads(substituted.getQuads(qualityIri, PROF_HAS_RESOURCE, null, null));
  substituted.addQuad(qualityIri, PROF_HAS_RESOURCE, descriptor);
  assert.throws(() => assertProfileDescriptionContract(substituted));
});
