import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { Parser, Store } from "n3";
import {
  networkReferenceKey,
  projectNetworkReferenceRecords,
  validateNetworkReferenceGraph,
  validateNetworkReferenceSet,
  validateStandardNodeLinkExtract,
} from "../../src/profile/network-reference-integrity.mjs";
import { assertRequiredLifecycleCaseIds } from "../../tools/profile/verify-network-reference-policy.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const release = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const policyPath = path.join(release, "policy/network-reference-policy.json");
const evidencePath = path.join(
  release,
  "examples/source-evidence/standard-node-link-2026-07-01.json",
);
const lifecycleCasesPath = path.join(
  release,
  "examples/source-evidence/network-edition-lifecycle-cases.json",
);

function reference(overrides = {}) {
  return {
    networkAuthority: "https://data.molit.go.kr/id/organization/molit",
    networkIdentifier: "MOLIT-STANDARD-NODE-LINK",
    networkVersion: "2026-07-01",
    networkSnapshotChecksum: "219020fac55f2faab1029ec9306563a00968f9b27f3910b80c534583b750b9ab",
    networkLifecycleStatus: "current",
    networkValidFrom: "2026-07-01",
    networkValidUntil: null,
    replacementKey: null,
    ...overrides,
  };
}

test("NETWORK-POLICY-001: candidate policy has a closed schema", async () => {
  const [schema, policy] = await Promise.all([
    load(path.join(root, "contracts/network-reference-policy.v1.schema.json")),
    load(policyPath),
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(policy), true, JSON.stringify(validate.errors));
});

test("NETWORK-SOURCE-001: actual node-link sample fixes grammar, history and coordinate order", async () => {
  const [policy, evidence] = await Promise.all([load(policyPath), load(evidencePath)]);
  assert.deepEqual(validateStandardNodeLinkExtract(evidence, policy), {
    historyReferenceCount: 1,
    linkCount: 1,
    nodeCount: 2,
  });
  const badId = structuredClone(evidence);
  badId.sample.link.fields.LINK_ID = "link-1";
  assert.throws(
    () => validateStandardNodeLinkExtract(badId, policy),
    { code: "NETWORK_LINK_SAMPLE_INVALID" },
  );
  const badAxis = structuredClone(evidence);
  badAxis.coordinateReference.sourceCoordinateOrder.reverse();
  assert.throws(
    () => validateStandardNodeLinkExtract(badAxis, policy),
    { code: "NETWORK_COORDINATE_ORDER_MISMATCH" },
  );
});

test("NETWORK-IDENTITY-001: identical edition keys cannot carry conflicting checksums", async () => {
  const policy = await load(policyPath);
  const first = reference();
  const conflicting = reference({
    networkSnapshotChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.throws(
    () => validateNetworkReferenceSet([first, conflicting], policy),
    { code: "NETWORK_IDENTITY_CHECKSUM_CONFLICT" },
  );
  assert.equal(
    networkReferenceKey(first, policy),
    JSON.stringify([
      first.networkAuthority,
      first.networkIdentifier,
      first.networkVersion,
    ]),
  );
  assert.throws(
    () => validateNetworkReferenceSet([first, structuredClone(first)], policy),
    { code: "NETWORK_IDENTITY_DUPLICATE" },
  );
});

test("NETWORK-LIFECYCLE-001: superseded editions retain a resolvable replacement", async () => {
  const policy = await load(policyPath);
  const successor = reference();
  const predecessorBase = reference({
    networkVersion: "2026-06-01",
    networkSnapshotChecksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    networkLifecycleStatus: "superseded",
    networkValidFrom: "2026-06-01",
    networkValidUntil: "2026-06-30",
  });
  const predecessor = {
    ...predecessorBase,
    replacementKey: networkReferenceKey(successor, policy),
  };
  const report = validateNetworkReferenceSet([predecessor, successor], policy);
  assert.deepEqual({ ...report, sha256: "<sha256>" }, {
    identityCount: 2,
    recordCount: 2,
    sha256: "<sha256>",
    transitionCount: 1,
  });
  assert.match(report.sha256, /^[a-f0-9]{64}$/u);
});

test("NETWORK-LIFECYCLE-002: terminal and overlapping histories fail closed", async () => {
  const policy = await load(policyPath);
  assert.throws(
    () => validateNetworkReferenceSet([
      reference({
        networkLifecycleStatus: "superseded",
        networkValidUntil: "2026-07-31",
      }),
    ], policy),
    { code: "NETWORK_TERMINAL_REPLACEMENT_INVALID" },
  );
  const successor = reference();
  const predecessorBase = reference({
    networkVersion: "2026-06-01",
    networkSnapshotChecksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    networkLifecycleStatus: "superseded",
    networkValidFrom: "2026-06-01",
    networkValidUntil: "2026-07-02",
  });
  assert.throws(
    () => validateNetworkReferenceSet([{
      ...predecessorBase,
      replacementKey: networkReferenceKey(successor, policy),
    }, successor], policy),
    { code: "NETWORK_REPLACEMENT_VALIDITY_OVERLAP" },
  );
  const touchingBase = reference({
    networkVersion: "2026-06-01",
    networkSnapshotChecksum: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    networkLifecycleStatus: "superseded",
    networkValidFrom: "2026-06-01",
    networkValidUntil: "2026-07-01",
  });
  assert.throws(
    () => validateNetworkReferenceSet([{
      ...touchingBase,
      replacementKey: networkReferenceKey(successor, policy),
    }, successor], policy),
    { code: "NETWORK_REPLACEMENT_VALIDITY_OVERLAP" },
  );
  const withdrawn = reference({
    networkLifecycleStatus: "withdrawn",
    networkValidUntil: "2026-07-01",
  });
  assert.equal(validateNetworkReferenceSet([withdrawn], policy).recordCount, 1);
});

test("NETWORK-LIFECYCLE-003: checked-in edition fixtures preserve valid and invalid decisions", async () => {
  const [policy, fixture] = await Promise.all([load(policyPath), load(lifecycleCasesPath)]);
  assert.equal(fixture.schemaVersion, "molit.network-edition-lifecycle-cases/1");
  assert.deepEqual(fixture.cases.map(({ id, expected, records }) => {
    try {
      validateNetworkReferenceSet(records, policy);
      return { id, observed: "valid" };
    } catch (error) {
      return { id, observed: error.code };
    }
  }), fixture.cases.map(({ id, expected }) => ({ id, observed: expected })));
  const ids = fixture.cases.map(({ id }) => id);
  assert.doesNotThrow(() => assertRequiredLifecycleCaseIds(ids));
  assert.throws(
    () => assertRequiredLifecycleCaseIds(ids.filter((id) => (
      id !== "NETWORK-EDITION-SUCCESSOR-IDENTIFIER-MISMATCH"
    ))),
    { code: "NETWORK_LIFECYCLE_CASE_SET_INVALID" },
  );
});

test("NETWORK-RDF-001: RDF successor links project to the lifecycle policy", async () => {
  const policy = await load(policyPath);
  const graph = new Store(new Parser().parse(`
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
    @prefix netlife: <https://data.molit.go.kr/id/concept/network-lifecycle-status/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    <urn:network:2026-06> a molit:NetworkReference ;
      molit:networkAuthority <https://data.molit.go.kr/id/organization/molit> ;
      molit:networkIdentifier "MOLIT-STANDARD-NODE-LINK" ;
      molit:networkVersion "2026-06-01" ;
      molit:networkSnapshotChecksum "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"^^xsd:hexBinary ;
      molit:networkLifecycleStatus netlife:superseded ;
      molit:networkValidFrom "2026-06-01"^^xsd:date ;
      molit:networkValidUntil "2026-06-30"^^xsd:date ;
      dct:isReplacedBy <urn:network:2026-07> .
    <urn:network:2026-07> a molit:NetworkReference ;
      molit:networkAuthority <https://data.molit.go.kr/id/organization/molit> ;
      molit:networkIdentifier "MOLIT-STANDARD-NODE-LINK" ;
      molit:networkVersion "2026-07-01" ;
      molit:networkSnapshotChecksum "219020fac55f2faab1029ec9306563a00968f9b27f3910b80c534583b750b9ab"^^xsd:hexBinary ;
      molit:networkLifecycleStatus netlife:current ;
      molit:networkValidFrom "2026-07-01"^^xsd:date .
  `));
  assert.equal(projectNetworkReferenceRecords(graph, policy).length, 2);
  assert.deepEqual(
    { ...validateNetworkReferenceGraph(graph, policy), sha256: "<sha256>" },
    { identityCount: 2, recordCount: 2, sha256: "<sha256>", transitionCount: 1 },
  );
});

test("NETWORK-RDF-002: RDF identity conflicts and unresolved successors fail closed", async () => {
  const policy = await load(policyPath);
  const conflict = new Store(new Parser().parse(`
    @prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
    @prefix netlife: <https://data.molit.go.kr/id/concept/network-lifecycle-status/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    <urn:network:a> a molit:NetworkReference ;
      molit:networkAuthority <https://data.molit.go.kr/id/organization/molit> ;
      molit:networkIdentifier "MOLIT-STANDARD-NODE-LINK" ;
      molit:networkVersion "2026-07-01" ;
      molit:networkLifecycleStatus netlife:current ;
      molit:networkValidFrom "2026-07-01"^^xsd:date .
    <urn:network:b> a molit:NetworkReference ;
      molit:networkAuthority <https://data.molit.go.kr/id/organization/molit> ;
      molit:networkIdentifier "MOLIT-STANDARD-NODE-LINK" ;
      molit:networkVersion "2026-07-01" ;
      molit:networkLifecycleStatus netlife:current ;
      molit:networkValidFrom "2026-07-01"^^xsd:date .
    <urn:network:a> molit:networkSnapshotChecksum "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"^^xsd:hexBinary .
    <urn:network:b> molit:networkSnapshotChecksum "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"^^xsd:hexBinary .
  `));
  assert.throws(
    () => validateNetworkReferenceGraph(conflict, policy),
    { code: "NETWORK_IDENTITY_CHECKSUM_CONFLICT" },
  );

  const unresolved = new Store(new Parser().parse(`
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
    @prefix netlife: <https://data.molit.go.kr/id/concept/network-lifecycle-status/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    <urn:network:old> a molit:NetworkReference ;
      molit:networkAuthority <https://data.molit.go.kr/id/organization/molit> ;
      molit:networkIdentifier "MOLIT-STANDARD-NODE-LINK" ;
      molit:networkVersion "2026-06-01" ;
      molit:networkSnapshotChecksum "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"^^xsd:hexBinary ;
      molit:networkLifecycleStatus netlife:superseded ;
      molit:networkValidFrom "2026-06-01"^^xsd:date ;
      molit:networkValidUntil "2026-06-30"^^xsd:date ;
      dct:isReplacedBy <urn:network:missing> .
  `));
  assert.throws(
    () => validateNetworkReferenceGraph(unresolved, policy),
    { code: "NETWORK_REPLACEMENT_NOT_FOUND" },
  );
});
