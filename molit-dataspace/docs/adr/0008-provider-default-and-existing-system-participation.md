# ADR-0008: Provider 기본값과 기존 시스템 참여

작성일: 2026-08-03  
상태: Proposed  
결정권자: 미지정  
Supersedes:  
Superseded by:  
관련 ADR: [ADR-0002](0002-data-stays-at-source.md), [ADR-0003](0003-existing-platform-integration-topology.md)

## 1. 목적과 결정 요약

이 ADR은 기존 플랫폼·시스템이 데이터 스페이스에서 수행하는 계약별 기능과 허브 연계 범위를 정한다. 기관의 고정 지위, payload 보관·중계와 payload 전송 프로토콜은 결정 범위에서 제외한다.

| ID | 상태 | 결정문 |
| --- | --- | --- |
| `E-16` | `Decision` | 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다 |
| `E-18` | `Decision` | 허브 연계 범위는 **재제공권 확인목록**으로 한다. 기본값은 미연계이고 재제공 권리가 문서로 확인된 데이터셋만 추가한다 |
| `E-19` | `Decision` | 기존 정산 시스템(회계처리·버스경영관리시스템)은 **Consumer로 온보딩**한다. 계약을 맺고 운수사 원천에서 당겨온다 |

- **(Decision)** Provider는 계약별 기능이지 기관의 지위가 아니다. 같은 기관도 계약과 데이터셋에 따라 Provider·Consumer 또는 운영 기능을 달리 수행할 수 있다.
- **(Decision)** 허브는 기관 유형만으로 Provider 기능에서 제외되지 않는다. `E-16`과 `E-18`의 문서 조건을 충족한 데이터셋에서는 Provider 기능을 수행할 수 있다.
- **(Decision)** 데이터 스페이스는 payload를 보관하지도 중계하지도 않는다. 데이터 스페이스는 신원·카탈로그·계약·정책·감사를 담당하고 실제 바이트는 원천에서 Consumer로 직접 이동한다.
- **(Decision)** 이 ADR은 [ADR-0003](0003-existing-platform-integration-topology.md)의 4분류·배치 선택지를 뒤집지 않고 보완한다. 대체 관계는 두지 않는다.
- **(Unverified)** Provider 권한 entry, 재제공권 확인목록의 운영, 기존 시스템별 Consumer 온보딩 요건은 8절에 등록한다.

## 2. 배경과 제약

- **(Verified)** [ADR-0002](0002-data-stays-at-source.md)는 원천 플랫폼을 system of record로 유지하고 승인된 Adapter로 payload를 전달하는 원칙을 채택했다. DSP는 실제 payload 전송 프로토콜을 규정하지 않고 Control Plane과 Data Plane을 논리적으로 구분한다.
- **(Decision)** `E-19`는 [ADR-0002](0002-data-stays-at-source.md)의 원천 유지 원칙의 귀결이다.
- **(Verified)** [EDC 기반 CaaS·DSaaS 구성 설계 §6](../02-architecture/edc-caas-dsaas-architecture.md#6-offering-게시와-전송)은 Provider transfer worker를 승인된 PULL 전송 사건에 따라 원천 token이나 signed URL을 발급하는 경계로 정의한다. 이 worker는 EDC Data Plane이나 DSP endpoint가 아니다.
- **(Verified)** [허브 역량 조사 §2.1](../01-research/hub-capability-assessment.md#21-핵심-판정)는 공개 문서와 저장소 정본을 기준으로 허브 7곳을 전수 판정했다. 축 2·3·4를 함께 충족한 허브는 0곳이고 공개 문서만으로 확정되는 `brokered` 경로도 0개다. 비공개 운영 기능의 부재까지 단정한 결과는 아니다.
- **(Inferred)** [허브 역량 조사 §4.3](../01-research/hub-capability-assessment.md#43-격차의-영향)의 입력 `hosted` 13개 행은 정본 증거기준 적용 뒤 9개 `unknown`과 4개 메타데이터 역할로 하향됐다. 기능 부재 판정이 아니라 계약시험·운영 책임·식별자·version·삭제·권리의 묶음 증거가 없다는 판정이다.
- **(Inferred)** [허브 역량 조사 §6.1](../01-research/hub-capability-assessment.md#61-허브별-위험과-provider-구조)과 [허브 섭외 조사 §4.1](../01-research/hub-recruitment-feasibility.md#41-발주로-만들-수-없는-권리)은 법정 수집권과 DSP 재라이선스권이 동일하지 않다고 판정했다. 수집·가공·공개 근거가 있어도 Provider 기능의 위임과 제3자 재배포 권리는 데이터셋별 문서 확인이 필요하다.
- **(Inferred)** [허브 섭외 조사 §2.2](../01-research/hub-recruitment-feasibility.md#22-최소-필요-구성)는 초기 유즈케이스에 필요한 허브를 7곳 중 0곳으로 판정했다. 같은 조사 §3.2의 `지시 가능` 판정도 0곳이다.
- **(Inferred)** [허브 섭외 조사 §5.1](../01-research/hub-recruitment-feasibility.md#51-산정-결과)에서 전체 예상 리드타임과 권리 협상 리드타임은 산정 불가다. 과업범위, 예산 경로, 원천기관 수와 권리 조건이 확정되지 않았다.
  - **(Unverified)** 같은 조사가 제시한 권리협상의 법정 상한 부재 주장은 직접 근거 URL이 없어 문서 미확인이다.
- **(Verified)** 독일 Mobilithek–MDS 연계는 전체 재허가 대신 `hosted`·`brokered`이면서 오픈 라이선스인 데이터로 범위를 줄였다. payload는 Mobilithek이 전달한다.
  - **(Inferred)** 권리가 확인된 데이터에 기술 브리지를 붙인 선례로 판정한다.
  - **(근거)** [허브 섭외 조사 §6.1](../01-research/hub-recruitment-feasibility.md#61-권리-경계를-유지한-연계), [독일 연방교통부 Mobilithek](https://www.bmv.de/SharedDocs/DE/Artikel/G/mobilithek.html?editorSupport=true), [MDS Data Catalogue](https://mobility-dataspace.eu/data-catalogue), 확인일 2026-08-02
  - **(Unverified)** 정확한 `suspend`·`resume`·`audit` API, 연계 전용 발주액과 검수일은 문서 미확인이다.
- **(Verified)** 프랑스 국가접근점(Point d’accès national, PAN)은 원 생산자가 데이터와 라이선스 책임을 유지하고 일부 실시간 API key도 보유하게 한다.
  - **(Inferred)** PAN이 원천 권리를 대신 부여하지 않는 원천기관 직접 Provider 구조의 선례로 판정한다.
  - **(근거)** [허브 섭외 조사 §6.1](../01-research/hub-recruitment-feasibility.md#61-권리-경계를-유지한-연계), [PAN 법적 고지와 일반 이용조건](https://doc.transport.data.gouv.fr/le-point-d-acces-national/generalites/mentions-legales-et-conditions-generales-dutilisation), 확인일 2026-08-02
- **(Verified)** [교통·물류 참가자 지도 §4.1·§4.3](../01-research/transport-participant-map.md)는 정산사업자가 한 경로에서는 수신자이고 다른 경로에서는 제공 기능을 수행한다고 기록한다. 이 관찰은 역할을 기관의 고정 지위로 두지 않는 `E-16`과 정합한다.

## 3. 선택지

### 3.1 Provider 기능 수행 주체

| 선택지 | 판정 | 사유 |
| --- | --- | --- |
| 계약별 원천기관 기본값과 문서로 확인된 포괄 위임 예외 | `E-16` 채택 | 원천 권리·품질·제공 책임을 보존하면서 데이터셋별 위임을 허용 |
| 허브 운영기관을 일괄 기본값으로 지정 | 기각 | 허브의 법정 수집·운영 사실만으로 데이터셋별 재제공권과 계약 권한을 입증할 수 없음 |
| 기관을 Provider 또는 Consumer 중 하나로 고정 | 기각 | 같은 기관의 기능이 계약·데이터셋별로 달라지는 참가자 지도와 맞지 않음 |

### 3.2 허브 연계 범위

| 선택지 | 판정 | 사유 |
| --- | --- | --- |
| 재제공권 확인목록에 등재된 데이터셋만 연계 | `E-18` 채택 | 문서로 확인된 재제공 권리 범위와 기술 연계 범위를 일치시킴 |
| 허브 보유·색인 데이터셋을 기본 연계 | 기각 | `brokered` 확정 경로 0개와 `hosted` 증거 하향 판정을 무시함 |
| 허브 단위 일괄 승인 | 기각 | 데이터셋별 원천기관·권리·철회 조건의 차이를 표현할 수 없음 |

### 3.3 기존 정산 시스템의 참여

| 선택지 | 판정 | 사유 |
| --- | --- | --- |
| 기존 정산 시스템을 계약별 Consumer로 온보딩하고 원천에서 PULL | `E-19` 채택 | 원천 유지 원칙과 정산 기능의 수신·대사 역할을 함께 보존 |
| 데이터 스페이스가 정산 payload를 중앙 보관하거나 중계 | 기각 | [ADR-0002](0002-data-stays-at-source.md)의 원천 유지 원칙과 payload 경계에 어긋남 |
| 정산 시스템을 기관 단위 Provider로 고정 | 기각 | 다른 계약에서 제공 기능을 수행할 가능성과 `E-19` 대상 계약의 Consumer 기능을 혼동함 |

## 4. 결과

### 4.1 계약별 기능

- **(Decision)** 원천기관이 Provider 기능을 수행하는 것이 기본값이며, 허브 예외에는 특정 데이터셋에 대한 포괄 위임 문서가 필요하다.
- **(Verified)** Connector·플랫폼 운영 역할과 Provider 권한은 권한 레지스트리 schema에서 서로 구분된다.
- **(Decision)** 포괄 위임은 허브 전체의 고정 지위를 만들지 않는다. 위임 문서가 확인된 데이터셋과 계약에만 적용한다.

### 4.2 재제공권 확인목록

- **(Decision)** 문서로 재제공 권리를 확인하지 않은 데이터셋은 허브 연계 범위에서 제외한다.
- **(Verified)** 재제공권 확인목록은 [보안·신뢰·운영 설계](../02-architecture/security-trust-and-operations.md)의 SSRF 방어용 DNS·CIDR·egress 목록과 다른 개념이다.
- **(Unverified)** 확인목록의 운영 주체와 갱신 절차는 미정이다.

### 4.3 Consumer 온보딩과 payload 경로

- **(Decision)** `E-19` 대상 계약에서 회계처리·버스경영관리시스템은 Consumer 기능을 수행한다.
- **(Decision)** Consumer는 계약을 맺고 승인된 PULL 전송으로 운수사 원천의 실제 바이트를 직접 가져간다.
- **(Decision)** 데이터 스페이스는 신원·Offering·계약·정책·감사 사건을 처리하고 payload 경로에 들어가지 않는다.
- **(Verified)** Provider transfer worker는 승인 사건을 원천 token이나 signed URL 발급으로 바꾸며 EDC Data Plane이나 DSP endpoint 역할을 맡지 않는다.
- **(Unverified)** 회계처리·버스경영관리시스템별 identity, endpoint, 보안, 계약과 PULL 수신 요건은 미조사다.

### 4.4 비용과 제약

- **(Inferred)** 데이터셋별 위임 문서와 재제공 권리 증거를 수집·승인·철회하는 운영 비용이 발생한다.
- **(Verified)** 중앙 payload 완충 경로를 두지 않으므로 원천 endpoint의 가용성·quota·version 변경이 Consumer에 영향을 준다.
- **(Unverified)** 기존 정산 시스템 인터페이스의 PULL 지원 여부는 미조사다. 시스템별 Adapter 범위와 전환 조건은 판정 불가다.

## 5. 검증

| 검증 대상 | 현재 상태 | 입력 | 통과 조건 | 증거 |
| --- | --- | --- | --- | --- |
| `E-16` 기본값 | `Unverified` | 원천기관, 계약, 데이터셋, Provider 권한 요청 | 위임 문서가 없으면 원천기관 외 주체의 Provider 권한을 거부 | 권한 판정 결과와 Agreement |
| `E-16` 허브 예외 | `Unverified` | 특정 데이터셋의 포괄 위임 문서와 승인 entry | 문서 범위와 정확히 일치하는 허브·원천·자산·행위만 승인 | 위임 증거 ID, 승인 entry와 resolver 결과 |
| `E-18` 기본 미연계 | `Unverified` | 재제공권 확인목록과 Catalog 후보 | 확인목록에 없는 데이터셋의 허브 Offering을 생성하지 않음 | 확인목록 version, Catalog diff와 거부 기록 |
| `E-18` 등재 경로 | `Unverified` | 데이터셋별 재제공 권리 문서 | 확인된 권리 범위를 넘는 계약·재배포를 거부 | 법률·계약 검토 기록과 정책 판정 |
| `E-19` Consumer 경로 | `Unverified` | Consumer 계약, 운수사 원천 endpoint, 승인된 PULL 사건 | 실제 바이트가 원천에서 Consumer로 직접 이동하고 데이터 스페이스에 payload 저장·중계 지점이 없음 | 전송 trace, 원천 접근 로그와 감사 상관관계 |
| worker 경계 | `Unverified` | 승인·거부 PULL 사건 | 승인 사건에만 원천 token 또는 signed URL을 발급하고 worker를 EDC Data Plane·DSP endpoint로 노출하지 않음 | worker 사건 로그, 배포 명세와 endpoint 검사 |

현재 표의 `Unverified`는 결정 미승인을 뜻하지 않는다. 승인된 운영 entry·확인목록·시스템별 종단시험 증거가 아직 없다는 뜻이다.

## 6. 재검토 조건

- 원천기관의 권리 또는 포괄 위임 문서가 변경·만료·철회됨
- 법령·조례·계약이 중앙 보관 또는 다른 이행 경로를 명시적으로 요구함
- 재제공권 확인목록의 운영 주체와 갱신 절차가 승인됨
- 기존 정산 시스템별 Consumer 온보딩 조사와 종단시험 결과가 확보됨
- 원천 직접 PULL이 법적 의무, 보안 또는 서비스 수준을 충족하지 못한다는 증거가 확인됨

정기 재검토일: 미정

## 7. 근거

- [ADR-0002: 원천 유지와 Adapter 기반 전달](0002-data-stays-at-source.md)
- [ADR-0003: 기존 플랫폼 Bridge를 우선 연구·실증](0003-existing-platform-integration-topology.md) — 대체가 아닌 보완 관계
- [EDC 기반 CaaS·DSaaS 구성 설계 §6](../02-architecture/edc-caas-dsaas-architecture.md#6-offering-게시와-전송)
- [기존 허브의 데이터 스페이스 연계 역량 조사](../01-research/hub-capability-assessment.md)
- [기존 플랫폼 섭외 가능성 조사](../01-research/hub-recruitment-feasibility.md)
- [교통·물류 데이터 스페이스 참가자 지도](../01-research/transport-participant-map.md)
- [저기술 참가자 온보딩 선례 조사](../01-research/low-tech-onboarding-precedents.md)
- [Provider 권한 레지스트리 schema](../../contracts/provider-authority-registry.v1.schema.json)
- [Provider 권한 레지스트리](../../standards/provider-authority-registry.json)
- [Provider 권한 resolver](../../src/governance/provider-authority.mjs)

## 8. 미확인 사항과 결정 요청

| ID | 상태 | 미확인 사항 또는 결정 요청 | 영향 | 종료 증거 | 담당 | 기한 |
| --- | --- | --- | --- | --- | --- | --- |
| `OPEN-PES-01` | `Verified` | `E-16`의 시행 공백. schema는 `data-owner`·`delegated-provider`·`platform-operator`·`connector-operator` 역할과 `delegate` action을 지원해 모델 표현력이 있다. `standards/provider-authority-registry.json`의 승인 entry는 0건이고 resolver는 정확 일치 후보가 없으면 거부한다. 따라서 `E-16`은 해당 scope의 entry 등록·승인으로만 시행된다. | 현재 원천기관 기본값과 허브 예외를 기계 판정할 승인 권한이 없음 | 문서로 확인된 데이터셋 scope의 승인 entry, 유효한 검증 증거와 exact-match 허용·인접 scope 거부 결과 | 미정 | 미정 |
| `OPEN-PES-02` | `Unverified` | `E-18` 재제공권 확인목록의 운영 주체와 갱신·철회 절차가 미정 | 등재·제외·권리 변경의 승인 책임과 감사 순서를 판정 불가 | 승인된 책임분장, 갱신·철회 절차와 변경 감사 기록 | 미정 | 미정 |
| `OPEN-PES-03` | `Unverified` | `E-19` 적용 시 회계처리·버스경영관리시스템별 Consumer 온보딩 요건 미조사 | 대상별 identity·접속·보안·계약·원천 인터페이스와 PULL 가능 여부 판정 불가 | 시스템별 조사서, 승인된 온보딩 판정 기준과 종단시험 증거 | 미정 | 미정 |

## 9. 개정 이력

`Proposed` 상태에서 결정 문안을 제자리 개정한 경우에만 행을 추가한다.

| 작성일 | 사유 | 이전 문안과의 차이 |
| --- | --- | --- |
