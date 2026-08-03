# tenant 격리 구현

## 1. 적용 범위

`COM-TEN-001`은 tenant 식별자를 API 인자에만 두지 않는다. PostgreSQL login role, transaction context, 상태 row, 멱등성 record, outbox, object key, secret reference, metric label과 감사 event에 같은 tenant 경계를 적용한다.

production CaaS와 DSaaS의 runtime 상태값 정본은 `scoped_control_state`다. `PostgresScopedControlStore`는 그 정본만 읽고 쓰는 production runtime component다.

CaaS tenant와 DSaaS dataspace는 서로 다른 row에 저장된다. 한 tenant의 요청이 다른 tenant payload를 메모리에 올리는 경로도 허용하지 않는다.

- **(정본 범위)** Runtime 상태: `scoped_control_state`; 접근 구현: `PostgresScopedControlStore`
- **(정본 범위)** 로컬 P0 실행 판정: `.local/p0/local-verification.json`
- **(정본 범위)** 상용 준비 판정: `governance/commercial-readiness-register.v1.json`
- **(판정 근거: C1-03)** 저장값·실행 결과·운영 증거는 판정 질문이 달라 서로 대체하지 않는다.

| 파일 | 역할 |
| --- | --- |
| `deploy/control-store/postgres/004_authoritative_scoped_state.sql` | component principal, scoped state, scope registry, current·cutover root와 RLS 설치 |
| `deploy/control-store/postgres/runtime-role-bootstrap.sql` | CaaS·DSaaS runtime role의 최소 권한과 기존 scope binding 등록 |
| `src/control-store/postgres-scoped-control-store.mjs` | scope별 읽기·쓰기, 멱등성, 감사·outbox 원자 커밋, fencing |
| `src/control-store/scoped-cutover.mjs` | 기존 상태 검증, scope 분해, 승인 증거와 cutover receipt 기록 |
| `src/control-store/postgres-tenant-store.mjs` | 접근 감사, object·secret·metric 보조 원장 |
| `src/caas/runtime.mjs`, `src/dsaas/runtime.mjs` | production에서 scoped-authoritative store 선택 |
| `tests/integration/scoped-control-store-postgres.test.mjs` | 실제 PostgreSQL cutover, RLS, 원자성, outbox·orphan 회수 시험 |
| `tests/integration/tenant-isolation-postgres.test.mjs` | tenant context와 보조 원장의 교차 접근 시험 |

## 2. 상태 정본과 색인

### 2.1 scope 상태

`scoped_control_state`는 `(component, tenant_id)`를 기본키로 쓴다. CaaS row에는 tenant 하나, DSaaS row에는 dataspace 하나만 들어간다. `revision`, payload digest와 갱신시각을 함께 기록한다.

멱등성 record는 `idempotency_record`에 scope별로 저장한다. CaaS key는 다음 형식으로 인코딩한다.

```text
v1.{base64url(scope)}.{base64url(key)}
```

이 형식은 PostgreSQL `text`에 저장할 수 없는 NUL 구분자를 쓰지 않는다. 승인된 legacy file 전환에서 NUL key가 발견되면 같은 의미의 `v1` key로 변환하고 변환 건수를 receipt에 남긴다.

### 2.2 전역 색인

`control_scope_registry`는 scope ID, 상태 revision·digest, 멱등성 건수와 CaaS 기술 식별자를 보관한다. CaaS의 participant ID, connector namespace와 endpoint에는 component 단위 unique index가 적용된다.

DSaaS 참가자의 CaaS tenant ID, connector participant ID와 namespace는 `control_participant_registry`에서 전체 dataspace를 가로질러 중복을 막는다. 이 table은 DSaaS runtime role만 변경할 수 있다.

scope 목록은 platform context에서 ID만 읽는다. 서비스와 scheduler는 목록을 받은 뒤 각 scope를 별도 transaction으로 읽는다. 전체 tenant payload를 한 query로 가져오지 않는다.

## 3. 승인된 전환

전환 함수는 superuser 또는 `BYPASSRLS`를 가진 전용 migration role만 실행할 수 있다. production runtime role은 이 권한을 가져서는 안 된다.

허용하는 source는 세 가지다.

| `source_kind` | 조건 |
| --- | --- |
| `fresh-install` | 기존 snapshot, 정규화 row와 잔여 상태가 모두 없음 |
| `json-snapshot` | 기존 DB snapshot과 정규화 row가 의미상 정확히 일치함 |
| `legacy-file-snapshot` | source artifact digest, 승인자, 승인시각과 승인 증거 digest가 있는 외부 file |

멱등성 record의 scope를 source만으로 결정할 수 없으면 승인된 scope map이 필요하다. map에는 source digest, record별 scope, 승인자와 승인 증거 digest를 둔다. 추정값으로 전환하지 않는다.

전환 transaction은 다음 항목을 한 번에 수행한다.

1. source 상태와 정규화 row의 일치 여부를 검사한다.
2. scope별 상태와 멱등성 record를 만든다.
3. scope registry와 DSaaS participant registry를 만든다.
4. 기존 감사 chain과 `audit.appended` outbox를 대조한다.
5. component audit head와 상태 root를 기록한다.
6. `control_store_mode`를 `scoped-authoritative`로 바꾼다.

`cutover_state_root_sha256`는 전환 시점의 불변 증거다. `state_root_sha256`는 runtime commit마다 바뀌는 현재 root다. 재시작 검사는 전자를 배포 receipt와 비교하고, 후자를 `component_audit_head.state_root_sha256`와 비교한다.

전환이 끝난 뒤 runtime role에는 `json_snapshot`의 `SELECT`, `INSERT`, `UPDATE`, `DELETE` 권한이 모두 없어야 한다. `PostgresScopedControlStore.initialize()`가 이 조건을 직접 확인한다. 권한이 하나라도 남아 있으면 readiness가 열리지 않는다.

## 4. database principal binding

RLS는 클라이언트가 설정한 `molit.tenant_id`만 신뢰하지 않는다. 다음 두 binding이 모두 활성 상태여야 row가 보인다.

- `control_component_principal`: login role을 `caas` 또는 `dsaas` 한 component에 고정한다.
- `tenant_database_principal`: login role, tenant ID와 `service` access mode를 고정한다.

runtime role은 login 가능하되 `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`를 모두 갖지 않는다. CaaS role과 DSaaS role도 서로 달라야 한다.

신규 scope 생성은 `enroll_scoped_service_principal(target_tenant_id, target_component)`를 호출한다. 이 함수는 다음 조건을 모두 확인한 뒤 현재 login role에 target service binding을 추가한다.

1. component binding이 현재 login role과 일치한다.
2. store mode가 `scoped-authoritative`다.
3. `molit-platform` service 위임이 활성 상태다.
4. actor가 `service:{component}-scoped-store`다.
5. trace ID와 correlation ID가 유효하다.

임의 database role은 함수 인자로 받지 않는다. 과거 상태 투영용 enrollment 함수의 실행 권한은 runtime role에서 회수한다. bootstrap은 cutover 당시에 존재한 모든 scope binding도 등록하므로 재시작 직후 기존 row가 보이지 않는 상태를 만들지 않는다.

권한의 정본은 SQL 예제를 복사한 문단이 아니라 `runtime-role-bootstrap.sql`이다. 특히 `control_store_mode`에서는 현재 root와 `updated_at` 두 열만 갱신할 수 있다. source digest, 승인 증거, cutover root와 cutover 시각은 runtime이 바꿀 수 없다.

## 5. transaction context

모든 runtime transaction은 `set_config(..., true)`로 다음 값을 설정한다. 세 번째 인자를 `true`로 두어 pool session에 값이 남지 않게 한다.

| 설정 | 값 |
| --- | --- |
| `molit.tenant_id` | 현재 scope 또는 `molit-platform` |
| `molit.actor_id` | 사용자 또는 workload 식별자 |
| `molit.access_mode` | `tenant`, `service`, `break-glass` 중 하나 |
| `molit.trace_id` | W3C trace ID 32자리 |
| `molit.correlation_id` | 관리 요청과 후속 작업을 묶는 ID |
| `molit.break_glass_reason` | 승인된 비상 접근 사유 |
| `molit.break_glass_expires_at` | 비상 접근 종료시각 |

component binding, tenant binding과 transaction context 중 하나라도 맞지 않으면 `FORCE ROW LEVEL SECURITY`가 row를 숨긴다. 같은 tenant ID를 CaaS와 DSaaS가 함께 사용해도 component binding이 다르므로 서로의 row를 읽을 수 없다.

## 6. 상태·감사·outbox 원자성

scope 변경 transaction은 component의 registry lock과 audit head를 먼저 잠근다. 이후 다음 쓰기를 같은 PostgreSQL transaction에서 처리한다.

1. `scoped_control_state` payload와 revision
2. scope의 `idempotency_record`
3. 기술 식별자와 participant unique registry
4. domain audit event
5. 현재 상태 root를 기록한 `STATE_COMMITTED` 또는 `state.commit` event
6. 각 audit event의 `audit.appended` outbox
7. component audit head와 current state root

상태나 멱등성이 바뀌었는데 domain audit가 추가되지 않으면 commit을 거부한다. audit와 outbox 건수가 어긋나는 부분 성공도 허용하지 않는다. 소비 계약이 없는 `resource.upserted`, `resource.deleted` event는 발행하지 않는다.

Kubernetes orphan 회수는 등록된 tenant 상태가 없으므로 `molit-platform` audit로 남긴다. affected tenant는 `orphanTenantId`에 기록한다. resource fencing token의 유효성, target scope의 부재, audit·outbox와 audit head 갱신을 한 transaction에서 검사한다.

## 7. outbox 순회

WORM dispatcher는 다음 모드로 동작한다.

```js
const outbox = new PostgresOutbox({
  pool,
  component: "caas",
  workerId: "worm-audit-dispatcher",
  eventTypes: ["audit.appended", "tenant.security.access"],
  tenantService: {
    actorId: "service:worm-audit-dispatcher",
    discoverFromRegistry: true,
    registryMode: "scoped-authoritative",
  },
});
```

dispatcher는 `control_scope_registry`에서 ID만 읽고 각 tenant context에서 claim한다. claim한 event ID와 tenant ID를 함께 기억한다. 다른 tenant context로 acknowledge하거나 reject하면 `OUTBOX_CLAIM_LOST`로 거부한다.

## 8. 보조 저장소 경계

### 8.1 object

object 원장에는 binary가 아니라 key와 digest를 저장한다.

```text
tenants/{tenantId}/{canonical-suffix}
```

절대경로, 빈 segment, `.`·`..` segment와 이중 slash를 거부한다. S3 호환 저장소의 bucket policy에도 같은 prefix 조건을 적용해야 한다.

### 8.2 secret

secret 원장에는 값이 아니라 reference만 저장한다.

```text
vault://tenants/{tenantId}/{logical-path}
k8s-secret://molit-caas-{tenantId}/{secret-name}#{key}
```

다른 tenant 경로, query string, 경로 이동과 secret 원문을 거부한다. Vault policy와 Kubernetes RBAC도 같은 tenant 경계를 가져야 한다.

### 8.3 metric과 거부 감사

metric sample의 `labels["tenant.id"]`는 row의 `tenant_id`와 같아야 한다. 관리 API 거부는 응답 전에 `tenant_security_audit`와 outbox에 함께 기록한다. RLS가 application 밖의 임의 SQL을 직접 거부한 경우는 PostgreSQL connection·statement 감사가 담당한다.

## 9. 재현 시험

다음 명령은 고정된 PostgreSQL image로 migration과 runtime 권한을 적용하고 시험 뒤 volume과 network를 제거한다.

```powershell
npm run test:control-store:postgres
```

`P0 scoped authoritative store cuts over losslessly and enforces runtime isolation` 시험은 다음 항목을 실제 PostgreSQL에서 확인한다.

1. 승인된 legacy file과 기존 DB snapshot을 손실 없이 scope로 전환한다.
2. NUL 기반 CaaS 멱등성 key를 DB-safe key로 변환한다.
3. runtime의 legacy snapshot 접근과 과거 enrollment 실행을 거부한다.
4. 같은 tenant ID의 CaaS·DSaaS row를 component별로 격리한다.
5. 기술 식별자 중복과 tenant 용량을 동시 요청에서도 강제한다.
6. 상태, 멱등성, 감사, outbox와 current root를 원자적으로 커밋한다.
7. cutover root가 첫 runtime commit 뒤에도 바뀌지 않는지 확인한다.
8. scoped WORM claim과 잘못된 tenant acknowledge를 검증한다.
9. orphan 회수의 platform audit와 outbox를 검증한다.

## 10. 운영 경계

Repository 시험은 PostgreSQL row, durable outbox, object·secret reference와 metric label을 검증한다.

운영 object storage의 bucket policy, Vault ACL, Kubernetes Secret RBAC와 OTLP backend의 label 보존은 배포 환경 종단시험에서 확인해야 한다.

Offboarding은 보존기간, pending outbox, WORM export와 법적 보존 결정을 먼저 확인한다.

Scope registry와 database principal binding을 먼저 지우면 남은 감사와 outbox를 tenant context로 처리할 수 없다. 삭제 순서와 tombstone 정책은 별도 운영 절차로 고정한다.
