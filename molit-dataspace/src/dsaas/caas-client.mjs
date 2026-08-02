import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";
import { authorizationHeaders } from "../bridge-runtime/telemetry.mjs";
import { rejectSecretMaterial } from "./contracts.mjs";

export class HttpCaasClient {
  constructor({ config, http, env = process.env, tracer = null, tokenProvider = null }) {
    Object.assign(this, { config, http, env, tracer, tokenProvider });
  }

  async ensureConnector(request, idempotencyKey, { signal, traceContext } = {}) {
    rejectSecretMaterial(request);
    assertRuntime(this.config.supportsIdempotencyKey === true, "DSAAS_CAAS_IDEMPOTENCY_REQUIRED", "CaaS adapter must guarantee Idempotency-Key semantics");
    const endpoint = new URL(this.config.ensurePath, this.config.baseUrl);
    assertRuntime(endpoint.origin === new URL(this.config.baseUrl).origin, "DSAAS_CAAS_ENDPOINT_INVALID", "CaaS ensure path changed origin");
    const span = this.tracer?.startSpan("dsaas.caas.ensure", {
      parent: traceContext,
      kind: "client",
      tenantId: request.caasTenantId,
      attributes: { "http.request.method": "POST", "server.address": endpoint.hostname },
    });
    let response;
    let failure;
    try {
      const operationalAuth = this.config.auth?.type === "oauth2-client-credentials-mtls";
      const credential = operationalAuth
        ? await this.tokenProvider?.get({ signal })
        : null;
      assertRuntime(!operationalAuth || credential,
        "DSAAS_CAAS_OAUTH_PROVIDER_REQUIRED", "operational CaaS access requires an OAuth2 mTLS credential provider");
      const authHeaders = credential
        ? { authorization: `Bearer ${credential.accessToken}` }
        : authorizationHeaders(this.config.auth, this.env);
      response = await this.http.json(endpoint, {
        method: "POST",
        headers: span?.outboundHeaders({
        ...authHeaders,
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        }) ?? {
          ...authHeaders,
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(request),
        retryUnsafe: true,
        signal,
        ...(credential ? { dispatcherContext: { mtls: credential.mtls } } : {}),
      });
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await span?.end({
        status: failure ? "ERROR" : "OK",
        ...(failure ? { message: failure.code ?? failure.name ?? "upstream failure" } : {}),
        attributes: { "http.response.status_code": response?.status ?? 0 },
        signal,
      });
    }
    if (![200, 201, 202].includes(response.status)) {
      throw new RuntimeError("DSAAS_CAAS_REJECTED", "CaaS rejected connector convergence request", { status: response.status });
    }
    assertRuntime(response.value && typeof response.value === "object" && !Array.isArray(response.value), "DSAAS_CAAS_RESPONSE_INVALID", "CaaS returned an invalid response body");
    rejectSecretMaterial(response.value);
    return response.value;
  }
}
