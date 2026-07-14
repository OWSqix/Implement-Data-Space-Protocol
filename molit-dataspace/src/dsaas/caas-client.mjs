import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { authorizationHeaders } from "../bridge-runtime/telemetry.mjs";
import { rejectSecretMaterial } from "./contracts.mjs";

export class HttpCaasClient {
  constructor({ config, http, env = process.env }) {
    Object.assign(this, { config, http, env });
  }

  async ensureConnector(request, idempotencyKey, { signal } = {}) {
    rejectSecretMaterial(request);
    assertRuntime(this.config.supportsIdempotencyKey === true, "DSAAS_CAAS_IDEMPOTENCY_REQUIRED", "CaaS adapter must guarantee Idempotency-Key semantics");
    const endpoint = new URL(this.config.ensurePath, this.config.baseUrl);
    assertRuntime(endpoint.origin === new URL(this.config.baseUrl).origin, "DSAAS_CAAS_ENDPOINT_INVALID", "CaaS ensure path changed origin");
    const response = await this.http.json(endpoint, {
      method: "POST",
      headers: {
        ...authorizationHeaders(this.config.auth, this.env),
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(request),
      retryUnsafe: true,
      signal,
    });
    if (![200, 201, 202].includes(response.status)) {
      throw new RuntimeError("DSAAS_CAAS_REJECTED", "CaaS rejected connector convergence request", { status: response.status });
    }
    assertRuntime(response.value && typeof response.value === "object" && !Array.isArray(response.value), "DSAAS_CAAS_RESPONSE_INVALID", "CaaS returned an invalid response body");
    rejectSecretMaterial(response.value);
    return response.value;
  }
}
