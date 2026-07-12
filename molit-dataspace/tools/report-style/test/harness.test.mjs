import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../cli.mjs";
import { globToRegExp, loadConfig } from "../lib/config.mjs";
import { profileScans } from "../lib/profiler.mjs";
import { buildLintResult, formatLintText } from "../lib/reporters.mjs";
import { analyzeMarkdown } from "../lib/rules.mjs";
import { scanMarkdown } from "../lib/scanner.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "../../..");
const fixtureDirectory = path.join(testDirectory, "fixtures");
const { config } = loadConfig(projectRoot);

function analyze(text, relativePath = "docs/sample.md") {
  return analyzeMarkdown(scanMarkdown(text), relativePath, config);
}

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDirectory, name), "utf8");
}

test("승인된 구조와 문체는 blocking diagnostic을 만들지 않음", () => {
  const diagnostics = analyze(readFixture("pass.md"));
  assert.equal(diagnostics.filter((item) => item.severity === "error").length, 0);
});

test("대화형 도입, 존대형과 대표 표기 위반을 검출함", () => {
  const diagnostics = analyze(readFixture("fail.md"));
  const rules = new Set(diagnostics.map((item) => item.ruleId));
  assert.ok(rules.has("STR002"));
  assert.ok(rules.has("REG101"));
  assert.ok(rules.has("REG102"));
  assert.ok(rules.has("REG106"));
  assert.ok(rules.has("TRM103"));
});

test("일반 존대 종결은 검출하고 평서형 다 종결은 허용함", () => {
  const diagnostics = analyze([
    "# 종결 기준",
    "",
    "## 1. 검토 범위",
    "",
    "확인했습니다.",
    "변경되었습니다.",
    "검토를 바랍니다.",
    "이 결과는 아니다."
  ].join("\n"));
  assert.equal(diagnostics.filter((item) => item.ruleId === "REG102").length, 3);
});

test("코드, 표, 인용문과 금지 문장 절을 검사에서 제외함", () => {
  const diagnostics = analyze(readFixture("ignored-context.md"));
  assert.equal(diagnostics.some((item) => item.ruleId === "TRM101"), false);
  assert.equal(diagnostics.some((item) => item.ruleId === "REG101"), false);
});

test("기술 오류의 긍정 주장만 검출하고 부정문은 허용함", () => {
  const positive = analyze([
    "# 기술 판정",
    "",
    "## 1. 검토 범위",
    "",
    "DSP가 실제 데이터를 전송한다."
  ].join("\n"));
  const negative = analyze([
    "# 기술 판정",
    "",
    "## 1. 검토 범위",
    "",
    "DSP는 실제 payload 전송 프로토콜을 규정하지 않는다."
  ].join("\n"));
  assert.ok(positive.some((item) => item.ruleId === "TRM101"));
  assert.equal(negative.some((item) => item.ruleId === "TRM101"), false);
});

test("절대 주장에 근거가 없으면 검출하고 근접 근거가 있으면 허용함", () => {
  const withoutEvidence = analyze([
    "# 기술 판정",
    "",
    "## 1. 검토 범위",
    "",
    "- 외부 데이터 교환을 100% 보장"
  ].join("\n"));
  const withEvidence = analyze([
    "# 기술 판정",
    "",
    "## 1. 검토 범위",
    "",
    "- 외부 데이터 교환을 100% 보장",
    "- 근거: `SRC-TEST-001` 시험 결과"
  ].join("\n"));
  assert.ok(withoutEvidence.some((item) => item.ruleId === "PRE102"));
  assert.equal(withEvidence.some((item) => item.ruleId === "PRE102"), false);
});

test("제외 문맥과 무관한 인접 bullet은 절대 주장의 근거가 아님", () => {
  const codeEvidence = analyze([
    "# 근거 기준",
    "",
    "## 1. 검토 범위",
    "",
    "- 외부 데이터 교환을 100% 보장",
    "```text",
    "SRC-TEST-001",
    "```"
  ].join("\n"));
  const bareWord = analyze([
    "# 근거 기준",
    "",
    "## 1. 검토 범위",
    "",
    "- 모든 접근을 보장하는 검증 체계 구축"
  ].join("\n"));
  const unrelated = analyze([
    "# 근거 기준",
    "",
    "## 1. 검토 범위",
    "",
    "- 외부 데이터 교환을 100% 보장",
    "- SRC-TEST-001은 다른 기능의 근거"
  ].join("\n"));
  assert.ok(codeEvidence.some((item) => item.ruleId === "PRE102"));
  assert.ok(bareWord.some((item) => item.ruleId === "PRE102"));
  assert.ok(unrelated.some((item) => item.ruleId === "PRE102"));
});

test("국문·영문·약어 병기는 첫 정의로 인식함", () => {
  const defined = analyze([
    "# 약어 기준",
    "",
    "## 1. 검토 범위",
    "",
    "접근 제어 목록(Access Control List, ACL)을 적용하고 ACL 기록을 남긴다."
  ].join("\n"));
  const undefined = analyze([
    "# 약어 기준",
    "",
    "## 1. 검토 범위",
    "",
    "ACL 기록을 남긴다."
  ].join("\n"));
  assert.equal(defined.some((item) => item.ruleId === "TRM102"), false);
  assert.ok(undefined.some((item) => item.ruleId === "TRM102"));

  const commaSeparated = analyze([
    "# 약어 기준",
    "",
    "## 1. 검토 범위",
    "",
    "추출·변환·적재(Extract, Transform, Load, ETL) 작업을 기록한다."
  ].join("\n"));
  assert.equal(commaSeparated.some((item) => item.ruleId === "TRM102"), false);
});

test("한 줄 suppression은 사유가 있을 때 지정 규칙만 제외함", () => {
  const diagnostics = analyze([
    "\uFEFF# 예외 기준\r",
    "\r",
    "## 1. 검토 범위\r",
    "\r",
    "<!-- report-style-disable-next-line REG101: 교육용 문장을 그대로 인용 -->\r",
    "오늘은 연계 구조를 알아보자.\r"
  ].join("\n"));
  assert.equal(diagnostics.some((item) => item.ruleId === "REG101"), false);
  assert.equal(scanMarkdown("\uFEFF# 제목\r\n").lines[0].heading.level, 1);
});

test("긴 fence 내부의 짧은 fence와 문체 예시를 코드로 유지함", () => {
  const diagnostics = analyze([
    "# Fence 기준",
    "",
    "## 1. 검토 범위",
    "",
    "````markdown",
    "```",
    "오늘은 구조를 알아보자.",
    "```",
    "````"
  ].join("\n"));
  assert.equal(diagnostics.some((item) => item.ruleId === "REG101"), false);
});

test("들여쓴 ATX, Setext, C# 제목과 외곽선 없는 GFM 표를 구분함", () => {
  const scan = scanMarkdown([
    "   # C#",
    "",
    "검토 범위",
    "-------------",
    "",
    "구분 | 내용",
    "--- | ---",
    "예시 | 오늘은 구조를 알아보자."
  ].join("\n"));
  assert.equal(scan.lines[0].heading.level, 1);
  assert.equal(scan.lines[0].heading.text, "C#");
  assert.equal(scan.lines[2].heading.level, 2);
  assert.equal(scan.lines[5].type, "table");
  assert.equal(scan.lines[7].skip, true);
  assert.equal(analyzeMarkdown(scan, "docs/sample.md", config).some((item) => item.ruleId === "REG101"), false);
});

test("다중행 HTML comment와 link definition을 검사에서 제외함", () => {
  const diagnostics = analyze([
    "# Comment 기준",
    "",
    "## 1. 검토 범위",
    "",
    "<!--",
    "오늘은 구조를 알아보자.",
    "-->",
    "[bad-example]: https://example.invalid/오늘은-알아보자"
  ].join("\n"));
  assert.equal(diagnostics.some((item) => item.ruleId === "REG101"), false);
});

test("첫 15행의 임의 label은 metadata가 아니며 H1은 첫 heading이어야 함", () => {
  const metadataBypass = analyze([
    "# Metadata 기준",
    "",
    "## 1. 검토 범위",
    "",
    "결론: 확인했습니다."
  ].join("\n"));
  const h1AfterH2 = analyze([
    "## 1. 검토 범위",
    "",
    "# 뒤늦은 제목"
  ].join("\n"));
  assert.ok(metadataBypass.some((item) => item.ruleId === "REG102"));
  assert.ok(h1AfterH2.some((item) => item.ruleId === "STR001" && item.message.includes("첫 heading")));
});

test("source identifier는 약어가 아니며 조사 뒤 100% 단정을 검출함", () => {
  const identifier = analyze([
    "# 식별자 기준",
    "",
    "## 1. 검토 범위",
    "",
    "근거: SRC-DSP-001, G0, H1, FINALIZED"
  ].join("\n"));
  const absolute = analyze([
    "# 단정 기준",
    "",
    "## 1. 검토 범위",
    "",
    "정확도 100%를 보장한다."
  ].join("\n"));
  assert.equal(identifier.some((item) => item.ruleId === "TRM102" && item.message.includes("SRC")), false);
  assert.ok(absolute.some((item) => item.ruleId === "PRE102"));
});

test("긴 inline code와 URL은 가시문자 길이에서 제외함", () => {
  const diagnostics = analyze([
    "# 길이 기준",
    "",
    "## 1. 검토 범위",
    "",
    "문장 `" + "x".repeat(240) + "` 끝"
  ].join("\n"));
  assert.equal(diagnostics.some((item) => item.ruleId === "REG107"), false);
});

test("glob의 double star는 0개 path segment를 허용함", () => {
  assert.equal(globToRegExp("**/*.md").test("x.md"), true);
  assert.equal(globToRegExp("docs/**/x.md").test("docs/x.md"), true);
  assert.equal(globToRegExp("docs/adr/**").test("docs/adr"), true);
  assert.equal(globToRegExp("docs/adr/**").test("docs/adr/0001.md"), true);
});

test("profile은 제외된 예시 목록을 집계하지 않고 병기 정의를 셈", () => {
  const scan = scanMarkdown([
    "# Profile 기준",
    "",
    "## 1. 검토 범위",
    "",
    "접근 제어 목록(Access Control List, ACL)을 정의한다.",
    "",
    "## 2. 금지할 설명",
    "",
    "- 오늘은 구조를 알아보자."
  ].join("\n"));
  const stats = profileScans([{ scan }], config);
  assert.equal(stats.bilingualDefinitions, 1);
  assert.equal(stats.bulletLength.count, 0);
});

test("gate severity와 maxWarnings 경계를 분리함", () => {
  const diagnostics = [
    { severity: "warning", path: "docs/a.md", line: 1, column: 1, ruleId: "STR003", message: "warning", suggestion: "fix", excerpt: "text" },
    { severity: "info", path: "docs/a.md", line: 2, column: 1, ruleId: "REG108", message: "info", suggestion: "review", excerpt: "text" }
  ];
  assert.equal(buildLintResult("test", ["a"], diagnostics, "error", null).gate.passed, true);
  assert.equal(buildLintResult("test", ["a"], diagnostics, "warning", null).gate.passed, false);
  assert.equal(buildLintResult("test", ["a"], diagnostics, "none", null).gate.passed, true);
  const limited = buildLintResult("test", ["a"], diagnostics, "error", 0);
  assert.equal(limited.gate.passed, false);
  assert.match(formatLintText(limited), /STR003/u);
});

test("CLI는 text와 JSON을 결정적으로 출력하고 gate exit code를 반환함", async (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "report-style-"));
  context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporaryRoot, "docs"));
  fs.writeFileSync(
    path.join(temporaryRoot, "report-style.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      profile: "test-profile",
      roots: ["docs"],
      ignore: ["docs/ignored/**"],
      failOn: "error",
      rules: {
        STR001: "error",
        STR002: "error",
        REG101: "error"
      }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(temporaryRoot, "docs", "sample.md"),
    "# 판정\n\n## 1. 검토 범위\n\n대상 범위를 기록한다.\n",
    "utf8"
  );

  let stdout = "";
  let stderr = "";
  const passingCode = await runCli(["lint", "--format", "json"], {
    cwd: temporaryRoot,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(passingCode, 0);
  assert.equal(stderr, "");
  assert.equal(JSON.parse(stdout).gate.passed, true);

  fs.writeFileSync(
    path.join(temporaryRoot, "docs", "sample.md"),
    "# 판정\n\n## 1. 검토 범위\n\n오늘은 범위를 알아보자.\n",
    "utf8"
  );
  stdout = "";
  const failingCode = await runCli(["lint"], {
    cwd: temporaryRoot,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: () => {} }
  });
  assert.equal(failingCode, 1);
  assert.match(stdout, /REG101/u);
  assert.match(stdout, /대상:/u);
  assert.match(stdout, /수정:/u);
});

test("CLI는 빈 대상과 잘못된 rule option을 configuration 오류로 처리함", async (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "report-style-empty-"));
  context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporaryRoot, "docs"));
  const configPath = path.join(temporaryRoot, "report-style.config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      profile: "test-profile",
      roots: ["docs"],
      rules: { REG107: ["warning", { maxVisibleChars: 180 }] }
    }),
    "utf8"
  );
  let stderr = "";
  const emptyCode = await runCli(["lint"], {
    cwd: temporaryRoot,
    stdout: { write: () => {} },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(emptyCode, 2);
  assert.match(stderr, /Markdown 파일이 없음/u);

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      profile: "test-profile",
      roots: ["docs"],
      rules: { REG107: ["warning", { maxVisibleChars: "long" }] }
    }),
    "utf8"
  );
  stderr = "";
  const invalidCode = await runCli(["lint"], {
    cwd: temporaryRoot,
    stdout: { write: () => {} },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(invalidCode, 2);
  assert.match(stderr, /maxVisibleChars/u);
});
