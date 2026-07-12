const EXPECTED_CRS_AXIS_SOURCES = Object.freeze([
  Object.freeze({
    id: "OGC-CRS84",
    canonicalIri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    sourceUrl: "https://www.opengis.net/def/crs/OGC/1.3/CRS84",
    identifier: "https://www.opengis.net/def/crs/OGC/1.3/CRS84",
    rootElement: "GeodeticCRS",
    coordinateSystemElement: "ellipsoidalCS",
    mode: "embedded-gml",
    expectedAxisOrder: Object.freeze(["east", "north"]),
  }),
  Object.freeze({
    id: "EPSG-4737",
    canonicalIri: "http://www.opengis.net/def/crs/EPSG/0/4737",
    sourceUrl: "https://www.opengis.net/def/crs/EPSG/0/4737",
    identifier: "4737",
    rootElement: "GeodeticCRS",
    coordinateSystemElement: "ellipsoidalCS",
    coordinateSystemCode: 6422,
    mode: "epsg-coordinate-system",
    expectedAxisOrder: Object.freeze(["north", "east"]),
  }),
  ...[5179, 5185, 5186, 5187, 5188].map((code) => Object.freeze({
    id: `EPSG-${code}`,
    canonicalIri: `http://www.opengis.net/def/crs/EPSG/0/${code}`,
    sourceUrl: `https://www.opengis.net/def/crs/EPSG/0/${code}`,
    identifier: String(code),
    rootElement: "ProjectedCRS",
    coordinateSystemElement: "cartesianCS",
    coordinateSystemCode: 4530,
    mode: "epsg-coordinate-system",
    expectedAxisOrder: Object.freeze(["north", "east"]),
  })),
]);
const APPROVED_COORDINATE_SYSTEM_SOURCES = new Map([
  [4530, "https://apps.epsg.org/api/v1/CoordSystem/4530"],
  [6422, "https://apps.epsg.org/api/v1/CoordSystem/6422"],
]);

function sameArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function coordinateSystemReference(href) {
  for (const [code, sourceUrl] of APPROVED_COORDINATE_SYSTEM_SOURCES) {
    const gmlExportUrl = `https://epsg.org/api/v1/CoordSystem/${code}/export?format=gml`;
    if (href === gmlExportUrl || href === sourceUrl) return { code, sourceUrl };
  }
  return null;
}

function orderedAxes(coordinateSystem) {
  const axes = [...(coordinateSystem?.axes ?? [])].sort((left, right) => (
    left.order - right.order
  ));
  if (axes.length !== 2
    || axes[0].order !== 1
    || axes[1].order !== 2
    || new Set(axes.map(({ order }) => order)).size !== axes.length) {
    throw new Error(`coordinate system ${coordinateSystem?.code} must have ordered 2D axes`);
  }
  return axes;
}

/**
 * Derive the release CRS tuple order from independently pinned authority data.
 *
 * This policy describes tuple order only. It deliberately makes no statement
 * about reprojection, datum transformation, or coordinate accuracy.
 */
export function buildCrsAxisPolicy({
  coordinateSystems,
  definitions,
  manifestSha256,
}) {
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const coordinateSystemByCode = new Map(
    coordinateSystems.map((coordinateSystem) => [coordinateSystem.code, coordinateSystem]),
  );
  if (definitions.length !== EXPECTED_CRS_AXIS_SOURCES.length
    || definitionById.size !== EXPECTED_CRS_AXIS_SOURCES.length) {
    throw new Error("axis policy requires exactly the approved seven CRS definitions");
  }
  if (coordinateSystems.length !== 2
    || coordinateSystemByCode.size !== 2
    || !coordinateSystemByCode.has(4530)
    || !coordinateSystemByCode.has(6422)) {
    throw new Error("axis policy requires EPSG coordinate systems 4530 and 6422");
  }

  const crs = EXPECTED_CRS_AXIS_SOURCES.map((expected) => {
    const definition = definitionById.get(expected.id);
    if (!definition) throw new Error(`missing CRS axis source: ${expected.id}`);
    for (const field of ["canonicalIri", "sourceUrl", "identifier", "rootElement"]) {
      if (definition[field] !== expected[field]) {
        throw new Error(`${expected.id} has an unapproved ${field}`);
      }
    }
    if (definition.coordinateSystemElement !== expected.coordinateSystemElement) {
      throw new Error(
        `${expected.id} must use gml:${expected.coordinateSystemElement}`,
      );
    }

    if (expected.mode === "embedded-gml") {
      if (definition.coordinateSystemHref) {
        throw new Error(`${expected.id} must use its embedded GML coordinate system`);
      }
      const axes = definition.embeddedAxes ?? [];
      const axisOrder = axes.map(({ direction }) => direction);
      if (!sameArray(axisOrder, expected.expectedAxisOrder)) {
        throw new Error(`${expected.id} axis order must be east,north`);
      }
      return {
        axisOrder,
        axisSource: {
          artifactId: definition.id,
          kind: "embedded-gml",
          sha256: definition.sha256,
        },
        axes: axes.map(({ abbreviation, direction, identifier, uom }) => ({
          abbreviation,
          direction,
          identifier,
          uom,
        })),
        id: definition.id,
        iri: definition.canonicalIri,
      };
    }

    const coordinateSystem = coordinateSystemReference(definition.coordinateSystemHref);
    if (coordinateSystem?.code !== expected.coordinateSystemCode) {
      throw new Error(
        `${expected.id} must use the approved EPSG coordinate-system origin and path for ${expected.coordinateSystemCode}`,
      );
    }
    const source = coordinateSystemByCode.get(coordinateSystem.code);
    if (source?.sourceUrl !== coordinateSystem.sourceUrl
      || source.selfLink !== coordinateSystem.sourceUrl
      || source.id !== `EPSG-CS-${coordinateSystem.code}`) {
      throw new Error(
        `${expected.id} coordinate-system reference is not bound to its manifest sourceUrl`,
      );
    }
    const axes = orderedAxes(source);
    const axisOrder = axes.map(({ direction }) => direction);
    if (!sameArray(axisOrder, expected.expectedAxisOrder)) {
      throw new Error(`${expected.id} axis order must be north,east`);
    }
    return {
      axisOrder,
      axisSource: {
        artifactId: source.id,
        code: source.code,
        kind: "epsg-coordinate-system",
        sha256: source.sha256,
      },
      axes: axes.map(({ abbreviation, direction, name, unitCode }) => ({
        abbreviation,
        direction,
        name,
        unitCode,
      })),
      id: definition.id,
      iri: definition.canonicalIri,
    };
  });

  return {
    crs,
    generatedFrom: {
      manifest: "standards/vendor/ogc-crs/2026-07-12/manifest.json",
      manifestSha256,
    },
    schemaVersion: "molit.crs-axis-order-policy/1",
    verificationScope: {
      coordinateTransformationAccuracy: "not-evaluated",
      coordinateTupleOrder: "authority-snapshot-derived",
      tupleRoundTrip: {
        coordinateTransformation: "not-performed",
        dimensions: [2],
        geometryTypes: ["Point"],
        serializations: ["GeoSPARQL-WKT", "GML-3.2"],
        status: "lexical-serialization-only",
      },
    },
  };
}

export function encodeCrsAxisPolicy(policy) {
  return `${JSON.stringify(policy, null, 2)}\n`;
}

export const expectedCrsAxisSources = EXPECTED_CRS_AXIS_SOURCES;
