import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertReleaseSignatureDocument,
  createReleasePayloadFromVersion,
  createReleaseSignaturePayload,
  releaseSignerKeyId,
  signReleasePayload,
  verifyReleaseSignature,
} from "../../tools/release/detached-signature.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixedSignedAt = "2026-07-13T03:00:00.000Z";
const fixedCommit = "1".repeat(40);

function ephemeralKeys() {
  return generateKeyPairSync("ed25519");
}

test("RELEASE-SIGNATURE-001: an ephemeral Ed25519 key signs canonical release bytes", () => {
  const { privateKey, publicKey } = ephemeralKeys();
  const signerKeyId = releaseSignerKeyId(publicKey);
  const payload = createReleaseSignaturePayload({
    artifactLockBytes: Buffer.from("lock bytes", "utf8"),
    gitCommit: fixedCommit,
    manifestBytes: Buffer.from("manifest bytes", "utf8"),
    profileVersion: "1.0.0-rc.1",
    signedAt: fixedSignedAt,
    signerKeyId,
  });
  const first = signReleasePayload({ payload, privateKey });
  const second = signReleasePayload({ payload: { ...payload }, privateKey });
  assert.deepEqual(assertReleaseSignatureDocument(first), first);
  assert.equal(first.signature, second.signature, "Ed25519 signing must be deterministic");
  assert.deepEqual(verifyReleaseSignature({
    document: first,
    expectedPayload: payload,
    publicKey,
  }), {
    payload,
    signerKeyId,
    valid: true,
  });
});

test("RELEASE-SIGNATURE-002: byte, signature and signer substitutions fail closed", () => {
  const signer = ephemeralKeys();
  const attacker = ephemeralKeys();
  const payload = createReleaseSignaturePayload({
    artifactLockBytes: Buffer.from("lock bytes", "utf8"),
    manifestBytes: Buffer.from("manifest bytes", "utf8"),
    profileVersion: "1.0.0-rc.1",
    signedAt: fixedSignedAt,
    signerKeyId: releaseSignerKeyId(signer.publicKey),
  });
  const document = signReleasePayload({ payload, privateKey: signer.privateKey });

  const changedPayload = structuredClone(document);
  changedPayload.payload.manifestSha256 = "0".repeat(64);
  assert.throws(
    () => verifyReleaseSignature({ document: changedPayload, publicKey: signer.publicKey }),
    (error) => error.code === "RELEASE_SIGNATURE_INVALID",
  );

  const changedSignature = structuredClone(document);
  const replacement = document.signature[10] === "A" ? "B" : "A";
  changedSignature.signature = `${document.signature.slice(0, 10)}${replacement}${
    document.signature.slice(11)
  }`;
  assert.throws(
    () => verifyReleaseSignature({ document: changedSignature, publicKey: signer.publicKey }),
    (error) => error.code === "RELEASE_SIGNATURE_INVALID",
  );

  assert.throws(
    () => verifyReleaseSignature({ document, publicKey: attacker.publicKey }),
    (error) => error.code === "RELEASE_SIGNER_KEY_ID_MISMATCH",
  );
  assert.throws(
    () => verifyReleaseSignature({ document, publicKey: signer.privateKey }),
    (error) => error.code === "INVALID_RELEASE_PUBLIC_KEY",
  );

  const expectedPayload = { ...payload, artifactLockSha256: "f".repeat(64) };
  assert.throws(
    () => verifyReleaseSignature({ document, expectedPayload, publicKey: signer.publicKey }),
    (error) => error.code === "RELEASE_SIGNATURE_PAYLOAD_MISMATCH",
  );
});

test("RELEASE-SIGNATURE-003: the machine contract rejects malformed envelopes", () => {
  const { publicKey } = ephemeralKeys();
  const base = {
    schemaVersion: "molit.detached-release-signature/1",
    algorithm: "Ed25519",
    canonicalization: "RFC8785",
    payload: {
      profileVersion: "1.0.0-rc.1",
      artifactLockSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      signedAt: fixedSignedAt,
      signerKeyId: releaseSignerKeyId(publicKey),
    },
    signature: "A".repeat(86),
  };
  assert.doesNotThrow(() => assertReleaseSignatureDocument(base));
  for (const candidate of [
    { ...base, algorithm: "Ed448" },
    { ...base, unexpected: true },
    { ...base, payload: { ...base.payload, signedAt: "2026-02-30T00:00:00Z" } },
    { ...base, signature: "not-base64url" },
  ]) {
    assert.throws(
      () => assertReleaseSignatureDocument(candidate),
      (error) => error.code === "INVALID_RELEASE_SIGNATURE_DOCUMENT",
    );
  }
});

test("RELEASE-SIGNATURE-004: current release payload binds exact manifest and lock bytes", async () => {
  const { publicKey } = ephemeralKeys();
  const payload = await createReleasePayloadFromVersion({
    gitCommit: fixedCommit,
    signedAt: fixedSignedAt,
    signerKeyId: releaseSignerKeyId(publicKey),
    version: "0.1.0",
  });
  assert.equal(payload.profileVersion, "0.1.0");
  assert.match(payload.artifactLockSha256, /^[0-9a-f]{64}$/u);
  assert.match(payload.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.notEqual(payload.artifactLockSha256, payload.manifestSha256);
});

test("RELEASE-SIGNATURE-005: CLI private key input is ephemeral and never written", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-release-signature-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const signaturePath = path.join(directory, "release.signature.json");
  const publicKeyPath = path.join(directory, "release.public.pem");
  const tool = fileURLToPath(new URL(
    "../../tools/release/detached-signature.mjs",
    import.meta.url,
  ));
  const { privateKey, publicKey } = ephemeralKeys();
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  await writeFile(publicKeyPath, publicPem, "utf8");

  const signed = spawnSync(process.execPath, [
    tool,
    "sign",
    "--version",
    "0.1.0",
    "--output",
    signaturePath,
    "--signed-at",
    fixedSignedAt,
    "--git-commit",
    fixedCommit,
  ], {
    cwd: root,
    encoding: "utf8",
    input: privatePem,
    timeout: 30_000,
  });
  assert.equal(signed.status, 0, signed.stderr);
  assert.equal(JSON.parse(signed.stdout).profileVersion, "0.1.0");

  const verified = spawnSync(process.execPath, [
    tool,
    "verify",
    "--signature",
    signaturePath,
    "--public-key",
    publicKeyPath,
    "--git-commit",
    fixedCommit,
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).valid, true);
  assert.deepEqual((await readdir(directory)).sort(), [
    "release.public.pem",
    "release.signature.json",
  ]);
  assert.match(await readFile(signaturePath, "utf8"), /molit[.]detached-release-signature/u);
});
