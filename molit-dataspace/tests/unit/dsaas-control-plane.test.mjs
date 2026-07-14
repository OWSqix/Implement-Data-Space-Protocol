import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { digest } from "../../src/discovery/stable-json.mjs";
import { DsaasControlPlane } from "../../src/dsaas/service.mjs";
import { evaluateRequiredServices } from "../../src/dsaas/service-registry.mjs";
import { DsaasReconcileScheduler } from "../../src/dsaas/scheduler.mjs";
import { FileDsaasStore, validateDsaasState } from "../../src/dsaas/store.mjs";

const PROFILE = Object.freeze({ iri: "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1", version: "1.0.0-rc.1", sha256: "a".repeat(64) });
const GOVERNANCE = Object.freeze({ iri: "https://data.molit.go.kr/governance/molit-dataspace/1", version: "1", sha256: "b".repeat(64) });
function actor(subject, roles, dataspaceIds) {
  return Object.freeze({ subject, principalId: subject, clientId: `${subject}-client`, keyId: `${subject}-key-1`, roles, dataspaceIds });
}

const OPERATOR = actor("operator-1", ["dsaas.operator"], []);
const ADMIN_A = actor("admin-a", ["dsaas.dataspace-admin"], ["molit-test"]);
const ADMIN_B = actor("admin-b", ["dsaas.dataspace-admin"], ["molit-test"]);

function dataspace(overrides = {}) {
  return {
    schemaVersion: "molit.dsaas-dataspace/1",
    dataspaceId: "molit-test",
    name: "국토교통 시험 데이터 스페이스",
    operatorOrganizationId: "org:molit:test-operator",
    namespaceBase: "https://data.molit.go.kr/id/",
    metadataProfile: PROFILE,
    governanceBundle: GOVERNANCE,
    protocolProfile: {
      dspVersion: "2025-1",
      specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/",
      identityMode: "dcp",
    },
    connectorPlanId: "edc-isolated",
    deploymentMode: "isolated",
    requiredServiceIds: ["caas-primary", "identity-primary"],
    desiredState: "ACTIVE",
    ...overrides,
  };
}

function participant(overrides = {}) {
  return {
    schemaVersion: "molit.dsaas-participant/1",
    participantId: "road-provider",
    organizationId: "org:molit:road-provider",
    legalName: "도로 데이터 제공기관",
    caasTenantId: "road-provider-tenant",
    connectorParticipantId: "did:web:connectors.test.example:road-provider-tenant",
    connectorNamespace: "https://data.test.example/tenants/road-provider-tenant/",
    requestedRoles: ["provider"],
    connectorPlanId: "edc-isolated",
    evidence: { uri: "urn:evidence:road-provider:1", sha256: "c".repeat(64) },
    desiredState: "ACTIVE",
    ...overrides,
  };
}

function registry(ready = true) {
  const status = ready ? "READY" : "NOT_READY";
  const registryDocument = {
    issuedAt: "2026-07-13T00:00:00Z",
    validUntil: "2026-07-14T00:00:00Z",
  };
  return {
    ...registryDocument,
    maxAgeSeconds: 86_400,
    registry: registryDocument,
    byId: new Map([
      ["caas-primary", { serviceId: "caas-primary", serviceType: "caas", status, endpoint: "https://caas.test.example/", evidence: { observedAt: "2026-07-13T00:00:00Z", sha256: "d".repeat(64) } }],
      ["identity-primary", { serviceId: "identity-primary", serviceType: "identity-hub", status, endpoint: "https://identity.test.example/", evidence: { observedAt: "2026-07-13T00:00:00Z", sha256: "e".repeat(64) } }],
    ]),
  };
}

function approvalRegistry(status = "READY") {
  const decision = {
    decisionId: "decision:2026-001",
    status: "APPROVED",
    dataspaceId: "molit-test",
    participantId: "road-provider",
    organizationId: "org:molit:road-provider",
    evidenceSha256: "c".repeat(64),
    authority: "org:molit:institutional-approval-board",
    decidedAt: "2026-07-13T00:30:00Z",
    validUntil: "2026-07-14T00:00:00Z",
    provenanceSha256: "f".repeat(64),
  };
  const document = {
    issuedAt: "2026-07-13T00:00:00Z",
    validUntil: "2026-07-14T00:00:00Z",
    status,
  };
  return {
    actualSha256: "9".repeat(64),
    byId: new Map([[decision.decisionId, decision]]),
    ...document,
    maxAgeSeconds: 86_400,
    registry: document,
  };
}

async function fixture({ servicesReady = true, caas, approvalStatus = "READY", serviceRegistryProvider, approvalDecisionRegistryProvider, maxReconcileSupersessions = 8, caasRetryBaseMs = 60_000, caasRetryMaxMs = 480_000 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "molit-dsaas-"));
  let currentTime = "2026-07-13T01:02:03Z";
  const store = new FileDsaasStore({ path: join(directory, "state.json"), clock: () => new Date(currentTime) });
  const observed = [];
  const caasClient = caas ?? {
    async ensureConnector(request, key) {
      observed.push({ request, key });
      return {
        connectorId: request.caasTenantId,
        dataspaceId: request.dataspaceId,
        participantId: request.participantId,
        state: request.desiredState,
        endpoints: { connectorBase: "https://connector.test.example/" },
      };
    },
  };
  const service = new DsaasControlPlane({
    store,
    caas: caasClient,
    serviceRegistry: registry(servicesReady),
    serviceRegistryProvider,
    approvalDecisionRegistry: approvalRegistry(approvalStatus),
    approvalDecisionRegistryProvider,
    approvedMetadataProfiles: [PROFILE],
    approvedGovernanceBundles: [GOVERNANCE],
    connectorPlanIds: ["edc-isolated", "edc-virtualized"],
    allowedNamespaceOrigins: ["https://data.molit.go.kr"],
    clock: () => new Date(currentTime),
    maxReconcileSupersessions,
    caasRetryBaseMs,
    caasRetryMaxMs,
  });
  return { directory, observed, service, setTime(value) { currentTime = value; }, store };
}

test("creation is fail-closed and idempotent", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const created = await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const replay = await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  assert.deepEqual(replay, created);
  await assert.rejects(
    context.service.createDataspace(dataspace({ name: "변경된 이름" }), OPERATOR, "create-key-0001"),
    { code: "DSAAS_IDEMPOTENCY_CONFLICT" },
  );
  await assert.rejects(
    context.service.createDataspace(dataspace({ dataspaceId: "unapproved", metadataProfile: { ...PROFILE, sha256: "f".repeat(64) } }), OPERATOR, "create-key-0002"),
    { code: "DSAAS_PROFILE_NOT_APPROVED" },
  );
  await assert.rejects(
    context.service.createDataspace(dataspace({ dataspaceId: "unsafe-userinfo", namespaceBase: "https://user:password@data.molit.go.kr/id/" }), OPERATOR, "create-key-0003"),
    { code: "DSAAS_SECRET_MATERIAL_FORBIDDEN" },
  );
  await assert.rejects(
    context.service.createDataspace(dataspace({ dataspaceId: "unsafe-query", namespaceBase: "https://data.molit.go.kr/id/?view=1" }), OPERATOR, "create-key-0004"),
    { code: "DSAAS_URI_COMPONENT_FORBIDDEN" },
  );
});

test("audit events bind the principal, OAuth client, credential key and used role", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const state = await context.store.read();
  const event = state.audit.events.find(({ action }) => action === "dataspace.create");
  assert.deepEqual({
    actor: event.actor,
    actorPrincipalId: event.actorPrincipalId,
    actorClientId: event.actorClientId,
    actorKeyId: event.actorKeyId,
    actorRoles: event.actorRoles,
    actorUsedRole: event.actorUsedRole,
  }, {
    actor: "operator-1",
    actorPrincipalId: "operator-1",
    actorClientId: "operator-1-client",
    actorKeyId: "operator-1-key-1",
    actorRoles: ["dsaas.operator"],
    actorUsedRole: "dsaas.operator",
  });
  assert.equal(JSON.stringify(event).includes("Bearer"), false);
});

test("readiness reloads the approval registry and fails closed when refresh fails", async (t) => {
  let refreshes = 0;
  let available = true;
  const context = await fixture({
    approvalDecisionRegistryProvider() {
      refreshes += 1;
      if (!available) {
        const error = new Error("registry is unavailable");
        error.code = "DSAAS_APPROVAL_REGISTRY_DIGEST_MISMATCH";
        throw error;
      }
      return approvalRegistry();
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const ready = await context.service.readiness();
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.checks, { state: "READY", serviceRegistry: "READY", approvalRegistry: "READY", caas: "NOT_VERIFIED" });
  available = false;
  const blocked = await context.service.readiness();
  assert.equal(refreshes, 2);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.failureCodes, ["DSAAS_APPROVAL_REGISTRY_DIGEST_MISMATCH"]);
  assert.equal(blocked.checks.state, "READY");
  assert.equal(blocked.checks.approvalRegistry, "NOT_READY");
});

test("scheduled reconciliation suspends a connector after approval expiry", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  context.service.approvalDecisionRegistry.byId.get("decision:2026-001").validUntil = "2026-07-13T01:30:00Z";
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  t.after(() => scheduler.stop());
  await scheduler.start();
  await scheduler.waitForIdle();
  let state = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(state.participants["road-provider"].connector.state, "ACTIVE");
  const idempotencyCount = Object.keys((await context.store.read()).idempotency).length;

  context.setTime("2026-07-13T02:00:00Z");
  const tick = await scheduler.runOnce();
  assert.deepEqual(tick, {
    attempted: 1,
    blocked: 1,
    blockedCodes: ["DSAAS_APPROVAL_BLOCKED"],
    failed: 0,
    failureCodes: [],
    nextRetryAt: null,
    skipped: false,
    succeeded: 0,
  });
  state = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(state.observedState, "BLOCKED");
  assert.equal(state.participants["road-provider"].approvalState, "REAPPROVAL_REQUIRED");
  assert.equal(state.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(Object.keys((await context.store.read()).idempotency).length, idempotencyCount, "periodic runs must not consume the external idempotency registry");

  const audit = (await context.store.read()).audit.events.filter(({ action }) => action === "dataspace.reconcile.scheduled");
  assert.equal(audit.length, 3);
  assert.equal(audit.at(-1).actorPrincipalId, "system:dsaas-reconcile-scheduler");
  assert.equal(audit.at(-1).actorClientId, "molit-dsaas-control-plane");
  assert.equal(audit.at(-1).actorKeyId, "internal-reconcile-scheduler-v1");
  assert.equal(audit.at(-1).actorUsedRole, "dsaas.operator");
});

test("scheduler ticks before nextCheckAt do not call CaaS or grow durable state", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  t.after(() => scheduler.stop());
  await scheduler.start();
  await scheduler.waitForIdle();
  const statePath = join(context.directory, "state.json");
  const beforeBytes = await readFile(statePath, "utf8");
  const before = await context.store.read();
  assert.equal(context.observed.length, 1);
  assert.ok(Date.parse(before.dataspaces["molit-test"].nextCheckAt) > Date.parse(context.service.now()));

  const start = Date.parse(context.service.now());
  for (let tick = 1; tick <= 100; tick += 1) {
    context.setTime(new Date(start + tick * 60_000).toISOString());
    const result = await scheduler.runOnce();
    assert.equal(result.attempted, 0);
  }

  const after = await context.store.read();
  assert.equal(context.observed.length, 1);
  assert.equal(await readFile(statePath, "utf8"), beforeBytes);
  assert.equal(after.audit.events.length, before.audit.events.length);
  assert.equal(after.dataspaces["molit-test"].revision, before.dataspaces["molit-test"].revision);
  assert.equal(Object.keys(after.idempotency).length, Object.keys(before.idempotency).length);
});

test("service registry provider changes make a dataspace due before nextCheckAt", async (t) => {
  let currentRegistry = { ...registry(true), actualSha256: "1".repeat(64) };
  const context = await fixture({ serviceRegistryProvider: () => currentRegistry });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  t.after(() => scheduler.stop());
  await scheduler.start();
  await scheduler.waitForIdle();
  const active = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(active.observedState, "ACTIVE");
  assert.ok(Date.parse(active.nextCheckAt) > Date.parse(context.service.now()));

  currentRegistry = { ...registry(false), actualSha256: "2".repeat(64) };
  const tick = await scheduler.runOnce();
  assert.equal(tick.attempted, 1);
  const blocked = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(blocked.observedState, "BLOCKED");
  assert.equal(blocked.serviceRegistrySha256, "2".repeat(64));
  assert.equal(blocked.serviceObservations.every(({ effectiveStatus }) => effectiveStatus === "NOT_READY"), true);
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(context.observed.at(-1).request.desiredState, "SUSPENDED");

  currentRegistry = { ...registry(true), actualSha256: "3".repeat(64) };
  const recoveryTick = await scheduler.runOnce();
  assert.equal(recoveryTick.attempted, 1);
  const recovered = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(recovered.observedState, "ACTIVE");
  assert.equal(recovered.participants["road-provider"].connector.state, "ACTIVE");
  assert.equal(context.observed.at(-1).request.desiredState, "ACTIVE");
});

test("persistent service outage keeps 100 scheduler ticks free of targets, CaaS calls and durable writes", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const observedAt = context.service.now();
  context.service.serviceRegistry.issuedAt = observedAt;
  context.service.serviceRegistry.registry.issuedAt = observedAt;
  context.service.serviceRegistry.maxAgeSeconds = 60;
  for (const service of context.service.serviceRegistry.byId.values()) service.evidence.observedAt = observedAt;
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  t.after(() => scheduler.stop());
  await scheduler.start();
  await scheduler.waitForIdle();
  const active = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(active.observedState, "ACTIVE");
  assert.equal(active.nextCheckAt, "2026-07-13T01:03:03.001Z");

  context.setTime("2026-07-13T01:03:04Z");
  const tick = await scheduler.runOnce();
  assert.equal(tick.attempted, 1);
  const blocked = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(blocked.observedState, "BLOCKED");
  assert.equal(blocked.serviceObservations.every(({ effectiveStatus }) => effectiveStatus === "STALE"), true);
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(context.observed.at(-1).request.desiredState, "SUSPENDED");
  assert.equal(blocked.reconcilePending, true);
  assert.equal(blocked.nextCheckAt, "2026-07-14T00:00:00.001Z");

  const statePath = join(context.directory, "state.json");
  const blockedBytes = await readFile(statePath, "utf8");
  const blockedState = await context.store.read();
  const blockedAuditLength = blockedState.audit.events.length;
  const blockedRevision = blockedState.dataspaces["molit-test"].revision;
  const caasCalls = context.observed.length;
  const firstDueRetry = Date.parse("2026-07-13T01:05:04Z");
  for (let tickIndex = 0; tickIndex < 100; tickIndex += 1) {
    context.setTime(new Date(firstDueRetry + (tickIndex * 60_000)).toISOString());
    const unchanged = await scheduler.runOnce();
    assert.equal(unchanged.attempted, 0);
  }
  const retained = await context.store.read();
  assert.equal(context.observed.length, caasCalls);
  assert.equal(await readFile(statePath, "utf8"), blockedBytes);
  assert.equal(retained.audit.events.length, blockedAuditLength);
  assert.equal(retained.dataspaces["molit-test"].revision, blockedRevision);
});

test("persistent CaaS timeout uses durable jittered backoff and deduplicates 100 scheduler ticks", async (t) => {
  let calls = 0;
  const context = await fixture({
    caas: {
      async ensureConnector() {
        calls += 1;
        const error = new Error("provider text must not be persisted");
        error.code = "CAAS_TIMEOUT";
        throw error;
      },
    },
    caasRetryBaseMs: 60_000,
    caasRetryMaxMs: 480_000,
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  t.after(() => scheduler.stop());
  await scheduler.start();
  await scheduler.waitForIdle();
  const first = await context.store.read();
  const firstRecord = first.dataspaces["molit-test"];
  const firstParticipant = firstRecord.participants["road-provider"];
  assert.equal(calls, 1);
  assert.equal(firstRecord.caasRetry.attempt, 1);
  assert.equal(firstRecord.caasRetry.jitterPolicy, "stable-hash-75-100");
  assert.ok(firstRecord.caasRetry.jitterPermille >= 750 && firstRecord.caasRetry.jitterPermille <= 1000);
  assert.equal(firstRecord.caasRetry.delayMs, Math.floor((firstRecord.caasRetry.nominalDelayMs * firstRecord.caasRetry.jitterPermille) / 1000));
  assert.deepEqual(scheduler.readiness().lastFailureCodes, ["CAAS_TIMEOUT"]);
  assert.equal(scheduler.readiness().nextRetryAt, firstRecord.caasRetry.nextRetryAt);
  const firstErrorAt = firstParticipant.lastError.at;
  const participantRevision = firstParticipant.revision;
  const auditBeforeTicks = first.audit.events.length;
  const start = Date.parse(context.service.now());
  for (let tickIndex = 1; tickIndex <= 100; tickIndex += 1) {
    context.setTime(new Date(start + (tickIndex * 60_000)).toISOString());
    const tick = await scheduler.runOnce();
    assert.equal(tick.failed, 1);
    assert.deepEqual(tick.failureCodes, ["CAAS_TIMEOUT"]);
  }
  const retained = await context.store.read();
  const retainedRecord = retained.dataspaces["molit-test"];
  assert.ok(calls > 1 && calls < 20);
  assert.equal(retainedRecord.caasRetry.attempt, calls);
  assert.equal(retainedRecord.caasRetry.nominalDelayMs, 480_000);
  assert.ok(Date.parse(retainedRecord.caasRetry.nextRetryAt) > Date.parse(context.service.now()));
  assert.equal(retainedRecord.participants["road-provider"].revision, participantRevision);
  assert.equal(retainedRecord.participants["road-provider"].lastError.at, firstErrorAt);
  assert.ok(retained.audit.events.length - auditBeforeTicks < 20);
  assert.equal(JSON.stringify(retained).includes("provider text"), false);
});

test("scheduler migrates a legacy active record without nextCheckAt", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  await context.store.transact((state) => {
    const record = state.dataspaces["molit-test"];
    assert.equal(record.observedState, "ACTIVE");
    assert.equal(record.reconcilePending, false);
    delete record.nextCheckAt;
  });
  const callsBeforeMigration = context.observed.length;
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  t.after(() => scheduler.stop());
  await scheduler.start();
  await scheduler.waitForIdle();
  const migrated = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(context.observed.length, callsBeforeMigration + 1);
  assert.equal(migrated.observedState, "ACTIVE");
  assert.equal(migrated.reconcilePending, false);
  assert.ok(Date.parse(migrated.nextCheckAt) > Date.parse(context.service.now()));
});

test("reconcile scheduler skips an overlapping tick", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        entered.resolve();
        await release.promise;
        return { connectorId: request.caasTenantId, dataspaceId: request.dataspaceId, participantId: request.participantId, state: request.desiredState };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  t.after(() => release.resolve());
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });
  const first = scheduler.runOnce();
  await entered.promise;
  assert.deepEqual(await scheduler.runOnce(), { skipped: true, reason: "IN_PROGRESS" });
  assert.equal(scheduler.skippedOverlappingTicks, 1);
  release.resolve();
  assert.equal((await first).succeeded, 1);
});

test("scheduler start is bounded while the initial tick remains in progress", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: {
      async scheduledReconciliationTargets() {
        entered.resolve();
        await release.promise;
        return [];
      },
    },
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date("2026-07-13T01:02:03Z"),
  });
  t.after(() => release.resolve());
  t.after(() => scheduler.stop());
  await scheduler.start();
  await entered.promise;
  assert.equal(scheduler.readiness().status, "NOT_READY");
  release.resolve();
  await scheduler.waitForIdle();
  assert.equal(scheduler.readiness().status, "READY");
});

test("scheduler stop aborts CaaS and fences a late result from durable state", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  let requestSignal;
  const context = await fixture({
    caas: {
      async ensureConnector(request, _key, { signal } = {}) {
        calls += 1;
        requestSignal = signal;
        entered.resolve();
        await release.promise;
        return {
          connectorId: request.caasTenantId,
          dataspaceId: request.dataspaceId,
          participantId: request.participantId,
          state: request.desiredState,
        };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  t.after(() => release.resolve());
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const statePath = join(context.directory, "state.json");
  const before = await readFile(statePath, "utf8");
  const scheduler = new DsaasReconcileScheduler({
    controlPlane: context.service,
    config: { intervalMs: 60_000, maxDataspacesPerTick: 10, readinessMaxLagMs: 180_000 },
    clock: () => new Date(context.service.now()),
  });

  const tick = scheduler.runOnce();
  const rejected = assert.rejects(tick, { name: "AbortError" });
  await entered.promise;
  await scheduler.stop({ timeoutMs: 20 });

  assert.equal(calls, 1);
  assert.equal(requestSignal.aborted, true);
  assert.equal(await readFile(statePath, "utf8"), before);
  assert.deepEqual(await scheduler.runOnce(), { skipped: true, reason: "STOPPED" });
  assert.equal(calls, 1);

  release.resolve();
  await rejected;
  assert.equal(await readFile(statePath, "utf8"), before);
  assert.equal(calls, 1);
});

test("state transaction cancellation before atomic replace leaves durable bytes unchanged", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const statePath = join(context.directory, "state.json");
  const before = await readFile(statePath, "utf8");
  const controller = new AbortController();

  await assert.rejects(
    context.store.transact((state) => {
      state.dataspaces["molit-test"].spec.name = "must-not-commit";
      state.idempotency["abort-padding"] = { value: "x".repeat(1024 * 1024) };
      setImmediate(() => controller.abort());
    }, { signal: controller.signal }),
    { name: "AbortError" },
  );

  assert.equal(await readFile(statePath, "utf8"), before);
});

test("a durable reconciliation commit is not reported as aborted", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const controller = new AbortController();
  const durableStore = context.store;
  context.service.store = {
    read: durableStore.read.bind(durableStore),
    withResourceLock: durableStore.withResourceLock.bind(durableStore),
    async transact(operation, options) {
      const result = await durableStore.transact(operation, options);
      controller.abort();
      return result;
    },
  };

  const result = await context.service.reconcileScheduled("molit-test", "scheduler:commit-won", { signal: controller.signal });
  const persisted = await durableStore.read((state) => state.dataspaces["molit-test"]);
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.observedState, "ACTIVE");
  assert.equal(persisted.observedState, "ACTIVE");
  assert.equal(result.revision, persisted.revision);
  assert.equal(result.appliedGeneration, persisted.appliedGeneration);
});

test("participant approval enforces four eyes and evidence binding", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  const approval = { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) };
  await assert.rejects(
    context.service.approveParticipant("molit-test", "road-provider", approval, ADMIN_A, "approve-key-0001"),
    { code: "DSAAS_FOUR_EYES_REQUIRED" },
  );
  await assert.rejects(
    context.service.approveParticipant("molit-test", "road-provider", { ...approval, evidenceSha256: "d".repeat(64) }, ADMIN_B, "approve-key-0002"),
    { code: "DSAAS_APPROVAL_EVIDENCE_MISMATCH" },
  );
  const approved = await context.service.approveParticipant("molit-test", "road-provider", approval, ADMIN_B, "approve-key-0003");
  assert.equal(approved.approvalState, "APPROVED");
  assert.equal(approved.approval.approvedBy, "admin-b");
  assert.equal(approved.approval.externalDecision.registrySha256, "9".repeat(64));
});

test("participant approval replays from the ledger before refreshing the registry", async (t) => {
  const trusted = approvalRegistry();
  let registryAvailable = true;
  let registryLoads = 0;
  const context = await fixture({
    approvalDecisionRegistryProvider() {
      registryLoads += 1;
      if (!registryAvailable) {
        const error = new Error("registry unavailable after the committed approval");
        error.code = "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED";
        throw error;
      }
      return trusted;
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  const approval = { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) };
  const approved = await context.service.approveParticipant("molit-test", "road-provider", approval, ADMIN_B, "approve-key-0001");
  assert.equal(registryLoads, 1);

  registryAvailable = false;
  assert.deepEqual(
    await context.service.approveParticipant("molit-test", "road-provider", approval, ADMIN_B, "approve-key-0001"),
    approved,
  );
  assert.equal(registryLoads, 1, "an exact replay must not depend on current registry availability");
  await assert.rejects(
    context.service.approveParticipant("molit-test", "road-provider", approval, ADMIN_B, "approve-key-0002"),
    { code: "DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED" },
  );
  assert.equal(registryLoads, 2);
});

test("participant approval remains blocked without a trusted external decision adapter", async (t) => {
  const context = await fixture({ approvalStatus: "NOT_CONFIGURED" });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await assert.rejects(
    context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001"),
    { code: "DSAAS_EXTERNAL_APPROVAL_GATE_BLOCKED" },
  );
});

test("participant connector plan and technical identifiers are constrained", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await assert.rejects(
    context.service.submitParticipant("molit-test", participant({ connectorNamespace: "https://user:password@data.test.example/tenants/road-provider/" }), ADMIN_A, "submit-unsafe-url-0001"),
    { code: "DSAAS_SECRET_MATERIAL_FORBIDDEN" },
  );
  await assert.rejects(
    context.service.submitParticipant("molit-test", participant({ evidence: { uri: "urn:evidence:road-provider:1?view=1", sha256: "c".repeat(64) } }), ADMIN_A, "submit-unsafe-url-0002"),
    { code: "DSAAS_URI_COMPONENT_FORBIDDEN" },
  );
  await assert.rejects(
    context.service.submitParticipant("molit-test", participant({ connectorPlanId: "edc-virtualized" }), ADMIN_A, "submit-plan-key-0001"),
    { code: "DSAAS_CONNECTOR_PLAN_MISMATCH" },
  );
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await assert.rejects(
    context.service.submitParticipant("molit-test", participant({ participantId: "rail-provider", connectorParticipantId: "did:web:connectors.test.example:rail", connectorNamespace: "https://data.test.example/tenants/rail/" }), ADMIN_A, "submit-duplicate-tenant-0001"),
    { code: "DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT" },
  );
  await assert.rejects(
    context.service.submitParticipant("molit-test", participant({ participantId: "rail-provider", caasTenantId: "rail-tenant", connectorNamespace: "https://data.test.example/tenants/rail/" }), ADMIN_A, "submit-duplicate-participant-0001"),
    { code: "DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT" },
  );
  await assert.rejects(
    context.service.submitParticipant("molit-test", participant({ participantId: "rail-provider", caasTenantId: "rail-tenant", connectorParticipantId: "did:web:connectors.test.example:rail" }), ADMIN_A, "submit-duplicate-namespace-0001"),
    { code: "DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT" },
  );
  await context.service.createDataspace(dataspace({ dataspaceId: "molit-other", name: "두 번째 시험 데이터 스페이스" }), OPERATOR, "create-other-key-0001");
  await assert.rejects(
    context.service.submitParticipant("molit-other", participant({ participantId: "other-membership", connectorParticipantId: "did:web:connectors.test.example:other", connectorNamespace: "https://data.test.example/tenants/other/" }), OPERATOR, "submit-cross-dataspace-key-0001"),
    { code: "DSAAS_PARTICIPANT_IDENTIFIER_CONFLICT" },
  );
});

test("reconciliation activates only when trusted services and connector converge", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const result = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(result.observedState, "ACTIVE");
  assert.equal(result.participants["road-provider"].observedState, "ACTIVE");
  const replay = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.deepEqual(replay, result);
  assert.equal(context.observed.length, 1);
  assert.match(context.observed[0].key, /^dsaas:[a-f0-9]{64}$/u);
  assert.equal(context.observed[0].key, `dsaas:${digest({
    correlation: {
      caasTenantId: "road-provider-tenant",
      desiredGeneration: 2,
      connectorPlanId: "edc-isolated",
      intent: "DESIRED_STATE",
    },
    reconcileKey: "reconcile-key-0001",
    request: context.observed[0].request,
  })}`);
  assert.equal(context.observed[0].request.desiredGeneration, 2);
  const reobserved = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  assert.equal(reobserved.observedState, "ACTIVE");
  assert.equal(context.observed.length, 2);
  assert.notEqual(context.observed[1].key, context.observed[0].key, "a new reconcile execution gets a new CaaS idempotency key");
  assert.equal(context.observed[1].request.desiredGeneration, 2, "re-observation preserves the DSaaS generation fence");
});

test("missing or unhealthy required service blocks activation", async (t) => {
  const context = await fixture({ servicesReady: false });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const result = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(result.observedState, "BLOCKED");
});

test("a once-ready service is treated as stale after the registry freshness window", () => {
  const trusted = registry(true);
  trusted.maxAgeSeconds = 60;
  const result = evaluateRequiredServices(["caas-primary"], trusted, "2026-07-13T01:02:03Z");
  assert.equal(result.ready, false);
  assert.equal(result.registryFresh, false);
  assert.equal(result.services[0].effectiveStatus, "STALE");
});

test("CaaS secret-bearing observations are rejected and reduced to an error code", async (t) => {
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        return { connectorId: "bad", dataspaceId: request.dataspaceId, participantId: request.participantId, state: "ACTIVE", accessToken: "must-not-persist" };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const result = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(result.observedState, "RECONCILING");
  assert.equal(result.participants["road-provider"].lastError.code, "DSAAS_SECRET_MATERIAL_FORBIDDEN");
  assert.equal(result.participants["road-provider"].connector, null);
  assert.equal(result.participants["road-provider"].lastKnownConnector, null);
  assert.equal(JSON.stringify(result).includes("must-not-persist"), false);
});

test("CaaS ensure response rejects additional properties before persistence", async (t) => {
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        return {
          connectorId: request.caasTenantId,
          dataspaceId: request.dataspaceId,
          participantId: request.participantId,
          state: "ACTIVE",
          unexpected: "must-not-persist",
        };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const result = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(result.participants["road-provider"].connector, null);
  assert.equal(result.participants["road-provider"].lastError.code, "DSAAS_CAAS_RESPONSE_INVALID");
  assert.equal(JSON.stringify(result).includes("must-not-persist"), false);
});

test("CaaS endpoint observations reject query and fragment components", async (t) => {
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        return {
          connectorId: request.caasTenantId,
          dataspaceId: request.dataspaceId,
          participantId: request.participantId,
          state: "ACTIVE",
          endpoints: { connectorBase: "https://connector.test.example/?view=current" },
        };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const result = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(result.participants["road-provider"].connector, null);
  assert.equal(result.participants["road-provider"].lastError.code, "DSAAS_URI_COMPONENT_FORBIDDEN");
});

test("CaaS ensure response connectorId must equal the requested caasTenantId", async (t) => {
  let calls = 0;
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        calls += 1;
        return {
          connectorId: "different-tenant",
          dataspaceId: request.dataspaceId,
          participantId: request.participantId,
          state: "ACTIVE",
        };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const result = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(calls, 1);
  assert.equal(result.participants["road-provider"].connector, null);
  assert.equal(result.participants["road-provider"].lastError.code, "DSAAS_CAAS_RESPONSE_INVALID");
});

test("expired approval persists revocation intent before requesting CaaS suspension", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  context.service.approvalDecisionRegistry.byId.get("decision:2026-001").validUntil = "2026-07-13T01:30:00Z";
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const active = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(active.observedState, "ACTIVE");
  context.setTime("2026-07-13T02:00:00Z");
  const blocked = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  assert.equal(context.observed.length, 2);
  assert.equal(context.observed[1].request.desiredState, "SUSPENDED");
  assert.equal(blocked.observedState, "BLOCKED");
  assert.equal(blocked.reconcilePending, true);
  assert.equal(blocked.participants["road-provider"].approvalState, "REAPPROVAL_REQUIRED");
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(blocked.participants["road-provider"].lastKnownConnector.state, "ACTIVE");
  assert.equal(blocked.participants["road-provider"].lastError.code, "DSAAS_APPROVAL_DECISION_EXPIRED");
  assert.equal(blocked.participants["road-provider"].revokePending, false);
});

test("stale approval registry requests CaaS suspension and leaves the dataspace blocked", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  context.setTime("2026-07-14T00:00:01Z");
  const blocked = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  assert.equal(context.observed.length, 2);
  assert.equal(context.observed[1].request.desiredState, "SUSPENDED");
  assert.equal(blocked.observedState, "BLOCKED");
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(blocked.participants["road-provider"].lastError.code, "DSAAS_APPROVAL_REGISTRY_STALE");
  assert.equal(blocked.participants["road-provider"].revokePending, false);
});

test("replacement registry revocation requests CaaS suspension", async (t) => {
  let currentRegistry = approvalRegistry();
  let refreshes = 0;
  const context = await fixture({
    approvalDecisionRegistryProvider() {
      refreshes += 1;
      return currentRegistry;
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  const replacement = approvalRegistry();
  replacement.actualSha256 = "8".repeat(64);
  replacement.byId.get("decision:2026-001").status = "REVOKED";
  currentRegistry = replacement;
  const blocked = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  assert.equal(refreshes, 3, "approval and every reconcile must refresh the trusted registry snapshot");
  assert.equal(context.observed.length, 2);
  assert.equal(context.observed[1].request.desiredState, "SUSPENDED");
  assert.equal(blocked.observedState, "BLOCKED");
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(blocked.participants["road-provider"].lastKnownConnector.state, "ACTIVE");
  assert.equal(blocked.participants["road-provider"].lastError.code, "DSAAS_APPROVAL_DECISION_NOT_APPROVED");
  assert.equal(blocked.participants["road-provider"].revokePending, false);
});

test("a new trusted decision reapproves and reactivates a revoked participant", async (t) => {
  let currentRegistry = approvalRegistry();
  const context = await fixture({ approvalDecisionRegistryProvider: () => currentRegistry });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");

  const revoked = approvalRegistry();
  revoked.actualSha256 = "8".repeat(64);
  revoked.byId.get("decision:2026-001").status = "REVOKED";
  currentRegistry = revoked;
  const blocked = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  assert.equal(blocked.participants["road-provider"].approvalState, "REAPPROVAL_REQUIRED");
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");

  const renewed = approvalRegistry();
  const decision = { ...renewed.byId.get("decision:2026-001"), decisionId: "decision:2026-002", provenanceSha256: "7".repeat(64) };
  renewed.actualSha256 = "6".repeat(64);
  renewed.byId = new Map([[decision.decisionId, decision]]);
  currentRegistry = renewed;
  const reapproved = await context.service.approveParticipant("molit-test", "road-provider", {
    decisionId: "decision:2026-002",
    evidenceSha256: "c".repeat(64),
  }, ADMIN_B, "reapprove-key-0001");
  assert.equal(reapproved.approvalState, "APPROVED");
  assert.equal(reapproved.approval.decisionId, "decision:2026-002");

  const active = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0003");
  assert.deepEqual(context.observed.map(({ request }) => request.desiredState), ["ACTIVE", "SUSPENDED", "ACTIVE"]);
  assert.equal(active.observedState, "ACTIVE");
  assert.equal(active.participants["road-provider"].approvalState, "APPROVED");
  assert.equal(active.participants["road-provider"].approvalErrorCode, null);
  assert.equal(active.participants["road-provider"].revokePending, false);
});

test("revocation intent is durable before the CaaS suspension response", async (t) => {
  const suspendedCall = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        calls.push(request.desiredState);
        if (request.desiredState === "SUSPENDED") {
          suspendedCall.resolve();
          await release.promise;
        }
        return {
          connectorId: request.caasTenantId,
          dataspaceId: request.dataspaceId,
          participantId: request.participantId,
          state: request.desiredState,
        };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  t.after(() => release.resolve());
  context.service.approvalDecisionRegistry.byId.get("decision:2026-001").validUntil = "2026-07-13T01:30:00Z";
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  context.setTime("2026-07-13T02:00:00Z");
  const reconciliation = context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  await suspendedCall.promise;
  const pending = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(pending.observedState, "BLOCKED");
  assert.equal(pending.participants["road-provider"].connector, null);
  assert.equal(pending.participants["road-provider"].lastKnownConnector.state, "ACTIVE");
  assert.equal(pending.participants["road-provider"].observedState, "REVOKING");
  assert.equal(pending.participants["road-provider"].revokePending, true);
  release.resolve();
  const blocked = await reconciliation;
  assert.deepEqual(calls, ["ACTIVE", "SUSPENDED"]);
  assert.equal(blocked.participants["road-provider"].connector.state, "SUSPENDED");
  assert.equal(blocked.participants["road-provider"].revokePending, false);
});

test("a failed refresh clears the current connector and retains a separate last-known observation", async (t) => {
  let calls = 0;
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        calls += 1;
        if (calls > 1) {
          const error = new Error("provider supplied text must not be stored");
          error.code = "../../UNSAFE";
          throw error;
        }
        return { connectorId: "road-provider-tenant", dataspaceId: request.dataspaceId, participantId: request.participantId, state: "ACTIVE", endpoints: { connectorBase: "https://connector.test.example/" } };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const active = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0001");
  assert.equal(active.participants["road-provider"].connector.state, "ACTIVE");
  const failed = await context.service.reconcile("molit-test", ADMIN_A, "reconcile-key-0002");
  assert.equal(failed.participants["road-provider"].connector, null);
  assert.equal(failed.participants["road-provider"].lastKnownConnector.state, "ACTIVE");
  assert.equal(failed.participants["road-provider"].lastError.code, "CAAS_ERROR");
});

test("generation fencing re-applies the newest desired state after an interleaved write", async (t) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  const context = await fixture({
    caas: {
      async ensureConnector(request) {
        calls.push(request.desiredState);
        if (calls.length === 1) {
          started.resolve();
          await release.promise;
        }
        return { connectorId: "road-provider-tenant", dataspaceId: request.dataspaceId, participantId: request.participantId, state: request.desiredState };
      },
    },
  });
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  const reconciliation = context.service.reconcile("molit-test", ADMIN_A, "reconcile-race-key-0001");
  await started.promise;
  const current = await context.service.getDataspace("molit-test", ADMIN_A);
  await context.service.setDesiredState("molit-test", "SUSPENDED", current.revision, ADMIN_A, "suspend-race-key-0001");
  release.resolve();
  const result = await reconciliation;
  assert.deepEqual(calls, ["ACTIVE", "SUSPENDED"]);
  assert.equal(result.spec.desiredState, "SUSPENDED");
  assert.equal(result.observedState, "SUSPENDED");
  assert.equal(result.appliedGeneration, result.desiredGeneration);
  assert.equal(result.reconcilePending, false);
});

test("reconcile stops after a bounded number of supersessions and retains pending intent", async (t) => {
  let controlPlane;
  let calls = 0;
  const context = await fixture({
    maxReconcileSupersessions: 2,
    caas: {
      async ensureConnector(request) {
        calls += 1;
        const current = await controlPlane.getDataspace("molit-test", ADMIN_A);
        const next = current.spec.desiredState === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
        await controlPlane.setDesiredState("molit-test", next, current.revision, ADMIN_A, `contention-key-${calls.toString().padStart(4, "0")}`);
        return { connectorId: "road-provider-tenant", dataspaceId: request.dataspaceId, participantId: request.participantId, state: request.desiredState };
      },
    },
  });
  controlPlane = context.service;
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  await context.service.submitParticipant("molit-test", participant(), ADMIN_A, "submit-key-0001");
  await context.service.approveParticipant("molit-test", "road-provider", { decisionId: "decision:2026-001", evidenceSha256: "c".repeat(64) }, ADMIN_B, "approve-key-0001");
  await assert.rejects(
    context.service.reconcile("molit-test", ADMIN_A, "reconcile-contention-key-0001"),
    { code: "DSAAS_RECONCILE_SUPERSEDED" },
  );
  assert.equal(calls, 2);
  const retained = await context.service.getDataspace("molit-test", ADMIN_A);
  assert.equal(retained.reconcilePending, true);
  assert.equal(retained.observedState, "RECONCILING");
  assert.ok(retained.appliedGeneration < retained.desiredGeneration);
});

test("audit chain validation detects mutation", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const path = join(context.directory, "state.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  assert.doesNotThrow(() => validateDsaasState(state));
  state.audit.events[0].outcome = "tampered";
  await writeFile(path, JSON.stringify(state));
  await assert.rejects(context.store.read(), { code: "DSAAS_AUDIT_CHAIN_INVALID" });
  assert.notEqual(digest(state.audit.events[0]), state.audit.events[0].hash);
});

test("audit clock rollback is rejected without committing the mutation", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const created = await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  context.setTime("2026-07-13T01:02:02Z");
  await assert.rejects(
    context.service.setDesiredState("molit-test", "SUSPENDED", created.revision, OPERATOR, "rollback-key-0001"),
    { code: "DSAAS_CLOCK_ROLLBACK" },
  );
  context.setTime("2026-07-13T01:02:03Z");
  const retained = await context.service.getDataspace("molit-test", OPERATOR);
  assert.equal(retained.spec.desiredState, "ACTIVE");
  assert.equal(retained.revision, created.revision);
});

test("state snapshot integrity detects direct mutable-state tampering", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const path = join(context.directory, "state.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  state.dataspaces["molit-test"].spec.name = "변조된 이름";
  await writeFile(path, JSON.stringify(state));
  await assert.rejects(context.store.read(), { code: "DSAAS_STATE_SNAPSHOT_INVALID" });
});

test("state snapshot integrity rejects an audit log stripped from non-empty state", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  await context.service.createDataspace(dataspace(), OPERATOR, "create-key-0001");
  const path = join(context.directory, "state.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  state.audit = { head: null, events: [] };
  state.integrity.auditHead = null;
  await writeFile(path, JSON.stringify(state));
  await assert.rejects(context.store.read(), { code: "DSAAS_STATE_SNAPSHOT_INVALID" });
});

test("stale state locks are never removed automatically", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const lockPath = `${context.store.path}.lock`;
  await writeFile(lockPath, `${JSON.stringify({ pid: 2147483647, host: "stale-host", at: "2020-01-01T00:00:00Z" })}\n`);
  await assert.rejects(context.store.transact(() => null), { code: "DSAAS_STATE_LOCKED" });
  assert.match(await readFile(lockPath, "utf8"), /stale-host/u);
});
