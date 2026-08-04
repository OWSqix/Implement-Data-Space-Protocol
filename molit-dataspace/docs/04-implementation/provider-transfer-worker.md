# 공급자 PULL 전송 프로비저닝 Worker

## 1. 맡는 범위

이 Worker는 Connector가 계약과 전송 요청을 승인한 뒤에 실행한다. 승인된 전송 건을 플랫폼 자원에 연결하고, provisioner가 반환한 `DataAddress`를 Connector 관리 API에 돌려준다.

이 값은 Connector를 거쳐 Provider Data Plane의 source binding이 되며 Consumer에게 전달하지 않는다. 전송 종료 건에서는 같은 자원을 폐기한 뒤 종료 결과를 보고한다.

구현된 action은 `START`와 `TERMINATE` 두 개다. PULL 방식에서 Provider Data Plane이 source binding으로 사용할 원천 접근 자원을 발급하고 폐기하는 범위만 다룬다. DSP의 `SUSPENDED`와 `COMPLETED` 상태 전체를 구현한 범용 전송 Worker가 아니다.

이 구성요소는 DSP 전송 프로토콜 엔드포인트가 아니다. DSP 메시지 수신, 계약 검증, 전송 상태 머신, 콜백 송신은 선택한 Connector가 맡는다.

DSP 2025-1 규격도 데이터 평면 인터페이스를 규격 범위 밖으로 둔다. 이 저장소의 `DataAddress`는 Connector 관리 어댑터와 합의한 제어 평면 객체다. 특정 DSP wire 형식에 적합하다고 주장하지 않는다.

- **(Decision — E-21)** payload 전송은 **Provider Data Plane 경유로 단일화**한다. 원천 직접 방식(Consumer가 원천 token·signed URL로 원천에 직접 접근)은 채택하지 않는다
- **(Decision — E-21 적용 정정)** 2026-08-03에 잘못 추가된 “소비자가 사용할 `DataAddress`” 서술을 철회한다. Consumer는 계약 범위에서 Provider Data Plane에 접근하고, Data Plane이 source binding으로 원천에서 읽어 응답한다.
- **(Verified)** [`worker.mjs`](../../src/transfer-runtime/worker.mjs)는 provisioner 결과의 `dataAddress`를 `acknowledgeStart`로 넘기고, [`clients.mjs`](../../src/transfer-runtime/clients.mjs)의 `acknowledgeStart`는 이를 Connector 관리 엔드포인트에 POST한다. Consumer에게 보내는 경로는 없다.
- **(Verified)** [`journal.mjs`](../../src/transfer-runtime/journal.mjs)는 `dataAddress` 원문 저장을 금지하고, 관련 값은 `dataAddressDigest`만 허용한다.

표준 규격은 다음 주소에서 확인한다.

- [Dataspace Protocol 2025-1 errata](https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/)
- [DSP 2025-1-err1 소스 태그](https://github.com/eclipse-dataspace-protocol-base/DataspaceProtocol/tree/2025-1-err1)

## 2. 처리 경계

```text
DSP participant
    │ DSP Catalog · Contract · Transfer 메시지
    ▼
Connector
    │ 승인된 관리 이벤트와 authoritative status
    ▼
ProviderTransferWorker
    ├─ private binding registry
    ├─ phase journal
    └─ platform provisioner
           ├─ 접근 토큰 발급
           ├─ signed URL 생성
           ├─ export job 실행
           └─ snapshot 고정
```

이벤트에는 원천 URL이나 DB 접속 정보가 들어갈 수 없다. 이벤트 JSON Schema는 알려지지 않은 필드를 거부한다. Worker는 `datasetId + format`으로 private binding registry를 조회하고, 그곳에 기록된 `resourceRef`와 `provisionerId`만 사용한다.

## 3. 소스 구성

| 경로 | 역할 |
| --- | --- |
| `src/transfer-runtime/worker.mjs` | START와 TERMINATE 상태 전이 |
| `src/transfer-runtime/journal.mjs` | HMAC으로 결합한 원자적 phase journal과 provider별 직렬화 lock |
| `src/transfer-runtime/clients.mjs` | Connector 관리 API와 플랫폼 provisioner 어댑터 |
| `src/transfer-runtime/binding-registry.mjs` | 데이터셋·형식 바인딩 조회 |
| `src/transfer-runtime/config.mjs` | 운영 설정 검증 |
| `contracts/provider-transfer-event.v1.schema.json` | 승인 이벤트 계약 |
| `contracts/transfer-binding-registry.v1.schema.json` | private binding 계약 |
| `contracts/provider-transfer-result.v1.schema.json` | provisioner 결과 계약 |
| `contracts/provider-transfer-revoke-result.v1.schema.json` | revoke receipt 계약 |
| `contracts/provider-transfer-runtime-config.v1.schema.json` | Worker 설정 계약 |

## 4. 승인 이벤트

START 예시는 다음과 같다.

```json
{
  "schemaVersion": "molit.provider-transfer-event/1",
  "eventId": "evt-start-provider-001",
  "action": "START",
  "providerPid": "provider-001",
  "consumerPid": "consumer-001",
  "agreementId": "agreement-001",
  "datasetId": "urn:molit:dataset:road-speed-hourly",
  "format": "HttpData-PULL"
}
```

Worker는 이벤트만 믿고 자원을 만들지 않는다. Connector 관리 API에서 `providerPid`의 현재 상태를 다시 읽고 다음 다섯 값을 모두 대조한다.

1. `providerPid`
2. `consumerPid`
3. `agreementId`
4. `datasetId`
5. `format`

START에는 `START_AUTHORIZED`가 필요하다. `STARTED` recovery는 로컬 journal이 `provisioned` 또는 `active` 증거를 가진 경우에만 허용한다. journal이 `authorized`에 머문 상태에서 Connector만 `STARTED`라면 provision을 호출하기 전에 중단한다.

TERMINATE의 revoke에는 정확한 `TERMINATION_AUTHORIZED`가 필요하다. `TERMINATED`는 로컬 journal도 `terminated`인 완료 replay에만 쓴다. 로컬 revocation 완료 증거 없이 Connector만 `TERMINATED`이면 자원을 추측해 폐기하지 않고 운영자 reconciliation을 요구한다. `STARTED`와 그 밖의 중간 상태도 revoke 전에 거부한다.

## 5. private binding registry

```json
{
  "datasetId": "urn:molit:dataset:road-speed-hourly",
  "format": "HttpData-PULL",
  "transferMode": "PULL",
  "provisionerId": "road-data-export",
  "resourceRef": {
    "catalogObject": "ROAD_SPEED_HOURLY",
    "snapshotPolicy": "agreement-time"
  },
  "enabled": true
}
```

START 시점의 바인딩 전체와 SHA-256 digest를 journal에 고정한다. 기존 전송의 재처리와 TERMINATE는 현재 registry가 아니라 이 snapshot을 사용한다.

journal integrity envelope은 domain `molit.provider-transfer-journal.integrity`, version `1`, algorithm `hmac-sha256`과 key ID를 명시한다. 이 metadata와 journal의 canonical JSON·revision을 환경 변수에서 읽은 32 byte 이상 HMAC key로 함께 결합한다.

저장된 metadata, phase, binding, revoke receipt digest를 직접 바꾸면 다음 load가 `TRANSFER_JOURNAL_INTEGRITY_INVALID`로 중단된다. key 원문은 journal에 기록하지 않는다.

신규 전송을 막으려고 `enabled`를 `false`로 바꾸거나 현행 registry에서 항목을 제거해도 기존 접근권은 폐기할 수 있다. 시작 journal을 잃은 전송을 복구해야 한다면 tombstone이 필요하다.

실제 revoke가 끝날 때까지 snapshot이 가리키는 provisioner 설정과 어댑터도 유지해야 한다. HMAC으로 검증된 `revoked` 또는 `terminated` 기록의 완료 복구와 replay에는 이미 폐기된 provisioner 어댑터가 필요하지 않다.

`resourceRef`에는 자원 식별자와 불변 선택 조건만 기록한다. Worker는 credential 이름의 field뿐 아니라 `Bearer` 값, `token=...` 같은 대입문, URL userinfo, credential query와 fragment도 거부한다.

signed URL은 private binding registry의 고정 binding이 아니라 provision 단계의 단기 결과로 만든다. 발급 후 Connector를 거쳐 Provider Data Plane의 source binding이 된다.

provisioner 제어 API 인증정보는 환경 변수에서만 읽는다.

`transferMode`는 현재 `PULL`만 허용한다. PUSH 방식에는 소비자 sink DataAddress 수신, 실제 송신 job, 완료 확인, 부분 실패 보상이 필요하므로 별도 어댑터로 구현한다.

## 6. 상태 전이와 재실행

### 6.1 START

```text
authorized → provisioned → active
```

1. Connector authoritative status와 이벤트 identity를 대조한다.
2. private binding snapshot을 journal에 기록한다.
3. platform provisioner를 호출한다.
4. provision 결과의 식별자와 `DataAddress` digest만 journal에 기록한다.
5. 실제 `DataAddress`는 Connector 관리 API 호출에만 전달한다.
6. 발급 결과는 Connector를 거쳐 Provider Data Plane의 source binding이 된다. Consumer에게 원천 token이나 signed URL을 전달하지 않는다.
7. Connector가 접수를 확인하면 `active`로 바꾼다.

provisioner 호출 직전에도 authoritative 상태를 확인한다. `START_AUTHORIZED`이면 신규 provision을 허용한다. `STARTED`이면 journal에 `provisioned` 또는 `active` 증거가 있는 복구 호출만 허용한다. 로컬 증거 없는 `STARTED`, `TERMINATION_AUTHORIZED`, `TERMINATED`에서는 provisioner를 호출하지 않는다.

`DataAddress` 원문은 journal과 일반 로그에 남기지 않는다. 3번 이후에 프로세스가 중단되면 같은 provision idempotency key로 3번을 다시 호출한다.

provisioner는 같은 자원을 반환해야 한다. Worker는 이 계약을 이용해 비밀 접근 정보를 디스크에 보관하지 않고 Connector 보고를 재개한다.

### 6.2 TERMINATE

```text
active → terminating → revoked → terminated
```

Connector 보고가 실패해도 revocation 결과는 `revoked`로 남는다. 이 기록에는 canonical revoke receipt의 SHA-256 digest가 포함된다.

다음 실행은 자원을 다시 만들거나 다른 자원을 폐기하지 않고 종료 보고만 반복한다. revocation 자체도 다섯 transfer identity, `provisioningId`, `resourceRefDigest`를 domain과 version에 결합한 고정 idempotency key를 사용한다.

시작 보고 전에 종료 승인이 도착한 경우에도 `authorized` 또는 `provisioned` 자원을 폐기한다.

platform revoke는 authoritative 상태가 정확히 `TERMINATION_AUTHORIZED`일 때만 호출한다. `START_AUTHORIZED`, `STARTED`, `TERMINATED`에서는 자원 폐기를 시작하지 않는다. 이미 `terminated`인 journal과 authoritative `TERMINATED`가 함께 확인된 replay만 별도 예외다.

journal이 이미 `terminated`여도 Connector의 authoritative 상태가 `TERMINATION_AUTHORIZED`이면 종료로 간주하지 않는다. 같은 key로 종료 보고를 다시 보내고 status를 재조회해 정확한 `TERMINATED`를 확인한다. `terminated` journal과 `TERMINATED` status가 함께 확인될 때만 부작용 없는 replay로 반환한다.

종료 보고가 Connector에 반영된 뒤 local journal 저장 전에 중단될 수 있다. 재시작 시 journal의 `revoked` 증거와 identity가 일치하고 authoritative 상태가 `TERMINATED`이면 revoke와 종료 보고를 반복하지 않는다.

Worker는 이 복구에서 provisioner 어댑터를 조회하지 않는다. local phase만 `terminated`로 마감한 뒤 복구 사실을 기록한다.

### 6.3 프로세스 동시 실행

외부 부작용이 끝날 때까지 `providerPid`별 파일 lock을 유지한다. 같은 전송의 START와 TERMINATE가 서로 엇갈려 접근권을 되살리는 상황을 막는다.

stale lock은 자동 삭제하지 않는다. PID 재사용과 두 복구 process의 unlink 경합이 이중 소유를 만들 수 있기 때문이다.

운영자가 해당 process의 종료와 lock 경로를 확인한 뒤 수동으로 제거한다. 공유 스토리지와 여러 호스트를 쓰는 배포에서는 fencing token을 제공하는 분산 lock Adapter가 필요하다.

HMAC은 key를 모르는 파일 편집자를 막지만 과거의 정상 journal과 함께 되돌리는 rollback은 판별하지 못한다. 운영 배포는 revision을 외부 CAS 저장소나 append-only anchor에 기록하고 분산 fencing과 함께 검증해야 한다.

### 6.4 Journal migration과 key rotation

runtime은 현재 integrity envelope와 설정의 key ID가 정확히 일치하고 HMAC 검증이 성공한 journal만 연다. unsigned journal과 domain·version이 없는 과거 envelope는 거부한다.

알 수 없는 key ID와 MAC 불일치도 빈 journal로 자동 승격하거나 우회하지 않는다.

운영 migration은 다음 순서로 수행한다.

1. event inbox와 모든 Worker를 중지하고 journal lock과 provider operation lock이 없음을 확인한다.
2. journal 원본, 파일 SHA-256, revision과 외부 CAS 또는 append-only anchor 값을 변경 불가 저장소에 보존한다.
3. 기존 signed journal은 이전 key와 이전 envelope 규칙으로 먼저 검증한다. unsigned journal은 신뢰할 수 있는 상태로 간주하지 않고 각 record를 Connector status와 provisioner 자원 상태에 대조한다.
4. 검증·reconciliation 결과를 운영 승인된 offline migration 도구로 현재 closed envelope에 다시 쓰고 새 key ID와 key로 서명한다. record를 임의로 보완하거나 실패한 record를 삭제하지 않는다.
5. 새 파일을 같은 volume에서 atomic replace하고 `loadTransferJournal`을 새 key로 실행해 HMAC, revision과 record 수를 확인한다.
6. 새 file SHA-256과 revision을 외부 anchor에 기록한 뒤 Worker와 inbox를 순서대로 재개한다. 이전 key는 rollback window가 끝날 때까지 별도 보관한 뒤 폐기한다.

이 저장소의 runtime CLI는 자동 migration이나 다중 key fallback을 제공하지 않는다. 검증 가능한 offline migration 도구와 record별 reconciliation 증거가 없으면 배포를 중단한다.

## 7. 어댑터 계약

### 7.1 Connector 관리 API

이 경로들은 표준 DSP 경로가 아니다. 선택한 Connector에 맞춰 관리 어댑터를 구현한다.

| 동작 | 기본 예시 | 요구 결과 |
| --- | --- | --- |
| authoritative status | `GET transfers/{providerPid}` | identity 다섯 값과 승인 상태 |
| 시작 보고 | `POST transfers/{providerPid}/started` | `200`, `204`; `409`면 status 재조회 뒤 정확한 `STARTED` 확인 |
| 종료 보고 | `POST transfers/{providerPid}/terminated` | `200`, `204`; `409`면 status 재조회 뒤 정확한 `TERMINATED` 확인 |

두 POST는 `Idempotency-Key`를 저장하고 같은 key·같은 본문에 같은 의미의 결과를 내야 한다. key만 같고 본문이 다르면 거부해야 한다. 설정의 `supportsIdempotencyKey: true`는 이 운영 계약을 구현했다는 명시적 선언이다.

`409` 자체는 성공 증거가 아니다. Worker는 `GET transfers/{providerPid}`를 다시 호출한다. 응답의 `providerPid`, `consumerPid`, `agreementId`, `datasetId`, `format`이 이벤트와 모두 같고 상태가 정확히 `STARTED` 또는 `TERMINATED`일 때만 재실행 성공으로 판정한다. 승인 상태에 머물러 있거나 identity가 하나라도 다르면 중단한다.

### 7.2 Platform provisioner

| 동작 | 요청의 핵심 값 | 필수 성질 |
| --- | --- | --- |
| provision | 고정 binding의 `resourceRef`, authoritative transfer identity | 같은 key로 자원을 중복 생성하지 않음 |
| revoke | 다섯 transfer identity, 시작 때 사용한 provisioning key와 ID, 같은 `resourceRef`, SHA-256 digest와 요청 digest | 정확히 그 전송 자원이 이미 폐기됐거나 없는 상태를 증명함 |

provision 요청은 `providerPid`, `agreementId`, provisioning key, `resourceRefDigest`와 전체 요청의 canonical digest를 함께 보낸다.

응답은 다섯 값을 그대로 돌려주고 `provisioningId`와 `dataAddress`를 포함해야 한다. Worker는 `200`, `201`, `409` 모두 같은 receipt 계약으로 검사한다.

`dataAddress`는 Consumer가 사용할 원천 접근 주소가 아니다. Worker는 이를 Connector 관리 엔드포인트에만 POST하고, Connector를 거쳐 Provider Data Plane의 source binding으로 사용한다.

하나라도 요청과 다르거나 추가 field가 있으면 중단한다. journal이 이미 있는 재호출에서는 provisioning ID와 DataAddress digest도 기존 기록과 비교한다.

```json
{
  "providerPid": "provider-1",
  "agreementId": "agreement-1",
  "provisioningKey": "<sha256>",
  "resourceRefDigest": "<sha256>",
  "requestDigest": "<sha256>",
  "provisioningId": "platform-resource-1",
  "dataAddress": { "type": "HttpData" }
}
```

revoke 요청은 다섯 transfer identity와 `provisioningId`, provisioning key, `resourceRef`, `resourceRefDigest`를 보낸다.

revoke idempotency key는 다섯 identity, `provisioningId`, `resourceRefDigest`를 domain `molit.provider-transfer.revoke-idempotency-key`와 version `1`에 결합한 SHA-256 digest다.

`requestDigest`는 자신을 제외한 요청 객체를 domain `molit.provider-transfer.revoke-request`와 version `1`에 결합해 계산한다.

`provisioned` 또는 `active` journal에는 receipt에서 받은 `provisioningId` 문자열이 있다. 요청과 응답은 그 값을 그대로 돌려준다.

provision 응답 전에 중단됐거나 시작 journal이 없는 복구에서는 `terminating` journal의 field를 JSON `null`로 고정한다. `null`도 idempotency key와 request digest에 포함된다.

receipt가 field를 생략하거나 빈 문자열 또는 다른 문자열을 추측해 반환하면 Worker가 거부한다. 이 `null`은 wildcard가 아니다.

provisioner는 `null` 요청도 provisioning key, 다섯 identity와 `resourceRefDigest`로 원 provision record에 원자적으로 대조한다. 불일치하거나 둘 이상이면 자원을 폐기하지 않고 거부한다.

`ABSENT`는 이 전체 tuple에 해당하는 자원이 없음을 확인한 경우에만 반환한다.

revoke는 `200`, `204`, `404`, `409` 중 어떤 상태를 반환하더라도 다음 열 field만 있는 closed receipt를 제공해야 한다. 아홉 correlation 값이 요청과 같고 `state`가 `REVOKED`, `ABSENT`, `INACTIVE` 중 하나일 때만 Worker가 종료를 계속한다.

```json
{
  "providerPid": "provider-123",
  "consumerPid": "consumer-123",
  "agreementId": "agreement-123",
  "datasetId": "dataset-123",
  "format": "HttpData-PULL",
  "provisioningId": "platform-resource-123",
  "provisioningKey": "<sha256>",
  "resourceRefDigest": "<sha256>",
  "requestDigest": "<sha256>",
  "state": "REVOKED"
}
```

상태 코드만으로는 revoke 완료를 증명하지 않는다. `200`도 본문이 없거나 receipt가 요청과 다르면 중단한다.

HTTP `204`는 응답 본문을 전달할 수 없다. 실제 HTTP Adapter는 canonical receipt를 담은 `200`을 반환해야 한다. receipt가 없는 `204`는 Worker가 거부하고 같은 idempotency key로 재시도한다.

`409`는 위 receipt가 정확한 비활성 상태를 증명할 때만 재실행 성공으로 처리한다. `404`는 같은 identity와 `state=ABSENT`를 반환해야 한다. 본문이 없거나 digest가 다르면 라우트 누락과 자원 부재를 구별할 수 없으므로 Worker가 중단한다.

이 규칙은 설정의 `idempotentRevoke: true`와 함께 적용한다. 배포 시험에서는 존재하지 않는 provisioning key와 존재하지 않는 API route를 각각 호출한다. 두 응답을 구별하지 못하면 해당 어댑터를 사용하지 않는다.

signed URL이나 토큰을 만드는 provisioner는 수명, agreement binding, consumer authorization context, 최소 권한, 취소 방식을 별도로 구현해야 한다.

발급 결과는 Provider Data Plane만 source binding으로 사용하고 Consumer에게 노출하지 않는다. 이 저장소의 범용 어댑터가 해당 정책을 대신 결정하지 않는다.

## 8. 네트워크와 비밀정보

- 운영 모드는 HTTPS만 허용한다.
- Connector와 provisioner origin을 `allowedOrigins`에 정확히 적는다.
- 사설 주소 origin은 `privateOrigins`에도 정확히 적는다.
- redirect를 따라가지 않는다.
- URL userinfo를 거부한다.
- DNS 결과가 loopback, link-local, unspecified, multicast이면 거부한다.
- 요청 timeout과 응답 최대 바이트를 설정한다.
- 비멱등 POST 재시도는 어댑터가 Idempotency-Key 계약을 선언한 경우에만 사용한다.
- 운영 인증은 `auth.env`에 적은 환경 변수에서 읽는다. 설정 파일의 inline credential은 Schema가 허용하지 않는다.

HTTP client는 매 연결과 retry에서 DNS를 다시 검사하고, 통과한 주소를 해당 요청의 Undici dispatcher에 고정한다. Host와 TLS SNI는 원래 hostname을 유지한다.

설정의 timeout은 DNS, socket 요청, 응답 읽기와 retry backoff를 합친 전체 요청 budget이다. retry 대기 전에 해당 dispatcher를 닫으며 종료 signal이 오면 DNS와 대기도 중단한다.

운영망에서는 이 검사와 별도로 고정 egress proxy, DNS policy와 방화벽 allowlist를 적용한다.

## 9. 실행

예제 설정은 실제 도메인과 자격증명으로 바꿔야 한다.

```powershell
$env:MOLIT_CONNECTOR_MANAGEMENT_TOKEN = "..."
$env:MOLIT_EXPORT_CONTROL_TOKEN = "..."
$env:MOLIT_TRANSFER_JOURNAL_HMAC_KEY = "32 byte 이상의 임의 값"
npm run transfer:worker -- `
  --config fixtures/transfer-runtime/config.example.json `
  --bindings fixtures/transfer-runtime/bindings.example.json `
  --event fixtures/transfer-runtime/start-event.example.json
```

CLI는 한 이벤트를 처리한다. 운영 배포에서는 Connector webhook inbox나 durable message queue consumer가 검증된 이벤트 JSON을 이 CLI 또는 `ProviderTransferWorker.process()`에 전달해야 한다.

inbox는 서명 검증, 중복 수신, 순서 역전, 재시도, dead-letter 정책을 맡는다. 이 저장소에는 특정 Connector의 webhook 형식을 표준인 것처럼 고정하지 않았다.

## 10. 운영 투입 전 확인표

- [ ] Connector 관리 API의 authoritative status 필드가 다섯 identity를 제공한다.
- [ ] Connector가 START와 TERMINATE를 계약 검증 뒤에만 발행한다.
- [ ] Connector가 COMPLETE를 TERMINATE와 자원 폐기로 정규화할지 별도 완료 정책으로 처리할지 결정했다.
- [ ] SUSPEND 때 즉시 revoke할지, 재START 때 같은 snapshot을 복원할지 Connector별 정책을 결정했다.
- [ ] PUSH가 필요하면 소비자 sink 검증, 송신 job, 완료·보상 어댑터를 별도로 구현했다.
- [ ] Connector와 provisioner가 Idempotency-Key 충돌 규칙을 구현했다.
- [ ] provisioner가 자원 수명과 철회를 실제로 강제한다.
- [ ] registry의 `resourceRef`가 typed identifier와 불변 선택 조건으로만 구성되고, URL userinfo·credential query·Bearer/token/password 값이 없다.
- [ ] 기존 전송이 모두 폐기될 때까지 provisioner ID와 어댑터 설정을 보존한다.
- [ ] journal 저장 볼륨의 접근권과 백업·복구 절차를 정했다.
- [ ] journal revision을 외부 CAS 또는 append-only anchor에 결합하고 rollback 복구 시험을 했다.
- [ ] 다중 호스트 배포이면 fencing이 있는 분산 lock으로 교체했다.
- [ ] Connector별 DataAddress의 Provider Data Plane source binding 변환과 데이터 평면 상호운용 시험을 마쳤다.
- [ ] TLS 인증서, egress allowlist, 환경 변수 secret injection을 배포 환경에서 확인했다.
- [ ] provision 후 중단, 시작 보고 후 중단, revoke 후 중단 시험을 수행했다.

소스코드가 있다는 사실만으로 운영 연결이 완료되지는 않는다. 실제 Connector 관리 API, 원천 플랫폼 provisioner, 자격증명, 배포 lock, 데이터 평면 형식에 대한 기관별 구현과 시험이 남는다.
