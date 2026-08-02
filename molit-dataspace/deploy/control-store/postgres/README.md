# PostgreSQL 제어 저장소

## 1. 적용 범위

production CaaS와 DSaaS는 tenant 또는 dataspace 단위의 PostgreSQL authoritative state를 사용한다.

- scope별 payload와 revision compare-and-set
- component·tenant `FORCE ROW LEVEL SECURITY`
- component 전역 기술 식별자 unique registry
- scope별 멱등성 record
- 상태, 감사와 `audit.appended` outbox의 원자 커밋
- session advisory lock과 단조 증가 fencing token
- 상태 transaction pool과 장기 lease pool 분리
- 승인된 legacy 전환과 불변 cutover receipt
- runtime의 legacy snapshot 접근 차단
- object·secret reference, metric과 usage meter 보조 원장

이 구성만으로 multi-zone 고가용성, backup·restore와 Kubernetes 외부 부작용의 fencing이 입증되지는 않는다. 해당 증거는 별도 운영 Gate에서 만든다.

## 2. database 역할

CaaS와 DSaaS는 서로 다른 login role을 사용한다. 같은 database를 사용하더라도 `control_component_principal`이 role을 한 component에 고정한다. 각 role은 다음 조건을 충족해야 한다.

```text
LOGIN
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOREPLICATION
NOBYPASSRLS
```

schema owner 또는 전용 migration role만 DDL과 cutover를 실행한다. runtime role에는 schema 생성, table 변경, principal registry 조회·변경 권한을 주지 않는다.

runtime 권한은 수동 SQL 예제가 아니라 `runtime-role-bootstrap.sql`로 적용한다. bootstrap은 다음 항목을 함께 검사한다.

- CaaS·DSaaS role 분리와 비권한 속성
- component binding과 `molit-platform` service binding
- cutover 당시 존재한 모든 scope의 service binding
- scoped table 권한
- legacy snapshot의 네 가지 table 권한 부재
- current root 두 열만 갱신 가능하고 cutover provenance는 갱신 불가
- 이전 enrollment 함수의 실행 권한 부재

## 3. migration 순서

application을 배포하기 전에 migration role로 다음 SQL을 순서대로 적용한다.

```powershell
$env:MOLIT_CONTROL_STORE_MIGRATION_URL = "postgresql://<migration-role>@<host>/<database>"

psql $env:MOLIT_CONTROL_STORE_MIGRATION_URL -v ON_ERROR_STOP=1 `
  -f deploy/control-store/postgres/001_control_store.sql
psql $env:MOLIT_CONTROL_STORE_MIGRATION_URL -v ON_ERROR_STOP=1 `
  -f deploy/control-store/postgres/002_normalized_projection.sql
psql $env:MOLIT_CONTROL_STORE_MIGRATION_URL -v ON_ERROR_STOP=1 `
  -f deploy/control-store/postgres/003_usage_metering.sql
psql $env:MOLIT_CONTROL_STORE_MIGRATION_URL -v ON_ERROR_STOP=1 `
  -f deploy/control-store/postgres/004_authoritative_scoped_state.sql
```

`004`는 앞선 schema의 table과 RLS 함수를 사용한다. application process는 migration을 실행하지 않는다. version 4, 필수 table 또는 cutover mode가 없으면 `PostgresScopedControlStore`는 기동을 중단한다.

## 4. cutover

schema 설치 뒤 두 component를 `scoped-authoritative`로 전환한다.

```powershell
$env:MOLIT_CONTROL_STORE_MIGRATION_DATABASE_URL = $env:MOLIT_CONTROL_STORE_MIGRATION_URL
$env:MOLIT_CONTROL_STORE_MIGRATION_CA_FILE = "C:\approved\postgres-ca.pem"

# 필요한 경우에만 지정한다.
$env:MOLIT_CAAS_SCOPE_MAP_PATH = "C:\approved\caas-scope-map.json"
$env:MOLIT_DSAAS_SCOPE_MAP_PATH = "C:\approved\dsaas-scope-map.json"
$env:MOLIT_CAAS_LEGACY_SOURCE_PATH = "C:\approved\caas-legacy-source.json"
$env:MOLIT_DSAAS_LEGACY_SOURCE_PATH = "C:\approved\dsaas-legacy-source.json"

node src/control-store/scoped-cutover-cli.mjs > control-store-cutover-receipt.json
```

DB snapshot과 external legacy source를 같은 component에 동시에 지정할 수 없다. fresh install은 legacy row가 전혀 없을 때만 허용한다. scope를 증명할 수 없는 멱등성 record에는 승인된 scope map이 필요하다.

receipt의 `stateRootSha256`는 전환 시점의 `cutover_state_root_sha256`다. runtime commit 뒤에도 바뀌지 않는다. DB의 `state_root_sha256`는 현재 상태 root이며 `component_audit_head.state_root_sha256`와 항상 같아야 한다.

cutover가 끝난 뒤 runtime bootstrap을 실행한다.

```powershell
psql $env:MOLIT_CONTROL_STORE_MIGRATION_URL `
  -v ON_ERROR_STOP=1 `
  -v caas_role=molit_caas_runtime `
  -v dsaas_role=molit_dsaas_runtime `
  -v approved_by=<approved-identity> `
  -v approval_reference=<approved-change-id> `
  -f deploy/control-store/postgres/runtime-role-bootstrap.sql
```

## 5. 신규 scope 등록

runtime은 신규 tenant 또는 dataspace를 만들기 전에 platform context에서 다음 함수를 호출한다.

```sql
SELECT molit_control_store.enroll_scoped_service_principal(
  'road-data-provider',
  'caas'
);
```

함수는 `session_user`만 등록한다. component binding, `scoped-authoritative` mode, platform 위임, scoped-store actor, trace ID와 correlation ID를 확인한다. target binding을 만들 수 없으면 상태 transaction 전체를 rollback한다.

기존 scope binding은 runtime bootstrap이 registry에서 읽어 등록한다. 따라서 restart 때 각 scope를 다시 enrollment하지 않는다.

## 6. Runtime 설정

PostgreSQL 설정은 CaaS와 DSaaS의 `stateStore`에 둔다. URL, instance ID와 CA 원문은 환경 변수 또는 승인된 secret injector로 전달한다.

```json
{
  "type": "postgres",
  "connectionStringEnv": "MOLIT_DSAAS_POSTGRES_URL",
  "holderIdEnv": "MOLIT_DSAAS_INSTANCE_ID",
  "applicationName": "molit-dsaas-control-plane",
  "tls": {
    "mode": "verify-full",
    "caEnv": "MOLIT_DSAAS_POSTGRES_CA_PEM"
  },
  "maxPoolSize": 20,
  "maxLeasePoolSize": 20,
  "connectionTimeoutMs": 5000,
  "idleTimeoutMs": 30000,
  "statementTimeoutMs": 30000,
  "lockTimeoutMs": 5000
}
```

`maxPoolSize`는 짧은 상태 transaction에, `maxLeasePoolSize`는 reconcile 동안 유지하는 advisory lease에 적용한다. 전체 connection 예산은 replica 수와 장애조치 여유를 포함해 계산한다.

운영 환경은 `verify-full`만 허용한다. URL에는 사용자, 비밀번호, 호스트, 포트와 database를 모두 명시한다. process의 `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `PGOPTIONS`로 빈 값을 보충하지 않는다.

## 7. 시험

실제 PostgreSQL container 시험은 다음 명령으로 실행한다.

```powershell
npm run test:control-store:postgres
```

시험은 migration, 승인 cutover, runtime 권한, legacy key 변환, component·tenant RLS, 동시 uniqueness·capacity, 상태·감사·outbox 원자성, current·cutover root 분리, WORM claim과 orphan audit를 확인한다.

고정된 PostgreSQL image, 임시 port와 고유 Compose project를 사용한다. 성공과 실패 경로 모두 container, network와 volume을 제거한다. 로컬 시험은 TLS를 끄므로 운영 TLS, failover와 인증서 회전 증거를 대신하지 않는다.

## 8. 운영 경계

- scope registry와 component audit head 갱신은 component 단위로 직렬화된다. 승인 capacity profile에서 lock 대기와 쓰기율을 측정해야 한다.
- PostgreSQL fencing token은 제어 평면 commit을 보호한다. Kubernetes admission과 target-side fencing은 별도 검증이 필요하다.
- 장애조치 중 commit 결과가 불명확하면 `*_STATE_COMMIT_UNKNOWN`을 반환한다. 호출자는 같은 idempotency key로 결과를 확인한다.
- offboarding 전에 pending outbox, 감사 보존과 principal binding 종료 순서를 승인된 runbook으로 고정한다.
