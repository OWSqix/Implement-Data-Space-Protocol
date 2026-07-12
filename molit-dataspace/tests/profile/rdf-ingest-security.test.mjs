import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertCanonicalGraphEquivalence,
  blockedHttpIriReason,
  canonicalGraphDigest,
  loadRdfBytes,
  loadRdfFile,
} from "../../src/profile/rdf-loader.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const limits = {
  maxInputBytes: 1024 * 1024,
  maxInputQuads: 1_000,
  maxLiteralLength: 20_000,
  maxValidationResults: 100,
  maxValuesPerSubjectPredicate: 100,
};

const turtle = `
@prefix dct: <http://purl.org/dc/terms/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://example.org/dataset/road>
  dct:title "도로"@ko ;
  dct:publisher [ a foaf:Organization ; foaf:name "MOLIT"@en ] .
`;

const ntriples = `
<https://example.org/dataset/road> <http://purl.org/dc/terms/title> "도로"@ko .
<https://example.org/dataset/road> <http://purl.org/dc/terms/publisher> _:publisher .
_:publisher <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://xmlns.com/foaf/0.1/Organization> .
_:publisher <http://xmlns.com/foaf/0.1/name> "MOLIT"@en .
`;

const rdfxml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:dct="http://purl.org/dc/terms/"
  xmlns:foaf="http://xmlns.com/foaf/0.1/"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="https://example.org/dataset/road">
    <dct:title xml:lang="ko">도로</dct:title>
    <dct:publisher rdf:nodeID="publisher" />
  </rdf:Description>
  <rdf:Description rdf:nodeID="publisher">
    <rdf:type rdf:resource="http://xmlns.com/foaf/0.1/Organization" />
    <foaf:name xml:lang="en">MOLIT</foaf:name>
  </rdf:Description>
</rdf:RDF>`;

const jsonLd = JSON.stringify({
  "@context": {
    dct: "http://purl.org/dc/terms/",
    foaf: "http://xmlns.com/foaf/0.1/",
  },
  "@id": "https://example.org/dataset/road",
  "dct:publisher": {
    "@id": "_:publisher",
    "@type": "foaf:Organization",
    "foaf:name": { "@language": "en", "@value": "MOLIT" },
  },
  "dct:title": { "@language": "ko", "@value": "도로" },
});

async function rejectedCode(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code, error.stack);
    return true;
  });
}

test("ST-RDF-INGEST-001: Turtle, N-Triples, RDF/XML and JSON-LD have one canonical graph digest", async () => {
  const inputs = [
    ["road.ttl", turtle],
    ["road.nt", ntriples],
    ["road.rdf", rdfxml],
    ["road.jsonld", jsonLd],
  ];
  const gate = await assertCanonicalGraphEquivalence(inputs.map(([sourceLabel, source]) => ({
    bytes: Buffer.from(source),
    sourceLabel,
  })), limits);
  assert.deepEqual(gate.documents.map((item) => item.rdfFormat), [
    "turtle",
    "ntriples",
    "rdfxml",
    "jsonld",
  ]);
  assert.ok(gate.documents.every((item) => item.quads === 4));
  assert.equal(new Set(gate.documents.map((item) => item.byteSha256)).size, 4);
  assert.equal(new Set(gate.documents.map((item) => item.canonicalGraphSha256)).size, 1);
  assert.equal(gate.algorithm, "RDFC-1.0");
  const first = await loadRdfBytes(Buffer.from(turtle), "road.ttl", limits, {
    canonicalize: true,
  });
  assert.deepEqual(
    await canonicalGraphDigest(first.store),
    first.canonicalGraph,
  );
  await rejectedCode(
    () => assertCanonicalGraphEquivalence([
      { bytes: Buffer.from(turtle), sourceLabel: "road.ttl" },
      {
        bytes: Buffer.from(ntriples.replace('"도로"@ko', '"철도"@ko')),
        sourceLabel: "changed.nt",
      },
    ], limits),
    "RDF_SERIALIZATION_GRAPH_MISMATCH",
  );
});

test("ST-RDF-INGEST-002: file ingestion selects only approved serialization extensions", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-rdf-ingest-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const sources = new Map([
    ["road.ttl", turtle],
    ["road.nt", ntriples],
    ["road.rdf", rdfxml],
    ["road.jsonld", jsonLd],
  ]);
  for (const [name, source] of sources) await writeFile(path.join(directory, name), source, "utf8");
  const loaded = await Promise.all([...sources.keys()].map((name) => (
    loadRdfFile(path.join(directory, name), limits, { canonicalize: true })
  )));
  assert.equal(new Set(loaded.map((item) => item.canonicalGraph.sha256)).size, 1);

  const ambiguous = path.join(directory, "road.json");
  await writeFile(ambiguous, jsonLd, "utf8");
  await rejectedCode(() => loadRdfFile(ambiguous, limits), "UNSUPPORTED_RDF_FORMAT");
  await rejectedCode(
    () => loadRdfBytes(Buffer.from(turtle), "road.ttl", limits, { format: "text/html" }),
    "UNSUPPORTED_RDF_FORMAT",
  );
  await rejectedCode(
    () => loadRdfBytes(Buffer.from(turtle), "road.ttl", limits, {
      format: "text/turtle; charset=utf-16",
    }),
    "UNSUPPORTED_RDF_CHARSET",
  );
});

test("ST-RDF-INGEST-003: every serialization uses fatal UTF-8 and byte limits", async () => {
  for (const [name, format] of [
    ["bad.ttl", "text/turtle"],
    ["bad.nt", "application/n-triples"],
    ["bad.rdf", "application/rdf+xml"],
    ["bad.jsonld", "application/ld+json"],
  ]) {
    await rejectedCode(
      () => loadRdfBytes(Buffer.from([0xc0, 0xaf]), name, limits, { format }),
      "INVALID_UTF8",
    );
    await rejectedCode(
      () => loadRdfBytes(Buffer.alloc(33, 0x20), name, { ...limits, maxInputBytes: 32 }, { format }),
      "RDF_INPUT_SIZE_LIMIT",
    );
  }
});

test("ST-RDF-XML-001: DTD, entities, XInclude, stylesheet PI and non-UTF-8 declarations fail closed", async () => {
  const unsafe = [
    [
      `<?xml version="1.0"?><!DOCTYPE rdf:RDF [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
       <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" />`,
      "RDFXML_DTD_FORBIDDEN",
    ],
    [
      `<!ENTITY xxe SYSTEM "https://example.org/entity"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" />`,
      "RDFXML_DTD_FORBIDDEN",
    ],
    [
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        xmlns:xi="http://www.w3.org/2001/XIncl&#x75;de"><xi:include href="file:///etc/passwd" /></rdf:RDF>`,
      "RDFXML_XINCLUDE_FORBIDDEN",
    ],
    [
      `<?xml version="1.0"?><?xml-stylesheet href="https://example.org/a.xsl"?>
       <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" />`,
      "RDFXML_PROCESSING_INSTRUCTION_FORBIDDEN",
    ],
    [
      `<?xml version="1.0" encoding="UTF-16"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" />`,
      "RDFXML_ENCODING_FORBIDDEN",
    ],
  ];
  for (const [source, code] of unsafe) {
    await rejectedCode(
      () => loadRdfBytes(Buffer.from(source), "unsafe.rdf", limits),
      code,
    );
  }
  await rejectedCode(
    () => loadRdfBytes(
      Buffer.from(`${rdfxml.replace("</rdf:RDF>", "")}<rdf:Description></rdf:RDF>`),
      "malformed.rdf",
      limits,
    ),
    "INVALID_RDFXML",
  );
});

test("ST-RDF-XML-002: RDF/XML parsing stops at the quad limit", async () => {
  await rejectedCode(
    () => loadRdfBytes(Buffer.from(rdfxml), "road.rdf", { ...limits, maxInputQuads: 3 }),
    "RDF_QUAD_LIMIT",
  );
});

test("ST-JSONLD-001: remote contexts and imported contexts never use an ambient document loader", async () => {
  for (const document of [
    { "@context": "http://127.0.0.1:9/context", "@id": "https://example.org/s" },
    {
      "@context": { "@import": "https://example.org/context?token=secret" },
      "@id": "https://example.org/s",
    },
  ]) {
    await assert.rejects(
      () => loadRdfBytes(
        Buffer.from(JSON.stringify(document)),
        "remote.jsonld",
        limits,
      ),
      (error) => {
        assert.equal(error.code, "JSONLD_REMOTE_DOCUMENT_FORBIDDEN");
        assert.equal(JSON.stringify(error.details).includes("127.0.0.1"), false);
        assert.equal(JSON.stringify(error.details).includes("example.org/context"), false);
        assert.equal(error.stack.includes("token=secret"), false);
        return true;
      },
    );
  }
});

test("ST-JSONLD-002: duplicate keys, prototype keys and excessive nesting fail before JSON-LD expansion", async () => {
  await rejectedCode(
    () => loadRdfBytes(
      Buffer.from('{"@id":"https://example.org/one","\\u0040id":"https://example.org/two"}'),
      "duplicate.jsonld",
      limits,
    ),
    "JSONLD_DUPLICATE_KEY",
  );
  await rejectedCode(
    () => loadRdfBytes(
      Buffer.from('{"@context":{},"__proto__":{"polluted":true}}'),
      "prototype.jsonld",
      limits,
    ),
    "JSONLD_UNSAFE_KEY",
  );
  const nested = `${"[".repeat(66)}null${"]".repeat(66)}`;
  await rejectedCode(
    () => loadRdfBytes(Buffer.from(nested), "deep.jsonld", limits),
    "JSONLD_COMPLEXITY_LIMIT",
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test("ST-NTRIPLES-001: N-Triples does not accept Turtle directives", async () => {
  await rejectedCode(
    () => loadRdfBytes(
      Buffer.from(turtle),
      "not-nt.nt",
      limits,
    ),
    "INVALID_NTRIPLES",
  );
});

test("ST-IANA-GENERATED-001: generated longest-prefix, NAT64 and reserved-space policy is executable", () => {
  for (const iri of [
    "https://192.0.0.9/reference",
    "https://192.0.0.10/reference",
    "https://[2001:1::1]/reference",
    "https://[2001:3::1]/reference",
    "https://[64:ff9b::808:808]/reference",
  ]) assert.equal(blockedHttpIriReason(iri), null, iri);

  for (const iri of [
    "https://192.0.0.8/reference",
    "https://224.0.0.1/reference",
    "https://[64:ff9b::7f00:1]/reference",
    "https://[2001:db8::1]/reference",
    "https://[2420::1]/reference",
    "https://[3000::1]/reference",
    "https://[fec0::1]/reference",
  ]) assert.equal(blockedHttpIriReason(iri), "non-global-host", iri);
});

test("ST-JENA-PROBE-001: an absent Jena distribution is reported as a non-passing Gate", async () => {
  const script = path.join(root, "tools/profile/probe-jena.mjs");
  let failure;
  try {
    await execFileAsync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, JAVA_HOME: "", JENA_HOME: "", PATH: "" },
      timeout: 20_000,
      windowsHide: true,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.equal(failure.code, 2);
  const report = JSON.parse(failure.stdout);
  assert.equal(report.schemaVersion, "molit.jena-engine-probe/1");
  assert.equal(report.status, "unavailable");
  assert.equal(report.gatePassed, false);
  assert.equal(report.conforms, null);
  assert.equal(report.requirements.jena.version, "6.1.0");
  assert.equal(report.requirements.java.minimumMajor, 21);
  assert.match(report.requirements.installation, /^https:\/\/jena[.]apache[.]org\//u);
});

const localJavaHome = path.join(root, ".local/toolchains/install/jdk-21.0.11+10-jre");
const localJenaHome = path.join(root, ".local/toolchains/install/apache-jena-6.1.0");
const localJavaExecutable = process.platform === "win32" ? "java.exe" : "java";
const localJenaAvailable = existsSync(path.join(localJavaHome, "bin", localJavaExecutable))
  && existsSync(path.join(localJenaHome, "lib"));

test("ST-JENA-PROBE-002: provisioned Jena parses every approved serialization to the Node graph digest", {
  skip: localJenaAvailable ? false : "verified local Jena/JRE toolchain is not provisioned",
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-jena-formats-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const documents = new Map([
    ["road.ttl", turtle],
    ["road.nt", ntriples],
    ["road.nq", ntriples],
    ["road.rdf", rdfxml],
    ["road.jsonld", jsonLd],
  ]);
  const reports = [];
  for (const [name, source] of documents) {
    const input = path.join(directory, name);
    await writeFile(input, source, "utf8");
    const result = await execFileAsync(process.execPath, [
      path.join(root, "tools/profile/probe-jena.mjs"),
      "--input",
      input,
    ], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        JAVA_HOME: localJavaHome,
        JENA_HOME: localJenaHome,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    });
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "matched", name);
    assert.equal(report.gatePassed, true, name);
    assert.equal(report.conforms, true, name);
    assert.equal(report.engine.version, "6.1.0", name);
    assert.equal(report.result.jenaGraphSha256, report.result.nodeGraphSha256, name);
    reports.push(report);
  }
  assert.equal(new Set(reports.map((report) => report.result.nodeGraphSha256)).size, 1);

  const remoteContext = path.join(directory, "remote-context.jsonld");
  await writeFile(remoteContext, JSON.stringify({
    "@context": "http://127.0.0.1:9/context",
    "@id": "https://example.org/unsafe",
  }), "utf8");
  let preflightFailure;
  try {
    await execFileAsync(process.execPath, [
      path.join(root, "tools/profile/probe-jena.mjs"),
      "--input",
      remoteContext,
    ], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        JAVA_HOME: localJavaHome,
        JENA_HOME: localJenaHome,
      },
      timeout: 30_000,
      windowsHide: true,
    });
  } catch (error) {
    preflightFailure = error;
  }
  assert.equal(preflightFailure?.code, 1);
  const preflightReport = JSON.parse(preflightFailure.stdout);
  assert.equal(preflightReport.status, "preflight-error");
  assert.equal(preflightReport.reason, "JSONLD_REMOTE_DOCUMENT_FORBIDDEN");
  assert.equal(preflightReport.gatePassed, false);
  assert.equal(preflightReport.conforms, null);
});

test("ST-JENA-PROBE-003: N-Quads named-graph identity survives the Node and Jena parser lane", {
  skip: localJenaAvailable ? false : "verified local Jena/JRE toolchain is not provisioned",
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-jena-named-graph-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const namedGraph = [
    "<https://example.org/dataset/road> <http://purl.org/dc/terms/title> \"road\"@en <https://example.org/graph/catalogue> .",
    "<https://example.org/dataset/road> <http://purl.org/dc/terms/publisher> <https://example.org/organization/molit> <https://example.org/graph/catalogue> .",
    "",
  ].join("\n");
  const defaultGraph = namedGraph.replaceAll(" <https://example.org/graph/catalogue> .", " .");
  const input = path.join(directory, "named-graph.nq");
  await writeFile(input, namedGraph, "utf8");

  const nodeNamed = await loadRdfBytes(Buffer.from(namedGraph), input, limits, {
    canonicalize: true,
  });
  const nodeDefault = await loadRdfBytes(Buffer.from(defaultGraph), "default-graph.nq", limits, {
    canonicalize: true,
  });
  assert.equal(nodeNamed.rdfFormat, "nquads");
  assert.ok(nodeNamed.quads.every((quad) => (
    quad.graph.termType === "NamedNode"
      && quad.graph.value === "https://example.org/graph/catalogue"
  )));
  assert.notEqual(
    nodeNamed.canonicalGraph.sha256,
    nodeDefault.canonicalGraph.sha256,
    "moving quads to the default graph must change the canonical RDF dataset digest",
  );

  const result = await execFileAsync(process.execPath, [
    path.join(root, "tools/profile/probe-jena.mjs"),
    "--input",
    input,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      JAVA_HOME: localJavaHome,
      JENA_HOME: localJenaHome,
    },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
  const report = JSON.parse(result.stdout);
  assert.equal(report.input.format, "nquads");
  assert.equal(report.status, "matched");
  assert.equal(report.gatePassed, true);
  assert.equal(report.conforms, true);
  assert.equal(report.result.nodeGraphSha256, nodeNamed.canonicalGraph.sha256);
  assert.equal(report.result.jenaGraphSha256, nodeNamed.canonicalGraph.sha256);
});

test("ST-RDF-INGEST-004: fixed fixture bytes remain readable for regression diagnostics", async () => {
  const fixture = path.join(root, "fixtures/interoperability/data-go-kr-100299070.rdf");
  const bytes = await readFile(fixture);
  assert.ok(bytes.length > 0);
  const parsed = await loadRdfBytes(
    bytes,
    fixture,
    { ...limits, maxInputQuads: 10_000 },
    { canonicalize: true },
  );
  assert.equal(parsed.rdfFormat, "rdfxml");
  assert.ok(parsed.quads.length > 0);
  assert.equal(parsed.canonicalGraph.algorithm, "RDFC-1.0");
});
