import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CROSSWALK_HEADER,
  parseCsv,
  verifyDomesticStandardsCrosswalk,
} from "../../tools/profile/verify-domestic-standards-crosswalk.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(
  root,
  "profiles",
  "molit-dcat-ap",
  "releases",
  "1.0.0-rc.1",
);
const checkedInPath = path.join(
  releaseRoot,
  "mappings",
  "domestic-standards-crosswalk.csv",
);

function quoteCsv(value) {
  const source = String(value);
  return /[",\r\n]/u.test(source)
    ? `"${source.replaceAll('"', '""')}"`
    : source;
}

function serialize(rows) {
  return `${rows.map((row) => row.map(quoteCsv).join(",")).join("\n")}\n`;
}

async function withMutatedCrosswalk(t, mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-domestic-crosswalk-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rows = parseCsv(await readFile(checkedInPath, "utf8"));
  mutate(rows);
  const crosswalkPath = path.join(directory, "domestic-standards-crosswalk.csv");
  await writeFile(crosswalkPath, serialize(rows), "utf8");
  return verifyDomesticStandardsCrosswalk({ crosswalkPath, releaseRoot });
}

test("KR-XW-GATE-001: all 48 rows are explicit and machine-linked", async () => {
  const report = await verifyDomesticStandardsCrosswalk({ releaseRoot });
  assert.equal(report.gatePassed, true, JSON.stringify(report.findings, null, 2));
  assert.deepEqual(report.summary, {
    findings: 0,
    linked: 21,
    noLocalConstraint: 23,
    partial: 4,
    rows: 48,
  });
});

test("KR-XW-GATE-002: an unregistered SHACL requirement fails closed", async (t) => {
  const report = await withMutatedCrosswalk(t, (rows) => {
    for (const row of rows) {
      for (let index = 0; index < row.length; index += 1) {
        row[index] = row[index].replaceAll(
          "MOLIT-DS-001-P-IDENTIFIER-001",
          "MOLIT-NOT-REGISTERED-001",
        );
      }
    }
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "UNKNOWN_REQUIREMENT_ID"));
});

test("KR-XW-GATE-003: an empty semantic field fails closed", async (t) => {
  const report = await withMutatedCrosswalk(t, (rows) => {
    const cardinality = CROSSWALK_HEADER.indexOf("target_cardinality");
    rows[1][cardinality] = "";
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "EMPTY_SEMANTIC_FIELD"));
});

test("KR-XW-GATE-004: no-local-constraint cannot hide a requirement link", async (t) => {
  const report = await withMutatedCrosswalk(t, (rows) => {
    const requirementIds = CROSSWALK_HEADER.indexOf("shacl_requirement_ids");
    rows[4][requirementIds] = "MOLIT-DS-001-P-IDENTIFIER-001";
  });
  assert.equal(report.gatePassed, false);
  assert.ok(report.findings.some(({ code }) => code === "NO_LOCAL_SENTINEL_MISMATCH"));
});
