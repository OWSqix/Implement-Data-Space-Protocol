import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(MODULE_DIRECTORY, "namespace-config.schema.json");

const DEFAULTS = Object.freeze({
  allowedHosts: ["data.molit.go.kr"],
  contractFile: "publication/content-negotiation.json",
  gracefulShutdownMs: 10_000,
  headerTimeoutMs: 10_000,
  keepAliveTimeoutMs: 5_000,
  listenHost: "127.0.0.1",
  maxArtifactBytes: 32 * 1024 * 1024,
  maxSnapshotBytes: 128 * 1024 * 1024,
  maxUrlLength: 4_096,
  port: 8_080,
  publicOrigin: "https://data.molit.go.kr",
  releaseRoot: "profiles/molit-dcat-ap/releases/1.0.0-rc.1",
  requestTimeoutMs: 30_000,
});

const ENVIRONMENT_MAPPING = Object.freeze({
  MOLIT_NAMESPACE_ALLOWED_HOSTS: ["allowedHosts", (value) => value.split(",").map((item) => item.trim()).filter(Boolean)],
  MOLIT_NAMESPACE_CONTRACT_FILE: ["contractFile", String],
  MOLIT_NAMESPACE_GRACEFUL_SHUTDOWN_MS: ["gracefulShutdownMs", Number],
  MOLIT_NAMESPACE_HEADER_TIMEOUT_MS: ["headerTimeoutMs", Number],
  MOLIT_NAMESPACE_KEEP_ALIVE_TIMEOUT_MS: ["keepAliveTimeoutMs", Number],
  MOLIT_NAMESPACE_LISTEN_HOST: ["listenHost", String],
  MOLIT_NAMESPACE_MAX_ARTIFACT_BYTES: ["maxArtifactBytes", Number],
  MOLIT_NAMESPACE_MAX_SNAPSHOT_BYTES: ["maxSnapshotBytes", Number],
  MOLIT_NAMESPACE_MAX_URL_LENGTH: ["maxUrlLength", Number],
  MOLIT_NAMESPACE_PORT: ["port", Number],
  MOLIT_NAMESPACE_PUBLIC_ORIGIN: ["publicOrigin", String],
  MOLIT_NAMESPACE_RELEASE_ROOT: ["releaseRoot", String],
  MOLIT_NAMESPACE_REQUEST_TIMEOUT_MS: ["requestTimeoutMs", Number],
});

function configurationFailure(message, details = {}) {
  const error = new Error(message);
  error.code = "INVALID_NAMESPACE_CONFIGURATION";
  error.details = details;
  return error;
}

function parsePublicOrigin(value) {
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw configurationFailure("publicOrigin must be an absolute HTTPS origin");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw configurationFailure("publicOrigin must be an absolute HTTPS origin without credentials, path, query, or fragment");
  }
  return origin.origin;
}

function canonicalAuthority(value) {
  if (/[/\\@\s]/u.test(value)) {
    throw configurationFailure("allowedHosts entries must be exact HTTP Host authorities", { value });
  }
  let parsed;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw configurationFailure("allowedHosts contains an invalid authority", { value });
  }
  if (!parsed.hostname || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw configurationFailure("allowedHosts contains an invalid authority", { value });
  }
  return parsed.host.toLowerCase();
}

function safeRelativeFile(value, field) {
  if (path.isAbsolute(value) || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw configurationFailure(`${field} must be a traversal-free relative POSIX path`, { value });
  }
  return value;
}

async function configurationSchema() {
  return JSON.parse(await readFile(SCHEMA_FILE, "utf8"));
}

export async function loadNamespaceConfig({ cwd = process.cwd(), env = process.env } = {}) {
  let fileConfiguration = {};
  if (env.MOLIT_NAMESPACE_CONFIG) {
    const configPath = path.resolve(cwd, env.MOLIT_NAMESPACE_CONFIG);
    try {
      fileConfiguration = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      throw configurationFailure("namespace configuration file cannot be read", {
        cause: error.message,
        path: configPath,
      });
    }
  }

  const configuration = { ...DEFAULTS, ...fileConfiguration };
  for (const [environmentName, [property, converter]] of Object.entries(ENVIRONMENT_MAPPING)) {
    if (env[environmentName] !== undefined) configuration[property] = converter(env[environmentName]);
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(await configurationSchema());
  if (!validate(configuration)) {
    throw configurationFailure("namespace configuration does not match its schema", {
      errors: validate.errors,
    });
  }

  configuration.publicOrigin = parsePublicOrigin(configuration.publicOrigin);
  configuration.allowedHosts = configuration.allowedHosts.map(canonicalAuthority);
  if (new Set(configuration.allowedHosts).size !== configuration.allowedHosts.length) {
    throw configurationFailure("allowedHosts contains duplicate canonical authorities");
  }
  if (!configuration.allowedHosts.includes(new URL(configuration.publicOrigin).host.toLowerCase())) {
    throw configurationFailure("allowedHosts must contain the publicOrigin authority");
  }
  if (configuration.maxArtifactBytes > configuration.maxSnapshotBytes) {
    throw configurationFailure("maxArtifactBytes must not exceed maxSnapshotBytes");
  }
  configuration.contractFile = safeRelativeFile(configuration.contractFile, "contractFile");
  configuration.releaseRoot = path.resolve(cwd, configuration.releaseRoot);
  return Object.freeze({
    ...configuration,
    allowedHosts: Object.freeze([...configuration.allowedHosts]),
  });
}

export { DEFAULTS as NAMESPACE_CONFIG_DEFAULTS };
