# 제출 이행 판정 체계

작성일: 2026-08-03  
작성 기준: 2026-08-03  
관련 결정: `E-12`, `E-15`, `E-16`, `E-19`, `E-20`, `E-21`  
관련 미결: `DRV-01`~`DRV-04`, `T-06`  
상태: Draft — 판정 요건·선택지 제안, 상태값·schema·API·판정 주체 미확정

## 1. 목적과 범위

이 문서는 제출 이행의 세 조건을 판정 가능하고 사후 증명 가능하게 만들기 위한 요건과 선택지를 정의한다.

- **(Decision — E-20)** 제출 이행은 **계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료**의 세 조건이 모두 충족된 때 성립한다
- **(Verified — T-06)** 세 조건을 판정하고 사후 증명할 상태 표현과 조건별 감사 기록은 현재 아키텍처에 없다.
  - **(근거)** [EDC 기반 CaaS·DSaaS 구성 설계 §6.2](edc-caas-dsaas-architecture.md#62-제출-이행-상태와-감사-공백)
- **(목적)** 세 조건별 판정 입력, 증거, 전이 의미와 사후 증명 요건의 정의
- **(포함 범위)** 계약 상태 재사용 범위, 수신 가능 시점의 선택지, 참가자 수준 종단시험, 판정 주체 비교, 감사 기록과 미완료 처리
- **(제외 범위)** 상태값 이름, schema, API, 저장소 코드, 판정 주체, 완료율 분모·임계값과 법률문안의 최종 확정

정산은 법정 제출이다. 이 문서는 이를 적용 전제로 삼는다.
따라서 이행 성립 시점은 감사·환수·분쟁에서 다툼의 대상이 된다.
세 조건의 시점과 근거를 제시하지 못하면 `E-20`은 문장으로만 남는다.

- **(근거)** 제출성립 시점을 규칙 또는 운영·정산지침에 명시할 필요는 [의무화·간주 규정 선례 조사 §6.2](../01-research/mandate-and-deeming-precedents.md#62-협약의-한계)의 `Inferred` 판정을 따른다.
  - **(확인 범위)** 조사에 사용한 외부 원문 확인일은 2026-08-02다.
- **(Verified·Unverified)** 적용 법적 근거의 공개 원문 확인 상태는 도시·제도별로 다르다.
  - **(근거)** [의무화·간주 규정 선례 조사 §5](../01-research/mandate-and-deeming-precedents.md#5-6개-도시-조례-판정), 외부 원문 확인일 2026-08-02
  - **(근거)** 준공영·재정지원 운수사의 정산자료 경로와 지역별 한계는 [교통·물류 데이터 스페이스 참가자 지도 §4.1](../01-research/transport-participant-map.md#41-버스와-철도-경로)에 기록돼 있다. 외부 원문 확인일은 2026-08-02다.

### 1.1 판정 단위와 아키텍처 경계

판정 단위에는 참가자, 계약별 Provider·Consumer 기능 수행 주체, Dataset·Offering·원천 경로, 제출 의무와 대상 기간을 함께 결속할 필요가 있다.
기관 전체나 데이터셋 이름만으로는 어느 계약과 제출 의무의 이행인지 판정할 수 없다.

- **(Decision)** 원천 플랫폼을 system of record로 유지한다.
  - **(근거)** [ADR-0002](../adr/0002-data-stays-at-source.md)
- **(Decision)** 데이터 스페이스 운영자와 공통 서비스는 신원·카탈로그·계약·정책·감사를 담당하며 payload를 보관하거나 중계하지 않는다.
  - **(근거)** [EDC 기반 CaaS·DSaaS 구성 설계 §6](edc-caas-dsaas-architecture.md#6-offering-게시와-전송)
- **(Decision — E-21)** payload 전송은 **Provider Data Plane 경유로 단일화**한다. 원천 직접 방식(Consumer가 원천 token·signed URL로 원천에 직접 접근)은 채택하지 않는다
  - **(경계)** 실제 바이트는 원천에서 계약별 Provider 기능 수행 주체의 Data Plane을 경유해 Consumer로 이동한다.
  - **(구현 경계)** Provider Data Plane은 source binding을 소비해 원천 요청과 Consumer 응답을 프록시한다. Provider transfer worker와 DSP endpoint는 이 기능을 맡지 않는다.
- **(판정 원칙)** 같은 실행 증거를 둘 이상의 조건이 참조할 수 있으나 조건별 판정은 분리한다.
  - **(실패 조건)** 어느 한 조건의 증거가 다른 조건의 충족을 대신하지 않는다.

## 2. 조건 1 — 계약 체결

### 2.1 기존 기계 상태와 추가 요건

데이터 스페이스 프로토콜(Dataspace Protocol, DSP) 계약 협상에는 성공한 협상의 기계 판독 상태와 결과 Agreement가 이미 있다.
새 계약 수명주기 상태를 추가하기보다 기존 상태를 `E-20` 판정에 결속하는 요건이 필요하다.

| 판정 요소 | 기존 기계 판독 범위 | 새로 필요한 범위 | 상태·근거 |
| --- | --- | --- | --- |
| 협상 진행 | 양측 PID와 `REQUESTED·OFFERED·ACCEPTED·AGREED·VERIFIED·FINALIZED·TERMINATED` | 없음 | `Verified` — [DSP 2025-1 errata](https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/), 확인일 2026-08-03 |
| 성공 종결 | Agreement Message·검증·최종 사건의 ACK 뒤 `FINALIZED` | `E-20`의 계약 체결 조건과 연결하는 승인 규칙 | `Verified`·`Decision` 제안 — [검증 계획 §5](../03-plan/verification-plan.md#5-dsp-상호운용) |
| 결과 Agreement | Agreement ID, 대상 Dataset, assigner, assignee와 정책 | 법률문서·rulebook·데이터 계약의 식별자·version·효력기간 결속 | `Verified`·`Unverified` — DSP 2025-1 errata, 확인일 2026-08-03 |
| EDC 조회 | 협상 `FINALIZED`, Contract Agreement ID와 후속 Transfer ID | 운영환경·이기종 구현·법적 효력 증거 | 로컬 동일 구현 범위 `Verified` — [EDC 로컬 상호운용 §1](../04-implementation/edc-local-interoperability.md#1-목적과-검증-범위) |
| 제출 판정 | 해당 없음 | 세 조건을 같은 판정 단위와 시점에 결속한 판정 기록 | `Unverified` — `T-06` |

이클립스 데이터 스페이스 컴포넌트(Eclipse Dataspace Components, EDC) 로컬 시험은 0.18.0 동일 구현 사이에서 수행됐다.
운영환경, 서로 다른 구현 간 상호운용, 법률상 계약 체결을 검증한 증거로 확대할 수 없다.
[EDC 0.18.0 공식 태그](https://github.com/eclipse-edc/Connector/releases/tag/v0.18.0)의 확인일은 2026-08-03이다.

- **(Decision — 제안, 승인 전 미확정)** 계약 체결의 DSP 기계 증거는 `FINALIZED`와 결과 Agreement ID의 존재로 판정하는 안을 제안한다.
  - **(결속 요건)** Provider·Consumer PID, Agreement ID, 대상 Dataset과 적용 정책이 같은 협상 결과를 가리켜야 한다.
  - **(제외)** `AGREED`와 `VERIFIED`는 기존 수명주기의 중간 상태이므로 단독 판정 후보에서 제외한다.
  - **(한계)** 이 제안은 승인 전 확정이 아니며 `OPEN-SFD-01`에서 결정이 필요하다.
- **(Decision — 원칙 제안, 승인 전 미확정)** DSP 기계 Agreement는 상위 법률·계약 근거를 대체하지 않는다는 원칙을 적용한다.
  - **(근거)** [거버넌스·운영 원칙 §8](../02-design/governance-and-operating-principles.md#8-계약제재offboarding-원칙)
- **(Decision — 결속 요건 제안, 승인 전 미확정)** 기계 Agreement가 법률상 계약의 집행 표현이면 상위 문서의 당사자, version, 효력기간과 승인 근거를 연결한다.
  - **(실패 조건)** 상위 문서가 별도인데 Agreement와의 결속 근거가 없으면 계약 체결 조건은 판정 불가다.
  - **(한계)** 원칙과 결속 요건은 `OPEN-SFD-01` 승인 전 확정이 아니다.

### 2.2 계약별 기능과 증거 경계

- **(Decision — E-16)** 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다
- **(해석 경계)** Provider는 계약별 기능이지 기관의 지위가 아니다.
  - **(예외)** 포괄 위임이 문서로 확인된 데이터셋에서는 허브가 Provider 기능을 수행할 수 있다.

계약 증거에는 계약별 기능 수행 주체와 권한 근거를 남겨야 한다.
기관 등록 사실이나 Offering 게시 사실만으로 계약 체결을 판정하지 않는다.

| 상황 | 필요한 증거 | 판정 한계 |
| --- | --- | --- |
| 기계 Agreement가 데이터 계약의 집행 표현 | Agreement ID, 협상 양측 PID, 상위 계약 ID·version·효력기간, 권한 승인 기록 | 상위 계약 결속이 없으면 법률상 체결 여부 판정 불가 |
| 별도 전자·서면 계약이 존재 | 서명·승인된 계약의 참조와 digest, 당사자·Dataset·목적·기간, Agreement ID mapping | 문서와 기계 상태 중 하나만 유효하면 불충족 또는 재검토 필요 |
| 위임 주체가 Provider 기능 수행 | 포괄 위임 문서의 참조·적용 Dataset·유효기간과 판정 기록 | 기술 대행 기록만으로 Provider 권한을 증명할 수 없음 |

## 3. 조건 2 — 수신 가능 상태

### 3.1 Data Plane 기준 후보 판정 지점

- **(Decision — E-19)** 기존 정산 시스템(회계처리·버스경영관리시스템)은 **Consumer로 온보딩**한다. 계약을 맺고 운수사 원천에서 당겨온다
- **(해석 경계)** `E-19`의 “원천에서 당겨온다”는 원천 접근권을 Consumer에게 부여한다는 뜻이 아니다. PULL 토폴로지는 `E-21`의 Provider Data Plane 경유를 따른다.

수신 가능 상태는 Offering과 계약이 존재한다는 뜻만이 아니다.
Consumer가 승인된 계약 범위에서 Provider Data Plane에 접근했을 때 해당 Data Plane이 원천에서 읽은 실제 바이트를 받을 수 있는 상태여야 한다.

- **(Decision — 공통 선행요건 제안, 승인 전 미확정)** 어느 선택지에서도 다음 근거가 같은 판정 단위에서 유효해야 한다.
  - Provider 기능 수행 권한과 private source binding이 유효함
  - 최신 원천 record로 만든 Offering 메타데이터가 SHACL 판정을 통과하고 게시 철회 상태가 아님
  - EDC 경로의 Asset·Policy·Contract Definition과 DSP Catalog Offering이 같은 Dataset을 가리킴
  - 계약 협상이 `FINALIZED`이고 승인된 PULL 사건이 같은 Agreement·Dataset·format을 가리킴
  - **(한계)** SHACL 판정은 Offering 메타데이터만 검증하며 원천 가용성이나 payload 내용을 입증하지 않음

| 순서 | 관찰 지점 | 입증 범위 | 단독 판정 가능성 |
| --- | --- | --- | --- |
| 1 | Offering 게시·유효성 확인 | 검색·협상 가능한 메타데이터와 정책 | 불가 — 계약·원천 접근을 입증하지 않음 |
| 2 | 계약 협상 `FINALIZED` | 계약 조건과 당사자 합의 | 불가 — 접근 자원 발급·원천 가용성을 입증하지 않음 |
| 3 | 승인된 PULL 사건 | Connector가 Transfer와 계약 identity를 승인 | 불가 — 접근 자원 발급 결과가 없음 |
| 4 | Provider transfer worker의 접근 자원 발급과 `active` | token 또는 signed URL 발급과 source binding 입력의 Connector 접수 | 불가 — Data Plane binding·ready·실제 바이트 읽기를 입증하지 않음 |
| 5 | Provider Data Plane source binding 완료 | 원천 접근 자원과 계약별 access context가 Data Plane에 결속 | 수신 가능 후보 — Data Plane ready와 실제 접근 성공을 입증하지 않음 |
| 6 | Provider Data Plane ready | 계약 scope의 payload 접근을 받을 준비 상태 | 수신 가능 후보 — 원천 요청과 Consumer 수신 성공을 입증하지 않음 |
| 7 | Provider Data Plane 경유 실제 접근 성공 | Consumer 접근, Data Plane의 authorized source request와 응답 byte·Content-Type·digest의 계약·Transfer 결속 | 수신 가능 후보 — 시험 행위자와 Consumer 개입 범위는 미정 |
| 8 | Consumer 내부 적재·업무처리 성공 | Consumer 자체 시스템의 후속 처리 | 수신 가능 범위 초과 후보 — 기술적 온보딩·업무검증과 경계 설정 필요 |

Provider transfer worker는 승인된 PULL 전송 사건을 받아 원천 플랫폼 token이나 signed URL을 발급한다.
이 worker는 EDC Data Plane이나 DSP endpoint가 아니다.
발급 결과는 Provider Data Plane의 source binding이며 Consumer에게 주는 원천 접근권이 아니다.

- **(Verified)** 현재 worker의 `active`는 접근 자원 발급 뒤 Connector가 `DataAddress`를 접수했다는 구현 상태다.
  - **(근거)** [Provider transfer worker §6.1](../04-implementation/provider-transfer-worker.md#61-start)
- **(한계)** `active`만으로 Provider Data Plane의 source binding 완료·ready 또는 Consumer의 실제 byte 수신 성공을 증명할 수 없다.
- **(책임 경계)** worker는 실제 byte를 읽거나 프록시하지 않는다. Provider Data Plane이 source binding을 소비해 원천 요청과 Consumer 응답을 프록시하며, Consumer에게 token이나 signed URL을 노출하지 않는다.
- **(보안 경계)** token, signed URL과 `DataAddress` 원문은 제출 판정 기록이나 일반 감사로그에 저장하지 않는다.
  - **(대체 증거)** 발급 결과 ID·digest, 계약·Transfer 상관키, 유효기간, Data Plane의 원천 요청·Consumer 응답 결과와 폐기 receipt를 사용한다.

### 3.2 통제 범위 분리

룰북의 권고 간주문안 제2호는 다음 상태를 요구한다.

> “시장이 지정한, 국토교통부 데이터 스페이스와 상호운용되는 정보처리체계가 운송사업자의 원천시스템에서 해당 자료를 수신할 수 있게 된 때에 해당할 것”

- **(Decision — 제안)** 규약 골격은 위 문안을 입안안으로 제안한다.
  - **(근거)** [교통모빌리티 분야 규약 골격 §9.3](../02-design/sector-rulebook-framework.md#93-간주-문안-제안)
- **(Unverified)** 위 문안은 법무 검토 전 확정이 아니다. 위임 근거, 조문 위치, 계약 당사자와 간주효과 범위는 문서 미확인이다.
- **(Inferred)** 정보처리체계에 Consumer의 준비를 포함하면 Consumer 장애나 미구축으로 제공자의 이행이 불성립할 해석 여지가 있다.
- **(Unverified)** 제공자가 통제할 수 없는 Consumer 상태를 수신 가능 조건에 포함할지는 결정되지 않았다.

| 통제 구분 | 판정 대상 | 증거 후보 | 책임 해석 |
| --- | --- | --- | --- |
| Provider 기능 수행 주체 통제 | Offering 유효성, source binding, 승인된 PULL 처리, 접근 자원 발급·scope·만료·회수, Provider Data Plane ready·원천 접근 | 게시 상태, binding digest, worker journal, 발급 receipt, Data Plane 사건·동일 경로 probe 결과 | 제공자 측 준비 여부를 분리 가능 |
| Consumer 기능 수행 주체 통제 | 기관 신원, 계약·Transfer 요청, Data Plane 접근 요청, client credential, 네트워크·저장용량, 내부 수신 처리 | Consumer 요청·응답 log, 수신 digest, 오류 code, 내부 readiness 결과 | Consumer 미준비와 제공자 미이행을 분리할 필요 |
| 공동·외부 통제 | DNS·TLS, 상호 인증, 회선, 정산기관 유지보수, 장애창 | 양측 trace, 시간동기화 기록, 장애 공지, 재시험 결과 | 단일 주체 책임으로 확정하려면 별도 규칙 필요 |

- **(Unverified)** 기존 정산 시스템의 기관 신원, 계약 협상, 전송 요청, 수신 처리, 내부 적재와 결과 확인 인터페이스·증거는 미조사다.
  - **(근거)** [기존 플랫폼 인터페이스 계약 §12](platform-interface-contract.md#12-consumer-측-인터페이스-계약)

### 3.3 선택지와 귀결

전송 토폴로지는 `E-21`로 확정됐으나 Provider Data Plane 경로 안의 판정 시점과 Consumer 개입 범위는 미채택 상태다. 이 문서에서 우선순위를 정하지 않는다.

| 선택지 | 수신 가능 판정 지점 | 귀결 | 추가 승인 필요 |
| --- | --- | --- | --- |
| Provider 통제 범위 기준 | 운영자가 승인한 시험 Consumer가 Provider Data Plane에 접근하고 Data Plane이 같은 scope로 원천 요청에 성공 | 지정 Consumer 미준비로 제공자 판정이 바뀌지 않지만 실제 지정 Consumer의 수신능력을 입증하지 못함 | 시험 Consumer·경로 동등성·증거 유효기간 |
| 지정 Consumer 종단 기준 | 기존 정산 시스템이 Provider Data Plane을 통해 계약된 원천의 실제 byte 수신에 성공 | 실제 수신 증거가 강해지지만 Consumer 장애·미준비가 제공자 미이행으로 귀속될 수 있음 | 장애 귀속·재시험·유예 규칙 |
| 양측 하위상태 분리 | Provider 준비와 Consumer 준비를 별도 기록하고 법적 결합 규칙으로 수신 가능 여부 산출 | 원인과 책임을 분리할 수 있으나 상태·감사 복잡도가 늘어남 | 하위상태 의미와 법적 결합 규칙 |

Provider Data Plane 경로 안에서 수신 가능 상태의 최종 판정 시점과 Consumer 개입 범위는 `OPEN-SFD-02`에서 결정한다.

## 4. 조건 3 — 기술적 온보딩 완료

### 4.1 참가자 수준 종단시험 원칙

- **(Decision — E-12)** 온보딩은 **복수 경로**로 하고 위임을 허용하되 **FPIS식 3분할 책임**을 적용한다. 참가자·원천시스템은 사실·증빙 책임, 대행자는 변환·전송·인증·로그 책임, 운영자는 접속·보안 책임을 진다
- **(Verified)** 화물운송실적신고시스템(FPIS) 대행기관은 신고자가 신고 내용을 확인할 수 있게 할 의무가 있고 최종책임은 신고자에게 남는다.
  - **(근거)** [저기술 참가자 온보딩 선례 조사 §4](../01-research/low-tech-onboarding-precedents.md#4-화물운송실적신고-선례), [화물운송실적신고제 시행지침 제3조](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000105630), 확인일 2026-08-02
  - **(한계)** FPIS식 3분할은 세 기능 블록이며 대행기관을 세 종류로 나눈다는 뜻이 아니다.

- **(Verified — 문서 성격)** [기존 허브 연계 역량 조사 §8.1](../01-research/hub-capability-assessment.md#81-6단계-종단시험)의 6단계 시험은 플랫폼·허브 Adapter 대상이다.
- **(Decision — 적용 경계 제안, 승인 전 미확정)** 이를 참가자 합격기준으로 그대로 사용하지 않는다.

- **(Decision — 제안, 승인 전 미확정)** 플랫폼 시험은 다음 경계에서 참가자 시험으로 바꾼다.
  - **(재사용 범위)** 설명 대신 실제 실행 결과를 요구하고 계약·접근·회수 증거를 하나의 실행에 결속하는 원칙
  - **(변경 범위)** 참가자 신원, 실제 원천 기반 Offering, 정정·재게시와 대행 확인기회를 시험 대상으로 추가
  - **(제외 범위)** 허브 entitlement의 생성·정지·재개·멱등 시험을 참가자 최소기준으로 자동 승격하는 해석
- **(판정 경고)** “API가 있다”, “절차가 있다”는 설명만으로 인정해서는 안 된다.
  - **(검증)** 각 항목의 실행 응답, 상태 전이, 거부 결과와 증거 결속을 확인한다.

- **(Decision — 제안, 승인 전 미확정)** 시험 단위는 참가자, 원천 경로, Offering, 대행자 binding과 지정 시험 Consumer의 조합으로 한다.
  - **(제한)** 한 기관의 한 경로 통과를 다른 원천 경로나 대행자 조합에 재사용하지 않는다.

### 4.2 제안 판정 기준과 증거

다음 기준은 모두 `Decision` 제안이며 승인 전 확정이 아니다.

| 시험 항목 | 실행 절차 | 제안 합격 기준 | 증거 형태 |
| --- | --- | --- | --- |
| 신원 | 참가자 기관 자격 증명과 대행자 사용 시 위임 binding의 issuer·서명·audience·상태·유효기간을 실제 검증 | 유효한 기관 자격과 역할·위임 범위가 참가자·경로에 결속되고 만료·철회 증거가 없음 | 검증 결과, 참가자·credential 식별자, trust 기준 version, 상태 확인시각, 위임 참조·digest |
| Offering | 실제 원천 Dataset의 record와 private source binding으로 Offering을 만들고 RDF를 SHACL 판정한 뒤 Catalog에서 조회 | 실제 원천과 게시 객체가 결속되고 Offering 메타데이터의 SHACL 결과가 합격이며 게시 상태가 유효 | 원천 record ID·version·digest, binding digest, SHACL report, 게시 receipt, Catalog 조회 결과 |
| 전송 | 시험 Agreement를 `FINALIZED`한 뒤 지정 시험 Consumer가 승인된 PULL로 Provider Data Plane을 통해 원천의 실제 byte를 수신 | 계약·Transfer·Data Plane의 원천 요청·Consumer 응답이 같은 실행 ID에 결속되고 byte 수·Content-Type·digest가 기대 결과와 일치 | 협상 PID, Agreement ID, Transfer PID, 발급 receipt digest, Data Plane·Consumer log, byte 수·Content-Type·payload digest |
| 정정 | 통제된 오류 version을 원천 정정 경로로 수정하고 새 Offering version을 재게시한 뒤 Provider Data Plane에 다시 접근 | 정정 요청·원천 version·게시 version이 순서대로 연결되고 새 version이 조회·수신되며 이전 version 처리 결과가 기록됨 | 정정 요청, 전후 version·digest, SHACL report, Catalog diff, Data Plane 재접근 결과, 이전 version 상태 사건 |
| 종료 | Transfer 종료와 local Agreement 만료·철회를 구분해 실행하고 기존 접근 재사용과 신규 Transfer·접근 자원 발급을 각각 시도 | 기존 접근은 401 또는 403, 종료된 Agreement의 신규 발급은 거부되고 Agreement·Transfer scope 회수 결과가 각각 결속됨 | 종료 사건, revoke receipt digest, 상태 재조회, 기존·신규 접근 거부 log, scope별 reconciliation 결과 |
| 대행 | 대행자가 게시 대상 version·변환 결과·정정 경로를 참가자에게 제시하고 통지·접근 가능성을 실제 시험 | 정확한 version에 대한 통지 전달과 참가자 권한자의 접근 가능성이 입증되고 확인·정정요청 기회가 열려 있음 | 제시 version·digest, 통지 receipt, 접근권한·조회 시험, 기회 유효기간, 확인·정정 사건이 있으면 그 처리 결과 |

SHACL은 Offering 메타데이터의 판정이며 payload 내용의 정확성을 입증하지 않는다.
실제 원천 결속, SHACL report와 Provider Data Plane 경유 실제 PULL 결과는 서로 다른 증거로 보존한다.

- **(Decision — 제안, 승인 전 미확정)** 적용되는 여섯 항목이 같은 시험 실행에서 합격한 경우만 기술적 온보딩 완료 후보로 판정한다.
  - **(조건)** 대행자를 사용하지 않은 경로는 대행 항목의 비적용 사유와 대행 binding 부재를 증명해야 한다.
  - **(실패 조건)** 설명서, 화면 존재, API 명세나 서명 없는 자체확인만 제시하면 합격 처리하지 않는다.
  - **(증명 조건)** 같은 test run ID의 증명 묶음을 생성하고 digest·sequence·적용한 무결성 수단으로 재검증에 성공해야 한다.
  - **(한계)** 최종 합격기준, 시험 유효기간, 재시험 trigger와 예외는 `OPEN-SFD-03`에서 승인 전 미정이다.
- **(Verified — 구현 한계)** 현재 Provider transfer worker는 `START`와 `TERMINATE`만 구현하며 `SUSPENDED`·`COMPLETED` 전체를 처리하지 않는다.
  - **(근거)** [Provider transfer worker §1](../04-implementation/provider-transfer-worker.md#1-맡는-범위)
- **(증거 재사용 경계)** 전송 시험 결과가 3절의 수신 가능 상태와 같은 범위를 입증하면 두 판정이 같은 artifact를 참조할 수 있다.
  - **(제한)** artifact 재사용은 조건별 판정과 유효시점의 통합을 뜻하지 않는다.

## 5. 판정 주체

`DRV-02`의 완료 판정 주체는 운영자·정산주체·제3자 중 미정이다.
다음 표는 선택지의 귀결만 제시하며 어느 선택지도 채택하지 않는다.

| 선택지 | 이해충돌 | 비용·운영성 | 감사 독립성 | 분쟁 시 신뢰성 | 선행조건 |
| --- | --- | --- | --- | --- | --- |
| 운영자 | 자기 운영 통제를 스스로 판정할 위험 | 기존 로그·상태 접근이 쉬우나 검토 분리 통제 필요 | 조직·권한 분리가 없으면 제한됨 | 운영 사실 설명은 빠르지만 독립성 다툼 가능 | 판정 권한 분리, 이의 절차, 외부 검토 범위 |
| 정산주체 | Consumer이자 정산 이해관계자인 경우 이해충돌 가능 | 업무 의미와 제출 의무를 해석하기 쉬우나 기술검증 역량 필요 | 정산 감사체계와 결합 가능하나 자기 수신 준비 판정 문제 존재 | 환수·정산 근거와 가깝지만 상대방 이의 가능 | 기술검증 역량, Consumer 상태 분리, 이의 절차 |
| 제3자 | 운영·정산 이해관계에서 분리 가능 | 별도 계약·증거 접근·반복 심사 비용 발생 | 독립성 확보 가능하나 선정·감독 구조 필요 | 절차 독립성을 제시할 수 있으나 사실 접근 지연 가능 | 자격기준, 증거 접근권, 책임·배상, 감독·교체 절차 |

선택 판단에는 이해충돌, 비용, 감사 독립성, 분쟁 시 신뢰성, 증거 접근권과 재판정 절차를 함께 사용한다.
판정 주체가 미정인 동안 제안 종단시험의 기술 결과를 법적 제출 이행 승인으로 표시할 수 없다.
결정 요청은 `OPEN-SFD-04`에 등록한다.

## 6. 상태 표현과 감사 기록

### 6.1 의미 상태와 전이 요건

다음 표는 기계 판독 표현에 필요한 의미 범위다.
대문자 code, enum, 전이 API와 저장 schema를 확정하지 않는다.

| 판정 대상 | 최소 의미 상태 후보 | 전이 trigger | 전이 증거 |
| --- | --- | --- | --- |
| 계약 체결 | 미판정, 근거 검증 중, 충족, 불충족, 효력 정지·종료, 정정·대체 | 협상 `FINALIZED`, 상위 계약 결속, 만료·철회·해지, 판정 정정 | 협상·Agreement·상위 계약·권한 기록 |
| 수신 가능 | 미판정, 준비 중, 가능, 불가능, 일시 중단, 종료, 재시험 필요 | 접근 자원 발급, source binding 완료, Data Plane ready·접근 probe, 원천·Consumer 장애, 회수·복구 | worker·Data Plane·Consumer 사건과 책임 구분 |
| 기술적 온보딩 | 미시험, 시험 중, 합격, 불합격, 효력 보류, 재시험 필요 | 종단시험, credential·binding·대행자·schema 변경, 증거 만료 | test run과 항목별 결과·artifact |
| 제출 이행 | 미판정, 불성립, 성립, 이의 중, 정정·대체 | 세 조건 결속 시점 후보, 판정 결과 기록, 이의·정정 | 조건별 판정 ID·성립 유효시점 후보·판정시점과 결정 기록 |

- **(Decision — 제안, 승인 전 미확정)** 세 조건이 같은 판정 단위에서 결속된 시점을 성립 유효시점 후보로 기록하고 판정 주체의 판정·기록시점과 분리하는 안을 제안한다.
  - **(실패 조건)** 조건 ID, 유효시점 후보, 판정시점 또는 근거 참조가 하나라도 없으면 자동 성립 처리하지 않는다.
- **(Unverified)** 판정 주체의 결정이 성립을 확인하는 선언인지 성립 자체를 만드는 구성요건인지는 미정이다.
  - **(경계)** 별도 승인 없이 판정 주체의 결정을 `E-20`에 없는 네 번째 조건으로 추가하지 않는다.
- **(Unverified)** 상태 이름, 허용 전이, 조건 유효기간과 전체 판정 산식은 `DRV-03`·`T-06`의 미결이다.

### 6.2 감사 기록 필수 의미 필드

필드명과 직렬화 형식은 미정이지만 다음 의미는 감사 기록에 필요하다.

- **(Decision — E-21 적용)** 수신 가능 상태의 감사 관측점은 Provider Data Plane으로 고정한다.
  - **(근거)** Provider Data Plane은 Consumer 접근 결과와 authorized source request 결과를 같은 계약·Transfer context에서 관측한다. 따라서 판정은 원천 로그 제출이나 원천기관의 로그 협조에 종속하지 않는다.
  - **(증거 경계)** 원천 로그는 확보된 경우 보조 증거로만 사용한다.
- **(Unverified — OPEN-SFD-02)** source binding 완료, Data Plane ready와 Consumer의 실제 접근 성공 중 어느 사건을 수신 가능 판정 시점으로 삼을지는 미정이다.

| 필드군 | 필수 의미 | 제한 |
| --- | --- | --- |
| 기록 identity | 판정·사건 ID, 조건 종류, 이전·이후 판정, 선행·대체 사건 참조 | 공통 감사 ID의 최종 형식은 확정하지 않음 |
| 판정 단위 | 제출 의무·대상 기간, 참가자 ID, 계약별 Provider·Consumer 기능 수행 주체 | 기관의 고정 지위로 기록하지 않음 |
| 자산·경로 | Dataset·Offering ID와 version, 원천시스템·source binding의 비밀이 아닌 참조·digest | 원천 endpoint·credential 원문 제외 |
| 계약 | 양측 협상 PID, Agreement ID, 상위 계약·rulebook version과 효력기간 | 기계 Agreement만으로 상위 효력 간주 금지 |
| 전송·시험 | Transfer PID, 외부 자원 ID, Data Plane 접근 사건 ID, source request 상관키·결과, Consumer 응답 결과, test run ID, 시험 기준 version | token·signed URL·`DataAddress` 원문 제외 |
| 시각 | 근거 발생시각, 판정시각, 기록시각, 효력 시작·종료시각과 시간동기화 근거 | 하나의 시각으로 합치지 않음 |
| 행위자 | 행위자 ID·역할·기관, 권한 근거, 대행·판정 주체 구분 | 서비스계정과 사람 승인자를 구분 |
| 근거 | artifact 유형·위치·digest, 검증 결과, 실패·제한 사유 | payload·secret·불필요한 개인정보 제외 |
| 무결성 | 기록 sequence, 이전 기록 digest, 적용한 무결성 수단·algorithm·version과 해당 receipt·key 참조 | 특정 서명 방식이나 미승인 notary 배치를 확정하지 않음 |

기존 감사 식별자와 사건 범주는 [보안·신뢰·운영 설계 §8](security-trust-and-operations.md#8-감사)를 재사용한다.
새로 필요한 부분은 세 조건의 판정, 근거와 전체 이행 사건을 연결하는 기록이다.

### 6.3 종료·정지 뒤 이행 처리 선택지

Contract Negotiation 종료, local Agreement 만료·철회와 Transfer Suspension·Termination을 같은 사건으로 합치지 않는다.
과거에 성립한 이행의 법적 효과는 미정이며 다음 선택지를 기록한다.

| 선택지 | 과거 이행 | 현재 상태 | 귀결 |
| --- | --- | --- | --- |
| 장래효 기준 | 종료·정지 전에 성립한 이행 기록 유지 | 신규 이행과 접근만 중단 | 과거 증명은 단순하지만 소급 무효 사유를 별도 처리해야 함 |
| 기준시점 재평가 | 정산·감사 기준시점의 세 조건 유효성으로 해당 기간 판정 재계산 | 현재 상태와 기간 판정을 분리 | 기간·cut-off·장애 규칙이 필요함 |
| 권한 있는 소급 정정 | 원 판정은 보존하고 승인된 무효·정정 사건이 이전 판정을 대체 | 최신 유효 판정을 별도 표시 | 소급 권한·사유·이의 절차가 필요함 |

- **(Decision — 공통 기록 요건 제안, 승인 전 미확정)** 어느 선택지에서도 원 판정과 근거를 물리적으로 덮어쓰지 않고 후속 사건을 연결한다.
- **(Unverified)** 법적 효과와 소급 권한은 `OPEN-SFD-06`에서 결정한다.

### 6.4 참가자 확인 수단

참가자는 자기 판정 단위별로 다음 내용을 확인할 수 있어야 한다.

- 세 조건의 현재 의미 상태와 마지막 전이시각
- 조건별 근거 요약, 유효기간, 누락 증거와 다음 조치
- Provider·Consumer·대행자·운영자 중 실패 통제범위
- 판정 주체·판정시각·적용 rulebook version
- 정정·이의·재시험 요청 경로와 처리 상태
- 감사·분쟁에 제출할 무결성 검증 가능한 증명 묶음

제공 수단은 인증된 화면, 기계 판독 조회, 무결성 검증 가능한 export 중에서 선택할 수 있다.
구체 API와 화면은 확정하지 않는다.
대행 경로에서도 참가자의 직접 열람권과 이의기회를 보존한다.

### 6.5 사후 증명 시나리오

| 시나리오 | 제시할 증거 | 데이터 스페이스 기록의 한계 |
| --- | --- | --- |
| 감사 | 제출 의무·기간, 세 조건 판정, Agreement·Offering version, Provider Data Plane 경유 PULL·온보딩 실행, 판정 주체와 무결성 receipt | payload 내용과 정산 계산의 진실성 자체를 증명하지 않음 |
| 환수 | 당시 판정 묶음, 원천·Consumer가 보유한 대상 version, 양측 digest 대조, 정정·이상탐지·결정 기록 | 환수 금액과 법적 귀책은 원천자료·정산규칙·권한 있는 결정이 추가로 필요 |
| 분쟁 | 양측 시각·trace, Provider·Consumer 통제범위, 장애·재시험, 이의·대체 판정 이력 | 기록 존재만으로 귀책을 자동 확정하지 않음 |

사후 검증자는 source와 Consumer가 보존한 허용 범위의 자료를 판정 기록의 version·digest와 대조한다.
데이터 스페이스는 증명 목적으로 payload 복제본을 보관하지 않는다.

## 7. 미완료 시 처리

- **(Decision — E-15)** 기존 **제출 창구** 대체 목표를 **2028년**으로 옮기고 2027년은 병행 시범·준비기간으로 재정의한다 — 근거: `E-15`, 기준일: 2026-08-03
- **(Inferred — DRV-04)** 온보딩 미완료 참가자는 DS 경유 이행이 성립하지 않으므로 **기존 경로 병행이 필수**. 전환 일정(`E-15`)은 온보딩 완료율에 종속
  - **(해석 경계)** DS 경유 이행은 신원·카탈로그·계약·정책·감사 절차를 거친 이행이며 데이터 스페이스 공통 서비스의 payload 경유를 뜻하지 않는다. payload는 `E-21`에 따라 계약별 Provider Data Plane을 경유한다.

기술적 온보딩 완료 판정을 받지 못한 참가자는 기존 경로로 제출 의무를 계속 이행해야 한다.
연도 도달만으로 기존 경로를 종료하거나 `E-20`의 세 조건을 충족한 것으로 처리하지 않는다.

- **(Unverified)** 완료율의 분자는 `DRV-01`의 승인된 참가자 시험과 `DRV-02`의 판정 주체가 정해지기 전에는 확정할 수 없다.
- **(Unverified)** 완료율의 분모·임계값은 승인값이 없어 미정이다.
- **(판정)** 승인된 분자·분모·임계값과 증거가 없으므로 현재 완료율과 전환 가능 시점은 산정 불가다.
- **(결정 보류)** 기존 경로 종료조건, 예외·장애 처리와 전환 승인자는 `OPEN-SFD-07`에서 결정한다.

## 8. 미확인 사항과 결정 요청

| ID | 연계 ID | 상태 | 미확인 사항 또는 결정 요청 | 영향 | 담당 | 기한 | 종료 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN-SFD-01` | `DRV-03`·`T-06` | `Unverified` | DSP `FINALIZED`와 결과 Agreement를 법률상 계약 체결 조건에 결속하는 기준 | 조건 1과 상위 계약 효력의 관계 판정 불가 | 미정 | 미정 | 계약 상태·상위 문서 결속·유효기간 기준 승인 |
| `OPEN-SFD-02` | `E-21`·`DRV-03`·`T-06` | `Unverified` | Provider Data Plane 경로 안의 판정 시점과 Consumer 준비 개입 범위. 시점 후보는 source binding 완료, Data Plane ready와 Consumer의 Data Plane 실제 접근 성공 | Consumer 미준비를 Provider 미이행으로 볼지와 어느 Data Plane 사건에서 수신 가능이 성립하는지 판정 불가 | 미정 | 미정 | 판정 시점·Consumer 개입 범위 채택, 장애 귀속·재시험·증거 기준 승인 |
| `OPEN-SFD-03` | `DRV-01` | `Unverified` | 참가자 수준 종단시험의 판정 기준·증거·유효기간·재시험 trigger | 기술적 온보딩 완료와 완료율 분자 판정 불가 | 미정 | 미정 | 6개 시험 기준·증거·증명 묶음과 적용·비적용 규칙 승인 |
| `OPEN-SFD-04` | `DRV-02` | `Unverified` | 운영자·정산주체·제3자 중 완료 판정 주체, 선언·구성효과와 이의·재판정 권한 | 기술 결과를 제출 이행으로 승인할 주체와 판정시점의 효과 미정 | 미정 | 미정 | 판정 주체·효과·권한·이해충돌 통제·이의 절차 승인 |
| `OPEN-SFD-05` | `DRV-03`·`T-06` | `Unverified` | 세 조건과 전체 이행의 기계 판독 상태·전이·감사 기록·참가자 확인 수단 | 자동 판정과 사후 증명 구현 불가 | 미정 | 미정 | 의미 상태·필드 요건을 반영한 schema·API·검증 절차 승인 |
| `OPEN-SFD-06` | `DRV-03` | `Unverified` | 계약·Transfer 종료·정지 뒤 이미 성립한 이행의 유지·재평가·소급 정정 규칙 | 과거 이행의 감사·환수·분쟁 처리 판정 불가 | 미정 | 미정 | 법적 효과·기준시점·정정 권한·증거 보존 규칙 승인 |
| `OPEN-SFD-07` | `DRV-04` | `Unverified` | 온보딩 완료율의 분자·분모·임계값·증거와 기존 경로 종료조건 | `E-15` 전환 시점과 대상 범위 산정 불가 | 미정 | 미정 | 집계 정의·임계값·승인자·기존 경로 종료조건 승인 |
| `OPEN-SFD-08` | `E-21`·`T-06` | `Decision — E-21 (해소)` | 2026-08-03에 [아키텍처 §6.1](edc-caas-dsaas-architecture.md#61-기존-정산-시스템의-consumer-배치)의 Consumer 원천 직접 수신 서술과 [목표 아키텍처 §7](target-architecture.md#7-계약구독전송)·[Offering 수명주기 §5.1](offering-onboarding-lifecycle.md#51-기준-흐름)의 Provider Data Plane 경로가 불일치했다. `E-21`은 도식의 경로를 채택하고 token·signed URL을 Data Plane source binding으로 확정했다 | 해소 — 토폴로지와 감사 관측점은 Provider Data Plane으로 고정. 판정 시점과 Consumer 준비 개입 범위는 `OPEN-SFD-02`에서 계속 미결 | 미정 | 미정 | 충족 — `E-21` 채택과 관련 문서의 Provider Data Plane 경로 정렬 |
