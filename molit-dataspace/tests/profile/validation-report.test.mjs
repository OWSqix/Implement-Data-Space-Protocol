import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadProfileRelease,
  resolveReleaseArtifact,
} from "../../src/profile/registry.mjs";
import { validateProfileDocument } from "../../src/profile/validator.mjs";

// FR-SEM-007은 전체 metadata Gate가 fatal UTF-8 parse → 공개 graph preflight →
// Core·Geo routing → SHACL을 순서대로 실행하고 profile bundle·validator
// source·report schema digest를 보고할 것을 요구한다. 검증 계획이 약속한
// 시험 ID는 CT-SEM-REPORT-001이었으나 지금까지 존재하지 않았다. 기존
// 시험은 validator build·report schema digest만 단언했고 profile
// bundleDigest는 어디에서도 단언되지 않았다.

const release = await loadProfileRelease("0.1.0");
const exampleRoot = resolveReleaseArtifact(release, "examples");
const geoExample = path.join(exampleRoot, "valid", "road-network-catalog.ttl");

test("CT-SEM-REPORT-001: a passing validation reports all three provenance digests", async () => {
  const report = await validateProfileDocument({
    inputPath: geoExample,
    profileName: "geo",
  });
  assert.equal(report.summary.gatePassed, true);
  // 요구된 세 digest — profile bundle, validator source, report schema.
  assert.match(report.profile.bundleDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(report.engine.molitValidatorBuildDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(report.engine.reportSchemaDigest, /^sha256:[0-9a-f]{64}$/u);
  // 세 digest는 서로 다른 산출물의 지문이다 — 같은 값이면 보고가 무의미하다.
  assert.equal(new Set([
    report.profile.bundleDigest,
    report.engine.molitValidatorBuildDigest,
    report.engine.reportSchemaDigest,
  ]).size, 3);
  // 결정 digest는 보고 내용에 결속된다.
  assert.match(report.decisionDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("CT-SEM-REPORT-001: invalid UTF-8 is fatal before any later stage produces a report", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-report-utf8-"));
  try {
    const inputPath = path.join(directory, "broken.ttl");
    await writeFile(inputPath, Buffer.from([0x40, 0xff, 0xfe, 0x0a]));
    await assert.rejects(
      () => validateProfileDocument({ inputPath, profileName: "geo" }),
      (error) => error.code === "INVALID_UTF8",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// FR-SEM-002의 빠진 축 — 게시 Catalogue·CatalogueRecord의 dct:conformsTo는
// canonical version IRI와 정확히 일치해야 하며, 위조된 판 IRI는 거부돼야
// 한다. 기존 시험은 중복·혼합 marker와 잘못된 profile 선택만 다뤘다.
test("CT-PROFILE-ROUTING-003: a fabricated conformsTo version IRI fails the gate", async () => {
  const canonical = "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/geo";
  const fabricated = "https://data.molit.go.kr/profile/molit-dcat-ap/9.9.9/geo";
  const source = await (await import("node:fs/promises")).readFile(geoExample, "utf8");
  assert.ok(source.includes(canonical), "fixture must declare the canonical IRI");
  const directory = await mkdtemp(path.join(tmpdir(), "molit-conformsto-"));
  try {
    const inputPath = path.join(directory, "forged.ttl");
    await writeFile(inputPath, source.replaceAll(canonical, fabricated), "utf8");
    const report = await validateProfileDocument({ inputPath, profileName: "geo" });
    assert.equal(report.summary.gatePassed, false, "a forged profile version IRI must not pass");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CT-SEM-REPORT-001: routing runs inside the same gate and its violation shares the digest-bearing report", async () => {
  // Geo graph를 core로 라우팅하면 SHACL 단계 이전의 routing 판정이 위반을
  // 만들고, 그 위반은 세 digest를 담은 같은 보고서에 실린다 — 순서와
  // 보고가 한 Gate 안에 있음을 고정한다.
  const report = await validateProfileDocument({
    inputPath: geoExample,
    profileName: "core",
  });
  assert.equal(report.summary.gatePassed, false);
  assert.ok(report.results.some((result) => result.requirementId === "MOLIT-PROFILE-SELECTION-001"));
  assert.match(report.profile.bundleDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(report.engine.molitValidatorBuildDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(report.engine.reportSchemaDigest, /^sha256:[0-9a-f]{64}$/u);
});
