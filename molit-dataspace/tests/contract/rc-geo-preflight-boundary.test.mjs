import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { parseGmlPoint } from "../../src/profile/crs-coordinate-tuple.mjs";
import { parseWktGeometry } from "../../src/profile/crs-geometry.mjs";
import { scanPublicGraph } from "../../src/profile/rdf-loader.mjs";
import { parsePublicValuePolicy } from "../../src/profile/public-value-policy.mjs";

const { namedNode } = DataFactory;
const releaseRoot = path.resolve("profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const manifest = JSON.parse(await readFile(path.join(releaseRoot, "manifest.json"), "utf8"));
const publicValuePolicy = parsePublicValuePolicy(await readFile(
  path.join(releaseRoot, manifest.publicValuePolicy),
));
const parser = () => new Parser({ format: "text/turtle" });
const parseStore = (source) => new Store(parser().parse(source));

test("GEO-RC-GML-001: the conforming GML Point states the parser-required dimension", async () => {
  const source = await readFile(
    path.join(releaseRoot, "examples/valid/geo-catalog.ttl"),
    "utf8",
  );
  const store = parseStore(source);
  const values = store.getObjects(
    null,
    namedNode("http://www.opengis.net/ont/geosparql#asGML"),
    null,
  );
  assert.equal(values.length, 1);
  assert.deepEqual(parseGmlPoint(values[0].value), {
    crsIri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    tuple: [128, 36],
  });
  assert.match(values[0].value, /srsDimension="2"/u);
});

test("GEO-RC-BOUNDARY-001: parser-only Polygon closure is not reported as 3-engine SHACL parity", async () => {
  const source = await readFile(
    path.join(releaseRoot, "examples/valid/geo-catalog.ttl"),
    "utf8",
  );
  const malformedWkt = [
    "<http://www.opengis.net/def/crs/OGC/1.3/CRS84> ",
    "POLYGON((124 33,132 33,132 39,124 39,125 34))",
  ].join("");
  const candidateSource = source.replaceAll(
    "<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POLYGON((124 33,132 33,132 39,124 39,124 33))",
    malformedWkt,
  );
  assert.throws(() => parseWktGeometry(malformedWkt), /must be closed/u);

  const candidate = parseStore(candidateSource);
  const preflight = scanPublicGraph(
    candidate,
    manifest.limits,
    manifest.limits.maxValidationResults,
    publicValuePolicy,
  );
  assert.ok(preflight.findings.some(({ requirementId }) => (
    requirementId === "MOLIT-GEO-ENCODING-001"
      || requirementId === "MOLIT-GEO-ENCODING-003"
  )));

  const data = new Store(candidate.getQuads(null, null, null, null));
  data.addQuads(parseStore(await readFile(
    path.join(releaseRoot, "bundles/support.ttl"),
    "utf8",
  )).getQuads(null, null, null, null));
  const shapes = parseStore(await readFile(
    path.join(releaseRoot, "bundles/geo.ttl"),
    "utf8",
  ));
  const shacl = await new SHACLValidator(shapes).validate(data);
  assert.equal(shacl.conforms, true, JSON.stringify(shacl.results));
});
