import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DataFactory, Parser, Store } from "n3";
import { loadProfileRelease, resolveReleaseArtifact } from "../../src/profile/registry.mjs";
import { buildPublicationContract } from "../../tools/profile/build-publication-representations.mjs";

const { namedNode } = DataFactory;
const release = await loadProfileRelease("1.0.0-rc.1");

async function validator(schemaPath) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

test("PUBLICATION-GOV-001: candidate approval provenance is valid only as an unapproved record", async () => {
  const [validate, candidate] = await Promise.all([
    validator("contracts/institutional-approval-provenance.v1.schema.json"),
    readFile(resolveReleaseArtifact(
      release,
      "publication/institutional-approval-provenance.candidate.json",
    ), "utf8").then(JSON.parse),
  ]);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(candidate.status, "candidate-awaiting-institutional-approval");
  assert.equal(candidate.publicationMode, "external-detached-envelope");
  assert.equal(candidate.authority, null);
  assert.equal(candidate.approval, null);
  assert.equal(candidate.detachedSignature, null);
  assert.equal(candidate.externalTimestamp, null);
  assert.deepEqual(candidate.evidence, []);

  const falseApproval = structuredClone(candidate);
  falseApproval.status = "approved";
  assert.equal(validate(falseApproval), false, "status text alone must not create approval provenance");
});

test("PUBLICATION-GOV-001A: approval is an external envelope, not a locked-file rewrite", async () => {
  const [validate, candidate] = await Promise.all([
    validator("contracts/institutional-approval-provenance.v1.schema.json"),
    readFile(resolveReleaseArtifact(
      release,
      "publication/institutional-approval-provenance.candidate.json",
    ), "utf8").then(JSON.parse),
  ]);
  const approved = structuredClone(candidate);
  approved.status = "approved";
  approved.releaseBinding = {
    artifactLockSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    gitCommit: "c".repeat(40),
  };
  approved.authority = {
    iri: "https://data.molit.go.kr/id/organization/release-authority",
    name: "Institutional release authority",
    approvingRole: "Profile owner",
  };
  approved.approval = {
    decision: "approved",
    recordIri: "https://data.molit.go.kr/approval/molit-dcat-ap/1.0.0-rc.1",
    decidedAt: "2026-07-13T00:00:00Z",
    effectiveAt: "2026-07-13T00:00:00Z",
    scope: ["molit-dcat-ap/1.0.0-rc.1"],
  };
  approved.detachedSignature = {
    envelopeIri: "https://data.molit.go.kr/signature/molit-dcat-ap/1.0.0-rc.1",
    envelopeSha256: "d".repeat(64),
    signerKeyId: `urn:molit:key:ed25519:sha256:${"A".repeat(43)}`,
    trustAnchorIri: "https://data.molit.go.kr/trust/release-signing",
  };
  approved.externalTimestamp = {
    authorityIri: "https://timestamp.example/authority",
    evidenceIri: "https://timestamp.example/evidence/1",
    evidenceSha256: "e".repeat(64),
    timestamp: "2026-07-13T00:00:01Z",
  };
  approved.evidence = [
    "owner-appointment",
    "steward-appointment",
    "change-board-decision",
    "license-approval",
    "namespace-handover",
  ].map((kind, index) => ({
    kind,
    iri: `https://data.molit.go.kr/approval/evidence/${index + 1}`,
    sha256: `${index + 1}`.repeat(64),
  }));
  approved.requiredActions = [];
  assert.equal(validate(approved), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(approved.publicationMode, "external-detached-envelope");
});

test("PUBLICATION-GOV-002: tombstone entries reproduce the retained ontology facts", async () => {
  const [validate, contract, ontologySource] = await Promise.all([
    validator("contracts/tombstone-response-contract.v1.schema.json"),
    readFile(resolveReleaseArtifact(release, "publication/tombstones.json"), "utf8")
      .then(JSON.parse),
    readFile(resolveReleaseArtifact(release, release.manifest.ontology), "utf8"),
  ]);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(contract.namespaceStatus, "proposed-not-yet-dereferenceable");
  assert.equal(contract.deploymentGate, "RA-NAMESPACE");
  assert.equal(contract.entries.length, 2);

  const ontology = new Store(new Parser().parse(ontologySource));
  const deprecated = namedNode("http://www.w3.org/2002/07/owl#deprecated");
  const status = namedNode("http://www.w3.org/ns/adms#status");
  const replacedBy = namedNode("http://purl.org/dc/terms/isReplacedBy");
  const changeNote = namedNode("http://www.w3.org/2004/02/skos/core#changeNote");
  const isDefinedBy = namedNode("http://www.w3.org/2000/01/rdf-schema#isDefinedBy");
  for (const entry of contract.entries) {
    const term = namedNode(entry.termIri);
    assert.ok(ontology.getObjects(term, deprecated, null).some(({ value }) => value === "true"));
    assert.deepEqual(
      ontology.getObjects(term, status, null).map(({ value }) => value),
      ["https://data.molit.go.kr/id/concept/term-status/deprecated"],
    );
    assert.deepEqual(
      ontology.getObjects(term, replacedBy, null).map(({ value }) => value).sort(),
      [...entry.replacementIris].sort(),
    );
    assert.ok(ontology.countQuads(term, changeNote, null, null) > 0);
    assert.equal(
      ontology.countQuads(term, isDefinedBy, namedNode(entry.dereferenceIri), null),
      1,
    );
    assert.equal(entry.httpStatus, 200);
    assert.equal(entry.retention, "indefinite");
  }
});

test("PUBLICATION-GOV-003: publication contract exposes the tombstone contract without claiming deployment", () => {
  const contract = buildPublicationContract(release);
  assert.equal(contract.tombstoneContract, "publication/tombstones.json");
  assert.equal(contract.namespaceStatus, "proposed-not-yet-dereferenceable");
  assert.equal(contract.deploymentGate, "RA-NAMESPACE");
});
