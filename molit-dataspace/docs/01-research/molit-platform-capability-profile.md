# 국토교통 데이터 통합 채널 역할 평가

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 평가 목적과 현재 판정

- **(목적)** 국토교통 데이터 통합채널의 Dataset·delivery path별 역할을 판정하고 DSP Offering 승격 가능 범위를 결정
- **(현재 판정)** metadata catalog와 검색 index 역할은 확인됐으나 payload `hosted`와 계약·구독 `brokered` 역할은 미확인
- **(제한)** 검색 레코드 복사만으로 DSP Data Offering을 만들 수 없으며 전체 레코드의 일괄 전환 금지

역할 판정에 사용하는 확인 항목은 다음과 같다.

1. 원문 payload 또는 실행 가능한 API의 직접 제공 여부
2. 원천기관을 대신한 계약 체결과 접근권한 발급 여부
3. 데이터 소재·설명만 제공하는 검색 index 여부

Dataset과 delivery path의 역할 값은 `hosted`, `brokered`, `index-only`, `unknown`이다. 같은 Dataset과 delivery path에는 한 값만 기록한다. 플랫폼 전체는 직접 제공하는 경로와 외부 기관 링크를 함께 운영할 수 있으므로 역할이 혼합될 수 있다.

## 2. 용어와 판정 기준

### 2.1 Hosted 역할

플랫폼이 데이터 payload를 직접 보유하거나, 플랫폼 운영자가 책임지는 API·파일·query service로 payload를 제공하는 역할이다.

다음 증거가 있어야 `hosted`로 판정한다.

- 운영기관이 지원하는 data endpoint 또는 export 경로
- 해당 endpoint에서 실제 payload를 읽을 수 있다는 계약시험
- 데이터의 운영 owner와 장애·품질 책임
- Dataset과 Distribution을 잇는 안정된 식별자
- format, schema, version, 갱신주기와 삭제 처리
- 이용권리와 재제공 범위

상세 화면에 `landingPage`나 외부 URL이 있다는 사실은 `hosted` 증거가 아니다. 메타데이터를 자체 데이터베이스(Database, DB)에 저장하는 것도 payload hosting과 구분한다.

### 2.2 Brokered 역할

플랫폼이 다른 기관이 보유한 데이터에 대해 이용계약 또는 구독을 중개하고, 그 결과를 실제 접근권한으로 반영하는 역할이다. DSP 연계에서 필요한 것은 소개 페이지가 아니라 다음 수명주기다.

```text
Contract Agreement·Verification·`FINALIZED` Event와 각 ACK 완료
  -> 원천 플랫폼 구독 또는 접근권한 생성
  -> Transfer에 사용할 endpoint·token·snapshot 준비
  -> Transfer 완료·종료 시 token·임시 자원 회수
  -> Agreement 만료·해지 시 장기 구독·접근권한 회수
```

다음 증거가 있어야 `brokered`로 판정한다. 수신 확인(Acknowledgement, ACK)은 DSP 상태 전이의 완료 조건으로 구분한다.

- 원천기관이 부여한 계약·제공 대행 권한
- 신청, 승인, 구독, 정지, 해지 상태와 API 또는 운영 절차
- 플랫폼 계약 ID와 원천 구독 ID의 대응관계
- 권한 발급·회수의 멱등성, 감사기록과 장애 복구 절차
- 소비자가 원천 플랫폼에 별도 가입해야 하는지에 대한 identity 정책
- 계약 종료 후 접근 차단을 검증한 결과

검색 결과를 모으거나 원천 사이트로 링크하는 기능만으로는 `brokered`로 판정하지 않는다.

### 2.3 Index-only 역할

플랫폼이 소재, 설명, 분류, 제공기관과 원천 landing page를 검색하게 하지만 payload 전달이나 계약 대행은 하지 않는 역할이다. 판정 범위는 해당 Dataset과 delivery path의 payload 제공 관계로 제한한다.

DSP에서는 이런 레코드를 포털·DCAT discovery에 남길 수 있다. 그러나 유효한 Offer, Distribution과 DataService가 없으므로 전송 가능한 DSP Catalog Dataset으로 게시하지 않는다.

### 2.4 Unknown 역할

증거가 부족해 세 역할 중 하나를 확정할 수 없는 상태다. `unknown`은 검색만 한다는 사실이 확인된 `index-only`와 다르다. 역할이 확정될 때까지 Full Offering을 만들지 않는다.

## 3. 조사 범위와 증거 등급

- **(관찰일)** 2026-07-11
- **(관찰 방식)** 사용자가 직접 로그인한 일반 회원 세션을 Playwright로 읽기 전용 탐색
- **(확인 대상)** 메뉴, 상세 metadata 구조, 화면에 게시된 Open API 정의와 정상 사용자 인터페이스(User Interface, UI)의 내부 endpoint 구조
- **(제외 행위)** API 신청, key 발급, 다운로드, 외부 원천 이동과 데이터 변경

| 등급 | 이 평가에서 뜻하는 것 |
| --- | --- |
| `Verified` | 공식 자료 또는 저장된 관찰 기록으로 직접 확인 |
| `Inferred` | 확인된 사실에 근거한 아키텍처 판단 |
| `Unverified` | 운영기관 답변이나 실행시험이 없어서 판정 보류 |

인증 탐색의 범위와 제외 행위는 [로그인 후 읽기 전용 탐색 근거](../../evidence/authenticated-exploration/README.md)에 기록돼 있다. 원시 응답, cookie, 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 보호값, API key와 개인정보는 저장하지 않았다.

## 4. 관찰된 기능

### 4.1 검색과 metadata

- `Verified` 데이터셋 검색 route와 대표 공개 Dataset 상세 route가 로그인 세션에서 렌더링됐다. 대표 상세에서는 metadata field의 이름과 자료형 구조를 확인했다. 근거: [메뉴·Route 관찰 매트릭스](../../evidence/authenticated-exploration/menu-and-route-matrix.md), [Metadata Field 관찰 매트릭스](../../evidence/authenticated-exploration/metadata-field-matrix.md).
- `Verified` 대표 상세 구조에서 `identifier`·`title`·`description`과 `publisher` 확인
- `Verified` `license`·`landingPage`·공간·시간 field와 `distributions` 배열 확인
- `Verified` 대표 레코드의 `distributions` 배열에는 항목이 없었다. 한 건의 결과이므로 다른 레코드에도 Distribution이 없다고 일반화하지 않는다.
- `Verified` 검색 결과에는 데이터셋 외에 기관·시스템, 활용·통계 데이터와 게시물 같은 다른 유형도 섞일 수 있다. 근거: [현행 플랫폼 조사](current-state-and-evidence.md).
- `Verified` 일부 상세 레코드는 원천 URL을 제시하고 외부 시스템으로 이동시킨다. 통합 채널이 원문 파일을 보유한다는 증거는 아니다.

이 관찰은 metadata catalog 역할을 뒷받침한다. Stable source ID, 실제 Distribution, 원천 변경·삭제 feed와 제공권한은 별도로 확인해야 한다.

### 4.2 문서상 Open API

로그인 화면에는 다음 세 API가 게시돼 있었다.

| API | 문서상 역할 | 관찰 상태 | 이 평가에서의 용도 |
| --- | --- | --- | --- |
| 통합검색 `GET` | 검색 결과 조회 | 정의만 확인, 미호출 | metadata 수집 후보 |
| 분석 데이터셋 `GET` | 분석 데이터셋 metadata 조회 | 정의만 확인, 미호출 | metadata 수집 후보 |
| 분석과제 등록 `POST` | 분석과제 등록 | 정의만 확인, 미호출 | Catalog 수집에 사용하지 않음 |

두 read API는 신청 필요·자동승인으로 안내됐다. 계정당 API key 한 개를 사용하는 것으로 표시됐으며, 조사 계정에는 발급 key와 호출 log가 없었다. 자세한 field와 신청 조건은 [문서상 Open API 정의](../../evidence/authenticated-exploration/open-api-definition-matrix.md)에 기록돼 있다.

- **(관찰)** 문서상 base URL은 HTTP이며 조사 시점에 해당 host의 사용 가능한 IPv4 주소 레코드(Address record, A record)를 얻지 못함
- **(미확인)** HTTP·HTTPS response와 실제 wire schema
- **(해석 제한)** 관찰 결과는 API 폐지나 HTTPS 미지원의 증거가 아님
- **(Gate)** 운영 hostname·접근망·HTTPS 지원 확인 전 key 발급과 요청 제외
- **(근거)** [문서상 Open API Endpoint 도달성](../../evidence/authenticated-exploration/public-endpoint-reachability.md)

### 4.3 내부 단일 페이지 애플리케이션(Single-Page Application, SPA) Endpoint

정상 화면은 `/api/search/init`, `/api/search/detail/{recordId}`, Open API 신청 목록과 정보 조회 endpoint를 호출했다. 이 경로는 화면 구현을 위한 내부 API다. 운영기관이 지원하는 server-to-server 계약, 고정 schema 또는 대량 수집 SLA로 간주하지 않는다. 관찰 범위는 [network-endpoints.csv](../../evidence/authenticated-exploration/network-endpoints.csv)에 정리돼 있다.

### 4.4 권한과 저장소 추정 route

- `Verified` `/pubstorge/openapi` route는 로그인 세션에서 HTTP 200을 반환했다.
- `Unverified` 이 결과가 실제 저장소 기능, 데이터 접근권한 또는 API 제공기능을 뜻하는지는 확인하지 않았다. Public shell이나 SPA fallback일 수 있다.
- `Unverified` 기관회원과 일반회원의 차이, Dataset별 다운로드·API·재제공 권한, key 발급 후 상태 흐름은 확인하지 않았다.

권한 관찰의 해석 한계는 [권한 관찰 매트릭스](../../evidence/authenticated-exploration/permission-matrix.md)를 따른다.

## 5. 역할별 판정

### 5.1 역할별 증거 판정

| 평가축 | 현재 판정 | 근거 | 남은 확인 |
| --- | --- | --- | --- |
| Metadata 저장·검색 | `Verified` | 검색, 상세 metadata 구조, read API 정의 | 공식 export의 운영 계약과 변경주기 |
| 일부 레코드의 `index-only` 역할 | `Verified` | 여러 유형·기관의 검색 레코드와 원천 URL | Dataset별 외부 이동 비율과 분류 정확도 |
| Payload `hosted` | `Unverified` | 분석 Dataset·저장소를 암시하는 명칭은 있으나 payload 미조회 | 실제 파일·API, owner, SLA, Distribution |
| 계약·구독 `brokered` | `Unverified` | 활용신청 화면은 있으나 source 구독·권한 연동 미시험 | 위임권한, provisioning·termination API |
| DSP Provider | `Unverified` | DSP endpoint·Offer·negotiation·transfer 증거 없음 | Connector와 Provider 권한 |

### 5.2 확인 가능한 역할

통합 채널은 다음 범위에서 index·metadata catalog로 평가할 수 있다.

1. 여러 기관과 시스템의 항목을 검색한다.
2. 상세 레코드에 제공기관, 설명, license 후보, 시간·공간 field와 원천 URL을 담을 수 있다.
3. 화면에는 검색·분석 데이터셋 metadata를 읽는 Open API가 문서화돼 있다.

이 기능은 Data Space discovery를 보강하는 데 쓸 수 있다. 다만 Open API의 운영 경로가 확인되지 않았으므로 현재 바로 실행 가능한 harvester가 있다는 뜻은 아니다.

### 5.3 근거 없이 사용할 수 없는 판정

다음 문장은 현재 증거로 쓸 수 없다.

- "통합 채널이 검색되는 모든 데이터를 보유한다."
- "통합 채널이 원천기관을 대신해 DSP Agreement를 체결할 수 있다."
- "Open API 활용신청이 DSP Contract Negotiation과 같은 계약이다."
- "분석 데이터셋 조회 API가 payload 전송 API다."
- "`/pubstorge/openapi`가 외부 연계 가능한 Data Lake endpoint다."
- "상세 레코드의 license 문자열만으로 중앙 proxy와 재제공이 허용된다."

`Inferred` 현재 구조는 검색 index가 중심이고, 일부 delivery path가 `hosted` 또는 `brokered`일 가능성이 남아 있는 혼합형 플랫폼이다. 가능성을 확인된 기능으로 기록하지 않는다.

## 6. 데이터셋별 분류 절차

레코드 하나를 다음 순서로 확인한다.

```text
1. 이 레코드는 Dataset인가?
   아니오 -> 검색·참고 콘텐츠로 유지, DSP Offering 제외
   예
    |
2. 실제 payload endpoint와 Distribution이 있는가?
   아니오 -> 검색 전용임이 확인되면 index-only, 증거가 부족하면 unknown
   예
    |
3. endpoint의 운영 주체가 통합 채널인가?
   예 -> hosting 운영 증거를 확인해 hosted, 부족하면 unknown
   아니오
     |
4. 통합 채널이 이용계약과 접근권한을 대신 관리하는가?
   아니오 -> 검색 전용임이 확인되면 index-only, 부족하면 unknown
   예
     |
5. 위임권한과 생성·정지·해지 수명주기를 시험했는가?
   아니오 -> unknown 유지, Offer 생성 금지
   예 -> brokered 후보를 DSP 종단시험으로 검증
```

각 레코드의 결과는 [원천·권리 인벤토리](source-and-rights-inventory.md)와 Dataset Passport에 남긴다. `hosted`, `brokered`, `index-only`, `unknown`은 같은 Dataset과 delivery path에서는 상호 배타적이다. 통합 채널 전체는 한 경로를 색인하고 다른 경로를 직접 호스팅할 수 있으므로 혼합형일 수 있다.

## 7. Platform Bridge에 미치는 영향

### 7.1 Discovery Bridge

현재 증거로 먼저 설계할 수 있는 범위다.

```text
통합 채널의 승인된 metadata export
  -> 레코드 유형 분류
  -> canonical metadata와 provenance 기록
  -> 포털·DCAT discovery 게시
```

공식 export가 없거나 권리가 확인되지 않은 레코드는 여기서 멈춘다. 내부 SPA endpoint를 운영 harvester로 사용하지 않는다.

### 7.2 Full Offering Bridge

Mobilithek형 연결에 해당하는 범위다. 다음 southbound 기능이 확인돼야 한다.

| 기능 | 필요한 동작 |
| --- | --- |
| Catalog sync | Dataset·Distribution의 등록, 변경, 삭제를 식별 |
| Eligibility | 공개범위, license, 제공권한과 Provider 위임 확인 |
| Provisioning | DSP Agreement를 원천 구독·ACL·token·export job으로 변환 |
| Delivery | 플랫폼 API, file, object URL 또는 stream을 Data Plane에 연결 |
| Revocation | 정지·만료·종료 시 접근권한과 임시 자원 회수 |
| Reconciliation | DSP 상태와 원천 상태 불일치를 찾아 복구 |
| Audit | Agreement, Transfer, source request와 회수를 같은 상관관계로 조회 |

현재는 이 표의 기능이 통합 채널에 있다는 증거가 없다. 운영기관이 직접 제공하지 못하면 Bridge가 source platform API를 호출해 이 기능을 구현해야 한다. 그 경우 계약 Provider는 통합 채널이 아니라 원천기관이거나 명시적으로 위임받은 대행자다.

## 8. 다음 조사에서 받아야 할 증거

### 8.1 통합 채널 운영기관

| 질문 | 받아야 할 자료 | 판정에 미치는 영향 |
| --- | --- | --- |
| 통합 채널이 직접 보유하는 Dataset 목록은 무엇인가 | 데이터 관리대장, source system ID, 운영 owner | payload `hosted` 판정 |
| 외부 기관 데이터 중 통합 채널이 중개하는 범위는 무엇인가 | 위탁·위임 문서, 이용약관, 책임분장 | `brokered` 판정 |
| 현재 지원되는 metadata API는 무엇인가 | HTTPS 운영·시험 URL, schema, pagination, quota | Discovery Bridge 실행 |
| Stable ID와 변경·삭제를 어떻게 제공하는가 | ID 규칙, delta cursor, tombstone, 변경통지 | Catalog 동기화 |
| Dataset별 Distribution은 어디에서 확인하는가 | endpoint, format, schema, checksum·version | DSP Offering 승격 |
| 승인·구독을 API로 관리할 수 있는가 | 상태모델, 신청·승인·해지 API, idempotency 규칙 | Agreement 연동 |
| 통합 채널 회원과 원천 서비스 계정은 어떤 관계인가 | 통합 인증(Single Sign-On, SSO)·federation·service account 정책 | 별도 가입 없는 접근 가능성 |
| 계약 종료 시 무엇을 회수하는가 | token·접근제어목록(Access Control List, ACL)·snapshot 삭제 절차와 감사자료 | Termination 검증 |

세부 질문 ID와 제출 형식은 [운영기관 확인 질문](operator-questionnaire.md)을 사용한다.

### 8.2 실행시험

운영기관의 승인 자료를 받은 뒤 다음 순서로 시험한다.

1. 승인된 배포환경에서 DNS, 인증서 이름, TLS version과 HTTPS 강제를 확인한다.
2. 합성 또는 공개 레코드로 pagination, stable ID, 수정과 삭제를 확인한다.
3. Dataset 하나의 metadata ID와 실제 Distribution을 연결한다.
4. 소비자 자격에 따라 신청·승인·거절이 구분되는지 확인한다.
5. Contract Negotiation의 `FINALIZED` ACK 후 source 접근권한을 한 번만 생성한다.
6. 정지·종료 후 신규 접근과 기존 token을 모두 거부한다.
7. DSP 상태와 원천 상태를 고의로 어긋나게 한 뒤 reconciliation을 시험한다.

실제 개인정보, 제한 공간정보, 운영 secret은 이 단계의 fixture로 사용하지 않는다.

## 9. 판정 변경 조건

### 9.1 역할 판정

역할 값은 같은 Dataset과 delivery path에서 한 번에 하나만 유효하다.

| 현재 역할 | 변경 역할 | 필요한 최소 증거 |
| --- | --- | --- |
| `unknown` | `index-only` | payload 전달과 계약 대행을 하지 않는다는 운영 범위 확인 |
| `unknown` 또는 `index-only` | `hosted` | 운영 endpoint, payload 계약시험, owner·SLA, Distribution |
| `unknown` 또는 `index-only` | `brokered` | 위임권한, subscription lifecycle, 발급·회수 시험 |

### 9.2 연계 준비도

| 현재 상태 | 변경 상태 | 필요한 최소 증거 |
| --- | --- | --- |
| `unverified` | `catalog-source-verified` | 지원되는 HTTPS metadata API, stable ID, schema·quota |
| `catalog-source-verified` | `offering-eligible` | Provider, license, Distribution, DataService와 source binding |
| `offering-eligible` | `poc-ready` | 합성·공개 데이터 종단시험과 보안·운영 Gate 통과 |

판정은 화면 명칭이나 HTTP 200으로 올리지 않는다. 운영 책임, 권리와 실행 가능한 interface가 함께 확인돼야 한다.
