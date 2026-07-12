import { SaxesParser } from "saxes";

const GML = "http://www.opengis.net/gml/3.2";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const NUMBER = "[+-]?(?:\\d+(?:[.]\\d*)?|[.]\\d+)(?:[eE][+-]?\\d+)?";
const WKT_POINT = new RegExp(
  `^<([^<>\\s]+)>\\s+POINT\\s*[(]\\s*(${NUMBER})\\s+(${NUMBER})\\s*[)]$`,
  "u",
);
const NUMBER_EXACT = new RegExp(`^${NUMBER}$`, "u");

function assertCrsIri(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid CRS IRI: ${value}`);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`unsupported CRS IRI: ${value}`);
  }
  return value;
}

function assertTuple(value) {
  if (!Array.isArray(value)
    || value.length !== 2
    || value.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error("coordinate tuple must contain two finite numbers");
  }
  return value;
}

function formatNumber(value) {
  return Object.is(value, -0) ? "-0" : String(value);
}

function parseNumber(value) {
  if (!NUMBER_EXACT.test(value)) throw new Error(`invalid coordinate number: ${value}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`non-finite coordinate number: ${value}`);
  return parsed;
}

function escapeXmlAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Map named directional values into the authority-defined tuple order. */
export function tupleForAxisOrder(axisOrder, coordinateByDirection) {
  if (!Array.isArray(axisOrder)
    || axisOrder.length !== 2
    || new Set(axisOrder).size !== 2) {
    throw new Error("axis order must contain two distinct directions");
  }
  return assertTuple(axisOrder.map((direction) => coordinateByDirection[direction]));
}

/** Serialize one explicit-CRS, two-dimensional WKT POINT without reprojection. */
export function serializeWktPoint({ crsIri, tuple }) {
  assertCrsIri(crsIri);
  assertTuple(tuple);
  return `<${crsIri}> POINT (${tuple.map(formatNumber).join(" ")})`;
}

/** Parse the same bounded WKT POINT subset emitted by serializeWktPoint. */
export function parseWktPoint(source) {
  if (typeof source !== "string" || source.length > 4096) {
    throw new Error("WKT point exceeds the supported lexical boundary");
  }
  const match = source.match(WKT_POINT);
  if (!match) throw new Error("unsupported WKT point lexical form");
  return {
    crsIri: assertCrsIri(match[1]),
    tuple: [parseNumber(match[2]), parseNumber(match[3])],
  };
}

/** Serialize one GML 3.2 Point tuple without coordinate transformation. */
export function serializeGmlPoint({ crsIri, tuple }) {
  assertCrsIri(crsIri);
  assertTuple(tuple);
  return [
    `<gml:Point xmlns:gml="${GML}" srsName="${escapeXmlAttribute(crsIri)}" srsDimension="2">`,
    `<gml:pos>${tuple.map(formatNumber).join(" ")}</gml:pos>`,
    "</gml:Point>",
  ].join("");
}

/** Parse the bounded GML 3.2 Point subset emitted by serializeGmlPoint. */
export function parseGmlPoint(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > 8192) {
    throw new Error("GML point exceeds the supported lexical boundary");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) {
    throw new Error("GML point must not contain DTD or entity declarations");
  }
  const stack = [];
  let crsIri;
  let posText = "";
  let positionCount = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new Error("GML point DOCTYPE is prohibited"); });
  parser.on("processinginstruction", ({ target }) => {
    throw new Error(`GML point processing instruction is prohibited: ${target}`);
  });
  parser.on("opentag", (tag) => {
    if (stack.length === 0) {
      if (tag.uri !== GML || tag.local !== "Point") {
        throw new Error("GML root must be gml:Point");
      }
      const attributes = Object.values(tag.attributes).filter(({ uri }) => uri !== XMLNS);
      const srsName = attributes.find(({ uri, local }) => uri === "" && local === "srsName");
      const dimension = attributes.find(({ uri, local }) => (
        uri === "" && local === "srsDimension"
      ));
      if (attributes.length !== 2 || dimension?.value !== "2" || !srsName) {
        throw new Error("GML Point requires only srsName and srsDimension=2");
      }
      crsIri = assertCrsIri(srsName.value);
    } else if (stack.length === 1 && tag.uri === GML && tag.local === "pos") {
      if (Object.keys(tag.attributes).length !== 0 || positionCount !== 0) {
        throw new Error("GML Point must contain one unqualified gml:pos");
      }
      positionCount += 1;
    } else {
      throw new Error(`unsupported GML Point child: ${tag.name}`);
    }
    stack.push({ local: tag.local, uri: tag.uri });
  });
  parser.on("text", (value) => {
    if (stack.length === 2 && stack.at(-1)?.uri === GML && stack.at(-1)?.local === "pos") {
      posText += value;
    } else if (value.trim() !== "") {
      throw new Error("unexpected GML Point text");
    }
  });
  parser.on("closetag", () => {
    if (!stack.pop()) throw new Error("GML Point element stack underflow");
  });
  parser.on("error", (error) => { throw error; });
  parser.write(source).close();
  if (stack.length !== 0 || positionCount !== 1 || !crsIri) {
    throw new Error("GML Point document is incomplete");
  }
  const fields = posText.trim().split(/\s+/u);
  if (fields.length !== 2) throw new Error("GML Point position must contain two coordinates");
  return {
    crsIri,
    tuple: fields.map(parseNumber),
  };
}
