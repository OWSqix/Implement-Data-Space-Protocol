# Platform Bridge PoC 후보 목록

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 검증 범위

- **(목적)** Platform Bridge가 기존 플랫폼의 Dataset을 DSP Offering으로 게시하고 계약 결과를 실제 접근으로 바꾸는지 검증
- **(범위)** Discovery Bridge와 Full Offering Bridge를 분리하고 후보별 권리·source·회수 가능성을 Gate로 판정
- **(제외)** 새 데이터 저장소 구축과 기존 공개 URL의 DSP 전용 경로 전환

완전한 PoC는 다음 흐름을 끝까지 실행해야 한다.

```text
기존 플랫폼 Dataset 등록·변경·삭제
  -> Bridge가 Dataset·Offer·Distribution·DataService로 변환
  -> 소비자가 DSP Catalog에서 조회
  -> Agreement 교환·검증과 Contract Negotiation FINALIZED
  -> Bridge가 source 접근권한 또는 전송자원 준비
  -> Transfer Process로 데이터 접근
  -> Transfer 완료·종료 시 token·ACL·snapshot 회수
  -> Agreement 만료·해지 시 장기 구독·entitlement 회수
```

Metadata를 한 번 수집해 Catalog에 표시하는 데서 끝나면 Discovery 실증이다. Platform Bridge 종단 실증과 구분해 결과를 기록한다.

## 2. 후보 선정 원칙

- **(선정 원칙)** Protocol 종류보다 책임 경계, 권리와 회수 절차의 시험 가능성을 우선
- **(담당)** Data steward가 source record를 판정하고 governance·법무 담당이 Provider 권한과 이용조건을 승인
- **(산출물)** 후보별 Dataset Passport와 `G0~G6` 판정 기록
- **(완료조건)** 다음 조건을 모두 충족한 후보만 Full Offering 대상으로 승인

| 항목 | 선정 조건 |
| --- | --- |
| Dataset 정체성 | source의 stable Dataset ID와 version 또는 수정시각이 있음 |
| Provider | 계약·제공 책임자와 장애 연락처가 확인됨 |
| 권리 | license, 재제공, proxy·cache 허용 여부가 문서로 확인됨 |
| Distribution | 실제 payload endpoint, format, media type과 schema가 있음 |
| 보안 | HTTPS, credential owner, secret 보관과 전송방법이 정해짐 |
| 운영 | quota, timeout, 갱신주기, 장애·변경 통지와 삭제 처리가 있음 |
| 수명주기 | 계약 후 접근 생성과 종료 후 회수 방법이 있음 |
| 시험 안전성 | 개인정보·제한 공간정보 없이 실패·재시도를 반복할 수 있음 |

원천 접근이 공개 URL이라도 DSP 경로에서는 Offer, Agreement와 Transfer의 관계를 시험한다. DSP 가입을 기존 공개 URL 이용의 선행조건으로 만들지는 않는다.

## 3. 단계 구분 판정

현재 통합 채널에서는 검색과 metadata 구조를 관찰했지만 payload hosting과 계약 중개 기능은 확인하지 못했다. 한 번에 Full Offering을 구현하려 하면 확인되지 않은 기능을 mock으로 채우고도 연계가 끝난 것처럼 보일 수 있다.

PoC를 다음 두 단계로 나눈다.

| 단계 | 대상 | 종료 기준 |
| --- | --- | --- |
| A. Discovery Bridge | 통합 채널의 공식 metadata export | 유형 분류, stable ID, provenance, 수정·삭제 동기화 |
| B. Full Offering Bridge | host 또는 broker가 확인된 데이터 한 건 | Catalog→Agreement→provision→Transfer→revoke 종단 통과 |

단계 A는 단계 B의 metadata 공급원이 될 수 있지만, 단계 A 통과만으로 DSP Offering이 성립하지 않는다.

## 4. 우선 후보

### 4.1 후보 1: 통합 채널이 직접 호스팅하거나 중개하는 공개 Dataset 한 건

**(목적)**  
사용자가 제시한 Mobilithek형 연결과 가장 가까운 후보이다. 통합 채널이 metadata만 색인하는 레코드가 아니라, payload를 직접 제공하거나 원천 구독을 실제로 관리하는 레코드를 찾는다.

**(Verified)**

- 검색과 대표 Dataset 상세 metadata 구조
- read API의 문서상 Dataset metadata field
- Open API 활용신청·자동승인 안내와 계정별 key 방식

근거: [국토교통 데이터 통합 채널 역할 평가](../01-research/molit-platform-capability-profile.md), [문서상 Open API 정의](../../evidence/authenticated-exploration/open-api-definition-matrix.md).

**(Unverified)**

- 통합 채널이 직접 보유하는 payload 목록
- 실제 Distribution과 지원되는 HTTPS data endpoint
- 원천기관을 대신할 계약·재제공 권한
- Agreement에 대응하는 구독·접근제어목록(Access Control List, ACL)·token 생성과 해지 interface
- 통합 채널과 원천 플랫폼이 별도 원천 가입 없이 접근시키는 identity binding 제공 여부

**(판정)**  
`desired-but-unidentified`. 가장 적합한 후보 유형이지만, 현재 근거에서 구체적인 Dataset을 지목할 수 없다. 운영기관이 host 또는 broker 대상 목록을 제공하기 전에는 구현 후보로 확정하지 않는다.

**(선정 Gate)**

1. 데이터 관리대장이나 운영기관 답변에서 host·broker 역할을 확인한다.
2. Provider 위임과 공개 license·재제공 범위를 확인한다.
3. 실제 endpoint와 생성·회수 수명주기를 sandbox에서 시험한다.
4. Dataset Passport를 승인한다.

### 4.2 후보 2: 통합 채널 분석 데이터셋 metadata `GET`

**(목적)**  
Discovery Bridge의 수집·정규화·변경추적을 검증한다. Full Offering의 payload가 아니라 Catalog 입력이다.

**(Verified)**

- `GET /api/openapi/dataset/getOpenApiDatasetList`라는 문서상 경로
- pagination과 response collection 구조
- 제목·설명·제공기관·접근권한·license·시간범위·landing page 관련 response field
- 신청 필요·자동승인과 계정별 API key 안내

**(Unverified)**

- 운영 hostname, 접근망, HTTPS와 실제 wire schema
- Stable Dataset ID
- bulk export, delta cursor, 삭제 tombstone과 schema 변경통지
- quota, 오류코드와 SLA

**(판정)**  
`design-ready / execution-blocked`. Mapping과 contract test fixture는 설계할 수 있다. 실제 API 호출은 운영기관이 지원 URL과 HTTPS를 확인하기 전까지 진행하지 않는다. 내부 `/api/search/*`를 대신 사용하지 않는다.

**(선정 Gate)**

1. 운영기관이 현재 지원되는 HTTPS endpoint를 제공한다.
2. 기관용 service account 또는 중앙 harvester에서 key 사용이 허용된다.
3. Stable ID와 수정·삭제 동기화 방법을 확인한다.
4. 합성 또는 공개 레코드의 wire response로 schema contract test를 통과한다.

### 4.3 후보 3: 지능형교통체계(Intelligent Transport Systems, ITS) 표준 노드·링크 파일 snapshot

**(목적)**  
기존 파일 배포 플랫폼을 DSP finite transfer로 감싸는 가장 단순한 Full Offering fallback이다. 통합 채널의 broker 기능을 증명하지는 않지만 Platform Bridge의 file path를 검증한다.

**(Verified)**

- 국가교통정보센터가 표준 노드·링크 파일을 배포한다는 공식 자료
- 국가 관리지침에 따른 version과 변경이력의 필요성

근거: [원천·권리 인벤토리](../01-research/source-and-rights-inventory.md)의 초기 실증 후보와 `SRC-MOLIT-006`, `SRC-STD-001`.

**(Unverified)**

- PoC에서 사용할 지역·version과 고정 source URL
- license와 Bridge의 cache·snapshot·재제공 허용 여부
- checksum, file size, update·delete 통지
- 자동 다운로드의 인증·quota 조건

**(판정)**  
`shortlisted / not-ready`. 위 증거를 확보하면 첫 Full Offering fallback으로 적합하다. 계약 후 snapshot manifest와 만료 URL을 생성하고, 종료 시 임시 snapshot과 token을 회수하는 흐름을 시험한다.

### 4.4 후보 4: 국토교통 통계누리 공개 통계표 REST

**(목적)**  
기존 REST data platform을 consumer-pull 방식으로 연결한다. Query allowlist, pagination, quota와 source credential 보호를 검증하기 좋다.

**(Verified)**

- 공개 통계의 REST/JSON·시계열 조회 방식
- 인증키, 신청·승인과 요청범위 제한이 있다는 공식 안내

근거: [현행 플랫폼 조사](../01-research/current-state-and-evidence.md)의 실제 제공 경로와 `SRC-MOLIT-005`.

**(Unverified)**

- 대상 통계표 ID와 schema version
- 기관 공용 또는 Bridge proxy용 credential 허용
- quota를 소비자별로 나누는 방법
- cache, 결과 재제공과 파생물 이용조건
- 운영 SLA와 변경통지

**(판정)**  
`shortlisted / not-ready`. 파일 후보 다음 순서로 둔다. Source API key를 소비자에게 전달하지 않고 Bridge가 허용된 query만 대리 호출하는 방식을 우선 검토한다.

### 4.5 후보 5: ITS 교통소통정보 REST

**(목적)**  
짧은 갱신주기, link ID, 속도·통행시간을 가진 실시간성 REST 연계를 검증한다.

**(Verified)**

- 국가교통정보센터의 인증키 기반 교통소통정보 API 제공
- link ID, 속도, 통행시간과 생성시각을 포함하는 제공형태

**(Unverified)**

- 운영 quota와 호출주기
- schema·표준 노드·링크 version 결합 규칙
- 중앙 proxy와 cache 허용
- 장애·지연 시 stale 표시와 SLA

**(판정)**  
`later-poc`. 실시간 연계는 quota, freshness와 회로차단까지 다뤄야 한다. File·일반 REST 흐름을 먼저 검증한 뒤 진행한다.

### 4.6 후보 6: VWorld 웹 피처 서비스(Web Feature Service, WFS)·웹 맵 서비스(Web Map Service, WMS) 공개 layer

**(목적)**  
OGC query를 DSP Agreement 범위로 제한하는 지리정보시스템(Geographic Information System, GIS) adapter를 검증한다.

**(Verified)**

- WMS/WFS 기반 layer·feature 접근
- layer, 경계상자(Bounding Box, BBOX), CRS와 traffic 조건을 다뤄야 한다는 공식 metadata 사례

근거: [현행 플랫폼 조사](../01-research/current-state-and-evidence.md)의 실제 제공 경로와 `SRC-MOLIT-007`.

**(Unverified)**

- 대상 layer의 license와 공개제한 여부
- 중앙 proxy·cache 허용
- 허용 CRS, BBOX, feature limit과 복잡한 filter 정책
- 원천 URL·credential 노출 방지 방식

**(판정)**  
`later-poc`. 권리와 공간정보 등급을 확인한 공개 layer만 사용한다. 첫 PoC에는 query와 보안 변수가 많아 후순위로 둔다.

## 5. 후보 비교

| 우선순위 | 후보 | 검증 범위 | 현재 준비도 | 결정 |
| ---: | --- | --- | --- | --- |
| 1 | 통합 채널 host·broker 공개 Dataset | Mobilithek형 종단 수명주기 | 대상 미식별 | 운영기관 증거 대기 |
| 2 | 분석 데이터셋 metadata `GET` | Discovery Bridge | 설계 가능, 실행 차단 | 지원 HTTPS 확인 후 실행 |
| 3 | ITS 표준 노드·링크 파일 | File Offering·finite transfer | 권리·source 계약 미확인 | Full Offering fallback 1 |
| 4 | 통계누리 공개 통계표 | REST Offering·proxy pull | 대상·proxy 조건 미확인 | Full Offering fallback 2 |
| 5 | ITS 교통소통정보 | 실시간 REST·freshness | quota·version 미확인 | 후속 실증 |
| 6 | VWorld 공개 WFS/WMS layer | OGC policy·query 제한 | layer·권리 미확인 | 후속 실증 |

우선순위 1의 데이터가 확인되지 않으면 3 또는 4로 Full Offering Bridge를 먼저 검증한다. 이 결과를 "통합 채널이 broker로 동작했다"고 기록하지 않는다. 그 경우 Bridge는 ITS나 통계누리 같은 원천 플랫폼에 붙은 것이다.

## 6. 현재 후보로 사용할 수 없는 항목

### 6.1 대표 공개 Dataset 상세 레코드 자체

상세 metadata 구조를 확인하는 fixture로는 사용할 수 있다. 대표 레코드의 `distributions`가 비어 있었고 payload를 읽지 않았으므로 DSP Offering 후보로는 사용할 수 없다.

### 6.2 통합검색 결과 전체

Dataset 이외의 기관·시스템·활용사례와 게시물이 섞일 수 있다. 유형 분류 전 일괄 변환은 금지한다.

### 6.3 공개·공유 저장소 route

HTTP 200만 확인했다. 저장소 기능, backend authorization과 데이터 접근이 확인되지 않았으므로 host 증거로 쓰지 않는다.

### 6.4 분석과제 등록 `POST`

분석과제와 연락·파일·Dataset 정보를 등록하는 mutation이다. Metadata 수집이나 Transfer provisioning endpoint로 사용하지 않는다. 별도 분석 실증이 승인되지 않는 한 호출하지 않는다.

### 6.5 교통카드 집계자료

제공 주체, 수신자, 목적과 제3자 재제공 조건을 먼저 확인해야 한다. 초기 PoC에서 제외한다.

### 6.6 공개제한 공간정보와 개인 단위 이동자료

보안심사, 개인정보·위치정보와 반출 통제가 필요하다. 공개 데이터 Bridge의 기술 검증에 사용할 이유가 없다. 합성 데이터로 통제 기능만 시험한다.

## 7. Gate

### 7.1 G0: 레코드 적격성

- 검색 항목이 Dataset인지 확인
- 통합 채널 record ID와 source Dataset ID 연결
- 기관·시스템·활용사례를 제외

실패 시 `catalog-only` 또는 `excluded`로 끝낸다.

### 7.2 G1: Provider와 권리

- 실제 Provider와 계약권한 확인
- 통합 채널이 대행하면 위임 범위·기간·책임 확인
- license, proxy, cache, 재제공과 파생물 조건 확인

실패 시 Offer를 만들지 않는다.

### 7.3 G2: Metadata 연계

- 지원되는 HTTPS API 또는 export 확보
- Stable ID, pagination, 수정·삭제, schema version 확인
- 내부 단일 페이지 애플리케이션(Single-Page Application, SPA) endpoint 의존 금지

실패 시 수동 조사자료로만 유지한다.

### 7.4 G3: Distribution과 source 계약

- 실제 endpoint, format, media type, schema 확인
- credential owner, quota, timeout과 SLA 확인
- source URL·secret을 public Catalog에서 제거

실패 시 DSP Dataset·Offer로 승격하지 않는다.

### 7.5 G4: DSP mapping

- Dataset에 최소 한 개의 Offer와 Distribution 존재
- Distribution이 Provider DataService를 참조
- Offer를 발행한 Provider, target Dataset, 정책과 source binding 일치
- Contract Negotiation 결과 Agreement와 Transfer의 format 일치

실패 시 등록을 거부한다.

### 7.6 G5: Provisioning과 회수

- Agreement scope 구독과 Transfer scope token·ACL·snapshot을 구분해 멱등 생성
- 재시도와 중복 callback에서 자원을 하나만 생성
- Transfer 정지·종료 후 해당 전송 접근 차단, Agreement 만료·해지 후 장기 접근 차단
- Transfer 하나가 끝나도 유효한 Agreement scope 구독은 유지
- 실패한 회수를 reconciliation이 찾아냄

실패 시 Full Offering PoC를 통과하지 못한다.

### 7.7 G6: 보안과 운영

- Secret·개인정보의 Catalog·log·trace 노출 없음
- DNS·TLS·hostname 검증과 HTTP downgrade 차단
- Source outage, timeout, quota와 schema drift 시험
- Agreement부터 source request·회수까지 audit 연결

Critical·high 보안 finding이나 회수 실패가 남으면 PoC를 종료하지 않는다.

## 8. 실행 순서

| 단계 | 담당 | 입력 | 산출물 | 수행 시점 | 완료조건 |
| --- | --- | --- | --- | --- | --- |
| 조사 패키지 | Research owner·운영기관 | 운영자료, source·권리 증거 | 후보 Passport와 evidence ID | 실증 코드 작성 전 | 후보별 `G0~G3` 판정 완료 |
| Discovery 실증 | Offering onboarding owner | 승인 metadata API·export | canonical record와 Catalog diff | metadata 계약 승인 뒤 | 수정·삭제·중복 시험 통과 |
| Full Offering 실증 | Connector·Bridge owner | 승인 후보, DSP target과 source contract | 종단 wire trace와 cleanup evidence | `G0~G4` 통과 뒤 | `G5~G6`와 회수시험 통과 |

### 8.1 조사 패키지

1. 통합 채널 운영기관에 host·broker 대상 목록과 metadata API 명세를 요청한다.
2. 후보 1을 찾으면 해당 Dataset의 관리대장, 위임과 lifecycle 자료를 받는다.
3. 동시에 후보 3·4의 원천기관에 license, proxy와 운영조건을 확인한다.
4. 후보별 Dataset Passport를 작성하고 증거 ID를 붙인다.

### 8.2 Discovery 실증

1. 승인된 분석 데이터셋 metadata API에서 baseline을 수집한다.
2. 검색 항목을 Dataset과 비-Dataset으로 분류한다.
3. Stable ID, provenance와 확인시각을 보존한다.
4. 수정·삭제·중복·순서 뒤바뀜 fixture로 동기화를 시험한다.
5. Distribution과 권리가 없는 항목이 DSP Catalog에 들어가지 않는지 확인한다.

### 8.3 Full Offering 실증

1. 후보 1이 준비되면 그 데이터로 시작한다. 준비되지 않으면 후보 3, 다음으로 후보 4를 사용한다.
2. 공개 Dataset 하나와 제공형태 하나만 먼저 등록한다.
3. Contract Negotiation `FINALIZED` 전에는 source를 호출하지 않는다.
4. Agreement를 교환·검증하고 각 DSP 메시지의 수신 확인(Acknowledgement, ACK) 뒤 negotiation `FINALIZED`를 확정한다.
5. 필수 필드를 갖춘 Transfer Request·Start를 교환하고 각 ACK 뒤 접근자원을 사용한다.
6. 동일 PID의 요청과 ACK 유실을 반복해 멱등성과 상태 복구를 확인한다.
7. 정지·종료 후 token·ACL·snapshot을 회수한다.
8. Source 장애와 DSP·source 상태 불일치를 주입해 복구를 확인한다.

## 9. 후보 확정 기록

**우선 후보 지정(2026-08-06, Decision — 잠정)**: 후보 3(§4.3 ITS 표준 노드·링크 파일 snapshot)을 우선 후보로 지정한다.
착수는 기존 공개 플랫폼 연계(확장 단계) 착수 결정과 G0~G6 통과를 조건으로 하며, 통과 전에는 아래 확정 기록을 채우지 않는다.

후보 하나를 확정할 때 다음 표를 채운다. URL이나 key 값 대신 승인된 reference와 secret 식별자만 기록한다.

| 필드 | 기록 값 |
| --- | --- |
| Candidate ID | `미정` |
| 통합 채널 record ID | `미정` |
| Source Dataset ID·version | `미정` |
| `platformRecordRole` | `hosted` / `brokered` / `index-only` / `unknown` |
| PoC 연결 대상 | `integration-channel` / `source-platform` |
| Provider·위임 증거 | `미정` |
| License·proxy·cache 증거 | `미정` |
| Metadata interface reference | `미정` |
| Distribution·DataService reference | `미정` |
| Provision·revoke interface reference | `미정` |
| Credential owner·secret reference | `미정` |
| Dataset Passport | `미정` |
| Gate 결과 | `G0`~`G6` |
| 결정자·결정일 | `미정` |

API key, cookie, token, 개인 연락처와 원시 제한 데이터는 이 문서와 시험 evidence에 넣지 않는다.
