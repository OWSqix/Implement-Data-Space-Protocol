#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readCheckedFile } from "../registries/safe-local-file.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const decoder = new TextDecoder("utf-8", { fatal: true });
const inputs = Object.freeze({
  authority: "standards/provider-authority-registry.json",
  interoperability: "standards/korean-interoperability-register.json",
  iso19115: "standards/iso19115-1-tech-gate/manifest.json",
});
const reviewedInputSha256 = new Map([
  [inputs.authority, "e91563ef137b756e5f3c14820293eda141d25a78d6e2e951d53514301bc71684"],
  [inputs.interoperability, "44091fdd9cd4c482dc4efc6a2ef07ea7abc05b59bd25c7ea2e389feac70ccb41"],
  [inputs.iso19115, "ea78a62b2084deaa9e7182bb2d625c6f830f46356d46c9fcccd4ab7158e5616d"],
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(relativePath) {
  if (relativePath.includes("\\") || relativePath.split("/").some((part) => (
    part === "" || part === "." || part === ".."
  ))) throw new Error(`invalid release-gate input path: ${relativePath}`);
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const bytes = await readCheckedFile(root, candidate, 8 * 1024 * 1024);
  const sha256 = digest(bytes);
  if (reviewedInputSha256.get(relativePath) !== sha256) {
    throw new Error(`release-gate input differs from its reviewed baseline: ${relativePath}`);
  }
  return {
    document: JSON.parse(decoder.decode(bytes)),
    path: relativePath,
    sha256,
  };
}

function assertRegisterShape(register) {
  const unresolved = new Set(["blocked-external-evidence", "open", "partially-tested"]);
  const resolved = new Set(["fixed", "not-applicable"]);
  if (register?.schemaVersion !== "molit.korean-interoperability-register/1"
    || !Array.isArray(register.blindspots)
    || register.blindspots.length < 8
    || new Set(register.blindspots.map(({ id }) => id)).size !== register.blindspots.length
    || register.blindspots.some((item) => (
      !/^BS-[A-Z0-9-]+$/u.test(item?.id ?? "")
      || (!unresolved.has(item?.status) && !resolved.has(item?.status))
      || typeof item?.currentlyBlocksRelease !== "boolean"
      || typeof item?.releaseGateRequired !== "boolean"
      || item.currentlyBlocksRelease !== (
        item.releaseGateRequired && unresolved.has(item.status)
      )
    ))) throw new Error("invalid Korean interoperability release register");
}

function assertAuthorityShape(registry) {
  if (registry?.schemaVersion !== "molit.provider-authority-registry/1"
    || typeof registry.releaseDecision !== "string"
    || !Array.isArray(registry.entries)) {
    throw new Error("invalid provider authority release register");
  }
}

function assertIsoShape(manifest) {
  if (manifest?.schemaVersion !== "molit.iso19115-1-tech-gate/1"
    || typeof manifest.gateStatus !== "string"
    || manifest.license?.redistributionPermission === undefined) {
    throw new Error("invalid ISO 19115 technical-gate manifest");
  }
}

export async function evaluateReleaseGate() {
  const [interoperability, authority, iso19115] = await Promise.all([
    readJson(inputs.interoperability),
    readJson(inputs.authority),
    readJson(inputs.iso19115),
  ]);
  assertRegisterShape(interoperability.document);
  assertAuthorityShape(authority.document);
  assertIsoShape(iso19115.document);

  const blockers = interoperability.document.blindspots
    .filter((item) => item.currentlyBlocksRelease)
    .map((item) => ({
      id: item.id,
      severity: item.severity,
      source: "korean-interoperability-register",
      status: item.status,
    }));

  if (authority.document.releaseDecision !== "approved"
    || authority.document.entries.length === 0) {
    blockers.push({
      id: "PROVIDER-AUTHORITY-APPROVAL",
      source: "provider-authority-registry",
      status: authority.document.releaseDecision,
    });
  }
  if (iso19115.document.gateStatus !== "ready-for-offline-verification") {
    blockers.push({
      id: "ISO19115-OFFICIAL-BYTES",
      source: "iso19115-1-tech-gate",
      status: iso19115.document.gateStatus,
    });
  }

  blockers.sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
  return {
    blockers,
    decision: blockers.length === 0 ? "eligible" : "blocked",
    inputEvidence: Object.fromEntries([
      interoperability,
      authority,
      iso19115,
    ].map((item) => [item.path, item.sha256])),
    releaseEligible: blockers.length === 0,
    schemaVersion: "molit.release-gate-status/1",
    targetLane: "win32-x64",
  };
}

async function legacyMain() {
  const report = await evaluateReleaseGate();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.releaseEligible ? 0 : 2;
}

function selectedVersion(argv) {
  if (argv.length !== 2 || argv[0] !== "--version" || !argv[1]) {
    const error = new Error(
      "release-gate accepts either no arguments or --version <semantic-version>",
    );
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  return argv[1];
}

async function v2Main(argv) {
  const version = selectedVersion(argv);
  if (version === "0.1.0") {
    await legacyMain();
    return;
  }
  const {
    evaluateReleaseGateV2,
    invalidV2Report,
    releaseGateV2ExitCode,
  } = await import("./release-gate-v2.mjs");
  try {
    const report = await evaluateReleaseGateV2(version);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = releaseGateV2ExitCode(report);
  } catch (error) {
    const report = invalidV2Report(version, error);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    try {
      await legacyMain();
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        blockers: [{
          id: "RELEASE-GATE-INPUT",
          source: "release-gate",
          status: "invalid-or-unreadable",
        }],
        decision: "indeterminate",
        reason: error.message,
        releaseEligible: false,
        schemaVersion: "molit.release-gate-status/1",
        targetLane: "win32-x64",
      }, null, 2)}\n`);
      process.exitCode = 2;
    }
  } else {
    try {
      await v2Main(argv);
    } catch (error) {
      const version = argv[0] === "--version" ? argv[1] : null;
      const { invalidV2Report } = await import("./release-gate-v2.mjs");
      process.stdout.write(`${JSON.stringify(invalidV2Report(version, error), null, 2)}\n`);
      process.exitCode = 1;
    }
  }
}
