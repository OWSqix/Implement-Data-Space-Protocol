import { assertIdentity, unavailable } from "./errors.mjs";

export class DurableRevocationRegistryChecker {
  constructor({ registry, maxRecordAgeMs = 30_000, clock = () => new Date() }) {
    assertIdentity(registry && typeof registry.lookup === "function", "IDENTITY_REVOCATION_CONFIGURATION_INVALID", "a durable revocation registry is required", { status: 500 });
    assertIdentity(Number.isSafeInteger(maxRecordAgeMs) && maxRecordAgeMs >= 1_000 && maxRecordAgeMs <= 300_000, "IDENTITY_REVOCATION_CONFIGURATION_INVALID", "revocation record age limit is invalid", { status: 500 });
    Object.assign(this, { registry, maxRecordAgeMs, clock });
  }

  async isRevoked({ issuer, subject, tokenId, issuedAt, signal }) {
    let record;
    try {
      record = await this.registry.lookup({ issuer, subject, tokenId, signal });
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      throw unavailable("IDENTITY_REVOCATION_UNAVAILABLE", "durable revocation registry lookup failed", error);
    }
    assertIdentity(record && record.issuer === issuer && record.subject === subject && record.tokenId === tokenId && ["VALID", "REVOKED"].includes(record.status), "IDENTITY_REVOCATION_UNAVAILABLE", "durable revocation registry returned an invalid record", { status: 503 });
    const observedAt = Date.parse(record.observedAt);
    const tokenIssuedAt = Date.parse(issuedAt);
    const now = this.clock().getTime();
    assertIdentity(Number.isFinite(tokenIssuedAt) && Number.isFinite(observedAt) && observedAt >= tokenIssuedAt && observedAt <= now && now - observedAt <= this.maxRecordAgeMs, "IDENTITY_REVOCATION_STALE", "durable revocation status is stale", { status: 503 });
    return { revoked: record.status === "REVOKED" };
  }
}
