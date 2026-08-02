import { randomBytes } from "node:crypto";
import { assertObservability } from "./errors.mjs";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
const TRACESTATE_KEY = /^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/u;
const TRACESTATE_VALUE = /^[\x20-\x7e]+$/u;

function oneHeader(headers, name) {
  const direct = headers?.[name] ?? headers?.[name.toLowerCase()];
  assertObservability(!Array.isArray(direct) || direct.length <= 1, "OBS_TRACE_HEADER_DUPLICATE", `${name} must occur at most once`, { status: 400 });
  const distinct = headers?.headersDistinct?.[name.toLowerCase()];
  assertObservability(!distinct || distinct.length <= 1, "OBS_TRACE_HEADER_DUPLICATE", `${name} must occur at most once`, { status: 400 });
  return Array.isArray(direct) ? direct[0] : direct;
}

export function parseTracestate(value) {
  if (value === undefined || value === null || value === "") return undefined;
  assertObservability(typeof value === "string" && value.length <= 512, "OBS_TRACESTATE_INVALID", "tracestate must be a string of at most 512 characters", { status: 400 });
  const members = value.split(",");
  assertObservability(members.length <= 32, "OBS_TRACESTATE_INVALID", "tracestate has more than 32 list-members", { status: 400 });
  const keys = new Set();
  const canonicalMembers = [];
  for (const rawMember of members) {
    const member = rawMember.trim();
    assertObservability(member.includes("="), "OBS_TRACESTATE_INVALID", "tracestate list-member is malformed", { status: 400 });
    const index = member.indexOf("=");
    const key = member.slice(0, index);
    const item = member.slice(index + 1);
    assertObservability(TRACESTATE_KEY.test(key) && item.length > 0 && item.length <= 256 && TRACESTATE_VALUE.test(item) && !item.endsWith(" ") && !item.includes(",") && !item.includes("="), "OBS_TRACESTATE_INVALID", "tracestate list-member is malformed", { status: 400 });
    assertObservability(!keys.has(key), "OBS_TRACESTATE_DUPLICATE", "tracestate vendor keys must be unique", { status: 400 });
    keys.add(key);
    canonicalMembers.push(member);
  }
  return canonicalMembers.join(",");
}

export function parseTraceparent(value) {
  assertObservability(typeof value === "string", "OBS_TRACEPARENT_REQUIRED", "traceparent is required", { status: 400 });
  assertObservability(value === value.toLowerCase(), "OBS_TRACEPARENT_INVALID", "traceparent must use lowercase hexadecimal", { status: 400 });
  const match = TRACEPARENT.exec(value);
  assertObservability(match, "OBS_TRACEPARENT_INVALID", "traceparent must use the W3C version 00 wire format", { status: 400 });
  const [, traceId, parentId, flags] = match;
  assertObservability(!/^0+$/u.test(traceId) && !/^0+$/u.test(parentId), "OBS_TRACEPARENT_INVALID", "trace and parent identifiers must be non-zero", { status: 400 });
  return Object.freeze({ version: "00", traceId, spanId: parentId, traceFlags: flags, sampled: (Number.parseInt(flags, 16) & 1) === 1 });
}

export function extractTraceContext(headers = {}, { required = false } = {}) {
  const traceparent = oneHeader(headers, "traceparent");
  const tracestate = oneHeader(headers, "tracestate");
  if (!traceparent) {
    assertObservability(!required && !tracestate, "OBS_TRACEPARENT_REQUIRED", "tracestate cannot occur without traceparent", { status: 400 });
    return undefined;
  }
  return Object.freeze({ ...parseTraceparent(traceparent), tracestate: parseTracestate(tracestate) });
}

function nonZeroId(bytes) {
  let value;
  do { value = randomBytes(bytes).toString("hex"); } while (/^0+$/u.test(value));
  return value;
}

export function createRootTraceContext({ sampled = true } = {}) {
  return Object.freeze({ version: "00", traceId: nonZeroId(16), spanId: nonZeroId(8), traceFlags: sampled ? "01" : "00", sampled, tracestate: undefined });
}

export function createChildTraceContext(parent) {
  assertObservability(parent?.traceId && parent?.traceFlags, "OBS_PARENT_CONTEXT_INVALID", "parent trace context is invalid");
  return Object.freeze({ ...parent, spanId: nonZeroId(8) });
}

export function injectTraceContext(headers = {}, context) {
  assertObservability(context?.traceId && context?.spanId && context?.traceFlags, "OBS_CONTEXT_INVALID", "trace context is invalid");
  const result = { ...headers, traceparent: `00-${context.traceId}-${context.spanId}-${context.traceFlags}` };
  if (context.tracestate) result.tracestate = context.tracestate;
  return result;
}
