# 공급자 PULL 전송 프로비저닝 Worker

## 1. 맡는 범위

이 Worker는 Connector가 계약과 전송 요청을 승인한 뒤에 실행한다. 승인된 전송 건을 플랫폼 자원에 연결하고, 소비자가 사용할 `DataAddress`를 Connector 관리 API에 돌려준다. 전송 종료 건에서는 같은 자원을 폐기한 뒤 종료 결과를 보고한다.

구현된 action은 `START`와 `TERMINATE` 두 개다. PULL 방식의 접근 주소를 발급하고 폐기하는 범위만 다룬다. DSP의 `SUSPENDED`와 `COMPLETED` 상태 전체를 구현한 범용 전송 Worker가 아니다.

이 구성요소는 DSP 전송 프로토콜 엔드포인트가 아니다. DSP 메시지 수신, 계약 검증, 전송 상태 머신, 콜백 송신은 선택한 Connector가 맡는다.

DSP 2025-1 규격도 데이터 평면 인터페이스를 규격 범위 밖으로 둔다. 이 저장소의 `DataAddress`는 Connector 관리 어댑터와 합의한 제어 평면 객체다. 특정 DSP wire 형식에 적합하다고 주장하지 않는다.

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
| `src/transfer-runtime/journal.mjs` | 원자적 phase journal과 provider별 직렬화 lock |
| `src/transfer-runtime/clients.mjs` | Connector 관리 API와 플랫폼 provisioner 어댑터 |
| `src/transfer-runtime/binding-registry.mjs` | 데이터셋·형식 바인딩 조회 |
| `src/transfer-runtime/config.mjs` | 운영 설정 검증 |
| `contracts/provider-transfer-event.v1.schema.json` | 승인 이벤트 계약 |
| `contracts/transfer-binding-registry.v1.schema.json` | private binding 계약 |
| `contracts/provider-transfer-result.v1.schema.json` | provisioner 결과 계약 |
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

START에는 `START_AUTHORIZED`가 필요하다. 이미 처리한 이벤트를 재수신했을 때만 `STARTED`를 받아들인다. TERMINATE에는 `TERMINATION_AUTHORIZED`가 필요하며, 완료 재확인에는 `TERMINATED`를 받아들인다. 일치하지 않는 값과 중간 상태는 처리하지 않는다.

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

신규 전송을 막으려고 `enabled`를 `false`로 바꾸거나 현행 registry에서 항목을 제거해도 기존 접근권은 폐기할 수 있다. 시작 journal을 잃은 전송을 복구해야 한다면 tombstone이 필요하다. 해당 전송을 모두 폐기할 때까지 snapshot이 가리키는 provisioner 설정과 어댑터도 유지해야 한다.

`resourceRef`에는 비밀번호, API key, bearer token을 기록하지 않는다. provisioner의 제어 API 인증정보는 환경 변수에서만 읽는다.

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
6. Connector가 접수를 확인하면 `active`로 바꾼다.

`DataAddress` 원문은 journal과 일반 로그에 남기지 않는다. 3번 이후에 프로세스가 중단되면 같은 provision idempotency key로 3번을 다시 호출한다.

provisioner는 같은 자원을 반환해야 한다. Worker는 이 계약을 이용해 비밀 접근 정보를 디스크에 보관하지 않고 Connector 보고를 재개한다.

### 6.2 TERMINATE

```text
active → terminating → revoked → terminated
```

Connector 보고가 실패해도 revocation 결과는 `revoked`로 남는다. 다음 실행은 자원을 다시 만들거나 다른 자원을 폐기하지 않고 종료 보고만 반복한다. revocation 자체도 고정된 idempotency key를 사용한다. 시작 보고 전에 종료 승인이 도착한 경우에도 `authorized` 또는 `provisioned` 자원을 폐기한다.

### 6.3 프로세스 동시 실행

외부 부작용이 끝날 때까지 `providerPid`별 파일 lock을 유지한다. 같은 전송의 START와 TERMINATE가 서로 엇갈려 접근권을 되살리는 상황을 막는다.

lock 소유 프로세스가 종료된 경우 같은 호스트의 PID 생존 여부를 확인한 뒤 stale lock을 회수한다. 공유 스토리지와 여러 호스트를 쓰는 배포에서는 파일 lock 대신 fencing token을 제공하는 분산 lock 어댑터가 필요하다.

## 7. 어댑터 계약

### 7.1 Connector 관리 API

이 경로들은 표준 DSP 경로가 아니다. 선택한 Connector에 맞춰 관리 어댑터를 구현한다.

| 동작 | 기본 예시 | 요구 결과 |
| --- | --- | --- |
| authoritative status | `GET transfers/{providerPid}` | identity 다섯 값과 승인 상태 |
| 시작 보고 | `POST transfers/{providerPid}/started` | `200`, `204`, 또는 같은 요청의 `409` |
| 종료 보고 | `POST transfers/{providerPid}/terminated` | `200`, `204`, 또는 같은 요청의 `409` |

두 POST는 `Idempotency-Key`를 저장하고 같은 key·같은 본문에 같은 의미의 결과를 내야 한다. key만 같고 본문이 다르면 거부해야 한다. 설정의 `supportsIdempotencyKey: true`는 이 운영 계약을 구현했다는 명시적 선언이다.

### 7.2 Platform provisioner

| 동작 | 요청의 핵심 값 | 필수 성질 |
| --- | --- | --- |
| provision | 고정 binding의 `resourceRef`, authoritative transfer identity | 같은 key로 자원을 중복 생성하지 않음 |
| revoke | 시작 때 사용한 provisioning key와 같은 `resourceRef` | 이미 폐기됐거나 없는 경우도 안전함 |

provision 응답은 `provisioningId`와 Connector 관리 어댑터가 이해하는 `dataAddress`를 반환한다. `409`를 사용하는 provisioner도 원래 요청의 정규 결과를 본문에 넣어야 한다. Worker는 재호출 결과의 provisioning ID와 DataAddress digest가 달라지면 중단한다.

signed URL이나 토큰을 만드는 provisioner는 수명, agreement binding, consumer binding, 최소 권한, 취소 방식을 별도로 구현해야 한다. 이 저장소의 범용 어댑터가 해당 정책을 대신 결정하지 않는다.

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

현재 DNS 검사는 연결 직전 조회 결과를 검증하지만, HTTP client의 실제 socket 주소를 pinning하지는 않는다. DNS rebinding 위협을 차단해야 하는 환경에서는 고정 egress proxy 또는 IP pinning 기능이 있는 전용 HTTP 어댑터를 사용한다.

## 9. 실행

예제 설정은 실제 도메인과 자격증명으로 바꿔야 한다.

```powershell
$env:MOLIT_CONNECTOR_MANAGEMENT_TOKEN = "..."
$env:MOLIT_EXPORT_CONTROL_TOKEN = "..."
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
- [ ] registry의 `resourceRef`에 비밀정보가 없다.
- [ ] 기존 전송이 모두 폐기될 때까지 provisioner ID와 어댑터 설정을 보존한다.
- [ ] journal 저장 볼륨의 접근권과 백업·복구 절차를 정했다.
- [ ] 다중 호스트 배포이면 fencing이 있는 분산 lock으로 교체했다.
- [ ] Connector별 DataAddress 변환과 데이터 평면 상호운용 시험을 마쳤다.
- [ ] TLS 인증서, egress allowlist, 환경 변수 secret injection을 배포 환경에서 확인했다.
- [ ] provision 후 중단, 시작 보고 후 중단, revoke 후 중단 시험을 수행했다.

소스코드가 있다는 사실만으로 운영 연결이 완료되지는 않는다. 실제 Connector 관리 API, 원천 플랫폼 provisioner, 자격증명, 배포 lock, 데이터 평면 형식에 대한 기관별 구현과 시험이 남는다.
