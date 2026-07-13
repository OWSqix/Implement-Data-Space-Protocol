import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  crsTransformationPolicy,
  parseWktGeometry,
  roundTripError,
  serializeWktGeometry,
  transformGeometry,
} from "../../tools/registries/crs-geometry.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const policy = crsTransformationPolicy();
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const EPSG4326 = "http://www.opengis.net/def/crs/EPSG/0/4326";
const EPSG3857 = "http://www.opengis.net/def/crs/EPSG/0/3857";
const EPSG5179 = "http://www.opengis.net/def/crs/EPSG/0/5179";
const EPSG5186 = "http://www.opengis.net/def/crs/EPSG/0/5186";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("RT-SPATIAL-EVIDENCE-001: transformation definitions are bound to pinned OGC and EPSG bytes", async () => {
  const manifestPath = path.join(root, policy.sourceManifest);
  assert.equal(sha256(await readFile(manifestPath)), policy.sourceManifestSha256);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const byFile = new Map(manifest.artifacts.map((artifact) => [artifact.file, artifact]));
  for (const definition of Object.values(policy.crs)) {
    for (const [file, expected] of Object.entries(definition.evidenceSha256)) {
      assert.equal(byFile.get(file)?.sha256, expected, file);
      assert.equal(
        sha256(await readFile(path.join(path.dirname(manifestPath), file))),
        expected,
        file,
      );
    }
  }
});

test("GEO-LIT-COVERAGE-001: bounded WKT Point, LineString and single-ring Polygon round-trip", () => {
  const sources = [
    `<${CRS84}> POINT(127 37)`,
    `<${CRS84}> LINESTRING(126 36,127 37,128 38)`,
    `<${CRS84}> POLYGON((126 36,128 36,128 38,126 36))`,
  ];
  for (const source of sources) {
    const parsed = parseWktGeometry(source);
    assert.deepEqual(parseWktGeometry(serializeWktGeometry(parsed)), parsed);
  }
});

test("RT-SPATIAL-ACCURACY-001: authority axis order and supported CRS round-trips cover every bounded geometry", () => {
  const geometries = [
    parseWktGeometry(`<${CRS84}> POINT(127 37)`),
    parseWktGeometry(`<${CRS84}> LINESTRING(126.9 36.9,127 37,127.1 37.1)`),
    // BBOX is not a separate RC.1 lexical branch; this case covers the supported Polygon branch.
    parseWktGeometry(`<${CRS84}> POLYGON((126.9 36.9,127.1 36.9,127.1 37.1,126.9 37.1,126.9 36.9))`),
  ];
  const epsg4326 = transformGeometry(geometries[0], EPSG4326);
  assert.ok(Math.abs(epsg4326.coordinates[0] - 37) < 1e-12);
  assert.ok(Math.abs(epsg4326.coordinates[1] - 127) < 1e-12);

  // Reviewed coordinate oracles pin authority order independently of round-trip symmetry.
  // EPSG:5179 and 5186 declare northing before easting in the pinned OGC definitions.
  const authorityOracles = new Map([
    [EPSG3857, [14137575.330745745, 4439106.787250583]],
    [EPSG5179, [1889174.1743467299, 955511.8092851528]],
    [EPSG5186, [489012.9556910066, 200000]],
  ]);
  for (const [target, expected] of authorityOracles) {
    const actual = transformGeometry(geometries[0], target).coordinates;
    assert.ok(Math.abs(actual[0] - expected[0]) <= 1e-6, `${target} first axis`);
    assert.ok(Math.abs(actual[1] - expected[1]) <= 1e-6, `${target} second axis`);
  }

  const line5179 = transformGeometry(geometries[1], EPSG5179).coordinates;
  assert.ok(Math.abs(line5179[0][0] - 1878132.1763580295) <= 1e-6);
  assert.ok(Math.abs(line5179[0][1] - 946544.2538264524) <= 1e-6);
  assert.ok(Math.abs(line5179.at(-1)[0] - 1900225.6108978107) <= 1e-6);
  assert.ok(Math.abs(line5179.at(-1)[1] - 964456.1562994244) <= 1e-6);
  const polygon5186 = transformGeometry(geometries[2], EPSG5186).coordinates[0];
  assert.ok(Math.abs(polygon5186[0][0] - 477919.9551528567) <= 1e-6);
  assert.ok(Math.abs(polygon5186[0][1] - 191087.18844849133) <= 1e-6);
  assert.ok(Math.abs(polygon5186[2][0] - 500115.4930741546) <= 1e-6);
  assert.ok(Math.abs(polygon5186[2][1] - 208889.49811490113) <= 1e-6);
  for (const geometry of geometries) {
    for (const target of [EPSG4326, EPSG3857, EPSG5179, EPSG5186]) {
      const error = roundTripError(geometry, target);
      assert.equal(error.unit, "degree");
      assert.ok(
        error.maximum <= policy.acceptance.geographicRoundTripDegrees,
        `${geometry.type} through ${target}: ${error.maximum}`,
      );
    }
    for (const source of [EPSG5179, EPSG5186]) {
      const projected = transformGeometry(geometry, source);
      const error = roundTripError(projected, CRS84);
      assert.equal(error.unit, "metre");
      assert.ok(
        error.maximum <= policy.acceptance.projectedRoundTripMeters,
        `${geometry.type} from ${source}: ${error.maximum}`,
      );
    }
  }
});

test("GEO-LIT-COVERAGE-002: unsupported dimensions, polygon holes and unknown CRS fail closed", () => {
  assert.throws(() => parseWktGeometry(`<${CRS84}> POINT Z(127 37 10)`));
  assert.throws(() => parseWktGeometry(`<${CRS84}> POLYGON((0 0,1 0,0 0),(0 0,0.1 0,0 0))`));
  assert.throws(() => parseWktGeometry(`<${CRS84}> POLYGON((0 0,1 0,1 1,0 1))`));
  assert.throws(() => parseWktGeometry("<http://example.test/crs> POINT(1 2)"));
});
