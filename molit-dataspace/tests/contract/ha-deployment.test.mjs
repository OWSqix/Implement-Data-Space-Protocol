import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const application = await readFile(new URL("../../deploy/kubernetes/ha/control-plane.template.yaml", import.meta.url), "utf8");
const postgres = await readFile(new URL("../../deploy/kubernetes/ha/postgres.template.yaml", import.meta.url), "utf8");
const observability = await readFile(new URL("../../deploy/kubernetes/ha/observability.template.yaml", import.meta.url), "utf8");
const apply = await readFile(new URL("../../deploy/kubernetes/ha/apply.ps1", import.meta.url), "utf8");
const haPitrEntrypoint = await readFile(new URL("../../deploy/ha/postgres/run-ha-pitr.ps1", import.meta.url), "utf8");
const recovery = await readFile(new URL("../../deploy/kubernetes/ha/postgres-recovery.template.yaml", import.meta.url), "utf8");
const recoveryRunner = await readFile(new URL("../../deploy/kubernetes/ha/run-cnpg-recovery.ps1", import.meta.url), "utf8");
const recoverySql = await readFile(new URL("../../deploy/control-store/postgres/recovery-verification.sql", import.meta.url), "utf8");

test("HA-DEPLOY-001: control planes use three-zone fail-closed placement and disruption budgets", () => {
  assert.equal((application.match(/replicas: 3/gu) ?? []).length, 2);
  assert.equal((application.match(/topologyKey: topology\.kubernetes\.io\/zone/gu) ?? []).length, 2);
  assert.equal((application.match(/whenUnsatisfiable: DoNotSchedule/gu) ?? []).length, 4);
  assert.equal((application.match(/minDomains: 3/gu) ?? []).length, 4);
  assert.equal((application.match(/minAvailable: 2/gu) ?? []).length, 2);
  assert.equal((application.match(/maxUnavailable: 0/gu) ?? []).length, 2);
  assert.match(application, /readinessProbe:[\s\S]*path: \/readyz/gu);
  assert.match(application, /livenessProbe:[\s\S]*path: \/healthz/gu);
  assert.match(application, /readOnlyRootFilesystem: true/gu);
  assert.match(application, /serviceAccountToken:[\s\S]*expirationSeconds: 3600/gu);
  assert.match(application, /kube-root-ca\.crt/gu);
  assert.doesNotMatch(application, /tls-proxy|nginx|TLS_PROXY_IMAGE/gu);
  assert.match(application, /name: caas[\s\S]*containerPort: 8787/gu);
  assert.match(application, /name: dsaas[\s\S]*containerPort: 8888/gu);
  assert.equal((application.match(/httpHeaders: \[\{ name: Host, value: "@@DSAAS_HEALTH_HOST@@" \}\]/gu) ?? []).length, 3);
  assert.match(application, /scheme: HTTPS/gu);
  assert.match(application, /src\/operations\/kubernetes-preflight\.mjs/gu);
  assert.equal((application.match(/--schema-receipt/gu) ?? []).length, 3);
  assert.equal((application.match(/molit-control-store-schema-receipt/gu) ?? []).length, 3);
  assert.match(application, /molit-identity-config/gu);
  assert.match(application, /molit-observability-config/gu);
  assert.match(application, /\/var\/run\/secrets\/molit-observability/gu);
  assert.match(application, /molit-caas-client/gu);
  assert.match(application, /\/run\/molit\/dsaas\/dsaas\.json/gu);
  assert.match(application, /kind: CronJob[\s\S]*molit-caas-orphan-recovery/gu);
  assert.match(application, /kind: CronJob[\s\S]*suspend: false/gu);
  assert.match(application, /concurrencyPolicy: Forbid/gu);
});

test("HA-DEPLOY-002: PostgreSQL uses synchronous quorum, WAL archive, and scheduled PITR backup", () => {
  assert.match(postgres, /instances: 3/gu);
  assert.match(postgres, /dataDurability: required/gu);
  assert.match(postgres, /failoverQuorum: true/gu);
  assert.match(postgres, /podAntiAffinityType: required/gu);
  assert.match(postgres, /isWALArchiver: true/gu);
  assert.match(postgres, /method: plugin/gu);
  assert.match(postgres, /schedule: "0 0 2 \* \* \*"/gu);
  assert.match(postgres, /002_normalized_projection\.sql/gu);
  assert.match(postgres, /003_usage_metering\.sql/gu);
  assert.match(postgres, /004_authoritative_scoped_state\.sql/gu);
  assert.match(postgres, /managed:[\s\S]*molit-caas-database-role[\s\S]*molit-dsaas-database-role/gu);
});

test("HA-DEPLOY-003: deploy entrypoint requires digest images, explicit context, migrations, configs, and secret keys", () => {
  assert.match(apply, /@sha256:\[a-f0-9\]\{64\}/gu);
  assert.match(apply, /database migration\/bootstrap image/gu);
  assert.match(apply, /must use the approved RegistryPrefix/gu);
  assert.match(apply, /current-context/gu);
  assert.match(apply, /clusters\.postgresql\.cnpg\.io/gu);
  assert.match(apply, /objectstores\.barmancloud\.cnpg\.io/gu);
  assert.match(apply, /molit-backup-credentials/gu);
  assert.match(apply, /003_usage_metering\.sql/gu);
  assert.match(apply, /004_authoritative_scoped_state\.sql/gu);
  assert.match(apply, /molit-control-store-runtime-bootstrap/gu);
  assert.match(apply, /Enter-ControlPlaneQuiescence/gu);
  assert.match(apply, /Restore-ControlPlaneQuiescence/gu);
  assert.match(apply, /batch\.kubernetes\.io\/cronjob-name/gu);
  assert.match(apply, /Active orphan-recovery Jobs did not drain/gu);
  assert.match(apply, /-not \$ReleaseSucceeded[\s\S]*Restore-ControlPlaneQuiescence \$QuiescenceState -Deployments/gu);
  assert.match(apply, /Publish-CutoverRecoveryReceipt/gu);
  assert.match(apply, /runtimeRolesMayBeFenced = \$DatabaseCutoverStarted/gu);
  assert.match(apply, /phase = if \(\$DatabaseCutoverStarted\) \{ "database-cutover" \} else \{ "pre-cutover-mutation" \}/gu);
  assert.match(apply, /workloadsKeptOffline = \$true/gu);
  assert.match(apply, /molit-control-store-cutover-recovery/gu);
  assert.match(apply, /molit-control-store-schema-receipt/gu);
  assert.match(apply, /postgres-scoped-control-store/gu);
  assert.match(apply, /molit-identity-config/gu);
  assert.match(apply, /molit-observability-config/gu);
  assert.match(apply, /molit-observability.*otlp-token/gu);
  assert.match(apply, /molit-otel-collector.*ingress-token/gu);
  assert.match(apply, /audit\.baseUrl -cne "https:\/\/worm-audit\.observability\.svc\/"/gu);
  assert.match(apply, /service-registry\.json.*approval-decision-registry\.json/gu);
  assert.match(apply, /reloadIntervalMs/gu);
  assert.match(apply, /usageMeter\.outbox/gu);
  assert.match(apply, /ObservabilityBackendMode/gu);
  assert.match(apply, /allowedHosts -notcontains \$DsaasPublicOrigin\.Host/gu);
  assert.match(apply, /@@DSAAS_HEALTH_HOST@@/gu);
  assert.doesNotMatch(apply, /TlsProxyImage|TLS_PROXY_IMAGE/gu);
  assert.match(apply, /--server-side/gu);
});

test("HA-DEPLOY-004: in-cluster OTLP gateway is three-zone, mTLS-bound, and uses one durable queue per replica", () => {
  assert.match(observability, /kind: StatefulSet/gu);
  assert.match(observability, /name: otel-collector/gu);
  assert.match(observability, /replicas: 3/gu);
  assert.equal((observability.match(/minDomains: 3/gu) ?? []).length, 2);
  assert.match(observability, /volumeClaimTemplates/gu);
  assert.match(observability, /molit-otel-collector/gu);
  assert.match(observability, /server-cert/gu);
  assert.match(observability, /client-ca/gu);
  assert.match(observability, /minAvailable: 2/gu);
  assert.match(observability, /kind: NetworkPolicy[\s\S]*name: otel-collector-ingress/gu);
  assert.match(observability, /name: observability-default-deny/gu);
  assert.match(observability, /name: otel-collector-egress/gu);
  assert.match(observability, /key: ingress-token, path: ingress_token/gu);
  assert.match(observability, /name: otlp-http, port: 4318/gu);
  assert.match(observability, /name: metrics, port: 8888/gu);
  assert.match(observability, /name: health, port: 13133/gu);
  assert.match(observability, /readinessProbe:[\s\S]*port: health/gu);
  assert.match(observability, /metrics-reader: "true"/gu);
});

test("HA-DEPLOY-006: system workloads start from default deny with bounded internal, DNS, OTLP, and HTTPS paths", () => {
  assert.match(application, /name: molit-system-default-deny[\s\S]*policyTypes: \[Ingress, Egress\]/gu);
  assert.match(application, /name: molit-system-internal/gu);
  assert.match(application, /kubernetes\.io\/metadata\.name: kube-system/gu);
  assert.match(application, /kubernetes\.io\/metadata\.name: observability/gu);
  assert.match(application, /protocol: TCP, port: 4318/gu);
  assert.match(application, /name: molit-dsaas-public-ingress/gu);
});

test("HA-DEPLOY-007: PITR creates an isolated CNPG recovery Cluster and verifies control-store semantics", () => {
  assert.match(recovery, /bootstrap:[\s\S]*recovery:[\s\S]*source: molit-control-store-backup-source/gu);
  assert.match(recovery, /recoveryTarget:[\s\S]*targetTime: "@@RECOVERY_TARGET_TIME@@"/gu);
  assert.match(recovery, /externalClusters:[\s\S]*name: molit-control-store-backup-source/gu);
  assert.match(recovery, /plugin:[\s\S]*name: barman-cloud\.cloudnative-pg\.io/gu);
  assert.match(recovery, /barmanObjectName: molit-control-store-backup/gu);
  assert.match(recovery, /serverName: molit-control-store/gu);
  assert.equal((recovery.match(/login: false/gu) ?? []).length, 2);
  assert.match(recoveryRunner, /--dry-run=server/gu);
  assert.match(recoveryRunner, /ParseExact/gu);
  assert.match(recoveryRunner, /outside the 30-day backup retention window/gu);
  assert.match(recoveryRunner, /canonical postgres-operand repository/gu);
  assert.match(recoveryRunner, /canonical edc-schema-migration repository/gu);
  assert.match(recoveryRunner, /RecoveryId already belongs to an existing Cluster/gu);
  assert.match(recoveryRunner, /RecoveryDatabaseSecret must contain the target-time username and password/gu);
  assert.match(recoveryRunner, /externalClusters\[0\]\.name -ne \$Recovery\.spec\.bootstrap\.recovery\.source/gu);
  assert.match(recoveryRunner, /job\/\$ClusterName-verification/gu);
  for (const migration of ["postgres-json-store", "postgres-normalized-projection", "usage-metering", "postgres-scoped-control-store"]) {
    assert.match(recoverySql, new RegExp(migration, "u"));
  }
  assert.match(recoverySql, /scoped_control_state/gu);
  assert.match(recoverySql, /cutover_state_root_sha256/gu);
  assert.match(recoverySql, /expected_caas_root/gu);
  assert.match(recoverySql, /expected_dsaas_root/gu);
  assert.match(recoverySql, /component_audit_head/gu);
  assert.match(recoverySql, /outboxPendingRows/gu);
  assert.match(recoverySql, /outboxAcknowledgedRows/gu);
  assert.match(recoverySql, /usageEventRows/gu);
});

test("HA-DEPLOY-005: HA/PITR evidence preserves an absolute profile artifact path", () => {
  assert.match(haPitrEntrypoint, /\[IO\.Path\]::IsPathRooted\(\$ReportPath\)/u);
  assert.match(haPitrEntrypoint, /GetFullPath\(\$ReportPath\)/u);
  assert.match(haPitrEntrypoint, /GetFullPath\(\(Join-Path \$Root \$ReportPath\)\)/u);
  assert.doesNotMatch(haPitrEntrypoint, /--report \(Join-Path \$Root \$ReportPath\)/u);
});
