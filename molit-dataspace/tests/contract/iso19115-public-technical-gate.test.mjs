import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertManifest,
  decodeSecureXml,
  evaluateSchematron,
  loadManifest,
  runOfficialSmoke,
  validateStandaloneXsd,
} from "../../tools/iso19115-tech/lib.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const manifestPath = path.join(root, "standards/iso19115-1-tech-gate/manifest.json");
const cacheRoot = path.join(root, ".local/iso19115-1-tech-gate");
const fixtureRoot = path.join(root, "tests/fixtures/iso19115-tech-harness");
const manifest = await loadManifest(manifestPath);
const [harnessXsd, harnessSchematron, harnessXml] = await Promise.all([
  readFile(path.join(fixtureRoot, "schema.xsd")),
  readFile(path.join(fixtureRoot, "rules.sch")),
  readFile(path.join(fixtureRoot, "valid.xml")),
]);

test("ISO19115-TECH-001: official artifacts are digest-pinned without redistributing their bytes", async () => {
  assertManifest(manifest);
  assert.equal(manifest.artifacts.length, 125);
  assert.equal(manifest.artifacts.filter((item) => item.role === "xsd-entrypoint").length, 1);
  assert.equal(manifest.artifacts.filter((item) => item.role === "xsd-module").length, 17);
  assert.equal(manifest.artifacts.filter((item) => item.role === "schematron").length, 1);
  assert.equal(manifest.artifacts.filter((item) => item.role === "valid-example").length, 1);
  const committed = await readdir(path.dirname(manifestPath));
  assert.deepEqual(committed.sort(), ["README.md", "manifest.json"]);
  assert.equal(manifest.license.repositoryLicenseDetected, null);
  assert.equal(manifest.license.redistributionPermission, "not-established");
  assert.equal(manifest.license.committedOfficialBytes, false);
});

test("ISO19115-TECH-002: the offline XSD and Schematron harness accepts and rejects the right cases", async () => {
  const positiveXsd = await validateStandaloneXsd({
    xsdBytes: harnessXsd,
    xmlBytes: harnessXml,
  });
  assert.equal(positiveXsd.valid, true, positiveXsd.rawOutput);
  const positiveSchematron = evaluateSchematron({
    schematronBytes: harnessSchematron,
    xmlBytes: harnessXml,
  });
  assert.equal(positiveSchematron.valid, true);

  const validText = harnessXml.toString("utf8");
  const xsdNegative = Buffer.from(validText
    .replace("<created>", "<createdUnexpected>")
    .replace("</created>", "</createdUnexpected>"));
  const negativeXsd = await validateStandaloneXsd({
    xsdBytes: harnessXsd,
    xmlBytes: xsdNegative,
    xmlFileName: "xsd-negative.xml",
  });
  assert.equal(negativeXsd.valid, false);

  const schematronNegative = Buffer.from(validText.replace("<status>current</status>", "<status>pending</status>"));
  const schematronNegativeXsd = await validateStandaloneXsd({
    xsdBytes: harnessXsd,
    xmlBytes: schematronNegative,
    xmlFileName: "schematron-negative.xml",
  });
  assert.equal(schematronNegativeXsd.valid, true, schematronNegativeXsd.rawOutput);
  const negativeSchematron = evaluateSchematron({
    schematronBytes: harnessSchematron,
    xmlBytes: schematronNegative,
  });
  assert.equal(negativeSchematron.valid, false);
  assert.equal(negativeSchematron.failures.length, 1);
});

test("ISO19115-TECH-003: XML expansion, remote XPath and cache-path mutations fail closed", () => {
  for (const payload of [
    '<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>',
    '<!ENTITY e SYSTEM "https://example.invalid/entity"><x/>',
    '<x xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="https://example.invalid/x"/></x>',
  ]) {
    assert.throws(() => decodeSecureXml(Buffer.from(payload)), /rejected/u);
  }
  const remoteSchematron = Buffer.from(`
    <sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron">
      <sch:ns prefix="t" uri="urn:molit:iso19115-tech-harness"/>
      <sch:pattern><sch:rule context="t:record">
        <sch:assert test="doc('https://example.invalid/external.xml')">blocked</sch:assert>
      </sch:rule></sch:pattern>
    </sch:schema>
  `);
  assert.throws(() => evaluateSchematron({
    schematronBytes: remoteSchematron,
    xmlBytes: harnessXml,
  }), /external-access XPath/u);

  for (const cachePath of ["../outside.xsd", "artifacts/../../outside.xsd", "C:/outside.xsd", "file:///tmp/xsd"]) {
    const candidate = structuredClone(manifest);
    candidate.artifacts[0].cachePath = cachePath;
    assert.throws(() => assertManifest(candidate));
  }
});

test("ISO19115-TECH-004: approved private cache runs official smoke; absent cache leaves the Gate blocked", async () => {
  let cachePresent = true;
  try {
    await access(path.join(cacheRoot, "artifacts"));
  } catch {
    cachePresent = false;
  }
  if (!cachePresent) {
    assert.equal(manifest.gateStatus, "blocked-pending-permission-or-approved-private-cache");
    assert.equal(manifest.license.committedOfficialBytes, false);
    return;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network forbidden during offline official smoke");
  };
  try {
    assert.deepEqual(await runOfficialSmoke(manifest, cacheRoot), {
      artifactCount: 125,
      xsdPositive: true,
      xsdNegativeRejected: true,
      schematronPositive: true,
      schematronNegativeRejected: true,
      schematronAssertions: 5,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
