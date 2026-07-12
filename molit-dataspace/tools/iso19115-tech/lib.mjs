import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import fontoxpath from "fontoxpath";
import { sync as parseXml } from "slimdom-sax-parser";
import xmllint from "xmllint-wasm";

const {
  createTypedValueFactory,
  domFacade,
  evaluateXPath,
  evaluateXPathToBoolean,
  evaluateXPathToNodes,
} = fontoxpath;
const { validateXML } = xmllint;

const SCHEMATRON_NS = "http://purl.oclc.org/dsdl/schematron";
const XSD_NS = "http://www.w3.org/2001/XMLSchema";
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const CACHE_PATH = /^artifacts\/[a-f0-9]{16}-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN_XML = /<!DOCTYPE|<!ENTITY|http:\/\/www[.]w3[.]org\/2001\/XInclude/iu;
const FORBIDDEN_XPATH_IO = /(?:^|[^A-Za-z0-9_-])(?:doc|document|collection|uri-collection|unparsed-text|transform|parse-xml|parse-xml-fragment)\s*\(/iu;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const nodeSequence = createTypedValueFactory("node()*");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

export function decodeSecureXml(bytes, label = "XML artifact") {
  assert.ok(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, `${label}: bytes required`);
  assert.ok(bytes.length > 0 && bytes.length <= MAX_ARTIFACT_BYTES, `${label}: size out of range`);
  const text = utf8Decoder.decode(bytes);
  assert.equal(text.includes("\0"), false, `${label}: NUL rejected`);
  assert.equal(FORBIDDEN_XML.test(text), false, `${label}: DTD, entity or XInclude rejected`);
  return text;
}

export function assertManifest(manifest) {
  assert.equal(manifest.schemaVersion, "molit.iso19115-1-tech-gate/1");
  assert.equal(manifest.package.standard, "ISO 19115-1");
  assert.equal(manifest.package.version, "1.3.0");
  assert.equal(manifest.package.status, "current");
  assert.equal(manifest.package.officialListing, "https://schemas.isotc211.org/19115/-1/");
  assert.match(manifest.package.repositoryCommitObserved, /^[a-f0-9]{40}$/u);
  assert.ok(Number.isFinite(Date.parse(manifest.package.repositoryCommitObservedAt)));
  assert.equal(manifest.package.endpointBytesBoundToRepositoryCommit, false);
  assert.equal(manifest.license.redistributionPermission, "not-established");
  assert.equal(manifest.license.committedOfficialBytes, false);
  assert.equal(manifest.gateStatus, "blocked-pending-permission-or-approved-private-cache");
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 4);
  assert.ok(manifest.artifacts.length <= 256);
  const urls = new Set();
  const cachePaths = new Set();
  let totalBytes = 0;
  for (const artifact of manifest.artifacts) {
    assert.ok(["xsd-entrypoint", "xsd-module", "xsd-dependency", "schematron", "valid-example"].includes(artifact.role));
    const url = new URL(artifact.url);
    assert.equal(url.protocol, "https:");
    assert.ok(["schemas.isotc211.org", "schemas.opengis.net", "www.w3.org"].includes(url.hostname));
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.hash, "");
    assert.equal(urls.has(url.href), false, `duplicate URL: ${url.href}`);
    urls.add(url.href);
    assert.equal(typeof artifact.mediaType, "string");
    assert.ok(artifact.mediaType.length >= 3 && artifact.mediaType.length <= 120);
    assert.match(artifact.mediaType, /^(?:application\/xml|application\/octet-stream)(?:;\s*charset=[A-Za-z0-9._-]+)?$/iu);
    assert.ok(Number.isInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= MAX_ARTIFACT_BYTES);
    assert.match(artifact.sha256, SHA256);
    assert.ok(Number.isFinite(Date.parse(artifact.retrievedAt)));
    assert.match(artifact.cachePath, CACHE_PATH);
    assert.equal(cachePaths.has(artifact.cachePath), false, `duplicate cachePath: ${artifact.cachePath}`);
    cachePaths.add(artifact.cachePath);
    assert.equal(artifact.responseUrl, artifact.url);
    totalBytes += artifact.bytes;
  }
  assert.ok(totalBytes <= MAX_TOTAL_BYTES, "manifest byte budget exceeded");
  assert.equal(manifest.artifacts.filter((item) => item.role === "xsd-entrypoint").length, 1);
  assert.equal(manifest.artifacts.filter((item) => item.role === "xsd-module").length, 17);
  assert.equal(manifest.artifacts.filter((item) => item.role === "schematron").length, 1);
  assert.equal(manifest.artifacts.filter((item) => item.role === "valid-example").length, 1);
  return manifest;
}

export async function loadManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return assertManifest(manifest);
}

async function checkedCacheFile(cacheRoot, relativePath) {
  assert.match(relativePath, CACHE_PATH);
  const root = path.resolve(cacheRoot);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  assert.ok(relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  assert.equal(path.isAbsolute(relative), false);
  const canonicalRoot = await realpath(root);
  let current = root;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const info = await lstat(current);
    assert.equal(info.isSymbolicLink(), false, `${relativePath}: symlink or junction rejected`);
    const canonical = await realpath(current);
    const expected = path.resolve(canonicalRoot, ...segments.slice(0, index + 1));
    assert.ok(samePath(canonical, expected), `${relativePath}: reparse point rejected`);
    if (index === segments.length - 1) assert.ok(info.isFile(), `${relativePath}: regular file required`);
    else assert.ok(info.isDirectory(), `${relativePath}: directory required`);
  }
  return resolved;
}

export async function verifyCache(manifest, cacheRoot) {
  assertManifest(manifest);
  const contents = new Map();
  for (const artifact of manifest.artifacts) {
    const artifactPath = await checkedCacheFile(cacheRoot, artifact.cachePath);
    const bytes = await readFile(artifactPath);
    assert.equal(bytes.length, artifact.bytes, `${artifact.url}: byte count mismatch`);
    assert.equal(sha256(bytes), artifact.sha256, `${artifact.url}: digest mismatch`);
    decodeSecureXml(bytes, artifact.url);
    contents.set(artifact.url, bytes);
  }
  return contents;
}

function rewriteSchemaLocations(artifact, text, artifactsByUrl) {
  return text.replace(/(\bschemaLocation\s*=\s*["'])([^"']+)(["'])/gu, (match, before, value, after) => {
    let resolved = new URL(value, artifact.url);
    if (resolved.protocol === "http:" && ["schemas.isotc211.org", "schemas.opengis.net", "www.w3.org"].includes(resolved.hostname)) {
      resolved = new URL(resolved.href.replace(/^http:/u, "https:"));
    }
    const dependency = artifactsByUrl.get(resolved.href);
    if (!dependency) return match;
    return `${before}${path.posix.basename(dependency.cachePath)}${after}`;
  });
}

function assertXsdClosure(artifact, text, artifactsByUrl) {
  const document = parseXml(text);
  for (const localName of ["import", "include", "redefine"]) {
    for (const node of document.getElementsByTagNameNS(XSD_NS, localName)) {
      const location = node.getAttribute("schemaLocation");
      if (!location) continue;
      let resolved = new URL(location, artifact.url);
      if (resolved.protocol === "http:" && ["schemas.isotc211.org", "schemas.opengis.net", "www.w3.org"].includes(resolved.hostname)) {
        resolved = new URL(resolved.href.replace(/^http:/u, "https:"));
      }
      assert.ok(artifactsByUrl.has(resolved.href), `${artifact.url}: unpinned schemaLocation ${location}`);
    }
  }
}

export async function validateXsdDocument({ manifest, contents, xmlBytes, xmlFileName = "instance.xml" }) {
  const xsdArtifacts = manifest.artifacts.filter((artifact) => (
    artifact.role === "xsd-entrypoint" || artifact.role === "xsd-module"
      || artifact.role === "xsd-dependency"
  ));
  const artifactsByUrl = new Map(xsdArtifacts.map((artifact) => [artifact.url, artifact]));
  const schemas = xsdArtifacts.map((artifact) => {
    const bytes = contents.get(artifact.url);
    assert.ok(bytes, `missing cached XSD: ${artifact.url}`);
    const text = decodeSecureXml(bytes, artifact.url);
    assertXsdClosure(artifact, text, artifactsByUrl);
    return {
      fileName: path.posix.basename(artifact.cachePath),
      contents: rewriteSchemaLocations(artifact, text, artifactsByUrl),
    };
  });
  const moduleImports = xsdArtifacts.filter((artifact) => (
    artifact.role === "xsd-entrypoint" || artifact.role === "xsd-module"
  )).map((artifact) => {
    const text = decodeSecureXml(contents.get(artifact.url), artifact.url);
    const document = parseXml(text);
    assert.equal(document.documentElement.namespaceURI, XSD_NS);
    const targetNamespace = document.documentElement.getAttribute("targetNamespace");
    assert.ok(targetNamespace.startsWith("https://schemas.isotc211.org/19115/-1/"));
    return `  <xs:import namespace="${targetNamespace}" schemaLocation="${path.posix.basename(artifact.cachePath)}"/>`;
  });
  assert.equal(new Set(moduleImports).size, 18);
  const main = {
    fileName: "iso19115-1-v1.3.0-driver.xsd",
    contents: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
      ...moduleImports,
      "</xs:schema>",
    ].join("\n"),
  };
  const preload = schemas;
  const xmlText = decodeSecureXml(xmlBytes, xmlFileName);
  return validateXML({
    xml: { fileName: xmlFileName, contents: xmlText },
    schema: main,
    preload,
    initialMemoryPages: 512,
    maxMemoryPages: 2048,
    modifyArguments: (args) => ["--nonet", ...args],
  });
}

export async function validateStandaloneXsd({ xsdBytes, xmlBytes, xmlFileName = "instance.xml" }) {
  const xsdText = decodeSecureXml(xsdBytes, "standalone XSD");
  const xmlText = decodeSecureXml(xmlBytes, xmlFileName);
  return validateXML({
    xml: { fileName: xmlFileName, contents: xmlText },
    schema: { fileName: "standalone.xsd", contents: xsdText },
    initialMemoryPages: 256,
    maxMemoryPages: 512,
    modifyArguments: (args) => ["--nonet", ...args],
  });
}

function xpathOptions(namespaces) {
  return { namespaceResolver: (prefix) => namespaces.get(prefix) ?? null };
}

function assertSafeXPath(expression, label) {
  assert.equal(FORBIDDEN_XPATH_IO.test(expression), false, `${label}: external-access XPath function rejected`);
  assert.ok(expression.length > 0 && expression.length <= 4000, `${label}: XPath size out of range`);
}

function diagnosticText(schemaDocument, diagnosticIds) {
  if (!diagnosticIds) return "";
  const wanted = new Set(diagnosticIds.trim().split(/\s+/u));
  return [...schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "diagnostic")]
    .filter((node) => wanted.has(node.getAttribute("id")))
    .map((node) => node.textContent.trim().replace(/\s+/gu, " "))
    .join(" | ");
}

export function evaluateSchematron({ schematronBytes, xmlBytes }) {
  const schematronText = decodeSecureXml(schematronBytes, "Schematron");
  const xmlText = decodeSecureXml(xmlBytes, "Schematron instance");
  const schemaDocument = parseXml(schematronText);
  const instanceDocument = parseXml(xmlText);
  assert.equal(schemaDocument.documentElement.namespaceURI, SCHEMATRON_NS);
  assert.equal(schemaDocument.documentElement.localName, "schema");
  assert.equal(schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "include").length, 0);
  assert.equal(schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "extends").length, 0);
  assert.equal(schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "phase").length, 0);
  assert.ok([null, ""].includes(schemaDocument.documentElement.getAttribute("queryBinding")));
  for (const pattern of schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "pattern")) {
    assert.notEqual(pattern.getAttribute("abstract"), "true");
  }
  for (const variable of schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "let")) {
    assert.equal(variable.parentNode?.localName, "rule", "only rule-local Schematron variables are supported");
  }

  const namespaces = new Map();
  for (const declaration of schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "ns")) {
    const prefix = declaration.getAttribute("prefix");
    const uri = declaration.getAttribute("uri");
    assert.match(prefix, /^[A-Za-z_][A-Za-z0-9._-]*$/u);
    assert.ok(uri.startsWith("https://") || uri.startsWith("http://www.opengis.net/") || uri.startsWith("urn:"));
    assert.equal(namespaces.has(prefix), false, `duplicate Schematron prefix: ${prefix}`);
    namespaces.set(prefix, uri);
  }
  const options = xpathOptions(namespaces);
  const rules = [...schemaDocument.getElementsByTagNameNS(SCHEMATRON_NS, "rule")];
  assert.ok(rules.length > 0 && rules.length <= 200);
  const failures = [];
  let evaluatedAssertions = 0;
  for (const rule of rules) {
    assert.notEqual(rule.getAttribute("abstract"), "true");
    const contextExpression = rule.getAttribute("context");
    assertSafeXPath(contextExpression, "Schematron rule context");
    const contextNodes = evaluateXPathToNodes(
      contextExpression,
      instanceDocument,
      null,
      {},
      options,
    );
    for (const contextNode of contextNodes) {
      const variables = {};
      for (const child of rule.childNodes) {
        if (child.nodeType !== 1 || child.namespaceURI !== SCHEMATRON_NS) continue;
        if (child.localName === "let") {
          const name = child.getAttribute("name");
          const expression = child.getAttribute("value");
          assert.match(name, /^[A-Za-z_][A-Za-z0-9._-]*$/u);
          assert.equal(Object.hasOwn(variables, name), false, `duplicate Schematron variable: ${name}`);
          assertSafeXPath(expression, `Schematron variable ${name}`);
          let value = evaluateXPath(
            expression,
            contextNode,
            null,
            variables,
            evaluateXPath.ANY_TYPE,
            options,
          );
          if (Array.isArray(value) && value.every((item) => item?.nodeType !== undefined)) {
            value = nodeSequence(value, domFacade);
          }
          variables[name] = value;
        }
        if (child.localName === "assert") {
          const expression = child.getAttribute("test");
          assertSafeXPath(expression, "Schematron assertion");
          evaluatedAssertions += 1;
          if (!evaluateXPathToBoolean(expression, contextNode, null, variables, options)) {
            failures.push({
              context: rule.getAttribute("context"),
              test: expression,
              diagnostics: diagnosticText(schemaDocument, child.getAttribute("diagnostics")),
            });
          }
        }
      }
    }
  }
  assert.ok(evaluatedAssertions > 0, "Schematron evaluated no assertions");
  return { valid: failures.length === 0, evaluatedAssertions, failures };
}

export async function runOfficialSmoke(manifest, cacheRoot) {
  const contents = await verifyCache(manifest, cacheRoot);
  const example = manifest.artifacts.find((artifact) => artifact.role === "valid-example");
  const schematron = manifest.artifacts.find((artifact) => artifact.role === "schematron");
  assert.ok(example && schematron);
  const validXml = contents.get(example.url);
  const xsdValid = await validateXsdDocument({ manifest, contents, xmlBytes: validXml });
  assert.equal(xsdValid.valid, true, xsdValid.rawOutput);
  const schematronValid = evaluateSchematron({
    schematronBytes: contents.get(schematron.url),
    xmlBytes: validXml,
  });
  assert.equal(schematronValid.valid, true, JSON.stringify(schematronValid.failures, null, 2));

  const validText = decodeSecureXml(validXml, example.url);
  const xsdNegativeText = validText
    .replace("<mdb:MD_Metadata", "<mdb:MD_Metadata_Invalid")
    .replace("</mdb:MD_Metadata>", "</mdb:MD_Metadata_Invalid>");
  assert.notEqual(xsdNegativeText, validText, "XSD negative mutation did not apply");
  const xsdNegative = await validateXsdDocument({
    manifest,
    contents,
    xmlBytes: Buffer.from(xsdNegativeText),
    xmlFileName: "xsd-negative.xml",
  });
  assert.equal(xsdNegative.valid, false, "XSD negative mutation was accepted");

  const schematronNegativeText = validText.replace(
    'codeListValue="creation"',
    'codeListValue="publication"',
  );
  assert.notEqual(schematronNegativeText, validText, "Schematron negative mutation did not apply");
  const schematronNegativeXsd = await validateXsdDocument({
    manifest,
    contents,
    xmlBytes: Buffer.from(schematronNegativeText),
    xmlFileName: "schematron-negative.xml",
  });
  assert.equal(schematronNegativeXsd.valid, true, schematronNegativeXsd.rawOutput);
  const schematronNegative = evaluateSchematron({
    schematronBytes: contents.get(schematron.url),
    xmlBytes: Buffer.from(schematronNegativeText),
  });
  assert.equal(schematronNegative.valid, false, "Schematron negative mutation was accepted");
  return {
    artifactCount: manifest.artifacts.length,
    xsdPositive: true,
    xsdNegativeRejected: true,
    schematronPositive: true,
    schematronNegativeRejected: true,
    schematronAssertions: schematronValid.evaluatedAssertions,
  };
}

export { MAX_ARTIFACT_BYTES, MAX_TOTAL_BYTES, sha256 };
