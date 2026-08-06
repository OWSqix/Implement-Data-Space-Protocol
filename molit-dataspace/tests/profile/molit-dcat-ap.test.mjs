import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import {
  loadProfileRelease,
  listReleaseMachineArtifacts,
  projectRoot,
  resolveReleaseArtifact,
  verifyArtifactLock,
} from "../../src/profile/registry.mjs";
import {
  loadRdfBytes,
  sanitizeDiagnosticValue,
  scanCoreProfileRouting,
  scanPublicGraph,
} from "../../src/profile/rdf-loader.mjs";
import { parsePublicValuePolicy } from "../../src/profile/public-value-policy.mjs";
import { validateProfileDocument } from "../../src/profile/validator.mjs";

const { blankNode, literal, namedNode, quad } = DataFactory;
const release = await loadProfileRelease("0.1.0");
const exampleRoot = resolveReleaseArtifact(release, "examples");
const validExample = path.join(exampleRoot, "valid", "road-network-catalog.ttl");
const publicValuePolicy = parsePublicValuePolicy(await readFile(resolveReleaseArtifact(
  release,
  release.manifest.publicValuePolicy,
)));
const reportSchema = JSON.parse(await readFile(
  new URL("../../contracts/shacl-validation-report.v1.schema.json", import.meta.url),
  "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateReport = ajv.compile(reportSchema);

function scanReleasePublicGraph(
  store,
  maxFindings = release.manifest.limits.maxValidationResults,
) {
  return scanPublicGraph(
    store,
    release.manifest.limits,
    maxFindings,
    publicValuePolicy,
  );
}

async function filesRecursively(root, suffix) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await filesRecursively(candidate, suffix));
    else if (entry.name.endsWith(suffix)) found.push(candidate);
  }
  return found.sort();
}

test("CT-SEM-001: the release manifest pins DCAT-AP 3.0.1 and separates mobilityDCAT-AP", () => {
  assert.equal(release.manifest.status, "working-draft");
  assert.equal(
    release.manifest.normativeBase.dcatAp,
    "https://semiceu.github.io/DCAT-AP/releases/3.0.1/",
  );
  assert.equal(
    release.manifest.spatialModule.geodcatAp,
    "https://semiceu.github.io/GeoDCAT-AP/releases/3.1.0/",
  );
  assert.match(release.manifest.informativeOnly.reason, /DCAT-AP 2[.]0[.]1/u);
  assert.ok(!release.manifest.profiles["core-publication"].shapes.some((item) => (
    item.includes("mdr-vocabularies")
  )));
  assert.ok(release.manifest.profiles["eu-controlled-audit"].shapes.some((item) => (
    item.includes("mdr-vocabularies")
  )));
  assert.equal(release.manifest.profiles.geo.kind, "conformance");
  assert.equal(
    release.manifest.profiles.geo.conformanceIri,
    "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/geo",
  );
  assert.ok(!release.manifest.profiles.geo.shapes.some((item) => (
    item.includes("/dcat-ap-3.0.1/dcat-ap-SHACL.ttl")
  )));
  assert.deepEqual(Object.keys(release.manifest.publishedBundles).sort(), [
    "core",
    "geo",
    "support",
  ]);
});

test("CT-SEM-002: every vendored upstream artifact matches the SHA-256 lock", async () => {
  const verification = await verifyArtifactLock(release);
  assert.deepEqual(
    verification.results.map((item) => item.path).sort(),
    await listReleaseMachineArtifacts(release),
  );
  assert.ok(verification.results.length >= 30);
  assert.ok(verification.results.every((item) => item.valid));
  assert.equal(verification.lock.networkFetchAtRuntime, false);
});

// FR-SEM-003은 외부 artifact의 source URL·version·license·SHA-256 고정을
// 요구한다. 기존 CT-SEM-002는 SHA-256 대조만 단언했고 version·license·
// origin 필드는 어디에서도 단언되지 않았다.
test("CT-SEM-002: every locked artifact pins version and license; external artifacts pin their source URL", async () => {
  const verification = await verifyArtifactLock(release);
  let externalCount = 0;
  for (const artifact of verification.lock.artifacts) {
    assert.ok(
      typeof artifact.version === "string" && artifact.version.length > 0,
      `artifact version must be pinned: ${artifact.path}`,
    );
    assert.ok(
      typeof artifact.license === "string" && artifact.license.length > 0,
      `artifact license must be pinned: ${artifact.path}`,
    );
    const isExternal = artifact.upstream !== undefined || artifact.source !== undefined;
    if (isExternal) {
      externalCount += 1;
      // 외부 artifact는 FR-SEM-003이 요구하는 source URL로 고정된다.
      assert.match(
        String(artifact.source),
        /^https:\/\//u,
        `external artifact must pin an https source URL: ${artifact.path}`,
      );
    } else {
      assert.ok(
        typeof artifact.origin === "string" && artifact.origin.length > 0,
        `local artifact must declare its origin: ${artifact.path}`,
      );
    }
  }
  // upstream SHACL 등 외부 artifact가 실제로 존재해야 이 검사가 의미를 가진다.
  assert.ok(externalCount >= 1, "the lock must contain at least one external artifact");
});

test(
  "CT-SEM-002(축 유보): verifier는 version·license가 빠진 lock 항목을 거부해야 한다",
  { todo: "verifyArtifactLock은 sha256·경로 완전성만 강제하고 version·license 필드 부재를 거부하지 않는다. lock JSON schema도 contracts/에 없다(GAP-IMPL-04)" },
  () => {},
);

test("CT-SEM-003: every Turtle artifact and example parses in strict Turtle mode", async () => {
  const files = await filesRecursively(release.releaseRoot, ".ttl");
  assert.ok(files.length >= 20);
  for (const file of files) {
    const quads = new Parser({ format: "text/turtle" }).parse(await readFile(file, "utf8"));
    assert.ok(quads.length > 0, path.relative(release.releaseRoot, file));
  }
  const shapeFiles = files.filter((file) => file.includes(`${path.sep}shacl${path.sep}`));
  for (const file of shapeFiles) {
    const turtle = await readFile(file, "utf8");
    assert.equal(turtle.includes("sh:sparql"), false, path.relative(release.releaseRoot, file));
    assert.equal(turtle.includes("shacl:sparql"), false, path.relative(release.releaseRoot, file));
  }
});

test("CT-PROFILE-ROUTING-001: Core routing covers the pinned Geo vocabularies", async () => {
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const shTargetClass = "http://www.w3.org/ns/shacl#targetClass";
  const shTargetSubjectsOf = "http://www.w3.org/ns/shacl#targetSubjectsOf";
  const geoNamespace = "http://www.opengis.net/ont/geosparql#";
  const geodcatNamespace = "http://data.europa.eu/930/";
  const propertyTypes = new Set([
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property",
    "http://www.w3.org/2002/07/owl#DatatypeProperty",
    "http://www.w3.org/2002/07/owl#ObjectProperty",
  ]);
  const classTypes = new Set([
    "http://www.w3.org/2000/01/rdf-schema#Class",
    "http://www.w3.org/2002/07/owl#Class",
  ]);
  const geoVocabulary = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.routingVocabularySources.geosparql11),
    "utf8",
  )));
  const expectedClasses = new Set();
  const expectedProperties = new Set();
  for (const statement of geoVocabulary.getQuads(null, rdfType, null, null)) {
    if (!statement.subject.value.startsWith(geoNamespace)) continue;
    if (classTypes.has(statement.object.value)) expectedClasses.add(statement.subject.value);
    if (propertyTypes.has(statement.object.value)) expectedProperties.add(statement.subject.value);
  }
  assert.equal(expectedClasses.size, 6);
  assert.equal(expectedProperties.size, 54);

  const coreRouting = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, "shacl/molit-core-profile.ttl"),
    "utf8",
  )));
  const geoShape = namedNode(
    "https://data.molit.go.kr/shape/molit-dcat-ap/0.1.0#CoreRejectsGeoSparql11Shape",
  );
  assert.deepEqual(
    new Set(coreRouting.getObjects(geoShape, shTargetClass, null).map((term) => term.value)),
    expectedClasses,
  );
  assert.deepEqual(
    new Set(coreRouting.getObjects(geoShape, shTargetSubjectsOf, null).map((term) => term.value)),
    expectedProperties,
  );

  const geodcatShapes = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(
      release,
      "shacl/upstream/geodcat-ap-3.1.0/geodcat-ap-SHACL.ttl",
    ),
    "utf8",
  )));
  const expectedGeodcatTerms = new Set();
  for (const statement of geodcatShapes) {
    for (const term of [statement.subject, statement.predicate, statement.object]) {
      if (term.termType === "NamedNode" && term.value.startsWith(geodcatNamespace)) {
        expectedGeodcatTerms.add(term.value);
      }
    }
  }
  const profileShape = namedNode(
    "https://data.molit.go.kr/shape/molit-dcat-ap/0.1.0#CoreRejectsGeoProfileSubjectShape",
  );
  const routedGeodcatTerms = new Set(coreRouting
    .getObjects(profileShape, shTargetSubjectsOf, null)
    .map((term) => term.value)
    .filter((value) => value.startsWith(geodcatNamespace)));
  assert.equal(expectedGeodcatTerms.size, 15);
  assert.deepEqual(routedGeodcatTerms, expectedGeodcatTerms);
  assert.ok(coreRouting.getObjects(profileShape, shTargetSubjectsOf, null).some((term) => (
    term.value === "https://data.molit.go.kr/def/molit-dcat-ap#networkReference"
  )));
});

test("CT-PROFILE-ROUTING-002: GeoSPARQL datatype-only use cannot bypass Core routing", () => {
  const datatypes = [
    "dggsLiteral",
    "geoJSONLiteral",
    "gmlLiteral",
    "kmlLiteral",
    "wktLiteral",
  ];
  const store = new Store(datatypes.map((name, index) => quad(
    namedNode(`https://data.molit.go.kr/id/test/geo-datatype-${index}`),
    namedNode("http://www.w3.org/2000/01/rdf-schema#label"),
    literal("probe", namedNode(`http://www.opengis.net/ont/geosparql#${name}`)),
  )));
  const core = scanCoreProfileRouting(store, "core", 10);
  assert.equal(core.findings.length, 5);
  assert.ok(core.findings.every((finding) => (
    finding.requirementId === "MOLIT-PROFILE-SELECTION-001"
  )));
  assert.deepEqual(
    scanCoreProfileRouting(store, "geo", 10),
    { findings: [], limitReached: false },
  );

  const lookalike = new Store([quad(
    namedNode("https://data.molit.go.kr/id/test/lookalike"),
    namedNode("http://www.w3.org/2000/01/rdf-schema#label"),
    literal("probe", namedNode("https://example.test/geosparql#Geometry")),
  )]);
  assert.deepEqual(
    scanCoreProfileRouting(lookalike, "core", 10),
    { findings: [], limitReached: false },
  );
});

test("CT-SEM-004: the JSON-LD context is local, protected and has no remote import", async () => {
  const context = JSON.parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.context),
    "utf8",
  ));
  assert.equal(context["@context"]["@protected"], true);
  assert.equal(context["@context"]["@version"], 1.1);
  assert.equal(JSON.stringify(context).includes('"@import"'), false);
  const expectedTerms = {
    networkAuthority: "molit:networkAuthority",
    networkElementType: "molit:networkElementType",
    networkIdentifier: "molit:networkIdentifier",
    networkReference: "molit:networkReference",
    networkVersion: "molit:networkVersion",
    qualityStatus: "molit:qualityStatus",
    spatialDisclosureLevel: "molit:spatialDisclosureLevel",
  };
  for (const [term, iri] of Object.entries(expectedTerms)) {
    const definition = context["@context"][term];
    assert.equal(typeof definition === "string" ? definition : definition?.["@id"], iri, term);
  }
  assert.equal(context["@context"].networkAuthority["@type"], "@id");
  assert.equal(context["@context"].referenceSystem["@id"], "geodcatap:referenceSystem");
});

test("CT-SEM-MAILBOX-001: JSON policy and RDF support registry contain the same mailboxes", async () => {
  const registryPath = "vocabulary/approved-role-mailboxes.ttl";
  assert.ok(release.manifest.background.includes(registryPath));
  const registry = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, registryPath),
    "utf8",
  )));
  const registered = registry
    .getSubjects(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      "http://www.w3.org/2006/vcard/ns#Email",
      null,
    )
    .map((term) => term.value)
    .sort();
  assert.deepEqual(registered, [...publicValuePolicy.allowedRoleMailboxes].sort());
});

test("CT-SEM-PROF-001: stable and versioned Core and Geo profile IRIs have lineage", async () => {
  const description = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.profileDescription),
    "utf8",
  )));
  const dctHasVersion = "http://purl.org/dc/terms/hasVersion";
  const dctIsVersionOf = "http://purl.org/dc/terms/isVersionOf";
  const pairs = [
    [release.manifest.profileIri, release.manifest.versionIri],
    [release.manifest.geoProfileIri, release.manifest.profiles.geo.conformanceIri],
  ];
  for (const [stable, versioned] of pairs) {
    assert.equal(description.countQuads(stable, dctHasVersion, versioned, null), 1);
    assert.equal(description.countQuads(versioned, dctIsVersionOf, stable, null), 1);
  }
});

// FR-SEM-001은 profile만이 아니라 ontology·concept scheme 자원에도 stable
// IRI와 불변 version IRI의 구분을 요구한다. PROF-001은 profile 종류만
// 단언했다. shape·instance 종류의 판 불변성은 artifact lock digest가
// 고정한다(CT-SEM-002).
test("CT-SEM-PROF-002: ontology and vendored vocabulary declare distinct stable and version IRIs", async () => {
  const owlVersionIri = namedNode("http://www.w3.org/2002/07/owl#versionIRI");
  const ontologyStore = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.ontology),
    "utf8",
  )));
  const ontologyVersions = ontologyStore.getQuads(
    namedNode("https://data.molit.go.kr/def/molit-dcat-ap"),
    owlVersionIri,
    null,
    null,
  );
  assert.equal(ontologyVersions.length, 1, "the local ontology must declare exactly one version IRI");
  assert.notEqual(
    ontologyVersions[0].object.value,
    "https://data.molit.go.kr/def/molit-dcat-ap",
    "the version IRI must differ from the stable IRI",
  );
  assert.ok(ontologyVersions[0].object.value.startsWith("https://data.molit.go.kr/def/molit-dcat-ap/"));

  const vocabularyStore = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, "vocabulary/mobilitydcat-transport-mode-1.0.0.ttl"),
    "utf8",
  )));
  const vocabularyVersions = vocabularyStore.getQuads(null, owlVersionIri, null, null);
  assert.equal(vocabularyVersions.length, 1, "the vendored vocabulary must pin exactly one version IRI");
  assert.notEqual(vocabularyVersions[0].subject.value, vocabularyVersions[0].object.value);
});

test("CT-SEM-005: local ontology avoids identity overclaims and runtime imports", async () => {
  const localFiles = [
    release.manifest.ontology,
    ...release.manifest.background.filter((item) => (
      !item.includes("mobilitydcat-transport-mode")
    )),
    ...release.manifest.profiles.core.shapes.filter((item) => item.startsWith("shacl/molit-")),
  ];
  const store = new Store();
  for (const relativePath of [...new Set(localFiles)]) {
    store.addQuads(new Parser().parse(await readFile(
      resolveReleaseArtifact(release, relativePath),
      "utf8",
    )));
  }
  for (const predicate of [
    "http://www.w3.org/2002/07/owl#sameAs",
    "http://www.w3.org/2002/07/owl#equivalentClass",
    "http://www.w3.org/2002/07/owl#equivalentProperty",
    "http://www.w3.org/2002/07/owl#imports",
    "http://www.w3.org/ns/shacl#deactivated",
  ]) {
    assert.equal(store.countQuads(null, namedNode(predicate), null, null), 0, predicate);
  }
});

test("CT-SEM-006: every local node shape carries a requirement ID and control owner", async () => {
  const store = new Store();
  for (const relativePath of [
    "shacl/molit-core.ttl",
    "shacl/molit-core-profile.ttl",
    "shacl/molit-controlled-vocabularies.ttl",
    "shacl/molit-geo-profile.ttl",
    "shacl/molit-spatial.ttl",
    "shacl/molit-network.ttl",
    "shacl/molit-quality.ttl",
    "shacl/molit-recommended.ttl",
  ]) {
    store.addQuads(new Parser().parse(await readFile(
      resolveReleaseArtifact(release, relativePath),
      "utf8",
    )));
  }
  const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const nodeShape = namedNode("http://www.w3.org/ns/shacl#NodeShape");
  const requirementId = namedNode("https://data.molit.go.kr/def/molit-dcat-ap#requirementId");
  const owner = namedNode("https://data.molit.go.kr/def/molit-dcat-ap#controlOwner");
  const shapes = store.getSubjects(rdfType, nodeShape, null).filter((term) => (
    term.termType === "NamedNode" && term.value.startsWith("https://data.molit.go.kr/shape/")
  ));
  assert.ok(shapes.length >= 14);
  for (const shape of shapes) {
    assert.equal(store.countQuads(shape, requirementId, null, null), 1, shape.value);
    assert.equal(store.countQuads(shape, owner, null, null), 1, shape.value);
  }
});

test("CT-SEM-006A: local shapes conform to the pinned W3C SHACL-SHACL graph", async () => {
  const parser = new Parser({ format: "text/turtle" });
  const localShapes = new Store();
  for (const relativePath of [
    "shacl/molit-core.ttl",
    "shacl/molit-core-profile.ttl",
    "shacl/molit-controlled-vocabularies.ttl",
    "shacl/molit-geo-profile.ttl",
    "shacl/molit-spatial.ttl",
    "shacl/molit-network.ttl",
    "shacl/molit-quality.ttl",
    "shacl/molit-recommended.ttl",
  ]) {
    localShapes.addQuads(parser.parse(await readFile(
      resolveReleaseArtifact(release, relativePath),
      "utf8",
    )));
  }
  const metaShapes = new Store(parser.parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.shapeMetaValidation.shaclShacl),
    "utf8",
  )));
  const report = await new SHACLValidator(metaShapes).validate(localShapes);
  assert.equal(report.conforms, true, JSON.stringify(report.results.map((result) => ({
    focusNode: result.focusNode?.value,
    messages: result.message?.map((message) => message.value),
    path: result.path?.value,
    value: result.value?.value,
  })), null, 2));
  for (const bundleName of ["core", "geo"]) {
    const bundle = new Store(parser.parse(await readFile(
      resolveReleaseArtifact(release, release.manifest.publishedBundles[bundleName]),
      "utf8",
    )));
    const bundleReport = await new SHACLValidator(metaShapes).validate(bundle);
    assert.equal(
      bundleReport.conforms,
      true,
      `${bundleName}: ${JSON.stringify(bundleReport.results.map((result) => ({
        focusNode: result.focusNode?.value,
        messages: result.message?.map((message) => message.value),
        path: result.path?.value,
        value: result.value?.value,
      })), null, 2)}`,
    );
  }
});

test("CT-SEM-006B: SHACL-SHACL rejects a PropertyShape without sh:path", async () => {
  const parser = new Parser({ format: "text/turtle" });
  const metaShapes = new Store(parser.parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.shapeMetaValidation.shaclShacl),
    "utf8",
  )));
  const malformed = new Store(parser.parse(`
    @prefix ex: <https://data.molit.go.kr/id/test/> .
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    ex:BrokenPropertyShape a sh:PropertyShape ; sh:minCount 1 .
  `));
  const report = await new SHACLValidator(metaShapes).validate(malformed);
  assert.equal(report.conforms, false);
  assert.ok(report.results.length > 0);
});

test("CT-SEM-007: local ontology terms and SKOS concepts meet bilingual integrity rules", async () => {
  const parser = new Parser();
  const ontology = new Store(parser.parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.ontology),
    "utf8",
  )));
  const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const rdfsLabel = namedNode("http://www.w3.org/2000/01/rdf-schema#label");
  const skosDefinition = namedNode("http://www.w3.org/2004/02/skos/core#definition");
  const termTypes = new Set([
    "http://www.w3.org/2002/07/owl#Class",
    "http://www.w3.org/2002/07/owl#ObjectProperty",
    "http://www.w3.org/2002/07/owl#DatatypeProperty",
  ]);
  const terms = [...new Map(ontology.getQuads(null, rdfType, null, null)
    .filter((quad) => (
      quad.subject.termType === "NamedNode"
      && quad.subject.value.startsWith("https://data.molit.go.kr/def/molit-dcat-ap#")
      && termTypes.has(quad.object.value)
    ))
    .map((quad) => [quad.subject.value, quad.subject])).values()];
  assert.ok(terms.length >= 10);
  for (const term of terms) {
    const languages = new Set(ontology.getObjects(term, rdfsLabel, null).map((label) => label.language));
    assert.ok(languages.has("ko"), `${term.value} has no Korean label`);
    assert.ok(languages.has("en"), `${term.value} has no English label`);
    const definitionLanguages = new Set(
      ontology.getObjects(term, skosDefinition, null).map((definition) => definition.language),
    );
    assert.ok(definitionLanguages.has("ko"), `${term.value} has no Korean definition`);
    assert.ok(definitionLanguages.has("en"), `${term.value} has no English definition`);
  }

  const vocabulary = new Store();
  for (const relativePath of [
    "vocabulary/molit-domain.ttl",
    "vocabulary/network-element-type.ttl",
    "vocabulary/quality.ttl",
    "vocabulary/spatial-disclosure-level.ttl",
  ]) {
    vocabulary.addQuads(parser.parse(await readFile(
      resolveReleaseArtifact(release, relativePath),
      "utf8",
    )));
  }
  const conceptClass = namedNode("http://www.w3.org/2004/02/skos/core#Concept");
  const definition = namedNode("http://www.w3.org/2004/02/skos/core#definition");
  const inScheme = namedNode("http://www.w3.org/2004/02/skos/core#inScheme");
  const prefLabel = namedNode("http://www.w3.org/2004/02/skos/core#prefLabel");
  const concepts = vocabulary.getSubjects(rdfType, conceptClass, null);
  assert.ok(concepts.length >= 25);
  for (const concept of concepts) {
    assert.equal(vocabulary.getObjects(concept, inScheme, null).length, 1, concept.value);
    const labels = vocabulary.getObjects(concept, prefLabel, null);
    assert.equal(labels.filter((label) => label.language === "ko").length, 1, concept.value);
    assert.equal(labels.filter((label) => label.language === "en").length, 1, concept.value);
    const definitions = vocabulary.getObjects(concept, definition, null);
    assert.equal(definitions.filter((item) => item.language === "ko").length, 1, concept.value);
    assert.equal(definitions.filter((item) => item.language === "en").length, 1, concept.value);
  }
});

for (const profileName of ["geo", "geo-publication"]) {
  test(`CT-SHACL-VALID-${profileName}: the reference graph passes ${profileName}`, async () => {
    const report = await validateProfileDocument({
      inputPath: validExample,
      profileName,
    });
    assert.equal(report.summary.gatePassed, true);
    assert.equal(report.summary.shaclConforms, true);
    assert.deepEqual(report.summary.counts, { Info: 0, Violation: 0, Warning: 0 });
    assert.equal(report.authority.publicationAuthorized, false);
    assert.match(report.decisionDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(report.engine.molitValidatorBuildDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(report.engine.reportSchemaDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(
      report.profile.conformanceIri,
      "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/geo",
    );
    assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  });
}

for (const profileName of ["core", "core-publication"]) {
  test(`CT-SHACL-VALID-OBS-${profileName}: an observation catalogue passes ${profileName}`, async () => {
    const report = await validateProfileDocument({
      inputPath: path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl"),
      profileName,
    });
    assert.equal(report.summary.gatePassed, true, JSON.stringify(report.results, null, 2));
    assert.deepEqual(report.summary.counts, { Info: 0, Violation: 0, Warning: 0 });
    assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  });
}

test("CT-PROFILE-SELECTION-001: core and Geo graphs cannot select the other profile", async () => {
  const [geoAsCore, coreAsGeo] = await Promise.all([
    validateProfileDocument({ inputPath: validExample, profileName: "core" }),
    validateProfileDocument({
      inputPath: path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl"),
      profileName: "geo",
    }),
  ]);
  assert.equal(geoAsCore.summary.gatePassed, false);
  assert.ok(geoAsCore.results.some((result) => (
    result.requirementId === "MOLIT-PROFILE-SELECTION-001"
  )));
  assert.equal(coreAsGeo.summary.gatePassed, false);
  assert.ok(coreAsGeo.results.some((result) => (
    result.requirementId === "MOLIT-GEO-PROFILE-001"
      || result.requirementId === "MOLIT-GEO-PROFILE-002"
  )));
});

test("CT-PROFILE-SELECTION-002: exact-one marker and spatial downgrade rules fail closed", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-selection-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const coreSource = await readFile(
    path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl"),
    "utf8",
  );
  const coreIri = "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0";
  const geoIri = `${coreIri}/geo`;

  const bothPath = path.join(directory, "both-markers.ttl");
  await writeFile(bothPath, coreSource.replaceAll(
    `<${coreIri}>`,
    `<${coreIri}>, <${geoIri}>`,
  ));
  for (const profileName of ["core", "geo"]) {
    const report = await validateProfileDocument({ inputPath: bothPath, profileName });
    assert.equal(report.summary.gatePassed, false, profileName);
  }

  const legacyPath = path.join(directory, "current-and-legacy-markers.ttl");
  await writeFile(legacyPath, coreSource.replaceAll(
    `<${coreIri}>`,
    `<${coreIri}>, <https://data.molit.go.kr/profile/molit-dcat-ap/0.0.9>`,
  ));
  const legacy = await validateProfileDocument({ inputPath: legacyPath, profileName: "core" });
  assert.equal(legacy.summary.gatePassed, false);
  assert.ok(legacy.results.some((result) => (
    result.requirementId === "MOLIT-PROFILE-CORE-001"
      || result.requirementId === "MOLIT-PROFILE-CORE-002"
  )));

  for (const [index, alias] of [
    "https://DATA.MOLIT.GO.KR/profile/molit-dcat-ap/0.1.0/geo",
    "https://data.molit.go.kr:443/profile/molit-dcat-ap/0.1.0/geo",
    "https://data.molit.go.kr./profile/molit-dcat-ap/0.1.0/geo",
    "https://data.molit.go.kr/%70rofile/molit-dcat-ap/0.1.0/geo",
  ].entries()) {
    const aliasPath = path.join(directory, `marker-alias-${index}.ttl`);
    await writeFile(aliasPath, `${coreSource.replaceAll(
      `<${coreIri}>`,
      `<${coreIri}>, <${alias}>`,
    )}\n<${alias}> a <http://purl.org/dc/terms/Standard> .\n`);
    const aliasReport = await validateProfileDocument({ inputPath: aliasPath, profileName: "core" });
    assert.equal(aliasReport.summary.gatePassed, false);
    assert.ok(aliasReport.results.some((result) => (
      result.requirementId === "MOLIT-PROFILE-MARKER-003"
        || result.requirementId === "MOLIT-PROFILE-CORE-001"
        || result.requirementId === "MOLIT-PROFILE-CORE-002"
    )), alias);
  }

  const mixedPath = path.join(directory, "mixed-markers.ttl");
  await writeFile(mixedPath, coreSource.replace(`<${coreIri}>`, `<${geoIri}>`));
  for (const profileName of ["core", "geo"]) {
    const report = await validateProfileDocument({ inputPath: mixedPath, profileName });
    assert.equal(report.summary.gatePassed, false, profileName);
  }

  const disguisedSpatialPath = path.join(directory, "spatial-with-core-marker.ttl");
  const geoSource = await readFile(validExample, "utf8");
  await writeFile(disguisedSpatialPath, geoSource.replaceAll(`<${geoIri}>`, `<${coreIri}>`));
  const disguised = await validateProfileDocument({
    inputPath: disguisedSpatialPath,
    profileName: "core",
  });
  assert.equal(disguised.summary.gatePassed, false);
  assert.ok(disguised.results.some((result) => (
    result.requirementId === "MOLIT-PROFILE-SELECTION-001"
  )));
});

test("CT-GEO-CRS-001: resource CRS multiplicity and coverage-literal CRS are independent", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-crs-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const source = await readFile(validExample, "utf8");
  const property = "    geodcatap:referenceSystem <http://www.opengis.net/def/crs/OGC/1.3/CRS84> ;";
  const cases = [
    source.replace(property, "    geodcatap:referenceSystem <http://www.opengis.net/def/crs/EPSG/0/5179> ;"),
    source.replace(property, [
      "    geodcatap:referenceSystem <http://www.opengis.net/def/crs/OGC/1.3/CRS84>,",
      "        <http://www.opengis.net/def/crs/EPSG/0/5179> ;",
    ].join("\n")),
  ];
  for (const [index, content] of cases.entries()) {
    const inputPath = path.join(directory, `valid-crs-${index}.ttl`);
    await writeFile(inputPath, content);
    const report = await validateProfileDocument({ inputPath, profileName: "geo" });
    assert.equal(report.summary.gatePassed, true, JSON.stringify(report.results, null, 2));
  }
});

test("CT-KR-CRS-001: verified Korean CRS identifiers are source references, not unchecked geometry claims", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-kr-crs-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const source = await readFile(validExample, "utf8");
  const reference = "    geodcatap:referenceSystem <http://www.opengis.net/def/crs/OGC/1.3/CRS84> ;";
  for (const code of [4737, 5179, 5185, 5186, 5187, 5188]) {
    const inputPath = path.join(directory, `source-reference-${code}.ttl`);
    await writeFile(inputPath, source.replace(
      reference,
      `    geodcatap:referenceSystem <http://www.opengis.net/def/crs/EPSG/0/${code}> ;`,
    ));
    const report = await validateProfileDocument({ inputPath, profileName: "geo" });
    assert.equal(report.summary.gatePassed, true, `${code}: ${JSON.stringify(report.results)}`);
  }

  const legacyAliasPath = path.join(directory, "legacy-alias-102080.ttl");
  await writeFile(legacyAliasPath, source.replace(
    reference,
    "    geodcatap:referenceSystem <http://www.opengis.net/def/crs/EPSG/0/102080> ;",
  ));
  const legacyAlias = await validateProfileDocument({
    inputPath: legacyAliasPath,
    profileName: "geo",
  });
  assert.equal(legacyAlias.summary.gatePassed, false);
  assert.ok(legacyAlias.results.some((result) => result.requirementId === "MOLIT-GEO-001"));

  const uncheckedGeometryPath = path.join(directory, "unchecked-epsg-5186-geometry.ttl");
  await writeFile(uncheckedGeometryPath, source.replaceAll(
    "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    "http://www.opengis.net/def/crs/EPSG/0/5186",
  ));
  const uncheckedGeometry = await validateProfileDocument({
    inputPath: uncheckedGeometryPath,
    profileName: "geo",
  });
  assert.equal(uncheckedGeometry.summary.gatePassed, false);
  assert.ok(uncheckedGeometry.results.some((result) => (
    result.requirementId?.startsWith("MOLIT-GEO-ENCODING-")
  )));
});

test("ST-GEO-WITHHELD-001: every blocked spatial predicate rejects direct and one-hop serialization", async () => {
  const spatialShapes = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, "shacl/molit-spatial.ttl"),
    "utf8",
  )));
  const blockedPredicates = [
    "http://purl.org/dc/terms/spatial",
    "http://www.w3.org/ns/dcat#bbox",
    "http://www.w3.org/ns/dcat#centroid",
    "http://www.w3.org/ns/locn#geometry",
    "http://www.opengis.net/ont/geosparql#defaultGeometry",
    "http://www.opengis.net/ont/geosparql#hasDefaultGeometry",
    "http://www.opengis.net/ont/geosparql#hasGeometry",
    "http://www.opengis.net/ont/geosparql#hasBoundingBox",
    "http://www.opengis.net/ont/geosparql#hasCentroid",
    "http://www.opengis.net/ont/geosparql#hasSerialization",
    "http://www.opengis.net/ont/geosparql#asWKT",
    "http://www.opengis.net/ont/geosparql#asGML",
    "http://www.opengis.net/ont/geosparql#asGeoJSON",
    "http://www.opengis.net/ont/geosparql#asKML",
    "http://www.opengis.net/ont/geosparql#asDGGS",
  ];
  const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const datasetType = namedNode("http://www.w3.org/ns/dcat#Dataset");
  const disclosurePredicate = namedNode(
    "https://data.molit.go.kr/def/molit-dcat-ap#spatialDisclosureLevel",
  );
  const withheld = namedNode(
    "https://data.molit.go.kr/id/concept/spatial-disclosure-level/withheld",
  );
  const asWkt = namedNode("http://www.opengis.net/ont/geosparql#asWKT");
  const wktDatatype = namedNode("http://www.opengis.net/ont/geosparql#wktLiteral");
  const disclosureShape = [
    "https://data.molit.go.kr/shape/molit-dcat-ap/0.1.0",
    "#SpatialDisclosureSafetyShape",
  ].join("");

  for (const [index, predicateValue] of blockedPredicates.entries()) {
    for (const mode of ["direct", "one-hop-serialization"]) {
      const subject = namedNode(`https://data.molit.go.kr/id/test/withheld-${index}-${mode}`);
      const geometry = namedNode(`https://data.molit.go.kr/id/test/geometry-${index}-${mode}`);
      const data = new Store([
        quad(subject, rdfType, datasetType),
        quad(subject, disclosurePredicate, withheld),
        quad(subject, namedNode(predicateValue), geometry),
      ]);
      if (mode === "one-hop-serialization") {
        data.addQuad(quad(
          geometry,
          asWkt,
          literal(
            "<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POINT(127 37)",
            wktDatatype,
          ),
        ));
      }

      const report = await new SHACLValidator(spatialShapes).validate(data);
      assert.equal(report.conforms, false, `${mode}: ${predicateValue}`);
      assert.ok(report.results.some((result) => (
        result.focusNode?.value === subject.value
          && result.sourceShape?.value === disclosureShape
      )), `${mode}: ${predicateValue}`);
    }
  }
});

test("ST-CHECKSUM-001: SPDX checksum length and lowercase lexical form match the SHA algorithm", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-checksum-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const source = await readFile(validExample, "utf8");
  const originalDigest = "8f9b1f8e7f0833dfc5b9ce0b3a7a53bd6c74e0d13f27a5b4b82fe2d271d6a7de";
  const makeCase = (algorithm, digest) => source
    .replaceAll("checksumAlgorithm_sha256", `checksumAlgorithm_${algorithm}`)
    .replace(originalDigest, digest);

  for (const [algorithm, digest] of [
    ["sha256", "a".repeat(64)],
    ["sha384", "b".repeat(96)],
    ["sha512", "c".repeat(128)],
  ]) {
    const inputPath = path.join(directory, `valid-${algorithm}.ttl`);
    await writeFile(inputPath, makeCase(algorithm, digest));
    const report = await validateProfileDocument({ inputPath, profileName: "geo" });
    assert.equal(report.summary.gatePassed, true, JSON.stringify(report.results, null, 2));
  }

  for (const [name, algorithm, digest] of [
    ["too-short", "sha256", "00"],
    ["uppercase", "sha256", "A".repeat(64)],
    ["sha384-with-sha256-length", "sha384", "a".repeat(64)],
    ["sha512-too-short", "sha512", "a".repeat(126)],
  ]) {
    const inputPath = path.join(directory, `${name}.ttl`);
    await writeFile(inputPath, makeCase(algorithm, digest));
    const report = await validateProfileDocument({ inputPath, profileName: "geo" });
    assert.equal(report.summary.gatePassed, false, name);
    assert.ok(report.results.some((result) => (
      result.requirementId === "MOLIT-CV-CHECKSUM-002"
        || result.requirementId === "MOLIT-SEM-DATATYPE-001"
    )), JSON.stringify(report.results, null, 2));
  }
});

const invalidCases = [
  {
    file: "unapproved-geometry-crs.ttl",
    profileName: "geo",
    requirementId: "MOLIT-GEO-ENCODING-003",
  },
  {
    file: "missing-korean-title.ttl",
    requirementId: "MOLIT-DS-001",
    path: "http://purl.org/dc/terms/title",
  },
  {
    file: "literal-access-rights.ttl",
    requirementId: "MOLIT-DS-001",
    path: "http://purl.org/dc/terms/accessRights",
  },
  {
    file: "network-reference-without-version.ttl",
    profileName: "geo",
    requirementId: "MOLIT-NET-REF-001",
    path: "https://data.molit.go.kr/def/molit-dcat-ap#networkVersion",
  },
  {
    file: "private-binding-leak.ttl",
    requirementId: "MOLIT-SEC-PUBLIC-001",
  },
  {
    file: "quality-unit-not-qudt.ttl",
    requirementId: "MOLIT-QUAL-MEASURE-001",
    path: "http://purl.org/linked-data/sdmx/2009/attribute#unitMeasure",
  },
  {
    file: "spoofed-controlled-concept.ttl",
    requirementId: "MOLIT-QUAL-001",
    path: "https://data.molit.go.kr/def/molit-dcat-ap#qualityStatus",
  },
  {
    file: "unapproved-frequency.ttl",
    requirementId: "MOLIT-CV-FREQ-001",
    path: "http://purl.org/dc/terms/accrualPeriodicity",
  },
  {
    file: "unapproved-iana-media-type.ttl",
    requirementId: "MOLIT-CV-MEDIATYPE-001",
    path: "http://www.w3.org/ns/dcat#mediaType",
  },
  {
    file: "rogue-theme.ttl",
    requirementId: "MOLIT-DS-001",
    path: "http://www.w3.org/ns/dcat#theme",
  },
  {
    file: "relative-iri.ttl",
    requirementId: "MOLIT-SEC-PUBLIC-004",
  },
  {
    file: "withheld-spatial-geometry.ttl",
    profileName: "geo",
    requirementId: "MOLIT-GEO-DISCLOSURE-001",
  },
  {
    file: "wkt-without-crs.ttl",
    profileName: "geo",
    requirementId: "MOLIT-GEO-ENCODING-003",
  },
];

for (const invalid of invalidCases) {
  test(`CT-SHACL-INVALID-${invalid.file}: the intended violation is reported`, async () => {
    const report = await validateProfileDocument({
      inputPath: path.join(exampleRoot, "invalid", invalid.file),
      profileName: invalid.profileName ?? "core",
    });
    assert.equal(report.summary.gatePassed, false);
    assert.ok(report.summary.counts.Violation >= 1);
    assert.ok(report.results.some((result) => (
      result.requirementId === invalid.requirementId
      && (invalid.path === undefined || result.path === invalid.path)
    )), JSON.stringify(report.results, null, 2));
    assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  });
}

test("CT-SHACL-CLI-001: CLI returns 0 for valid and 2 for rejected graphs", () => {
  const cwd = projectRoot();
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  const valid = spawnSync(process.execPath, [
    cli,
    "validate",
    "--input",
    validExample,
    "--profile",
    "geo",
  ], { cwd, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  const invalid = spawnSync(process.execPath, [
    cli,
    "validate",
    "--input",
    path.join(exampleRoot, "invalid", "private-binding-leak.ttl"),
    "--profile",
    "core",
  ], { cwd, encoding: "utf8" });
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(invalid.stdout.includes("binding://internal-road-store/snapshot"), false);
});

test("CT-SHACL-POLICY-001: a Warning passes Geo conformance and fails publication policy", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-warning-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const inputPath = path.join(directory, "warning-only.ttl");
  const source = await readFile(validExample, "utf8");
  const warningSource = source.replace(
    "    dcat:contactPoint ex:road-data-contact ;\n    dcat:landingPage",
    "    dcat:landingPage",
  );
  await writeFile(inputPath, warningSource);
  const core = await validateProfileDocument({ inputPath, profileName: "geo" });
  const publication = await validateProfileDocument({
    inputPath,
    profileName: "geo-publication",
  });
  assert.equal(core.summary.gatePassed, true, JSON.stringify(core.results, null, 2));
  assert.equal(publication.summary.counts.Warning >= 1, true);
  assert.equal(publication.summary.gatePassed, false);
});

test("CT-SHACL-PUBLISH-001: Working Draft publish-check always fails closed", () => {
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  const checked = spawnSync(process.execPath, [
    cli,
    "publish-check",
    "--input",
    validExample,
    "--profile",
    "geo-publication",
  ], { cwd: projectRoot(), encoding: "utf8" });
  assert.equal(checked.status, 2, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.summary.gatePassed, true);
  assert.equal(report.authority.publicationAuthorized, false);
});

test("CT-SHACL-PUBLISH-002: a spatial graph cannot downgrade to core-publication", () => {
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  const checked = spawnSync(process.execPath, [
    cli,
    "publish-check",
    "--input",
    validExample,
    "--profile",
    "core-publication",
  ], { cwd: projectRoot(), encoding: "utf8" });
  assert.equal(checked.status, 2, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.summary.gatePassed, false);
  assert.ok(report.results.some((result) => (
    result.requirementId === "MOLIT-PROFILE-SELECTION-001"
  )));
});

test("ST-RDF-001: predicate, datatype, RDF-star and non-global URLs fail closed", () => {
  const input = new Store(new Parser({ format: "text/turtle" }).parse(`
    @prefix dct: <http://purl.org/dc/terms/> .
    <https://data.molit.go.kr/id/test/s> <vault://secret/predicate> "x" .
    <https://data.molit.go.kr/id/test/s> dct:type "x"^^<vault://secret/datatype> .
    <https://data.molit.go.kr/id/test/s> dct:references <http://169.254.169.254/latest/meta-data> .
    <https://data.molit.go.kr/id/test/s> dct:references <http://[::1]/admin> .
    <https://data.molit.go.kr/id/test/s> dct:references <https://user:password@example.com/data> .
    << <https://data.molit.go.kr/id/test/s> dct:type <vault://secret/quoted> >> dct:title "quoted" .
  `));
  const scan = scanReleasePublicGraph(input);
  const requirements = new Set(scan.findings.map((finding) => finding.requirementId));
  assert.ok(requirements.has("MOLIT-SEC-PUBLIC-001"));
  assert.ok(requirements.has("MOLIT-SEC-PUBLIC-002"));
  assert.ok(requirements.has("MOLIT-SEC-PUBLIC-003"));
  assert.equal(JSON.stringify(scan).includes("vault://secret"), false);
  assert.equal(JSON.stringify(scan).includes("169.254.169.254"), false);

  const malformedHttp = new Store([
    quad(
      namedNode("https://data.molit.go.kr/id/test/malformed-http"),
      namedNode("http://purl.org/dc/terms/references"),
      namedNode("https://[not-an-ipv6-address]/metadata"),
    ),
  ]);
  const malformedScan = scanReleasePublicGraph(malformedHttp);
  assert.ok(malformedScan.findings.some((finding) => (
    finding.requirementId === "MOLIT-SEC-PUBLIC-001"
  )));
  assert.equal(JSON.stringify(malformedScan).includes("not-an-ipv6-address"), false);
});

test("ST-RDF-002: public safety findings obey the shared result budget", () => {
  const store = new Store();
  for (let index = 0; index < 501; index += 1) {
    store.addQuad(quad(
      namedNode(`https://data.molit.go.kr/id/test/${index}`),
      namedNode(`https://unapproved.example/predicate/${index}`),
      literal("value"),
    ));
  }
  const scan = scanReleasePublicGraph(store, 500);
  assert.equal(scan.findings.length, 500);
  assert.equal(scan.limitReached, true);

  const highCardinality = new Store();
  for (let index = 0; index < 101; index += 1) {
    highCardinality.addQuad(quad(
      namedNode("https://data.molit.go.kr/id/test/high-cardinality"),
      namedNode("http://purl.org/dc/terms/title"),
      literal(`title-${index}`),
    ));
  }
  const cardinalityScan = scanReleasePublicGraph(highCardinality);
  assert.ok(cardinalityScan.findings.some((finding) => (
    finding.requirementId === "MOLIT-SEC-COMPLEXITY-001"
  )));
});

test("ST-RDF-DIAGNOSTIC-001: finding fields never echo embedded credentials", () => {
  const secret = "AKIA1234567890ABCDEF";
  const store = new Store([
    quad(
      blankNode(`focus-${secret}`),
      namedNode(`http://purl.org/dc/terms/x-${secret}`),
      literal("value"),
    ),
  ]);
  const report = scanReleasePublicGraph(store);
  assert.ok(report.findings.length > 0);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("ST-RDF-003: credential IRIs, mapped loopback and public PII fail closed", () => {
  const dctReferences = namedNode("http://purl.org/dc/terms/references");
  const subject = namedNode("https://data.molit.go.kr/id/test/security-values");
  const store = new Store([
    quad(subject, dctReferences, namedNode("data:text/plain,AKIA1234567890123456")),
    quad(subject, dctReferences, namedNode("ssh://user:password@internal-host/private")),
    quad(subject, dctReferences, namedNode(
      "https://storage.example/object?X-Amz-Credential=AKIA1234567890123456&X-Amz-Signature=secret",
    )),
    quad(subject, dctReferences, namedNode(
      "https://storage.example/%2541KIA1234567890123456/object",
    )),
    quad(subject, dctReferences, namedNode("https://[::ffff:127.0.0.1]/metadata")),
    ...[
      "64:ff9b::7f00:1",
      "64:ff9b:1::7f00:1",
      "100::1",
      "100:0:0:1::1",
      "2001:2::1",
      "2001:1::4",
      "2d00::1",
      "3000::1",
      "3ffe::1",
      "3fff::1",
      "5f00::1",
      "fec0::1",
      "feff::1",
    ].map((address) => quad(
      subject,
      dctReferences,
      namedNode(`https://[${address}]/metadata`),
    )),
    quad(
      subject,
      namedNode("http://www.w3.org/ns/dcat#accessURL"),
      namedNode("https://data.molit.go.kr/access?token=secret#fragment"),
    ),
    quad(
      subject,
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("http://xmlns.com/foaf/0.1/Person"),
    ),
    quad(
      subject,
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("http://www.w3.org/ns/prov#Person"),
    ),
    quad(
      subject,
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("https://schema.org/Person"),
    ),
    quad(
      subject,
      namedNode("http://purl.org/dc/terms/description"),
      literal("주민번호 900101-1234567, 전화 010-1234-5678, person@example.com"),
    ),
    quad(
      subject,
      namedNode("http://purl.org/dc/terms/description"),
      literal("외국인번호 900101-5123456, 전화 010.1234.5678, +82 (0)10-1234-5678"),
    ),
    quad(
      subject,
      namedNode("http://purl.org/dc/terms/description"),
      literal("기관전화 0212345678, +82-2-1234-5678, 홍길동@example.com"),
    ),
    quad(
      subject,
      namedNode("http://purl.org/dc/terms/description"),
      literal("token ghp_0123456789abcdefghijklmnopqrstuvwxyz"),
    ),
    quad(
      subject,
      namedNode("http://purl.org/dc/terms/description"),
      literal("temporary credential prefix_ASIA1234567890ABCDEF_suffix"),
    ),
    quad(
      subject,
      namedNode("http://www.w3.org/2006/vcard/ns#hasEmail"),
      namedNode("mailto:person@example.com"),
    ),
  ]);
  const scan = scanReleasePublicGraph(store);
  const requirements = new Set(scan.findings.map((finding) => finding.requirementId));
  assert.ok(requirements.has("MOLIT-SEC-PUBLIC-001"));
  assert.ok(requirements.has("MOLIT-SEC-PUBLIC-005"));
  assert.ok(requirements.has("MOLIT-SEC-PUBLIC-006"));
  const serialized = JSON.stringify(scan);
  for (const secret of [
    "AKIA1234567890123456",
    "900101-1234567",
    "900101-5123456",
    "010-1234-5678",
    "010.1234.5678",
    "+82 (0)10-1234-5678",
    "0212345678",
    "+82-2-1234-5678",
    "홍길동@example.com",
    "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "ASIA1234567890ABCDEF",
    "prefix_ASIA1234567890ABCDEF_suffix",
    "person@example.com",
    "::ffff:7f00:1",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.match(sanitizeDiagnosticValue("900101-1234567"), /^\[redacted:sha256:/u);

  const contact = namedNode("https://data.molit.go.kr/id/test/road-contact");
  const roleMailbox = new Store([
    quad(
      namedNode("https://data.molit.go.kr/id/test/catalog"),
      namedNode("http://www.w3.org/ns/dcat#contactPoint"),
      contact,
    ),
    quad(
      contact,
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("http://www.w3.org/2006/vcard/ns#Kind"),
    ),
    quad(
      contact,
      namedNode("http://www.w3.org/2006/vcard/ns#hasEmail"),
      namedNode("mailto:road-data@data.molit.go.kr"),
    ),
  ]);
  assert.deepEqual(
    scanReleasePublicGraph(roleMailbox),
    { findings: [], limitReached: false },
  );
});

test("ST-RDF-IP-001: HTTP(S) IP literals are rejected regardless of reachability", () => {
  const s = namedNode("https://data.molit.go.kr/id/test/ip-boundary");
  const relation = namedNode("http://purl.org/dc/terms/references");
  for (const host of [
    "8.8.8.8",
    "192.0.0.9",
    "192.0.0.10",
    "2001:1::1",
    "2001:1::2",
    "2001:1::3",
    "2001:3::1",
    "2001:4:112::1",
    "2001:20::1",
    "2001:30::1",
    "2001:200::1",
    "2003::1",
    "2410::1",
    "2620::1",
    "2630::1",
    "2c00::1",
    "192.88.99.1",
    "2001:2::1",
    "2001:4:111::1",
    "2001:10::1",
    "2001:db8::1",
    "2420::1",
    "2640::1",
    "2d00::1",
    "3000::1",
    "3ffe::1",
    "fec0::1",
    "feff::1",
  ]) {
    const bracketed = host.includes(":") ? `[${host}]` : host;
    assert.ok(scanReleasePublicGraph(new Store([
      quad(s, relation, namedNode(`https://${bracketed}/reference`)),
    ])).findings.length > 0, host);
  }
});

test("ST-RDF-HOST-001: public URLs reject internal DNS and unapproved hosts", () => {
  const s = namedNode("https://data.molit.go.kr/id/test/host-boundary");
  const access = namedNode("http://www.w3.org/ns/dcat#accessURL");
  const relation = namedNode("http://purl.org/dc/terms/relation");
  for (const value of [
    "https://intranet/data",
    "https://api.corp/data",
    "https://router.home.arpa/data",
  ]) {
    assert.ok(scanReleasePublicGraph(new Store([
      quad(s, access, namedNode(value)),
    ])).findings.length > 0, value);
  }
  assert.ok(scanReleasePublicGraph(new Store([
    quad(s, relation, namedNode("https://api.corp/internal")),
  ])).findings.length > 0);
  assert.ok(scanReleasePublicGraph(new Store([
    quad(s, access, namedNode("https://www.iana.org/assignments")),
  ])).findings.some((finding) => finding.requirementId === "MOLIT-SEC-PUBLIC-006"));
});

test("ST-RDF-MAILBOX-001: role mailboxes require an exact value and contact context", () => {
  const allowed = namedNode("mailto:road-data@data.molit.go.kr");
  const s = namedNode("https://data.molit.go.kr/id/test/mailbox-negative");
  const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const probes = [
    new Store([quad(s, namedNode("http://purl.org/dc/terms/references"), allowed)]),
    new Store([quad(allowed, rdfType, namedNode("http://www.w3.org/2006/vcard/ns#Email"))]),
    new Store([quad(
      s,
      namedNode("http://www.w3.org/2006/vcard/ns#hasEmail"),
      allowed,
    )]),
    new Store([quad(
      s,
      namedNode("http://purl.org/dc/terms/title"),
      literal("x", allowed),
    )]),
    new Store([quad(s, rdfType, namedNode("http://www.w3.org/2000/01/rdf-schema#Resource"), allowed)]),
  ];
  for (const probe of probes) {
    const report = scanReleasePublicGraph(probe);
    assert.ok(report.findings.length > 0);
    assert.equal(JSON.stringify(report).includes(allowed.value), false);
  }

  const spoofed = new Store([
    quad(s, namedNode("http://www.w3.org/ns/dcat#contactPoint"), s),
    quad(s, rdfType, namedNode("http://www.w3.org/2006/vcard/ns#Kind")),
    quad(
      s,
      namedNode("http://www.w3.org/2006/vcard/ns#hasEmail"),
      namedNode("mailto:road-john@data.molit.go.kr"),
    ),
  ]);
  assert.ok(scanReleasePublicGraph(spoofed).findings.length > 0);
});

test("ST-RDF-TELEPHONE-001: release 0.1.0 rejects every public telephone", () => {
  const s = namedNode("https://data.molit.go.kr/id/test/telephone");
  const telephone = new Store([
    quad(
      s,
      namedNode("http://www.w3.org/2006/vcard/ns#hasTelephone"),
      namedNode("tel:+82-2-1234-5678"),
    ),
  ]);
  const report = scanReleasePublicGraph(telephone);
  assert.ok(report.findings.some((finding) => (
    finding.requirementId === "MOLIT-SEC-PUBLIC-007"
  )));
  assert.equal(JSON.stringify(report).includes("+82-2-1234-5678"), false);
});

test("ST-RDF-UTF8-001: Turtle input uses fatal UTF-8 decoding", async () => {
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.from([0x80]),
    Buffer.from([0xe2, 0x82]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xff, 0xfe]),
  ]) {
    await assert.rejects(
      () => loadRdfBytes(bytes, "invalid.ttl", release.manifest.limits),
      (error) => error.code === "INVALID_UTF8",
    );
  }
  await assert.doesNotReject(() => loadRdfBytes(
    Buffer.from('<https://example.test/s> <http://purl.org/dc/terms/title> "한글😀"@ko .'),
    "valid.ttl",
    release.manifest.limits,
  ));
});

test("ST-RDF-XSD-001: calendar-invalid typed literals fail before SHACL", async (t) => {
  const source = await readFile(
    path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl"),
    "utf8",
  );
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-xsd-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const inputPath = path.join(directory, "calendar-invalid.ttl");
  await writeFile(inputPath, source.replaceAll("2026-07-12", "2026-02-30"), "utf8");

  const report = await validateProfileDocument({ inputPath, profileName: "core" });
  assert.equal(report.summary.gatePassed, false);
  assert.ok(report.results.some((finding) => (
    finding.requirementId === "MOLIT-SEM-DATATYPE-001"
  )));
});

test("ST-PROFILE-UTF8-001: manifest, lock and policy JSON use fatal UTF-8", async (t) => {
  assert.throws(
    () => parsePublicValuePolicy(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])),
    (error) => error.code === "INVALID_UTF8",
  );

  const releasesRoot = path.join(
    projectRoot(),
    "profiles",
    "molit-dcat-ap",
    "releases",
  );
  const manifestVersion = "9.9.9-invalidutf8";
  const manifestRoot = path.join(releasesRoot, manifestVersion);
  await mkdir(manifestRoot, { recursive: true });
  t.after(() => rm(manifestRoot, { force: true, recursive: true }));
  await writeFile(
    path.join(manifestRoot, "manifest.json"),
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
  );
  await assert.rejects(
    loadProfileRelease(manifestVersion),
    (error) => error.code === "INVALID_UTF8",
  );

  const lockVersion = "9.9.8-invalidlock";
  const lockRoot = path.join(releasesRoot, lockVersion);
  await mkdir(lockRoot, { recursive: true });
  t.after(() => rm(lockRoot, { force: true, recursive: true }));
  const copiedManifest = {
    ...release.manifest,
    version: lockVersion,
    versionIri: `${release.manifest.profileIri}/${lockVersion}`,
  };
  await writeFile(
    path.join(lockRoot, "manifest.json"),
    `${JSON.stringify(copiedManifest)}\n`,
  );
  await writeFile(
    path.join(lockRoot, "artifact-lock.json"),
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]),
  );
  const fakeRelease = await loadProfileRelease(lockVersion);
  await assert.rejects(
    verifyArtifactLock(fakeRelease),
    (error) => error.code === "INVALID_UTF8",
  );
});

test("CT-SEM-BUNDLE-001: published SHACL and support graphs match CLI conformance", async () => {
  const support = new Store(new Parser({
    blankNodePrefix: "_:support_",
    format: "text/turtle",
  }).parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.publishedBundles.support),
    "utf8",
  )));
  const cases = [
    ["core", path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl")],
    ["geo", validExample],
  ];
  for (const [bundleName, inputPath] of cases) {
    const input = new Store(new Parser({
      blankNodePrefix: `_:input_${bundleName}_`,
      format: "text/turtle",
    }).parse(await readFile(inputPath, "utf8")));
    input.addQuads(support.getQuads(null, null, null, null));
    const shapes = new Store(new Parser({
      blankNodePrefix: `_:${bundleName}_`,
      format: "text/turtle",
    }).parse(await readFile(
      resolveReleaseArtifact(release, release.manifest.publishedBundles[bundleName]),
      "utf8",
    )));
    const report = await new SHACLValidator(shapes).validate(input);
    assert.equal(report.conforms, true, `${bundleName}: ${JSON.stringify(report.results)}`);
  }
});

test("CT-SEM-BUNDLE-002: SHACL-only validation does not replace the preflight Gate", async () => {
  const token = "AKIA1234567890ABCDEF";
  const source = await readFile(
    path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl"),
    "utf8",
  );
  const candidate = new Store(new Parser().parse(source.replace(
    "시간대별 교통량 관측값을 제공한다.",
    `시간대별 교통량 관측값을 제공한다. ${token}`,
  )));
  const preflight = scanReleasePublicGraph(candidate);
  assert.ok(preflight.findings.some((finding) => (
    finding.requirementId === "MOLIT-SEC-PUBLIC-005"
  )));
  assert.equal(JSON.stringify(preflight).includes(token), false);

  const support = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.publishedBundles.support),
    "utf8",
  )));
  candidate.addQuads(support.getQuads(null, null, null, null));
  const shapes = new Store(new Parser().parse(await readFile(
    resolveReleaseArtifact(release, release.manifest.publishedBundles.core),
    "utf8",
  )));
  const shaclOnly = await new SHACLValidator(shapes).validate(candidate);
  assert.equal(shaclOnly.conforms, true);
});

test("CT-SEM-REPORT-001: repeated validation has a stable decision digest", async () => {
  const first = await validateProfileDocument({
    inputPath: validExample,
    profileName: "eu-controlled-audit",
  });
  const second = await validateProfileDocument({
    inputPath: validExample,
    profileName: "eu-controlled-audit",
  });
  assert.equal(first.decisionDigest, second.decisionDigest);
});

test("ST-RDF-DIAGNOSTIC-002: report input paths are credential-safe", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-path-redaction-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const secret = "AKIA1234567890ABCDEF";
  const inputPath = path.join(directory, `input-${secret}.ttl`);
  await writeFile(inputPath, await readFile(
    path.join(exampleRoot, "valid", "traffic-observation-catalog.ttl"),
    "utf8",
  ));
  const report = await validateProfileDocument({ inputPath, profileName: "core" });
  assert.equal(report.summary.gatePassed, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("ST-RDF-REPORT-001: CLI rejects an input/report path alias without mutation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-profile-alias-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const inputPath = path.join(directory, "input.ttl");
  const original = await readFile(validExample, "utf8");
  await writeFile(inputPath, original);
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    cli,
    "validate",
    "--input",
    inputPath,
    "--report",
    inputPath,
  ], { cwd: projectRoot(), encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PATH_ALIAS/u);
  assert.equal(await readFile(inputPath, "utf8"), original);
});

test("ST-RDF-PATH-001: CLI rejects UNC and device-like paths before filesystem access", () => {
  const cli = fileURLToPath(new URL("../../src/profile/cli.mjs", import.meta.url));
  for (const [flag, maliciousPath] of [
    ["--input", "//attacker.invalid/share/input.ttl"],
    ["--input", "\\\\?\\UNC\\attacker.invalid\\share\\input.ttl"],
  ]) {
    const result = spawnSync(process.execPath, [
      cli,
      "validate",
      flag,
      maliciousPath,
    ], { cwd: projectRoot(), encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /NON_LOCAL_PATH/u);
  }
  const reportResult = spawnSync(process.execPath, [
    cli,
    "validate",
    "--input",
    validExample,
    "--report",
    "//attacker.invalid/share/report.json",
  ], { cwd: projectRoot(), encoding: "utf8", timeout: 5000 });
  assert.equal(reportResult.status, 1, reportResult.stderr);
  assert.match(reportResult.stderr, /NON_LOCAL_PATH/u);
});
