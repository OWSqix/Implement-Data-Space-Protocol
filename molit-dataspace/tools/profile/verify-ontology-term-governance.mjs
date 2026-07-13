#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_RELEASE = path.join(
  PROJECT_ROOT,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const ONTOLOGY_NAMESPACE = "https://data.molit.go.kr/def/molit-dcat-ap#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const ADMS = "http://www.w3.org/ns/adms#";
const DCT = "http://purl.org/dc/terms/";
const { namedNode } = DataFactory;
const TERM_KINDS = Object.freeze([
  "Class",
  "ObjectProperty",
  "DatatypeProperty",
  "AnnotationProperty",
]);
const TERM_COVERAGE_CQ_ID = "CQ-ONTO-TERM-01";

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function equalValues(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function queryReferencesTerm(queryText, term) {
  if (queryText.includes(`<${term.iri}>`)) return true;
  const localPrefix = /\bPREFIX\s+molit:\s*<https:\/\/data[.]molit[.]go[.]kr\/def\/molit-dcat-ap#>/iu;
  return localPrefix.test(queryText)
    && new RegExp(`\\bmolit:${escapeRegExp(term.localName)}(?![A-Za-z0-9])`, "u")
      .test(queryText);
}

function finding(code, term, message) {
  return { code, term, message };
}

function rdfTermKey(term) {
  if (term.termType === "Literal") {
    return `Literal:${term.value}:${term.language}:${term.datatype?.value ?? ""}`;
  }
  return `${term.termType}:${term.value}`;
}

function dataWithoutGovernedStatements(store, term, termKind) {
  return store.getQuads(null, null, null, null).filter((quad) => (
    termKind === "Class"
      ? !(quad.predicate.value === `${RDF}type` && quad.object.equals(term))
      : !quad.predicate.equals(term)
  )).map((quad) => (
    [quad.subject, quad.predicate, quad.object, quad.graph].map(rdfTermKey).join("|")
  )).sort();
}

function objects(store, subject, predicate) {
  return store.getObjects(subject, namedNode(predicate), null);
}

function iriObjects(store, subject, predicate) {
  return objects(store, subject, predicate)
    .filter((term) => term.termType === "NamedNode")
    .map((term) => term.value);
}

function literalObjects(store, subject, predicate) {
  return objects(store, subject, predicate)
    .filter((term) => term.termType === "Literal")
    .map((term) => term.value);
}

function requiredBlockers(term) {
  const blockers = [];
  if (term.positiveEvidence.length === 0) blockers.push("missing-positive-term-fixture");
  if (term.negativeEvidence.length === 0) blockers.push("missing-negative-requirement-fixture");
  return sorted(blockers);
}

async function parseTurtle(filePath) {
  return new Store(new Parser().parse(await readFile(filePath, "utf8")));
}

async function resolveReleaseRegularFile(releaseRoot, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || relativePath.includes("\\") || relativePath.includes("\0")
    || path.isAbsolute(relativePath)
    || relativePath.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`${label} is not a portable release-relative path`);
  }
  const absoluteRoot = path.resolve(releaseRoot);
  const absolute = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the release root`);
  }
  const stats = await lstat(absolute);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
  return absolute;
}

export async function verifyOntologyTermGovernance({
  registerPath = null,
  releaseRoot = DEFAULT_RELEASE,
} = {}) {
  const selectedRegisterPath = registerPath
    ?? path.join(releaseRoot, "ontology", "term-governance.json");
  const schemaPath = path.join(PROJECT_ROOT, "contracts", "ontology-term-governance.v1.schema.json");
  const [
    registerSource,
    schema,
    requirementRegistry,
    caseRegistry,
    competencyRegistry,
  ] = await Promise.all([
    readFile(selectedRegisterPath, "utf8"),
    readFile(schemaPath, "utf8").then(JSON.parse),
    readFile(path.join(releaseRoot, "requirements", "profile-requirements.json"), "utf8")
      .then(JSON.parse),
    readFile(path.join(releaseRoot, "requirements", "conformance-cases.json"), "utf8")
      .then(JSON.parse),
    readFile(path.join(releaseRoot, "ontology", "competency-registry.json"), "utf8")
      .then(JSON.parse),
  ]);
  const register = JSON.parse(registerSource);
  const findings = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv, { mode: "full" });
  const validate = ajv.compile(schema);
  if (!validate(register)) {
    for (const error of validate.errors ?? []) {
      findings.push(finding(
        "REGISTER_SCHEMA",
        null,
        `${error.instancePath || "/"} ${error.message}`,
      ));
    }
  }
  const ontologyPath = path.join(releaseRoot, register.ontologyFile ?? "ontology/molit-dcat-ap.ttl");
  const ontology = await parseTurtle(ontologyPath);
  const actualTerms = [];
  for (const termKind of TERM_KINDS) {
    for (const term of ontology.getSubjects(
      namedNode(`${RDF}type`),
      namedNode(`${OWL}${termKind}`),
      null,
    )) {
      if (term.termType === "NamedNode" && term.value.startsWith(ONTOLOGY_NAMESPACE)) {
        actualTerms.push({ iri: term.value, term: termKind });
      }
    }
  }
  actualTerms.sort((left, right) => left.iri.localeCompare(right.iri));
  const actualByIri = new Map(actualTerms.map((item) => [item.iri, item]));
  const registeredByIri = new Map();
  for (const term of register.terms ?? []) {
    if (registeredByIri.has(term.iri)) {
      findings.push(finding("DUPLICATE_TERM", term.iri, "term occurs more than once"));
    }
    registeredByIri.set(term.iri, term);
  }
  if (!equalValues([...actualByIri.keys()], [...registeredByIri.keys()])) {
    findings.push(finding(
      "TERM_INVENTORY_DRIFT",
      null,
      "the register must contain every and only local OWL term",
    ));
  }
  const registeredOrder = (register.terms ?? []).map((term) => term.iri);
  if (registeredOrder.some((iri, index) => iri !== sorted(registeredOrder)[index])) {
    findings.push(finding("TERM_ORDER", null, "terms must be sorted by IRI"));
  }
  const competencyQueries = Array.isArray(competencyRegistry?.queries)
    ? competencyRegistry.queries
    : [];
  const knownCompetencyQuestionIds = new Set(competencyQueries.map(({ id }) => id));
  const competencyQueryTexts = new Map();
  for (const query of competencyQueries) {
    try {
      const queryPath = await resolveReleaseRegularFile(
        releaseRoot,
        query.queryFile,
        `competency query ${query.id}`,
      );
      competencyQueryTexts.set(query.id, await readFile(queryPath, "utf8"));
    } catch (error) {
      findings.push(finding(
        "TERM_COMPETENCY_QUERY_UNREADABLE",
        null,
        `${query.id}: ${error.message}`,
      ));
    }
  }
  const termCoverageQuery = competencyQueries.find(({ id }) => id === TERM_COVERAGE_CQ_ID);
  if (!termCoverageQuery) {
    findings.push(finding(
      "TERM_COMPETENCY_QUERY_MISSING",
      null,
      `${TERM_COVERAGE_CQ_ID} is missing from the competency registry`,
    ));
  } else {
    const expectedTermRows = Array.isArray(termCoverageQuery.expectedRows)
      ? termCoverageQuery.expectedRows
      : [];
    const expectedTermIris = expectedTermRows.map((row) => (
      row?.term?.type === "uri" ? row.term.value : null
    ));
    if (!Array.isArray(termCoverageQuery.expectedVariables)
      || !termCoverageQuery.expectedVariables.includes("term")
      || expectedTermIris.some((iri) => typeof iri !== "string")
      || new Set(expectedTermIris).size !== expectedTermRows.length
      || !equalValues(expectedTermIris, [...actualByIri.keys()])) {
      findings.push(finding(
        "TERM_COMPETENCY_QUERY_COVERAGE",
        null,
        `${TERM_COVERAGE_CQ_ID} expected rows must enumerate every and only local OWL term`,
      ));
    }
  }
  const requirementById = new Map(requirementRegistry.requirements.map((item) => (
    [item.requirementId, item]
  )));
  const caseById = new Map(caseRegistry.fixtureCases.map((item) => [item.fixtureId, item]));
  const fixtureStores = new Map();
  const fixtureStore = async (fixturePath) => {
    if (!fixtureStores.has(fixturePath)) {
      const absolute = await resolveReleaseRegularFile(
        releaseRoot,
        fixturePath,
        "profile evidence fixture",
      );
      fixtureStores.set(fixturePath, await parseTurtle(absolute));
    }
    return fixtureStores.get(fixturePath);
  };
  const unitReports = new Map();
  const validateUnitEvidence = async (evidence) => {
    const key = `${evidence.shapesPath}\0${evidence.dataPath}`;
    if (!unitReports.has(key)) {
      const [shapesAbsolute, dataAbsolute] = await Promise.all([
        resolveReleaseRegularFile(releaseRoot, evidence.shapesPath, "unit evidence shapes"),
        resolveReleaseRegularFile(releaseRoot, evidence.dataPath, "unit evidence data"),
      ]);
      const [shapes, data] = await Promise.all([
        parseTurtle(shapesAbsolute),
        parseTurtle(dataAbsolute),
      ]);
      const report = await new SHACLValidator(shapes).validate(data);
      unitReports.set(key, { data, report, shapes });
    }
    return unitReports.get(key);
  };

  for (const term of register.terms ?? []) {
    const subject = namedNode(term.iri);
    const actual = actualByIri.get(term.iri);
    if (!actual) continue;
    const competencyQuestionIds = Array.isArray(term.competencyQuestionIds)
      ? term.competencyQuestionIds
      : [];
    if (!competencyQuestionIds.includes(TERM_COVERAGE_CQ_ID)) {
      findings.push(finding(
        "TERM_COMPETENCY_COVERAGE",
        term.iri,
        `term must be covered by ${TERM_COVERAGE_CQ_ID}`,
      ));
    }
    for (const competencyQuestionId of competencyQuestionIds) {
      if (!knownCompetencyQuestionIds.has(competencyQuestionId)) {
        findings.push(finding(
          "TERM_COMPETENCY_UNKNOWN",
          term.iri,
          `${competencyQuestionId} is not registered`,
        ));
      }
    }
    const semanticCompetencyQuestionIds = competencyQuestionIds.filter((id) => (
      id !== TERM_COVERAGE_CQ_ID
    ));
    if (semanticCompetencyQuestionIds.length === 0) {
      findings.push(finding(
        "TERM_SEMANTIC_COMPETENCY_MISSING",
        term.iri,
        "term must have at least one semantic competency question in addition to the inventory query",
      ));
    }
    for (const competencyQuestionId of semanticCompetencyQuestionIds) {
      const query = competencyQueries.find(({ id }) => id === competencyQuestionId);
      const queryText = competencyQueryTexts.get(competencyQuestionId);
      if (!query || queryText === undefined) continue;
      if (!queryReferencesTerm(queryText, term)) {
        findings.push(finding(
          "TERM_SEMANTIC_QUERY_REFERENCE",
          term.iri,
          `${competencyQuestionId} does not reference the governed term`,
        ));
      }
      const hasExpectedEvidence = Array.isArray(query.expectedRows)
        && (query.expectedRows.length > 0
          || (typeof query.zeroResultMeaning === "string" && query.zeroResultMeaning.length > 0));
      if (!hasExpectedEvidence) {
        findings.push(finding(
          "TERM_SEMANTIC_QUERY_EVIDENCE",
          term.iri,
          `${competencyQuestionId} has no expected result evidence`,
        ));
      }
    }
    if (term.termKind !== actual.term) {
      findings.push(finding(
        "TERM_KIND_DRIFT",
        term.iri,
        `${term.termKind} does not match owl:${actual.term}`,
      ));
    }
    if (term.localName !== term.iri.slice(ONTOLOGY_NAMESPACE.length)) {
      findings.push(finding("LOCAL_NAME_DRIFT", term.iri, "localName does not match the IRI"));
    }
    const labels = objects(ontology, subject, `${RDFS}label`);
    const definitions = objects(ontology, subject, `${SKOS}definition`);
    for (const [predicate, values] of [["rdfs:label", labels], ["skos:definition", definitions]]) {
      for (const language of ["ko", "en"]) {
        if (!values.some((value) => value.termType === "Literal" && value.language === language)) {
          findings.push(finding(
            "BILINGUAL_TERM_TEXT",
            term.iri,
            `${predicate} has no ${language} value`,
          ));
        }
      }
    }
    const expectedBoundary = term.termKind === "Class"
      ? "not-applicable-to-class"
      : "declared";
    for (const [field, predicate] of [["domain", `${RDFS}domain`], ["range", `${RDFS}range`]]) {
      if (term[field].disposition !== expectedBoundary
        || !equalValues(term[field].values, iriObjects(ontology, subject, predicate))) {
        findings.push(finding(
          "DOMAIN_RANGE_DRIFT",
          term.iri,
          `${field} does not match the ontology declaration and term kind`,
        ));
      }
    }
    const definedBy = iriObjects(ontology, subject, `${RDFS}isDefinedBy`);
    if (definedBy.length !== 1 || term.isDefinedBy !== definedBy[0]
      || term.isDefinedBy !== register.ontologyIri) {
      findings.push(finding(
        "IS_DEFINED_BY_DRIFT",
        term.iri,
        "rdfs:isDefinedBy must identify the registered ontology exactly once",
      ));
    }
    const statuses = iriObjects(ontology, subject, `${ADMS}status`);
    const versions = literalObjects(ontology, subject, `${OWL}versionInfo`);
    if (statuses.length !== 1 || term.status !== statuses[0]) {
      findings.push(finding("STATUS_DRIFT", term.iri, "status does not match the ontology"));
    }
    if (versions.length !== 1 || term.version !== versions[0]
      || term.version !== register.profileVersion) {
      findings.push(finding("VERSION_DRIFT", term.iri, "version does not match the ontology"));
    }
    const deprecated = literalObjects(ontology, subject, `${OWL}deprecated`).includes("true");
    const replacements = iriObjects(ontology, subject, `${DCT}isReplacedBy`);
    if (term.deprecation.deprecated !== deprecated
      || !equalValues(term.deprecation.replacements, replacements)) {
      findings.push(finding(
        "DEPRECATION_DRIFT",
        term.iri,
        "deprecated flag or replacements do not match the ontology",
      ));
    }
    if (deprecated && (term.reuseDecision !== "deprecated-compatibility-only"
      || replacements.length === 0
      || !term.status.endsWith("/deprecated"))) {
      findings.push(finding(
        "DEPRECATION_POLICY_INCOMPLETE",
        term.iri,
        "deprecated terms require compatibility-only reuse, replacement IRIs and deprecated status",
      ));
    }
    if (!deprecated && term.deprecation.replacements.length > 0) {
      findings.push(finding(
        "ACTIVE_TERM_HAS_REPLACEMENT",
        term.iri,
        "an active term cannot publish deprecation replacements",
      ));
    }
    const expectedBlockers = requiredBlockers(term);
    if (!equalValues(term.blockers, expectedBlockers)) {
      findings.push(finding(
        "EVIDENCE_BLOCKER_DRIFT",
        term.iri,
        `expected blockers: ${expectedBlockers.join(", ") || "none"}`,
      ));
    }
    const expectedEvidenceStatus = expectedBlockers.length === 0 ? "complete" : "blocked";
    if (term.evidenceStatus !== expectedEvidenceStatus) {
      findings.push(finding(
        "EVIDENCE_STATUS_DRIFT",
        term.iri,
        `evidenceStatus must be ${expectedEvidenceStatus}`,
      ));
    }
    for (const [field, expectedOutcome] of [
      ["positiveEvidence", "conforms"],
      ["negativeEvidence", "violates"],
    ]) {
      for (const evidence of term[field]) {
        if (evidence.evidenceType === "shacl-unit") {
          if (evidence.expectedOutcome !== expectedOutcome) {
            findings.push(finding(
              "UNIT_EVIDENCE_OUTCOME_PLACEMENT",
              term.iri,
              `${evidence.evidenceId} must declare ${expectedOutcome}`,
            ));
          }
          let unit;
          try {
            unit = await validateUnitEvidence(evidence);
          } catch (error) {
            findings.push(finding(
              "UNIT_EVIDENCE_UNREADABLE",
              term.iri,
              `${evidence.evidenceId}: ${error.message}`,
            ));
            continue;
          }
          if (unit.shapes.countQuads(
            namedNode(evidence.governingShapeId),
            null,
            null,
            null,
          ) === 0) {
            findings.push(finding(
              "UNIT_GOVERNING_SHAPE_UNKNOWN",
              term.iri,
              `${evidence.governingShapeId} is absent from ${evidence.shapesPath}`,
            ));
          }
          const observedOutcome = unit.report.conforms ? "conforms" : "violates";
          if (observedOutcome !== evidence.expectedOutcome
            || unit.report.results.length !== evidence.expectedResultCount) {
            findings.push(finding(
              "UNIT_EVIDENCE_RESULT_DRIFT",
              term.iri,
              `${evidence.evidenceId} observed ${observedOutcome} with ${unit.report.results.length} result(s)`,
            ));
          }
          const occurs = term.termKind === "Class"
            ? unit.data.countQuads(null, namedNode(`${RDF}type`), subject, null) > 0
            : unit.data.countQuads(null, subject, null, null) > 0;
          if (!occurs) {
            findings.push(finding(
              "UNIT_EVIDENCE_DOES_NOT_EXERCISE_TERM",
              term.iri,
              `${evidence.evidenceId} does not use the governed term`,
            ));
          }
          if (evidence.expectedOutcome === "violates") {
            if (evidence.expectedResultPath !== null) {
              if (!unit.report.results.every(({ path: resultPath }) => (
                resultPath?.value === evidence.expectedResultPath
              ))) {
                findings.push(finding(
                  "UNIT_NEGATIVE_RESULT_PATH_DRIFT",
                  term.iri,
                  `${evidence.evidenceId} reports a path outside the governed term`,
                ));
              }
            } else if (!unit.report.results.every(({ sourceShape }) => (
              sourceShape?.value === evidence.governingShapeId
            ))) {
              findings.push(finding(
                "UNIT_NEGATIVE_SOURCE_SHAPE_DRIFT",
                term.iri,
                `${evidence.evidenceId} reports an unexpected source shape`,
              ));
            }
          }
          continue;
        }
        if (evidence.evidenceType !== "profile-fixture") {
          findings.push(finding(
            "EVIDENCE_TYPE_UNKNOWN",
            term.iri,
            `unsupported evidence type ${evidence.evidenceType}`,
          ));
          continue;
        }
        const requirement = requirementById.get(evidence.requirementId);
        const fixture = caseById.get(evidence.fixtureId);
        if (!requirement) {
          findings.push(finding(
            "EVIDENCE_REQUIREMENT_UNKNOWN",
            term.iri,
            evidence.requirementId,
          ));
          continue;
        }
        const expectedFixtureId = expectedOutcome === "conforms"
          ? requirement.positiveFixtureId
          : requirement.negativeFixtureId;
        if (expectedFixtureId !== evidence.fixtureId) {
          findings.push(finding(
            "EVIDENCE_REQUIREMENT_LINK_DRIFT",
            term.iri,
            `${evidence.requirementId} does not link ${evidence.fixtureId}`,
          ));
        }
        if (!fixture || fixture.expectedOutcome !== expectedOutcome
          || fixture.path !== evidence.fixturePath) {
          findings.push(finding(
            "EVIDENCE_FIXTURE_UNKNOWN",
            term.iri,
            `${evidence.fixtureId} is not the declared ${expectedOutcome} fixture`,
          ));
          continue;
        }
        try {
          await resolveReleaseRegularFile(
            releaseRoot,
            evidence.fixturePath,
            "profile evidence fixture",
          );
        } catch (error) {
          findings.push(finding(
            "EVIDENCE_FILE_NOT_REGULAR",
            term.iri,
            `${evidence.fixtureId}: ${error.message}`,
          ));
          continue;
        }
        if (!fixture.coversRequirementIds.includes(evidence.requirementId)) {
          findings.push(finding(
            "EVIDENCE_COVERAGE_LINK",
            term.iri,
            `${evidence.fixtureId} does not cover ${evidence.requirementId}`,
          ));
        }
        if (expectedOutcome === "violates"
          && !fixture.expectedRequirementIds.includes(evidence.requirementId)) {
          findings.push(finding(
            "NEGATIVE_EVIDENCE_NOT_OBSERVED",
            term.iri,
            `${evidence.requirementId} was not observed in ${evidence.fixtureId}`,
          ));
        }
        if (expectedOutcome === "conforms") {
          const graph = await fixtureStore(fixture.path);
          const occurs = term.termKind === "Class"
            ? graph.countQuads(null, namedNode(`${RDF}type`), subject, null) > 0
            : graph.countQuads(null, subject, null, null) > 0;
          if (!occurs) {
            findings.push(finding(
              "POSITIVE_EVIDENCE_DOES_NOT_EXERCISE_TERM",
              term.iri,
              `${evidence.fixtureId} does not use the term`,
            ));
          }
        }
      }
    }
    const isolatedPositive = term.positiveEvidence.filter((evidence) => (
      evidence.evidenceType === "shacl-unit"
        && evidence.isolationMode === "term-only-delta"
    ));
    const isolatedNegative = term.negativeEvidence.filter((evidence) => (
      evidence.evidenceType === "shacl-unit"
        && evidence.isolationMode === "term-only-delta"
    ));
    if (isolatedPositive.length > 0 || isolatedNegative.length > 0) {
      if (isolatedPositive.length !== 1 || isolatedNegative.length !== 1
        || isolatedPositive[0].shapesPath !== isolatedNegative[0].shapesPath) {
        findings.push(finding(
          "UNIT_ISOLATION_PAIR_INCOMPLETE",
          term.iri,
          "term-only-delta evidence requires one positive and one negative fixture with one shape graph",
        ));
      } else {
        try {
          const [positiveUnit, negativeUnit] = await Promise.all([
            validateUnitEvidence(isolatedPositive[0]),
            validateUnitEvidence(isolatedNegative[0]),
          ]);
          const positiveBackground = dataWithoutGovernedStatements(
            positiveUnit.data,
            subject,
            term.termKind,
          );
          const negativeBackground = dataWithoutGovernedStatements(
            negativeUnit.data,
            subject,
            term.termKind,
          );
          if (!equalValues(positiveBackground, negativeBackground)) {
            findings.push(finding(
              "UNIT_NEGATIVE_NOT_ISOLATED",
              term.iri,
              "positive and negative unit graphs differ outside the governed term",
            ));
          }
        } catch (error) {
          findings.push(finding(
            "UNIT_ISOLATION_EVIDENCE_UNREADABLE",
            term.iri,
            error.message,
          ));
        }
      }
    }
  }

  const completeEvidence = (register.terms ?? []).filter((term) => (
    term.evidenceStatus === "complete"
  )).length;
  const expectedSummary = {
    blockedEvidence: (register.terms ?? []).length - completeEvidence,
    completeEvidence,
    terms: (register.terms ?? []).length,
  };
  if (JSON.stringify(register.summary) !== JSON.stringify(expectedSummary)) {
    findings.push(finding(
      "SUMMARY_DRIFT",
      null,
      `summary must be ${JSON.stringify(expectedSummary)}`,
    ));
  }
  const expectedStatus = expectedSummary.blockedEvidence > 0
    ? "candidate-with-blockers"
    : "candidate";
  if (register.registryStatus !== expectedStatus) {
    findings.push(finding(
      "REGISTRY_STATUS_DRIFT",
      null,
      `registryStatus must be ${expectedStatus}`,
    ));
  }
  findings.sort((left, right) => (
    String(left.term).localeCompare(String(right.term))
      || left.code.localeCompare(right.code)
      || left.message.localeCompare(right.message)
  ));
  return {
    schemaVersion: "molit.ontology-term-governance-verification/1",
    profileVersion: register.profileVersion,
    gatePassed: findings.length === 0,
    registryStatus: register.registryStatus,
    summary: {
      ...expectedSummary,
      findings: findings.length,
    },
    findings,
  };
}

async function main() {
  const report = await verifyOntologyTermGovernance();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.gatePassed ? 0 : 2;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
