# DSaaS 제어 평면

## 1. 구현 범위

이 제어 평면은 데이터 스페이스와 참여기관 membership의 원하는 상태를 기록하고, 승인된 참여기관의 Connector 상태를 CaaS에 전달한다.

현재 구현 범위는 다음과 같다.

- 데이터 스페이스 생성과 `ACTIVE`·`SUSPENDED` 상태 변경
- 참여기관 신청과 4-eyes 승인
- MOLIT DCAT-AP·거버넌스 artifact의 IRI·version·SHA-256 고정
- CaaS Connector plan과 참여기관 기술 식별자의 일치 검사
- 필수 서비스 Registry 검사와 reconcile마다 수행하는 외부 승인 결정 Registry 재검증
- 만료·철회·Registry 오류가 난 승인의 durable 철회 의도 기록과 CaaS `SUSPENDED` 수렴
- generation fencing을 적용한 CaaS 수렴
- 응답 계약과 tenant·generation·plan·intent 상관관계를 고정한 CaaS 호출
- 중복 tick을 막고 한 번에 처리할 수를 제한한 주기 reconcile scheduler
- Production RFC 7662 introspection, MFA·service mTLS binding, 역할별 접근제어
- CaaS outbound OAuth2 client credentials·mTLS와 인증서 무중단 회전
- PostgreSQL dataspace-scoped 정본·CAS, component·tenant FORCE RLS, 별도 state·lease pool과 fencing token
- trace·metric·log, WORM 감사 outbox와 비과금 management usage 원장
- 개발·시험용 atomic file store와 상태 snapshot 감사 결합

실제 기관 승인 시스템과 연결하는 Adapter는 구현하지 않았다. 예제 승인 Registry의 상태도 `NOT_CONFIGURED`다. 따라서 예제 설정 그대로는 참여기관을 승인할 수 없다.

## 2. 구성

| 경로 | 역할 |
| --- | --- |
| `src/dsaas/service.mjs` | 데이터 스페이스·참여기관 상태와 CaaS 수렴 |
| `src/dsaas/store.mjs` | 상태 검증, atomic file backend, snapshot·감사 hash chain |
| `src/control-store/postgres-scoped-control-store.mjs` | PostgreSQL dataspace 정본, CAS, audit·outbox 원자 커밋과 fencing lease |
| `src/dsaas/server.mjs` | HTTPS 관리 API, Host·body·timeout 제한과 관측 event |
| `src/dsaas/auth.mjs` | 개발용 인증과 운영 identity authenticator 연결 |
| `src/dsaas/caas-client.mjs` | OAuth2·mTLS CaaS `POST /v1/connectors/ensure` 호출 |
| `src/dsaas/scheduler.mjs` | bounded 주기 reconcile과 중복 tick 방지 |
| `src/dsaas/service-registry.mjs` | 필수 서비스 Registry의 digest·유효기간 검사 |
| `src/dsaas/approval-registry.mjs` | 외부 승인 결정 Registry의 digest·결정 binding 검사 |
| `src/observability/runtime-bundle.mjs` | trace·metric·log, WORM와 usage dispatcher 조립 |
| `contracts/dsaas-*.schema.json` | API 입력, 설정, identity·observability와 Registry 계약 |
| `fixtures/dsaas/` | 운영자가 교체해야 하는 설정과 요청 예시 |

`governance/molit-dataspace-governance.v1.json`은 후보 문서다. 파일의 상태는 `candidate-not-institutionally-approved`이며 운영기관 승인본이 아니다.

CaaS provisioner는 승인된 plan에 따라 Connector 인프라를 생성·갱신·회수할 수 있다. 이 권한은 참여기관 asset 조회나 실제 데이터 접근 권한을 포함하지 않는다. 후보 거버넌스는 두 권한을 별도 항목으로 고정한다.

### 2.1 PostgreSQL 상태와 reconcile lease

production 설정은 PostgreSQL backend와 `verify-full` TLS를 강제한다. DSaaS는 `component=dsaas`의 dataspace row 하나만 transaction에 올린다. 참여기관 identity registry, 멱등성, 감사와 outbox는 같은 commit 경계에 둔다.

transaction은 대상 row를 `FOR UPDATE`로 읽고 `revision`을 비교하는 조건부 `UPDATE`로 바꾼다. state transaction과 reconcile lease는 서로 다른 pool을 사용한다.

따라서 장시간 CaaS 호출이 lease connection을 점유해도 state pool의 connection을 모두 소진하지 않는다.

데이터 스페이스별 reconcile은 `dataspace:{dataspaceId}`를 자원 ID로 한 session advisory lock을 획득한다. lock을 얻을 때 `resource_fence`의 token을 증가시키고 holder와 획득 시각을 기록한다. 같은 데이터 스페이스에 대한 다른 instance의 reconcile은 `DSAAS_RECONCILE_IN_PROGRESS`로 거부된다.

lease connection이 끊기면 reconcile의 `AbortSignal`을 취소한다. state transaction은 현재 token, holder와 미해제 상태를 확인한 경우에만 commit한다.

정리 단계는 제한된 시간 안에 fence row와 advisory lock을 해제한다. 해제 결과가 불명확하면 connection을 폐기한다.

Dataspace 상태, 멱등성, 감사, outbox, object·secret reference, metric과 usage는 tenant별로 조회한다.

`control_scope_registry`, participant identity registry와 component audit head 갱신은 component 단위로 직렬화한다. 모든 table에는 component·tenant FORCE RLS와 database principal binding을 적용한다.

## 3. API

| Method | 경로 | 권한 | 기능 |
| --- | --- | --- | --- |
| `GET` | `/healthz` | 없음 | 프로세스 생존 확인 |
| `GET` | `/readyz` | 없음 | 로컬 state·서비스 Registry·승인 Registry·scheduler 준비 상태 확인 |
| `POST` | `/v1/dataspaces` | `dsaas.operator` | 데이터 스페이스 생성 |
| `GET` | `/v1/dataspaces/{id}` | operator·admin·auditor | 데이터 스페이스 조회 |
| `PUT` | `/v1/dataspaces/{id}/desired-state` | operator·admin | 원하는 상태 변경 |
| `POST` | `/v1/dataspaces/{id}/reconcile` | operator·admin | 필수 서비스와 Connector 수렴 |
| `POST` | `/v1/dataspaces/{id}/participants` | operator·admin | 참여기관 신청 |
| `GET` | `/v1/dataspaces/{id}/participants/{participantId}` | operator·admin·auditor | 참여기관 조회 |
| `POST` | `/v1/dataspaces/{id}/participants/{participantId}/approval` | operator·admin | 외부 결정 확인 후 승인 |

변경 요청에는 `Idempotency-Key`가 필요하다. 원하는 상태 변경에는 현재 revision을 담은 `If-Match`도 필요하다.

같은 key와 같은 입력은 저장된 응답을 반환한다. 같은 key를 다른 입력에 쓰면 `409`로 거부한다.

승인 API도 먼저 이 원장을 read-only로 확인한다. 완료된 exact replay는 현재 승인 Registry를 다시 읽지 않고 저장 응답을 반환한다. ledger miss일 때만 Registry를 읽으며, state transaction 안에서 ledger를 다시 확인해 동시 요청의 TOCTOU를 막는다.

`/readyz`의 범위는 `LOCAL_CONTROL_PLANE`이다. 매 요청에서 bounded scope와 감사 chain을 다시 검증한다. PostgreSQL backend는 scoped-authoritative mode, current root, state pool과 별도 lease pool의 연결도 확인한다.

서비스 Registry와 승인 결정 Registry도 원본 파일에서 다시 읽는다. 이 과정에서 시작 시 설정에 고정된 digest와 유효기간을 검사하고, 승인 Registry는 `READY` 상태인지도 확인한다. scheduler가 설정된 runtime에서는 마지막 tick의 지연과 대상별 실패도 검사한다.

Production은 운영 identity 설정과 직접 HTTPS용 TLS material이 없으면 시작하지 않는다. RFC 7662 mode에서 issuer·audience, scope, 만료와 폐기 상태를 확인한다.

OIDC JWKS는 durable revocation Registry가 연결될 때까지 production 설정에서 거부한다.

사람 principal은 MFA claim을 요구한다. service principal은 token `cnf`와 신뢰한 client certificate의 결합을 요구한다.

listener를 열기 전에 state, 서비스 Registry, 승인 결정 Registry, TLS와 observability의 로컬 readiness도 확인한다. 하나라도 준비되지 않으면 시작을 중단한다.

development와 test에서는 HTTP listener가 scheduler의 첫 tick 전에 열릴 수 있다. 첫 tick이 끝날 때까지 `/healthz`는 응답하지만 `/readyz`는 `503`을 반환한다.

각 HTTP 요청에는 `requestTimeoutMs` 하나의 전체 deadline을 적용한다. readiness 검사, OAuth2 introspection, 조회, 변경 요청은 같은 `AbortSignal`을 전달받는다.

deadline을 넘기면 `DSAAS_REQUEST_TIMEOUT`과 `408`을 반환한다. client가 연결을 끊으면 `DSAAS_REQUEST_ABORTED`로 중단한다. 아직 읽지 않은 request body가 있으면 connection을 폐기한다.

승인 결정 Registry와 서비스 Registry의 digest 불일치, 중복 ID, 유효기간 경과, 갱신 실패는 관리 요청에서도 `503 Service Unavailable`로 반환한다. 응답에는 원래 오류 코드를 보존하고 `Retry-After: 60`을 넣는다.

`/readyz`가 같은 Registry 오류로 `503`을 반환할 때도 `Retry-After: 60`을 넣는다. 파일 부재, 읽기 실패, JSON 구문 오류와 Registry schema 위반은 각각 `DSAAS_APPROVAL_REGISTRY_REFRESH_FAILED` 또는 `DSAAS_SERVICE_REGISTRY_REFRESH_FAILED`로 정규화한다.

이 header는 60초 뒤 복구를 보장한다는 뜻이 아니다. 운영자는 Registry 원본과 설정 digest를 바로잡아야 하며, 호출자는 이 시간보다 짧은 간격으로 같은 요청을 반복하지 않는다.

PostgreSQL 상태 오류는 원래 code를 숨기지 않는다. `DSAAS_STATE_ABORTED`, `DSAAS_STATE_CLOSED`, `DSAAS_STATE_COMMIT_UNKNOWN`, `DSAAS_STATE_TIMEOUT`, `DSAAS_STATE_UNAVAILABLE`와 `DSAAS_RECONCILE_FENCE_LOST`는 `503`과 `Retry-After: 1`로 반환한다.

`DSAAS_STATE_LOCKED`, `DSAAS_STATE_MIGRATION_REQUIRED`, `DSAAS_STATE_MISSING`은 운영자 조치가 필요하므로 `Retry-After`를 넣지 않는다. `DSAAS_STATE_TOO_LARGE`는 재시도로 해소되지 않으므로 `507`을 반환한다.

`DSAAS_STATE_COMMIT_UNKNOWN`은 `COMMIT` 전송을 시작한 뒤 connection 결과를 확인하지 못했다는 뜻이다. 같은 요청을 새 key로 다시 만들면 부작용이 중복될 수 있다.

호출자는 먼저 resource 상태를 조회한다. 재시도가 필요하면 원래 `Idempotency-Key`와 본문을 그대로 사용하고, 운영자는 database transaction과 감사 record를 대조한다.

현재 runtime은 Registry 파일만 동적으로 교체해 새 digest를 신뢰하지 않는다. `serviceRegistrySha256`과 `approvalDecisionRegistrySha256`는 process 시작 시 config에 고정된다.

새 snapshot을 승인하려면 파일과 승인된 config manifest를 함께 배포하고 process를 재시작해야 한다. 서명키와 단조 revision을 사용하는 동적 trust-anchor 갱신은 아직 구현되지 않았으며 운영 자동 갱신의 release blocker다.

DSaaS 서버는 Node HTTPS listener에서 TLS를 직접 종료한다. 인증서·개인키·client CA를 주기적으로 다시 읽는다.

유효하지 않은 교체본은 적용하지 않고 readiness를 내린다. CaaS outbound도 OAuth2 client credentials와 mTLS material을 회전하며 새 세대가 적용되면 token cache를 폐기한다.

응답의 `checks.caas`는 현재 `NOT_VERIFIED`다. DSaaS의 CaaS client에는 readiness 조회 계약이 없으므로 `/readyz`는 CaaS, Identity Hub, Federated Catalog까지 살아 있다는 뜻이 아니다. 운영 load balancer가 이 응답을 end-to-end 준비 상태로 해석해서는 안 된다.

## 4. 데이터 스페이스 생성 조건

생성 요청은 `fixtures/dsaas/dataspace.example.json` 형식을 따른다. 제어 평면은 다음 값을 정확히 비교한다.

1. 승인 목록의 MOLIT DCAT-AP IRI, version, SHA-256
2. 승인 목록의 거버넌스 묶음 IRI, version, SHA-256
3. 승인 목록의 Connector plan ID
4. 승인된 namespace origin
5. 환경별 identity mode

`namespaceBase`와 artifact IRI에는 URL userinfo, query, fragment를 넣을 수 없다. 참여기관의 `connectorNamespace`와 `evidence.uri`에도 같은 규칙을 적용한다. Registry ID, 서비스 endpoint, CaaS가 반환한 Connector endpoint도 이 검사를 통과해야 저장된다.

운영 환경은 `dcp`만 허용한다. `test-token`은 개발·시험 환경에서만 설정할 수 있다.

생성된 record에는 다음 수렴 표지가 들어간다.

```text
desiredGeneration = 1
appliedGeneration = 0
reconcilePending = true
```

원하는 상태나 승인된 참여기관 집합이 바뀌면 `desiredGeneration`이 증가한다. 최신 세대가 필수 서비스와 CaaS에 반영된 경우에만 `appliedGeneration`이 따라간다.

## 5. 참여기관 식별자와 Connector plan

참여기관 요청은 `fixtures/dsaas/participant.example.json` 형식을 따른다.

| 필드 | 의미 |
| --- | --- |
| `participantId` | DSaaS membership ID |
| `organizationId` | 법적·행정 기관 식별자 |
| `caasTenantId` | CaaS tenant ID |
| `connectorParticipantId` | DSP·DCP에서 사용하는 참여기관 ID |
| `connectorNamespace` | 참여기관 Connector namespace |

`connectorPlanId`는 데이터 스페이스의 plan과 같아야 한다. 승인 목록에 존재하더라도 데이터 스페이스 plan과 다르면 신청을 거부한다.

다음 세 기술 식별자는 DSaaS 전체에서 중복될 수 없다.

- `caasTenantId`
- `connectorParticipantId`
- 정규화한 `connectorNamespace`

동일 기관이 여러 데이터 스페이스에 참여하면서 Connector를 공유하려면 별도 공유 모델과 권한 경계를 먼저 정의해야 한다. 현재 계약은 격리형 Connector를 기준으로 중복을 막는다.

## 6. 외부 승인 Gate

로컬 관리자가 evidence digest만 입력해 기관 승인을 대신할 수 없도록 외부 결정 Registry를 추가했다.

승인 처리에는 다음 조건이 모두 필요하다.

1. 신청자와 승인 API 호출자의 OAuth2 subject가 다르다.
2. 입력한 `evidenceSha256`가 신청 record와 같다.
3. 고정 SHA-256으로 읽은 승인 결정 Registry의 상태가 `READY`다.
4. Registry의 `issuedAt`, `validUntil`, 설정의 `maxAgeSeconds`가 현재 시각에 유효하다.
5. `decisionId`가 데이터 스페이스, membership, 기관, evidence digest를 정확히 묶는다.
6. 결정 상태가 `APPROVED`이며 결정 자체의 유효기간이 남아 있다.

승인 record에는 결정기관, 결정 시각, 유효기간, provenance SHA-256, Registry SHA-256을 저장한다.

승인은 일회성 검사가 아니다. 수동 API와 주기 scheduler가 실행하는 모든 reconcile은 승인 Registry를 다시 읽고, 승인된 각 참여기관의 결정을 현재 시각으로 재검증한다. 만료·철회·Registry stale·digest mismatch가 발견되면 다음 순서로 처리한다.

1. 원격 호출 전에 현재 `connector`를 `lastKnownConnector`로 옮긴다.
2. `approvalState=REAPPROVAL_REQUIRED`, `observedState=REVOKING`, `revokePending=true`를 먼저 state에 기록한다.
3. 데이터 스페이스를 `BLOCKED`로 두고 CaaS에 `desiredState=SUSPENDED`를 보낸다.
4. CaaS가 `SUSPENDED`를 확인하면 `revokePending=false`로 바꾼다. 호출 실패나 미완료 상태이면 `revokePending=true`를 유지한다.

기관이 새 결정을 발급하면 같은 approval API에 새 `decisionId`와 기존 신청 evidence digest를 제출한다. 새 결정도 현재 Registry에서 검증되어야 한다. 검증을 통과하면 `APPROVED`로 돌아가고 다음 reconcile이 `ACTIVE` 수렴을 다시 시도한다. 철회된 결정을 그대로 재사용할 수는 없다.

`fixtures/dsaas/approval-decision-registry.example.json`은 `NOT_CONFIGURED`이고 결정 목록이 비어 있다. 실제 승인 시스템에서 서명된 결정을 수집·검증하는 Adapter는 아직 없다.

따라서 외부 승인 Adapter, 결정 서명 검증, 승인기관 운영 절차가 완료되기 전까지 참여기관 개통은 release blocker다. 시험은 명시적으로 만든 test-only trusted Registry를 사용한다.

## 7. 서비스 Registry 유효기간

서비스 Registry는 CaaS, Identity Hub, Federated Catalog 등 필수 서비스의 준비 상태를 기록한다.

다음 세 검사를 통과해야 한다.

- JSON의 stable digest가 설정의 `serviceRegistrySha256`와 같다.
- 현재 시각이 Registry의 `issuedAt`과 `validUntil` 사이에 있다.
- Registry와 각 서비스 관찰 시각이 `serviceRegistryMaxAgeSeconds`보다 오래되지 않았다.

프로세스가 시작된 뒤 유효기간이 끝나는 경우도 reconcile 때 다시 판정한다. 이전 상태가 `READY`여도 유효기간이 지나면 `effectiveStatus=STALE`로 바꾸고 데이터 스페이스를 `BLOCKED`로 둔다.

필수 서비스 Gate는 관찰용 표시가 아니다. 하나라도 준비되지 않았거나 Registry를 검증하지 못하면 승인된 활성 Connector마다 `intent=SERVICE_BLOCK`, `desiredState=SUSPENDED` 요청을 보낸다.

CaaS가 `ACTIVE`를 반환하면 응답을 거부한다. 새 Registry 파일과 고정 digest config를 승인된 절차로 함께 배포하고 process를 재시작한 뒤 검증이 성공해야 원래 desired state를 다시 적용한다.

`fixtures/dsaas/service-registry.example.json`의 서비스는 모두 `NOT_READY`다. 운영 증거로 교체하기 전에는 활성 상태를 만들 수 없다.

## 8. generation fencing과 CaaS 수렴

reconcile은 데이터 스페이스별 resource lock 안에서 다음 순서로 실행한다.

1. state store에서 최신 revision과 `desiredGeneration`을 읽는다.
2. 승인된 참여기관별 CaaS 요청을 만들고 `desiredGeneration`을 본문에 넣는다.
3. 요청, `caasTenantId`·`desiredGeneration`·`connectorPlanId`·intent와 현재 reconcile key의 stable digest로 CaaS idempotency key를 만든다.
4. `POST /v1/connectors/ensure`를 호출한다.
5. state transaction을 열고 revision과 generation을 다시 비교한다.
6. 값이 바뀌었으면 이전 관찰값을 저장하지 않고 1단계부터 다시 실행한다.
7. 값이 같을 때만 관찰 상태와 `appliedGeneration`을 저장한다.

이 절차는 원격 호출 도중 `ACTIVE`가 `SUSPENDED`로 바뀌는 경합을 처리한다. 첫 호출이 `ACTIVE`를 적용했더라도 fence 충돌을 확인한 같은 reconcile이 즉시 `SUSPENDED` 요청을 다시 보낸다.

interleaving 시험은 첫 CaaS 호출을 중단한 상태에서 원하는 상태를 바꾸고, CaaS가 `ACTIVE`, `SUSPENDED` 순서로 호출되는지 확인한다.

한 요청에서 허용하는 supersession 횟수는 `maxReconcileSupersessions`로 제한한다. 예제는 8회다.

제한을 넘으면 원격 호출을 중단하고 `DSAAS_RECONCILE_SUPERSEDED`를 반환한다. `reconcilePending=true`와 최신 `desiredGeneration`은 state에 남으므로 다음 bounded reconcile이 이어받는다.

지속적인 쓰기 경합은 한 요청을 무한히 점유하지 않는다. PostgreSQL backend는 여러 instance가 같은 데이터 스페이스에 들어오는 것을 advisory lock으로 직렬화하고, lease를 잃은 instance의 state commit을 fencing token으로 거부한다.

원하는 상태 변경은 장시간 reconcile lease를 기다리지 않고 짧은 state transaction에서 진행된다. 따라서 CaaS 원격 호출 중 새 generation이 기록될 수 있다.

reconcile은 원격 응답 뒤 revision과 generation을 다시 비교한다. 값이 바뀌었으면 관찰값을 버린 뒤 최신 명령을 같은 bounded loop에서 다시 적용한다.

주기 reconcile은 `reconcileScheduler.intervalMs`마다 due target만 순환한다. 한 tick은 `maxDataspacesPerTick`까지만 직렬 처리하고, 이전 tick이 끝나지 않았으면 새 tick을 건너뛴다.

각 데이터 스페이스는 freshness 경계 중 가장 이른 시각을 durable `nextCheckAt`으로 저장한다. 승인 결정·승인 Registry 외에 서비스 Registry 유효기간, 최대 age, 필수 서비스 evidence의 최대 age도 포함한다.

승인 Registry digest가 바뀌거나 Registry를 검증할 수 없으면 `nextCheckAt` 전에도 승인된 대상을 due로 판정한다.

서비스 Registry도 target 선택과 reconcile마다 원본 파일에서 다시 읽는다. 고정 digest와 다른 파일은 갱신으로 수용하지 않고 Registry unavailable로 처리한다.

승인된 파일·config 교체와 재시작 뒤 Registry digest나 저장한 서비스 관찰 projection이 달라지면 즉시 due가 된다.

`nextCheckAt` 전의 tick은 CaaS를 호출하지 않는다. state, revision, 감사 chain, 멱등성 원장도 쓰지 않는다. 첫 tick은 background에서 실행한다. server 종료가 시작되면 timer를 멈추고 진행 중인 tick의 `AbortSignal`을 취소한다.

due 이후에도 승인·서비스 projection과 Connector 관찰 상태가 모두 같으면 no-op으로 끝낸다. 서비스 장애가 계속되는 동안 같은 CaaS 요청과 state·감사 쓰기가 매 tick 누적되지 않는다.

필수 서비스가 준비되지 않았고 승인된 Connector가 모두 `SUSPENDED`에 도달했다면 서비스 재시도 시각을 별도로 잡지 않는다. `nextCheckAt`에는 다음 승인 검사 시각만 두며, 승인 검사 시각도 없으면 `null`을 둔다.

승인된 Registry 파일·config 교체 후 process를 재시작해 digest나 projection이 바뀌면 scheduler가 이 시각보다 먼저 다시 수렴한다.

검증된 서비스 Registry digest나 projection이 바뀌면 deadline과 관계없이 다시 due가 된다. 따라서 장애가 지속되는 동안 target scan이 같은 대상을 매 tick 고르지 않는다.

이 필드가 없는 기존 v1 record는 `reconcilePending` 값과 관계없이 한 번 due로 선택한다. 이 migration reconcile이 freshness 경계를 계산해 `nextCheckAt`을 저장한다.

scheduler 호출은 `system:dsaas-reconcile-scheduler` principal, `molit-dsaas-control-plane` client, `internal-reconcile-scheduler-v1` key로 감사한다. 사용 역할은 `dsaas.operator`다. 주기 실행은 외부 API 멱등성 원장을 소비하지 않는다.

여러 DSaaS instance의 scheduler가 같은 대상을 선택할 수는 있다. PostgreSQL의 데이터 스페이스별 lease가 실제 reconcile 중복 실행을 막는다.

cluster 전체 tick을 한 instance에 배정하는 leader election은 없다. 장애조치 지연, 대량 lock 경합과 scheduler 부하 분산은 별도 고가용성 시험 대상이다.

### 8.1 필수 서비스 Gate의 generation 전이

필수 서비스 projection의 준비 상태가 바뀌고 활성 승인 참여기관의 CaaS 명령에 영향을 주면 DSaaS는 `desiredGeneration`을 한 번 증가시킨다. 같은 장애가 지속되거나 같은 projection을 다시 읽을 때는 generation을 더 올리지 않는다.

통합시험의 고정 전이는 다음과 같다.

```text
generation 2: required service READY     -> dataspace ACTIVE, Connector ACTIVE
generation 3: required service NOT_READY -> dataspace BLOCKED, Connector SUSPENDED
generation 4: required service READY     -> dataspace ACTIVE, Connector ACTIVE
```

2→3 전이는 `intent=SERVICE_BLOCK`과 `desiredState=SUSPENDED`를 CaaS에 전달한다. 3→4 전이는 원래 참여기관 desired state를 다시 적용한다. 각 CaaS 요청에는 해당 generation이 들어가며, CaaS는 이전 generation의 새 명령과 같은 generation의 다른 본문을 거부한다.

### 8.2 종료 순서

`close()`는 먼저 readiness를 내리고 HTTP listener의 새 연결 수락을 중단한다. 이미 열린 연결에서 뒤늦게 들어온 관리 요청은 인증이나 state 접근 전에 `DSAAS_SHUTTING_DOWN`과 `503`을 받는다. `/healthz`는 process liveness 확인을 위해 계속 응답하고 `/readyz`는 `503`과 `status=stopping`을 반환한다.

scheduler stop과 HTTP drain은 `gracefulShutdownMs`로 계산한 하나의 절대 deadline을 공유한다. scheduler에 한 번, HTTP에 다시 한 번 같은 시간을 부여하지 않는다. deadline까지 두 작업이 끝나지 않으면 남은 socket을 닫고 `close()`를 반환한다.

종료 deadline timer는 process를 붙잡는 handle로 유지한다. CLI signal handler가 `close()`를 background Promise로 실행해도 cleanup 또는 deadline 판정 전에 process가 먼저 끝나지 않는다.

진행 중인 scheduler tick의 취소 신호는 `reconcileScheduled`, CaaS client, 공통 HTTP client까지 전달된다.

HTTP 관리 요청에도 request별 취소 신호를 둔다. 생성, desired-state 변경, 수동 reconcile, 참가자 제출, 참가자 승인 요청은 drain deadline까지 실행할 수 있다.

deadline이 지나면 신호를 취소하고 각 service transaction의 commit 경계에서 중단한다.

CaaS Adapter가 취소를 무시하고 나중에 성공 응답을 반환하더라도 서비스는 신호를 다시 확인한다. 그 관찰값은 state transaction에 넘기지 않으며 종료 뒤에는 새 tick도 시작하지 않는다.

PostgreSQL transaction은 `COMMIT` 전에 취소와 현재 lease fence를 다시 확인한다. `COMMIT` 시작 뒤 결과가 불명확하면 `DSAAS_STATE_COMMIT_UNKNOWN`을 반환한다. 성공한 durable commit을 뒤늦은 취소로 실패 처리하지 않는다.

development·test의 file backend는 임시 파일을 원본으로 바꾸기 직전에 취소 신호를 다시 검사한다. 취소가 먼저 도착하면 원본 state를 유지하고, atomic replace가 먼저 끝났다면 성공으로 반환한다.

`start()`와 `close()`에는 lifecycle epoch를 적용한다. listen callback이 오기 전에 종료가 시작되면 늦게 도착한 callback은 listener를 닫고 `DSAAS_START_ABORTED`로 끝난다. 이 경로에서는 scheduler를 시작하지 않는다.

runtime은 server와 scheduler drain을 마친 뒤 state store를 닫는다. PostgreSQL store는 state pool과 lease pool을 함께 종료한다.

실제 CaaS·Kubernetes 작업의 취소와 보상은 하위 Adapter까지 `AbortSignal`로 전달된다. Kubernetes Adapter는 적용 실패 시 사전 snapshot rollback을 시도한다. 운영 cluster의 장애 상황에서 같은 결과를 승인하는 시험은 상용 Gate에 남긴다.

## 9. CaaS 오류 관찰

CaaS 응답은 `contracts/caas-connector-ensure-response.v1.schema.json`을 정확히 만족해야 한다. 추가 속성도 거부한다. `connectorId`는 요청의 `caasTenantId`와 같아야 하고, 데이터 스페이스 ID와 Connector participant ID도 요청과 일치해야 한다.

철회 intent의 응답은 `ACTIVE`일 수 없다. endpoint가 있으면 HTTPS만 허용하며 userinfo, query, fragment는 거부한다.

token, secret, credential, private key, DataAddress와 같은 필드가 응답에 들어오면 응답 전체를 거부한다. 외부 오류 문자열은 저장하지 않으며 제한된 형식의 오류 코드만 남긴다.

성공 관찰과 현재 관찰은 다음처럼 분리한다.

| 필드 | 오류 전 | 오류 후 |
| --- | --- | --- |
| `connector` | 현재 검증된 관찰값 | `null` |
| `lastKnownConnector` | 마지막 성공 관찰값 | 그대로 유지 |
| `lastError` | `null` | 정규화한 code와 시각 |

오류가 발생했는데 이전 `connector`를 현재 상태처럼 노출하지 않는다. 운영 화면은 `connector`와 `lastKnownConnector`를 구분해 표시해야 한다.

CaaS timeout과 `ERROR` 응답은 `caasRetry`에 기록한다. 이 객체에는 오류 fingerprint, 오류 코드 집합, 최초·최근 실패 시각, attempt, nominal delay, 실제 delay, `nextRetryAt`이 들어간다. nominal delay는 `caasRetryBaseMs * 2^(attempt-1)`로 늘리되 `caasRetryMaxMs`에서 멈춘다.

동시에 장애가 난 데이터 스페이스가 한 시각에 몰리지 않도록 `dataspaceId`, 오류 fingerprint, attempt의 안정 해시로 750~1000 permille를 고른다. 실제 delay는 nominal delay에 이 값을 곱해 계산한다.

정책 이름은 `stable-hash-75-100`이다. 같은 입력에는 같은 값이 나오며 무작위 상태나 process 메모리에 의존하지 않는다.

같은 오류가 반복되면 참여기관의 `lastError` 시각과 revision을 다시 쓰지 않는다. scheduler는 `nextRetryAt` 전에는 CaaS를 호출하지 않는다.

실제 재시도 뒤에는 다음 backoff 경계만 갱신하고 동일 오류의 업무 감사 event를 중복 추가하지 않는다. state commit 기록은 남으므로 원격 재시도 사실과 다음 retry 시각은 추적할 수 있다.

scheduler 결과는 수렴 완료를 `succeeded`, 승인·서비스 조건 차단을 `blocked`, CaaS 오류와 예외를 `failed`로 나눈다. CaaS 오류가 durable retry 상태에 남아 있으면 due가 아닌 tick에서도 `failureCodes`와 `nextRetryAt`을 반환하며 readiness는 `NOT_READY`다.

## 10. 상태 snapshot과 감사

상태의 논리 구조와 감사 검증은 file·PostgreSQL backend에서 같다. PostgreSQL은 dataspace별 row transaction으로 저장하고, development·test의 file backend는 임시 파일 기록, file `fsync`, atomic rename, directory `fsync` 순서를 따른다.

각 transaction은 `dataspaces`와 `idempotency` 전체의 stable snapshot digest를 계산한다. 마지막 `state.commit` 감사 event가 이 digest를 포함하고, state의 `integrity`가 snapshot digest와 audit head를 함께 저장한다.

로드할 때 다음 항목을 모두 검사한다.

- 감사 event sequence와 previous hash
- 각 감사 event hash와 audit head
- 각 감사 event의 유효한 시각과 직전 event보다 이르지 않은 순서
- 현재 mutable state의 snapshot digest
- `integrity.auditHead`와 현재 audit head
- 마지막 `state.commit` event와 현재 snapshot digest

감사 event만 바꾸거나 데이터 스페이스 record만 직접 바꾸면 로드를 중단한다. 시험은 두 변조 경로를 따로 재현한다.

새 event의 시각이 직전 event보다 이르면 transaction을 저장하지 않고 `DSAAS_CLOCK_ROLLBACK`으로 중단한다.

사용자 작업의 감사 event에는 OAuth2 introspection에서 얻은 principal, client ID, credential key ID를 기록한다. 전체 역할과 실제 사용한 역할도 따로 남긴다.

기본 claim은 `sub`, `client_id`, `jti`다. `clientIdClaim`과 `keyIdClaim`으로 `azp`, `cnf.kid` 같은 경로를 지정할 수 있다. bearer token과 client secret은 저장하지 않는다.

introspection endpoint의 HTTP Basic credential은 RFC 6749 §2.3.1을 따른다. client ID와 client secret을 각각 `application/x-www-form-urlencoded` component로 인코딩한다.

두 component를 `:`로 결합한 뒤 Base64로 인코딩한다. 따라서 공백, `+`, `:`, `%`, 비ASCII credential도 서로 모호하지 않다.

이 hash 구조에는 MAC, 기관 서명, 외부 timestamp가 없다. 파일 전체를 바꿀 권한이 있는 관리자는 chain과 snapshot을 함께 다시 만들 수 있다.

snapshot hash만으로는 보안 서명이나 부인방지 증거가 되지 않는다. production runtime은 같은 transaction의 `audit.appended` outbox를 WORM API로 반출한다.

read-back receipt의 sequence, content digest, 이전 receipt와 retention을 검증한 뒤에만 acknowledge한다.

WORM client 구현은 운영 저장 제품의 object lock과 관리자 우회 방지를 증명하지 않는다. 이 항목은 보존·삭제 훈련과 제품 설정 증거로 확인한다.

## 11. lock과 lease 복구

PostgreSQL advisory lock은 session이 종료되면 database가 해제한다. 애플리케이션은 정상 정리 시 `resource_fence.released_at`을 기록하고 lock 해제 결과를 확인한다.

connection 오류, 정리 timeout 또는 fence row 변경으로 결과를 확인할 수 없으면 connection을 pool에 되돌리지 않고 폐기한다.

`resource_fence`에 미해제 기록이 남았다고 row를 수동 삭제하거나 token을 낮추면 안 된다. database session과 현재 holder를 확인하고, 새 lease가 더 큰 token을 발급받는지 검증한 뒤 운영 사고 기록을 남긴다. token은 재사용하지 않는다.

development·test file backend의 state lock과 resource lock은 stale 여부를 추정해 자동 삭제하지 않는다. PID 재사용, host 오판, 파일 삭제 경합으로 두 writer가 동시에 진입할 수 있기 때문이다.

lock 파일이 남으면 `DSAAS_STATE_LOCKED` 또는 `DSAAS_RECONCILE_IN_PROGRESS`로 중단한다. 수동 복구 순서는 다음과 같다.

1. 해당 state를 사용하는 DSaaS process를 모두 중단한다.
2. lock JSON의 host, PID, 생성 시각을 확인한다.
3. 해당 host에서 PID와 열린 file handle이 없음을 확인한다.
4. state file을 복사하고 별도 검사 과정에서 snapshot과 감사 검증을 통과시킨다.
5. 검토자가 복구 기록을 남긴 뒤 정확한 lock 파일 하나만 삭제한다.
6. DSaaS를 한 instance로 시작하고 `/readyz`와 state load 결과를 확인한다.

실행 중인 process가 있는지 확인하지 않은 채 lock 파일을 삭제하면 안 된다.

## 12. 실행과 시험

계약, 제어 평면, HTTP, CaaS 연동 시험은 다음 명령으로 실행한다.

```powershell
npm run test:dsaas
```

`caas.ensurePath`는 `/`로 시작하는 절대 path 하나여야 한다. authority 형식의 `//`, query, fragment, 역슬래시, 경로 traversal, 인코딩한 slash와 역슬래시는 설정 로드 단계에서 거부한다.

예제 설정으로 server 형식만 확인하려면 필요한 secret을 환경 변수로 주입한다.

```powershell
$env:MOLIT_DSAAS_CONFIG = "fixtures/dsaas/config.example.json"
$env:MOLIT_DSAAS_INTROSPECTION_CLIENT_ID = "secret-store에서 주입"
$env:MOLIT_DSAAS_INTROSPECTION_CLIENT_SECRET = "secret-store에서 주입"
$env:MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN = "secret-store에서 주입"
npm run dsaas:serve
```

예제 Registry는 2026-07-14에 만료되고 외부 승인 상태가 `NOT_CONFIGURED`다. 이 값은 실행 예시를 고정하기 위한 fixture이며 운영 증거가 아니다.

## 13. 운영 전 차단 항목

- [x] CaaS·introspection outbound의 DNS 결과를 실제 socket dispatcher에 고정
- [ ] 운영 egress proxy·DNS policy·방화벽 allowlist 적용
- [ ] 기관 승인 시스템 Adapter와 결정 서명 검증
- [ ] 승인 결정의 발급·철회·만료 운영 절차
- [ ] 운영기관이 승인한 거버넌스 묶음
- [ ] CaaS·Identity Hub·Federated Catalog 운영 endpoint와 최신 readiness 증거
- [x] PostgreSQL dataspace-scoped 정본·CAS, 별도 lease pool, advisory lock과 fencing token
- [x] dataspace·participant·멱등성·감사·outbox authoritative row와 component·tenant FORCE RLS
- [ ] scheduler leader election 또는 다중 instance 부하·장애조치 시험
- [x] 동기 PostgreSQL primary 장애조치·WAL archive·PITR 로컬 harness
- [x] 감사 event transaction outbox와 WORM 반출·receipt 검증
- [ ] 참여기관 offboarding과 보존기간 처리
- [ ] 멱등성 원장의 보존기간, 데이터 스페이스별 상한과 안전한 정리 절차
- [x] 운영 OIDC·introspection·MFA·mTLS identity runtime
- [x] Kubernetes EDC provisioner와 CaaS OAuth2·mTLS 호출 경로
- [ ] 운영기관 DCP trust chain 승인과 이기종 DSP 상호운용 증거

상용 판정은 `governance/commercial-readiness-register.v1.json`을 정본으로 사용한다. `npm run commercial:status`는 2026-07-14 현재 `commercialReady=false`와 exit code 2를 반환한다.

P0 소스 범위에는 데이터 스페이스별 reconcile, 운영 identity·TLS와 CaaS OAuth2·mTLS가 들어 있다. 정규 row·RLS, WORM·usage와 로컬 HA·PITR harness도 구현했다.

운영기관 승인 결정, DCP trust chain과 외부 제품의 승인 결과는 별도 완료조건이다. 이기종 DSP 상호운용은 P1 Gate에서 다룬다.

HTTP client는 요청과 각 retry 전에 DNS 응답을 검사한다. origin allowlist, redirect 금지, 응답 크기와 timeout도 적용한다.

검사를 통과한 IP 목록은 해당 요청의 Undici dispatcher lookup에 고정된다. Host와 TLS SNI는 원래 hostname을 사용한다. retry는 DNS를 다시 검사하고 새 dispatcher를 만들므로 private·loopback으로 바뀐 응답은 다음 연결 전에 거부된다.

timeout은 DNS 조회, socket 요청, 응답 읽기와 retry backoff 전체에 적용된다. retry 대기 전에 dispatcher를 닫고 호출자 취소가 들어오면 남은 대기도 중단한다.

운영망에서는 목적지 IP를 고정하는 egress proxy 또는 동일 수준의 network policy가 필요하다.
