import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apply = await readFile(new URL("../../deploy/kubernetes/ha/apply.ps1", import.meta.url), "utf8");
const foundationApply = await readFile(new URL("../../deploy/kubernetes/apply.ps1", import.meta.url), "utf8");
const cluster = await readFile(new URL("../../deploy/kubernetes/ha/postgres.template.yaml", import.meta.url), "utf8");
const migrationJob = await readFile(new URL("../../deploy/kubernetes/control-store-migration-job.yaml", import.meta.url), "utf8");
const runtimeFence = await readFile(new URL("../../deploy/control-store/postgres/runtime-role-fence.sql", import.meta.url), "utf8");
const loginVerification = await readFile(new URL("../../deploy/control-store/postgres/runtime-role-login-verification.sql", import.meta.url), "utf8");
const runtimeFenceJob = await readFile(new URL("../../deploy/kubernetes/control-store-runtime-fence-job.yaml", import.meta.url), "utf8");
const loginVerificationJob = await readFile(new URL("../../deploy/kubernetes/control-store-runtime-login-verification-job.yaml", import.meta.url), "utf8");
const job = await readFile(new URL("../../deploy/kubernetes/control-store-runtime-bootstrap-job.yaml", import.meta.url), "utf8");
const sql = await readFile(new URL("../../deploy/control-store/postgres/runtime-role-bootstrap.sql", import.meta.url), "utf8");

test("KUBE-DB-BOOT-001: CNPG owns runtime role passwords and enforces non-privileged login attributes", () => {
  assert.match(cluster, /managed:[\s\S]*roles:/u);
  assert.match(cluster, /name: "@@CAAS_DATABASE_ROLE@@"[\s\S]*passwordSecret:[\s\S]*name: molit-caas-database-role/u);
  assert.match(cluster, /name: "@@DSAAS_DATABASE_ROLE@@"[\s\S]*passwordSecret:[\s\S]*name: molit-dsaas-database-role/u);
  assert.equal((cluster.match(/superuser: false/gu) ?? []).length, 2);
  assert.equal((cluster.match(/createrole: false/gu) ?? []).length, 2);
  assert.equal((cluster.match(/bypassrls: false/gu) ?? []).length, 2);
  assert.equal((cluster.match(/inherit: false/gu) ?? []).length, 2);
  assert.equal((cluster.match(/login: @@RUNTIME_ROLE_LOGIN@@/gu) ?? []).length, 2);
});

test("KUBE-DB-BOOT-002: bootstrap Job mounts role names without mounting or interpolating role passwords", () => {
  assert.match(job, /molit-caas-database-role[\s\S]*items: \[\{ key: username, path: username \}\]/u);
  assert.match(job, /molit-dsaas-database-role[\s\S]*items: \[\{ key: username, path: username \}\]/u);
  assert.doesNotMatch(job, /key: password|PGPASSWORD|eval /u);
  assert.match(job, /psql "\$DATABASE_URL" -X -v ON_ERROR_STOP=1/u);
  assert.match(job, /-v caas_role="\$CAAS_ROLE"/u);
  assert.match(job, /runtime-role-bootstrap\.sql/u);
});

test("KUBE-DB-BOOT-003: SQL quotes identifiers and literals, grants bounded access, and creates idempotent platform bindings", () => {
  assert.match(sql, /TO :"caas_role", :"dsaas_role"/u);
  assert.match(sql, /IN \(:'caas_role', :'dsaas_role'\)/u);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA molit_control_store/u);
  assert.match(sql, /REVOKE EXECUTE[\s\S]*enroll_current_service_principal\(text, text\)[\s\S]*FROM :"caas_role", :"dsaas_role"/u);
  assert.match(sql, /GRANT EXECUTE[\s\S]*enroll_scoped_service_principal\(text, text\)[\s\S]*component_principal_active\(text\)/u);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*enroll_current_service_principal/u);
  assert.match(sql, /INSERT INTO molit_control_store\.tenant_database_principal/u);
  assert.match(sql, /INSERT INTO molit_control_store\.control_component_principal/u);
  assert.match(sql, /enroll_scoped_service_principal\(text, text\)/u);
  assert.match(sql, /ON CONFLICT \(database_role, tenant_id, access_mode\) DO UPDATE/u);
  assert.match(sql, /tenant_id = 'molit-platform'[\s\S]*access_mode = 'service'/u);
  assert.match(sql, /count\(\*\) = 136 AS required_table_grants/u);
  assert.match(sql, /control_participant_registry[\s\S]*TO :"dsaas_role"/u);
  assert.match(sql, /snapshot_runtime_access_revoked/u);
  assert.match(sql, /has_column_privilege\(:'caas_role', 'molit_control_store\.control_store_mode', 'state_root_sha256', 'UPDATE'\)/u);
  assert.match(sql, /NOT has_column_privilege\(:'dsaas_role', 'molit_control_store\.control_store_mode', 'cutover_state_root_sha256', 'UPDATE'\)/u);
  assert.match(migrationJob, /scoped-cutover-cli\.mjs/u);
  assert.match(sql, /NOT has_table_privilege\(:'caas_role', 'molit_control_store\.json_snapshot', 'SELECT'\)/u);
  assert.match(sql, /NOT has_table_privilege\(:'dsaas_role', 'molit_control_store\.json_snapshot', 'DELETE'\)/u);
  assert.doesNotMatch(sql, /BYPASSRLS|SUPERUSER|CREATE ROLE/u);
});

test("KUBE-DB-BOOT-004: deploy gate binds URLs to managed credentials and completes bootstrap before application rollout", () => {
  assert.match(apply, /Assert-BasicAuthRoleSecret "molit-caas-database-role" -RequireReloadLabel/u);
  assert.match(apply, /Assert-BasicAuthRoleSecret "molit-dsaas-database-role" -RequireReloadLabel/u);
  assert.match(apply, /cnpg\.io\/reload/u);
  assert.match(apply, /Assert-DatabaseCredentialUrl/u);
  assert.match(apply, /runtime-role-bootstrap\.sql/u);
  assert.match(apply, /Enter-ControlPlaneQuiescence/u);
  assert.match(apply, /molit-control-store-schema-receipt/u);
  assert.match(apply, /molit\.control-store-schema-receipt\/1/u);
  assert.match(apply, /Add-Member -NotePropertyName immutable -NotePropertyValue \$true/u);
  assert.match(apply, /data\.molit\.go\.kr\/receipt-sha256/u);
  const bootstrapWait = apply.indexOf('job/molit-control-store-runtime-bootstrap');
  const applicationRender = apply.indexOf('$Application =');
  assert.ok(bootstrapWait > 0 && applicationRender > bootstrapWait);
});

test("KUBE-DB-BOOT-005: both database Jobs use one approved signed-image input", () => {
  assert.match(migrationJob, /image: "@@DATABASE_TOOL_IMAGE@@"/u);
  assert.match(job, /image: "@@DATABASE_TOOL_IMAGE@@"/u);
  assert.doesNotMatch(`${migrationJob}\n${job}`, /(?:docker\.io\/)?postgres:[^\s]+/u);
  assert.match(apply, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$DatabaseToolImage/u);
  assert.match(apply, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$RegistryPrefix/u);
  assert.match(apply, /Assert-ApprovedImage \$Image\.Reference \$Image\.Label/u);
  assert.match(apply, /\$MigrationJobTemplate\.Replace\("@@DATABASE_TOOL_IMAGE@@", \$DatabaseToolImage\)/u);
  assert.match(apply, /\.Replace\("@@CAAS_IMAGE@@", \$CaasImage\)/u);
  assert.match(apply, /\$BootstrapJobTemplate\.Replace\("@@DATABASE_TOOL_IMAGE@@", \$DatabaseToolImage\)/u);
  assert.equal((apply.match(/StartsWith\("\$RegistryPrefix\/"/gu) ?? []).length, 1);
});

test("KUBE-DB-BOOT-006: schema migration performs a TLS-bound offline scoped cutover before runtime bootstrap", () => {
  const schema = migrationJob.indexOf("001_control_store.sql");
  const cutover = migrationJob.indexOf("src/control-store/scoped-cutover-cli.mjs");
  assert.ok(schema > 0 && cutover > schema);
  assert.match(migrationJob, /initContainers:[\s\S]*name: migrate-schema[\s\S]*containers:[\s\S]*name: cutover/u);
  assert.match(migrationJob, /MOLIT_CONTROL_STORE_MIGRATION_DATABASE_URL/u);
  assert.match(migrationJob, /MOLIT_CONTROL_STORE_MIGRATION_CA_FILE[\s\S]*\/tls\/ca\.crt/u);
  assert.match(migrationJob, /image: "@@CAAS_IMAGE@@"/u);
  assert.match(apply, /ControlStoreCutoverInputClaim/u);
  assert.match(apply, /persistentvolumeclaim[\s\S]*status\.phase -ne "Bound"/u);
  assert.match(migrationJob, /MOLIT_CAAS_SCOPE_MAP_PATH[\s\S]*MOLIT_DSAAS_SCOPE_MAP_PATH/u);
  assert.match(migrationJob, /MOLIT_CAAS_LEGACY_SOURCE_PATH[\s\S]*MOLIT_DSAAS_LEGACY_SOURCE_PATH/u);
  assert.match(migrationJob, /name: cutover-input, mountPath: \/cutover-input, readOnly: true/u);
  assert.match(migrationJob, /@@CUTOVER_INPUT_VOLUME@@/u);
  assert.doesNotMatch(migrationJob, /name: cutover-input\s+configMap:/u);
  const migrationWait = apply.indexOf('job/molit-control-store-migration');
  const bootstrapRender = apply.indexOf('$BootstrapJobTemplate =');
  assert.ok(migrationWait > 0 && bootstrapRender > migrationWait);
});

test("KUBE-DB-BOOT-008: offline cutover fences both runtime roles and drains their sessions before schema work", () => {
  const fence = migrationJob.indexOf("name: fence-runtime-sessions");
  const schema = migrationJob.indexOf("name: migrate-schema");
  const cutover = migrationJob.indexOf("name: cutover");
  assert.ok(fence > 0 && schema > fence && cutover > schema);
  assert.match(runtimeFence, /ALTER ROLE :"caas_role" NOLOGIN/u);
  assert.match(runtimeFence, /ALTER ROLE :"dsaas_role" NOLOGIN/u);
  assert.match(runtimeFence, /REVOKE CONNECT ON DATABASE :"database_name"/u);
  assert.match(runtimeFence, /pg_terminate_backend/u);
  assert.match(runtimeFence, /runtime_sessions_drained/u);
  assert.match(sql, /GRANT CONNECT ON DATABASE :"database_name"/u);
  assert.doesNotMatch(sql, /ALTER ROLE [^\n]+ LOGIN/u);
  assert.ok(sql.indexOf('GRANT CONNECT ON DATABASE') > sql.indexOf('snapshot_runtime_access_revoked'),
    "runtime CONNECT must remain revoked until the final privilege assertion succeeds");
  assert.match(sql, /runtime_roles_ready_for_operator_unfence/u);
  assert.match(loginVerification, /rolcanlogin/u);
  assert.match(loginVerification, /has_database_privilege/u);
  assert.match(runtimeFenceJob, /runtime-role-fence\.sql/u);
  assert.match(loginVerificationJob, /runtime-role-login-verification\.sql/u);
  const fencedApply = apply.indexOf('Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $PostgresFencedPath)', apply.indexOf('$PostgresFencedPath = Join-Path'));
  const fenceWait = apply.indexOf('job/molit-control-store-runtime-fence', fencedApply);
  const migrationWait = apply.indexOf('job/molit-control-store-migration');
  const bootstrapWait = apply.indexOf('job/molit-control-store-runtime-bootstrap');
  const unfencedApply = apply.indexOf('Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $PostgresUnfencedPath)', bootstrapWait);
  const loginWait = apply.indexOf('job/molit-control-store-runtime-login-verification', unfencedApply);
  const applicationRender = apply.indexOf('$Application =');
  assert.ok(fencedApply > 0 && fenceWait > fencedApply && migrationWait > fenceWait && bootstrapWait > migrationWait
    && unfencedApply > bootstrapWait && loginWait > unfencedApply && applicationRender > loginWait);
  assert.match(apply, /Assert-ManagedRoleIntent \$false/u);
  assert.match(apply, /Assert-ManagedRoleIntent \$true/u);
});

test("KUBE-DB-BOOT-007: foundation bootstrap cannot bypass the HA migration and cutover gate", () => {
  assert.match(foundationApply, /Database migration is disabled in the foundation bootstrap entrypoint/u);
  assert.match(foundationApply, /deploy\/kubernetes\/ha\/apply\.ps1/u);
  assert.doesNotMatch(foundationApply, /create configmap molit-control-store-migrations|001 through 003/u);
});
