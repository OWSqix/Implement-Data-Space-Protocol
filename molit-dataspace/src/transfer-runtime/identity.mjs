import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";

export const identityFields = ["providerPid", "consumerPid", "agreementId", "datasetId", "format"];

export function verifyAuthoritativeIdentity(event, status) {
  assertRuntime(status && typeof status === "object" && !Array.isArray(status), "CONNECTOR_STATUS_INVALID", "authoritative connector status must be an object");
  for (const field of identityFields) {
    if (status[field] !== event[field]) {
      throw new RuntimeError("TRANSFER_IDENTITY_MISMATCH", `authoritative connector ${field} does not match the event`, { field });
    }
  }
  const allowedStates = event.action === "START"
    ? new Set(["START_AUTHORIZED", "STARTED"])
    : new Set(["TERMINATION_AUTHORIZED", "TERMINATED"]);
  assertRuntime(allowedStates.has(status.state), "TRANSFER_NOT_AUTHORIZED", "authoritative connector state does not authorize this lifecycle action or its idempotent replay", { state: status.state });
  return status;
}
