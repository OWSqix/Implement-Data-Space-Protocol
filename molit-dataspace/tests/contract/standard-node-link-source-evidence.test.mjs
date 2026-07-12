import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Parser, Store } from "n3";
import { transformGeometry } from "../../src/profile/crs-geometry.mjs";

const releaseRoot = path.resolve(
  "profiles/molit-dcat-ap/releases/1.0.0-rc.1",
);
const evidencePath = path.join(
  releaseRoot,
  "examples/source-evidence/standard-node-link-2026-07-01.json",
);
const fixturePath = path.join(releaseRoot, "examples/valid/network-catalog.ttl");
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("NODELINK-SOURCE-001: the observed archive identity and rights boundary are explicit", () => {
  assert.equal(evidence.schemaVersion, "molit.standard-node-link-source-evidence/1");
  assert.equal(evidence.source.sourceRecordId, "DF_217");
  assert.equal(evidence.source.sourceFileSequence, "0");
  assert.equal(evidence.source.datasetVersion, "2026-07-01");
  assert.equal(evidence.source.archiveBytes, 257_182_267);
  assert.match(evidence.source.archiveSha256, /^[0-9a-f]{64}$/u);
  assert.equal(evidence.source.reuseStatus, "institutional-redistribution-approval-pending");
  assert.match(evidence.source.copyrightPolicy, /^https:\/\/www[.]its[.]go[.]kr\//u);
  assert.doesNotMatch(JSON.stringify(evidence), /creativecommons|CC BY/iu);
});

test("NODELINK-SOURCE-002: the retained PRJ bytes identify the pinned EPSG:5186 parameters", () => {
  const projection = Buffer.from(evidence.coordinateReference.sourcePrjWkt, "utf8");
  const prj = evidence.archiveComponents.find(({ path: item }) => item === "MOCT_NODE.prj");
  assert.ok(prj);
  assert.equal(projection.length, prj.bytes);
  assert.equal(sha256(projection), prj.sha256);
  assert.equal(
    evidence.coordinateReference.identifiedCrs,
    "http://www.opengis.net/def/crs/EPSG/0/5186",
  );
  for (const parameter of [
    "False_Easting\",200000.0",
    "False_Northing\",600000.0",
    "Central_Meridian\",127.0",
    "Latitude_Of_Origin\",38.0",
  ]) assert.ok(evidence.coordinateReference.sourcePrjWkt.includes(parameter));
});

test("NODELINK-SOURCE-003: the link endpoints, identifier grammar and axis conversion agree", () => {
  const { link, nodes } = evidence.sample;
  assert.match(link.fields.LINK_ID, /^\d{10}$/u);
  assert.deepEqual(
    new Set([link.fields.F_NODE, link.fields.T_NODE]),
    new Set(nodes.map(({ fields }) => fields.NODE_ID)),
  );
  const [first, last] = [
    link.sourceGeometry.coordinates[0],
    link.sourceGeometry.coordinates.at(-1),
  ];
  const byId = new Map(nodes.map((node) => [node.fields.NODE_ID, node]));
  assert.deepEqual(first, Object.values(byId.get(link.fields.F_NODE).sourceCoordinate));
  assert.deepEqual(last, Object.values(byId.get(link.fields.T_NODE).sourceCoordinate));

  for (const node of nodes) {
    assert.match(node.fields.NODE_ID, /^\d{10}$/u);
    const { "east-x": east, "north-y": north } = node.sourceCoordinate;
    const converted = transformGeometry({
      coordinates: [north, east],
      crsIri: "http://www.opengis.net/def/crs/EPSG/0/5186",
      type: "Point",
    }, "http://www.opengis.net/def/crs/EPSG/0/4326");
    assert.equal(converted.coordinates.length, 2);
    assert.ok(Math.abs(converted.coordinates[0] - node.epsg4326AuthorityTuple[0]) < 1e-12);
    assert.ok(Math.abs(converted.coordinates[1] - node.epsg4326AuthorityTuple[1]) < 1e-12);
  }
});

test("NODELINK-SOURCE-004: the RDF fixture uses the observed version and checksum without inventing an open licence", async () => {
  const source = await readFile(fixturePath, "utf8");
  assert.doesNotMatch(source, /creativecommons|planned-availability\/STABLE/iu);
  const store = new Store(new Parser({ format: "text/turtle" }).parse(source));
  const MOLIT = "https://data.molit.go.kr/def/molit-dcat-ap#";
  const checksum = store.getObjects(null, `${MOLIT}networkSnapshotChecksum`, null);
  const version = store.getObjects(null, `${MOLIT}networkVersion`, null);
  assert.deepEqual(checksum.map(({ value }) => value), [evidence.source.archiveSha256]);
  assert.deepEqual(version.map(({ value }) => value), [evidence.source.datasetVersion]);
});

test("NODELINK-SOURCE-005: an operator-supplied archive can be rechecked without entering the release", async (t) => {
  const supplied = process.env.MOLIT_NODELINK_ARCHIVE;
  if (!supplied) {
    t.skip("set MOLIT_NODELINK_ARCHIVE to recheck the restricted source archive");
    return;
  }
  const bytes = await readFile(path.resolve(supplied));
  assert.equal(bytes.length, evidence.source.archiveBytes);
  assert.equal(sha256(bytes), evidence.source.archiveSha256);
});
