// Test-only TLS material for the identity and observability mTLS suites.
//
// SECURITY CONTRACT
// ----------------
// Nothing in this directory is committed to the repository. Every certificate
// and every private key below is created from scratch inside the running test
// process (or written to disk only by the CLI entry point at the bottom of this
// file, which exists so the Docker compose bind mount used by the PostgreSQL
// TLS integration run has something to mount). The keys exist only for the
// duration of a test run: they are never installed into any operating-system or
// language trust store, never submitted to an operational or pilot CA, never
// pinned by any deployment manifest, and never used against anything other than
// loopback test listeners. Treat any copy of this material found outside a
// scratch test directory as garbage to be deleted, not as a credential.
//
// WHY GENERATION INSTEAD OF CHECKED-IN FIXTURES
// --------------------------------------------
// Checked-in PEM private keys made the "tracked project files contain no
// serialized private signing key" supply-chain contract false. Generating at
// test time keeps that contract true without weakening any assertion: the same
// trust relationships are reproduced exactly (see PROFILE below).
//
// CERTIFICATE PROFILE (identical in shape to the fixtures it replaces)
// -------------------------------------------------------------------
//   root         C=KR, O=MOLIT Test, CN=MOLIT Test Root CA
//                self-signed, basicConstraints critical CA:TRUE
//                -> signs server-one, server-two, client
//   server-one   C=KR, O=MOLIT Test, CN=localhost
//                SAN DNS:localhost + IP:127.0.0.1, EKU serverAuth,
//                KU digitalSignature+keyEncipherment, issued by root
//   server-two   same as server-one; a distinct key pair so rotation tests can
//                observe the presented leaf certificate actually change
//   client       C=KR, O=MOLIT Test, CN=trusted-service
//                EKU clientAuth, KU digitalSignature, issued by root
//   untrusted    C=KR, O=MOLIT Test, CN=untrusted-service
//                self-signed, basicConstraints critical CA:TRUE,
//                EKU clientAuth, issued by NOBODY the tests trust.
//                This is the negative-path anchor: presenting it as a client
//                certificate must be rejected, and installing it as the client
//                trust anchor must make the trusted client fail.
//
// VALIDITY AND THE VALIDATION CLOCK
// ---------------------------------
// notBefore is backdated one hour from generation and notAfter is ten years
// out, so material generated "now" is already inside its validity window even
// with modest host clock skew. Tests that need a fixed clock must use
// `validationClock`, which is derived from the notBefore actually encoded in
// the generated certificates (not a hard-coded literal), so it can never drift
// outside the validity window as calendar time passes.

import { X509Certificate, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ONE_HOUR_MS = 60 * 60 * 1_000;
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, value) {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

const der = {
  sequence: (...parts) => tlv(0x30, Buffer.concat(parts)),
  set: (...parts) => tlv(0x31, Buffer.concat(parts)),
  boolean: (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00])),
  integer: (value) => tlv(0x02, value),
  bitString: (value, unusedBits = 0) => tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), value])),
  octetString: (value) => tlv(0x04, value),
  printableString: (value) => tlv(0x13, Buffer.from(value, "ascii")),
  contextPrimitive: (number, value) => tlv(0x80 | number, value),
  contextConstructed: (number, ...parts) => tlv(0xa0 | number, Buffer.concat(parts)),
  objectIdentifier(dotted) {
    const arcs = dotted.split(".").map(Number);
    const bytes = [40 * arcs[0] + arcs[1]];
    for (const arc of arcs.slice(2)) {
      const stack = [arc & 0x7f];
      for (let value = Math.floor(arc / 128); value > 0; value = Math.floor(value / 128)) stack.unshift((value & 0x7f) | 0x80);
      bytes.push(...stack);
    }
    return tlv(0x06, Buffer.from(bytes));
  },
};

// UTCTime is only unambiguous below 2050; fall back to GeneralizedTime after that.
function encodeTime(date) {
  const iso = date.toISOString();
  const tail = `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(`${iso.slice(2, 4)}${tail}`, "ascii"))
    : tlv(0x18, Buffer.from(`${iso.slice(0, 4)}${tail}`, "ascii"));
}

function serialNumber() {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  if (bytes[0] === 0) bytes[0] = 1;
  return der.integer(bytes);
}

function distinguishedName(commonName) {
  return der.sequence(
    der.set(der.sequence(der.objectIdentifier("2.5.4.6"), der.printableString("KR"))),
    der.set(der.sequence(der.objectIdentifier("2.5.4.10"), der.printableString("MOLIT Test"))),
    der.set(der.sequence(der.objectIdentifier("2.5.4.3"), der.printableString(commonName))),
  );
}

function extension(oid, critical, value) {
  return der.sequence(der.objectIdentifier(oid), ...(critical ? [der.boolean(true)] : []), der.octetString(value));
}

const KEY_USAGE_BITS = ["digitalSignature", "nonRepudiation", "keyEncipherment", "dataEncipherment", "keyAgreement", "keyCertSign", "cRLSign"];

function keyUsageExtension(...names) {
  let byte = 0;
  let highest = -1;
  for (const name of names) {
    const index = KEY_USAGE_BITS.indexOf(name);
    if (index < 0) throw new Error(`unknown key usage ${name}`);
    byte |= 0x80 >> index;
    highest = Math.max(highest, index);
  }
  return extension("2.5.29.15", false, der.bitString(Buffer.from([byte]), 7 - highest));
}

const EXTENDED_KEY_USAGE_OIDS = { serverAuth: "1.3.6.1.5.5.7.3.1", clientAuth: "1.3.6.1.5.5.7.3.2" };

function extendedKeyUsageExtension(...names) {
  return extension("2.5.29.37", false, der.sequence(...names.map((name) => der.objectIdentifier(EXTENDED_KEY_USAGE_OIDS[name]))));
}

function localhostSubjectAltNameExtension() {
  return extension("2.5.29.17", false, der.sequence(
    der.contextPrimitive(2, Buffer.from("localhost", "ascii")),
    der.contextPrimitive(7, Buffer.from([127, 0, 0, 1])),
  ));
}

function certificateAuthorityExtension() {
  return extension("2.5.29.19", true, der.sequence(der.boolean(true)));
}

function toPem(label, body) {
  const base64 = body.toString("base64").replace(/(.{64})/gu, "$1\n").replace(/\n$/u, "");
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

function newKeyPair() {
  // P-256 keeps generation to well under a millisecond per key, so a suite-level
  // prepare step costs no measurable time and never needs the network.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, publicKey, pem: privateKey.export({ format: "pem", type: "pkcs8" }) };
}

const ECDSA_WITH_SHA256 = der.sequence(der.objectIdentifier("1.2.840.10045.4.3.2"));

function issueCertificate({ subject, issuer, subjectKey, issuerPrivateKey, notBefore, notAfter, extensions }) {
  const tbsCertificate = der.sequence(
    der.contextConstructed(0, der.integer(Buffer.from([2]))),
    serialNumber(),
    ECDSA_WITH_SHA256,
    distinguishedName(issuer),
    der.sequence(encodeTime(notBefore), encodeTime(notAfter)),
    distinguishedName(subject),
    subjectKey.publicKey.export({ format: "der", type: "spki" }),
    der.contextConstructed(3, der.sequence(...extensions)),
  );
  const signature = sign("sha256", tbsCertificate, issuerPrivateKey);
  return toPem("CERTIFICATE", der.sequence(tbsCertificate, ECDSA_WITH_SHA256, der.bitString(signature)));
}

/**
 * Build a complete, self-consistent set of test TLS material.
 * Synchronous, deterministic in structure, offline, and fast.
 */
export function generateIdentityTlsMaterial({ now = new Date(), backdateMs = ONE_HOUR_MS, lifetimeMs = TEN_YEARS_MS } = {}) {
  const notBefore = new Date(Math.floor((now.getTime() - backdateMs) / 1_000) * 1_000);
  const notAfter = new Date(notBefore.getTime() + lifetimeMs);

  const rootKey = newKeyPair();
  const serverOneKey = newKeyPair();
  const serverTwoKey = newKeyPair();
  const clientKey = newKeyPair();
  const untrustedKey = newKeyPair();

  const root = issueCertificate({
    subject: "MOLIT Test Root CA", issuer: "MOLIT Test Root CA", subjectKey: rootKey,
    issuerPrivateKey: rootKey.privateKey, notBefore, notAfter,
    extensions: [certificateAuthorityExtension()],
  });
  const serverExtensions = () => [localhostSubjectAltNameExtension(), extendedKeyUsageExtension("serverAuth"), keyUsageExtension("digitalSignature", "keyEncipherment")];
  const serverOne = issueCertificate({
    subject: "localhost", issuer: "MOLIT Test Root CA", subjectKey: serverOneKey,
    issuerPrivateKey: rootKey.privateKey, notBefore, notAfter, extensions: serverExtensions(),
  });
  const serverTwo = issueCertificate({
    subject: "localhost", issuer: "MOLIT Test Root CA", subjectKey: serverTwoKey,
    issuerPrivateKey: rootKey.privateKey, notBefore, notAfter, extensions: serverExtensions(),
  });
  const client = issueCertificate({
    subject: "trusted-service", issuer: "MOLIT Test Root CA", subjectKey: clientKey,
    issuerPrivateKey: rootKey.privateKey, notBefore, notAfter,
    extensions: [extendedKeyUsageExtension("clientAuth"), keyUsageExtension("digitalSignature")],
  });
  // Signed by its own key, so it chains to nothing the tests trust.
  const untrusted = issueCertificate({
    subject: "untrusted-service", issuer: "untrusted-service", subjectKey: untrustedKey,
    issuerPrivateKey: untrustedKey.privateKey, notBefore, notAfter,
    extensions: [certificateAuthorityExtension(), extendedKeyUsageExtension("clientAuth")],
  });

  const certificates = [root, serverOne, serverTwo, client, untrusted].map((pem) => new X509Certificate(pem));
  // Derived from the material that was actually produced, never from a literal.
  const latestValidFrom = Math.max(...certificates.map((certificate) => certificate.validFromDate.getTime()));
  const earliestValidTo = Math.min(...certificates.map((certificate) => certificate.validToDate.getTime()));
  const validationClock = new Date(latestValidFrom + 60_000);
  if (!(validationClock.getTime() > latestValidFrom - 1 && validationClock.getTime() < earliestValidTo)) {
    throw new Error("derived identity TLS validation clock falls outside the generated validity window");
  }

  return Object.freeze({
    root, rootKey: rootKey.pem,
    serverOne, serverOneKey: serverOneKey.pem,
    serverTwo, serverTwoKey: serverTwoKey.pem,
    client, clientKey: clientKey.pem,
    untrusted, untrustedKey: untrustedKey.pem,
    notBefore, notAfter, validationClock,
  });
}

let cached = null;

/**
 * Suite-level accessor. One generation per test process, reused by every test in
 * that process, so adding this step costs a single-digit millisecond.
 */
export function identityTlsFixtures() {
  cached ??= generateIdentityTlsMaterial();
  return cached;
}

/** File layout expected by the PostgreSQL compose bind mount. */
export function identityTlsFixtureFileMap(material = identityTlsFixtures()) {
  return {
    "root.crt": material.root,
    "server-one.crt": material.serverOne,
    "server-one.key": material.serverOneKey,
    "server-two.crt": material.serverTwo,
    "server-two.key": material.serverTwoKey,
    "client.crt": material.client,
    "client.key": material.clientKey,
    "untrusted.crt": material.untrusted,
    "untrusted.key": material.untrustedKey,
  };
}

export const IDENTITY_TLS_FIXTURE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/**
 * Materialize the fixture files on disk. Only the CLI below and container-based
 * runs need this; in-process tests use the in-memory material and never write
 * into this directory, which keeps parallel `node --test` processes from racing.
 */
export async function writeIdentityTlsFixtureFiles(directory = IDENTITY_TLS_FIXTURE_DIRECTORY, material = identityTlsFixtures()) {
  await mkdir(directory, { recursive: true });
  const written = [];
  for (const [name, contents] of Object.entries(identityTlsFixtureFileMap(material))) {
    const target = join(directory, name);
    await writeFile(target, contents, { mode: name.endsWith(".key") ? 0o600 : 0o644 });
    written.push(target);
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const written = await writeIdentityTlsFixtureFiles(process.argv[2] ?? IDENTITY_TLS_FIXTURE_DIRECTORY);
  process.stdout.write(`${written.join("\n")}\n`);
}
