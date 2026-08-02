import { assertIdentity } from "./errors.mjs";
import { PinnedJsonClient } from "./http-json.mjs";
import { IntrospectionAuthenticator } from "./introspection.mjs";
import { OidcJwtAuthenticator } from "./oidc-jwt.mjs";

export function createOperationalAuthenticator({ config, fetchImpl, secretProvider, revocationChecker, clock }) {
  assertIdentity(config?.schemaVersion === "molit.identity-runtime-config/1", "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "identity runtime configuration version is not supported", { status: 500 });
  const http = new PinnedJsonClient({ ...config.network, fetchImpl });
  if (config.mode === "oidc-jwt") {
    assertIdentity(config.oidcJwt && !config.introspection, "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "OIDC JWT mode requires only oidcJwt configuration", { status: 500 });
    return new OidcJwtAuthenticator({ config: { ...config.oidcJwt, policy: config.policy }, http, revocationChecker, clock });
  }
  if (config.mode === "rfc7662-introspection") {
    assertIdentity(config.introspection && !config.oidcJwt, "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "introspection mode requires only introspection configuration", { status: 500 });
    return new IntrospectionAuthenticator({ config: { ...config.introspection, policy: config.policy }, http, secretProvider, clock });
  }
  assertIdentity(false, "IDENTITY_RUNTIME_CONFIGURATION_INVALID", "identity authentication mode is not supported", { status: 500 });
}
