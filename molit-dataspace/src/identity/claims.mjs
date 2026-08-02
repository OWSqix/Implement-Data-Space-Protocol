import { assertIdentity, IdentityError, unavailable } from "./errors.mjs";
import { verifyCertificateBinding } from "./certificate.mjs";

function claimAt(object, path) {
  assertIdentity(typeof path === "string" && /^(?:[A-Za-z0-9_#-]+)(?:\.[A-Za-z0-9_#-]+)*$/u.test(path), "IDENTITY_POLICY_INVALID", "claim path is invalid", { status: 500 });
  return path.split(".").reduce((value, key) => (value && typeof value === "object" && !Array.isArray(value) ? value[key] : undefined), object);
}

function identifier(value, label, { min = 1, max = 512 } = {}) {
  assertIdentity(typeof value === "string" && value.length >= min && value.length <= max && !/[\s\u0000-\u001f\u007f]/u.test(value), "IDENTITY_TOKEN_INVALID", `${label} claim is missing or malformed`);
  return value;
}

function stringSet(value, label, { required = true } = {}) {
  if (value === undefined && !required) return [];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[ ,]+/u).filter(Boolean) : null;
  assertIdentity(items && (!required || items.length > 0) && items.length <= 128 && items.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(item)), "IDENTITY_TOKEN_INVALID", `${label} claim is missing or malformed`);
  return [...new Set(items)];
}

function audienceMatches(actual, expected) {
  const values = Array.isArray(actual) ? actual : [actual];
  return values.every((item) => typeof item === "string") && expected.some((item) => values.includes(item));
}

function numericDate(value, label) {
  assertIdentity(Number.isSafeInteger(value) && value >= 0, "IDENTITY_TOKEN_INVALID", `${label} claim is missing or malformed`);
  return value;
}

function requireAllowed(values, allowed, label) {
  if (!allowed) return;
  assertIdentity(values.every((value) => allowed.includes(value)), "IDENTITY_TOKEN_NOT_AUTHORIZED", `${label} contains a value that is not allowed`, { status: 403 });
}

export function bearerToken(request) {
  const rawHeaders = request?.rawHeaders;
  assertIdentity(Array.isArray(rawHeaders) && rawHeaders.length % 2 === 0, "IDENTITY_UNAUTHENTICATED", "raw request headers are required");
  const values = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === "authorization") values.push(rawHeaders[index + 1]);
  }
  assertIdentity(values.length === 1, "IDENTITY_UNAUTHENTICATED", "exactly one Authorization header is required");
  const match = /^Bearer ([\x21-\x7e]{16,16384})$/u.exec(values[0]);
  assertIdentity(match, "IDENTITY_UNAUTHENTICATED", "Authorization must contain one bounded bearer token");
  return match[1];
}

export function validateIdentityPolicy(policy) {
  assertIdentity(policy && typeof policy === "object" && !Array.isArray(policy), "IDENTITY_POLICY_INVALID", "identity policy is required", { status: 500 });
  assertIdentity(typeof policy.issuer === "string" && policy.issuer.length <= 2_048, "IDENTITY_POLICY_INVALID", "identity issuer is invalid", { status: 500 });
  assertIdentity(Array.isArray(policy.audiences) && policy.audiences.length > 0 && policy.audiences.every((item) => typeof item === "string" && item.length > 0), "IDENTITY_POLICY_INVALID", "identity audiences are invalid", { status: 500 });
  for (const name of ["clientIdClaim", "tokenIdClaim", "actorTypeClaim", "rolesClaim", "tenantIdsClaim"]) claimAt({}, policy[name]);
  assertIdentity(policy.actorTypes?.human && policy.actorTypes?.service, "IDENTITY_POLICY_INVALID", "human and service actor values are required", { status: 500 });
  assertIdentity(Number.isSafeInteger(policy.clockSkewSeconds) && policy.clockSkewSeconds >= 0 && policy.clockSkewSeconds <= 300, "IDENTITY_POLICY_INVALID", "clock skew is invalid", { status: 500 });
  assertIdentity(Number.isSafeInteger(policy.maxTokenLifetimeSeconds) && policy.maxTokenLifetimeSeconds >= 60 && policy.maxTokenLifetimeSeconds <= 86_400, "IDENTITY_POLICY_INVALID", "maximum token lifetime is invalid", { status: 500 });
  assertIdentity(Array.isArray(policy.allowedClientIds) && policy.allowedClientIds.length > 0, "IDENTITY_POLICY_INVALID", "allowed clients are required", { status: 500 });
  assertIdentity(Array.isArray(policy.allowedRoles) && policy.allowedRoles.length > 0, "IDENTITY_POLICY_INVALID", "allowed roles are required", { status: 500 });
  assertIdentity(Array.isArray(policy.humanMfa?.acceptedAcrValues) && policy.humanMfa.acceptedAcrValues.length > 0, "IDENTITY_POLICY_INVALID", "accepted human MFA acr values are required", { status: 500 });
  assertIdentity(Array.isArray(policy.humanMfa?.requiredAmrAny) && policy.humanMfa.requiredAmrAny.length > 0, "IDENTITY_POLICY_INVALID", "required human MFA amr values are required", { status: 500 });
  return policy;
}

export function mapIdentityPrincipal(claims, policy, { request, expectedTenantId, requiredRoles = [], now = new Date(), signingKeyId } = {}) {
  validateIdentityPolicy(policy);
  assertIdentity(claims && typeof claims === "object" && !Array.isArray(claims), "IDENTITY_TOKEN_INVALID", "token claims are malformed");
  assertIdentity(claims.iss === policy.issuer, "IDENTITY_TOKEN_INVALID", "token issuer does not match");
  assertIdentity(audienceMatches(claims.aud, policy.audiences), "IDENTITY_TOKEN_INVALID", "token audience does not match");
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const exp = numericDate(claims.exp, "exp");
  const iat = numericDate(claims.iat, "iat");
  const nbf = claims.nbf === undefined ? iat : numericDate(claims.nbf, "nbf");
  assertIdentity(exp > nowSeconds - policy.clockSkewSeconds, "IDENTITY_TOKEN_EXPIRED", "token is expired");
  assertIdentity(nbf <= nowSeconds + policy.clockSkewSeconds && iat <= nowSeconds + policy.clockSkewSeconds, "IDENTITY_TOKEN_NOT_ACTIVE", "token is not active yet");
  assertIdentity(exp > iat && exp - iat <= policy.maxTokenLifetimeSeconds, "IDENTITY_TOKEN_INVALID", "token lifetime exceeds policy");

  const subject = identifier(claims.sub, "sub");
  const clientId = identifier(claimAt(claims, policy.clientIdClaim), policy.clientIdClaim);
  assertIdentity(policy.allowedClientIds.includes(clientId), "IDENTITY_TOKEN_NOT_AUTHORIZED", "client is not allowed", { status: 403 });
  const tokenId = identifier(claimAt(claims, policy.tokenIdClaim), policy.tokenIdClaim);
  const actorValue = identifier(claimAt(claims, policy.actorTypeClaim), policy.actorTypeClaim);
  const actorType = actorValue === policy.actorTypes.human ? "human" : actorValue === policy.actorTypes.service ? "service" : null;
  assertIdentity(actorType, "IDENTITY_TOKEN_INVALID", "actor type is not recognized");
  const roles = stringSet(claimAt(claims, policy.rolesClaim), policy.rolesClaim);
  const tenantIds = stringSet(claimAt(claims, policy.tenantIdsClaim), policy.tenantIdsClaim);
  requireAllowed(roles, policy.allowedRoles, "roles");
  assertIdentity(requiredRoles.every((role) => roles.includes(role)), "IDENTITY_TOKEN_NOT_AUTHORIZED", "required role is missing", { status: 403 });
  if (expectedTenantId !== undefined) {
    identifier(expectedTenantId, "expected tenant");
    assertIdentity(tenantIds.includes(expectedTenantId), "IDENTITY_TENANT_MISMATCH", "token is not assigned to the requested tenant", { status: 403 });
  }

  let certificateThumbprint = null;
  if (actorType === "human") {
    assertIdentity(policy.humanMfa.acceptedAcrValues.includes(claims.acr), "IDENTITY_MFA_REQUIRED", "human token does not carry an accepted MFA assurance context", { status: 403 });
    const amr = stringSet(claims.amr, "amr");
    assertIdentity(policy.humanMfa.requiredAmrAny.some((method) => amr.includes(method)), "IDENTITY_MFA_REQUIRED", "human token does not show an accepted MFA method", { status: 403 });
    certificateThumbprint = verifyCertificateBinding(claims, request, { required: false });
  } else {
    certificateThumbprint = verifyCertificateBinding(claims, request, { required: true });
  }

  return Object.freeze({
    schemaVersion: "molit.identity-principal/1",
    issuer: claims.iss,
    subject,
    principalId: subject,
    clientId,
    tokenId,
    signingKeyId: signingKeyId ?? null,
    actorType,
    roles: Object.freeze(roles),
    tenantIds: Object.freeze(tenantIds),
    certificateThumbprint,
    issuedAt: new Date(iat * 1_000).toISOString(),
    expiresAt: new Date(exp * 1_000).toISOString(),
  });
}

export async function assertNotRevoked(principal, checker, { signal } = {}) {
  assertIdentity(checker && typeof checker.isRevoked === "function", "IDENTITY_REVOCATION_CONFIGURATION_INVALID", "a revocation checker is required", { status: 500 });
  let result;
  try {
    result = await checker.isRevoked({ issuer: principal.issuer, subject: principal.subject, tokenId: principal.tokenId, issuedAt: principal.issuedAt, signal });
  } catch (error) {
    if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
    if (error instanceof IdentityError) throw error;
    throw unavailable("IDENTITY_REVOCATION_UNAVAILABLE", "token revocation status could not be established", error);
  }
  assertIdentity(result && typeof result.revoked === "boolean", "IDENTITY_REVOCATION_UNAVAILABLE", "revocation checker returned an invalid result", { status: 503 });
  assertIdentity(result.revoked === false, "IDENTITY_TOKEN_REVOKED", "token has been revoked");
}
