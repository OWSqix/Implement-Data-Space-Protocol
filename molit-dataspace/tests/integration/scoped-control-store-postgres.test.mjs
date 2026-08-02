import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

import { RuntimeError } from "../../src/bridge-runtime/errors.mjs";
import { CaaSError } from "../../src/caas/errors.mjs";
import { recoverKubernetesOrphans } from "../../src/caas/orphan-recovery.mjs";
import { CaaSControlService } from "../../src/caas/service.mjs";
import { appendAudit, emptyCaasState, sealCaasState } from "../../src/caas/store.mjs";
import { encodeIdempotencyRecordKey } from "../../src/control-store/idempotency-record-key.mjs";
import { NormalizedControlProjection } from "../../src/control-store/normalized-projection.mjs";
import { PostgresOutbox } from "../../src/control-store/postgres-outbox.mjs";
import { PostgresScopedControlStore } from "../../src/control-store/postgres-scoped-control-store.mjs";
import { prepareScopedControlStoreCutover } from "../../src/control-store/scoped-cutover.mjs";
import { digest } from "../../src/discovery/stable-json.mjs";

const { Pool } = pg;
const connectionString = process.env.MOLIT_POSTGRES_INTEGRATION_URL;

function roleConnection(base, role, password) {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function createLogin(admin, component) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const role = `molit_${component}_scoped_${suffix}`;
  const password = `Scoped-${component}-${suffix}-9`;
  const quoted = await admin.query("SELECT quote_ident($1) AS role, quote_literal($2) AS password", [role, password]);
  await admin.query(`CREATE ROLE ${quoted.rows[0].role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoted.rows[0].password}`);
  return { password, quoted: quoted.rows[0].role, role };
}

async function grantRuntime(admin, login, component) {
  const shared = [
    "resource_fence", "resource_state", "idempotency_record", "audit_event", "outbox_event",
    "tenant_security_audit", "tenant_audit_head", "tenant_object_reference", "tenant_secret_reference",
    "tenant_metric_sample", "usage_meter_event", "usage_meter_rollup", "usage_meter_reprocess",
    "scoped_control_state", "control_scope_registry", "component_audit_head",
  ];
  await admin.query(`GRANT USAGE ON SCHEMA molit_control_store TO ${login.quoted}`);
  await admin.query(`GRANT SELECT ON molit_control_store.schema_migration, molit_control_store.control_store_mode TO ${login.quoted}`);
  await admin.query(`GRANT UPDATE (state_root_sha256, updated_at) ON molit_control_store.control_store_mode TO ${login.quoted}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${shared.map((name) => `molit_control_store.${name}`).join(", ")} TO ${login.quoted}`);
  if (component === "dsaas") {
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON molit_control_store.control_participant_registry TO ${login.quoted}`);
  }
  await admin.query(
    `GRANT EXECUTE ON FUNCTION molit_control_store.enroll_scoped_service_principal(text, text),
       molit_control_store.component_principal_active(text),
       molit_control_store.component_tenant_row_visible(text, text),
       molit_control_store.component_platform_row_visible(text)
     TO ${login.quoted}`,
  );
  await admin.query(
    `INSERT INTO molit_control_store.control_component_principal
       (database_role, component, active, approved_by, approval_reference)
     VALUES ($1, $2, true, 'integration-test', 'P0-SCOPED-COMPONENT')`,
    [login.role, component],
  );
  await admin.query(
    `INSERT INTO molit_control_store.tenant_database_principal
       (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
     VALUES ($1, 'molit-platform', 'service', true, NULL, 'integration-test', 'P0-SCOPED-PLATFORM')`,
    [login.role],
  );
  await admin.query(
    `INSERT INTO molit_control_store.tenant_database_principal
       (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
     SELECT $1::name, tenant_id, 'service', true, NULL, 'integration-test', 'P0-SCOPED-CUTOVER-SCOPE'
     FROM molit_control_store.control_scope_registry
     WHERE component = $2 AND tenant_id <> 'molit-platform'
     ON CONFLICT (database_role, tenant_id, access_mode) DO UPDATE SET active = true, valid_until = NULL`,
    [login.role, component],
  );
}

async function seedLegacyProjection({ admin, component, state, revision, updatedAt }) {
  const login = await createLogin(admin, `${component}_legacy`);
  const tables = [
    "json_snapshot", "resource_fence", "projection_checkpoint", "projection_tenant_registry",
    "resource_state", "idempotency_record", "audit_event", "outbox_event", "tenant_secret_reference",
  ];
  await admin.query(`GRANT USAGE ON SCHEMA molit_control_store TO ${login.quoted}`);
  await admin.query(`GRANT SELECT ON molit_control_store.schema_migration TO ${login.quoted}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tables.map((name) => `molit_control_store.${name}`).join(", ")} TO ${login.quoted}`);
  await admin.query(`GRANT EXECUTE ON FUNCTION molit_control_store.enroll_current_service_principal(text, text) TO ${login.quoted}`);
  await admin.query(
    `INSERT INTO molit_control_store.control_component_principal
       (database_role, component, active, approved_by, approval_reference)
     VALUES ($1, $2, true, 'integration-test', 'P0-LEGACY-PROJECTION')`,
    [login.role, component],
  );
  await admin.query(
    `INSERT INTO molit_control_store.tenant_database_principal
       (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
     VALUES ($1, 'molit-platform', 'service', true, NULL, 'integration-test', 'P0-LEGACY-PROJECTION')`,
    [login.role],
  );
  const pool = new Pool({ connectionString: roleConnection(connectionString, login.role, login.password), max: 1, ssl: false });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('molit.trace_id', $1, true),
              set_config('molit.correlation_id', 'legacy-projection-seed', true)`,
      ["1".repeat(32)],
    );
    const projection = new NormalizedControlProjection({ component });
    await projection.verifyMigration(client);
    await projection.apply({ client, nextState: state, snapshotRevision: revision, now: updatedAt });
    await client.query("SELECT set_config('molit.tenant_id', 'molit-platform', true)");
    await client.query(
      `INSERT INTO molit_control_store.json_snapshot (component, revision, state, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
      [component, revision, JSON.stringify(state), updatedAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  return login;
}

function appendCaasAudit(state, tenantId, action) {
  const occurredAt = new Date().toISOString();
  const unsigned = {
    sequence: state.audit.length + 1,
    previousDigest: state.audit.at(-1)?.eventDigest ?? null,
    occurredAt,
    tenantId,
    action,
    actorRole: "admin",
    actorPrincipalId: "urn:molit:principal:scoped-integration",
    actorClientId: "molit-scoped-integration",
    actorKeyId: "scoped-integration-key-v1",
  };
  state.audit.push({ ...unsigned, eventDigest: digest(unsigned) });
}

function createOperation(tenantId, identity, key, request) {
  return (state) => {
    const recordKey = encodeIdempotencyRecordKey(`register:${tenantId}`, key);
    const requestDigest = digest(request);
    const prior = state.requests[recordKey];
    if (prior) {
      if (prior.payloadDigest !== requestDigest) throw new RuntimeError("CAAS_IDEMPOTENCY_CONFLICT", "idempotency key input changed");
      return prior.result;
    }
    if (state.tenants[tenantId]) throw new RuntimeError("CAAS_TENANT_EXISTS", "tenant already exists");
    const payload = { tenantId, ...identity, generation: 0 };
    state.tenants[tenantId] = payload;
    state.requests[recordKey] = { scopeId: tenantId, payloadDigest: requestDigest, result: { tenantId } };
    appendCaasAudit(state, tenantId, "TENANT_REGISTERED");
    return { tenantId };
  };
}

function createDsaasOperation(dataspaceId) {
  return (state) => {
    state.dataspaces[dataspaceId] = {
      spec: { dataspaceId },
      participants: {},
      revision: 1,
    };
    const at = new Date().toISOString();
    const event = {
      sequence: state.audit.events.length + 1,
      at,
      actor: "system:dsaas-integration",
      actorPrincipalId: "system:dsaas-integration",
      actorClientId: "molit-dsaas-integration",
      actorKeyId: "dsaas-integration-key-v1",
      actorRoles: ["system"],
      actorUsedRole: "system",
      action: "dataspace.test.create",
      resource: `dataspace:${dataspaceId}`,
      outcome: "accepted",
      detailsDigest: null,
      previousHash: state.audit.head,
    };
    event.hash = digest(event);
    state.audit.events.push(event);
    state.audit.head = event.hash;
    return { dataspaceId };
  };
}

test("P0 scoped authoritative store cuts over losslessly and enforces runtime isolation", {
  skip: !connectionString,
  timeout: 90_000,
}, async (t) => {
  const admin = new Pool({ connectionString, max: 8, ssl: false });
  await admin.query("DROP SCHEMA IF EXISTS molit_control_store CASCADE");
  for (const name of ["001_control_store.sql", "002_normalized_projection.sql", "003_usage_metering.sql"]) {
    await admin.query(await readFile(new URL(`../../deploy/control-store/postgres/${name}`, import.meta.url), "utf8"));
  }
  await admin.query(
    `CREATE TABLE molit_control_store.control_store_mode (
       component text PRIMARY KEY CHECK (component IN ('caas', 'dsaas')),
       mode text NOT NULL CHECK (mode IN ('projection', 'scoped-authoritative')),
       source_kind text CHECK (source_kind IS NULL OR source_kind IN ('json-snapshot', 'fresh-install', 'legacy-file-snapshot')),
       source_snapshot_revision bigint CHECK (source_snapshot_revision IS NULL OR source_snapshot_revision > 0),
       source_snapshot_sha256 text CHECK (source_snapshot_sha256 IS NULL OR source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
       source_approval_evidence_sha256 text,
       scope_map_sha256 text,
       scope_map_approval_evidence_sha256 text,
       legacy_key_conversion_count integer NOT NULL DEFAULT 0,
       state_root_sha256 text,
       cutover_at timestamptz,
       updated_at timestamptz NOT NULL,
       CONSTRAINT control_store_mode_cutover_root_check CHECK (
         (mode = 'projection' AND source_kind IS NULL AND cutover_at IS NULL)
         OR (mode = 'scoped-authoritative' AND source_snapshot_revision IS NOT NULL
           AND source_kind IS NOT NULL AND source_snapshot_sha256 IS NOT NULL
           AND state_root_sha256 IS NOT NULL AND cutover_at IS NOT NULL)
       )
     )`,
  );
  await admin.query(
    `INSERT INTO molit_control_store.control_store_mode
       (component, mode, source_kind, source_snapshot_revision, source_snapshot_sha256,
        state_root_sha256, cutover_at, updated_at)
     VALUES
       ('caas', 'scoped-authoritative', 'fresh-install', 1, repeat('a', 64), repeat('b', 64), now(), now()),
       ('dsaas', 'projection', NULL, NULL, NULL, NULL, NULL, now())`,
  );
  const migration4 = await readFile(new URL("../../deploy/control-store/postgres/004_authoritative_scoped_state.sql", import.meta.url), "utf8");
  await assert.rejects(admin.query(migration4), (error) => error.code === "23514");
  assert.equal((await admin.query(
    `SELECT count(*)::integer AS count FROM information_schema.columns
     WHERE table_schema = 'molit_control_store' AND table_name = 'control_store_mode'
       AND column_name = 'cutover_state_root_sha256'`,
  )).rows[0].count, 0);
  await admin.query(
    `UPDATE molit_control_store.control_store_mode
     SET mode = 'projection', source_kind = NULL, source_snapshot_revision = NULL,
         source_snapshot_sha256 = NULL, state_root_sha256 = NULL, cutover_at = NULL
     WHERE component = 'caas'`,
  );
  await admin.query(migration4);
  const upgradedConstraint = (await admin.query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
     WHERE conrelid = 'molit_control_store.control_store_mode'::regclass
       AND conname = 'control_store_mode_cutover_root_check'`,
  )).rows[0].definition;
  assert.match(upgradedConstraint, /cutover_state_root_sha256/u);

  const legacyCaasTenantId = "legacy-caas-tenant";
  const legacyCaasState = emptyCaasState();
  const legacyPlan = { adapterId: "legacy-adapter", runtimeProfileRef: "urn:legacy:runtime" };
  legacyCaasState.tenants[legacyCaasTenantId] = {
    tenantId: legacyCaasTenantId,
    organizationId: "urn:molit:organization:legacy-caas",
    displayName: "Legacy CaaS tenant",
    participantId: "did:web:legacy.example",
    namespace: "https://legacy.example/ns/",
    endpoint: "https://legacy.example/protocol/",
    adapterId: "legacy-adapter",
    runtimeProfileRef: "urn:legacy:runtime",
    connectorPlanId: "legacy-plan",
    connectorPlanSnapshot: legacyPlan,
    connectorPlanDigest: digest(legacyPlan),
    connectorVersionHistory: [],
    apiAccessSecretRef: "env://LEGACY_CAAS_TOKEN",
    apiPrincipalId: "urn:molit:principal:legacy-caas",
    apiClientId: "legacy-caas-client",
    apiKeyId: "legacy-caas-key-v1",
    deploymentSecretRefs: { vaultAccess: "vault://tenant/legacy/vault" },
    desiredState: "DEPROVISIONED",
    observedState: "NOT_PROVISIONED",
    generation: 0,
    observedGeneration: 0,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  const legacyNulKey = `register:${legacyCaasTenantId}\u0000legacy-register-key`;
  legacyCaasState.requests[legacyNulKey] = {
    payloadDigest: "9".repeat(64),
    completedAt: "2026-07-14T00:00:00.000Z",
    result: { tenantId: legacyCaasTenantId },
  };
  appendAudit(legacyCaasState, {
    tenantId: legacyCaasTenantId,
    action: "TENANT_REGISTERED",
    actorRole: "admin",
    actorPrincipalId: "urn:molit:principal:legacy-import",
    actorClientId: "legacy-import-client",
    actorKeyId: "legacy-import-key-v1",
  }, { maxAuditEvents: 100, now: new Date("2026-07-14T00:00:00.000Z") });
  sealCaasState(legacyCaasState, { maxAuditEvents: 100, now: new Date("2026-07-14T00:00:00.001Z") });
  const caasCutover = await prepareScopedControlStoreCutover({
    pool: admin,
    component: "caas",
    legacySource: {
      schemaVersion: "molit.control-store-legacy-source/1",
      component: "caas",
      revision: 1,
      updatedAt: "2026-07-14T00:00:00.001Z",
      state: legacyCaasState,
      sourceArtifactSha256: digest(legacyCaasState),
      approvedBy: "urn:molit:approver:legacy-import",
      approvedAt: "2026-07-14T00:00:01.000Z",
      approvalEvidenceSha256: "8".repeat(64),
    },
  });
  assert.equal(caasCutover.sourceKind, "legacy-file-snapshot");
  assert.equal(caasCutover.legacyKeyConversionCount, 1);
  const convertedLegacyKey = (await admin.query(
    "SELECT record_key FROM molit_control_store.idempotency_record WHERE component = 'caas' AND tenant_id = $1",
    [legacyCaasTenantId],
  )).rows[0].record_key;
  assert.equal(convertedLegacyKey.includes("\u0000"), false);
  assert.match(convertedLegacyKey, /^v1\./u);

  const legacyDataspaceId = "legacy-road-space";
  const legacyRecordKey = "legacy-participant-submit-key";
  const legacyParticipant = {
    spec: {
      caasTenantId: "legacy-road-tenant",
      connectorParticipantId: "did:web:connector.example:legacy-road",
      connectorNamespace: "https://connector.example/legacy-road/",
    },
  };
  const legacyState = {
    schemaVersion: "molit.dsaas-state/1",
    dataspaces: {
      [legacyDataspaceId]: {
        spec: { dataspaceId: legacyDataspaceId },
        participants: { "legacy-participant": legacyParticipant },
      },
    },
    idempotency: {
      [legacyRecordKey]: {
        at: "2026-07-14T00:00:00.000Z",
        requestDigest: "a".repeat(64),
        response: legacyParticipant,
      },
    },
    audit: { head: null, events: [] },
    integrity: null,
  };
  const legacyProjectionLogin = await seedLegacyProjection({
    admin,
    component: "dsaas",
    state: legacyState,
    revision: 1,
    updatedAt: "2026-07-14T00:00:00.000Z",
  });

  await assert.rejects(prepareScopedControlStoreCutover({ pool: admin, component: "dsaas" }), { code: "CONTROL_CUTOVER_SCOPE_UNRESOLVED" });
  const scopeMap = {
    schemaVersion: "molit.control-store-scope-map/1",
    component: "dsaas",
    sourceSnapshotSha256: digest(legacyState),
    approvedBy: "urn:molit:approver:integration",
    approvedAt: "2026-07-14T00:01:00.000Z",
    approvalEvidenceSha256: "b".repeat(64),
    assignments: { [legacyRecordKey]: legacyDataspaceId },
  };
  const dsaasCutover = await prepareScopedControlStoreCutover({ pool: admin, component: "dsaas", approvedScopeMap: scopeMap });
  assert.equal(dsaasCutover.sourceKind, "json-snapshot");
  assert.equal((await admin.query(
    "SELECT tenant_id FROM molit_control_store.idempotency_record WHERE component = 'dsaas' AND record_key = $1",
    [legacyRecordKey],
  )).rows[0].tenant_id, legacyDataspaceId);
  assert.equal((await prepareScopedControlStoreCutover({ pool: admin, component: "dsaas" })).alreadyCutover, true);
  await admin.query("DELETE FROM molit_control_store.control_component_principal WHERE database_role = $1", [legacyProjectionLogin.role]);
  await admin.query("DELETE FROM molit_control_store.tenant_database_principal WHERE database_role = $1", [legacyProjectionLogin.role]);
  await admin.query(`DROP OWNED BY ${legacyProjectionLogin.quoted}`);
  await admin.query(`DROP ROLE ${legacyProjectionLogin.quoted}`);

  const caasLogin = await createLogin(admin, "caas");
  const dsaasLogin = await createLogin(admin, "dsaas");
  await grantRuntime(admin, caasLogin, "caas");
  await grantRuntime(admin, dsaasLogin, "dsaas");
  const caasUrl = roleConnection(connectionString, caasLogin.role, caasLogin.password);
  const dsaasUrl = roleConnection(connectionString, dsaasLogin.role, dsaasLogin.password);
  const caasPool = new Pool({ connectionString: caasUrl, max: 6, ssl: false });
  const caasLeasePool = new Pool({ connectionString: caasUrl, max: 2, ssl: false });
  const dsaasPool = new Pool({ connectionString: dsaasUrl, max: 3, ssl: false });
  const dsaasLeasePool = new Pool({ connectionString: dsaasUrl, max: 1, ssl: false });
  const pools = [caasPool, caasLeasePool, dsaasPool, dsaasLeasePool];
  const caasStore = new PostgresScopedControlStore({
    pool: caasPool,
    leasePool: caasLeasePool,
    component: "caas",
    holderId: "caas-scoped-integration",
    maxScopes: 5,
    maxAuditEvents: 100,
    maxIdempotencyRecords: 100,
    codes: { capacity: "CAAS_CAPACITY", conflict: "CAAS_IDENTITY_COLLISION" },
    preserveError: (error) => error instanceof CaaSError,
  });
  const dsaasStore = new PostgresScopedControlStore({
    pool: dsaasPool,
    leasePool: dsaasLeasePool,
    component: "dsaas",
    holderId: "dsaas-scoped-integration",
    maxScopes: 10,
    maxAuditEvents: 100,
    maxIdempotencyRecords: 100,
  });
  await caasStore.initialize();
  await dsaasStore.initialize();
  t.after(async () => {
    await Promise.allSettled([caasStore.close(), dsaasStore.close(), ...pools.map((pool) => pool.end())]);
    for (const login of [caasLogin, dsaasLogin]) {
      await admin.query(`DROP OWNED BY ${login.quoted}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${login.quoted}`).catch(() => {});
    }
    await admin.end();
  });

  for (const statement of ["SELECT * FROM molit_control_store.json_snapshot", "UPDATE molit_control_store.json_snapshot SET revision = revision + 1"]) {
    await assert.rejects(caasPool.query(statement), (error) => error.code === "42501");
  }
  await assert.rejects(caasPool.query("SELECT molit_control_store.enroll_current_service_principal('forged-tenant', 'caas')"),
    (error) => error.code === "42501");

  const caasConfig = {
    environment: "production",
    identityPolicy: {
      participantIdTemplate: "did:web:example:{tenantId}",
      namespaceTemplate: "https://data.example/{tenantId}/",
      endpointTemplate: "https://connector.example/{tenantId}/",
    },
    limits: { maxStateBytes: 1_048_576, maxTenants: 5, maxIdempotencyRecords: 100, maxAuditEvents: 100, maxAuditResponseEvents: 50 },
    connectorPlans: {
      standard: {
        adapterId: "test-adapter",
        runtimeProfileRef: "urn:profile:edc",
        deploymentMode: "isolated",
        metadataProfile: { iri: "https://profiles.example/metadata", version: "1", sha256: "d".repeat(64) },
        protocolProfile: { dspVersion: "2025-1", specification: "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/", identityMode: "dcp" },
        requiredDeploymentSecretNames: ["vaultAccess"],
      },
    },
  };
  const caasService = new CaaSControlService({ config: caasConfig, provisioners: { "test-adapter": {} }, store: caasStore });
  const alphaRegistration = {
    schemaVersion: "molit.caas-tenant-registration/1",
    tenantId: "tenant-alpha",
    organizationId: "urn:organization:tenant-alpha",
    displayName: "Tenant Alpha",
    adapterId: "test-adapter",
    runtimeProfileRef: "urn:profile:edc",
    apiAccessSecretRef: "env://TENANT_ALPHA_TOKEN",
    apiPrincipalId: "urn:molit:principal:tenant-alpha",
    apiClientId: "tenant-alpha-client",
    apiKeyId: "tenant-alpha-key-v1",
    deploymentSecretRefs: { vaultAccess: "vault://tenant/alpha/vault" },
  };
  const adminActor = { role: "admin", principalId: "urn:molit:principal:integration-admin", clientId: "integration-admin-client", keyId: "integration-admin-key-v1" };
  const alpha = await caasService.register(alphaRegistration, "same-key-0001", adminActor);
  assert.deepEqual(await caasService.register(alphaRegistration, "same-key-0001", adminActor), alpha);
  await assert.rejects(caasService.register({ ...alphaRegistration, displayName: "Changed Alpha" }, "same-key-0001", adminActor),
    { code: "CAAS_IDEMPOTENCY_CONFLICT" });
  const storedKey = (await admin.query(
    "SELECT record_key FROM molit_control_store.idempotency_record WHERE component = 'caas' AND tenant_id = 'tenant-alpha'",
  )).rows[0].record_key;
  assert.equal(storedKey.includes("\u0000"), false);
  assert.match(storedKey, /^v1\./u);

  await assert.rejects(caasStore.createScope("tenant-failure", () => {
    throw new RuntimeError("INJECTED_FAILURE", "injected before commit");
  }, { capacity: 3 }), { code: "INJECTED_FAILURE" });
  assert.equal(await caasStore.scopeExists("tenant-failure"), false);

  await caasStore.createScope("tenant-bravo", createOperation("tenant-bravo", {
    participantId: "did:web:bravo.example", namespace: "https://bravo.example/ns/", endpoint: "https://bravo.example/protocol/",
  }, "bravo-key-0001", { displayName: "Bravo" }), { capacity: 5 });
  const sharedIdentity = { participantId: "did:web:shared.example", namespace: "https://shared.example/ns/", endpoint: "https://shared.example/protocol/" };
  const collision = await Promise.allSettled([
    caasStore.createScope("tenant-charlie", createOperation("tenant-charlie", sharedIdentity, "charlie-key-01", { displayName: "Charlie" }), { capacity: 5 }),
    caasStore.createScope("tenant-delta", createOperation("tenant-delta", sharedIdentity, "delta-key-0001", { displayName: "Delta" }), { capacity: 5 }),
  ]);
  assert.equal(collision.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(collision.filter(({ status }) => status === "rejected")[0].reason.code, "CAAS_IDENTITY_COLLISION");
  await assert.rejects(caasStore.createScope("tenant-echo", createOperation("tenant-echo", {
    participantId: "did:web:echo.example", namespace: "https://echo.example/ns/", endpoint: "https://echo.example/protocol/",
  }, "echo-key-00001", { displayName: "Echo" }), { capacity: 4 }), { code: "CAAS_CAPACITY" });

  const alphaState = await caasStore.readScope("tenant-alpha", (state) => state);
  assert.deepEqual(Object.keys(alphaState.tenants), ["tenant-alpha"]);
  await assert.rejects(caasStore.transactScope("tenant-alpha", (state) => {
    state.tenants["tenant-bravo"] = {};
    appendCaasAudit(state, "tenant-alpha", "MALICIOUS_CROSS_SCOPE_WRITE");
  }), { code: "SCOPED_STORE_INVALID" });

  const reclaimed = [];
  const recovery = await recoverKubernetesOrphans({
    config: caasConfig,
    store: caasStore,
    provisioners: {
      "test-adapter": {
        async listOrphans(activeTenantIds) {
          assert.deepEqual(activeTenantIds, ["tenant-alpha"]);
          return ["orphan-zulu"];
        },
        async reclaimOrphan(tenantId, options) {
          reclaimed.push({ fencingToken: options.fencingToken, tenantId });
          return { fencingToken: options.fencingToken, reclaimed: true, tenantId };
        },
      },
    },
  });
  assert.equal(recovery.receipts[0].reclaimed, true);
  assert.equal(reclaimed[0].tenantId, "orphan-zulu");
  assert.equal((await admin.query(
    `SELECT count(*)::integer AS count FROM molit_control_store.audit_event
     WHERE component = 'caas' AND tenant_id = 'molit-platform'
       AND event->>'action' = 'KUBERNETES_ORPHAN_RECLAIMED'
       AND event->>'orphanTenantId' = 'orphan-zulu'`,
  )).rows[0].count, 1);

  const direct = await caasPool.connect();
  try {
    await direct.query("BEGIN READ ONLY");
    await direct.query(
      `SELECT set_config('molit.tenant_id', 'tenant-alpha', true),
              set_config('molit.actor_id', 'service:caas-scoped-store', true),
              set_config('molit.access_mode', 'service', true),
              set_config('molit.trace_id', $1, true),
              set_config('molit.correlation_id', 'direct-isolation-check', true)`,
      ["c".repeat(32)],
    );
    assert.deepEqual((await direct.query("SELECT tenant_id FROM molit_control_store.scoped_control_state WHERE component = 'caas' ORDER BY tenant_id")).rows,
      [{ tenant_id: "tenant-alpha" }]);
    assert.equal((await direct.query("SELECT count(*)::integer AS count FROM molit_control_store.scoped_control_state WHERE component = 'dsaas'")).rows[0].count, 0);
    await direct.query("COMMIT");
  } finally { direct.release(); }

  const committed = await admin.query(
    `SELECT
       (SELECT count(*)::integer FROM molit_control_store.audit_event WHERE component = 'caas') AS audit_count,
       (SELECT count(*)::integer FROM molit_control_store.outbox_event WHERE component = 'caas' AND event_type = 'audit.appended') AS outbox_count,
       (SELECT count(*)::integer FROM molit_control_store.outbox_event WHERE component = 'caas' AND event_type IN ('resource.upserted', 'resource.deleted')) AS generic_count,
       (SELECT count(*)::integer FROM molit_control_store.scoped_control_state WHERE component = 'caas') AS scope_count`,
  );
  assert.equal(committed.rows[0].audit_count, committed.rows[0].outbox_count);
  assert.equal(committed.rows[0].generic_count, 0);
  assert.equal(committed.rows[0].scope_count, 4);
  const roots = (await admin.query(
    `SELECT mode.cutover_state_root_sha256, mode.state_root_sha256,
            head.state_root_sha256 AS audit_state_root_sha256
     FROM molit_control_store.control_store_mode mode
     JOIN molit_control_store.component_audit_head head ON head.component = mode.component
     WHERE mode.component = 'caas'`,
  )).rows[0];
  assert.equal(roots.cutover_state_root_sha256, caasCutover.stateRootSha256);
  assert.equal(roots.state_root_sha256, roots.audit_state_root_sha256);
  assert.notEqual(roots.state_root_sha256, roots.cutover_state_root_sha256);

  await dsaasStore.createScope("tenant-alpha", createDsaasOperation("tenant-alpha"), { capacity: 10 });
  const caasComponentCheck = await caasPool.connect();
  try {
    await caasComponentCheck.query("BEGIN READ ONLY");
    await caasComponentCheck.query(
      `SELECT set_config('molit.tenant_id', 'tenant-alpha', true),
              set_config('molit.actor_id', 'service:caas-scoped-store', true),
              set_config('molit.access_mode', 'service', true),
              set_config('molit.trace_id', $1, true),
              set_config('molit.correlation_id', 'same-scope-caas-component-check', true)`,
      ["f".repeat(32)],
    );
    assert.equal((await caasComponentCheck.query(
      "SELECT count(*)::integer AS count FROM molit_control_store.scoped_control_state WHERE component = 'caas' AND tenant_id = 'tenant-alpha'",
    )).rows[0].count, 1);
    assert.equal((await caasComponentCheck.query(
      "SELECT count(*)::integer AS count FROM molit_control_store.scoped_control_state WHERE component = 'dsaas' AND tenant_id = 'tenant-alpha'",
    )).rows[0].count, 0);
    await caasComponentCheck.query("COMMIT");
  } finally { caasComponentCheck.release(); }
  const componentCheck = await dsaasPool.connect();
  try {
    await componentCheck.query("BEGIN READ ONLY");
    await componentCheck.query(
      `SELECT set_config('molit.tenant_id', 'tenant-alpha', true),
              set_config('molit.actor_id', 'service:dsaas-scoped-store', true),
              set_config('molit.access_mode', 'service', true),
              set_config('molit.trace_id', $1, true),
              set_config('molit.correlation_id', 'same-scope-component-check', true)`,
      ["e".repeat(32)],
    );
    assert.equal((await componentCheck.query(
      "SELECT count(*)::integer AS count FROM molit_control_store.scoped_control_state WHERE component = 'dsaas' AND tenant_id = 'tenant-alpha'",
    )).rows[0].count, 1);
    await componentCheck.query("COMMIT");
  } finally { componentCheck.release(); }

  const outbox = new PostgresOutbox({
    pool: caasPool,
    component: "caas",
    workerId: "scoped-outbox-integration",
    eventTypes: ["audit.appended"],
    tenantService: { actorId: "service:caas-worm-dispatcher", discoverFromRegistry: true, registryMode: "scoped-authoritative" },
  });
  const claimed = await outbox.claim({ limit: 50, leaseMs: 30_000 });
  assert.equal(claimed.length, committed.rows[0].outbox_count);
  assert.equal(claimed.some(({ tenantId }) => tenantId === "tenant-alpha"), true);
  assert.equal(claimed.some(({ tenantId }) => tenantId === "tenant-bravo"), true);
  assert.equal(claimed.some(({ tenantId }) => tenantId === "molit-platform"), true);
  const alphaEvent = claimed.find(({ tenantId }) => tenantId === "tenant-alpha");
  await assert.rejects(outbox.acknowledge(alphaEvent.eventId, { sink: "integration" }, { tenantId: "tenant-bravo" }),
    { code: "OUTBOX_CLAIM_LOST" });
  for (const event of claimed) {
    await outbox.acknowledge(event.eventId, { sink: "integration", tenantId: event.tenantId }, { tenantId: event.tenantId });
  }
});
