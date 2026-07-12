import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const schema = JSON.parse(await readFile(path.join(root, "contracts/profile-release-acceptance.v1.schema.json"), "utf8"));
const register = JSON.parse(await readFile(path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1/release-acceptance.json"), "utf8"));

test("REL-ACCEPT-001: RC release acceptance register satisfies its machine schema", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(register), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(new Set(register.items.map(({ id }) => id)).size, register.items.length);
});

test("REL-ACCEPT-002: repository evidence paths exist and deferred adapter work never blocks core", async () => {
  for (const item of register.items) {
    for (const evidence of item.evidence.filter(({ kind }) => kind === "repository-file")) {
      await access(path.join(root, evidence.value));
    }
    if (item.scope === "interoperability-pack") {
      assert.equal(item.blocksCandidate, false, item.id);
      assert.equal(item.blocksRecommendation, false, item.id);
    }
    if (item.status === "fixed") {
      assert.equal(item.blocksCandidate, false, item.id);
      assert.equal(item.blocksRecommendation, false, item.id);
    }
  }
});

test("REL-ACCEPT-003: RC and recommendation decisions use separate blocker sets", () => {
  const candidate = register.items.filter((item) => item.blocksCandidate && item.status !== "fixed");
  const recommendation = register.items.filter((item) => item.blocksRecommendation && item.status !== "fixed");
  assert.deepEqual(candidate, []);
  assert.ok(recommendation.some(({ id }) => id === "RA-NAMESPACE"));
  assert.ok(recommendation.length > candidate.length);
});
