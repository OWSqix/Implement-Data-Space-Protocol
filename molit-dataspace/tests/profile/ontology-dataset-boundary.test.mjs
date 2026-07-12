import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateProfileDocument } from "../../src/profile/validator.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

test("MOLIT-SEM-DATASET-BOUNDARY-001: candidate data cannot merge ontology terms", async () => {
  const report = await validateProfileDocument({
    inputPath: path.join(
      root,
      "profiles/molit-dcat-ap/releases/1.0.0-rc.1/examples/invalid/ontology-in-candidate-graph.ttl",
    ),
    profileName: "core",
    version: "1.0.0-rc.1",
  });
  assert.equal(report.summary.gatePassed, false);
  assert.ok(report.results.some(({ requirementId }) => (
    requirementId === "MOLIT-SEM-DATASET-BOUNDARY-001"
  )));
});
