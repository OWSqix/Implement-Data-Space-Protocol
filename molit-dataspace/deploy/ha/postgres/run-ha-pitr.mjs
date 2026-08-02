#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const exec = promisify(execFile);
const IMAGE = "postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const PREFIX = `molit-ha-${process.pid}-${randomBytes(4).toString("hex")}`;
const RESOURCE = /^molit-ha-[a-z0-9-]+$/u;
const ADMIN_USER = "molit_admin";
const DATABASE = "molit";
const REPLICATION_USER = "molit_replicator";
const ADMIN_PASSWORD = randomBytes(24).toString("hex");
const REPLICATION_PASSWORD = randomBytes(24).toString("hex");
const startedAt = new Date().toISOString();
const migrationPaths = ["001_control_store.sql", "002_normalized_projection.sql", "003_usage_metering.sql", "004_authoritative_scoped_state.sql"]
  .map((name) => fileURLToPath(new URL(`../../control-store/postgres/${name}`, import.meta.url)));
const reportSchema = JSON.parse(await readFile(new URL("../../../contracts/postgres-ha-pitr-run.v1.schema.json", import.meta.url), "utf8"));
const reportValidator = addFormats(new Ajv2020({ allErrors: true, strict: true })).compile(reportSchema);
const resources = {
  archive: `${PREFIX}-archive`,
  network: `${PREFIX}-network`,
  pitr: `${PREFIX}-pitr`,
  pitrContainer: `${PREFIX}-pitr-node`,
  primary: `${PREFIX}-primary`,
  primaryData: `${PREFIX}-primary-data`,
  standby: `${PREFIX}-standby`,
  standbyData: `${PREFIX}-standby-data`,
};

for (const value of Object.values(resources)) {
  if (!RESOURCE.test(value)) throw new Error(`unsafe Docker resource name: ${value}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function command(program, args, { allowFailure = false, timeout = 120_000 } = {}) {
  try {
    const result = await exec(program, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout, windowsHide: true });
    return { code: 0, stderr: result.stderr.trim(), stdout: result.stdout.trim() };
  } catch (error) {
    if (allowFailure) {
      return { code: Number.isInteger(error.code) ? error.code : 1, stderr: String(error.stderr ?? error.message).trim(), stdout: String(error.stdout ?? "").trim() };
    }
    throw new Error(`${program} failed: ${String(error.stderr ?? error.message).trim()}`, { cause: error });
  }
}

const docker = (args, options) => command("docker", args, options);

async function waitFor(description, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) { last = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${description} did not become true before timeout: ${last instanceof Error ? last.message : String(last)}`);
}

async function psql(container, sql, { database = DATABASE, user = ADMIN_USER } = {}) {
  const result = await docker([
    "exec", "-e", `PGPASSWORD=${ADMIN_PASSWORD}`, container,
    "psql", "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At",
    "-h", "127.0.0.1", "-U", user, "-d", database, "-c", sql,
  ]);
  return result.stdout;
}

async function containerState(name) {
  const result = await docker(["inspect", "--format", "{{.State.Status}}", name], { allowFailure: true });
  return result.code === 0 ? result.stdout : "missing";
}

async function installControlStoreSchema() {
  for (const [index, migrationPath] of migrationPaths.entries()) {
    const target = `/tmp/molit-${String(index + 1).padStart(3, "0")}.sql`;
    await docker(["cp", migrationPath, `${resources.primary}:${target}`]);
    await docker([
      "exec", "-e", `PGPASSWORD=${ADMIN_PASSWORD}`, resources.primary,
      "psql", "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At", "-h", "127.0.0.1",
      "-U", ADMIN_USER, "-d", DATABASE, "-f", target,
    ]);
  }
  await psql(resources.primary, `
    INSERT INTO molit_control_store.scoped_control_state
      (component, tenant_id, resource_kind, revision, payload, payload_sha256, updated_at)
    VALUES
      ('caas', 'tenant-ha', 'tenant', 1, '{"tenantId":"tenant-ha"}'::jsonb, repeat('a',64), clock_timestamp()),
      ('dsaas', 'dataspace-ha', 'dataspace', 1, '{"dataspaceId":"dataspace-ha"}'::jsonb, repeat('b',64), clock_timestamp());
    INSERT INTO molit_control_store.control_scope_registry
      (component, tenant_id, resource_kind, state_revision, state_sha256, first_seen_at, last_seen_at)
    VALUES
      ('caas', 'molit-platform', 'platform', 0, repeat('0',64), clock_timestamp(), clock_timestamp()),
      ('dsaas', 'molit-platform', 'platform', 0, repeat('0',64), clock_timestamp(), clock_timestamp()),
      ('caas', 'tenant-ha', 'tenant', 1, repeat('a',64), clock_timestamp(), clock_timestamp()),
      ('dsaas', 'dataspace-ha', 'dataspace', 1, repeat('b',64), clock_timestamp(), clock_timestamp());
    INSERT INTO molit_control_store.component_audit_head
      (component, sequence, event_digest, occurred_at, state_root_sha256, updated_at)
    VALUES
      ('caas', 0, repeat('0',64), NULL, repeat('c',64), clock_timestamp()),
      ('dsaas', 0, repeat('0',64), NULL, repeat('d',64), clock_timestamp());
    UPDATE molit_control_store.control_store_mode mode
    SET mode='scoped-authoritative', source_kind='fresh-install', source_snapshot_revision=1,
        source_snapshot_sha256=CASE mode.component WHEN 'caas' THEN repeat('a',64) ELSE repeat('b',64) END,
        cutover_state_root_sha256=head.state_root_sha256, state_root_sha256=head.state_root_sha256,
        cutover_at=clock_timestamp(), updated_at=clock_timestamp()
    FROM molit_control_store.component_audit_head head WHERE head.component=mode.component;
    INSERT INTO molit_control_store.outbox_event
      (component,event_id,aggregate_kind,aggregate_id,tenant_id,event_type,payload,payload_sha256,created_at,available_at)
    VALUES ('caas','outbox-pending','tenant','tenant-ha','tenant-ha','audit.pending','{}'::jsonb,repeat('e',64),clock_timestamp(),clock_timestamp());
    INSERT INTO molit_control_store.outbox_event
      (component,event_id,aggregate_kind,aggregate_id,tenant_id,event_type,payload,payload_sha256,created_at,available_at,published_at,publish_receipt,publish_receipt_sha256)
    VALUES ('dsaas','outbox-ack','dataspace','dataspace-ha','dataspace-ha','audit.ack','{}'::jsonb,repeat('f',64),clock_timestamp(),clock_timestamp(),clock_timestamp(),'{"receipt":"worm"}'::jsonb,repeat('1',64));
    INSERT INTO molit_control_store.usage_meter_event
      (component,tenant_id,event_id,meter_name,purpose,quantity,unit,occurred_at,trace_id,correlation_id,source_event_id,source_event_digest,dimensions,dimensions_sha256,event,event_sha256)
    VALUES ('caas','tenant-ha','usage-001','management-operation','operational-non-billable',1,'operation',clock_timestamp(),repeat('2',32),'ha-test','source-001',repeat('3',64),'{}'::jsonb,repeat('4',64),'{}'::jsonb,repeat('5',64));
  `);
}

async function semanticState(container) {
  const value = await psql(container, `SELECT json_build_object(
    'migrationCount',(SELECT count(*) FROM molit_control_store.schema_migration WHERE (component,version) IN (('postgres-json-store',1),('postgres-normalized-projection',2),('usage-metering',3),('postgres-scoped-control-store',4))),
    'modeRows',(SELECT count(*) FROM molit_control_store.control_store_mode WHERE mode='scoped-authoritative' AND cutover_state_root_sha256 ~ '^[a-f0-9]{64}$' AND state_root_sha256 ~ '^[a-f0-9]{64}$'),
    'rootsMatch',(SELECT bool_and(mode.state_root_sha256=head.state_root_sha256) FROM molit_control_store.control_store_mode mode JOIN molit_control_store.component_audit_head head USING(component)),
    'scopedStateRows',(SELECT count(*) FROM molit_control_store.scoped_control_state),
    'outboxPendingRows',(SELECT count(*) FROM molit_control_store.outbox_event WHERE published_at IS NULL AND dead_lettered_at IS NULL),
    'outboxAcknowledgedRows',(SELECT count(*) FROM molit_control_store.outbox_event WHERE published_at IS NOT NULL),
    'usageEventRows',(SELECT count(*) FROM molit_control_store.usage_meter_event)
  )::text;`);
  return JSON.parse(value);
}

async function waitPostgres(name, timeoutMs = 60_000) {
  return waitFor(`${name} PostgreSQL`, async () => {
    if (await containerState(name) !== "running") return false;
    const result = await docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", ADMIN_USER, "-d", DATABASE], { allowFailure: true });
    return result.code === 0;
  }, timeoutMs);
}

async function prepareVolume(volume) {
  await docker([
    "run", "--rm", "--user", "0:0", "-v", `${volume}:/var/lib/postgresql/data`, IMAGE,
    "sh", "-ceu", "mkdir -p /var/lib/postgresql/data/pgdata && chown -R postgres:postgres /var/lib/postgresql/data",
  ]);
}

async function baseBackup(volume, { standby = false } = {}) {
  await prepareVolume(volume);
  const args = [
    "run", "--rm", "--user", "postgres:postgres", "--network", resources.network,
    "-e", `PGPASSWORD=${REPLICATION_PASSWORD}`,
    "-v", `${volume}:/var/lib/postgresql/data`, IMAGE,
    "pg_basebackup", "-h", resources.primary, "-U", REPLICATION_USER,
    "-D", "/var/lib/postgresql/data/pgdata", "-Fp", "-Xs", "-P",
  ];
  if (standby) args.push("-R", "-C", "-S", "molit_standby");
  await docker(args, { timeout: 180_000 });
}

async function startStandby(extraSettings = []) {
  await docker([
    "run", "-d", "--name", resources.standby, "--network", resources.network,
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
    "-e", `PGPASSWORD=${REPLICATION_PASSWORD}`,
    "-v", `${resources.standbyData}:/var/lib/postgresql/data`, IMAGE,
    "postgres", "-c", "hot_standby=on", ...extraSettings,
  ]);
  await waitPostgres(resources.standby);
  await waitFor("streaming replication", async () => (await psql(resources.primary,
    "SELECT count(*) FROM pg_stat_replication WHERE application_name = 'walreceiver' AND state = 'streaming';")) === "1");
}

async function switchAndArchive() {
  const before = Number(await psql(resources.primary, "SELECT archived_count FROM pg_stat_archiver;"));
  await psql(resources.primary, "SELECT pg_switch_wal();");
  await waitFor("WAL archive", async () => Number(await psql(resources.primary, "SELECT archived_count FROM pg_stat_archiver;")) > before);
  const failures = Number(await psql(resources.primary, "SELECT failed_count FROM pg_stat_archiver;"));
  if (failures !== 0) throw new Error(`WAL archiver reported ${failures} failures`);
}

async function removeContainer(name) {
  await docker(["rm", "-f", name], { allowFailure: true });
}

async function cleanup() {
  for (const name of [resources.pitrContainer, resources.standby, resources.primary]) await removeContainer(name);
  for (const volume of [resources.pitr, resources.standbyData, resources.primaryData, resources.archive]) {
    await docker(["volume", "rm", "-f", volume], { allowFailure: true });
  }
  await docker(["network", "rm", resources.network], { allowFailure: true });
}

async function main() {
  const reportIndex = process.argv.indexOf("--report");
  const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;
  if (reportIndex >= 0 && !reportPath) throw new Error("--report requires a path");
  const sourceCommit = (await command("git", ["rev-parse", "HEAD"])).stdout;
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error("source commit is not a full Git SHA");

  await docker(["network", "create", "--label", "molit.test=postgres-ha", resources.network]);
  for (const volume of [resources.archive, resources.primaryData, resources.standbyData, resources.pitr]) {
    await docker(["volume", "create", "--label", "molit.test=postgres-ha", volume]);
  }
  await docker([
    "run", "--rm", "--user", "0:0", "-v", `${resources.archive}:/archive`, IMAGE,
    "sh", "-ceu", "chown postgres:postgres /archive",
  ]);
  await docker([
    "run", "-d", "--name", resources.primary, "--network", resources.network,
    "--network-alias", resources.primary,
    "-e", `POSTGRES_PASSWORD=${ADMIN_PASSWORD}`,
    "-e", `POSTGRES_USER=${ADMIN_USER}`,
    "-e", `POSTGRES_DB=${DATABASE}`,
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
    "-v", `${resources.primaryData}:/var/lib/postgresql/data`,
    "-v", `${resources.archive}:/archive`, IMAGE,
    "postgres", "-c", "wal_level=replica", "-c", "max_wal_senders=10",
    "-c", "max_replication_slots=10", "-c", "wal_keep_size=256MB",
    "-c", "archive_mode=on", "-c", "archive_timeout=5s",
    "-c", "archive_command=test ! -f /archive/%f && cp %p /archive/%f",
    "-c", "synchronous_commit=on",
  ]);
  await waitPostgres(resources.primary);
  await psql(resources.primary, `CREATE ROLE ${REPLICATION_USER} WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}';`);
  await docker(["exec", "--user", "postgres", resources.primary, "sh", "-ceu",
    `printf '%s\\n' 'host replication ${REPLICATION_USER} 0.0.0.0/0 scram-sha-256' >> "$PGDATA/pg_hba.conf"`]);
  await psql(resources.primary, "SELECT pg_reload_conf();");
  await psql(resources.primary,
    "CREATE TABLE ha_evidence(id integer PRIMARY KEY, value text NOT NULL); CREATE TABLE ha_queue(event_id text PRIMARY KEY, payload text NOT NULL); INSERT INTO ha_evidence VALUES (1, 'baseline'); INSERT INTO ha_queue VALUES ('outbox-001', 'pending');");
  await installControlStoreSchema();

  await baseBackup(resources.standbyData, { standby: true });
  await startStandby();
  await psql(resources.primary, "ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 (walreceiver)';");
  await psql(resources.primary, "SELECT pg_reload_conf();");
  await waitFor("synchronous standby quorum", async () => (await psql(resources.primary,
    "SELECT count(*) FROM pg_stat_replication WHERE application_name = 'walreceiver' AND state = 'streaming' AND sync_state = 'sync';")) === "1");
  await baseBackup(resources.pitr);

  const restartStarted = Date.now();
  await docker(["restart", resources.standby]);
  await waitPostgres(resources.standby);
  await waitFor("replication after rolling restart", async () => (await psql(resources.primary,
    "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming';")) === "1");
  const rollingRestart = { dataLoss: Number(await psql(resources.standby, "SELECT count(*) FROM ha_evidence WHERE id = 1;")) === 1 ? 0 : 1, seconds: (Date.now() - restartStarted) / 1000 };

  const rollbackStarted = Date.now();
  await removeContainer(resources.standby);
  await docker([
    "run", "-d", "--name", resources.standby, "--network", resources.network,
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata", "-v", `${resources.standbyData}:/var/lib/postgresql/data`, IMAGE,
    "postgres", "-c", "molit_invalid_rollout_setting=on",
  ]);
  await waitFor("failed PostgreSQL rollout", async () => (await containerState(resources.standby)) === "exited", 30_000);
  await removeContainer(resources.standby);
  await startStandby(["-c", "log_min_duration_statement=1000"]);
  const rollbackState = await semanticState(resources.standby);
  const rollback = { dataLoss: rollbackState.outboxPendingRows === 1 && rollbackState.outboxAcknowledgedRows === 1 ? 0 : 1, seconds: (Date.now() - rollbackStarted) / 1000 };

  await psql(resources.primary, "INSERT INTO ha_evidence VALUES (2, 'pitr-safe');");
  await psql(resources.primary, "SELECT pg_create_restore_point('molit_before_destructive_change');");
  const expectedValue = await psql(resources.primary, "SELECT string_agg(id::text || ':' || value, ',' ORDER BY id) FROM ha_evidence;");
  const expectedDigest = sha256(expectedValue);
  const expectedSemanticState = await semanticState(resources.primary);
  const expectedSemanticDigest = sha256(JSON.stringify(expectedSemanticState));
  await switchAndArchive();
  await psql(resources.primary, "DELETE FROM ha_evidence WHERE id = 2; INSERT INTO ha_evidence VALUES (99, 'destructive-change');");
  await switchAndArchive();

  const primaryCommitAt = Date.now();
  await psql(resources.primary, "INSERT INTO ha_evidence VALUES (3, 'failover-marker');");
  const failoverStarted = Date.now();
  await docker(["kill", "--signal", "KILL", resources.primary]);
  await waitFor("primary crash fencing", async () => (await containerState(resources.primary)) === "exited");
  await docker(["exec", "--user", "postgres", resources.standby, "pg_ctl", "promote", "-D", "/var/lib/postgresql/data/pgdata", "-w", "-t", "60"]);
  await waitFor("promoted standby", async () => (await psql(resources.standby, "SELECT pg_is_in_recovery();")) === "f");
  await psql(resources.standby, "INSERT INTO ha_evidence VALUES (4, 'post-failover-write');");
  await removeContainer(resources.primary);
  await docker([
    "run", "--rm", "--user", "0:0", "-v", `${resources.primaryData}:/var/lib/postgresql/data`, IMAGE,
    "sh", "-ceu", "rm -f /var/lib/postgresql/data/pgdata/postmaster.pid; touch /var/lib/postgresql/data/pgdata/standby.signal; printf '%s\\n' \"primary_conninfo = 'host=127.0.0.1 port=1 user=molit_replicator connect_timeout=1'\" >> /var/lib/postgresql/data/pgdata/postgresql.auto.conf; chown postgres:postgres /var/lib/postgresql/data/pgdata/standby.signal /var/lib/postgresql/data/pgdata/postgresql.auto.conf",
  ]);
  await docker([
    "run", "-d", "--name", resources.primary, "--network", "none",
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
    "-v", `${resources.primaryData}:/var/lib/postgresql/data`, IMAGE,
    "postgres", "-c", "hot_standby=on",
  ]);
  await waitPostgres(resources.primary, 120_000);
  const oldPrimaryInRecovery = (await psql(resources.primary, "SELECT pg_is_in_recovery();")) === "t";
  const oldPrimaryWriteAttempt = await docker([
    "exec", "-e", `PGPASSWORD=${ADMIN_PASSWORD}`, resources.primary,
    "psql", "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At", "-h", "127.0.0.1",
    "-U", ADMIN_USER, "-d", DATABASE, "-c", "INSERT INTO ha_evidence VALUES (5, 'stale-primary-write');",
  ], { allowFailure: true });
  const oldPrimaryNetwork = await docker(["inspect", "--format", "{{.HostConfig.NetworkMode}}", resources.primary]);
  const oldPrimaryWrite = oldPrimaryWriteAttempt.code === 0 ? 1 : 0;
  const oldPrimaryProbeErrorClass = /read-only transaction/iu.test(oldPrimaryWriteAttempt.stderr)
    ? "postgresql-read-only-recovery"
    : "unexpected-write-rejection";
  const promotedPrimaryUnaffected = Number(await psql(resources.standby, "SELECT count(*) FROM ha_evidence WHERE id = 5;")) === 0;
  const missingCommits = Number(await psql(resources.standby, "SELECT count(*) FROM ha_evidence WHERE id = 3;")) === 1 ? 0 : 1;
  const failover = {
    missingCommits,
    queueEventPreserved: (await semanticState(resources.standby)).outboxPendingRows === 1,
    rpoSeconds: missingCommits === 0 ? 0 : Math.max(0, (Date.now() - primaryCommitAt) / 1000),
    rtoSeconds: (Date.now() - failoverStarted) / 1000,
    splitBrainCommits: oldPrimaryWrite,
    oldPrimaryRestarted: true,
    oldPrimaryInRecovery,
    oldPrimaryNetworkMode: oldPrimaryNetwork.stdout,
    oldPrimaryWriteRejected: oldPrimaryWriteAttempt.code !== 0,
    oldPrimaryProbeErrorClass,
    promotedPrimaryUnaffected,
  };

  await docker([
    "run", "--rm", "--user", "postgres:postgres", "-v", `${resources.pitr}:/var/lib/postgresql/data`, IMAGE,
    "sh", "-ceu",
    "printf '%s\\n' \"restore_command = 'cp /archive/%f %p'\" \"recovery_target_name = 'molit_before_destructive_change'\" \"recovery_target_action = 'promote'\" >> /var/lib/postgresql/data/pgdata/postgresql.auto.conf && touch /var/lib/postgresql/data/pgdata/recovery.signal",
  ]);
  const pitrStarted = Date.now();
  await docker([
    "run", "-d", "--name", resources.pitrContainer, "--network", resources.network,
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
    "-v", `${resources.pitr}:/var/lib/postgresql/data`, "-v", `${resources.archive}:/archive:ro`, IMAGE,
    "postgres", "-c", "archive_mode=off",
  ]);
  await waitPostgres(resources.pitrContainer, 120_000);
  await waitFor("PITR promotion", async () => (await psql(resources.pitrContainer, "SELECT pg_is_in_recovery();")) === "f", 120_000);
  const restoredValue = await psql(resources.pitrContainer, "SELECT string_agg(id::text || ':' || value, ',' ORDER BY id) FROM ha_evidence;");
  const restoredSemanticState = await semanticState(resources.pitrContainer);
  const pitr = {
    destructiveRows: Number(await psql(resources.pitrContainer, "SELECT count(*) FROM ha_evidence WHERE id = 99;")),
    expectedDigest,
    restoredDigest: sha256(restoredValue),
    semanticExpectedDigest: expectedSemanticDigest,
    semanticRestoredDigest: sha256(JSON.stringify(restoredSemanticState)),
    semanticState: restoredSemanticState,
    restorePoint: "molit_before_destructive_change",
    rtoSeconds: (Date.now() - pitrStarted) / 1000,
  };

  if (rollingRestart.dataLoss !== 0 || rollback.dataLoss !== 0 || failover.missingCommits !== 0
    || failover.splitBrainCommits !== 0 || !failover.queueEventPreserved
    || !failover.oldPrimaryInRecovery || failover.oldPrimaryNetworkMode !== "none"
    || !failover.oldPrimaryWriteRejected || failover.oldPrimaryProbeErrorClass !== "postgresql-read-only-recovery"
    || !failover.promotedPrimaryUnaffected
    || pitr.destructiveRows !== 0 || pitr.expectedDigest !== pitr.restoredDigest
    || pitr.semanticExpectedDigest !== pitr.semanticRestoredDigest
    || pitr.semanticState.migrationCount !== 4 || pitr.semanticState.modeRows !== 2
    || pitr.semanticState.rootsMatch !== true || pitr.semanticState.scopedStateRows !== 2
    || pitr.semanticState.outboxPendingRows !== 1 || pitr.semanticState.outboxAcknowledgedRows !== 1
    || pitr.semanticState.usageEventRows !== 1) {
    throw new Error("HA/PITR acceptance criteria failed");
  }
  const report = {
    schemaVersion: "molit.postgres-ha-pitr-run/1",
    status: "pass",
    sourceCommit,
    startedAt,
    finishedAt: new Date().toISOString(),
    image: IMAGE,
    topology: {
      primary: 1,
      standby: 1,
      walArchive: true,
      synchronousCommit: true,
      synchronousStandbyNames: "FIRST 1 (walreceiver)",
      failureInjection: "primary-sigkill-after-synchronous-commit",
      fencingMethod: "isolated-standby-restart-write-rejection",
      evidenceScope: "local-container-failover-only",
    },
    rollingRestart,
    rollback,
    failover,
    pitr,
  };
  if (!reportValidator(report)) {
    throw new Error(`HA/PITR report violates its contract: ${JSON.stringify(reportValidator.errors)}`);
  }
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    const absolute = resolve(reportPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body, "utf8");
  }
  process.stdout.write(body);
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  await cleanup().catch((error) => { failure ??= error; });
}
if (failure) throw failure;
