#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizePath } from "./lib/config.mjs";
import { discoverMarkdownFiles } from "./lib/discover.mjs";
import { profileScans } from "./lib/profiler.mjs";
import { analyzeMarkdown, RULE_CATALOG } from "./lib/rules.mjs";
import { scanMarkdown } from "./lib/scanner.mjs";
import {
  buildLintResult,
  formatExplainText,
  formatLintText,
  formatProfileText
} from "./lib/reporters.mjs";

const COMMANDS = new Set(["lint", "profile", "explain"]);
const FORMATS = new Set(["text", "json"]);
const FAIL_LEVELS = new Set(["error", "warning", "info", "none"]);

function usage() {
  return [
    "사용법: node tools/report-style/cli.mjs <command> [paths...] [options]",
    "",
    "Commands:",
    "  lint       문서 위반 위치와 교정 방향 검사",
    "  profile    현재 문서군의 문체 지문 집계",
    "  explain    전체 규칙 또는 지정 규칙 설명",
    "",
    "Options:",
    "  --config <path>       설정 파일 경로",
    "  --format <text|json>  출력 형식",
    "  --fail-on <level>     lint 실패 기준(error|warning|info|none)",
    "  --max-warnings <n>    허용할 최대 경고 수",
    "  -h, --help            도움말"
  ].join("\n");
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(option + " 뒤에 값이 필요함");
  }
  return value;
}

export function parseArguments(argv) {
  const parsed = {
    command: "lint",
    paths: [],
    configPath: undefined,
    format: "text",
    failOn: undefined,
    maxWarnings: undefined,
    help: false
  };
  let index = 0;

  if (COMMANDS.has(argv[0])) {
    parsed.command = argv[0];
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-h" || value === "--help") {
      parsed.help = true;
    } else if (value === "--config") {
      parsed.configPath = takeValue(argv, index, value);
      index += 1;
    } else if (value.startsWith("--config=")) {
      parsed.configPath = value.slice("--config=".length);
    } else if (value === "--format") {
      parsed.format = takeValue(argv, index, value);
      index += 1;
    } else if (value.startsWith("--format=")) {
      parsed.format = value.slice("--format=".length);
    } else if (value === "--fail-on") {
      parsed.failOn = takeValue(argv, index, value);
      index += 1;
    } else if (value.startsWith("--fail-on=")) {
      parsed.failOn = value.slice("--fail-on=".length);
    } else if (value === "--max-warnings") {
      parsed.maxWarnings = Number(takeValue(argv, index, value));
      index += 1;
    } else if (value.startsWith("--max-warnings=")) {
      parsed.maxWarnings = Number(value.slice("--max-warnings=".length));
    } else if (value.startsWith("-")) {
      throw new Error("알 수 없는 option: " + value);
    } else {
      parsed.paths.push(value);
    }
  }

  if (!FORMATS.has(parsed.format)) {
    throw new Error("format은 text 또는 json이어야 함");
  }
  if (parsed.failOn !== undefined && !FAIL_LEVELS.has(parsed.failOn)) {
    throw new Error("fail-on은 error, warning, info, none 중 하나여야 함");
  }
  if (
    parsed.maxWarnings !== undefined &&
    (!Number.isInteger(parsed.maxWarnings) || parsed.maxWarnings < 0)
  ) {
    throw new Error("max-warnings는 0 이상의 정수여야 함");
  }
  return parsed;
}

function validateRuleIds(config) {
  const configured = [
    ...Object.keys(config.rules),
    ...config.overrides.flatMap((override) => Object.keys(override.rules))
  ];
  for (const ruleId of configured) {
    if (!RULE_CATALOG[ruleId]) {
      throw new Error("정의되지 않은 rule ID: " + ruleId);
    }
  }
}

function normalizeInputs(inputs, cwd, rootDirectory) {
  return inputs.map((input) => {
    const resolved = fs.realpathSync.native(path.resolve(cwd, input));
    const realRoot = fs.realpathSync.native(rootDirectory);
    const relativeNative = path.relative(realRoot, resolved);
    const relative = normalizePath(relativeNative);
    if (path.isAbsolute(relativeNative) || relative === ".." || relative.startsWith("../")) {
      throw new Error("검사 경로가 configuration root 밖에 있음: " + input);
    }
    return relative || ".";
  });
}

function readScans(files, rootDirectory) {
  return files.map((filePath) => ({
    path: filePath,
    relativePath: normalizePath(path.relative(rootDirectory, filePath)),
    scan: scanMarkdown(fs.readFileSync(filePath, "utf8"))
  }));
}

function writeJson(output, value) {
  output.write(JSON.stringify(value, null, 2) + "\n");
}

export async function runCli(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  try {
    const parsed = parseArguments(argv);
    if (parsed.help) {
      stdout.write(usage() + "\n");
      return 0;
    }

    const { config, rootDirectory } = loadConfig(cwd, parsed.configPath);
    validateRuleIds(config);

    if (parsed.command === "explain") {
      const requested = parsed.paths.length === 0 ? Object.keys(RULE_CATALOG) : parsed.paths;
      const entries = requested.map((ruleId) => {
        if (!RULE_CATALOG[ruleId]) {
          throw new Error("정의되지 않은 rule ID: " + ruleId);
        }
        return [ruleId, RULE_CATALOG[ruleId]];
      });
      if (parsed.format === "json") {
        writeJson(stdout, Object.fromEntries(entries));
      } else {
        stdout.write(formatExplainText(entries) + "\n");
      }
      return 0;
    }

    const inputs = parsed.paths.length > 0
      ? normalizeInputs(parsed.paths, cwd, rootDirectory)
      : config.roots;
    const files = discoverMarkdownFiles(inputs, rootDirectory, config.ignore);
    if (files.length === 0) {
      throw new Error("검사할 Markdown 파일이 없음");
    }
    const scannedFiles = readScans(files, rootDirectory);

    if (parsed.command === "profile") {
      const stats = profileScans(scannedFiles, config);
      if (parsed.format === "json") {
        writeJson(stdout, { profile: config.profile, ...stats });
      } else {
        stdout.write(formatProfileText(config.profile, stats) + "\n");
      }
      return 0;
    }

    const diagnostics = scannedFiles
      .flatMap(({ relativePath, scan }) => analyzeMarkdown(scan, relativePath, config))
      .sort((left, right) =>
        left.path.localeCompare(right.path) ||
        left.line - right.line ||
        left.column - right.column ||
        left.ruleId.localeCompare(right.ruleId)
      );
    const failOn = parsed.failOn ?? config.failOn;
    const maxWarnings = parsed.maxWarnings ?? config.maxWarnings;
    const result = buildLintResult(config.profile, files, diagnostics, failOn, maxWarnings);

    if (parsed.format === "json") {
      writeJson(stdout, result);
    } else {
      stdout.write(formatLintText(result) + "\n");
    }
    return result.gate.passed ? 0 : 1;
  } catch (error) {
    stderr.write("report-style: " + error.message + "\n");
    return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2));
}
