import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Parser, Store } from "n3";

const releaseUrl = new URL(
  "../../profiles/molit-dcat-ap/releases/0.1.0/",
  import.meta.url,
);
const [
  register,
  unitVocabulary,
  crosswalkText,
  profileIndex,
  domesticAlignment,
  auditResponse,
  validationPlan,
  sourceRegister,
  claimMatrix,
] = await Promise.all([
  readFile(new URL("../../standards/korean-interoperability-register.json", import.meta.url), "utf8")
    .then(JSON.parse),
  readFile(new URL("vocabulary/qudt-unit-allowlist.ttl", releaseUrl), "utf8"),
  readFile(new URL("mappings/platform-field-crosswalk.csv", releaseUrl), "utf8"),
  readFile(new URL("index.md", releaseUrl), "utf8"),
  readFile(new URL("mappings/domestic-standards-alignment.md", releaseUrl), "utf8"),
  readFile(new URL(
    "../../docs/01-research/external-audit-response-domestic-interoperability.md",
    import.meta.url,
  ), "utf8"),
  readFile(new URL(
    "../../docs/03-plan/domestic-real-data-validation-plan.md",
    import.meta.url,
  ), "utf8"),
  readFile(new URL("../../evidence/source-register.yaml", import.meta.url), "utf8"),
  readFile(new URL("../../evidence/claim-evidence-matrix.md", import.meta.url), "utf8"),
]);

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === "\"" && source[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === "\"") {
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
  if (quoted) throw new Error("unterminated quoted CSV field");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const [header, ...records] = rows;
  assert.ok(header.length > 0);
  assert.ok(records.every((record) => record.length === header.length));
  return records.map((record) => Object.fromEntries(
    header.map((name, index) => [name, record[index]]),
  ));
}

test("DOM-AUDIT-001: CRS source and geometry scopes cannot be conflated", () => {
  assert.equal(register.referenceSystems.length, 7);
  assert.ok(register.referenceSystems.every(({ profileUses }) => (
    profileUses.includes("source-reference")
  )));
  const geometryLiteral = register.referenceSystems
    .filter(({ profileUses }) => profileUses.includes("geometry-literal"))
    .map(({ code }) => code)
    .sort();
  assert.deepEqual(geometryLiteral, ["5179", "CRS84"]);
  assert.ok(register.referenceSystems.some(({ code }) => code === "5186"));
  assert.ok(!register.referenceSystems.some(({ code }) => ["3857", "4326"].includes(code)));
});

test("DOM-AUDIT-002: the reviewed platform crosswalk status count stays explicit", () => {
  const rows = parseCsv(crosswalkText);
  assert.equal(rows.length, 33);
  const counts = Object.groupBy(rows, ({ status }) => status);
  assert.equal(counts.ready?.length, 8);
  assert.equal(counts.conditional?.length, 15);
  assert.equal(counts.blocked?.length, 10);
});

test("DOM-AUDIT-003: quality units are not silently expanded into payload semantics", () => {
  const store = new Store(new Parser({ format: "text/turtle" }).parse(unitVocabulary));
  const unitType = "http://qudt.org/schema/qudt/Unit";
  const units = store.getSubjects(
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    unitType,
    null,
  ).map(({ value }) => value).sort();
  assert.equal(new Set(units).size, 6);
  assert.ok(!units.includes("http://qudt.org/vocab/unit/KiloM-PER-HR"));
  assert.match(domesticAlignment, /TRANSPORT-UNIT-001/u);
  assert.match(domesticAlignment, /교통 관측속도/u);
});

test("DOM-AUDIT-004: external-audit gaps remain machine-visible release blockers", () => {
  const expected = new Set([
    "BS-CRS-COVERAGE",
    "BS-DOMESTIC-VOCABULARY",
    "BS-REAL-DATA-COVERAGE",
    "BS-TRANSPORT-UNIT-SEMANTICS",
  ]);
  const selected = register.blindspots.filter(({ id }) => expected.has(id));
  assert.equal(selected.length, expected.size);
  assert.ok(selected.every(({ currentlyBlocksRelease }) => currentlyBlocksRelease));
  assert.ok(selected.every(({ releaseGateRequired }) => releaseGateRequired));
  for (const control of [
    "CRS-COVERAGE-001",
    "REL-MAP-001",
    "REL-VOC-001",
    "TRANSPORT-UNIT-001",
  ]) {
    assert.ok(`${auditResponse}\n${validationPlan}`.includes(control), control);
  }
});

test("DOM-AUDIT-005: stale validator and national-catalog statements stay corrected", () => {
  assert.doesNotMatch(profileIndex, /CLI 입력 형식은 Turtle만 지원/u);
  assert.doesNotMatch(profileIndex, /제2 engine 미수행/u);
  assert.match(profileIndex, /N-Triples, N-Quads, RDF\/XML과 JSON-LD/u);
  assert.match(profileIndex, /Jena 6[.]1[.]0 13사례 differential/u);
  assert.match(sourceRegister, /SRC-KR-004[\s\S]+DCAT-AP 2[.]1/u);
  assert.match(claimMatrix, /C-083[\s\S]+DCAT-AP 2[.]1/u);
  assert.match(domesticAlignment, /원-윈도우 기준을 DCAT-AP 2[.]0으로 기록하지 않는다/u);
});

test("DOM-AUDIT-006: current transport rules are routed by role and interface", () => {
  const standards = new Map(register.standards.map((item) => [item.id, item]));
  const expected = [
    "MOLIT-NODE-LINK-CONSTRUCTION-2026-344",
    "MOLIT-NODE-LINK-MANAGEMENT-2023-23",
    "MOLIT-BASIC-TRAFFIC-I-2021-1059",
    "MOLIT-BASIC-TRAFFIC-II-2021-1060",
    "MOLIT-BASIC-TRAFFIC-III-2023-20",
    "MOLIT-BASIC-TRAFFIC-IV-2016-208",
  ];
  assert.ok(expected.every((id) => standards.get(id)?.status === "current"));
  assert.equal(
    standards.get("MOLIT-NODE-LINK-CONSTRUCTION-2026-344")?.statusEventDate,
    "2026-06-25",
  );
  assert.match(domesticAlignment, /센터와 센터/u);
  assert.match(domesticAlignment, /인터넷 공개 Open API/u);
  assert.match(claimMatrix, /C-086[\s\S]+2026-344/u);
  assert.match(claimMatrix, /C-087[\s\S]+I·II·III·IV/u);
});

test("DOM-AUDIT-007: Korean code schemes remain distinct and URI governance stays open", () => {
  assert.match(domesticAlignment, /MOIS_KIK_H/u);
  assert.match(domesticAlignment, /MOIS_KIK_B/u);
  assert.match(domesticAlignment, /KR_ADMIN_ORG/u);
  assert.match(claimMatrix, /C-090[\s\S]+10자리[\s\S]+7자리/u);
  const vocabularyGap = register.blindspots.find(({ id }) => (
    id === "BS-DOMESTIC-VOCABULARY"
  ));
  assert.equal(vocabularyGap?.currentlyBlocksRelease, true);
});
