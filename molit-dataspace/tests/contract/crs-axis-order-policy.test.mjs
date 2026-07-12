import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCrsAxisPolicy,
  encodeCrsAxisPolicy,
} from "../../tools/registries/crs-axis-policy.mjs";
import {
  parseGmlPoint,
  parseWktPoint,
  serializeGmlPoint,
  serializeWktPoint,
  tupleForAxisOrder,
} from "../../tools/registries/crs-coordinate-tuple.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const verification = spawnSync(
  process.execPath,
  ["tools/registries/verify-crs-snapshots.mjs"],
  { cwd: root, encoding: "utf8", timeout: 10_000 },
);
assert.equal(verification.status, 0, `${verification.stdout}\n${verification.stderr}`);
const report = JSON.parse(verification.stdout);

test("RT-SPATIAL-AXIS-001: pinned authority evidence generates the exact CRS axis policy", async () => {
  const committed = await readFile(
    path.join(root, "standards/generated/crs-axis-order-policy.v1.json"),
    "utf8",
  );
  assert.equal(committed, encodeCrsAxisPolicy(report.axisPolicy));
  assert.deepEqual(
    Object.fromEntries(report.axisPolicy.crs.map(({ id, axisOrder }) => [id, axisOrder])),
    {
      "OGC-CRS84": ["east", "north"],
      "EPSG-4737": ["north", "east"],
      "EPSG-5179": ["north", "east"],
      "EPSG-5185": ["north", "east"],
      "EPSG-5186": ["north", "east"],
      "EPSG-5187": ["north", "east"],
      "EPSG-5188": ["north", "east"],
    },
  );
  assert.equal(report.coordinateSystems.length, 2);
  assert.deepEqual(
    report.coordinateSystems.map(({ code }) => code).sort((left, right) => left - right),
    [4530, 6422],
  );
  assert.equal(
    report.axisPolicy.verificationScope.coordinateTransformationAccuracy,
    "not-evaluated",
  );
  assert.equal(
    report.axisPolicy.verificationScope.tupleRoundTrip.coordinateTransformation,
    "not-performed",
  );
});

test("RT-SPATIAL-AXIS-002: reversed embedded and EPSG coordinate-system axes fail closed", () => {
  const reversedEpsg = structuredClone(report.coordinateSystems);
  const projected = reversedEpsg.find(({ code }) => code === 4530);
  projected.axes = projected.axes.toReversed().map((axis, index) => ({
    ...axis,
    order: index + 1,
  }));
  assert.throws(
    () => buildCrsAxisPolicy({
      coordinateSystems: reversedEpsg,
      definitions: report.definitions,
      manifestSha256: report.manifestSha256,
    }),
    /axis order must be north,east/u,
  );

  const reversedCrs84 = structuredClone(report.definitions);
  const crs84 = reversedCrs84.find(({ id }) => id === "OGC-CRS84");
  crs84.embeddedAxes.reverse();
  assert.throws(
    () => buildCrsAxisPolicy({
      coordinateSystems: report.coordinateSystems,
      definitions: reversedCrs84,
      manifestSha256: report.manifestSha256,
    }),
    /axis order must be east,north/u,
  );

  const swappedAuthority = structuredClone(report.definitions);
  const first = swappedAuthority.find(({ id }) => id === "OGC-CRS84");
  const second = swappedAuthority.find(({ id }) => id === "EPSG-4737");
  [first.canonicalIri, second.canonicalIri] = [second.canonicalIri, first.canonicalIri];
  assert.throws(
    () => buildCrsAxisPolicy({
      coordinateSystems: report.coordinateSystems,
      definitions: swappedAuthority,
      manifestSha256: report.manifestSha256,
    }),
    /unapproved canonicalIri/u,
  );
});

test("RT-SPATIAL-AXIS-003: coordinate-system references bind exact EPSG origins and paths", () => {
  const unapprovedHrefs = [
    "https://evil.example/api/v1/CoordSystem/4530/export?format=gml",
    "https://epsg.org.evil/api/v1/CoordSystem/4530/export?format=gml",
    "http://epsg.org/api/v1/CoordSystem/4530/export?format=gml",
    "https://epsg.org/api/v1/CoordSystem/4530/export?format=gml&extra=1",
    "https://epsg.org/api/v1/CoordSystem/4530.extra/export?format=gml",
    "https://apps.epsg.org/api/v1/CoordSystem/4530/",
    "https://apps.epsg.org/api/v1/CoordSystem/4530?format=json",
    "https://apps.epsg.org/api/v1/CoordSystem/6422",
  ];
  for (const href of unapprovedHrefs) {
    const definitions = structuredClone(report.definitions);
    definitions.find(({ id }) => id === "EPSG-5179").coordinateSystemHref = href;
    assert.throws(
      () => buildCrsAxisPolicy({
        coordinateSystems: report.coordinateSystems,
        definitions,
        manifestSha256: report.manifestSha256,
      }),
      /approved EPSG coordinate-system origin and path/u,
      href,
    );
  }

  const unapprovedManifestSources = [
    "https://evil.example/api/v1/CoordSystem/4530",
    "https://apps.epsg.org.evil/api/v1/CoordSystem/4530",
    "http://apps.epsg.org/api/v1/CoordSystem/4530",
    "https://apps.epsg.org/api/v1/CoordSystem/4530/",
    "https://apps.epsg.org/api/v1/CoordSystem/4530?format=json",
    "https://apps.epsg.org/api/v1/CoordSystem/6422",
  ];
  for (const sourceUrl of unapprovedManifestSources) {
    const coordinateSystems = structuredClone(report.coordinateSystems);
    const coordinateSystem = coordinateSystems.find(({ code }) => code === 4530);
    coordinateSystem.sourceUrl = sourceUrl;
    coordinateSystem.selfLink = sourceUrl;
    assert.throws(
      () => buildCrsAxisPolicy({
        coordinateSystems,
        definitions: report.definitions,
        manifestSha256: report.manifestSha256,
      }),
      /not bound to its manifest sourceUrl/u,
      sourceUrl,
    );
  }

  const canonicalApiReferences = structuredClone(report.definitions);
  canonicalApiReferences.find(({ id }) => id === "EPSG-4737").coordinateSystemHref = (
    "https://apps.epsg.org/api/v1/CoordSystem/6422"
  );
  canonicalApiReferences.find(({ id }) => id === "EPSG-5179").coordinateSystemHref = (
    "https://apps.epsg.org/api/v1/CoordSystem/4530"
  );
  assert.doesNotThrow(() => buildCrsAxisPolicy({
    coordinateSystems: report.coordinateSystems,
    definitions: canonicalApiReferences,
    manifestSha256: report.manifestSha256,
  }));
});

test("GEO-LIT-001: 2D WKT and GML Point codecs preserve authority-ordered tuples", () => {
  for (const crs of report.axisPolicy.crs) {
    const geographic = crs.id === "OGC-CRS84" || crs.id === "EPSG-4737";
    const coordinateByDirection = geographic
      ? { east: 127.123456, north: 37.987654 }
      : { east: 953_421.25, north: 1_953_210.75 };
    const tuple = tupleForAxisOrder(crs.axisOrder, coordinateByDirection);
    const expected = { crsIri: crs.iri, tuple };
    assert.deepEqual(parseWktPoint(serializeWktPoint(expected)), expected, crs.id);
    assert.deepEqual(parseGmlPoint(serializeGmlPoint(expected)), expected, crs.id);
  }
});

test("GEO-LIT-002: tuple codecs reject 3D, non-finite, and active-XML inputs", () => {
  const crsIri = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
  assert.throws(() => serializeWktPoint({ crsIri, tuple: [127, 37, 10] }));
  assert.throws(() => serializeGmlPoint({ crsIri, tuple: [Number.NaN, 37] }));
  assert.throws(() => parseGmlPoint([
    '<!DOCTYPE gml:Point [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
    `<gml:Point xmlns:gml="http://www.opengis.net/gml/3.2" srsName="${crsIri}" `,
    'srsDimension="2"><gml:pos>&xxe;</gml:pos></gml:Point>',
  ].join("")));
});
