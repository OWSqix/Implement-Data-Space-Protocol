import { readFileSync } from "node:fs";
import proj4 from "proj4";

const policyUrl = new URL("../../standards/generated/crs-transformation-policy.v1.json", import.meta.url);
const policy = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(policyUrl)));
const NUMBER_SOURCE = "[+-]?(?:\\d+(?:[.]\\d*)?|[.]\\d+)(?:[eE][+-]?\\d+)?";
const NUMBER = new RegExp(`^${NUMBER_SOURCE}$`, "u");
const HEADER = /^<([^<>\s]+)>\s+(POINT|LINESTRING|POLYGON)\s*(.+)$/iu;
const MAX_BYTES = 65_536;
const MAX_COORDINATES = 10_000;

function fail(message) { throw new Error(message); }
function bounded(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > MAX_BYTES) {
    fail("WKT geometry exceeds the supported lexical boundary");
  }
  return source.trim();
}
function coordinate(text) {
  const fields = text.trim().split(/\s+/u);
  if (fields.length !== 2 || fields.some((field) => !NUMBER.test(field))) {
    fail("only finite two-dimensional coordinate tuples are supported");
  }
  const tuple = fields.map(Number);
  if (tuple.some((value) => !Number.isFinite(value))) fail("coordinate must be finite");
  return tuple;
}
function coordinateList(text, minimum) {
  const values = text.split(",").map(coordinate);
  if (values.length < minimum || values.length > MAX_COORDINATES) {
    fail("geometry coordinate count is outside the supported boundary");
  }
  return values;
}
function sameTuple(left, right) {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}
function assertKnownCrs(crsIri) {
  const definition = policy.crs?.[crsIri];
  if (!definition) fail(`unsupported CRS IRI: ${crsIri}`);
  return definition;
}
function assertGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") fail("geometry object is required");
  assertKnownCrs(geometry.crsIri);
  const lists = geometry.type === "Point" ? [[geometry.coordinates]]
    : geometry.type === "LineString" ? [geometry.coordinates]
      : geometry.type === "Polygon" ? geometry.coordinates : null;
  if (!lists || !Array.isArray(lists)) fail("unsupported geometry type");
  const flattened = lists.flat();
  if (flattened.length === 0 || flattened.length > MAX_COORDINATES) fail("invalid geometry size");
  for (const tuple of flattened) coordinate(tuple.map(String).join(" "));
  if (geometry.type === "LineString" && geometry.coordinates.length < 2) fail("LineString requires two positions");
  if (geometry.type === "Polygon") {
    if (geometry.coordinates.length !== 1) fail("candidate profile supports one Polygon exterior ring and no holes");
    const ring = geometry.coordinates[0];
    if (ring.length < 4 || !sameTuple(ring[0], ring.at(-1))) fail("Polygon exterior ring must be closed");
  }
  return geometry;
}

export function crsTransformationPolicy() { return structuredClone(policy); }

export function parseWktGeometry(source) {
  const match = bounded(source).match(HEADER);
  if (!match) fail("WKT must start with an approved explicit CRS IRI and supported geometry type");
  const crsIri = match[1];
  assertKnownCrs(crsIri);
  const type = match[2].toUpperCase();
  const body = match[3].trim();
  let geometry;
  if (type === "POINT") {
    const point = body.match(/^[(]([^(),]+)[)]$/u);
    if (!point) fail("unsupported Point lexical form");
    geometry = { crsIri, type: "Point", coordinates: coordinate(point[1]) };
  } else if (type === "LINESTRING") {
    const line = body.match(/^[(]([^()]+)[)]$/u);
    if (!line) fail("unsupported LineString lexical form");
    geometry = { crsIri, type: "LineString", coordinates: coordinateList(line[1], 2) };
  } else {
    const polygon = body.match(/^[(][(]([^()]+)[)][)]$/u);
    if (!polygon) fail("candidate profile supports one Polygon exterior ring and no holes");
    geometry = { crsIri, type: "Polygon", coordinates: [coordinateList(polygon[1], 4)] };
  }
  return assertGeometry(geometry);
}

function number(value) { return Object.is(value, -0) ? "-0" : String(value); }
function tuple(value) { return value.map(number).join(" "); }
export function serializeWktGeometry(geometry) {
  assertGeometry(geometry);
  const prefix = `<${geometry.crsIri}> `;
  if (geometry.type === "Point") return `${prefix}POINT(${tuple(geometry.coordinates)})`;
  if (geometry.type === "LineString") {
    return `${prefix}LINESTRING(${geometry.coordinates.map(tuple).join(",")})`;
  }
  return `${prefix}POLYGON((${geometry.coordinates[0].map(tuple).join(",")}))`;
}

function authorityToEastNorth(tupleValue, definition) {
  const byDirection = Object.fromEntries(definition.axisOrder.map((direction, index) => [direction, tupleValue[index]]));
  if (!Number.isFinite(byDirection.east) || !Number.isFinite(byDirection.north)) fail("CRS axis policy is incomplete");
  return [byDirection.east, byDirection.north];
}
function eastNorthToAuthority(value, definition) {
  const byDirection = { east: value[0], north: value[1] };
  return definition.axisOrder.map((direction) => byDirection[direction]);
}
function mapCoordinates(geometry, transform) {
  if (geometry.type === "Point") return transform(geometry.coordinates);
  if (geometry.type === "LineString") return geometry.coordinates.map(transform);
  return geometry.coordinates.map((ring) => ring.map(transform));
}
export function transformGeometry(geometry, targetCrsIri) {
  assertGeometry(geometry);
  const source = assertKnownCrs(geometry.crsIri);
  const target = assertKnownCrs(targetCrsIri);
  const coordinates = mapCoordinates(geometry, (value) => {
    const eastNorth = authorityToEastNorth(value, source);
    const transformed = proj4(source.proj4, target.proj4, eastNorth);
    if (!Array.isArray(transformed) || transformed.some((item) => !Number.isFinite(item))) {
      fail("coordinate transformation produced a non-finite value");
    }
    return eastNorthToAuthority(transformed, target);
  });
  return assertGeometry({ crsIri: targetCrsIri, type: geometry.type, coordinates });
}

function coordinateVectors(geometry) {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  return geometry.coordinates.flat();
}
export function roundTripError(geometry, throughCrsIri) {
  const returned = transformGeometry(transformGeometry(geometry, throughCrsIri), geometry.crsIri);
  const before = coordinateVectors(geometry);
  const after = coordinateVectors(returned);
  const errors = before.map((value, index) => Math.hypot(value[0] - after[index][0], value[1] - after[index][1]));
  const source = assertKnownCrs(geometry.crsIri);
  const geographic = source.proj4.includes("+proj=longlat");
  return { maximum: Math.max(...errors), unit: geographic ? "degree" : "metre", returned };
}
