import assert from "node:assert/strict";
import test from "node:test";
import { DataFactory } from "n3";
import { validateSupportedXsdLiteral } from "../../src/profile/xsd-lexical.mjs";

const { literal, namedNode } = DataFactory;
const XSD = "http://www.w3.org/2001/XMLSchema#";

function valid(value, datatype) {
  return validateSupportedXsdLiteral(literal(value, namedNode(`${XSD}${datatype}`)))?.valid;
}

test("ST-XSD-001: supported temporal datatypes enforce calendar and timezone values", () => {
  for (const [value, datatype] of [
    ["2026-13-01", "date"],
    ["2026-02-30", "date"],
    ["2025-02-29", "date"],
    ["0000-01-01", "date"],
    ["01234-01-01", "date"],
    ["+2026-01-01", "date"],
    ["2026-07-12T09:00:00+14:01", "dateTime"],
    ["2026-07-12T25:00:00Z", "dateTime"],
    ["2026-07-12T24:00:01Z", "dateTime"],
    ["2026-07-12T09:00:00", "dateTimeStamp"],
    ["P", "duration"],
    ["PT", "duration"],
    ["P1YT", "duration"],
  ]) assert.equal(valid(value, datatype), false, `${datatype}: ${value}`);

  for (const [value, datatype] of [
    ["2024-02-29", "date"],
    ["12345-02-28", "date"],
    ["-0004-02-29", "date"],
    ["2026-07-12+14:00", "date"],
    ["2026-07-12T24:00:00Z", "dateTime"],
    ["2026-07-12T09:00:00.125-14:00", "dateTimeStamp"],
    ["P0D", "duration"],
    ["P1Y2M3DT4H5M6.7S", "duration"],
  ]) assert.equal(valid(value, datatype), true, `${datatype}: ${value}`);
});

test("ST-XSD-002: supported numeric datatypes enforce their lexical and value spaces", () => {
  for (const [value, datatype] of [
    ["1e2", "decimal"],
    ["1e", "double"],
    ["1.0", "integer"],
    ["-1", "nonNegativeInteger"],
    ["0", "positiveInteger"],
    ["-0", "negativeInteger"],
    ["TRUE", "boolean"],
    ["0", "hexBinary"],
    ["0g", "hexBinary"],
  ]) assert.equal(valid(value, datatype), false, `${datatype}: ${value}`);

  for (const [value, datatype] of [
    [".5", "decimal"],
    ["1.0e2", "double"],
    ["-0", "nonNegativeInteger"],
    ["+1", "positiveInteger"],
    ["NaN", "float"],
    ["00Af", "hexBinary"],
    ["1", "boolean"],
  ]) assert.equal(valid(value, datatype), true, `${datatype}: ${value}`);
});
