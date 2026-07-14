import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const MANAGEMENT_CONTEXT = 'https://w3id.org/edc/connector/management/v2';
export const DSP_PROTOCOL = 'dataspace-protocol-http:2025-1';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const DSPACE_NAMESPACE = 'https://w3id.org/dspace/2025/1/';
const ODRL_NAMESPACE = 'http://www.w3.org/ns/odrl/2/';

export function getValue(object, ...names) {
  if (!object || typeof object !== 'object') return undefined;
  for (const name of names) {
    if (Object.hasOwn(object, name)) return object[name];
  }
  for (const [key, value] of Object.entries(object)) {
    const suffix = key.split(/[\/#:]/).at(-1);
    if (names.includes(suffix)) return value;
  }
  return undefined;
}

export function getId(object) {
  if (!object || typeof object !== 'object') return undefined;
  return object['@id'] ?? object.id;
}

export function joinDspVersion(protocolRoot, versionPath) {
  const root = new URL(protocolRoot);
  if (root.search || root.hash) throw new Error('DSP protocol root must not contain a query or fragment');
  const path = `/${String(versionPath).replace(/^\/+/, '')}`;
  const rootPath = root.pathname.replace(/\/+$/, '');
  if (rootPath.endsWith(path)) throw new Error(`DSP version path is already present in protocol root: ${root.pathname}`);
  root.pathname = `${rootPath}${path}`;
  return root.toString().replace(/\/$/, '');
}

export function findDataset(catalog, assetId) {
  const queue = [catalog];
  const visited = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (!Array.isArray(value)) {
      const type = asArray(getValue(value, '@type', 'type')).map(String);
      if (getId(value) === assetId && type.some((entry) => entry.endsWith('Dataset'))) return value;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return undefined;
}

function identifierValue(value) {
  const values = asArray(value);
  if (values.length !== 1) return undefined;
  const candidate = values[0];
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') return getId(candidate) ?? candidate['@value'] ?? candidate.value;
  return undefined;
}

function controlledIdentifierTerm(object, term, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  for (const key of Object.keys(object)) {
    const suffix = key.split(/[\/#:]/u).at(-1);
    if (suffix === term && !allowedKeys.includes(key)) throw new Error(`${term} uses an unrecognized namespace: ${key}`);
  }
  const values = allowedKeys.filter((key) => Object.hasOwn(object, key)).map((key) => object[key]);
  if (!values.length) return undefined;
  const identifiers = values.map(identifierValue);
  if (identifiers.some((value) => value === undefined) || new Set(identifiers).size !== 1) {
    throw new Error(`${term} has ambiguous values`);
  }
  return values[0];
}

/**
 * Bind an ephemeral Catalog offer to the Catalog participant and Dataset.
 *
 * EDC 0.18.0 emits an empty ODRL offer with only @id/@type. Management API
 * v4 nevertheless requires odrl:assigner and odrl:target. All terms returned
 * by the provider are retained; the two binding terms are filled only when
 * absent and are rejected when they conflict with the authenticated request
 * context.
 */
export function bindCatalogOffer(catalog, dataset, offer, expectedProviderId) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new Error('Catalog offer must be one object');
  const participantId = identifierValue(controlledIdentifierTerm(catalog, 'participantId', [
    'participantId',
    'dspace:participantId',
    `${DSPACE_NAMESPACE}participantId`,
  ]));
  const assetId = getId(dataset);
  if (!participantId || participantId !== expectedProviderId) {
    throw new Error(`Catalog participantId does not match expected provider: ${participantId ?? '<missing>'}`);
  }
  if (!assetId) throw new Error('Catalog Dataset has no id');
  if (!getId(offer)) throw new Error('Catalog offer has no id');

  const policy = structuredClone(offer);
  for (const [term, expected] of [['assigner', participantId], ['target', assetId]]) {
    const existing = controlledIdentifierTerm(policy, term, [term, `odrl:${term}`, `${ODRL_NAMESPACE}${term}`]);
    if (existing === undefined) {
      policy[term] = expected;
    } else if (identifierValue(existing) !== expected) {
      throw new Error(`Catalog offer ${term} does not match ${expected}`);
    }
  }
  return policy;
}

async function request(url, { method = 'GET', apiKey, body, expected = [200], timeoutMs = 10_000 } = {}) {
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error'
  });
  const text = await response.text();
  let parsed;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!expected.includes(response.status)) {
    const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    throw new Error(`${method} ${url} returned ${response.status}: ${detail?.slice(0, 1200)}`);
  }
  return { response, body: parsed };
}

export async function pollState(url, apiKey, wanted, rejected, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const result = await request(url, { apiKey });
    last = String(getValue(result.body, 'state') ?? '');
    if (wanted.includes(last)) return last;
    if (rejected.includes(last)) throw new Error(`State ${last} reached at ${url}`);
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${wanted.join(', ')} at ${url}; last state=${last}`);
}

async function discoverDsp(protocolRoot) {
  const discoveryUrl = `${protocolRoot.replace(/\/$/, '')}/.well-known/dspace-version`;
  const { body } = await request(discoveryUrl);
  const versions = asArray(getValue(body, 'protocolVersions'));
  const selected = versions.find((entry) => getValue(entry, 'version') === '2025-1');
  if (!selected) throw new Error(`DSP discovery did not advertise 2025-1: ${JSON.stringify(body)}`);
  const versionPath = getValue(selected, 'path');
  if (versionPath !== '/2025-1') throw new Error(`Unexpected DSP 2025-1 path: ${versionPath}`);
  return joinDspVersion(protocolRoot, versionPath);
}

function callbackAddress(callbackUrl) {
  return {
    '@type': 'CallbackAddress',
    transactional: true,
    uri: callbackUrl,
    events: ['transfer.process.started']
  };
}

function startedEvent(event) {
  const payload = getValue(event, 'payload') ?? event;
  const parsed = {
    transferProcessId: identifierValue(getValue(payload, 'transferProcessId')),
    contractId: identifierValue(getValue(payload, 'contractId')),
    assetId: identifierValue(getValue(payload, 'assetId')),
    dataAddress: getValue(payload, 'dataAddress')
  };
  for (const name of ['transferProcessId', 'contractId', 'assetId', 'dataAddress']) {
    if (!parsed[name]) throw new Error(`TransferProcessStarted callback has no ${name}`);
  }
  return parsed;
}

export function createStartedEventMatcher(maxPending = 8) {
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 32) {
    throw new Error('maxPending must be an integer from 1 to 32');
  }
  const pending = [];
  let waiter;

  function assertContext(event, expected) {
    for (const name of ['contractId', 'assetId']) {
      if (event[name] !== expected[name]) {
        throw new Error(`TransferProcessStarted ${name} mismatch for ${expected.transferProcessId}`);
      }
    }
    return event.dataAddress;
  }

  return {
    push(rawEvent) {
      const event = startedEvent(rawEvent);
      if (waiter && event.transferProcessId === waiter.expected.transferProcessId) {
        const current = waiter;
        waiter = undefined;
        try { current.resolve(assertContext(event, current.expected)); }
        catch (error) { current.reject(error); }
        return;
      }
      if (pending.length >= maxPending) throw new Error(`TransferProcessStarted pending queue exceeds ${maxPending}`);
      pending.push(event);
    },
    waitFor(expected) {
      for (const name of ['transferProcessId', 'contractId', 'assetId']) {
        if (!expected?.[name]) return Promise.reject(new Error(`Expected ${name} is required`));
      }
      const index = pending.findIndex((event) => event.transferProcessId === expected.transferProcessId);
      if (index >= 0) {
        const [event] = pending.splice(index, 1);
        try { return Promise.resolve(assertContext(event, expected)); }
        catch (error) { return Promise.reject(error); }
      }
      if (waiter) return Promise.reject(new Error('Only one TransferProcessStarted waiter is supported'));
      return new Promise((resolve, reject) => { waiter = { expected, resolve, reject }; });
    }
  };
}

function createCallbackReceiver() {
  const matcher = createStartedEventMatcher();
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/hooks') {
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_048_576) throw new Error('Callback exceeds 1 MiB');
        chunks.push(chunk);
      }
      const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      matcher.push(event);
      res.writeHead(204).end();
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('invalid callback');
    }
  });
  return { server, waitForStarted: matcher.waitFor };
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForRevocation(url, authorization, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      headers: { authorization: String(authorization) },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    lastStatus = response.status;
    await response.arrayBuffer();
    if (lastStatus === 401 || lastStatus === 403) return lastStatus;
    if (lastStatus !== 200) throw new Error(`Unexpected post-termination EDR status ${lastStatus}`);
    await delay(500);
  }
  throw new Error(`EDR remained usable after transfer termination; last status=${lastStatus}`);
}

export async function runSmoke(environment = process.env) {
  const providerManagement = environment.PROVIDER_MANAGEMENT_URL ?? 'http://provider-control-plane:8081/management';
  const consumerManagement = environment.CONSUMER_MANAGEMENT_URL ?? 'http://consumer-control-plane:8081/management';
  const providerProtocolRoot = environment.PROVIDER_PROTOCOL_ROOT ?? 'http://provider-control-plane:8082/protocol';
  const providerKey = environment.PROVIDER_API_KEY;
  const consumerKey = environment.CONSUMER_API_KEY;
  const callbackUrl = new URL(environment.CALLBACK_URL ?? 'http://smoke:7070/hooks');
  const expectedHash = environment.EXPECTED_SHA256 ?? '2f013648aa3071d46c9e29b2e938c5fb36336cc53f27d1f5e507da3683da41a7';
  const expectedContentType = environment.EXPECTED_CONTENT_TYPE ?? 'application/json';
  const providerId = environment.PROVIDER_PARTICIPANT_ID ?? 'provider';
  if (!providerKey || !consumerKey) throw new Error('PROVIDER_API_KEY and CONSUMER_API_KEY are required');

  const { server, waitForStarted } = createCallbackReceiver();
  await listen(server, Number(callbackUrl.port || 80));
  try {
    const providerDsp = await discoverDsp(providerProtocolRoot);
    const runId = randomUUID();
    const assetId = `molit-edc-smoke-asset-${runId}`;
    const policyId = `molit-edc-smoke-policy-${runId}`;
    const definitionId = `molit-edc-smoke-contract-${runId}`;
    const context = [MANAGEMENT_CONTEXT];

    await request(`${providerManagement}/v4/assets`, {
      method: 'POST', apiKey: providerKey,
      body: {
        '@context': context,
        '@type': 'Asset',
        '@id': assetId,
        properties: { name: 'MOLIT EDC HTTP PULL smoke fixture', contentType: 'application/json' },
        dataAddress: {
          '@type': 'DataAddress',
          type: 'HttpData',
          baseUrl: 'http://provider-backend:8080',
          proxyPath: 'true'
        }
      }
    });
    await request(`${providerManagement}/v4/policydefinitions`, {
      method: 'POST', apiKey: providerKey,
      body: { '@context': context, '@type': 'PolicyDefinition', '@id': policyId, policy: { '@type': 'Set' } }
    });
    await request(`${providerManagement}/v4/contractdefinitions`, {
      method: 'POST', apiKey: providerKey,
      body: {
        '@context': context,
        '@type': 'ContractDefinition',
        '@id': definitionId,
        accessPolicyId: policyId,
        contractPolicyId: policyId,
        assetsSelector: [{
          '@type': 'Criterion',
          operandLeft: 'https://w3id.org/edc/v0.0.1/ns/id',
          operator: '=',
          operandRight: assetId
        }]
      }
    });

    const catalog = await request(`${consumerManagement}/v4/catalog/request`, {
      method: 'POST', apiKey: consumerKey,
      body: {
        '@context': context,
        '@type': 'CatalogRequest',
        counterPartyAddress: providerDsp,
        counterPartyId: providerId,
        protocol: DSP_PROTOCOL
      },
      timeoutMs: 30_000
    });
    const dataset = findDataset(catalog.body, assetId);
    if (!dataset) throw new Error(`Catalog did not contain dataset ${assetId}`);
    const offer = getValue(dataset, 'hasPolicy');
    if (!offer || typeof offer !== 'object') throw new Error('Catalog dataset has no negotiable hasPolicy offer');
    const negotiationPolicy = bindCatalogOffer(catalog.body, dataset, asArray(offer)[0], providerId);

    const negotiation = await request(`${consumerManagement}/v4/contractnegotiations`, {
      method: 'POST', apiKey: consumerKey,
      body: {
        '@context': context,
        '@type': 'ContractRequest',
        counterPartyAddress: providerDsp,
        protocol: DSP_PROTOCOL,
        providerId,
        policy: negotiationPolicy
      }
    });
    const negotiationId = getId(negotiation.body);
    if (!negotiationId) throw new Error('Negotiation response has no id');
    await pollState(
      `${consumerManagement}/v4/contractnegotiations/${encodeURIComponent(negotiationId)}/state`,
      consumerKey, ['FINALIZED'], ['TERMINATED', 'ERROR']
    );
    const agreement = await request(
      `${consumerManagement}/v4/contractnegotiations/${encodeURIComponent(negotiationId)}/agreement`,
      { apiKey: consumerKey }
    );
    const agreementId = getId(agreement.body);
    if (!agreementId) throw new Error('Finalized negotiation has no agreement id');

    const transfer = await request(`${consumerManagement}/v4/transferprocesses`, {
      method: 'POST', apiKey: consumerKey,
      body: {
        '@context': context,
        '@type': 'TransferRequest',
        counterPartyAddress: providerDsp,
        contractId: agreementId,
        protocol: DSP_PROTOCOL,
        transferType: 'HttpData-PULL',
        callbackAddresses: [callbackAddress(callbackUrl.toString())]
      }
    });
    const transferId = getId(transfer.body);
    if (!transferId) throw new Error('Transfer response has no id');
    await pollState(
      `${consumerManagement}/v4/transferprocesses/${encodeURIComponent(transferId)}/state`,
      consumerKey, ['STARTED'], ['TERMINATED', 'ERROR']
    );

    const dataAddress = await Promise.race([
      waitForStarted({ transferProcessId: transferId, contractId: agreementId, assetId }),
      delay(30_000).then(() => { throw new Error('Timed out waiting for transfer.process.started callback'); })
    ]);
    const edrProperties = getValue(dataAddress, 'properties') ?? dataAddress;
    const endpoint = identifierValue(getValue(edrProperties, 'endpoint'));
    const authorization = identifierValue(getValue(edrProperties, 'authorization'));
    if (!endpoint || !authorization) {
      const keys = dataAddress && typeof dataAddress === 'object' ? Object.keys(dataAddress).sort().join(',') : typeof dataAddress;
      throw new Error(`Callback EDR lacks endpoint or authorization; keys=${keys}`);
    }

    const pullUrl = `${String(endpoint).replace(/\/$/, '')}/data.json`;
    const response = await fetch(pullUrl, {
      headers: { authorization: String(authorization), accept: expectedContentType },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`EDR endpoint returned ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim();
    if (contentType !== expectedContentType) throw new Error(`Unexpected content-type ${contentType}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) throw new Error(`Payload SHA-256 mismatch: ${actualHash}`);

    await request(`${consumerManagement}/v4/transferprocesses/${encodeURIComponent(transferId)}/terminate`, {
      method: 'POST', apiKey: consumerKey, expected: [204],
      body: { '@context': context, '@type': 'TerminateTransfer', reason: 'local/CI smoke payload verified' }
    });
    const finalState = await pollState(
      `${consumerManagement}/v4/transferprocesses/${encodeURIComponent(transferId)}/state`,
      consumerKey, ['TERMINATED', 'DEPROVISIONED'], ['ERROR']
    );
    const revokedStatus = await waitForRevocation(pullUrl, authorization);

    return {
      ok: true,
      managementApi: 'v4',
      dsp: DSP_PROTOCOL,
      assetId,
      agreementId,
      transferId,
      startState: 'STARTED',
      finalState,
      revokedStatus,
      bytes: bytes.length,
      contentType,
      sha256: actualHash
    };
  } finally {
    await close(server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSmoke()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`EDC smoke failed: ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
