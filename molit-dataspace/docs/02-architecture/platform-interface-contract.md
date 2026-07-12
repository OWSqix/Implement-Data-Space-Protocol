# 기존 플랫폼 인터페이스 계약

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 범위

이 문서는 Platform-to-Dataspace Bridge의 southbound 계약을 정의한다. 국토교통 통합채널에 해당 API가 이미 존재한다고 주장하지 않는다.

- 운영기관은 지원 기능과 제약을 공식 명세 또는 재현 가능한 시험 결과로 제공한다.
- Bridge 설계자는 이 계약으로 Connector 후보와 플랫폼 기능을 비교한다.
- PoC mock은 이 계약의 정상·오류·회수 동작을 구현한다.
- 운영 API가 계약을 충족하지 못하면 해당 capability를 `none` 또는 `manual`로 판정한다.

## 2. Capability Profile

플랫폼마다 아래 기능의 지원 수준을 먼저 기록한다.

| Capability | `none` | `manual` | `api` | `event-driven` |
| --- | --- | --- | --- | --- |
| metadata baseline | 제공 안 함 | 파일 전달 | pagination API | baseline+event |
| metadata delta·delete | 제공 안 함 | 수동 통지 | modified cursor·tombstone | webhook·event stream |
| payload access | landing link만 | 관리자 export | API·object·query | stream·on-demand job |
| subscription | 없음 | 운영자 승인 | create/read/delete API | 상태 event 포함 |
| identity binding | 없음 | 계정 사전등록 | service account·federation API | 자동 lifecycle |
| credential lifecycle | 장기 공용키 | 수동 발급·회수 | scoped token API | revoke event 포함 |
| audit export | 없음 | 운영자 보고서 | request·subscription API | event stream |

`none`이 많다고 플랫폼 연계가 불가능한 것은 아니다. 다만 가능한 통합 수준이 discovery-only 또는 수동 실증으로 낮아진다.

## 3. Metadata Source 계약

### 3.1 필수 기능

- 안정적인 source system ID와 record ID
- baseline pagination 또는 versioned export
- `created`, `modified`, 가능하면 source version
- 삭제·비활성화 표현
- publisher, `hosted·brokered·index-only·unknown` 판정 근거, license·rights, access rights
- Distribution 후보와 실제 제공형태
- schema version과 변경 통지정책
- 공식 지원범위, 인증방식, quota와 SLA

### 3.2 요청·응답 규칙

| 항목 | 요구사항 |
| --- | --- |
| Pagination | cursor 권장, page size 상한과 안정적 정렬 명시 |
| Delta | `modifiedSince`만으로 삭제가 사라지지 않게 tombstone 제공 |
| Time | timezone을 포함한 ISO 8601, server clock 기준 설명 |
| Retry | 읽기 요청은 멱등, `429`에는 재시도 정보 제공 |
| Schema | machine-readable schema와 호환성 정책 제공 |
| Deletion | hard delete와 일시 비활성화를 구분 |
| Provenance | 원 제공기관과 플랫폼 내 record URL을 보존 |

단일 페이지 애플리케이션(Single-Page Application, SPA) 내부 API는 브라우저 cookie와 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 방어 token을 요구할 수 있다.
이런 내부 API는 이 계약을 만족한다고 보지 않는다. 운영 source로 채택하려면 별도의 server-to-server 인증, version, SLA와 변경통지 근거가 필요하다.

## 4. Source Access 계약

Bridge는 임의 endpoint를 호출하지 않는다. 승인된 source binding만 사용한다.

| 필드 | 설명 |
| --- | --- |
| `sourceType` | http, object, file-export, ogc, stream, query, compute |
| `endpointRef` | secret이 아닌 endpoint registry 참조 |
| `credentialRef` | Vault·하드웨어 보안 모듈(Hardware Security Module, HSM)·credential broker 참조 |
| `networkScope` | public 또는 승인된 private DNS view·hostname·port·클래스 없는 도메인 간 라우팅(Classless Inter-Domain Routing, CIDR) 범위·egress zone |
| `allowedOperations` | method·path·query·layer·topic·job template |
| `limits` | timeout, bytes, rows, features, concurrency, quota |
| `dataVersion` | snapshot·schema·stream subject version |
| `deliveryProfile` | direct, gateway, snapshot, push, stream, compute |
| `retention` | cache·staging·log 보존과 삭제 규칙 |

외부 호출은 HTTPS, hostname 검증, egress allowlist와 secret masking을 기본으로 한다. 운영기관이 HTTP만 문서화한 endpoint는 key 발급이나 PoC 호출 전에 지원 hostname과 TLS 경로를 확인한다.

## 5. Subscription·Entitlement 계약

Mobilithek형 full lifecycle bridge에는 다음 명령이 필요하다.

```text
createEntitlement(idempotencyKey, scope, participant, product, agreement, transferPid?, expiry)
getEntitlement(externalId)
suspendEntitlement(idempotencyKey, externalId, reason)
resumeEntitlement(idempotencyKey, externalId)
deleteEntitlement(idempotencyKey, externalId, reason)
listEntitlements(filter)
```

실제 플랫폼의 endpoint와 명칭은 달라도 명령의 의미는 같아야 한다.

- 모든 상태 변경 명령은 멱등키를 가진다.
- `scope`는 `offering·agreement·transfer·request` 중 하나다.
- Transfer scope 자원의 생성에는 `transferPid`를 전달해 생성 시점부터 감사 상관관계를 만든다.
- external resource ID는 생성 응답에서 받은 뒤 확정 저장한다.

### 5.1 생성 응답

- stable external resource ID
- 현재 상태와 상태 변경시각
- 적용 participant·product·scope
- expiry와 갱신 규칙
- payload 접근을 위한 별도 token issuer 또는 binding reference
- platform correlation ID

### 5.2 삭제 의미

`DELETE 204`만으로 회수가 끝났다고 판정하지 않는다. 다음 결과를 확인한다.

- 신규 payload request의 거부 결과
- 이미 발급한 token·signed URL·접근제어목록(Access Control List, ACL)의 폐기 결과
- stream consumer group과 replay 권한의 제거 결과
- 생성한 export·snapshot의 보존정책별 삭제 결과
- 삭제 상태 조회 또는 audit evidence

## 6. Identity Binding 계약

| 항목 | 확인 내용 |
| --- | --- |
| Dataspace identity | participant ID 형식과 issuer |
| Platform identity | organization·tenant·service account 식별자 |
| Binding authority | 누가 두 ID의 연결을 승인하는가 |
| Scope | 어떤 Dataset·API·quota에 적용되는가 |
| Lifetime | 생성·갱신·탈퇴·revoke 시점 |
| Audit | 누가 언제 어떤 근거로 binding했는가 |

사람 계정의 비밀번호, browser session cookie, 개인용 API key를 Bridge credential로 재사용하지 않는다. 플랫폼이 기관용 service account나 federation을 지원하지 않는다면 이를 production blocker로 기록한다.

## 7. Change Event 계약

event를 지원한다면 최소 envelope는 다음 의미를 담는다.

```yaml
event_id: "stable-unique-id"
event_type: "dataset.updated|dataset.deleted|entitlement.changed|credential.revoked"
occurred_at: "2026-07-11T00:00:00+09:00"
resource_id: "platform-resource-id"
resource_version: "monotonic-or-comparable-version"
correlation_id: "optional-non-secret-id"
```

필수 동작:

- 중복 event를 멱등하게 처리한다.
- 순서가 뒤바뀌면 resource version으로 최신 상태를 판정한다.
- event gap을 발견하면 baseline reconciliation을 실행한다.
- payload와 secret을 event에 싣지 않는다.
- event signature, issuer, replay 방지와 보존기간을 정한다.

event가 없으면 polling과 전체 reconciliation 주기를 SLA·quota 안에서 합의한다.

## 8. 오류 계약

| 종류 | 예 | Bridge 처리 |
| --- | --- | --- |
| 요청 오류 | 잘못된 product·scope | 재시도 없이 quarantine 또는 4xx |
| 인증·권한 | expired credential, forbidden proxy | 신규 처리 중지, secret·authority 검토 |
| 충돌 | 같은 멱등키의 다른 요청 | 기존 external ID 조회 후 일치 검증 |
| 호출량 | quota·concurrency 초과 | 명시된 시간 뒤 제한 재시도 |
| 일시 장애 | timeout·5xx | backoff+jitter, circuit breaker |
| 영구 삭제 | unknown dataset·gone | Offering withdrawal workflow |
| schema 불일치 | incompatible response | adapter quarantine, 신규 전송 중지 |

오류 응답에는 secret, 내부 stack trace, 다른 tenant의 resource 존재 여부가 포함되지 않아야 한다.

## 9. 운영·감사 계약

플랫폼 운영기관과 다음을 합의한다.

- 지원시간과 장애 연락처
- 가용성·응답시간·변경통지 목표
- quota 소유자와 초과 책임
- schema·endpoint·인증 변경의 사전 통지기간
- subscription·token·export의 감사 조회 방법
- 로그 보존기간과 개인정보·secret masking
- credential 분실·유출·rotation 절차
- offboarding 때 Dataset, binding, subscription을 정리하는 순서

## 10. PoC용 mock 계약

실제 운영 API가 확인되기 전에는 production SPA endpoint를 흉내 내지 않는다. 다음 동작만 가진 mock platform으로 Bridge 상태를 먼저 검증한다.

1. Dataset baseline·delta·delete 제공
2. 공개 file 또는 API source 제공
3. entitlement create/read/delete 제공
4. token TTL과 revoke 제공
5. 중복·timeout·429·5xx·out-of-order event 주입
6. audit query와 orphan resource 조회

mock을 통과해도 운영 연계 승인이 된 것은 아니다. 운영 endpoint, 권리, credential과 SLA를 확인한 뒤 같은 contract test를 실제 sandbox에 적용한다.

## 11. 운영기관 요청 증거

- 요청 시점에 유효한 API·schema·인증 명세와 적용 version
- server-to-server 이용 허용 근거
- Dataset·delivery path별 `hosted·brokered·index-only·unknown` 구분 기준
- 데이터별 제공·재제공 권한과 license source
- 기관용 account, token, quota 정책
- subscription·entitlement 수명주기 명세
- metadata·subscription 변경·삭제 통지 방식
- sandbox와 합성 test data
- SLA, 장애·보안사고 연락망과 변경관리 정책

구두 답변은 조사 단서로는 사용할 수 있지만 P0 Gate를 닫는 증거로는 부족하다. 발행기관, 담당부서, 적용범위, version과 유효일을 확인할 수 있는 문서나 재현 가능한 시험 결과를 받는다.
