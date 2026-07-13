# 플랫폼 게시 Bridge 운영 구현

목적: 기존 플랫폼의 검증된 메타데이터를 Provider Connector에 안전하게 게시하는 운영 경계를 설명한다.
작성일: 2026-07-13
상태: 구현 완료, 기관별 Adapter와 운영 승인은 미확정

## 1. 목적과 범위

이 런타임은 기존 플랫폼의 메타데이터를 읽어 MOLIT DCAT-AP 검사를 거친 뒤 Provider Connector의 관리 API에 게시한다. Provider Connector는 게시된 Offering을 외부 Consumer에게 DSP Catalog로 제공하고, 외부 요청에 따라 계약 협상과 전송을 처리한다.

게시 Bridge가 자기 Offering을 다시 소비하지는 않는다. 다음 두 인터페이스는 다른 용도다.

| 인터페이스 | 용도 | 표준 여부 |
| --- | --- | --- |
| Connector management publication | Provider Connector에 asset·policy·source binding을 등록 | Connector 제품별 관리 API |
| DSP Catalog·Contract·Transfer | Consumer와 Provider Connector 사이의 데이터 교환 | DSP 2025-1-err1 wire protocol |

`ConnectorManagementClient`는 DSP endpoint가 아니다. 관리 API의 경로와 요청 형식은 사용하는 Connector에 맞춰 Adapter를 작성해야 한다.

`ExperimentalDspPollingClient`는 공식 DSP 요청 Schema와 HTTPS 경로를 사용하지만 완전한 Consumer 구현은 아니다. 표준 DSP 계약은 `ContractOfferMessage`와 `ContractAgreementMessage` callback을 처리해야 한다.

현재 코드는 Connector가 `FINALIZED` 조회 응답에 `agreementId`를 추가하는 비표준 확장을 명시적으로 허용한 시험에서만 전송 단계로 진행한다. 이 경로는 기본 게시 worker에서 호출하지 않는다.

## 2. 실행 경로

```text
Platform HTTP API
  -> pagination/ETag poller
  -> source-specific JSON path projector
  -> staged RDF file
  -> MOLIT DCAT-AP SHACL Gate
  -> detached operator approval
  -> durable publication queue
  -> Connector management API
  -> Provider Connector DSP endpoint
```

JSON path projector는 범용 crosswalk가 아니다. 기관별 Adapter가 다음 결과를 먼저 만들어야 한다.

1. 게시할 RDF 파일
2. Connector management API에 전달할 Offering 객체
3. 운영자가 승인한 `approvalId`

Projector는 이 세 결과를 결합하고 RDF 파일을 프로파일 Gate에 전달한다. 원천 DB·Excel·기관 API를 MOLIT RDF로 바꾸는 규칙은 해당 플랫폼의 field crosswalk에 구현해야 한다.

## 3. 원천 API 계약

`HttpPlatformAdapter`는 JSON 페이지를 가져온다. 경로는 설정으로 지정한다.

```json
{
  "items": [
    {
      "id": "source-1",
      "version": 17,
      "metadata": { "file": "source-1-v17.ttl" },
      "dispatch": { "approvalId": "approval-2026-0041" },
      "publication": { "offering": { "assetId": "urn:dataset:1" } }
    }
  ],
  "nextCursor": "opaque-next-page"
}
```

Adapter는 ID 512자, version 128자, cursor 2,048자, 페이지 수, 페이지 항목 수, 응답 byte를 제한한다. `ETag`와 `Last-Modified`는 첫 페이지의 조건부 요청에 사용한다. cursor가 반복되거나 최대 페이지 수 안에 종료되지 않으면 checkpoint를 갱신하지 않는다.

거부 record가 하나라도 있으면 해당 poll의 checkpoint를 전진시키지 않는다. 거부 ID·version·오류 코드는 `quarantine`에 저장한다. 승인을 교체하거나 RDF를 수정한 뒤 같은 version을 다시 읽으면 재평가할 수 있다. 이미 enqueue된 record는 `providerId:recordId:version` 키로 중복 제거한다.

## 4. 프로파일 Gate와 승인 원장

RDF 파일은 `validateProfileDocument()`로 검사한다. 설정의 `profileName`과 `profileVersion`이 적용된다. `gatePassed=false`이면 관리 API를 호출하지 않는다.

승인 원장은 원천 API와 별도 파일로 둔다.

```json
{
  "schemaVersion": "molit.dispatch-approval-registry/1",
  "entries": [
    {
      "approvalId": "approval-2026-0041",
      "sourceSystemId": "molit-platform-01",
      "sourceRecordId": "source-1",
      "resourceVersion": "17",
      "payloadDigest": "64자리 sha256",
      "validFrom": "2026-07-13T00:00:00Z",
      "validUntil": "2026-08-13T00:00:00Z",
      "status": "approved",
      "approvedBy": "urn:molit:operator:catalog-board"
    }
  ]
}
```

`payloadDigest` 입력은 다음 객체의 stable JSON이다.

```json
{
  "metadata": {
    "sha256": "RDF 파일의 SHA-256",
    "profileName": "dataspace-offering",
    "profileVersion": "1.0.0-rc.1",
    "decisionDigest": "프로파일 Gate 판정 digest"
  },
  "offering": { "Connector에 게시할 객체": "전체" }
}
```

승인은 source system, record ID, version에 묶인다. 원천 record가 자기 `approvalId`를 써 넣는 것만으로는 게시할 수 없다.

Worker는 poll과 dispatch 때 승인 파일을 다시 읽으므로 revoke가 재시작 없이 반영된다. 기관 운영에서는 승인 파일도 서명된 배포 artifact로 관리해야 한다. 현재 원장은 Ed25519 서명을 검증하지 않으므로 기관 PKI 승인은 외부 차단항목으로 남는다.

## 5. Queue와 장애 복구

상태 파일은 checkpoint, ready·leased queue, completed ledger, dead letter, quarantine을 한 문서에 저장한다.

- 저장은 임시 파일 write, file `fsync`, atomic rename, directory `fsync` 순서로 수행한다.
- 한 번에 한 항목만 claim한다.
- lease는 network I/O 중 주기적으로 연장한다.
- process가 비정상 종료되면 만료된 lease를 ready로 되돌린다.
- 같은 host에서 죽은 PID가 남긴 lock은 다음 실행이 회수한다.
- 최대 시도 횟수를 넘긴 항목은 dead letter로 이동한다.

전달 보장은 at-least-once다. 관리 API가 성공한 직후 ack 전에 process가 종료되면 같은 요청을 다시 보낼 수 있다. 설정에서 `supportsIdempotencyKey=true`가 없으면 client 생성이 실패한다.

Connector 관리 API는 전달된 `Idempotency-Key`를 영속적으로 보존하고 같은 키에 같은 결과를 반환해야 한다. 지원 여부를 확인하지 않은 Connector에는 이 worker를 연결하면 안 된다.

현재 JSON 상태 저장소의 상한은 128 MiB다. completed·dead-letter·quarantine 원장은 자동 삭제하지 않는다.

다중 instance와 대량 catalog에는 PostgreSQL 같은 transactional queue로 `durable-store.mjs`를 교체한다. Queue 함수의 claim·renew·ack·nack 계약은 그대로 유지한다.

## 6. HTTP 보안

런타임은 다음 검사를 요청 전에 수행한다.

- HTTPS 강제
- exact origin allowlist
- URL userinfo 금지
- redirect 금지
- DNS 결과의 loopback·link-local·unspecified·multicast 차단
- 응답 시간과 byte 제한
- secret의 환경변수 주입
- structured log의 authorization·token·key redaction

내부 사설망 endpoint는 `privateOrigins`에 origin을 정확히 등록한다. 이 설정도 link-local이나 loopback을 허용하지 않는다. `fixtureMode`의 HTTP·loopback 허용은 `NODE_ENV=test`에서만 동작한다.

DNS 확인과 Node `fetch`의 실제 연결 사이에는 TOCTOU 구간이 있다. 운영망은 DNS rebinding 방어를 애플리케이션 하나에 맡기지 않는다.

고정 egress proxy, DNS policy, 방화벽 allowlist를 함께 적용한다.

GET·HEAD·OPTIONS만 일반 retry 대상이다. Connector management POST는 제품이 Idempotency-Key를 지원한다고 선언한 경우에만 retry한다. DSP POST에는 표준이 정의하지 않은 Idempotency-Key를 붙이지 않으며 자동 retry도 하지 않는다.

## 7. 실행

설정 예시는 `fixtures/runtime/config.example.json`에 있다. secret 값은 파일에 쓰지 않는다.

```powershell
$env:MOLIT_PROVIDER_TOKEN = "..."
$env:MOLIT_MANAGEMENT_TOKEN = "..."
npm run bridge:runtime:dry-run
npm run bridge:runtime:once
npm run bridge:runtime
```

Dry-run은 원천 API와 프로파일 Gate를 실행하지만 checkpoint와 queue를 변경하지 않는다. 지속 실행은 `SIGINT`와 `SIGTERM`을 받아 현재 호출의 AbortSignal을 취소하고 poll loop를 종료한다.

## 8. 관측 지표

로그는 OpenTelemetry Log Data Model과 함께 수집하기 쉬운 JSON line 형식이다. 필드는 `timestamp`, `severityText`, `body`, `attributes`다.

주요 metric 이름은 다음과 같다.

- `molit_bridge_http_requests_total`
- `molit_bridge_http_failures_total`
- `molit_bridge_http_duration_ms_total`
- `molit_bridge_poll_records_total`
- `molit_bridge_poll_rejected_total`
- `molit_bridge_queue_recovered_total`
- `molit_bridge_queue_claimed`

현재 exporter는 in-process snapshot이다. 운영 배포에서는 `Telemetry` sink를 OpenTelemetry Collector exporter로 교체한다. metric 이름과 attribute 계약은 유지한다.

## 9. DSP 참조 시험

공식 Schema snapshot은 `standards/vendor/dsp/2025-1-err1/`에 있다. upstream tag, commit, Apache-2.0 LICENSE, 파일별 SHA-256은 `manifest.json`에 고정했다. client는 outgoing과 incoming 메시지를 이 Schema로 검사한다.

비표준 polling extension을 제공하는 Connector에 한해 다음 참조 시험을 실행할 수 있다.

```powershell
npm run bridge:dsp:smoke -- `
  --config fixtures/runtime/dsp-smoke-config.example.json `
  --request fixtures/runtime/dsp-smoke-request.example.json `
  --ack-nonstandard-extension yes
```

요청에는 운영자가 고정한 Dataset ID, Offer ID, Offer stable digest를 넣는다. client는 Catalog의 첫 Offer를 임의 선택하지 않는다. 조회한 Offer의 ID와 digest가 모두 같을 때만 계약 요청을 보낸다.

이 시험은 callback receiver를 대신하지 않는다. 표준 DSP Consumer worker에는 다음 callback을 durable inbox와 연결하는 구현이 필요하다.

- Contract Offer 수신
- Accept event 발신
- Contract Agreement 수신
- Agreement verification 발신
- Transfer Start 수신

그 작업이 끝나기 전에는 `ExperimentalDspPollingClient`를 실운영 Consumer로 배포하지 않는다.

## 10. 공급자 전송 provisioning

`src/transfer-runtime/`에는 Provider Connector가 승인한 PULL 전송을 플랫폼 자원으로 바꾸는 Worker가 있다. 구현 범위는 `START`와 `TERMINATE`다.

- Agreement·Transfer identity를 Connector authoritative status와 다시 대조한다.
- Dataset·format을 private binding registry의 token·signed URL·snapshot·export provisioner에 연결한다.
- DataAddress 원문은 Connector에만 전달하고 journal에는 digest만 남긴다.
- termination 때 같은 binding snapshot으로 자원을 철회한다.
- provision·revoke·Connector 보고의 중단 지점을 phase journal로 재조정한다.

실행 계약과 복구 절차는 [공급자 전송 provisioning Worker](provider-transfer-worker.md)에 정리했다. 이 Worker는 Connector 관리 제어 평면의 Adapter이며 DSP endpoint가 아니다.

기관별 Connector webhook inbox, 실제 플랫폼 provisioner와 Data Plane 상호운용 시험은 남아 있다. PUSH·SUSPEND·COMPLETE는 현재 범위에 포함하지 않는다.

원천 삭제와 Connector Offering 철회도 제품별 관리 API가 필요하다. 현재 publication worker는 upsert만 처리하며 delete·unpublish event는 처리하지 않는다. 철회 Adapter가 확정되기 전에는 원천 삭제를 자동 전파한다고 주장하지 않는다.

## 11. 시험

```powershell
npm run test:runtime
```

Fixture HTTP server는 pagination, 조건부 요청, management publication, 공식 DSP Catalog·Contract·Transfer 메시지 검증을 한 process에서 재현한다.

별도 단위시험은 queue lease 회수, 중복 제거, dead letter, redirect 차단, byte 제한, origin 정책, secret redaction을 검사한다.

실제 기관 API, 운영 Connector, 기관 승인키는 fixture에 포함하지 않는다. 이 세 항목은 배포 전 현장 시험에서 닫아야 한다.
