import { assertIdentity, IdentityError } from "./errors.mjs";

const WHITESPACE = /[\u0009\u000a\u000d\u0020]/u;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;

export function parseStrictJson(text, { maxDepth = 32, maxCharacters = 1_048_576 } = {}) {
  assertIdentity(typeof text === "string" && text.length <= maxCharacters, "IDENTITY_JSON_INVALID", "JSON response exceeds the configured limit", { status: 503 });
  let offset = 0;

  function whitespace() {
    while (offset < text.length && WHITESPACE.test(text[offset])) offset += 1;
  }

  function string() {
    const start = offset;
    assertIdentity(text[offset] === '"', "IDENTITY_JSON_INVALID", "JSON string is malformed", { status: 503 });
    offset += 1;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        try {
          return JSON.parse(text.slice(start, offset));
        } catch (error) {
          throw new IdentityError("IDENTITY_JSON_INVALID", "JSON string is malformed", { status: 503, cause: error });
        }
      }
      assertIdentity(code >= 0x20, "IDENTITY_JSON_INVALID", "JSON contains an unescaped control character", { status: 503 });
      if (code === 0x5c) {
        offset += 1;
        assertIdentity(offset < text.length && /["\\/bfnrtu]/u.test(text[offset]), "IDENTITY_JSON_INVALID", "JSON escape is malformed", { status: 503 });
        if (text[offset] === "u") {
          assertIdentity(/^[0-9a-fA-F]{4}$/u.test(text.slice(offset + 1, offset + 5)), "IDENTITY_JSON_INVALID", "JSON Unicode escape is malformed", { status: 503 });
          offset += 4;
        }
      }
      offset += 1;
    }
    throw new IdentityError("IDENTITY_JSON_INVALID", "JSON string is unterminated", { status: 503 });
  }

  function value(depth) {
    assertIdentity(depth <= maxDepth, "IDENTITY_JSON_INVALID", "JSON nesting exceeds the configured limit", { status: 503 });
    whitespace();
    if (text[offset] === '"') return string();
    if (text[offset] === "{") return object(depth + 1);
    if (text[offset] === "[") return array(depth + 1);
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return result;
      }
    }
    NUMBER.lastIndex = offset;
    const match = NUMBER.exec(text);
    assertIdentity(match, "IDENTITY_JSON_INVALID", "JSON value is malformed", { status: 503 });
    offset = NUMBER.lastIndex;
    const result = Number(match[0]);
    assertIdentity(Number.isFinite(result), "IDENTITY_JSON_INVALID", "JSON number is outside the supported range", { status: 503 });
    return result;
  }

  function object(depth) {
    offset += 1;
    whitespace();
    const result = {};
    const keys = new Set();
    if (text[offset] === "}") {
      offset += 1;
      return result;
    }
    while (offset < text.length) {
      whitespace();
      const key = string();
      assertIdentity(!keys.has(key), "IDENTITY_JSON_DUPLICATE_KEY", `JSON contains duplicate member ${key}`, { status: 503 });
      keys.add(key);
      whitespace();
      assertIdentity(text[offset] === ":", "IDENTITY_JSON_INVALID", "JSON object separator is missing", { status: 503 });
      offset += 1;
      Object.defineProperty(result, key, { value: value(depth), enumerable: true, configurable: true, writable: true });
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return result;
      }
      assertIdentity(text[offset] === ",", "IDENTITY_JSON_INVALID", "JSON object delimiter is malformed", { status: 503 });
      offset += 1;
    }
    throw new IdentityError("IDENTITY_JSON_INVALID", "JSON object is unterminated", { status: 503 });
  }

  function array(depth) {
    offset += 1;
    whitespace();
    const result = [];
    if (text[offset] === "]") {
      offset += 1;
      return result;
    }
    while (offset < text.length) {
      result.push(value(depth));
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return result;
      }
      assertIdentity(text[offset] === ",", "IDENTITY_JSON_INVALID", "JSON array delimiter is malformed", { status: 503 });
      offset += 1;
    }
    throw new IdentityError("IDENTITY_JSON_INVALID", "JSON array is unterminated", { status: 503 });
  }

  const result = value(0);
  whitespace();
  assertIdentity(offset === text.length, "IDENTITY_JSON_INVALID", "JSON has trailing content", { status: 503 });
  return result;
}
