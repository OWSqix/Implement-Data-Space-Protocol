# 기존 플랫폼 인터페이스 계약

작성일: 2026-07-11  
작성 기준: 2026-07-11  
개정일: 2026-08-03  
상태: Draft

## 1. 목적과 범위

이 문서는 Platform-to-Dataspace Bridge의 southbound 계약을 정의한다. 국토교통 통합채널에 해당 API가 이미 존재한다고 주장하지 않는다.

이 문서의 2~11절은 허브가 특정 데이터셋에서 계약별 Provider 기능을 수행할 때 적용하는 원천 측 계약이다. southbound는 관리·상태 인터페이스의 방향이며 payload의 목적지를 뜻하지 않는다.

- **(Decision)** 데이터 스페이스는 payload를 보관하거나 중계하지 않는다. 신원·카탈로그·계약·정책·감사를 처리하고, Consumer는 계약 뒤 원천의 실제 바이트를 직접 당겨온다.
- **(Verified)** DSP는 Control Plane과 Data Plane을 논리적으로 분리하며 payload 전송 프로토콜을 규정하지 않는다.
- **(Decision)** Provider transfer worker는 Connector가 이미 승인한 당겨오기(Pull, PULL) 전송 사건을 받아 원천 플랫폼 token이나 signed URL을 발급하는 경계다. 이 worker를 EDC Data Plane이나 DSP endpoint로 부르지 않는다.

근거: [ADR-0002](../adr/0002-data-stays-at-source.md), [EDC 기반 CaaS·DSaaS 구성 설계 §6](edc-caas-dsaas-architecture.md#6-offering-게시와-전송)

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

### 4.1 허브 연계 범위

- **(Decision)** `E-16` — 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다
- **(Decision)** `E-18` — 허브 연계 범위는 **재제공권 확인목록**으로 한다. 기본값은 미연계이고 재제공 권리가 문서로 확인된 데이터셋만 추가한다
- **(Inferred)** 2~11절의 허브 계약은 두 결정을 충족한 데이터셋에만 적용된다. 목록에 없거나 권리 문서의 적용 범위가 미확인인 데이터셋은 미연계로 유지한다.

`재제공권 확인목록`은 데이터셋별 재제공 권리의 문서 확인 결과다.

기존 `egress allowlist`는 서버 측 요청 위조(Server-Side Request Forgery, SSRF) 방어를 위한 DNS·클래스 없는 도메인 간 라우팅(Classless Inter-Domain Routing, CIDR)·egress 통제다. 두 목록의 명칭과 판정 근거를 합치지 않는다.

근거: [보안·신뢰·운영 §5](security-trust-and-operations.md#5-위협과-통제), [허브 역량 조사 §6](../01-research/hub-capability-assessment.md#6-원천-권리-위험), [허브 섭외 조사 §4](../01-research/hub-recruitment-feasibility.md#4-원천-권리와-조건부-가능-범위)(외부 자료 확인일 2026-08-02)

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
- 플랫폼이 생성·관리하는 export·snapshot의 보존정책별 삭제 결과
- 삭제 상태 조회 또는 audit evidence

### 5.3 플랫폼 수용 판정 절차

- **(Decision)** 다음 6단계 종단시험을 PULL 경로의 플랫폼 수용 판정 절차로 채택한다.
- **(Unverified)** 실제 운영 플랫폼별 통과 여부는 미검증이다. 공식 명세 또는 재현 가능한 sandbox 시험 증거를 확보하기 전에는 수용으로 판정하지 않는다.

| 단계 | 입력·선행조건 | 실행 주체와 동작 | 합격 기준 | 증거 |
| --- | --- | --- | --- | --- |
| 1. Entitlement 생성 | 체결된 데이터 스페이스 Agreement와 허브 대상 Dataset | 허브 Adapter가 Agreement ID로 entitlement를 한 번 생성 | 허브 entitlement ID가 Agreement ID와 mapping되고 중복 활성 객체 0개 | 생성 response, mapping record, 상태 event |
| 2. 접근·감사 | 활성 entitlement와 scoped credential | Consumer 서비스계정이 계약-ID를 포함해 원천 플랫폼의 payload에 직접 접근 | 접근 성공, Dataset·version·전달량·결과가 같은 correlation ID로 기록 | access log, payload checksum, audit record |
| 3. 정지·재개 | 활성 entitlement | Adapter가 `suspend` 뒤 접근을 시도하고 `resume` 뒤 다시 시도 | 정지 중 401 또는 403, 재개 뒤 동일 scope 접근 성공 | 상태 event, 두 접근 response, audit record |
| 4. 종료·회수 | 종료된 Agreement | Adapter가 원천 구독·key·임시 자원을 삭제하고 기존 credential로 재접근 | 원천 상태가 종료되고 신규·기존 credential 접근에서 401 또는 403 | 삭제 response, 원천 상태 조회, 접근 거부 log |
| 5. 멱등 재시도 | 각 단계와 같은 idempotency key | Adapter가 생성·정지·재개·삭제 요청을 재전송 | 상태가 한 번만 전이되고 중복 구독·key·청구 0개 | 재시도 response, 객체 수 조회, 상태 이력 |
| 6. 감사·삭제 증적 | 단계 1~5의 correlation ID | 운영자가 감사 export와 삭제·철회 증적을 생성 | 요청기관·계약·Dataset·version·결과·전달량·회수 시각을 한 묶음으로 조회 | 서명 또는 무결성 검증 가능한 export, 삭제·철회 증적 |

> **(경고)** "API가 있다", "승인 절차가 있다", "중계플랫폼이다"라는 설명만으로 역량을 인정해서는 안 된다.

근거: [허브 역량 조사 §8.1](../01-research/hub-capability-assessment.md#81-6단계-종단시험)(외부 자료 확인일 2026-08-02)

### 5.4 파일 데이터의 원리적 한계

- **(Verified)** 이미 내려받은 복제본은 기술적으로 회수할 수 없다.
- **(Decision)** 향후 다운로드 차단과 함께 소비자의 삭제·보존종료 확인 절차로 대체해야 한다.
  - **(합격 기준)** 계약 종료 뒤 원 다운로드 URL·credential 재사용에서 401 또는 403을 확인한다.
  - **(확인 증거)** 소비자는 파일 ID·checksum·삭제 시각·잔여 보존 예외를 기록한 확인서를 제공한다.
- **(Unverified)** 삭제 확인 절차만으로 소비자 저장장치의 물리적 삭제 여부는 판정 불가다.
- **(Inferred)** 이 한계는 재제공·보존이 전달 후 기계집행 불가인 것과 같은 성질이다. 정책 표현과 계약·감사 절차를 결합하되 기술적 회수로 판정하지 않는다.

근거: [허브 역량 조사 §8.2](../01-research/hub-capability-assessment.md#82-파일-데이터의-접근-회수)(외부 자료 확인일 2026-08-02), [메타데이터·정책 프로파일 §9](metadata-and-policy-profile.md#9-odrl-profile-후보)

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

## 12. Consumer 측 인터페이스 계약

- **(Decision)** `E-19` — 기존 정산 시스템(회계처리·버스경영관리시스템)은 **Consumer로 온보딩**한다. 계약을 맺고 운수사 원천에서 당겨온다
- **(Decision)** 데이터 스페이스가 실제 바이트를 수신하거나 정산 시스템에 적재하지 않는다. Consumer는 계약과 전송 요청을 처리한 뒤 운수사 원천에서 직접 PULL하고 자기 시스템에 적재한다.

Consumer 측 수용 판정에는 다음 능력의 확인이 필요하다.

| 요건 | 확인할 능력 | 현재 상태 |
| --- | --- | --- |
| 기관 신원·계약 | 기관 신원 제시와 계약 협상 수행 능력 | `Unverified` — 인터페이스와 증거 미조사 |
| 전송·수신 | 전송 요청과 수신 처리 | `Unverified` — protocol·오류·재시도 기준 미조사 |
| 적재·확인 | 수신 후 자기 시스템 적재와 그 결과의 확인 수단 | `Unverified` — 상태·증거·수용 기준 미조사 |

- **(Unverified)** Consumer 측 요건은 아직 조사되지 않았다.
- **(Inferred)** [허브 역량 조사](../01-research/hub-capability-assessment.md)는 Provider 측 원천 lifecycle 역량만 다뤘다. Consumer는 접근시험 행위자로만 나오며 기관 신원 제시, 계약 협상, 전송 요청, 수신 처리와 자기 시스템 적재는 조사 범위에 없다.

## 13. 미확인 사항과 결정 요청

- **(Decision)** `E-20` — 제출 이행은 **계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료**의 세 조건이 모두 충족된 때 성립한다

### 13.1 Consumer 측 인터페이스 조사

- **(ID)** `OPEN-PIC-01`
- **(관련 결정)** `E-19`
- **(상태)** `Unverified`
- **(미확인 사항)** 기존 정산 시스템의 기관 신원·계약 협상·전송 요청·수신 처리·자기 시스템 적재·결과 확인 인터페이스와 수용 증거가 미조사다.
- **(영향)** Consumer 기술적 온보딩 완료 여부는 판정 불가다.
- **(확인 방법)** 대상 정산 시스템의 공식 명세와 sandbox를 확보하고 12절의 세 능력에 대한 정상·오류·재시도·감사 시험 기준을 제안해 승인받는다.
- **(담당)** 미정
- **(기한)** 미정

### 13.2 이행 상태의 기계 판독 표현

- **(ID)** `OPEN-PIC-02`
- **(관련 미결)** `DRV-03`
- **(상태)** `Unverified`
- **(미확인 사항)** 세 조건의 충족 상태를 기계 판독 가능하게 표현하고 감사 기록으로 남기는 방법
- **(영향)** `E-20`의 이행 성립 여부를 자동 판정하거나 감사에서 재현하는 방법은 미정이다.
- **(확인 방법)** 세 조건의 상태 표현과 감사 기록 방식에 대한 후보를 작성하고 결정권자 승인을 요청한다.
- **(담당)** 미정
- **(기한)** 미정
