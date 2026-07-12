import assert from "node:assert/strict";
import test from "node:test";
import { DataFactory, Store } from "n3";
import { scanPublicGraph } from "../../src/profile/rdf-loader.mjs";
import {
  supportedXsdDatatypes,
  validateSupportedXsdLiteral,
} from "../../src/profile/xsd-lexical.mjs";

const { literal, namedNode, quad } = DataFactory;
const XSD = "http://www.w3.org/2001/XMLSchema#";

function result(value, datatype) {
  return validateSupportedXsdLiteral(literal(value, namedNode(`${XSD}${datatype}`)));
}

test("ST-XSD-REG-001: every approved XSD datatype has an executable lexical/value validator", () => {
  const examples = new Map([
    ["boolean", ["true", "TRUE"]],
    ["date", ["2024-02-29", "2023-02-29"]],
    ["dateTime", ["2026-07-12T09:00:00", "2026-07-12T25:00:00"]],
    ["dateTimeStamp", ["2026-07-12T09:00:00Z", "2026-07-12T09:00:00"]],
    ["decimal", ["-0.125", "1e2"]],
    ["double", ["1.25E2", "Infinity"]],
    ["duration", ["P1Y2M3DT4H5M6.7S", "PT"]],
    ["float", ["NaN", "nan"]],
    ["hexBinary", ["00Af", "0Af"]],
    ["integer", ["+42", "42.0"]],
    ["negativeInteger", ["-1", "-0"]],
    ["nonNegativeInteger", ["0", "-1"]],
    ["nonPositiveInteger", ["-1", "+1"]],
    ["positiveInteger", ["+1", "0"]],
    ["string", ["한글 text", null]],
  ]);
  assert.deepEqual(
    supportedXsdDatatypes,
    [...examples.keys()].map((name) => `${XSD}${name}`).sort(),
  );
  for (const [datatype, [validValue, invalidValue]] of examples) {
    assert.deepEqual(result(validValue, datatype), {
      datatype: `${XSD}${datatype}`,
      reason: null,
      valid: true,
    });
    if (invalidValue !== null) {
      assert.equal(result(invalidValue, datatype).valid, false, `${datatype}: ${invalidValue}`);
      assert.equal(
        result(invalidValue, datatype).reason,
        "invalid-lexical-or-value-space",
      );
    }
  }
});

test("ST-XSD-REG-002: unknown XSD names fail closed while non-XSD datatypes stay delegated", () => {
  for (const datatype of ["QName", "anyType", "dateTypo", "unsignedLong"]) {
    assert.deepEqual(result("value", datatype), {
      datatype: `${XSD}${datatype}`,
      reason: "unsupported-xsd-datatype",
      valid: false,
    });
  }
  const custom = literal("value", namedNode("https://example.test/datatype/custom"));
  assert.equal(validateSupportedXsdLiteral(custom), null);
  assert.equal(validateSupportedXsdLiteral(namedNode("https://example.test/not-a-literal")), null);
});

test("ST-XSD-REG-003: public graph preflight reports an unknown XSD datatype", () => {
  const store = new Store([
    quad(
      namedNode("https://example.test/dataset/1"),
      namedNode("http://purl.org/dc/terms/title"),
      literal("forged", namedNode(`${XSD}dateTypo`)),
    ),
  ]);
  const report = scanPublicGraph(store, {
    maxLiteralLength: 10_000,
    maxValidationResults: 100,
    maxValuesPerSubjectPredicate: 100,
  }, 100, {
    allowedPublicHosts: ["example.test", "purl.org", "www.w3.org"],
  });
  const finding = report.findings.find((item) => (
    item.requirementId === "MOLIT-SEM-DATATYPE-001"
  ));
  assert.ok(finding);
  assert.ok(finding.messages.some((message) => /승인된 registry/u.test(message.value)));
});
