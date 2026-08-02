# 기존 데이터 플랫폼을 데이터 스페이스에 연결하는 기본 개념

작성일: 2026-07-11  
상태: Draft

## 1. 목적과 적용 범위

- **(판정)** 기존 플랫폼의 데이터를 일괄 이관하지 않고 Connector와 Bridge를 배치해 설명·이용조건·계약·접근권한을 데이터 스페이스 절차에 연결
- **(범위)** 기존 플랫폼의 Dataset record, 권리정보, 전달 interface와 운영 상태를 DSP Offering 수명주기로 변환하는 구조
- **(제외)** 검색 record를 근거 없이 거래 가능한 Offering으로 전환하거나 Connector 운영을 데이터 제공권한으로 간주하는 설계
- **(검증)** Dataset별 `hosted·brokered·index-only·unknown` 판정과 계약 종료 후 외부 자원 제거 증거 확인

## 2. 파일 데이터 연계 예시

가상의 `서울권 일별 도로교통량 CSV`가 기존 교통 Data Hub에 있는 경우를 기준으로 연계 흐름을 설명한다.

기존 플랫폼이 관리하는 정보와 기능은 다음과 같다.

- Dataset ID와 설명
- 매일 생성되는 쉼표 구분값(Comma-Separated Values, CSV) 파일
- 공개 라이선스
- 다운로드 URL
- 파일 version과 생성시각
- 장애와 변경을 관리하는 담당부서

- **(원본 위치)** 데이터 스페이스 연결 뒤에도 CSV 원본은 기존 플랫폼에 유지
- **(추가 경로)** Bridge 검증부터 계약 종료 후 임시 자원 삭제까지의 경로를 추가

```text
기존 Data Hub의 Dataset
  -> Bridge가 metadata·권리·파일 경로를 검증
  -> Connector가 Dataset과 Offer를 Catalog에 게시
  -> Consumer가 Offer를 보고 계약
  -> Transfer를 요청
  -> Bridge가 해당 날짜의 snapshot과 단기 접근 URL을 준비
  -> Consumer가 파일을 받음
  -> 계약 종료 뒤 URL과 임시 snapshot을 삭제
```

- **(기존 경로)** 공개 다운로드 URL이 계속 유효하면 기존 경로 유지
- **(추가 목적)** 기관 간 계약, 감사 또는 별도 전달 방식이 필요한 소비자에게 데이터 스페이스 경로 제공

## 3. 구성요소와 책임 경계

### 3.1 기존 데이터 플랫폼

기존 데이터 플랫폼에는 Data Lake, Data Hub와 공공 데이터 포털이 포함된다. 지리정보시스템(Geographic Information System, GIS)과 API platform도 같은 범위로 본다.

데이터 원본·metadata·파일·API는 기존 플랫폼이 계속 관리한다. 이용신청과 구독도 기존 운영 주체의 책임으로 유지한다.

### 3.2 데이터 스페이스

여러 기관이 공통 신뢰와 계약 절차를 사용해 데이터를 찾고 이용하는 연합 환경이다. 모든 데이터를 한 중앙 저장소에 모은다는 뜻이 아니다.

### 3.3 Connector

데이터 스페이스 참가자를 대신해 다른 참가자의 Connector와 통신하는 소프트웨어다.

- 제공자 Connector: Offering 게시, 계약 응답, Transfer 준비
- 소비자 Connector: Catalog 조회, 계약 요청, Transfer 요청

한 기관이 직접 운영할 수도 있고 CaaS로 사용할 수도 있다. Connector를 운영한다는 사실만으로 다른 기관 데이터를 제공할 권한이 생기지는 않는다.

### 3.4 Dataspace Protocol

이 프로젝트가 기준으로 사용하는 DSP 2025-1은 다음 절차를 규정한다.

| 절차 | 하는 일 |
| --- | --- |
| Catalog | 어떤 Dataset과 Offer가 있는지 조회 |
| Contract Negotiation | Agreement를 교환·검증하고 메시지·ACK로 협상을 확정 |
| Transfer Process | 합의된 Dataset의 전달을 시작·정지·완료·종료 |

DSP는 다음 원천 interface의 조회 방법을 규정하지 않는다.

- 구조화 질의 언어(Structured Query Language, SQL)
- 객체 저장소(Amazon Simple Storage Service, S3) bucket
- REST parameter
- 웹 피처 서비스(Web Feature Service, WFS) layer
- Kafka topic

원천 조회는 Bridge와 Data Plane이 처리한다. 근거: `SRC-TECH-001`.

### 3.5 Offering

거래 대상으로 제시한 데이터 제품이다. 이 프로젝트에서는 다음을 함께 확인한다.

- Dataset: 무엇을 제공하는가
- Offer: 어떤 조건으로 제공하는가
- Distribution: 어떤 표현·format으로 제공하는가
- DataService: 어느 Provider Connector에서 계약·전송을 요청하는가
- private source binding: Connector가 실제 원천을 어디서 어떻게 읽는가

검색 설명만 있고 실제 Distribution과 DataService가 없으면 Offering이 아니다.

### 3.6 Platform-to-Dataspace Bridge

기존 플랫폼의 언어를 Connector의 언어로 바꾸는 계층이다.

| 기존 플랫폼 | Bridge 처리 | 데이터 스페이스 |
| --- | --- | --- |
| Dataset record | DCAT mapping·권리 검증 | Catalog Dataset |
| license·이용조건 | Offer·policy mapping | Contract Negotiation |
| API·file·stream | private source binding | Transfer 준비 |
| 이용신청·구독 | entitlement orchestration | Agreement·Transfer |
| token·ACL·snapshot | 생성·삭제·reconciliation | 접근과 종료 증거 |

### 3.7 Catalog Broker

여러 Provider Connector가 이미 게시한 Catalog를 한곳에서 검색하게 하는 구성요소다. Broker는 upstream Offering Provider의 Offering과 visibility를 보존한다.

Catalog Broker는 기존 포털 record를 자동으로 거래 가능한 Offering으로 바꾸지 않는다. 이 작업은 Platform Bridge와 Offering Provider가 맡는다.

## 4. 플랫폼 역할 분류

- **(판정 단위)** 국토교통 통합채널의 연결 방식은 플랫폼 전체가 아니라 Dataset과 delivery path별로 결정
- **(근거)** payload 보유, 전달 대행과 검색 기능의 범위에 따라 가능한 DSP 연결 방식이 달라짐

| 역할 | 플랫폼이 하는 일 | 가능한 연결 |
| --- | --- | --- |
| hosted | payload를 저장하고 전달 | 플랫폼 Connector·Bridge로 full Offering 가능 |
| brokered | 원 제공자와 소비자 사이의 구독·전달을 관리 | 권한이 있으면 계약·구독 Bridge 가능 |
| index-only | 설명과 원천 링크만 제공 | discovery-only 또는 원천기관 Connector 필요 |
| unknown | 공개 증거가 부족함 | 조사 전 Offer 생성 금지 |

같은 플랫폼에서도 Dataset과 delivery path에 따라 역할이 다를 수 있다.

## 5. 수명주기 분리

- **(판정)** Offering 게시, DSP 절차와 기존 플랫폼 권한의 상태를 별도로 관리
- **(검증)** Agreement 종료 뒤 platform token 삭제와 잔존 자원 reconciliation 결과 확인

### 5.1 Offering 게시

```text
발견 -> 증거 대기 -> 승인 -> 게시 -> 정지 -> 철회
```

### 5.2 DSP

```text
Catalog -> Contract Negotiation -> Agreement -> Transfer Process
```

### 5.3 기존 플랫폼

```text
신청 -> 승인 -> subscription·token 생성 -> 사용 -> 정지·삭제
```

DSP Agreement가 끝났다고 플랫폼 token이 저절로 사라지지는 않는다. Bridge가 삭제 명령을 실행하고 Reconciler가 남은 자원을 확인해야 한다.

## 6. Control Plane과 Data Plane 분리

Control Plane은 계약과 상태를 다룬다. Data Plane은 실제 bytes, records, files 또는 stream을 전달한다.

```text
Control Plane
  Catalog·Contract Negotiation·Transfer Process·policy

Data Plane
  REST gateway·file snapshot·object storage·OGC·stream·compute
```

Provider Connector의 DataService endpoint와 원천 API URL은 다르다. 원천 URL과 credential을 public Catalog에 넣지 않는다.

## 7. 전송 방식

| 방식 | 예 |
| --- | --- |
| Direct pull | 계약 후 플랫폼이 단기 URL·token 발급 |
| Gateway | 전문 API gateway가 원천 API를 대신 호출 |
| Snapshot | 요청 시 versioned file을 만들고 만료 URL 제공 |
| Provider push | 제공자가 소비자의 object storage로 전달 |
| Stream | 계약별 topic·consumer group·ACL 생성 |
| Compute-to-data | 원천 가까이에서 작업하고 결과만 전달 |

한 플랫폼에서 여러 방식을 함께 쓸 수 있다. Dataset Passport가 데이터셋별 선택과 권리·보안 근거를 기록한다.

## 8. 역할별 책임

| 질문 | 기록할 역할 |
| --- | --- |
| 누가 데이터를 보유하는가 | 원 데이터 보유기관 |
| 누가 설명·품질을 관리하는가 | Publisher·steward |
| Dataset·delivery path의 `hosted·brokered·index-only·unknown` 근거는 무엇인가 | 기존 플랫폼 운영자 |
| 누가 Offer와 Agreement의 제공자인가 | Offering Provider Participant |
| 누가 Connector를 운영하는가 | Connector·CaaS 운영자 |
| 누가 payload를 전달하고 token을 지우는가 | Data Delivery Operator |

한 기관이 여러 역할을 맡아도 역할 기록은 합치지 않는다. 장애와 권리 분쟁 시 책임 주체를 식별하기 위한 구분이다.

## 9. 국토교통 통합채널 잠정 판정

- **(판정)** 통합채널을 중앙 Provider 또는 Catalog Broker로 확정하지 않음
- **(다음 조치)** 운영기관 자료로 hosted·brokered Dataset을 확인하고, 해당 Dataset이 없으면 Discovery Bridge와 원천 플랫폼 Full Offering Bridge를 분리

현재까지 확인한 사실은 다음과 같다.

- metadata 검색과 원천 안내 기능은 확인했다.
- 일부 대표 record에는 원천 URL이 있고 Distribution이 비어 있었다.
- 분석센터 Open API의 화면 정의와 신청 절차를 확인했다.
- 전체 Dataset의 payload hosting, broker subscription과 DSP 계약 연동은 확인하지 못했다.

## 10. 역할·용어와 민감도 기준

### 10.1 역할 모델의 변화

- **(Verified)** IDSA Rulebook Release 2026-1의 기술 역할은 Participant와 데이터 스페이스 거버넌스 기관(Data Space Governance Authority, DSGA)이며 Data Provider·Consumer는 계약상 기능임
- **(Verified)** RAM 4 계열의 Broker·IDS Clearing House·App Store·Vocabulary Provider·Identity Provider 명칭은 현행 역할 목록에서 사용하지 않음
- **(Verified)** 선택적 Service Provider 기능은 Commercial·Lookup·Observability의 세 범주로 정리됨

근거: [IDSA Rulebook Release 2026-1 역할](https://kb.internationaldataspaces.org/external/rulebook/005_Roles/), 확인일 2026-07-30

| 현재 범주 | 책임 범위 | 이전 역할과의 관계 |
| --- | --- | --- |
| Participant | 데이터 스페이스 참가와 계약상 Provider·Consumer 기능 | Provider·Consumer를 고정된 기술 지위가 아닌 계약별 기능으로 처리 |
| DSGA | 참가·규칙·거버넌스 권한 | 규칙 제정 기능을 별도 역할로 식별 |
| Commercial Services | 마켓플레이스·매치메이킹 | Broker·App Store의 상업 기능을 선택 서비스로 일반화 |
| Lookup Services | 어휘·공유 정보 조회 | Vocabulary Provider와 정보 조회 기능을 선택 서비스로 일반화 |
| Observability Services | audit·notary | RAM 4의 거래 증적·감사 기능을 선택 서비스로 일반화 |

### 10.2 Observability Services 경위와 GXDCH 구분

- **(Verified)** RAM 4의 역사적 IDS Clearing House 역할은 금융·데이터 교환 거래의 clearing·settlement 중개와 양측 상세 로깅을 다룸. 과금 지원·분쟁 해결·부인방지가 포함됨
  - 근거: [IDS-RAM 4 §3.1.1](https://docs.internationaldataspaces.org/ids-knowledgebase/ids-ram-4/layers-of-the-reference-architecture-model/3-layers-of-the-reference-architecture-model/3-1-business-layer/3_1_1_roles_in_the_ids), RAM 4 2022-04, 확인일 2026-07-30
- **(Verified)** RAM 4의 system layer는 IDS Connector 기반의 clearing·billing·usage control 로깅 서비스로 설명함
  - 근거: [IDS-RAM 4 §3.5.5](https://docs.internationaldataspaces.org/ids-knowledgebase/ids-ram-4/layers-of-the-reference-architecture-model/3-layers-of-the-reference-architecture-model/3_5_0_system_layer/3_5_5_clearing_house), RAM 4 2022-04, 확인일 2026-07-30
- **(Verified)** Fraunhofer AISEC 참조 구현의 마지막 push는 2024-05-08이며 IDSA 포크는 archive 상태임
  - 근거: [Fraunhofer AISEC 구현](https://github.com/Fraunhofer-AISEC/ids-clearing-house-service), [IDSA archive](https://github.com/International-Data-Spaces-Association/ids-clearing-house-service), 확인일 2026-07-30
- **(Verified)** IDSA Rulebook Release 2026-1은 audit·notary 기능을 Observability Services로 일반화함
  - 근거: [IDSA Rulebook 역할](https://kb.internationaldataspaces.org/external/rulebook/005_Roles/), 확인일 2026-07-30
- **(Verified)** Gaia-X Digital Clearing House(GXDCH)는 법인 온보딩 검증과 Self-Description 적합성 검증을 위한 별개 신뢰 앵커임
  - 근거: [Catena-X 운영 서비스 맵](https://catenax-ev.github.io/docs/operating-model/what-service-map), 확인일 2026-07-30

이 프로젝트는 RAM 4의 거래 증적·감사 개념을 Observability Services로 지칭한다. GXDCH의 온보딩 검증·notarization 기능과 같은 서비스로 취급하지 않는다.

### 10.3 프로젝트 표기 규칙

| 대상 | 대표 표기 | 적용 규칙 |
| --- | --- | --- |
| 현행 RAM 초안 | `IDS-RAM 2026-1 working draft` | 최종본으로 표기하지 않음 |
| 현행 Rulebook | `IDSA Rulebook Release 2026-1(2026-05-05)` | 발표일을 정식 표기에 포함 |
| GXDCH 서비스 | `Gaia-X Digital Clearing House(GXDCH)` | 이후 `GXDCH` 사용 가능 |
| IDS 거래 증적·감사 개념 | `Observability Services` | RAM 4의 역사·원문·표준 인용만 이전 명칭 허용 |

- **(Decision)** 수식어 없는 `Clearing House`는 GXDCH가 뜻하는 온보딩 검증·notarization 서비스를 지칭할 때만 사용
- **(Decision)** IDS의 거래 증적·감사 개념은 산문에서 `Observability Services`로 지칭
- **(예외)** 원문·표준·역사적 개념 인용은 원래 명칭을 유지하고 인용 상태와 출처를 병기

현행 RAM 표기는 [IDSA RAM 지식베이스](https://kb.internationaldataspaces.org/external/ram/)에서 확인했다. 현행 Rulebook 표기는 [Release 2026-1 발표](https://internationaldataspaces.org/idsa-rulebook-2026-1-structural-clarifications-for-operational-data-spaces/)에서 확인했다. 확인일은 2026-07-30이다.

### 10.4 민감도 차등 원칙

IDSA Rulebook Release 2026-1은 정책 통제를 데이터 민감도에 따라 구분한다.

| 민감도 | Rulebook의 통제 방향 |
| --- | --- |
| 낮음 | 모니터링과 계약적 구제 |
| 중간 | 강건한 로깅, 분산 관측성과 주기적 자동 점검 |
| 높음 | confined compute와 필수 암호화 |

근거: [IDSA Rulebook Release 2026-1 정책](https://kb.internationaldataspaces.org/external/rulebook/105_Policies/), 확인일 2026-07-30

민감도 등급만으로 중앙 notary 기록 대상을 정하지 않는다. 제3자 지급, 보조금·감사 규정과 법적·계약적 근거는 [ADR-0006](adr/0006-selective-notary-evidence.md)의 판정 축으로 별도 확인한다.

## 11. 관련 문서

- 실제 해외 사례: [MDS–Mobilithek 참조 사례](01-research/mds-mobilithek-reference-case.md)
- 가능한 연결 방식: [기존 플랫폼 연계 패턴](01-research/existing-platform-integration-patterns.md)
- 현재 통합채널 판정: [국토교통 통합채널 역량 프로필](01-research/molit-platform-capability-profile.md)
- 전체 구조: [목표 아키텍처](02-architecture/target-architecture.md)
- 첫 실증: [PoC 후보 목록](03-plan/poc-candidate-shortlist.md)
