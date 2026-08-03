# 데이터 스페이스 개념·용어 감사

작성일: 2026-07-30  
작성 기준: 2026-07-30  
상태: Draft  
시점 스냅샷: 2026-07-30

## 1. 목적과 범위

- **(목적)** IDS-RAM, IDSA Rulebook, Observability Services와 GXDCH의 현행 상태·경위를 1차 출처로 대조하고 프로젝트 대표 표기 결정 기록
- **(범위)** 역할 모델, 거래 증적·감사 개념, GXDCH, DSSC Blueprint, 상위 계획의 미확인 용어와 국토교통 Compliance Validator
- **(제외)** 미확보 상위 계획 원문의 의미 확정, notary record 스키마, 운영 주체와 배치 결정
- **(판정 기준)** `Verified`, `Inferred`, `Unverified`, `Decision`을 구분하고 외부 사실에 URL과 확인일 병기
- **(산출물)** 경위형 용어 표 N-1, 지식 감사 4분면, baseline 점검 기록과 source register 후속 목록

이 문서의 용어 표는 동치 관계를 선언하지 않는다. 이름이 유사한 서비스를 목적·입력·출력·운영 주체의 경위로 구분한다.

## 2. 프로젝트 결정과 적용 경계

- **(Decision)** 스펙 소유자가 2026-07-30에 수식어 없는 `Clearing House`를 GXDCH의 온보딩 검증·notarization 의미로만 사용하는 표기 결정 승인
- **(Decision)** IDS의 거래 증적·감사 개념은 산문에서 `Observability Services`로 지칭
- **(예외)** 원문·표준·역사적 개념 인용에는 원래 명칭을 유지하고 `원문 인용:` 마커와 출처를 병기
- **(참조)** 프로젝트의 기존 명명 검토안은 [기획보고서 기술 검토](planning-report-technical-review.md) `T-24`를 근거로 참고
- **(참조 판정 근거: C2-02)** 대상 문서가 `Review` 상태이므로 정본으로 선택하거나 승격하지 않고 이 문서의 명명 결정에 대한 검토 근거로만 사용
- **(승격 경로)** 대표 표기의 등록·승격은 `report-style.config.json`의 `terminology`를 사용하며 metadata field crosswalk와 분리
- **(Decision)** N-2 역할 분리 골격은 D-01 record 스키마와 D-02 개봉 절차 반영으로 이월을 해제하고 5절에 등록

`T-24`는 IDS의 교환 증거·감사, GXDCH의 Gaia-X profile 검증·notarization과 국토교통 Compliance Validator의 국내 schema·rule 검증을 서로 다른 서비스로 명명한다.

원문 인용: `IDS Clearing House 또는 Observability는 교환 증거와 감사 역할, GXDCH는 선택한 Gaia-X Trust Framework profile의 validation·notarization 역할, 국토교통 Compliance Validator는 국내 profile의 schema·rule 검증 역할로 각각 명명한다. 각 서비스의 input, output, API, trust boundary, 보존정책과 운영주체를 분리한다.`

`T-24`의 검증 기준은 한 서비스의 성공 결과를 다른 서비스의 보안·법률 승인으로 재사용하지 않는 것이다.

## 3. 원전 검증

모든 URL의 확인일은 2026-07-30이다. 발표일·release일·문서 version일은 확인일과 구분한다.

### 3.1 IDS-RAM

| 검증 항목 | 확인 사실 | 1차 출처 |
| --- | --- | --- |
| 현행 상태 | `IDS-RAM 5.0` 최종본은 미발행이며 현행 표기는 `IDS-RAM 2026-1 working draft` | [IDSA RAM 지식베이스](https://kb.internationaldataspaces.org/external/ram/) |
| 예비 초안 | RAM 5 예비 초안과 피드백 요청을 2025-02-06 공개 | [IDSA 발표](https://internationaldataspaces.org/idsa-releases-preliminary-draft-of-ram-5/) |
| RAM 4 병존 | RAM 4는 안정판으로 병존하고 RAM 5는 증분 성장 중임. 발표일 2026-02-05 | [IDSA 문서 지형 설명](https://internationaldataspaces.org/ram-5-within-idsas-document-landscape/) |
| 구조 | Business·Functional·Process·Information·System 5계층을 유지하고 Security 관점을 Trust·Certification·Governance 관점으로 대체 | [IDSA 예비 초안 발표](https://internationaldataspaces.org/idsa-releases-preliminary-draft-of-ram-5/) |
| 기능과 pattern | data discovery, contract negotiation, policy enforcement, credentials & claims, data transfer, observability의 6대 기능과 centralized·federated·decentralized pattern 제시. 발표일 2026-01-29 | [IDSA RAM 5 방향](https://internationaldataspaces.org/ids-reference-architecture-model-5-whats-coming/) |

### 3.2 IDSA Rulebook

| 검증 항목 | 확인 사실 | 1차 출처 |
| --- | --- | --- |
| 계보 | White Paper 1.0은 2020-12 발행, 2.0은 2023년 초 계보에 있으나 정확한 발행일은 `Unverified`, 2026-03-27 재구조화 발표 뒤 Release 2026-1로 전환 | [White Paper 1.0](https://internationaldataspaces.org/wp-content/uploads/dlm_uploads/IDSA-White-Paper-IDSA-Rule-Book.pdf), [재구조화 발표](https://internationaldataspaces.org/a-new-chapter-for-the-idsa-rulebook/) |
| 현행 release | `IDSA Rulebook Release 2026-1(2026-05-05)` | [Release 2026-1 발표](https://internationaldataspaces.org/idsa-rulebook-2026-1-structural-clarifications-for-operational-data-spaces/), [공식 위치](https://kb.internationaldataspaces.org/external/rulebook/001_Introduction/) |
| 구조 특징 | 탈중앙 기본 가정, 지속적·맥락 의존 신뢰, 필수·권고 구분, AI agents 장과 ISO/IEC 20151 정합을 설명 | [Release 2026-1 발표](https://internationaldataspaces.org/idsa-rulebook-2026-1-structural-clarifications-for-operational-data-spaces/) |
| 역할 | Participant와 DSGA를 기술 역할로 두고 Commercial·Lookup·Observability를 선택적 Service Provider 범주로 제시 | [Roles](https://kb.internationaldataspaces.org/external/rulebook/005_Roles/) |
| 정책 | Prohibitions·Obligations·Permissions와 membership→access→contract→usage 계층을 설명하고 집행·검증의 일차 책임을 참여자에게 둠 | [Policies](https://kb.internationaldataspaces.org/external/rulebook/105_Policies/) |

### 3.3 거래 증적·감사 경위와 GXDCH

| 검증 항목 | 확인 사실 | 1차 출처 |
| --- | --- | --- |
| RAM 4 역할 | 역사적 IDS Clearing House 역할은 금융·데이터 교환 거래의 clearing·settlement, 양측 상세 로깅, 과금 지원·분쟁 해결·부인방지를 다룸. RAM 4 2022-04 | [RAM 4 §3.1.1](https://docs.internationaldataspaces.org/ids-knowledgebase/ids-ram-4/layers-of-the-reference-architecture-model/3-layers-of-the-reference-architecture-model/3-1-business-layer/3_1_1_roles_in_the_ids) |
| RAM 4 system layer | IDS Connector 기반 clearing·billing·usage control 로깅 서비스로 설명. RAM 4 2022-04 | [RAM 4 §3.5.5](https://docs.internationaldataspaces.org/ids-knowledgebase/ids-ram-4/layers-of-the-reference-architecture-model/3-layers-of-the-reference-architecture-model/3_5_0_system_layer/3_5_5_clearing_house) |
| 참조 구현 | Fraunhofer AISEC 프로토타입의 마지막 push는 2024-05-08이며 IDSA 포크는 archive 상태 | [Fraunhofer AISEC](https://github.com/Fraunhofer-AISEC/ids-clearing-house-service), [IDSA archive](https://github.com/International-Data-Spaces-Association/ids-clearing-house-service) |
| 현행 계승 | Release 2026-1은 audit·notary를 Observability Services 선택 범주로 일반화 | [Rulebook Roles](https://kb.internationaldataspaces.org/external/rulebook/005_Roles/) |
| GXDCH | Catena-X 운영 서비스 맵의 GXDCH는 법인 온보딩 검증·Self-Description 적합성 검증용 별개 신뢰 앵커 | [Catena-X 서비스 맵](https://catenax-ev.github.io/docs/operating-model/what-service-map) |
| DELS | GXFS Data Exchange Logging Service는 제공·수신 증거를 다루며 Gaia-X 적합성 필수 서비스가 아님 | [GXFS DELS](https://www.gxfs.eu/data-exchange-logging-service/) |
| 명칭 이관 | GXFS는 XFSC로 개명되어 Eclipse로 이관됨. 이관 발표 시점 2023-07 | [Eclipse XFSC 제안](https://projects.eclipse.org/proposals/eclipse-xfsc-cross-federation-services-components) |

### 3.4 DSSC Blueprint

| 검증 항목 | 확인 사실 | 1차 출처 |
| --- | --- | --- |
| 현행 version | v3.0을 2026-02 마드리드 Data Spaces Symposium에서 공개. 0.5 2023-09, 1.0 2024-03, 1.5 2024-09, 2.0 2025-03의 계보 | [DSSC Blueprint](https://blueprint.dssc.eu/) |
| 조직 빌딩블록 | Business 4개, Governance 2개, Legal 2개의 8개 조직 빌딩블록 | [DSSC Business pane](https://blueprint.dssc.eu/?pane=business) |
| 기술 빌딩블록 | Identity & Attestation Management부터 Value Creation Services까지 9개 기술 빌딩블록 | [DSSC Technical pane](https://blueprint.dssc.eu/?pane=technical) |

## 4. 용어 경위 표 N-1

표 N-1은 동치표가 아닌 시점 스냅샷이다. 상태는 `초안`, 기준일은 2026-07-30이다. 명명 정본은 `T-24`이며 상위 계획 원문을 확인하기 전에는 해당 표현을 확정 인용하지 않는다.

프로젝트 표기 결정과 대표 표기 승격 경로는 2절을 따른다.

| 용어 | 경위 | 현재 구분 | 상태 | 근거 |
| --- | --- | --- | --- | --- |
| IDS Clearing House | RAM 4의 거래 clearing·settlement와 증적·감사 역할 → 참조 구현 중단 → 현행 Observability Services로 일반화·계승 | 역사적 개념이며 프로젝트 산문에서는 Observability Services 사용 | Verified | 3.3절 RAM 4·참조 구현·Rulebook 원전 |
| Observability Services | Rulebook Release 2026-1의 audit·notary 선택 범주 | 거래 증적·감사 기능 범주 | Verified | 3.2절 Roles, 3.3절 현행 계승 |
| GXDCH | 이름이 유사하나 Catena-X에서 법인 온보딩·Self-Description 적합성 검증 수행 | 거래 증적·감사와 별개인 온보딩 신뢰 서비스 | Verified | 3.3절 Catena-X 서비스 맵 |
| 상위 계획 `세부 Clearing House` | 전언만 있고 원문 의도 미확인 | 원문 확보 전 기존 세 범주 어느 것에도 배정하지 않음 | Unverified | 원문 확보와 문맥 대조 필요 |
| 국토교통 Compliance Validator | `T-24`가 정의한 국내 profile의 schema·rule 검증 구성요소 | Observability Services와 GXDCH의 성공 결과를 대체하지 않음 | 프로젝트 정의 | 기획보고서 기술 검토 `T-24` |

N-2 역할 분리 골격은 5절에 등록했다. 배치 위치는 선택하지 않았으며 남은 민감도·주체별 열람 권한·보존·운영 주체 조건은 [ADR-0006 §6](../adr/0006-selective-notary-evidence.md#6-재검토-조건)과 [EDC 구성 설계 §5.1](../02-architecture/edc-caas-dsaas-architecture.md#51-notary-배치-선행-요건과-옵션-비교-축)에서 관리한다.

## 5. 역할 분리 골격 N-2

N-2는 역할과 증거 이동의 골격이며 배치안이나 운영 규범의 승인 문서가 아니다. [ADR-0006](../adr/0006-selective-notary-evidence.md)은 `Proposed` 상태다.

부분 충족 상태는 다음과 같다. 4요건 중 스키마를 충족했고 열람 절차를 정의했으나 주체별 권한은 미정이다. 민감도와 보존은 미확정이다.

| 역할 | 보유·입력 | 동작 | 산출물 | 비책임·미결정 |
| --- | --- | --- | --- | --- |
| 거래 당사자 Participant | 거래 원문·로컬 감사 로그·공통 감사 ID | 원문을 로컬에 보관하고 승인 범위의 감사 ID·증거를 제출 | 로컬 감사 export와 제출 receipt | 다른 당사자의 증거 판정 |
| Observability Services·notary 운영자 | 서명 hash·시각·공통 감사 ID | 존재 증명 record를 고정하고 감사 ID 조회 결과를 반환 | 저민감 후보 record와 조회 사건 | 당사자·자산·금액·법적 책임 판정; 운영 주체 미정 |
| 정산·감사 요청자 | 회원약정 사전 동의 또는 건별 법적·계약 근거 | 정기 범위는 자동 제출을 받고 범위 밖·감사·분쟁은 건별 승인 뒤 개봉 | 대사 결과와 별도 개봉 감사 ID | 주체별 열람 권한 미정 |
| DSGA 규칙 제정 기능 | 법적 근거·회원규칙·증적 범위·예외안 | 대상 거래와 증거 최소화 규칙을 승인하고 이의를 심의 | 규칙 version과 승인 기록 | 서비스 운영·개별 거래 대사; 법인 주체 미정 |

record에는 당사자·자산 식별정보를 넣지 않는다. 정산·감사 요청자는 당사자가 제시한 공통 감사 ID로 record 존재를 조회하고, 원문 개봉이 필요하면 승인된 절차를 별도로 수행한다.

| 경계 | 현재 값 | 남은 결정 | 실패 처리 |
| --- | --- | --- | --- |
| 스키마 | 서명 hash·시각·공통 감사 ID | 없음 — D-01 반영 | 그 밖의 필드 입력 거부 |
| 민감도 | 저민감 후보 | 필드별 등급과 개봉 결과 등급 | 확정 전 배치 미선택 |
| 열람 | 정기 정산 사전 동의·범위 밖 건별 근거 절차 | 거래 당사자·제3자·운영자별 권한 | 근거·승인 없으면 fail-closed |
| 보존 | 미확정 | 원 record·개봉·대사·backup의 기간과 파기 | 확정 전 배치 미선택 |

## 6. 지식 감사 4분면

| 분면 | 현재 지식 | 근거·처리 |
| --- | --- | --- |
| Verified | 현행 RAM·Rulebook 상태, Rulebook 역할·정책, RAM 4 역사 역할, 참조 구현 상태, Observability Services 계승, GXDCH 구분, DSSC v3.0 | 3절 URL과 확인일로 고정 |
| Inferred | 신규 외부 추론 없음 | 용어 동치나 운영 효과를 추정하지 않고 원전·프로젝트 결정을 분리 |
| Unverified | 상위 계획 `세부 Clearing House` 원문 의도, Rulebook 2.0 정확한 발행일, KAIA 위임 성격, 거래 유형별 증적 법적 근거 | 원문·위임 문서·법령 조문 확보 전 상태 유지 |
| Decision | 프로젝트 표기 결정, N-1 초안, N-2 역할 분리 골격과 이월 해제, 거버넌스 3분리와 공통 기반·분야 2계층 DSGA | 스펙 소유자 승인 2026-07-30·2026-08-01, ADR-0006·ADR-0007은 Proposed |

거버넌스 분리 원칙은 용어 동치표에 넣지 않는다. [ADR-0007](../adr/0007-governance-function-separation.md)과 [단일형·분야형 구성 연구](dataspace-topology-single-vs-sectoral.md)에서 권한 구조로 이월한다.

## 7. Baseline 점검 기록

| 점검 항목 | 확인 방법 | 2026-07-30 상태 | 후속 조치 |
| --- | --- | --- | --- |
| 대표 표기 registry | `report-style.config.json`의 `terminology` 확인 | RAM·Rulebook 매핑 2건 등록 | 전체 문체 Gate와 보완 검색 유지 |
| 명명 정본 | 기획보고서 기술 검토 `T-24` 대조 | IDS 증적·감사, GXDCH, 국토교통 Compliance Validator 구분 존재 | N-1의 구분 선례로 유지 |
| 상위 계획 원문 | 저장소·제공 자료 대조 | 원문 미확보, Unverified | 원문 확보 뒤 N-1 행 재검토 |
| source register | `evidence/source-register.yaml`에서 3절 URL 검색 | 신규 원전 URL의 source ID 미등록 | 7절 목록을 후속 register 입력으로 사용 |
| N-2 역할 분리 | notary record 요건 대조 | 역할 골격 작성·이월 해제; 스키마 충족, 열람 절차 정의·주체별 권한 미정, 민감도·보존 미확정 | ADR-0006 §6의 잔여 5조건 추적 |

최종 표기 회귀 건수와 링크 존재 검사는 실행 검증 기록에서 관리한다. 이 문서의 snapshot과 발행 Gate를 같은 기록으로 사용하지 않는다.

## 8. Source register 후속

다음 원전은 URL·확인일 검증을 마쳤으나 `evidence/source-register.yaml`의 source ID 등록은 후속 작업이다. 이 실행에서는 허용 파일 범위 밖이므로 register를 수정하지 않는다.

| source 묶음 | 등록 대상 | 현재 상태 |
| --- | --- | --- |
| RAM | 3.1절 지식베이스·발표 3건 | URL 확인, source ID 미등록 |
| Rulebook | 3.2절 White Paper·재구조화·Release·Roles·Policies | URL 확인, source ID 미등록 |
| Observability Services 경위 | 3.3절 RAM 4·GitHub·Catena-X·GXFS·Eclipse | URL 확인, source ID 미등록 |
| DSSC | 3.4절 Blueprint와 두 pane | URL 확인, source ID 미등록 |

상위 계획 원문은 확보 전 source register에 확정 제목·의도를 등록하지 않는다.
