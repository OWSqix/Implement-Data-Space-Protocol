const SECRET_KEY = /(?:authorization|api[-_]?key|token|secret|password|cookie)/iu;
const API_KEY_HEADERS = new Set([
  "api-key",
  "ocp-apim-subscription-key",
  "x-api-key",
  "x-auth-token",
]);

export function redact(value, depth = 0) {
  if (depth > 8) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1),
  ]));
}

export class Telemetry {
  constructor({ sink = (line) => process.stdout.write(`${line}\n`), serviceName = "molit-platform-bridge" } = {}) {
    this.sink = sink;
    this.serviceName = serviceName;
    this.counters = new Map();
    this.gauges = new Map();
  }

  log(severityText, body, attributes = {}) {
    this.sink(JSON.stringify({
      timestamp: new Date().toISOString(),
      severityText,
      body,
      attributes: redact({ "service.name": this.serviceName, ...attributes }),
    }));
  }

  add(name, value = 1, attributes = {}) {
    const key = JSON.stringify([name, redact(attributes)]);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  set(name, value, attributes = {}) {
    this.gauges.set(JSON.stringify([name, redact(attributes)]), value);
  }

  snapshot() {
    const expand = ([key, value]) => {
      const [name, attributes] = JSON.parse(key);
      return { name, value, attributes };
    };
    return {
      counters: [...this.counters].map(expand),
      gauges: [...this.gauges].map(expand),
    };
  }
}

export function authorizationHeaders(auth, env = process.env) {
  if (!auth) return {};
  if (auth.value !== undefined) throw new Error("inline credentials are forbidden; use auth.env");
  if (typeof auth.env !== "string" || !/^[A-Z_][A-Z0-9_]*$/u.test(auth.env)) throw new Error("credential environment variable name is invalid");
  const secret = env[auth.env];
  if (!secret) throw new Error(`credential environment variable is not set: ${auth.env}`);
  if (typeof secret !== "string" || secret.length > 8_192 || secret !== secret.trim() || /[\u0000-\u001f\u007f]/u.test(secret)) {
    throw new Error("credential value is not a valid HTTP header value");
  }
  if (auth.type === "bearer") {
    if (auth.header !== undefined) throw new Error("bearer authentication uses the authorization header and does not accept auth.header");
    return { authorization: `Bearer ${secret}` };
  }
  if (auth.type === "api-key") {
    const header = auth.header ?? "x-api-key";
    if (typeof header !== "string" || header !== header.toLowerCase() || !API_KEY_HEADERS.has(header)) {
      throw new Error(`unsupported api-key header: ${header}`);
    }
    return { [header]: secret };
  }
  throw new Error(`unsupported auth type: ${auth.type}`);
}
