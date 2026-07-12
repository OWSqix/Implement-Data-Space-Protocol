# 플랫폼 연계와 전송 어댑터 설계

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 범위

기존 플랫폼은 system of record로 유지하고 세 종류의 adapter로 DSP 처리와 분리한다. 이 문서는 adapter의 입력, 출력, 저장 mapping, 실패 처리와 승인 기준을 정의한다.

1. Offering Onboarding Adapter: 플랫폼 record를 승인된 DSP Offering으로 등록·갱신·철회한다.
2. Platform Lifecycle Adapter: Agreement·Transfer를 플랫폼 subscription·entitlement·token·job 수명주기에 연결한다.
3. Data Plane Adapter: 승인된 source binding으로 실제 payload를 읽거나 쓴다.

세 adapter는 DSP message 자체를 구현하지 않는다. Provider Control Plane이 DSP 상태를 관리하고, adapter에는 검증된 내부 command와 context만 전달한다.

## 2. Adapter 경계

```text
Existing platform
  metadata API ── Offering Onboarding Adapter ── Connector Management API
  subscription API ── Platform Lifecycle Adapter ── Agreement·Transfer events
  data API·file·stream ── Data Plane Adapter ── Consumer
```

한 프로세스에 함께 배포할 수 있지만 다음 interface와 저장상태는 분리한다.

| Adapter | 입력 | 출력 | 저장해야 할 mapping |
| --- | --- | --- | --- |
| Offering | platform record·rights decision | Dataset·Offer·Distribution·DataService | source record→Connector objects |
| Lifecycle | Agreement·Transfer·policy event | entitlement·subscription·token·job command | Agreement·Transfer→external resource |
| Data Plane | approved transfer context | bytes·record·stream·result | Transfer→source request·delivery resource |

Catalog Broker crawl은 Offering Adapter가 아니다. Broker는 upstream Provider가 이미 게시한 Offering을 수집하고, Offering Adapter는 legacy platform record에서 새 Provider Offering을 만든다.

## 3. Offering Onboarding Adapter

| 동작 | 책임 |
| --- | --- |
| `discover` | baseline·delta·delete에서 source record 수집 |
| `normalize` | canonical Dataset·Distribution 후보와 provenance 생성 |
| `classify` | `hosted·brokered·index-only·unknown`과 rights·transfer Gate 결과 적용 |
| `validate` | DCAT·DSP cardinality, policy, authority, source binding 검사 |
| `publish` | Connector에 Dataset·Offer·Distribution·DataService를 멱등 등록 |
| `update` | metadata·policy·binding version을 호환성 규칙에 따라 교체 |
| `withdraw` | 신규 협상을 차단하고 기존 Agreement 영향처리 뒤 Catalog에서 제거 |
| `reconcile` | platform source와 Connector Catalog의 누락·중복·version drift 복구 |

`publish` 입력은 승인 bundle이어야 한다. source record만으로 Offer를 만들지 않는다. 승인 bundle에는 Offering Provider 권한 증거, policy version, Distribution, private binding, owner와 검증 결과가 포함된다.

## 4. Platform Lifecycle Adapter

| 동작 | 책임 |
| --- | --- |
| `can-provision` | Dataset·Agreement·participant에 맞는 플랫폼 기능 확인 |
| `provision` | subscription·entitlement·token·snapshot·job·ACL 생성 |
| `get-status` | external resource의 현재 상태와 expiry 조회 |
| `suspend` | 신규·계속 접근 차단, 가능한 subscription 일시정지 |
| `resume` | policy 재평가 뒤 접근 재개 |
| `release-transfer` | 해당 Transfer의 token·job·temporary ACL·snapshot 회수 |
| `release-agreement` | local Agreement 만료·철회·해지 때 장기 subscription·entitlement 회수 |
| `reconcile` | DSP desired state와 플랫폼 actual state의 차이 복구 |

Lifecycle Adapter는 모든 mutation에 멱등키와 `offering|agreement|transfer|request` scope를 부여한다.

- 상관관계에는 Agreement ID, Provider Transfer PID, source binding version과 external resource ID를 기록한다.
- create 응답이 유실되면 같은 멱등키로 외부 상태를 조회하거나 명령을 재호출한다.
- Transfer 완료·종료에서는 Transfer scope 자원만 정리한다.
- Agreement scope subscription은 local Agreement 종료 event까지 유지할 수 있다.

Lifecycle Adapter가 플랫폼 사람 계정의 비밀번호·session cookie를 사용해서는 안 된다. 기관용 service identity, federation 또는 승인된 credential broker를 사용한다.

세부 상태전이는 [Offering 온보딩과 접근 수명주기](offering-onboarding-lifecycle.md), 필요한 southbound 기능은 [기존 플랫폼 인터페이스 계약](platform-interface-contract.md)에 정의한다.

## 5. Data Plane Adapter 공통 계약

모든 adapter는 다음 동작을 제공해야 한다.

| 동작 | 책임 |
| --- | --- |
| `can-handle` | source type, sink type, transfer profile 지원 여부 판단 |
| `validate` | private source binding, secret reference, policy context와 request 검증 |
| `prepare` | 임시 endpoint·snapshot·ACL 등 전송 자원 준비 |
| `start` | source에서 read 또는 consumer sink로 push |
| `status` | 진행·byte·record·오류 상태 보고 |
| `suspend` | 가능한 전송을 중지하고 접근 차단 |
| `terminate` | token·ACL·임시파일·job 회수 |
| `reconcile` | Control Plane 상태와 외부 자원의 불일치 탐지·복구 |

Control Plane은 Adapter에 다음 공통 context를 전달한다.

- Agreement ID와 Agreement target Dataset ID
- Transfer consumer/provider PID와 Transfer Request `format`
- 내부에서 resolve한 Distribution·source binding ID
- participant, policy decision과 local expiry
- platform entitlement reference와 correlation ID

Consumer가 Transfer Request에 Distribution ID를 보낸다는 가정은 두지 않는다.

Adapter에 전달하기 전에 Control Plane이 다음 DSP 필드를 검증한다. 표에는 공통 JSON-LD 필수 필드인 `@context`와 `@type`을 따로 적지 않았다.

| 메시지 | 필수 필드 | profile별 조건 |
| --- | --- | --- |
| Transfer Request | `consumerPid`, `agreementId`, `format`, `callbackAddress` | push일 때만 Consumer sink `dataAddress` 추가 |
| Transfer Start | `providerPid`, `consumerPid` | pull일 때 Provider access `dataAddress` 필수 |

각 DSP 메시지는 확인 응답(Acknowledgement, ACK) 또는 오류 응답인 `ERROR`로 처리한다. Adapter와 외부 플랫폼 자원이 준비되기 전에는 Transfer Start를 보내지 않는다. 송신자는 ACK 전 peer의 상태 변경을 확정하지 않으며, `ERROR` 응답은 상태 전이로 기록하지 않는다.

## 6. REST API Adapter

### 6.1 처리 흐름

1. 소비자는 `FINALIZED` negotiation의 Agreement target Dataset에 광고된 Distribution `format` 중 하나를 Transfer Request에 지정한다.
2. Control Plane은 `(Dataset ID, format)`을 정확히 하나의 승인된 Distribution·source binding으로 resolve한다. 없거나 둘 이상이면 거부한다.
3. Control Plane이 REST adapter를 선택한다.
4. adapter는 짧은 TTL의 consumer-facing token과 proxy endpoint를 만든다.
5. 소비자 request의 method, path, query, header, body size를 allowlist와 비교한다.
6. source credential을 Vault에서 해석해 원천 API를 호출한다.
7. 응답 header·body를 허용된 범위로 정규화하고 audit를 남긴다.

### 6.2 보안 규칙

- 임의 source URL을 request에서 받지 않는다.
- scheme은 `https`만 허용하고 host, port와 path template은 승인된 private source binding에서만 선택한다. 예외가 필요하면 별도 보안승인을 요구한다.
- 소비자가 제공한 callback·sink endpoint와 public source는 DNS 해석 결과를 검증한다.
- loopback, link-local, private, reserved 또는 cloud metadata service 주소면 거부한다.
- 예상하지 않은 정규 이름(Canonical Name, CNAME)으로 해석돼도 거부한다.
- Data Lake·내부 API 같은 private source는 등록된 DNS view, hostname과 port에 맞아야 한다.
- 등록된 클래스 없는 도메인 간 라우팅(Classless Inter-Domain Routing, CIDR) 범위와 egress zone에도 맞아야 한다.
- Private source에서도 loopback, link-local과 cloud metadata service 주소를 거부한다.
- 승인 범위를 벗어난 주소와 예상 밖 CNAME도 private source에서 거부한다.
- source binding 등록 시와 실제 호출 시 DNS를 다시 resolve해 DNS rebinding과 split-horizon 불일치를 검사한다. 호출 시 결과가 승인된 binding 범위를 벗어나면 연결하지 않는다.
- TLS certificate chain, hostname과 최소 version을 검증하며 실패 시 HTTP로 낮추지 않는다.
- redirect는 기본 거부하고 필요 시 대상 host를 allowlist한다.
- 소비자가 source authorization header와 hop-by-hop header를 주입하지 못하게 한다.
- query parameter는 이름, datatype, 길이, 범위와 조합을 검증한다.
- 응답 크기, timeout, pagination과 최대 동시호출을 제한한다.
- 원천 key, OAuth secret과 내부 URL을 오류·trace·callback에 기록하지 않는다.
- query parameter로 전달되는 `serviceKey`도 URL·access log·metric label에서 제거한다.
- 계약·participant별 quota를 분리해 noisy neighbor를 방지한다.

### 6.3 Credential 패턴

| 패턴 | 사용 조건 | 주의점 |
| --- | --- | --- |
| Platform·Provider 기관 key | 원천 약관이 대행 gateway를 허용 | 계약별 사용량 계측과 총 quota 보호 |
| 계약별 provisioned key | 원천이 key 발급 API를 제공 | 종료 시 회수·실패 reconciliation |
| 소비자 소유 key 위탁 | 법·약관상 필요한 경우 | secret 위탁 근거, 저장 최소화, 교체절차 |
| direct source access | 공개 API에 proxy 가치가 낮음 | Catalog만 연합하고 원천 URL·license 제공 |

완전 공개 API에 불필요한 proxy와 계약을 강제하지 않는다. proxy가 필요하면 Connector 제품의 demo용 기능을 전제로 하지 않고 rate limit, audit, cache, timeout과 운영지원이 가능한 전문 gateway 또는 검증된 Data Plane을 선택한다.

## 7. File Snapshot Adapter

운영 데이터베이스(Database, DB)나 변동 파일을 transfer 도중 직접 읽지 않고, 일관된 snapshot을 만든다.

필수 manifest:

```yaml
dataset_id: "..."
snapshot_id: "..."
source_version: "..."
created_at: "..."
valid_time: "..."
media_type: "text/csv"
byte_size: 0
record_count: 0
checksum:
  algorithm: "sha-256"
  value: "..."
schema_version: "..."
spatial_extent: "..."
temporal_extent: "..."
expires_at: "..."
```

원칙:

- immutable object key와 checksum을 사용한다.
- 생성이 완료되기 전 object를 Catalog에 광고하지 않는다.
- consumer pull은 짧은 TTL의 signed endpoint를 사용한다.
- provider push는 승인된 sink type과 encryption을 검증한다.
- 재시도 시 같은 snapshot ID로 중복 파일을 만들지 않는다.
- 만료·계약 종료 후 임시 사본을 삭제하고 증적을 남긴다.

## 8. Database Export

운영 DB에 자바 데이터베이스 연결(Java Database Connectivity, JDBC)을 직접 제공하는 방식은 기본안에서 제외한다. 다음 순서로 선택한다.

1. 원천의 공식 API
2. 원천이 생성한 versioned export
3. 추출·변환·적재(Extract Transform Load, ETL) 작업이 생성한 read-only snapshot
4. 승인된 read replica와 제한된 query template

DB export가 필요한 경우 일관성과 접근 범위를 먼저 정한다.

- transaction snapshot과 최대 실행시간
- row·column filter와 masking
- query cost와 source 부하 제한
- retry에 따른 중복 처리

## 9. OGC Adapter

### 9.1 지원 대상

- 기존 웹 맵: 웹 맵 서비스(Web Map Service, WMS)
- 기존 피처: 웹 피처 서비스(Web Feature Service, WFS)
- 기존 타일: 웹 맵 타일 서비스(Web Map Tile Service, WMTS)
- 신규 우선 검토: OGC API Features

### 9.2 정책 집행

- operation: `GetCapabilities`, `GetMap`, `GetFeature` 등 허용목록
- layer·collection과 style 허용목록
- 경계 상자(Bounding Box, BBOX)와 관할구역 제한
- CRS·axis order 허용목록과 변환정책
- scale·zoom·spatial resolution 제한
- feature·property·response byte limit
- filter language와 복잡도 제한
- 좌표 정밀도 감소·민감 feature 제거

Capabilities나 OpenAPI 문서는 `dcat:endpointDescription`에 연결할 수 있지만, 제한 source의 실제 endpoint와 key를 노출하지 않는다.

## 10. Stream Adapter

실시간 교통·센서 데이터에는 다음 계약이 추가로 필요하다.

- topic 또는 subscription 격리 단위
- schema registry subject와 compatibility mode
- timestamp 의미, time zone, ordering key
- delivery semantics와 duplicate 처리
- retention, replay 시작점과 최대 lag
- participant·Agreement별 접근제어목록(Access Control List, ACL)과 credential TTL
- 종료 시 ACL·consumer group·secret 회수
- source backpressure와 consumer lag 대응

공식 샘플이 broker credential을 직접 전달하더라도 production에서는 장기 공용 credential을 소비자에게 제공하지 않는다.

## 11. Secure Analysis Adapter

원시 전송이 부적절한 자산에는 승인된 연산 서비스를 DSP Dataset의 technical service로 모델링한다.

- Provider는 실행용 Distribution·DataService·Offer를 통해 이용조건을 협상한다.
- Transfer Process는 승인된 job endpoint를 제공한다.
- 결과물은 별도 Dataset·Transfer 또는 승인된 result endpoint로 제공한다.

```text
Consumer submits signed job specification
  -> policy and code/package validation
  -> isolated execution near source
  -> output disclosure review
  -> approved aggregate result transfer
  -> workspace and key destruction
```

필수 통제:

- 허용 runtime·package·network·resource limit
- 원천 dataset read-only mount
- 외부 network 기본 차단
- 소수집단·개인 식별 결과 차단
- output size·format·query budget 제한
- 코드, 입력, 실행환경, 결과 hash와 승인기록
- workspace·temporary object의 만료·파기

## 12. 변환과 품질

adapter 변환은 source와 consumer schema 사이의 무제한 ETL이 아니다. 허용 변환을 versioned pipeline으로 등록한다.

- format 변환: 확장 가능한 마크업 언어(Extensible Markup Language, XML)→JSON, 쉼표로 구분된 값(Comma-Separated Values, CSV)→Parquet 등
- 필드 rename·code mapping
- row·column·spatial filter
- aggregation·masking·precision reduction
- CRS 변환

모든 변환은 input snapshot/version, transformation version, parameter, output checksum과 품질검사 결과를 provenance에 기록한다.

## 13. 오류 모델

| 오류 | 재시도 | Transfer 처리 |
| --- | --- | --- |
| 잘못된 consumer request | 없음 | 명확한 4xx, source 미호출 |
| source 인증 실패 | 자동 반복 금지 | secret 상태 확인, transfer suspend |
| source rate limit | `Retry-After`·정책 범위 | 제한 재시도 또는 suspend |
| 일시 timeout·5xx | exponential backoff+jitter | 복구 가능하면 `SUSPENDED`, 불가하면 error를 포함해 `TERMINATED` |
| schema incompatibility | 없음 | adapter quarantine, 신규 transfer 중지 |
| checksum mismatch | 제한된 전체 재전송 | 완료 처리 금지 |
| local Agreement 만료·철회 정책 event | 없음 | 신규 접근 deny, 활성 Transfer에 DSP Suspension·Termination 반영, Agreement·Transfer scope 자원 회수 |

Lifecycle Adapter 오류는 payload adapter 오류와 별도로 기록한다.

- subscription·entitlement 생성 실패 시 Control Plane은 Transfer Start를 보내지 않는다.
- 회수 API 실패 시 gateway는 해당 접근을 차단한다.
- Lifecycle Adapter는 retry queue와 reconciliation으로 외부 자원 정리를 재시도한다.
- 반복 실패는 운영자 경보와 수동 정리 증거로 남긴다.

## 14. Adapter 승인 기준

- source owner가 연계와 credential 사용을 승인했는가
- allowlist가 broad wildcard 없이 정의됐는가
- source·consumer 양쪽의 최대 크기·시간·호출량이 정해졌는가
- secret·URL·개인정보가 log에 남지 않는가
- idempotency와 reconciliation 시험이 있는가
- 계약 종료와 incident 시 회수 절차가 실행 가능한가
- source schema·version 변경을 탐지하는가
- 운영 연락처, SLO와 제공중단 runbook이 있는가
- Offering 수정·철회와 platform delete가 종단으로 연결되는가
- Agreement·Transfer와 external subscription·token·job ID를 감사에서 연결할 수 있는가
- callback 유실·중복·순서 뒤바뀜·Connector restart 뒤 reconciliation 시험이 있는가
