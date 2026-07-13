import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

import { loadPublicationSnapshot, sha256 } from "./snapshot.mjs";

const MEDIA_TYPES = Object.freeze(["application/ld+json", "text/html", "text/turtle"]);

function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function expectedHttpsOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw failure("INVALID_ATTESTATION_ORIGIN", "expected origin must be an absolute HTTPS origin");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw failure("INVALID_ATTESTATION_ORIGIN", "expected origin must be HTTPS and contain no path, query, fragment, or credentials");
  }
  return parsed.origin;
}

function normalizedMediaType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function reportValue(value) {
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  return value;
}

function addCheck(checks, id, ok, expected, actual, details = {}) {
  checks.push({ actual: reportValue(actual), details, expected: reportValue(expected), id, ok });
}

function lockDigest(lockBytes) {
  return createHash("sha256").update(lockBytes).digest("hex");
}

async function loadArtifactLock(releaseRoot) {
  const file = path.join(releaseRoot, "artifact-lock.json");
  const bytes = await readFile(file);
  let lock;
  try {
    lock = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw failure("INVALID_ARTIFACT_LOCK", "artifact lock is not valid JSON", { cause: error.message });
  }
  if (!Array.isArray(lock.artifacts)) throw failure("INVALID_ARTIFACT_LOCK", "artifact lock has no artifacts");
  return { bytes, lock };
}

export function createHttpsAttestationTransport({ ca, maxBodyBytes = 16 * 1024 * 1024, timeoutMs = 10_000 } = {}) {
  const agent = new https.Agent({
    ca,
    keepAlive: true,
    maxSockets: 8,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  });

  async function request(url, { headers = {}, method = "GET" } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let responseObject;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        callback(value);
      };
      const requestObject = https.request(url, {
        agent,
        headers,
        method,
        rejectUnauthorized: true,
        timeout: timeoutMs,
      }, (response) => {
        responseObject = response;
        const chunks = [];
        let length = 0;
        const socket = response.socket;
        const peer = socket?.getPeerCertificate?.() ?? {};
        const tls = {
          authorizationError: socket?.authorizationError ?? null,
          authorized: socket?.authorized === true,
          fingerprint256: peer.fingerprint256 ?? null,
          protocol: socket?.getProtocol?.() ?? null,
          subjectAltName: peer.subjectaltname ?? null,
          validTo: peer.valid_to ?? null,
        };
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > maxBodyBytes) {
            response.destroy(failure("ATTESTATION_RESPONSE_TOO_LARGE", "remote response exceeds byte limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          settle(resolve, {
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode,
            tls,
          });
        });
        response.once("aborted", () => settle(reject, failure("ATTESTATION_RESPONSE_ABORTED", "remote response was aborted")));
        response.once("error", (error) => settle(reject, error));
      });
      const deadline = setTimeout(() => {
        const error = failure("ATTESTATION_DEADLINE_EXCEEDED", "remote request exceeded its absolute deadline");
        if (responseObject) responseObject.destroy(error);
        else requestObject.destroy(error);
      }, timeoutMs);
      deadline.unref();
      requestObject.once("timeout", () => requestObject.destroy(failure("ATTESTATION_INACTIVITY_TIMEOUT", "remote request was inactive for too long")));
      requestObject.once("error", (error) => settle(reject, error));
      requestObject.end();
    });
  }

  request.close = () => agent.destroy();
  return request;
}

function tlsAcceptable(tls) {
  return tls?.authorized === true && (tls.protocol === "TLSv1.2" || tls.protocol === "TLSv1.3");
}

function strongEtag(value) {
  return typeof value === "string" && /^"[^"\r\n]+"$/u.test(value);
}

export async function attestNamespace({
  ca,
  contractFile = "publication/content-negotiation.json",
  expectedOrigin,
  releaseRoot,
  request: injectedRequest,
  timeoutMs = 10_000,
}) {
  const targetOrigin = expectedHttpsOrigin(expectedOrigin);
  const snapshot = await loadPublicationSnapshot({ contractFile, publicOrigin: targetOrigin, releaseRoot });
  const { bytes: lockBytes, lock } = await loadArtifactLock(releaseRoot);
  const lockByPath = new Map(lock.artifacts.map((entry) => [entry.path, entry]));
  const checks = [];

  addCheck(
    checks,
    `lock:${contractFile}`,
    lockByPath.get(contractFile)?.sha256 === snapshot.contractDigest,
    snapshot.contractDigest,
    lockByPath.get(contractFile)?.sha256 ?? null,
  );

  for (const [artifactPath, artifact] of snapshot.artifacts) {
    const entry = lockByPath.get(artifactPath);
    addCheck(
      checks,
      `lock:${artifactPath}`,
      entry?.sha256 === artifact.digest,
      artifact.digest,
      entry?.sha256 ?? null,
    );
  }

  const request = injectedRequest ?? createHttpsAttestationTransport({ ca, timeoutMs });
  const tlsObservations = new Map();
  async function checkedRequest(id, iri, options) {
    try {
      const response = await request(iri, options);
      const tlsKey = JSON.stringify(response.tls ?? {});
      tlsObservations.set(tlsKey, response.tls ?? {});
      addCheck(checks, `tls:${id}`, tlsAcceptable(response.tls), "authorized TLSv1.2 or TLSv1.3", response.tls ?? null);
      return response;
    } catch (error) {
      addCheck(checks, `transport:${id}`, false, "successful authenticated HTTPS request", error.message, {
        code: error.code ?? null,
      });
      return null;
    }
  }

  const cases = [];
  for (const [resourceIndex, resource] of snapshot.contract.resources.entries()) {
    for (const [iriIndex, iri] of resource.iris.entries()) {
      for (const mediaType of MEDIA_TYPES) {
        const artifactPath = resource.representations[mediaType];
        if (!artifactPath) {
          addCheck(checks, `contract:${resourceIndex}:${iriIndex}:${mediaType}`, false, "representation path", null);
          continue;
        }
        cases.push({ artifact: snapshot.artifacts.get(artifactPath), iri, mediaType, resourceIndex, iriIndex });
      }
    }
  }

  await Promise.all(cases.map(async ({ artifact, iri, mediaType, resourceIndex, iriIndex }) => {
    const id = `${resourceIndex}:${iriIndex}:${mediaType}`;
    const get = await checkedRequest(`get:${id}`, iri, { headers: { Accept: mediaType }, method: "GET" });
    if (!get) return;
    addCheck(checks, `status:get:${id}`, get.status === 200, 200, get.status);
    addCheck(checks, `media:get:${id}`, normalizedMediaType(get.headers["content-type"]) === mediaType, mediaType, get.headers["content-type"] ?? null);
    addCheck(checks, `bytes:get:${id}`, sha256(get.body) === artifact.digest, artifact.digest, sha256(get.body), {
      length: get.body.length,
    });
    addCheck(checks, `etag:get:${id}`, strongEtag(get.headers.etag), "strong ETag", get.headers.etag ?? null);

    const head = await checkedRequest(`head:${id}`, iri, { headers: { Accept: mediaType }, method: "HEAD" });
    if (head) {
      addCheck(checks, `status:head:${id}`, head.status === 200, 200, head.status);
      addCheck(checks, `body:head:${id}`, head.body.length === 0, 0, head.body.length);
      addCheck(checks, `length:head:${id}`, Number(head.headers["content-length"]) === artifact.length, artifact.length, head.headers["content-length"] ?? null);
      addCheck(checks, `etag:head:${id}`, head.headers.etag === get.headers.etag, get.headers.etag ?? null, head.headers.etag ?? null);
    }

    if (strongEtag(get.headers.etag)) {
      const conditional = await checkedRequest(`conditional:${id}`, iri, {
        headers: { Accept: mediaType, "If-None-Match": get.headers.etag },
        method: "GET",
      });
      if (conditional) {
        addCheck(checks, `status:conditional:${id}`, conditional.status === 304, 304, conditional.status);
        addCheck(checks, `body:conditional:${id}`, conditional.body.length === 0, 0, conditional.body.length);
      }
    }
  }));

  const iris = snapshot.contract.resources.flatMap((resource) => resource.iris);
  await Promise.all(iris.map(async (iri, index) => {
    const redirected = await checkedRequest(`redirect:${index}`, `${iri}/?attestation=1`, { method: "GET" });
    if (!redirected) return;
    addCheck(checks, `status:redirect:${index}`, redirected.status === 308, 308, redirected.status);
    addCheck(checks, `location:redirect:${index}`, redirected.headers.location === `${iri}?attestation=1`, `${iri}?attestation=1`, redirected.headers.location ?? null);
  }));

  const notFound = await checkedRequest("not-found", `${targetOrigin}/.well-known/molit-namespace-attestation-not-found`, { method: "GET" });
  if (notFound) addCheck(checks, "status:not-found", notFound.status === 404, 404, notFound.status);
  const notAcceptable = await checkedRequest("not-acceptable", iris[0], {
    headers: { Accept: "application/xml" },
    method: "GET",
  });
  if (notAcceptable) addCheck(checks, "status:not-acceptable", notAcceptable.status === 406, 406, notAcceptable.status);

  request.close?.();
  checks.sort((left, right) => left.id.localeCompare(right.id));
  return {
    artifactLockSha256: lockDigest(lockBytes),
    checks,
    generatedAt: new Date().toISOString(),
    passed: checks.length > 0 && checks.every((check) => check.ok),
    profileVersion: snapshot.profileVersion,
    schemaVersion: "molit.namespace-remote-attestation/1",
    targetOrigin,
    tlsObservations: [...tlsObservations.values()],
  };
}
