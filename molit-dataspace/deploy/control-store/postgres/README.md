# PostgreSQL 제어 저장소

## 1. 적용 범위

이 저장소는 CaaS와 DSaaS의 단일 호스트 파일 상태를 PostgreSQL transaction으로 옮기는 운영 기반이다. 다음 항목을 구현한다.

- JSONB snapshot의 `SELECT ... FOR UPDATE` 직렬화
- revision compare-and-set
- session advisory lock과 단조 증가 fencing token
- 상태 transaction pool과 장기 lease pool 분리
- migration version 확인과 누락 시 기동 차단
- query, statement, lock, idle transaction과 lease 정리 제한시간

이 구현만으로 고가용성, 백업 복구 또는 외부 Kubernetes 자원의 fencing이 입증되지는 않는다. 현재 상태는 상용 운영 P0의 공유 상태 기반이다.

## 2. 데이터베이스 경계

CaaS와 DSaaS 운영 배포에는 서로 다른 database와 runtime role을 사용한다. 같은 table의 `component` 값만으로 두 제어 평면의 권한을 나누지 않는다.

각 database에는 schema owner가 migration을 적용하고 runtime role에는 다음 최소 권한만 부여한다. 아래 role 이름은 배포 예시다.

```sql
REVOKE ALL ON SCHEMA molit_control_store FROM PUBLIC;
GRANT USAGE ON SCHEMA molit_control_store TO molit_caas_runtime;
GRANT SELECT ON molit_control_store.schema_migration TO molit_caas_runtime;
GRANT SELECT, INSERT, UPDATE ON molit_control_store.json_snapshot TO molit_caas_runtime;
GRANT SELECT, INSERT, UPDATE ON molit_control_store.resource_fence TO molit_caas_runtime;
```

DSaaS database에는 별도 `molit_dsaas_runtime` role로 같은 최소 권한을 부여한다. runtime role에 schema 생성, table 변경, 삭제 또는 다른 database 접속 권한을 주지 않는다.

## 3. Migration

schema owner가 application 배포 전에 migration을 적용한다.

```powershell
$env:MOLIT_CONTROL_STORE_MIGRATION_URL = "postgresql://<schema-owner>@<host>/<database>"
psql $env:MOLIT_CONTROL_STORE_MIGRATION_URL `
  -v ON_ERROR_STOP=1 `
  -f deploy/control-store/postgres/001_control_store.sql
```

application은 DDL을 실행하지 않는다. `postgres-json-store` migration version이 `1`이 아니거나 필수 table·column을 읽을 수 없으면 기동을 중단한다.

## 4. Runtime 설정

PostgreSQL 설정은 CaaS와 DSaaS의 `stateStore`에 둔다. connection URL, instance ID와 CA 원문은 설정 파일에 넣지 않고 환경 변수 또는 승인된 secret injector로 전달한다.

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

`maxPoolSize`는 짧은 상태 transaction에, `maxLeasePoolSize`는 reconcile 동안 유지하는 advisory lease에 적용한다. instance 하나의 최대 database connection 수는 두 값의 합이다. 전체 connection 예산은 replica 수와 장애조치 여유를 포함해 계산한다.

운영 환경은 `verify-full`만 허용한다. connection URL에는 사용자, 비밀번호, 호스트, 포트와 데이터베이스를 모두 명시한다. query parameter와 fragment는 허용하지 않는다.

애플리케이션은 URL을 구조적으로 분해해 PostgreSQL client에 전달한다. 실행 process의 `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`와 `PGOPTIONS`로 URL의 빈 값을 보충하지 않는다. `sslnegotiation=postgres`, UTF-8과 `synchronous_commit=on`도 client 설정에 고정한다.

`holderIdEnv`의 값은 instance마다 달라야 하며 process 수명 동안 바뀌면 안 된다. Kubernetes에서는 StatefulSet pod identity 또는 충돌하지 않는 배포 instance ID를 사용한다.

## 5. 시험

실제 PostgreSQL container 시험은 다음 명령으로 실행한다.

```powershell
npm run test:control-store:postgres
```

기본 `npm run verify`는 Docker를 시작하지 않는다. 일반 통합시험은 이 시험 파일을 읽되 `MOLIT_POSTGRES_INTEGRATION_URL`이 없으면 명시적으로 건너뛴다. 위 명령만 임시 PostgreSQL을 기동하고 같은 환경변수를 시험 process에 전달한다.

시험은 digest로 고정한 PostgreSQL 17.10 image, 임시 host port와 고유 Compose project 이름을 사용한다.

state와 lease connection은 runtime과 같은 `createPostgresPool` factory로 만든다. migration 관리자 connection만 별도 pool로 두며 성공과 실패 경로에서 container, network와 volume을 제거한다.

이 시험은 로컬 전용 connection에서 TLS를 끄고 transaction 직렬화, pool 분리, advisory lock과 fencing token을 확인한다. 운영 `verify-full`, database failover와 인증서 회전은 별도 통합시험이 필요하다.

## 6. 현재 제한

- CaaS와 DSaaS는 각각 전체 상태를 한 JSONB row에 저장한다. 서로 다른 tenant도 같은 component 안에서는 write가 직렬화된다.
- 감사 event와 idempotency record가 snapshot 안에서 증가한다. 대규모 운영 전에는 append-only 감사 table, idempotency partition·TTL과 outbox로 분리해야 한다.
- migration은 database cluster, backup, replication, PITR와 role 생성을 구성하지 않는다.
- PostgreSQL fencing token은 제어 평면 state commit을 보호한다. 실제 Kubernetes adapter의 resource UID·version CAS와 지연된 이전 token 거부는 아직 구현하지 않았다.
- 장애조치 중 commit 결과가 불명확하면 `*_STATE_COMMIT_UNKNOWN`을 반환한다. 호출자는 같은 idempotency key로 상태를 확인하고 재시도한다.
