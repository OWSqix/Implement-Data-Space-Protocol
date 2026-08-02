import { assertIdentity, IdentityError, unavailable } from "./errors.mjs";

function strings(value, label, { required = true } = {}) {
  if (!required && value === undefined) return [];
  assertIdentity(Array.isArray(value) && value.length <= 128 && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 2_048), "IDENTITY_DCP_RESULT_INVALID", `${label} is missing or malformed`, { status: 503 });
  return [...new Set(value)];
}

export class DcpCredentialVerifierAdapter {
  constructor({ verifier, trustedIssuers, requiredCredentialTypes, clock = () => new Date() }) {
    assertIdentity(verifier && typeof verifier.verifyPresentation === "function", "IDENTITY_DCP_CONFIGURATION_INVALID", "a DCP presentation verifier is required", { status: 500 });
    assertIdentity(Array.isArray(trustedIssuers) && trustedIssuers.length > 0, "IDENTITY_DCP_CONFIGURATION_INVALID", "trusted DCP issuers are required", { status: 500 });
    assertIdentity(Array.isArray(requiredCredentialTypes) && requiredCredentialTypes.length > 0, "IDENTITY_DCP_CONFIGURATION_INVALID", "required DCP credential types are required", { status: 500 });
    Object.assign(this, { verifier, trustedIssuers: [...new Set(trustedIssuers)], requiredCredentialTypes: [...new Set(requiredCredentialTypes)], clock });
  }

  async verify({ presentationToken, audience, signal }) {
    assertIdentity(typeof presentationToken === "string" && presentationToken.length >= 16 && presentationToken.length <= 262_144, "IDENTITY_DCP_PRESENTATION_INVALID", "DCP presentation token is missing or unbounded");
    assertIdentity(typeof audience === "string" && audience.length > 0 && audience.length <= 2_048, "IDENTITY_DCP_PRESENTATION_INVALID", "DCP audience is missing");
    let result;
    try {
      result = await this.verifier.verifyPresentation({ presentationToken, audience, signal });
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      if (error instanceof IdentityError) throw error;
      throw unavailable("IDENTITY_DCP_VERIFIER_UNAVAILABLE", "DCP presentation verifier is unavailable", error);
    }
    assertIdentity(result && result.verified === true, "IDENTITY_DCP_PRESENTATION_REJECTED", "DCP presentation was not verified");
    assertIdentity(result.audience === audience, "IDENTITY_DCP_PRESENTATION_REJECTED", "DCP presentation audience does not match");
    assertIdentity(this.trustedIssuers.includes(result.issuer), "IDENTITY_DCP_ISSUER_REJECTED", "DCP credential issuer is not trusted", { status: 403 });
    assertIdentity(result.statusChecked === true, "IDENTITY_DCP_STATUS_UNVERIFIED", "DCP credential status was not checked", { status: 503 });
    assertIdentity(typeof result.participantId === "string" && result.participantId.length > 0 && result.participantId.length <= 2_048, "IDENTITY_DCP_RESULT_INVALID", "DCP participant ID is missing", { status: 503 });
    assertIdentity(typeof result.proofKeyId === "string" && result.proofKeyId.length > 0 && result.proofKeyId.length <= 2_048, "IDENTITY_DCP_RESULT_INVALID", "DCP proof key ID is missing", { status: 503 });
    const credentialTypes = strings(result.credentialTypes, "DCP credential types");
    assertIdentity(this.requiredCredentialTypes.every((type) => credentialTypes.includes(type)), "IDENTITY_DCP_CREDENTIAL_REQUIRED", "DCP presentation lacks a required credential", { status: 403 });
    const credentialIds = strings(result.credentialIds, "DCP credential IDs");
    const expiresAt = Date.parse(result.expiresAt);
    assertIdentity(Number.isFinite(expiresAt) && expiresAt > this.clock().getTime(), "IDENTITY_DCP_PRESENTATION_EXPIRED", "DCP presentation or credential is expired");
    return Object.freeze({
      schemaVersion: "molit.dcp-identity/1",
      participantId: result.participantId,
      issuer: result.issuer,
      proofKeyId: result.proofKeyId,
      credentialIds: Object.freeze(credentialIds),
      credentialTypes: Object.freeze(credentialTypes),
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }
}

export class UnavailableDcpCredentialVerifier {
  async verifyPresentation() {
    throw unavailable(
      "IDENTITY_DCP_ISSUANCE_TRUST_CHAIN_NOT_DEPLOYED",
      "DCP issuance, credential status, and trust-anchor services have not been deployed",
    );
  }
}
