import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SaxesParser } from "saxes";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DCAT = "http://www.w3.org/ns/dcat#";
const XML = "http://www.w3.org/XML/1998/namespace";
const XINCLUDE = "http://www.w3.org/2001/XInclude";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const canonicalPrefixes = new Map([
  [RDF, "rdf"],
  ["http://purl.org/dc/terms/", "dct"],
  [DCAT, "dcat"],
  ["http://xmlns.com/foaf/0.1/", "foaf"],
  ["http://www.w3.org/2006/vcard/ns#", "vcard"],
  [XML, "xml"],
  [XSD, "xsd"],
]);

const mappedResourceTypes = new Set([
  `${DCAT}Catalog`,
  `${DCAT}Dataset`,
  `${DCAT}Distribution`,
]);

export const DEFAULT_RDFXML_INVENTORY_LIMITS = Object.freeze({
  maxAttributesPerElement: 64,
  maxBytes: 1024 * 1024,
  maxDepth: 64,
  maxElements: 10_000,
  maxPathLength: 4096,
});

function inventoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalExpandedName(uri, local) {
  const prefix = canonicalPrefixes.get(uri);
  if (prefix) return `${prefix}:${local}`;
  return `Q{${String(uri).replaceAll("}", "%7D")}}${local}`;
}

function canonicalDatatype(value) {
  for (const [uri, prefix] of canonicalPrefixes) {
    if (value.startsWith(uri) && value.length > uri.length) {
      return `${prefix}:${value.slice(uri.length)}`;
    }
  }
  return `Q{${value.replaceAll("}", "%7D")}}`;
}

function canonicalSegment(tag) {
  const qualifiers = [];
  for (const attribute of Object.values(tag.attributes)) {
    if (attribute.uri === XMLNS) continue;
    if (attribute.uri === XML && attribute.local === "lang") {
      qualifiers.push(`@xml:lang='${attribute.value.toLowerCase()}'`);
    }
    if (attribute.uri === RDF && attribute.local === "datatype") {
      qualifiers.push(`@rdf:datatype='${canonicalDatatype(attribute.value)}'`);
    }
  }
  qualifiers.sort();
  const suffix = qualifiers.length > 0 ? `[${qualifiers.join(" and ")}]` : "";
  return `${canonicalExpandedName(tag.uri, tag.local)}${suffix}`;
}

function rejectUninventoriedPropertyAttributes(tag) {
  for (const attribute of Object.values(tag.attributes)) {
    if (attribute.uri === XMLNS || attribute.uri === XML || attribute.uri === RDF) continue;
    throw inventoryError(
      "RDFXML_PROPERTY_ATTRIBUTE",
      `RDF/XML property attributes require an explicit inventory rule: ${attribute.name}`,
    );
  }
}

function assertSafeXmlSource(source) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) {
    throw inventoryError("RDFXML_FORBIDDEN_DECLARATION", "DTD and entity declarations are prohibited");
  }
}

/**
 * Build the public-portal dialect inventory from one bounded RDF/XML document.
 *
 * The inventory contains the three DCAT record resources used by the adapter
 * and every leaf predicate path.  Namespace prefixes are canonicalized by URI;
 * source prefix aliases therefore cannot change the generated paths.
 */
export function inventoryRdfXmlBytes(
  bytes,
  limits = DEFAULT_RDFXML_INVENTORY_LIMITS,
) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (payload.length > limits.maxBytes) {
    throw inventoryError("RDFXML_SIZE_LIMIT", `RDF/XML exceeds ${limits.maxBytes} bytes`);
  }

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch (cause) {
    const error = inventoryError("RDFXML_INVALID_UTF8", "RDF/XML must use valid UTF-8");
    error.cause = cause;
    throw error;
  }
  assertSafeXmlSource(source);

  const inventory = new Set();
  const stack = [];
  let elementCount = 0;
  let rootSeen = false;
  const parser = new SaxesParser({ xmlns: true });

  parser.on("doctype", () => {
    throw inventoryError("RDFXML_FORBIDDEN_DECLARATION", "DOCTYPE is prohibited");
  });
  parser.on("processinginstruction", ({ target }) => {
    throw inventoryError("RDFXML_PROCESSING_INSTRUCTION", `processing instruction is prohibited: ${target}`);
  });
  parser.on("opentag", (tag) => {
    elementCount += 1;
    if (elementCount > limits.maxElements) {
      throw inventoryError("RDFXML_ELEMENT_LIMIT", "RDF/XML element limit exceeded");
    }
    if (stack.length + 1 > limits.maxDepth) {
      throw inventoryError("RDFXML_DEPTH_LIMIT", "RDF/XML depth limit exceeded");
    }
    if (Object.keys(tag.attributes).length > limits.maxAttributesPerElement) {
      throw inventoryError("RDFXML_ATTRIBUTE_LIMIT", "RDF/XML attribute limit exceeded");
    }
    if (tag.uri === XINCLUDE) {
      throw inventoryError("RDFXML_XINCLUDE", "XInclude is prohibited");
    }
    // The portal fixture uses element-form properties. Silently ignoring an
    // RDF/XML property-attribute abbreviation would recreate the coordinated
    // inventory omission that this tool is meant to prevent.
    rejectUninventoriedPropertyAttributes(tag);

    if (!rootSeen) {
      rootSeen = true;
      if (tag.uri !== RDF || tag.local !== "RDF") {
        throw inventoryError("RDFXML_ROOT", "RDF/XML root must be rdf:RDF");
      }
    }
    if (stack.length > 0) stack.at(-1).hasElementChild = true;
    const segment = canonicalSegment(tag);
    const currentPath = `${stack.at(-1)?.path ?? ""}/${segment}`;
    if (currentPath.length > limits.maxPathLength) {
      throw inventoryError("RDFXML_PATH_LIMIT", "canonical RDF/XML path limit exceeded");
    }
    stack.push({
      expandedName: `${tag.uri}${tag.local}`,
      hasElementChild: false,
      path: currentPath,
    });
  });
  parser.on("closetag", () => {
    const frame = stack.pop();
    if (!frame) throw inventoryError("RDFXML_STACK", "RDF/XML element stack underflow");
    if (!frame.hasElementChild || mappedResourceTypes.has(frame.expandedName)) {
      if (frame.path !== "/rdf:RDF") inventory.add(frame.path);
    }
  });
  parser.on("error", (cause) => {
    if (cause?.code) throw cause;
    const error = inventoryError("RDFXML_PARSE", `invalid RDF/XML: ${cause.message}`);
    error.cause = cause;
    throw error;
  });

  parser.write(source).close();
  if (!rootSeen || stack.length !== 0) {
    throw inventoryError("RDFXML_INCOMPLETE", "RDF/XML document is incomplete");
  }
  return Object.freeze([...inventory].sort());
}

export function compareGeneratedInventory(generated, crosswalk) {
  const problems = [];
  const generatedSet = new Set(generated);
  const declared = crosswalk?.sourceInventory ?? [];
  const rowPaths = crosswalk?.rows?.map((row) => row.sourcePointerOrXPath) ?? [];
  const declaredSet = new Set(declared);
  const rowSet = new Set(rowPaths);

  if (declaredSet.size !== declared.length) problems.push("duplicate sourceInventory path");
  if (rowSet.size !== rowPaths.length) problems.push("duplicate mapping source path");
  for (const path of generatedSet) {
    if (!declaredSet.has(path)) problems.push(`generated path missing from sourceInventory: ${path}`);
    if (!rowSet.has(path)) problems.push(`generated path has no mapping row: ${path}`);
  }
  for (const path of declaredSet) {
    if (!generatedSet.has(path)) problems.push(`sourceInventory path absent from fixture: ${path}`);
  }
  for (const path of rowSet) {
    if (!generatedSet.has(path)) problems.push(`mapping row path absent from fixture: ${path}`);
  }
  return problems.sort();
}

async function main(arguments_) {
  if (arguments_.length !== 1) {
    throw new Error("usage: node tools/mappings/rdfxml-source-inventory.mjs <fixture.rdf>");
  }
  const payload = await readFile(arguments_[0]);
  process.stdout.write(`${JSON.stringify(inventoryRdfXmlBytes(payload), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
