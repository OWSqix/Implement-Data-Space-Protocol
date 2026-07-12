import fs from "node:fs";
import path from "node:path";

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "profile",
  "roots",
  "ignore",
  "failOn",
  "maxWarnings",
  "rules",
  "allowedHeadingSchemes",
  "knownAcronyms",
  "terminology",
  "overrides"
]);

const SEVERITIES = new Set(["off", "error", "warning", "info"]);
const HEADING_SCHEMES = new Set(["decimal", "finding", "korean-alpha", "parenthesized"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireStringArray(value, name, allowEmpty = true) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(name + " must be " + (allowEmpty ? "an array" : "a non-empty array"));
  }
  if (value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(name + " must contain non-empty strings");
  }
}

function validateRuleOptions(ruleId, options) {
  const allowed = {
    REG107: new Set(["maxVisibleChars"]),
    PRE102: new Set(["evidenceWindowLines"]),
    PRE103: new Set(["evidenceWindowLines"]),
    PRE104: new Set(["evidenceWindowLines"])
  }[ruleId] ?? new Set();

  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new Error("Unknown option for " + ruleId + ": " + key);
    }
  }
  if (
    options.maxVisibleChars !== undefined &&
    (!Number.isInteger(options.maxVisibleChars) || options.maxVisibleChars < 40)
  ) {
    throw new Error(ruleId + ".maxVisibleChars must be an integer of at least 40");
  }
  if (
    options.evidenceWindowLines !== undefined &&
    (!Number.isInteger(options.evidenceWindowLines) ||
      options.evidenceWindowLines < 0 ||
      options.evidenceWindowLines > 20)
  ) {
    throw new Error(ruleId + ".evidenceWindowLines must be an integer from 0 to 20");
  }
}

function normalizeRuleValue(ruleId, value) {
  if (typeof value === "string") {
    if (!SEVERITIES.has(value)) {
      throw new Error("Invalid severity for " + ruleId + ": " + value);
    }
    return { severity: value, options: {} };
  }

  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new Error("Rule " + ruleId + " must be a severity or [severity, options]");
  }

  const severity = value[0];
  if (!SEVERITIES.has(severity)) {
    throw new Error("Invalid severity for " + ruleId + ": " + severity);
  }

  const options = value[1] ?? {};
  if (!isObject(options)) {
    throw new Error("Rule options for " + ruleId + " must be an object");
  }

  validateRuleOptions(ruleId, options);

  return { severity, options };
}

export function normalizePath(value) {
  return value.split(path.sep).join("/");
}

export function globToRegExp(glob) {
  const normalized = normalizePath(glob);
  let source = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];

    if (char === "/" && next === "*" && afterNext === "*" && index + 3 === normalized.length) {
      source += "(?:/.*)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      if (afterNext === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  return new RegExp("^" + source + "$", process.platform === "win32" ? "i" : "");
}

export function matchesAny(filePath, patterns = []) {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function validateConfig(config) {
  if (!isObject(config)) {
    throw new Error("Configuration root must be an object");
  }

  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new Error("Unknown configuration key: " + key);
    }
  }

  if (config.schemaVersion !== 1) {
    throw new Error("Unsupported schemaVersion: " + config.schemaVersion);
  }

  if (typeof config.profile !== "string" || config.profile.length === 0) {
    throw new Error("profile must be a non-empty string");
  }

  requireStringArray(config.roots, "roots", false);
  requireStringArray(config.ignore ?? [], "ignore");

  if (config.failOn !== undefined && !new Set(["error", "warning", "info", "none"]).has(config.failOn)) {
    throw new Error("failOn must be error, warning, info, or none");
  }

  if (
    config.maxWarnings !== undefined &&
    config.maxWarnings !== null &&
    (!Number.isInteger(config.maxWarnings) || config.maxWarnings < 0)
  ) {
    throw new Error("maxWarnings must be a non-negative integer or null");
  }

  if (!isObject(config.rules)) {
    throw new Error("rules must be an object");
  }
  const normalizedRules = {};
  for (const [ruleId, value] of Object.entries(config.rules ?? {})) {
    normalizedRules[ruleId] = normalizeRuleValue(ruleId, value);
  }

  if (!Array.isArray(config.overrides ?? [])) {
    throw new Error("overrides must be an array");
  }
  const overrides = (config.overrides ?? []).map((override, index) => {
    if (!isObject(override)) {
      throw new Error("overrides[" + index + "] must be an object");
    }
    for (const key of Object.keys(override)) {
      if (!new Set(["files", "rules"]).has(key)) {
        throw new Error("Unknown overrides[" + index + "] key: " + key);
      }
    }
    requireStringArray(override.files, "overrides[" + index + "].files", false);
    if (!isObject(override.rules)) {
      throw new Error("overrides[" + index + "].rules must be an object");
    }
    const rules = {};
    for (const [ruleId, value] of Object.entries(override.rules ?? {})) {
      rules[ruleId] = normalizeRuleValue(ruleId, value);
    }
    return { files: override.files, rules };
  });

  requireStringArray(config.allowedHeadingSchemes ?? ["decimal"], "allowedHeadingSchemes", false);
  for (const scheme of config.allowedHeadingSchemes ?? ["decimal"]) {
    if (!HEADING_SCHEMES.has(scheme)) {
      throw new Error("Unknown heading scheme: " + scheme);
    }
  }
  requireStringArray(config.knownAcronyms ?? [], "knownAcronyms");
  if (!isObject(config.terminology ?? {})) {
    throw new Error("terminology must be an object");
  }
  for (const [variant, canonical] of Object.entries(config.terminology ?? {})) {
    if (!variant || typeof canonical !== "string" || !canonical) {
      throw new Error("terminology entries must map non-empty strings to non-empty strings");
    }
  }

  return {
    ...config,
    ignore: config.ignore ?? [],
    failOn: config.failOn ?? "error",
    maxWarnings: config.maxWarnings ?? null,
    allowedHeadingSchemes: config.allowedHeadingSchemes ?? ["decimal"],
    knownAcronyms: config.knownAcronyms ?? [],
    terminology: config.terminology ?? {},
    rules: normalizedRules,
    overrides
  };
}

export function findConfig(startDirectory, explicitPath) {
  if (explicitPath) {
    return path.resolve(startDirectory, explicitPath);
  }

  let current = path.resolve(startDirectory);
  while (true) {
    const candidate = path.join(current, "report-style.config.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("report-style.config.json was not found");
    }
    current = parent;
  }
}

export function loadConfig(startDirectory, explicitPath) {
  const configPath = findConfig(startDirectory, explicitPath);
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error("Cannot read configuration " + configPath + ": " + error.message);
  }

  const config = validateConfig(parsed);
  const rootDirectory = path.dirname(configPath);
  return { config, configPath, rootDirectory };
}

export function ruleForFile(config, relativePath, ruleId) {
  let selected = config.rules[ruleId] ?? { severity: "off", options: {} };

  for (const override of config.overrides) {
    if (matchesAny(relativePath, override.files) && override.rules[ruleId]) {
      selected = override.rules[ruleId];
    }
  }

  return selected;
}
