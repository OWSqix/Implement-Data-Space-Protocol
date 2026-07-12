#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DataFactory, Parser, Store } from "n3";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_RELEASE = path.join(
  PROJECT_ROOT,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const NO_LOCAL = "no-local-constraint";
const { namedNode } = DataFactory;

export const CROSSWALK_HEADER = Object.freeze([
  "mapping_id",
  "source_standard_id",
  "source_edition_status",
  "source_clause",
  "source_semantic_item",
  "target_resource",
  "target_property_or_class",
  "mapping_relation",
  "cardinality_status",
  "loss_disposition",
  "evidence_level",
  "conformance_claim",
  "verification_gate",
  "notes",
  "source_cardinality",
  "target_cardinality",
  "target_datatype_or_range",
  "controlled_vocabulary",
  "local_constraint_status",
  "unconstrained_targets",
  "shacl_requirement_ids",
  "positive_fixture_ids",
  "negative_fixture_ids",
  "shape_ids",
]);

function finding(code, mappingId, message) {
  return { code, mappingId, message };
}

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows.filter((item) => !(item.length === 1 && item[0] === ""));
}

function splitSet(value) {
  return [...new Set(value.split("|").map((item) => item.trim()).filter(Boolean))].sort();
}

function sameSet(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function cardinalityValue(value, unbounded) {
  return value === null ? unbounded : String(value);
}

export function requirementSemanticProjection(requirements) {
  const ordered = [...requirements].sort((left, right) => (
    left.requirementId.localeCompare(right.requirementId)
  ));
  return {
    controlledVocabulary: ordered.map((item) => (
      `${item.requirementId}=${item.vocabulary.length > 0
        ? [...item.vocabulary].sort().join("&")
        : "none"}`
    )).join("|"),
    targetCardinality: ordered.map((item) => (
      `${item.requirementId}=${cardinalityValue(item.cardinality.minimum, "unspecified")}`
        + `..${cardinalityValue(item.cardinality.maximum, "unbounded")}`
    )).join("|"),
    targetDatatypeOrRange: ordered.map((item) => (
      `${item.requirementId}=${item.range.length > 0
        ? [...item.range].sort().join("&")
        : "unconstrained-by-direct-shacl"}`
    )).join("|"),
  };
}

async function readBounded(filePath, maximum) {
  const bytes = await readFile(filePath);
  if (bytes.byteLength > maximum) throw new Error(`file exceeds ${maximum} bytes: ${filePath}`);
  return bytes.toString("utf8");
}

function addFieldFindings(row, findings) {
  for (const field of CROSSWALK_HEADER) {
    if (typeof row[field] !== "string" || row[field].trim().length === 0) {
      findings.push(finding("EMPTY_SEMANTIC_FIELD", row.mapping_id, `${field} is empty`));
    }
  }
  for (const field of [
    "target_cardinality",
    "target_datatype_or_range",
    "controlled_vocabulary",
  ]) {
    if (/\b(?:TBD|TODO|UNKNOWN)\b/iu.test(row[field] ?? "")) {
      findings.push(finding("UNRESOLVED_TARGET_SEMANTICS", row.mapping_id, `${field} is unresolved`));
    }
  }
}

export async function verifyDomesticStandardsCrosswalk({
  crosswalkPath = null,
  releaseRoot = DEFAULT_RELEASE,
} = {}) {
  const selectedCrosswalkPath = crosswalkPath
    ?? path.join(releaseRoot, "mappings", "domestic-standards-crosswalk.csv");
  const requirementPath = path.join(releaseRoot, "requirements", "profile-requirements.json");
  const casePath = path.join(releaseRoot, "requirements", "conformance-cases.json");
  const [csvSource, requirementRegistry, caseRegistry] = await Promise.all([
    readBounded(selectedCrosswalkPath, MAX_CSV_BYTES),
    readFile(requirementPath, "utf8").then(JSON.parse),
    readFile(casePath, "utf8").then(JSON.parse),
  ]);
  const parsed = parseCsv(csvSource);
  const findings = [];
  if (parsed.length === 0) throw new Error("crosswalk is empty");
  const [header, ...values] = parsed;
  if (!sameSet([...header].sort(), [...CROSSWALK_HEADER].sort())
    || header.some((item, index) => item !== CROSSWALK_HEADER[index])) {
    findings.push(finding(
      "CROSSWALK_HEADER_MISMATCH",
      null,
      `expected ${CROSSWALK_HEADER.join(",")}`,
    ));
  }
  const rows = values.map((fields) => Object.fromEntries(
    CROSSWALK_HEADER.map((name, index) => [name, fields[index] ?? ""]),
  ));
  for (const [index, fields] of values.entries()) {
    if (fields.length !== CROSSWALK_HEADER.length) {
      findings.push(finding(
        "CROSSWALK_COLUMN_COUNT",
        rows[index]?.mapping_id ?? null,
        `row has ${fields.length} columns; expected ${CROSSWALK_HEADER.length}`,
      ));
    }
  }
  if (rows.length !== 48) {
    findings.push(finding("CROSSWALK_ROW_COUNT", null, `found ${rows.length}; expected 48`));
  }
  const requirementById = new Map(requirementRegistry.requirements.map((item) => (
    [item.requirementId, item]
  )));
  const caseById = new Map(caseRegistry.fixtureCases.map((item) => [item.fixtureId, item]));
  const seenMappings = new Set();
  const shapeStores = new Map();
  const loadShapeStore = async (shapeFile) => {
    if (!shapeStores.has(shapeFile)) {
      const source = await readFile(path.join(releaseRoot, shapeFile), "utf8");
      shapeStores.set(shapeFile, new Store(new Parser().parse(source)));
    }
    return shapeStores.get(shapeFile);
  };

  for (const [index, row] of rows.entries()) {
    addFieldFindings(row, findings);
    const expectedMappingId = `KR-XW-${String(index + 1).padStart(3, "0")}`;
    if (row.mapping_id !== expectedMappingId || seenMappings.has(row.mapping_id)) {
      findings.push(finding(
        "MAPPING_ID_SEQUENCE",
        row.mapping_id,
        `row ${index + 1} must be ${expectedMappingId} and unique`,
      ));
    }
    seenMappings.add(row.mapping_id);
    const expectedSourceCardinality = row.source_clause === "PENDING-LAWFUL-FULLTEXT"
      ? "pending-source-clause"
      : row.source_clause === "live-page-no-fixed-clause"
        ? "not-a-standard-clause"
        : null;
    if (expectedSourceCardinality !== null
      && row.source_cardinality !== expectedSourceCardinality) {
      findings.push(finding(
        "SOURCE_CARDINALITY_DRIFT",
        row.mapping_id,
        `source_cardinality must be ${expectedSourceCardinality}`,
      ));
    }
    if (row.source_clause === "PENDING-LAWFUL-FULLTEXT"
      && row.conformance_claim !== "informative-pending") {
      findings.push(finding(
        "PENDING_CLAUSE_OVERCLAIM",
        row.mapping_id,
        "a pending lawful clause cannot carry a conformance claim",
      ));
    }
    if (!["linked", "partial", NO_LOCAL].includes(row.local_constraint_status)) {
      findings.push(finding(
        "LOCAL_CONSTRAINT_STATUS",
        row.mapping_id,
        `unsupported status ${row.local_constraint_status}`,
      ));
      continue;
    }
    if (row.local_constraint_status === NO_LOCAL) {
      for (const field of [
        "target_cardinality",
        "target_datatype_or_range",
        "controlled_vocabulary",
        "shacl_requirement_ids",
        "positive_fixture_ids",
        "negative_fixture_ids",
        "shape_ids",
      ]) {
        if (row[field] !== NO_LOCAL) {
          findings.push(finding(
            "NO_LOCAL_SENTINEL_MISMATCH",
            row.mapping_id,
            `${field} must be ${NO_LOCAL}`,
          ));
        }
      }
      if (row.unconstrained_targets !== row.target_property_or_class) {
        findings.push(finding(
          "NO_LOCAL_TARGET_INVENTORY",
          row.mapping_id,
          "unconstrained_targets must repeat target_property_or_class",
        ));
      }
      continue;
    }

    if (row.local_constraint_status === "linked" && row.unconstrained_targets !== "none") {
      findings.push(finding(
        "LINKED_ROW_HAS_UNCONSTRAINED_TARGET",
        row.mapping_id,
        "linked rows must state unconstrained_targets=none",
      ));
    }
    if (row.local_constraint_status === "partial"
      && ["", "none", NO_LOCAL].includes(row.unconstrained_targets)) {
      findings.push(finding(
        "PARTIAL_ROW_WITHOUT_GAP",
        row.mapping_id,
        "partial rows must name the target without a direct local requirement",
      ));
    }
    const requirementIds = splitSet(row.shacl_requirement_ids);
    const linkedRequirements = [];
    for (const requirementId of requirementIds) {
      const requirement = requirementById.get(requirementId);
      if (!requirement) {
        findings.push(finding(
          "UNKNOWN_REQUIREMENT_ID",
          row.mapping_id,
          `unknown requirement ${requirementId}`,
        ));
      } else {
        linkedRequirements.push(requirement);
      }
    }
    if (linkedRequirements.length === 0) {
      findings.push(finding(
        "LINKED_ROW_WITHOUT_REQUIREMENT",
        row.mapping_id,
        "linked or partial rows need at least one SHACL requirement",
      ));
      continue;
    }
    const expected = requirementSemanticProjection(linkedRequirements);
    for (const [field, value] of [
      ["target_cardinality", expected.targetCardinality],
      ["target_datatype_or_range", expected.targetDatatypeOrRange],
      ["controlled_vocabulary", expected.controlledVocabulary],
    ]) {
      if (row[field] !== value) {
        findings.push(finding(
          "REQUIREMENT_SEMANTIC_PROJECTION_DRIFT",
          row.mapping_id,
          `${field} does not match linked requirement metadata`,
        ));
      }
    }
    const expectedPositive = splitSet(linkedRequirements.map((item) => (
      item.positiveFixtureId ?? ""
    )).filter(Boolean).join("|"));
    const expectedNegative = splitSet(linkedRequirements.map((item) => (
      item.negativeFixtureId ?? ""
    )).filter(Boolean).join("|"));
    const expectedShapes = splitSet(linkedRequirements.map((item) => item.shapeId).join("|"));
    for (const [field, expectedSet] of [
      ["positive_fixture_ids", expectedPositive],
      ["negative_fixture_ids", expectedNegative],
      ["shape_ids", expectedShapes],
    ]) {
      if (!sameSet(splitSet(row[field]), expectedSet) || expectedSet.length === 0) {
        findings.push(finding(
          "LINKED_EVIDENCE_SET_DRIFT",
          row.mapping_id,
          `${field} does not equal the linked requirement evidence set`,
        ));
      }
    }
    for (const [fixtureId, expectedOutcome] of [
      ...expectedPositive.map((id) => [id, "conforms"]),
      ...expectedNegative.map((id) => [id, "violates"]),
    ]) {
      const fixture = caseById.get(fixtureId);
      if (!fixture || fixture.expectedOutcome !== expectedOutcome) {
        findings.push(finding(
          "UNKNOWN_OR_WRONG_FIXTURE",
          row.mapping_id,
          `${fixtureId} must exist with expectedOutcome=${expectedOutcome}`,
        ));
      } else {
        try {
          await access(path.join(releaseRoot, fixture.path));
        } catch {
          findings.push(finding(
            "FIXTURE_FILE_MISSING",
            row.mapping_id,
            `${fixtureId} points to a missing file`,
          ));
        }
      }
    }
    for (const requirement of linkedRequirements) {
      const store = await loadShapeStore(requirement.shapeFile);
      if (store.countQuads(namedNode(requirement.shapeId), null, null, null) === 0) {
        findings.push(finding(
          "SHAPE_ID_NOT_DECLARED",
          row.mapping_id,
          `${requirement.shapeId} is absent from ${requirement.shapeFile}`,
        ));
      }
    }
  }

  findings.sort((left, right) => (
    String(left.mappingId).localeCompare(String(right.mappingId))
      || left.code.localeCompare(right.code)
      || left.message.localeCompare(right.message)
  ));
  return {
    schemaVersion: "molit.domestic-standards-crosswalk-verification/1",
    profileVersion: requirementRegistry.profileVersion,
    crosswalkDigest: createHash("sha256").update(csvSource).digest("hex"),
    gatePassed: findings.length === 0,
    summary: {
      findings: findings.length,
      linked: rows.filter((item) => item.local_constraint_status === "linked").length,
      noLocalConstraint: rows.filter((item) => item.local_constraint_status === NO_LOCAL).length,
      partial: rows.filter((item) => item.local_constraint_status === "partial").length,
      rows: rows.length,
    },
    findings,
  };
}

async function main() {
  const report = await verifyDomesticStandardsCrosswalk();
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
