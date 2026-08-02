import { createHash, timingSafeEqual } from "node:crypto";
import { assertIdentity } from "./errors.mjs";

export function certificateThumbprint(raw) {
  assertIdentity(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 65_536, "IDENTITY_CLIENT_CERTIFICATE_REQUIRED", "a bounded DER client certificate is required");
  return createHash("sha256").update(raw).digest("base64url");
}

export function peerCertificate(request) {
  const socket = request?.socket;
  assertIdentity(socket && typeof socket.getPeerCertificate === "function" && socket.authorized === true, "IDENTITY_CLIENT_CERTIFICATE_REQUIRED", "an authorized mutual-TLS client certificate is required");
  const certificate = socket.getPeerCertificate(true);
  assertIdentity(Buffer.isBuffer(certificate?.raw), "IDENTITY_CLIENT_CERTIFICATE_REQUIRED", "the mutual-TLS client certificate is unavailable");
  return certificate.raw;
}

export function verifyCertificateBinding(claims, request, { required = false } = {}) {
  const expected = claims?.cnf?.["x5t#S256"];
  if (!required && expected === undefined) return null;
  assertIdentity(typeof expected === "string" && /^[A-Za-z0-9_-]{43}$/u.test(expected), "IDENTITY_CERTIFICATE_BINDING_INVALID", "cnf.x5t#S256 is missing or malformed");
  const actual = certificateThumbprint(peerCertificate(request));
  const expectedBytes = Buffer.from(expected, "ascii");
  const actualBytes = Buffer.from(actual, "ascii");
  assertIdentity(expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes), "IDENTITY_CERTIFICATE_BINDING_MISMATCH", "access token is not bound to the presented client certificate");
  return actual;
}
