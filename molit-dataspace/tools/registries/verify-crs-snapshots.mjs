#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";
import {
  buildCrsAxisPolicy,
  encodeCrsAxisPolicy,
} from "./crs-axis-policy.mjs";
import {
  atomicWriteChecked,
  isStrictRfc3339,
  readCheckedFile,
} from "./safe-local-file.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const manifestPath = path.join(
  root,
  "standards/vendor/ogc-crs/2026-07-12/manifest.json",
);
const policyPath = path.join(
  root,
  "standards/generated/crs-axis-order-policy.v1.json",
);
const GML = "http://www.opengis.net/gml/3.2";
const XLINK = "http://www.w3.org/1999/xlink";
const EPSG = "urn:x-ogp:spec:schema-xsd:EPSG:2.3:dataset";
const LEGACY_EPSG = "urn:x-ogp:spec:schema-xsd:EPSG:0.11:dataset";
const EXPECTED_IDS = new Set([
  "OGC-CRS84",
  "EPSG-4737",
  "EPSG-5179",
  "EPSG-5185",
  "EPSG-5186",
  "EPSG-5187",
  "EPSG-5188",
]);
const EXPECTED_COORDINATE_SYSTEMS = new Map([
  [4530, {
    id: "EPSG-CS-4530",
    sourceUrl: "https://apps.epsg.org/api/v1/CoordSystem/4530",
    type: "Cartesian",
  }],
  [6422, {
    id: "EPSG-CS-6422",
    sourceUrl: "https://apps.epsg.org/api/v1/CoordSystem/6422",
    type: "ellipsoidal",
  }],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePath(relativePath) {
  const prefix = "standards/vendor/ogc-crs/2026-07-12/";
  if (!relativePath.startsWith(prefix)
    || relativePath.includes("\\")
    || relativePath.includes("..")) {
    throw new Error(`unsafe CRS snapshot path: ${relativePath}`);
  }
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`CRS snapshot escapes project root: ${relativePath}`);
  }
  return resolved;
}

function decodeXml(bytes, encoding) {
  if (encoding !== "ISO-8859-1" && encoding !== "UTF-8") {
    throw new Error(`unsupported CRS XML encoding: ${encoding}`);
  }
  const label = encoding === "ISO-8859-1" ? "iso-8859-1" : "utf-8";
  return new TextDecoder(label, { fatal: true }).decode(bytes);
}

function inspectDefinition(source) {
  if (source.length > 64 * 1024) throw new Error("CRS XML size limit exceeded");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) {
    throw new Error("CRS XML must not contain DTD or entity declarations");
  }
  const stack = [];
  let rootElement;
  let identifier;
  let name;
  let coordinateSystemElement;
  let coordinateSystemHref;
  let activeAxis;
  const embeddedAxes = [];
  const deprecations = [];
  let text = "";
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new Error("CRS XML DOCTYPE is prohibited"); });
  parser.on("processinginstruction", ({ target }) => {
    if (target.toLowerCase() !== "xml") {
      throw new Error(`CRS XML processing instruction is prohibited: ${target}`);
    }
  });
  parser.on("opentag", (tag) => {
    if (stack.length >= 64) throw new Error("CRS XML depth limit exceeded");
    if (Object.keys(tag.attributes).length > 64) {
      throw new Error("CRS XML attribute limit exceeded");
    }
    if (stack.length === 0) {
      if (tag.uri !== GML) throw new Error(`unexpected CRS root namespace: ${tag.uri}`);
      rootElement = tag.local;
    }
    if (stack.length === 1
      && tag.uri === GML
      && (tag.local === "cartesianCS" || tag.local === "ellipsoidalCS")) {
      coordinateSystemElement = tag.local;
      coordinateSystemHref = Object.values(tag.attributes).find((attribute) => (
        attribute.uri === XLINK && attribute.local === "href"
      ))?.value;
    }
    if (tag.uri === GML && tag.local === "CoordinateSystemAxis") {
      if (activeAxis) throw new Error("nested CRS coordinate axes are prohibited");
      activeAxis = {
        uom: Object.values(tag.attributes).find((attribute) => (
          attribute.uri === "" && attribute.local === "uom"
        ))?.value,
      };
    }
    stack.push({ local: tag.local, uri: tag.uri });
    text = "";
  });
  parser.on("text", (value) => { text += value; });
  parser.on("closetag", () => {
    const current = stack.at(-1);
    const parent = stack.at(-2);
    const value = text.trim();
    if (stack.length === 2 && parent?.uri === GML && current?.uri === GML) {
      if (current.local === "identifier") identifier = value;
      if (current.local === "name") name = value;
    }
    if ((current?.uri === EPSG || current?.uri === LEGACY_EPSG)
      && current.local === "isDeprecated") {
      deprecations.push(value);
    }
    if (activeAxis && current?.uri === GML) {
      if (current.local === "identifier") activeAxis.identifier = value;
      if (current.local === "axisAbbrev") activeAxis.abbreviation = value;
      if (current.local === "axisDirection") activeAxis.direction = value.toLowerCase();
      if (current.local === "CoordinateSystemAxis") {
        if (!activeAxis.identifier || !activeAxis.abbreviation
          || !activeAxis.direction || !activeAxis.uom) {
          throw new Error("embedded CRS coordinate axis is incomplete");
        }
        embeddedAxes.push(activeAxis);
        activeAxis = undefined;
      }
    }
    stack.pop();
    text = "";
  });
  parser.on("error", (error) => { throw error; });
  parser.write(source).close();
  if (stack.length !== 0) throw new Error("CRS XML element stack is incomplete");
  return {
    coordinateSystemElement,
    coordinateSystemHref,
    deprecations,
    embeddedAxes,
    identifier,
    name,
    rootElement,
  };
}

function inspectCoordinateSystem(bytes) {
  if (bytes.length > 64 * 1024) throw new Error("EPSG coordinate-system JSON size limit exceeded");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!Number.isInteger(value.Code)
    || value.Dimension !== 2
    || typeof value.Type !== "string"
    || typeof value.Name !== "string"
    || value.DataSource !== "EPSG"
    || !Array.isArray(value.Deprecations)
    || value.Deprecations.length !== 0
    || !Array.isArray(value.Axis)
    || value.Axis.length !== value.Dimension) {
    throw new Error("EPSG coordinate-system response is incomplete");
  }
  const selfLink = value.Links?.find(({ rel }) => rel === "self")?.href;
  const axes = value.Axis.map((axis) => {
    if (!Number.isInteger(axis.Order)
      || typeof axis.Orientation !== "string"
      || typeof axis.Abbreviation !== "string"
      || typeof axis.Name !== "string"
      || !Number.isInteger(axis.Unit?.Code)) {
      throw new Error(`EPSG coordinate system ${value.Code} has an incomplete axis`);
    }
    return {
      abbreviation: axis.Abbreviation,
      direction: axis.Orientation.toLowerCase(),
      name: axis.Name,
      order: axis.Order,
      unitCode: axis.Unit.Code,
    };
  }).sort((left, right) => left.order - right.order);
  if (new Set(axes.map(({ order }) => order)).size !== axes.length
    || axes.some(({ order }, index) => order !== index + 1)) {
    throw new Error(`EPSG coordinate system ${value.Code} has invalid axis order`);
  }
  return {
    axes,
    code: value.Code,
    dimension: value.Dimension,
    name: value.Name,
    selfLink,
    type: value.Type,
  };
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => (
    argument !== "--write-policy" && !argument.startsWith("--review-manifest=")
  )) || arguments_.filter((argument) => argument === "--write-policy").length > 1) {
    throw new Error("usage: node tools/registries/verify-crs-snapshots.mjs [--write-policy --review-manifest=SHA256]");
  }
  const writeGeneratedPolicy = arguments_.includes("--write-policy");
  const manifestBytes = await readCheckedFile(root, manifestPath, 1024 * 1024);
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  const ids = manifest.artifacts?.map(({ id }) => id) ?? [];
  const coordinateSystemIds = manifest.coordinateSystems?.map(({ id }) => id) ?? [];
  if (manifest.schemaVersion !== "molit.crs-snapshot-manifest/1"
    || !isStrictRfc3339(manifest.retrievedAt)
    || manifest.authority !== "Open Geospatial Consortium CRS Resolver"
    || manifest.requestAccept !== "application/gml+xml"
    || manifest.epsgTermsUrl !== "https://epsg.org/terms-of-use.html"
    || manifest.coordinateSystemAuthority !== "EPSG Geodetic Parameter Dataset API"
    || manifest.coordinateSystemRequestAccept !== "application/json"
    || !isStrictRfc3339(manifest.coordinateSystemRetrievedAt)
    || ids.length !== EXPECTED_IDS.size
    || new Set(ids).size !== ids.length
    || ids.some((id) => !EXPECTED_IDS.has(id))
    || coordinateSystemIds.length !== EXPECTED_COORDINATE_SYSTEMS.size
    || new Set(coordinateSystemIds).size !== coordinateSystemIds.length
    || coordinateSystemIds.some((id) => (
      ![...EXPECTED_COORDINATE_SYSTEMS.values()].some((expected) => expected.id === id)
    ))) {
    throw new Error("CRS snapshot manifest is not approved");
  }
  const coordinateSystems = [];
  for (const artifact of manifest.coordinateSystems) {
    const expected = EXPECTED_COORDINATE_SYSTEMS.get(artifact.code);
    if (!expected
      || artifact.id !== expected.id
      || artifact.sourceUrl !== expected.sourceUrl
      || artifact.type !== expected.type
      || artifact.dimension !== 2
      || artifact.responseContentType !== "application/json; charset=utf-8"
      || artifact.liveFetchInCi !== false) {
      throw new Error(`EPSG coordinate-system manifest entry is not approved: ${artifact.id}`);
    }
    const bytes = await readCheckedFile(root, safePath(artifact.path), 1024 * 1024);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`EPSG coordinate-system digest mismatch: ${artifact.id}`);
    }
    const observed = inspectCoordinateSystem(bytes);
    if (observed.code !== artifact.code
      || observed.dimension !== artifact.dimension
      || observed.type !== artifact.type
      || observed.name !== artifact.name
      || observed.selfLink !== artifact.sourceUrl) {
      throw new Error(`EPSG coordinate-system semantic mismatch: ${artifact.id}`);
    }
    coordinateSystems.push({
      ...observed,
      id: artifact.id,
      sha256: artifact.sha256,
      sourceUrl: artifact.sourceUrl,
    });
  }
  const definitions = [];
  for (const artifact of manifest.artifacts) {
    const bytes = await readCheckedFile(root, safePath(artifact.path), 1024 * 1024);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`CRS snapshot digest mismatch: ${artifact.id}`);
    }
    const observed = inspectDefinition(decodeXml(bytes, artifact.xmlEncoding));
    if (observed.rootElement !== artifact.rootElement
      || observed.identifier !== artifact.identifier
      || observed.name !== artifact.name
      || observed.deprecations.length === 0
      || observed.deprecations.some((value) => value !== "false")) {
      throw new Error(`CRS snapshot semantic mismatch: ${artifact.id}`);
    }
    definitions.push({
      id: artifact.id,
      canonicalIri: artifact.canonicalIri,
      sourceUrl: artifact.sourceUrl,
      coordinateSystemElement: observed.coordinateSystemElement,
      coordinateSystemHref: observed.coordinateSystemHref,
      embeddedAxes: observed.embeddedAxes,
      rootElement: observed.rootElement,
      identifier: observed.identifier,
      name: observed.name,
      deprecated: false,
      sha256: artifact.sha256,
    });
  }
  const manifestSha256 = sha256(manifestBytes);
  const axisPolicy = buildCrsAxisPolicy({
    coordinateSystems,
    definitions,
    manifestSha256,
  });
  const encodedPolicy = Buffer.from(encodeCrsAxisPolicy(axisPolicy), "utf8");
  if (writeGeneratedPolicy) {
    const reviewed = arguments_.find((argument) => argument.startsWith("--review-manifest="))
      ?.slice("--review-manifest=".length);
    if (reviewed !== manifestSha256) {
      throw new Error(`write-policy requires --review-manifest=${manifestSha256}`);
    }
    await atomicWriteChecked(root, policyPath, encodedPolicy);
  } else {
    const committedPolicy = await readCheckedFile(root, policyPath, 4 * 1024 * 1024);
    if (!committedPolicy.equals(encodedPolicy)) {
      throw new Error("generated CRS axis-order policy is stale");
    }
  }
  process.stdout.write(`${JSON.stringify({
    valid: true,
    manifestSha256,
    policySha256: sha256(encodedPolicy),
    definitions,
    coordinateSystems,
    axisPolicy,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
