import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateProfileDocument } from "../../src/profile/validator.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const example = path.join(
  root,
  "profiles/molit-dcat-ap/releases/1.0.0-rc.1/examples/valid/network-catalog.ttl",
);

test("NETWORK-RUNTIME-001: CLI validation rejects one RDF edition key with two checksums", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-network-runtime-"));
  try {
    const source = await readFile(example, "utf8");
    const input = path.join(directory, "conflicting-network.ttl");
    await writeFile(input, `${source}

ex:conflicting-standard-node-link
    a molit:NetworkReference ;
    molit:networkAuthority ex:molit ;
    molit:networkIdentifier "MOLIT-STANDARD-NODE-LINK" ;
    molit:networkVersion "2026-07-01" ;
    molit:networkSnapshotChecksum "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"^^xsd:hexBinary ;
    molit:networkLifecycleStatus netlife:current ;
    molit:networkValidFrom "2026-07-01"^^xsd:date ;
    molit:networkElementType net:node, net:link .
`, "utf8");
    const report = await validateProfileDocument({
      inputPath: input,
      profileName: "network",
      version: "1.0.0-rc.1",
    });
    assert.equal(report.summary.shaclConforms, true);
    assert.equal(report.summary.gatePassed, false);
    assert.ok(report.results.some(({ requirementId, sourceConstraintComponent }) => (
      requirementId === "MOLIT-NET-IDENTITY-001"
        && sourceConstraintComponent
          === "urn:kr:molit:profile:NetworkReferenceSetIntegrityConstraint"
    )));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
