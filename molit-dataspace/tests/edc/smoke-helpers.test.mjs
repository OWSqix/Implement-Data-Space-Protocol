import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindCatalogOffer,
  createStartedEventMatcher,
  findDataset,
  getId,
  getValue,
  joinDspVersion
} from '../../tools/edc/smoke.mjs';

test('JSON-LD helpers accept compact and expanded EDC/DCAT keys', () => {
  const expanded = {
    'https://w3id.org/edc/v0.0.1/ns/endpoint': 'http://data',
    '@id': 'asset-1'
  };
  assert.equal(getValue(expanded, 'endpoint'), 'http://data');
  assert.equal(getId(expanded), 'asset-1');
});

test('DSP version path is appended exactly once', () => {
  assert.equal(
    joinDspVersion('http://provider:8082/protocol', '/2025-1'),
    'http://provider:8082/protocol/2025-1'
  );
  assert.throws(
    () => joinDspVersion('http://provider:8082/protocol/2025-1', '/2025-1'),
    /already present/
  );
});

test('catalog dataset lookup handles a dataset array and preserves hasPolicy', () => {
  const offer = { '@id': 'offer-1', '@type': 'odrl:Offer', target: 'asset-1' };
  const catalog = { 'dcat:dataset': [{ '@id': 'asset-1', '@type': 'dcat:Dataset', 'odrl:hasPolicy': offer }] };
  const dataset = findDataset(catalog, 'asset-1');
  assert.ok(dataset);
  assert.equal(getValue(dataset, 'hasPolicy'), offer);
});

test('negotiation binds an EDC 0.18 Catalog offer without replacing provider terms', () => {
  const catalog = { participantId: 'provider' };
  const dataset = { '@id': 'asset-1', '@type': 'Dataset' };
  const offer = { '@id': 'offer-1', '@type': 'Offer', permission: [{ action: 'use' }] };

  const policy = bindCatalogOffer(catalog, dataset, offer, 'provider');

  assert.deepEqual(policy, {
    '@id': 'offer-1',
    '@type': 'Offer',
    permission: [{ action: 'use' }],
    assigner: 'provider',
    target: 'asset-1'
  });
  assert.equal(offer.assigner, undefined, 'Catalog response must not be mutated');
});

test('negotiation rejects participant, assigner and target substitution', () => {
  const dataset = { '@id': 'asset-1', '@type': 'Dataset' };
  assert.throws(
    () => bindCatalogOffer({ participantId: 'attacker' }, dataset, { '@id': 'offer-1' }, 'provider'),
    /participantId/
  );
  assert.throws(
    () => bindCatalogOffer({ participantId: 'provider' }, dataset, { '@id': 'offer-1', assigner: 'attacker' }, 'provider'),
    /assigner/
  );
  assert.throws(
    () => bindCatalogOffer({ participantId: 'provider' }, dataset, { '@id': 'offer-1', target: 'asset-2' }, 'provider'),
    /target/
  );
});

test('negotiation rejects unknown namespace suffixes and conflicting canonical aliases', () => {
  const dataset = { '@id': 'asset-1', '@type': 'Dataset' };
  assert.throws(
    () => bindCatalogOffer(
      { participantId: 'provider' },
      dataset,
      { '@id': 'offer-1', 'evil:assigner': 'provider', 'odrl:assigner': 'attacker' },
      'provider'
    ),
    /unrecognized namespace/
  );
  assert.throws(
    () => bindCatalogOffer(
      { participantId: 'provider' },
      dataset,
      { '@id': 'offer-1', assigner: 'provider', 'odrl:assigner': 'attacker' },
      'provider'
    ),
    /ambiguous values/
  );
  assert.throws(
    () => bindCatalogOffer(
      { participantId: 'provider', 'evil:participantId': 'provider' },
      dataset,
      { '@id': 'offer-1' },
      'provider'
    ),
    /unrecognized namespace/
  );
});

test('negotiation accepts equal compact and full ODRL aliases', () => {
  const policy = bindCatalogOffer(
    { participantId: 'provider' },
    { '@id': 'asset-1', '@type': 'Dataset' },
    {
      '@id': 'offer-1',
      assigner: 'provider',
      'http://www.w3.org/ns/odrl/2/assigner': { '@id': 'provider' },
      target: 'asset-1',
      'odrl:target': 'asset-1'
    },
    'provider'
  );
  assert.equal(policy.assigner, 'provider');
  assert.equal(policy.target, 'asset-1');
});

function startedEvent(transferProcessId, contractId = 'agreement-1', assetId = 'asset-1') {
  return {
    payload: {
      transferProcessId,
      contractId,
      assetId,
      dataAddress: { endpoint: 'http://data', authorization: 'token' }
    }
  };
}

test('callback matcher ignores another transfer and accepts only the expected transfer context', async () => {
  const matcher = createStartedEventMatcher();
  const matched = matcher.waitFor({ transferProcessId: 'transfer-1', contractId: 'agreement-1', assetId: 'asset-1' });
  matcher.push(startedEvent('transfer-other'));
  matcher.push(startedEvent('transfer-1'));
  assert.deepEqual(await matched, { endpoint: 'http://data', authorization: 'token' });
});

test('callback matcher handles the creation race and rejects a substituted agreement', async () => {
  const queued = createStartedEventMatcher();
  queued.push(startedEvent('transfer-1'));
  assert.equal(
    (await queued.waitFor({ transferProcessId: 'transfer-1', contractId: 'agreement-1', assetId: 'asset-1' })).endpoint,
    'http://data'
  );

  const substituted = createStartedEventMatcher();
  substituted.push(startedEvent('transfer-1', 'agreement-attacker'));
  await assert.rejects(
    substituted.waitFor({ transferProcessId: 'transfer-1', contractId: 'agreement-1', assetId: 'asset-1' }),
    /contractId mismatch/
  );
});

test('callback matcher bounds pending events', () => {
  const matcher = createStartedEventMatcher(1);
  matcher.push(startedEvent('transfer-1'));
  assert.throws(() => matcher.push(startedEvent('transfer-2')), /pending queue exceeds 1/);
});
