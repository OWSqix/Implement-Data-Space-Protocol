# CaaS Connector 제어 평면

## 1. 구현 범위

이 제어 평면은 기관별 Connector instance의 원하는 상태를 기록하고 provisioner에 전달한다. tenant 등록, 상태 변경, provision, deprovision, 재조정, 감사 조회를 제공한다.

상태 저장소는 개발·시험용 file backend와 PostgreSQL backend를 제공한다. production 설정은 PostgreSQL과 `verify-full` TLS를 강제한다.

PostgreSQL backend는 tenant별 authoritative row와 revision compare-and-swap을 사용한다. state·lease pool, tenant별 advisory lock과 fencing token도 분리했다.

provisioner는 개발용 `dry-run-manifest`와 운영용 `kubernetes-edc`를 제공한다. 운영 Adapter는 Kubernetes API로 tenant별 EDC Control Plane·Data Plane을 배포한다.

suspend, upgrade, rollback, delete와 orphan 회수도 같은 Adapter가 처리한다. 운영 설정에는 digest image, 외부 Secret, Gateway API 경로와 target-side fencing이 필요하다.

EDC runtime과 DSP endpoint는 `deploy/edc`에서 고정한다. CaaS는 EDC asset·policy·contract definition을 대신 관리하지 않는다. 이 업무는 데이터 스페이스 Catalog·계약·전송 계층의 책임이다.

현재 P0 구현에서 제외한 범위는 다음과 같다.

- 데이터 상품 등록, 계약 협상과 전송 실행의 업무 API
- 운영기관 Vault·KMS·DNS·Gateway 제품의 생성과 승인
- 사용료 청구, SLA service credit와 고객 지원 portal
- 외부 Connector 구현을 사용한 DSP TCK·상호운용 승인

## 2. 구성

```text
operator or tenant
    │ authenticated lifecycle request
    ▼
CaaS HTTP control plane
    ├─ tenant authorization
    ├─ desired and observed state
    ├─ idempotency ledger
    ├─ audit hash chain
    └─ PostgreSQL control store
            ├─ state pool: tenant-scoped transaction
            └─ lease pool: advisory lock and fencing token
                    │ connector-neutral operation
                    ▼
              Provisioner interface
                    ├─ dry-run-manifest
                    └─ kubernetes-edc
                           ├─ EDC Control Plane·Data Plane
                           ├─ Gateway API HTTPRoute
                           └─ fencing admission·orphan recovery
```

| 경로 | 역할 |
| --- | --- |
| `src/caas/server.mjs` | lifecycle HTTP API와 health endpoint |
| `src/caas/service.mjs` | tenant 등록, desired state, reconcile 상태 머신 |
| `src/caas/store.mjs` | CaaS 상태 검증, file backend, 감사 체인 |
| `src/control-store/postgres-scoped-control-store.mjs` | PostgreSQL tenant 정본, CAS, audit·outbox 원자 커밋과 fencing lease |
| `src/caas/provisioner.mjs` | provisioner 계약과 Adapter 선택 |
| `src/caas/kubernetes-provisioner.mjs` | tenant별 EDC·NetworkPolicy·Gateway route의 수명주기와 fencing |
| `src/caas/orphan-recovery.mjs` | 삭제 완료 tenant의 잔여 Kubernetes 자원 회수 |
| `src/caas/auth.mjs` | 개발용 bearer와 운영 OIDC·introspection·mTLS principal 경계 |
| `src/caas/config.mjs` | identity, TLS, observability와 provisioner 운영 설정 검사 |
| `src/observability/runtime-bundle.mjs` | trace·metric·log, WORM 감사와 usage dispatcher 조립 |
| `contracts/caas-*.schema.json` | 설정과 API 입력 계약 |

### 2.1 PostgreSQL 상태와 lease

Migration은 tenant별 authoritative state, scope registry, idempotency, 감사와 outbox table을 만든다. object·secret reference, metric과 usage table도 포함한다.

CaaS는 `component=caas`의 tenant row 하나만 transaction에 올린다. 상태 변경은 row를 `FOR UPDATE`로 읽고 검증한 뒤 `revision = revision + 1` 조건부 `UPDATE`로 교체한다. 선택한 revision과 다른 row는 commit하지 않는다. `COMMIT`을 시작한 뒤 connection 결과를 알 수 없으면 `CAAS_STATE_COMMIT_UNKNOWN`으로 반환하며 성공이나 실패로 추정하지 않는다.

tenant reconcile은 별도 lease pool의 session advisory lock을 사용한다. lock key는 구성요소와 `tenant:{tenantId}`를 결합해 만든다. lock 획득 뒤 `resource_fence`의 token을 증가시키며, 같은 tenant에 대한 다른 instance의 reconcile은 `CAAS_TENANT_BUSY`로 거부한다.

lease를 가진 transaction은 현재 token, holder와 미해제 상태를 다시 확인해야 tenant row를 저장할 수 있다. lease connection 오류는 작업의 `AbortSignal`을 취소한다.

정리 단계는 제한된 시간 안에 fence row를 해제하고 advisory lock을 반납한다. 해제 여부를 확인할 수 없으면 해당 connection을 폐기한다.

state pool과 lease pool은 같은 객체일 수 없다. 장시간 외부 provisioner 호출이 lease connection을 점유해도 state transaction용 connection을 남기기 위한 경계다.

tenant 상태, 멱등성, append-only 감사와 outbox는 독립 row로 저장한다. `control_scope_registry`와 component audit head 갱신은 component 단위로 직렬화한다. 모든 table에는 component·tenant `FORCE RLS`와 database principal binding을 적용한다.

## 3. API

| Method | 경로 | 권한 | 기능 |
| --- | --- | --- | --- |
| `GET` | `/healthz` | 없음 | 프로세스 생존 확인 |
| `GET` | `/readyz` | 없음 | state·secret ref·provisioner 준비 확인 |
| `POST` | `/v1/tenants` | 관리자 | tenant 등록 |
| `POST` | `/v1/connectors/ensure` | 관리자 또는 범위가 고정된 DSaaS controller | 기존 tenant Connector 수렴 |
| `GET` | `/v1/tenants/{tenantId}` | 관리자 또는 해당 tenant | instance 상태 조회 |
| `PUT` | `/v1/tenants/{tenantId}/desired-state` | 관리자 또는 해당 tenant | 원하는 상태 변경 |
| `POST` | `/v1/tenants/{tenantId}/upgrade` | 관리자 또는 해당 tenant | 승인된 Connector plan으로 upgrade 시작 |
| `POST` | `/v1/tenants/{tenantId}/rollback` | 관리자 또는 해당 tenant | version history의 plan으로 rollback 시작 |
| `POST` | `/v1/tenants/{tenantId}/reconcile` | 관리자 또는 해당 tenant | provisioner 실행 |
| `GET` | `/v1/tenants/{tenantId}/audit` | 관리자 또는 해당 tenant | 해당 tenant 감사 조회 |
| `GET` | `/v1/audit` | 관리자 | 전체 감사 조회 |

상태를 바꾸는 요청에는 `Idempotency-Key`가 필요하다. 일반 mutation은 같은 key와 같은 본문에 저장된 결과를 반환한다. 같은 key를 다른 본문에 쓰면 `409`로 거부한다.

등록 요청에는 namespace, endpoint, participant ID를 받지 않는다. 제어 평면이 tenant ID와 운영 설정의 template로 세 값을 만든다.

### 3.1 DSaaS 수렴 계약

DSaaS는 `POST /v1/connectors/ensure`와 `Idempotency-Key`를 사용한다. 이 endpoint는 tenant를 새로 만들지 않는다. 요청의 `caasTenantId`가 관리자 등록을 마친 상태여야 한다.

`ensure`의 key는 한 번의 desired-state 명령 시도를 식별한다. 성공 응답은 key와 본문에 고정되며, 같은 key와 본문을 다시 보내면 저장된 응답만 반환하고 generation이나 provisioner 부작용을 다시 만들지 않는다. 같은 key를 다른 본문에 쓰면 `409`로 거부한다.

요청의 `desiredGeneration`은 tenant별 단조 증가 fence다. 완료된 과거 key의 exact replay는 원래 응답을 반환하되 현재 tenant 상태를 바꾸지 않는다. 저장된 최고 generation보다 작은 새 명령은 `CAAS_DSAAS_GENERATION_STALE`과 `409`로 거부한다. 같은 generation을 다른 본문에 결합해도 `CAAS_DSAAS_GENERATION_CONFLICT`와 `409`로 거부한다.

일시적인 `ERROR` 응답은 성공 ledger에 저장하지 않으므로 같은 key로 재시도할 수 있다.

`PROVISIONING` 이후 상태를 다시 관측할 때 DSaaS는 같은 `desiredGeneration`과 본문을 유지하되 새 reconcile key에서 파생한 새 CaaS key를 사용한다.

CaaS가 provisioner에 전달하는 내부 operation key는 tenant generation에서 만들기 때문에 이 재관측이 외부 배포 부작용을 중복 생성해서는 안 된다.

요청의 다음 값은 CaaS 설정과 정확히 일치해야 한다.

- `organizationId`
- `participantId`와 `connectorNamespace`
- `connectorPlanId`
- `deploymentMode`
- `metadataProfile`
- `protocolProfile`
- `desiredGeneration`

`organizationId`는 법적 기관 식별자다. CaaS 내부 slug인 `caasTenantId`와 같은 값으로 취급하지 않는다. tenant 등록 때 두 값의 관계를 고정한다.

`participantId`와 `connectorNamespace`는 CaaS 등록 결과를 DSaaS membership에 기록한 값이다. dataspace 공용 `namespaceBase`와 Connector별 namespace를 섞지 않는다.

최초 요청의 `dataspaceId`는 tenant instance에 고정한다. 다른 dataspace ID로 바꾸는 요청은 거부한다.

`dataspaceId`가 고정된 뒤에는 tenant credential로 desired state를 바꿀 수 없다. DSaaS가 `SUSPENDED`를 적용한 뒤 tenant가 직접 `PROVISIONED`로 되돌리는 경로를 막는다.

tenant는 현재 상태 조회, 감사 조회와 현재 desired state의 reconcile만 할 수 있다. DSaaS는 별도 controller credential로 `connectors/ensure`만 호출하며 tenant 등록, 전체 감사, tenant desired-state route에는 접근하지 못한다.

```json
{
  "schemaVersion": "molit.dsaas-caas-request/1",
  "dataspaceId": "molit-production",
  "caasTenantId": "road-data-provider",
  "participantId": "did:web:connectors.data.molit.go.kr:road-data-provider",
  "organizationId": "urn:molit:organization:road-data-provider",
  "connectorPlanId": "edc-isolated",
  "deploymentMode": "isolated",
  "connectorNamespace": "https://data.molit.go.kr/tenants/road-data-provider/",
  "metadataProfile": {
    "iri": "https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1",
    "version": "1.0.0-rc.1",
    "sha256": "0666b7c2ed74800264a9ac6c8292f819fc973a02057397faca3b3d5df3bacfe4"
  },
  "desiredGeneration": 1,
  "protocolProfile": {
    "dspVersion": "2025-1",
    "specification": "https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/",
    "identityMode": "dcp"
  },
  "desiredState": "ACTIVE"
}
```

```text
DSaaS ACTIVE    → CaaS PROVISIONED
DSaaS SUSPENDED → CaaS SUSPENDED
```

현행 상태 계약은 보존 의도인 `SUSPENDED`와 삭제 의도인 `DELETED`를 구분한다. `DEPROVISIONED`는 기존 호출 호환을 위한 legacy 상태로만 유지하며, 새 호출은 보존 또는 삭제 의도에 따라 `SUSPENDED`나 `DELETED`를 사용한다.

**(정본 선택 근거: B-02)** 이 문서 §6의 현행 desired-state 선언과 CaaS 구현이 `SUSPENDED`·`DELETED`를 정식 상태로 처리하므로 앞부분의 DSaaS 매핑도 같은 계약을 따른다.

응답에는 `connectorId`, `dataspaceId`, `participantId`, 수렴 상태가 들어간다. HTTPS endpoint가 있을 때만 `endpoints.connectorBase`를 반환한다. secret reference와 secret material은 반환하지 않는다.

`connectorBase`는 배포 identity의 기준 URL이다. DSP Catalog·Contract·Transfer 경로라고 가정하지 않는다. 실제 경로는 채택한 EDC adapter가 배포 증거로 보고해야 한다.

provisioner가 일시적으로 실패하면 `ERROR`를 반환하되 성공 idempotency 결과로 고정하지 않는다. DSaaS는 같은 key로 다시 호출해 같은 reconcile operation을 재시도할 수 있다.

```json
{
  "schemaVersion": "molit.caas-tenant-registration/1",
  "tenantId": "road-data-provider",
  "organizationId": "urn:molit:organization:road-data-provider",
  "displayName": "도로 데이터 제공기관 Connector",
  "adapterId": "edc-intent-v1",
  "runtimeProfileRef": "urn:molit:caas:runtime-profile:edc-connector-v1",
  "apiAccessSecretRef": "env://MOLIT_CAAS_ROAD_DATA_PROVIDER_TOKEN",
  "apiPrincipalId": "urn:molit:principal:road-data-provider-operator",
  "apiClientId": "road-data-provider-control-client",
  "apiKeyId": "road-data-provider-2026-01",
  "deploymentSecretRefs": {
    "vaultAccess": "vault://tenants/road-data-provider/edc/vault",
    "databaseAccess": "vault://tenants/road-data-provider/source/database"
  }
}
```

## 4. tenant 경계

tenant ID는 소문자 영문으로 시작하는 CaaS 내부 slug다. URL path, state key, manifest filename에 같은 정규형을 사용한다. 법적 기관 식별자는 별도 `organizationId`에 보관한다.

관리자 token은 모든 tenant에 접근한다. tenant token은 자기 tenant route에만 접근한다.

DSaaS controller token은 설정에 적힌 dataspace, tenant, Connector plan의 `connectors/ensure`에만 쓸 수 있다. 이 token으로 tenant 등록, 전체 감사, tenant route를 호출하면 `403`을 반환한다.

현재 인증기는 정적 bearer token을 식별 가능한 actor에 대응시키는 prototype이다. token 원문은 `adminSecretRef`, `controller.secretRef` 또는 `apiAccessSecretRef`가 가리키는 환경 변수에서 읽는다.

다음 값은 secret이 아니다. 설정이나 tenant 등록 문서에서 빠지면 JSON Schema 검증이 `CAAS_CONTRACT_INVALID`로 거부한다.

| 구분 | 관리자 설정 | controller 설정 | tenant 등록 | 의미 |
| --- | --- | --- | --- | --- |
| 주체 | `adminPrincipalId` | `controller.principalId` | `apiPrincipalId` | 사람, 서비스 계정 또는 기관 내 운영 주체 |
| client | `adminClientId` | `controller.clientId` | `apiClientId` | CaaS를 호출한 software client |
| key | `adminKeyId` | `controller.keyId` | `apiKeyId` | 사용한 credential의 안정된 버전 식별자 |

관리자 설정은 다음처럼 secret reference와 actor 식별자를 분리한다.

```json
{
  "adminSecretRef": "env://MOLIT_CAAS_ADMIN_TOKEN",
  "adminPrincipalId": "urn:molit:principal:caas-operator",
  "adminClientId": "molit-caas-operator",
  "adminKeyId": "caas-admin-2026-01",
  "controller": {
    "secretRef": "env://MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN",
    "principalId": "urn:molit:principal:dsaas-controller",
    "clientId": "molit-dsaas-control-plane",
    "keyId": "caas-dsaas-controller-2026-01",
    "allowedDataspaceIds": ["molit-production"],
    "allowedTenantIds": ["road-data-provider"],
    "allowedConnectorPlanIds": ["edc-isolated"]
  }
}
```

인증이 성공하면 authorization actor는 role과 위 세 식별자를 함께 가진다. 변경 작업은 이 네 값을 감사 event의 `actorRole`, `actorPrincipalId`, `actorClientId`, `actorKeyId`에 남긴다.

bearer token과 token 환경 변수 값은 감사 event에 기록하지 않는다. 관리자, controller, tenant의 token·`clientId`·`keyId`가 겹치면 설정 로드, 등록 또는 준비 상태 검사를 거부한다.

token을 교체할 때는 새 secret reference와 `keyId`를 함께 바꾸고 승인된 tenant migration 절차를 거쳐야 한다. 현재 API에는 credential rotation endpoint가 없다. token만 바꾸고 같은 `keyId`를 유지하면 교체 전후 감사 기록을 구분할 수 없다.

응답에는 다음 값이 들어가지 않는다.

- API access secret reference
- deployment secret reference의 값
- bearer token 원문
- provisioner 내부 오류 원문

응답은 deployment secret의 논리 이름만 표시한다. state와 manifest에는 secret 원문이 아니라 `env://` 또는 `vault://` reference만 기록한다.

`env://` 뒤에는 환경변수 이름만 올 수 있다. `vault://` 뒤에는 빈 구간과 `.`·`..`가 없는 논리 경로만 허용한다. userinfo, query, fragment와 credential을 붙인 문자열은 reference로 인정하지 않는다.

provisioner 오류 code는 `[A-Z0-9_:-]` 1~64자만 state와 감사 event에 남긴다. 형식이나 길이가 맞지 않으면 `CAAS_ADAPTER_FAILED`로 바꾼다. adapter가 던진 message와 제한 밖 code는 영속화하지 않는다.

## 5. namespace와 participant 정책

예제 정책은 다음과 같다.

```json
{
  "participantIdTemplate": "did:web:connectors.data.molit.go.kr:{tenantId}",
  "namespaceTemplate": "https://data.molit.go.kr/tenants/{tenantId}/",
  "endpointTemplate": "https://connectors.data.molit.go.kr/{tenantId}/"
}
```

각 template에는 `{tenantId}`가 정확히 한 번 있어야 한다. 운영 모드의 namespace와 endpoint는 HTTPS를 사용하며 userinfo, query, fragment를 허용하지 않는다. URL은 slash로 끝나야 한다.

Connector plan은 adapter, runtime profile, deployment mode, metadata profile, protocol profile, 필수 secret reference 이름을 한 묶음으로 고정한다. tenant 등록과 DSaaS ensure 요청은 등록된 plan에서 벗어날 수 없다.

`deploymentMode`는 `isolated` 또는 `virtualized`다. metadata profile은 IRI, version, SHA-256을 함께 비교한다. protocol profile은 DSP version, 규격 URL, identity mode를 함께 비교한다.

tenant 등록 시 Connector plan 전체와 digest를 state에 고정한다. 설정 파일의 같은 plan ID가 나중에 다른 내용으로 바뀌면 기존 tenant를 자동 이전하지 않는다. 명시적 migration 전까지 ensure 요청을 거부한다.

예제의 `data.molit.go.kr` 계열 값은 배포 후보다. 실제 DNS, TLS 인증서, 운영기관 승인, reverse proxy 경로가 확인되기 전에는 live namespace로 판정하지 않는다.

## 6. 상태와 reconcile

원하는 상태는 다음 네 가지다. `DEPROVISIONED`는 기존 호출 호환용이며, 보존과 삭제를 구분하는 새 호출은 `SUSPENDED` 또는 `DELETED`를 쓴다.

- `PROVISIONED`
- `SUSPENDED`
- `DELETED`
- `DEPROVISIONED`

관찰 상태는 다음과 같다.

```text
NOT_PROVISIONED
    → PROVISIONING → PROVISIONED
    → UPGRADING → PROVISIONED
    → ROLLING_BACK → PROVISIONED
    → SUSPENDING → SUSPENDED
    → DELETING → DELETED
    → DEPROVISIONING → NOT_PROVISIONED
    → INTENT_READY
    → ERROR → 다음 reconcile에서 재시도
```

desired state가 바뀌면 generation이 증가한다. reconcile operation key는 tenant ID, generation, desired state에서 결정한다. 같은 generation을 재시도하면 같은 key가 provisioner에 전달된다.

| 중단 지점 | 재시작 동작 |
| --- | --- |
| state에 `PROVISIONING` 기록 전 | 부작용 없이 다시 시작 |
| manifest 기록 후 state 완료 전 | 같은 operation key로 같은 manifest 재확인 |
| deprovision manifest 기록 후 완료 전 | 같은 revoke 의도를 재확인 |
| state 완료 후 응답 전 | API idempotency ledger 결과 반환 |

tenant별 resource lease는 외부 provisioner 호출과 사후 관찰이 끝날 때까지 유지된다. PostgreSQL backend는 session advisory lock과 fencing token을 쓰고, file backend는 개발·시험용 process lock을 쓴다.

외부 호출은 PostgreSQL state transaction 안에서 실행하지 않는다. reconcile은 다음 경계로 나뉜다.

1. tenant scope를 읽고 transaction을 닫는다.
2. 이미 완료 상태라면 provisioner의 `observe`를 외부에서 호출한다.
3. 짧은 transaction에서 scope의 generation, 상태, operation key, intent digest와 이전 fencing token이 그대로인지 확인하고 진행 상태를 저장한다.
4. transaction을 닫은 뒤 원하는 상태에 맞는 `provision`, `suspend`, `delete` 또는 `deprovision`과 후속 `observe`를 호출한다.
5. 마지막 transaction에서 operation key와 generation을 다시 비교한 뒤 관찰 상태와 receipt를 저장한다.

관찰 중 state가 바뀌면 `CAAS_RECONCILE_FENCE_VIOLATION`으로 중단한다. PostgreSQL row lock을 원격 호출 동안 잡지 않으면서, 오래된 관찰값을 현재 상태에 commit하지 않는 구조다.

PostgreSQL lease를 받은 운영 provisioner는 `fencingCapable=true`여야 한다. 명령 결과는 `fencingAccepted=true`와 요청 token을 그대로 담은 `fencingToken`을 반환해야 한다. 후속 관찰은 같은 값을 `lastAppliedFencingToken`으로 반환한다.

CaaS는 확인한 값을 tenant의 `lastAppliedFencingToken`에 저장한다. 이후 완료 상태를 다시 관찰할 때 resource ID, generation, operation key, desired state, intent digest와 이 token이 모두 일치해야 수렴으로 인정한다.

Kubernetes Adapter는 중앙 fence ConfigMap을 compare-and-set으로 갱신한다. 모든 관리 자원에는 같은 fence를 붙인다.

TLS admission webhook은 대상 자원과 중앙 fence의 전체 tuple을 비교한다. token·holder·operation key·generation·intent digest·desired state가 다르거나 낮은 token이면 변경과 삭제를 거부한다.

kind 시험은 N+1 적용 뒤 지연된 N DELETE가 실제 API server에서 거부되는지 확인한다. 운영 cluster에서 같은 결과를 승인하는 절차는 별도 상용 Gate다.

`INTENT_READY`를 state 값만 보고 유지하지 않는다. 새 idempotency key로 reconcile하거나 readiness를 확인할 때 dry-run provisioner가 manifest를 다시 읽는다.

- 저장한 `lastIntentDigest`와 현재 파일 digest를 비교한다.
- 파일이 없거나 바뀌었으면 readiness는 `CAAS_PROVISIONER_DRIFT`로 실패한다.
- 같은 operation key가 남은 manifest의 내용이 바뀌면 `CAAS_PROVISIONER_IDEMPOTENCY_CONFLICT`로 중단한다.

file backend의 lock은 stale 여부를 자동 판단해 삭제하지 않는다. PID 재사용과 unlink 경합으로 이중 소유가 생길 수 있기 때문이다. 이 backend는 development·test에만 쓴다.

여러 CaaS instance는 PostgreSQL backend에서 같은 tenant lease를 경합할 수 있다.

로컬 HA harness는 동기 commit 뒤 primary를 강제 종료한다. fencing, failover, WAL archive와 PITR digest를 확인한다.

kind harness는 Kubernetes stale fencing과 수명주기를 확인한다. 두 시험은 운영 multi-zone cluster와 실제 object storage를 사용한 승인 훈련을 대신하지 않는다.

## 7. 감사

tenant 등록, desired state 변경, reconcile 시작·완료·실패를 state의 audit 배열에 기록한다. 각 event는 이전 event digest를 포함해 hash chain을 이룬다.

관리자와 tenant 요청에서 만든 감사 event에는 인증 시 확정한 role, principal ID, client ID, key ID가 있어야 한다. 하나라도 없거나 공백을 포함하면 state 저장을 거부한다. 이 값들은 token을 복원할 수 없는 비밀 아닌 attribution 자료다.

state store는 `tenants`와 `requests`가 바뀐 transaction 끝에 `STATE_COMMITTED` event를 추가한다. system actor에는 고정된 principal ID, client ID, key ID를 사용한다.

이 system event의 `stateSnapshotDigest`는 schema version, tenant snapshot, idempotency request ledger를 함께 계산한 SHA-256이다. `integrity.auditHead`는 해당 event digest를 가리킨다. `integrity.bindingDigest`는 두 digest를 한 번 더 결합한다.

state를 읽을 때는 snapshot digest, 감사 head, 마지막 commit event를 함께 검사한다. 파일에서 tenant나 request 결과만 직접 바꾸면 `CAAS_STATE_SNAPSHOT_INVALID`로 거부한다. tenant별 감사 조회에서는 tenant ID가 없는 system commit을 제외하고, 관리자 전체 조회에는 포함한다.

감사 chain과 snapshot 결합은 우발적 손상과 단순 변조를 검사한다. production runtime은 같은 transaction의 `audit.appended` outbox를 WORM API로 반출한다.

read-back receipt를 검증한 뒤에만 acknowledge한다. WORM 제품의 object lock, 관리자 우회 방지와 보존기간은 운영 증거로 확인해야 한다.

감사 용량에는 system commit event도 포함한다. 설정 한도에 도달하면 새 변경을 거부한다. 승인된 export·rotation 절차 없이 과거 event를 자동 삭제하지 않는다.

HTTP 조회는 설정한 최대 event 수만 최신순 구간으로 반환한다. 응답의 `total`과 `truncated`로 전체 건수와 잘림 여부를 표시한다. 전체 반출은 운영용 로그 pipeline에서 처리한다.

## 8. provisioner 계약

제어 평면은 다음 인터페이스만 요구한다.

```javascript
await provisioner.readiness({ signal });
await provisioner.provision(tenantSnapshot, operationKey, leaseOptions);
await provisioner.suspend(tenantSnapshot, operationKey, leaseOptions);
await provisioner.delete(tenantSnapshot, operationKey, leaseOptions);
await provisioner.deprovision(tenantSnapshot, operationKey, leaseOptions);
await provisioner.observe(tenantSnapshot, operationKey, leaseOptions);
```

명령용 `leaseOptions`에는 `signal`, `fencingToken`, `holderId`, `acquiredAt`이 들어간다. file backend에서는 fencing 값이 `null`일 수 있다.

완료 상태를 다시 확인하는 수동 관찰에는 현재 lease token을 전달하지 않는다. `expectedLastAppliedFencingToken`에 tenant가 저장한 마지막 적용 token을 전달한다. 명령 직후 관찰에만 방금 사용한 명령용 `leaseOptions`를 다시 사용한다.

모든 수명주기 명령은 같은 operation key에 대해 멱등이어야 한다. 반환값에는 안정된 `adapterResourceId`, `intentDigest`, 실제 수렴 여부가 있어야 한다. PostgreSQL lease를 사용하는 운영 Adapter는 외부 fencing acceptance receipt도 반환해야 한다.

`observe`는 외부 자원의 존재, 수렴 여부, resource ID, intent digest, operation key, generation, desired state와 마지막 적용 fencing token을 반환한다. 운영 Adapter에 `observe`가 없거나 결과가 닫힌 계약을 만족하지 않으면 CaaS는 수렴을 저장하지 않는다.

`dry-run-manifest`는 다음 파일만 기록한다.

```text
.local/caas/deployment-intents/{tenantId}.intent.json
```

파일에는 participant ID, namespace, endpoint, runtime profile reference, deployment secret reference가 들어간다. EDC process가 실행됐다는 뜻은 아니다.

dry-run adapter는 `converged=false`를 반환하고 관찰 상태를 `INTENT_READY`로 둔다. ensure 응답도 `PROVISIONING`이다. 실제 Connector health 증거가 없으므로 `ACTIVE`나 `SUSPENDED`를 반환하지 않는다.

`kubernetes-edc`는 Namespace, ServiceAccount, quota, 제한값과 NetworkPolicy를 만든다. EDC Deployment·Service·PDB와 Gateway API route도 포함한다.

Control Plane·Data Plane readiness와 route의 `Accepted`·`ResolvedRefs`를 확인한다. 중앙 fence와 실제 자원의 annotation까지 다시 읽어야 `converged=true`를 반환한다.

적용 중 오류가 나면 시작 전에 읽은 자원 snapshot으로 rollback한다. 삭제는 UID와 `resourceVersion` precondition을 사용한다. orphan recovery는 삭제된 tenant의 남은 namespace를 조회하고 현재 fence를 획득한 뒤 회수한다. 자세한 배포 조건과 30회 시험은 `deploy/kubernetes/README.md`에 기록했다.

## 9. 실행

아래 정적 token 예시는 `development` 전용이다. production은 `deploy/kubernetes/caas-config.production.example.json`과 별도 identity·observability 설정을 사용한다.

```powershell
$env:MOLIT_CAAS_ADMIN_TOKEN = "replace-with-admin-secret"
$env:MOLIT_CAAS_DSAAS_CONTROLLER_TOKEN = "replace-with-controller-secret"
$env:MOLIT_CAAS_ROAD_DATA_PROVIDER_TOKEN = "replace-with-tenant-secret"
npm run caas:serve
```

등록 예시는 다음 명령으로 보낼 수 있다.

```powershell
$headers = @{
  Authorization = "Bearer $env:MOLIT_CAAS_ADMIN_TOKEN"
  "Idempotency-Key" = "register-road-data-provider-001"
}
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/v1/tenants" `
  -Headers $headers `
  -ContentType "application/json" `
  -InFile "fixtures/caas/tenant-registration.example.json"
```

production 서버는 Node HTTPS listener에서 TLS를 직접 종료한다. 인증서·개인키·client CA를 주기적으로 다시 읽고, 유효하지 않은 새 material은 적용하지 않은 채 readiness를 내린다. 유효한 교체는 기존 연결을 끊지 않고 새 secure context에 반영한다.

Production 관리자와 사용자 token은 RFC 7662 introspection으로 issuer, audience, scope, 만료와 폐기 상태를 확인한다. OIDC JWKS 경로는 durable revocation Registry가 연결될 때까지 개발·상호운용 시험에만 사용한다.

사람 principal은 MFA claim을 요구한다. service principal은 token의 `cnf`와 신뢰한 client certificate를 결합한다. 정적 bearer는 development·test에서만 허용한다.

### 9.1 요청 기한과 graceful shutdown

변경 요청은 `requestTimeoutMs`가 지나면 request별 `AbortSignal`을 취소한다. 이 신호는 state 접근, provisioner 명령과 관찰에 전달된다. Adapter가 신호를 무시하면 CaaS는 외부 호출 뒤 신호를 다시 확인하고 완료 상태를 저장하지 않는다.

종료는 먼저 readiness를 내리고 새 관리 write를 `CAAS_SHUTTING_DOWN`과 `503`으로 거부한다. idle connection을 닫은 뒤 진행 중인 요청이 `gracefulShutdownMs` 안에 끝나기를 기다린다.

기한이 지나면 모든 request controller를 취소하고 남은 socket을 닫는다. HTTP drain이 성공하거나 강제 종료 경계에 도달한 뒤 state store를 닫는다. PostgreSQL store의 `close()`는 state pool과 lease pool을 모두 종료한다.

이 종료 절차는 process 내부의 늦은 state commit을 막는다. Kubernetes Adapter도 `AbortSignal`을 각 API 호출에 전달하고 적용 실패 시 snapshot rollback을 시도한다.

## 10. 운영 전 남은 항목

- [ ] 운영 namespace·endpoint·participant ID 발급 정책 승인
- [x] EDC version과 extension BOM·image digest 고정
- [x] Kubernetes EDC provisioner와 upgrade·rollback·suspend·delete·orphan 회수 구현
- [ ] Vault·database·network의 tenant별 격리 시험
- [x] OAuth2/OIDC token 검증 또는 introspection과 scope·audience 정책 구현
- [x] mTLS client 인증과 certificate-to-principal 대응 정책 구현
- [x] inbound·outbound 인증서 무중단 회전과 폐기 credential 재사용 거부 구현
- [x] 애플리케이션 직접 HTTPS 종료와 인증서 회전 구현
- [x] PostgreSQL tenant-scoped 정본·CAS, 별도 lease pool, advisory lock과 fencing token 구현
- [x] 실제 kind Kubernetes 자원에서 낮은 fencing token 거부 시험
- [x] tenant·멱등성·감사·outbox authoritative row와 component·tenant FORCE RLS 구현
- [x] 감사 event transaction outbox와 WORM 반출·receipt 검증 구현
- [ ] tenant별 요청·Connector quota와 비용 기준 수립
- [ ] 멱등성 원장의 TTL, tenant별 상한과 안전한 정리 절차 수립
- [x] 동기 PostgreSQL primary 장애조치·WAL archive·PITR 로컬 harness 구현
- [ ] EDC DSP 상호운용 시험과 Connector 관리 API 계약시험
- [ ] tenant offboarding과 보존기간 만료 후 state 삭제 절차 수립

상용 판정은 `governance/commercial-readiness-register.v1.json`을 정본으로 사용한다. `npm run commercial:status`는 2026-07-14 현재 `commercialReady=false`와 exit code 2를 반환한다.

P0 소스 범위에는 Kubernetes EDC 수명주기, 운영 신원, WORM 감사와 usage 원장이 들어 있다. 동기 PostgreSQL HA·PITR과 공급망 Gate도 구현했다.

운영기관 namespace 승인, 외부 Vault·KMS·Gateway와 multi-zone 훈련은 별도 완료조건이다. 최종 image의 외부 DSP 상호운용 증거도 P1 Gate에서 다룬다.
