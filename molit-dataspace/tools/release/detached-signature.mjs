#!/usr/bin/env node
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalize from "canonicalize";
import { assertLocalFilesystemPath } from "../../src/profile/local-path.mjs";
import {
  loadProfileRelease,
  profileVersionEnvironmentVariable,
  verifyArtifactLock,
} from "../../src/profile/registry.mjs";

const schemaBytes = await readFile(
  new URL("../../contracts/detached-release-signature.v1.schema.json", import.meta.url),
);
const schema = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateDocument = ajv.compile(schema);
const validatePayload = ajv.compile(schema.properties.payload);

function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validationErrors(validator) {
  return validator.errors?.map(({ instancePath, keyword, message, schemaPath }) => ({
    instancePath,
    keyword,
    message,
    schemaPath,
  })) ?? [];
}

export function assertReleaseSignatureDocument(document) {
  if (validateDocument(document)) {
    const signatureBytes = Buffer.from(document.signature, "base64url");
    if (signatureBytes.length === 64
      && signatureBytes.toString("base64url") === document.signature) {
      return document;
    }
  }
  throw failure(
    "INVALID_RELEASE_SIGNATURE_DOCUMENT",
    "detached release signature violates its machine contract",
    { errors: validationErrors(validateDocument) },
  );
}

function assertReleaseSignaturePayload(payload) {
  if (validatePayload(payload)) return payload;
  throw failure(
    "INVALID_RELEASE_SIGNATURE_PAYLOAD",
    "release signature payload violates its machine contract",
    { errors: validationErrors(validatePayload) },
  );
}

function privateKeyObject(value) {
  let key;
  try {
    key = value?.type === "private" ? value : createPrivateKey(value);
  } catch (cause) {
    throw failure(
      "INVALID_RELEASE_PRIVATE_KEY",
      "release signing key is not a supported private key",
      { causeCode: cause?.code ?? null },
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw failure("INVALID_RELEASE_PRIVATE_KEY", "release signing key must be Ed25519");
  }
  return key;
}

function publicKeyObject(value) {
  if (value?.type === "private") {
    throw failure(
      "INVALID_RELEASE_PUBLIC_KEY",
      "release verification input must not contain a private key",
    );
  }
  if (value?.type !== "public") {
    try {
      createPrivateKey(value);
      throw failure(
        "INVALID_RELEASE_PUBLIC_KEY",
        "release verification input must not contain a private key",
      );
    } catch (error) {
      if (error?.code === "INVALID_RELEASE_PUBLIC_KEY") throw error;
    }
  }
  let key;
  try {
    key = value?.type === "public" ? value : createPublicKey(value);
  } catch (cause) {
    throw failure(
      "INVALID_RELEASE_PUBLIC_KEY",
      "release verification key is not a supported public key",
      { causeCode: cause?.code ?? null },
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw failure("INVALID_RELEASE_PUBLIC_KEY", "release verification key must be Ed25519");
  }
  return key;
}

export function releaseSignerKeyId(key) {
  const publicKey = key?.type === "private"
    ? createPublicKey(privateKeyObject(key))
    : publicKeyObject(key);
  const spki = publicKey.export({ format: "der", type: "spki" });
  const fingerprint = createHash("sha256").update(spki).digest("base64url");
  return `urn:molit:key:ed25519:sha256:${fingerprint}`;
}

function canonicalPayloadBytes(payload) {
  const serialized = canonicalize(payload);
  if (typeof serialized !== "string") {
    throw failure(
      "INVALID_RELEASE_SIGNATURE_PAYLOAD",
      "RFC 8785 canonicalization did not produce a JSON string",
    );
  }
  return Buffer.from(serialized, "utf8");
}

export function createReleaseSignaturePayload({
  artifactLockBytes,
  gitCommit,
  manifestBytes,
  profileVersion,
  signedAt = new Date().toISOString(),
  signerKeyId,
}) {
  if (!ArrayBuffer.isView(artifactLockBytes) || !ArrayBuffer.isView(manifestBytes)) {
    throw failure(
      "INVALID_RELEASE_SIGNATURE_PAYLOAD",
      "artifact lock and manifest inputs must be byte arrays",
    );
  }
  const payload = {
    profileVersion,
    artifactLockSha256: createHash("sha256").update(artifactLockBytes).digest("hex"),
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    ...(gitCommit === undefined ? {} : { gitCommit }),
    signedAt,
    signerKeyId,
  };
  return assertReleaseSignaturePayload(payload);
}

export function signReleasePayload({ payload, privateKey }) {
  const key = privateKeyObject(privateKey);
  const signerKeyId = releaseSignerKeyId(key);
  if (payload?.signerKeyId !== signerKeyId) {
    throw failure(
      "RELEASE_SIGNER_KEY_ID_MISMATCH",
      "payload signerKeyId does not identify the Ed25519 signing key",
      { actual: payload?.signerKeyId ?? null, expected: signerKeyId },
    );
  }
  assertReleaseSignaturePayload(payload);
  const signature = sign(null, canonicalPayloadBytes(payload), key).toString("base64url");
  return assertReleaseSignatureDocument({
    schemaVersion: "molit.detached-release-signature/1",
    algorithm: "Ed25519",
    canonicalization: "RFC8785",
    payload,
    signature,
  });
}

export function verifyReleaseSignature({
  document,
  expectedPayload,
  publicKey,
}) {
  assertReleaseSignatureDocument(document);
  const key = publicKeyObject(publicKey);
  const signerKeyId = releaseSignerKeyId(key);
  if (document.payload.signerKeyId !== signerKeyId) {
    throw failure(
      "RELEASE_SIGNER_KEY_ID_MISMATCH",
      "signature signerKeyId does not identify the supplied Ed25519 public key",
      { actual: document.payload.signerKeyId, expected: signerKeyId },
    );
  }
  const valid = verify(
    null,
    canonicalPayloadBytes(document.payload),
    key,
    Buffer.from(document.signature, "base64url"),
  );
  if (!valid) {
    throw failure("RELEASE_SIGNATURE_INVALID", "detached Ed25519 signature is invalid");
  }
  if (expectedPayload !== undefined
    && canonicalize(document.payload) !== canonicalize(assertReleaseSignaturePayload(
      expectedPayload,
    ))) {
    throw failure(
      "RELEASE_SIGNATURE_PAYLOAD_MISMATCH",
      "signed payload does not identify the expected release bytes",
    );
  }
  return {
    payload: document.payload,
    signerKeyId,
    valid: true,
  };
}

export async function createReleasePayloadFromVersion({
  gitCommit,
  signedAt,
  signerKeyId,
  version,
}) {
  const release = await loadProfileRelease(version);
  const snapshot = await verifyArtifactLock(release);
  return createReleaseSignaturePayload({
    artifactLockBytes: snapshot.lockBytes,
    gitCommit,
    manifestBytes: snapshot.artifactBytes.get("manifest.json"),
    profileVersion: release.version,
    signedAt,
    signerKeyId,
  });
}

function usage() {
  return [
    "Usage:",
    "  node tools/release/detached-signature.mjs sign --output FILE [--version VERSION] [--signed-at RFC3339] [--git-commit SHA] < private-key.pem",
    "  node tools/release/detached-signature.mjs verify --signature FILE --public-key FILE [--version VERSION] [--git-commit SHA]",
    "",
    "The sign command reads the Ed25519 private key only from standard input.",
    `If --version is omitted, ${profileVersionEnvironmentVariable} selects the release.`,
  ].join("\n");
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!["sign", "verify"].includes(command)) {
    throw failure("INVALID_ARGUMENTS", usage());
  }
  const allowed = command === "sign"
    ? new Set(["git-commit", "output", "signed-at", "version"])
    : new Set(["git-commit", "public-key", "signature", "version"]);
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    const name = flag?.startsWith("--") ? flag.slice(2) : null;
    if (!name
      || !allowed.has(name)
      || value === undefined
      || value.startsWith("--")
      || Object.hasOwn(options, name)) {
      throw failure("INVALID_ARGUMENTS", `invalid or duplicate option: ${flag}\n${usage()}`);
    }
    options[name] = value;
  }
  if (command === "sign" && !options.output) {
    throw failure("INVALID_ARGUMENTS", `sign requires --output\n${usage()}`);
  }
  if (command === "verify" && (!options.signature || !options["public-key"])) {
    throw failure(
      "INVALID_ARGUMENTS",
      `verify requires --signature and --public-key\n${usage()}`,
    );
  }
  return { command, options };
}

async function readStandardInput(maxBytes = 65_536) {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > maxBytes) {
      throw failure("INVALID_RELEASE_PRIVATE_KEY", "private key input exceeds 64 KiB");
    }
    chunks.push(chunk);
  }
  if (length === 0) {
    throw failure("INVALID_RELEASE_PRIVATE_KEY", "Ed25519 private key is required on stdin");
  }
  const bytes = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  return bytes;
}

async function readJson(filePath) {
  const bytes = await readFile(filePath);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw failure(
      "INVALID_RELEASE_SIGNATURE_DOCUMENT",
      "signature document is not valid UTF-8",
      { causeCode: cause?.code ?? null },
    );
  }
  try {
    return JSON.parse(source);
  } catch {
    throw failure(
      "INVALID_RELEASE_SIGNATURE_DOCUMENT",
      "signature document is not valid JSON",
    );
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "sign") {
    assertLocalFilesystemPath(options.output, "signature output path");
    const release = await loadProfileRelease(options.version);
    const outputPath = path.resolve(options.output);
    if (pathIsWithin(release.releaseRoot, outputPath)) {
      throw failure(
        "RELEASE_SIGNATURE_PATH_INSIDE_RELEASE",
        "detached signature output must be outside the signed release directory",
        { output: outputPath, releaseRoot: release.releaseRoot },
      );
    }
    const privateKeyBytes = await readStandardInput();
    try {
      const privateKey = privateKeyObject(privateKeyBytes);
      const payload = await createReleasePayloadFromVersion({
        gitCommit: options["git-commit"],
        signedAt: options["signed-at"],
        signerKeyId: releaseSignerKeyId(privateKey),
        version: release.version,
      });
      const document = signReleasePayload({ payload, privateKey });
      await mkdir(path.dirname(outputPath), { recursive: true });
      const [physicalOutputParent, physicalReleaseRoot] = await Promise.all([
        realpath(path.dirname(outputPath)),
        realpath(release.releaseRoot),
      ]);
      const physicalOutputPath = path.join(physicalOutputParent, path.basename(outputPath));
      if (pathIsWithin(physicalReleaseRoot, physicalOutputPath)) {
        throw failure(
          "RELEASE_SIGNATURE_PATH_INSIDE_RELEASE",
          "detached signature output resolves inside the signed release directory",
        );
      }
      await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      });
      process.stdout.write(`${JSON.stringify({
        output: outputPath,
        profileVersion: payload.profileVersion,
        signerKeyId: payload.signerKeyId,
      }, null, 2)}\n`);
    } finally {
      privateKeyBytes.fill(0);
    }
    return;
  }

  assertLocalFilesystemPath(options.signature, "signature document path");
  assertLocalFilesystemPath(options["public-key"], "public key path");
  const document = assertReleaseSignatureDocument(await readJson(options.signature));
  const publicKey = await readFile(options["public-key"]);
  const expectedPayload = await createReleasePayloadFromVersion({
    gitCommit: options["git-commit"] ?? document.payload.gitCommit,
    signedAt: document.payload.signedAt,
    signerKeyId: releaseSignerKeyId(publicKey),
    version: options.version ?? document.payload.profileVersion,
  });
  const result = verifyReleaseSignature({ document, expectedPayload, publicKey });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      code: error.code ?? "DETACHED_RELEASE_SIGNATURE_FAILED",
      details: error.details ?? {},
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
