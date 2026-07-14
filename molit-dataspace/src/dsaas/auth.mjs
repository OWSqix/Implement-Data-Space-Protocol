import { RuntimeError, assertRuntime } from "../bridge-runtime/errors.mjs";

function rawHeaderValues(request, wanted) {
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === wanted) values.push(request.rawHeaders[index + 1]);
  }
  return values;
}

function claimAt(object, path) {
  return path.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), object);
}

function stringArray(value, name) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[ ,]+/u).filter(Boolean) : null;
  assertRuntime(values && values.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256), "DSAAS_TOKEN_INVALID", `${name} claim is invalid`);
  return [...new Set(values)];
}

function audienceMatches(value, expected) {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function stableIdentifier(value, name) {
  assertRuntime(typeof value === "string" && /^[^\s\u0000-\u001f\u007f]{3,256}$/u.test(value), "DSAAS_TOKEN_INVALID", `${name} claim is invalid`);
  return value;
}

export function formUrlEncodedComponent(value) {
  const encoded = new URLSearchParams([["value", value]]).toString();
  return encoded.slice("value=".length);
}

export class OAuth2IntrospectionAuthenticator {
  constructor({ config, http, env = process.env, clock = () => new Date() }) {
    Object.assign(this, { config, http, env, clock });
  }

  async authenticate(request) {
    const values = rawHeaderValues(request, "authorization");
    assertRuntime(values.length === 1, "DSAAS_UNAUTHENTICATED", "exactly one Authorization header is required");
    const match = /^Bearer ([\x21-\x7e]{16,8192})$/u.exec(values[0]);
    assertRuntime(match, "DSAAS_UNAUTHENTICATED", "Authorization must contain one bearer token");
    const clientId = this.env[this.config.clientIdEnv];
    const clientSecret = this.env[this.config.clientSecretEnv];
    assertRuntime(clientId && clientSecret, "DSAAS_AUTH_CONFIGURATION_ERROR", "introspection client credentials are unavailable");
    const body = new URLSearchParams({ token: match[1], token_type_hint: "access_token" }).toString();
    const encodedClientId = formUrlEncodedComponent(clientId);
    const encodedClientSecret = formUrlEncodedComponent(clientSecret);
    let response;
    try {
      response = await this.http.json(this.config.introspectionUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${encodedClientId}:${encodedClientSecret}`, "utf8").toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        retryUnsafe: true,
      });
    } catch (error) {
      throw new RuntimeError("DSAAS_AUTH_UNAVAILABLE", "OAuth2 token introspection failed", { causeCode: error?.code ?? "UPSTREAM_ERROR" });
    }
    assertRuntime(response.status === 200 && response.value && typeof response.value === "object" && !Array.isArray(response.value), "DSAAS_AUTH_UNAVAILABLE", "OAuth2 introspection endpoint returned an invalid response");
    const claims = response.value;
    assertRuntime(claims.active === true, "DSAAS_UNAUTHENTICATED", "bearer token is inactive");
    assertRuntime(claims.iss === this.config.issuer, "DSAAS_TOKEN_INVALID", "token issuer does not match");
    assertRuntime(audienceMatches(claims.aud, this.config.audience), "DSAAS_TOKEN_INVALID", "token audience does not match");
    assertRuntime(Number.isSafeInteger(claims.exp) && claims.exp > Math.floor(this.clock().getTime() / 1_000), "DSAAS_TOKEN_INVALID", "token is expired or has no integer expiry");
    const principalId = stableIdentifier(claims.sub, "subject");
    const actorClientId = stableIdentifier(claimAt(claims, this.config.clientIdClaim), "client ID");
    const keyId = stableIdentifier(claimAt(claims, this.config.keyIdClaim), "key ID");
    const roles = stringArray(claimAt(claims, this.config.rolesClaim), "roles");
    const rawDataspaceIds = claimAt(claims, this.config.dataspaceIdsClaim);
    const dataspaceIds = rawDataspaceIds === undefined ? [] : stringArray(rawDataspaceIds, "dataspace IDs");
    return Object.freeze({ subject: principalId, principalId, clientId: actorClientId, keyId, roles, dataspaceIds });
  }
}

export function authorizationChallenge(response) {
  response.setHeader("WWW-Authenticate", 'Bearer realm="molit-dsaas"');
}
