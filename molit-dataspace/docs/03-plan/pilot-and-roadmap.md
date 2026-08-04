# 실증과 로드맵

작성일: 2026-07-11  
작성 기준: 2026-08-03  
최종 개정: 2026-08-03  
상태: Draft
관련 결정: `E-15`, `E-16`, `E-17`, `E-18`, `E-19`, `E-20`, `E-21`

## 1. 목적과 완료 판정

- **(목적)** 기존 플랫폼 record를 DSP Offering과 실제 접근 수명주기에 연결하는 실증 순서와 단계별 Gate 정의
- **(범위)** 조사 기준선, 후보 판정, Discovery Bridge, mock·sandbox 종단 수명주기, 전달 방식 확대와 운영 전환
- **(완료 판정)** Catalog 표시만으로 완료하지 않고 Agreement, Transfer, 플랫폼 접근자원, 회수와 reconciliation의 증거까지 확인

첫 PoC는 다음 흐름을 실제 상태와 증거로 연결한다.

```text
기존 플랫폼 record
  -> 역할·권리·source 판정
  -> DSP Dataset·Offer·Distribution·DataService 게시
  -> Agreement 교환·검증과 Contract Negotiation FINALIZED
  -> platform entitlement·subscription·token·snapshot 생성
  -> Provider transfer worker가 승인된 PULL 사건에 따라 원천 접근 token·signed URL 발급
  -> 발급 결과를 Connector 관리면을 거쳐 Provider Data Plane의 source binding 입력으로 설정
  -> Consumer가 계약 범위에서 Provider Data Plane에 payload PULL 요청
  -> Provider Data Plane이 source binding으로 원천에서 읽어 응답
  -> Transfer 완료·종료와 단기자원 회수
  -> Agreement 해지·Dataset 철회와 장기자원 회수
  -> reconciliation
```

metadata만 동기화하면 Discovery Bridge PoC다. Agreement와 실제 플랫폼 접근 수명주기까지 연결해야 Full Offering Bridge PoC다. 두 결과를 같은 완료로 보고하지 않는다.

- **(Decision)** 데이터 스페이스 공통 서비스는 신원·Catalog·계약·정책·감사를 담당하며 payload를 보관하거나 중계하지 않음
  - **(근거)** [ADR-0002](../adr/0002-data-stays-at-source.md)와 [EDC 기반 CaaS·DSaaS 구성 설계 §6](../02-architecture/edc-caas-dsaas-architecture.md#6-offering-게시와-전송)
- **(Decision — E-21)** payload 전송은 **Provider Data Plane 경유로 단일화**한다. 원천 직접 방식(Consumer가 원천 token·signed URL로 원천에 직접 접근)은 채택하지 않는다
  - **(전송 경계)** Consumer는 계약 범위에서 Provider Data Plane에 접근해 PULL하고, Provider Data Plane은 source binding으로 원천에서 읽어 응답함
  - **(소유 경계)** Provider Data Plane은 참가자(Provider)의 전송 경계이며 데이터 스페이스 공통 서비스가 아님
  - **(worker 경계)** Provider transfer worker는 원천 token 또는 signed URL의 발급 결과를 Connector 관리면으로 넘겨 Provider Data Plane의 source binding 입력을 만드는 경계이며 EDC Data Plane이나 DSP endpoint가 아님

## 2. 추진 원칙

- 달력 기간보다 진입·종료 Gate로 단계를 관리한다.
- MDS–Mobilithek 사례에서 확인된 사실과 공개되지 않은 구현을 구분한다.
- 통합채널 역할을 서비스 전체에 일괄 부여하지 않고 Dataset별로 판정한다.
- 공개 license와 안전한 반복시험이 가능한 데이터부터 사용한다.
- 실제 플랫폼 API가 확인되기 전에는 mock으로 상태·보상·reconciliation을 시험한다.
- 개인정보, 원시 교통카드, 공개제한 공간정보를 초기 PoC에 사용하지 않는다.
- Connector, CaaS, identity, transfer 제품은 비교시험과 ADR 뒤에 채택한다.
- `serviceKey`를 HTTP로 전송하지 않는다. 운영기관이 지원 hostname·접근망·DNS·HTTPS를 확인하기 전에는 분석센터 key 발급과 실증 호출을 하지 않는다.
- 운영기관 승인 없이 활용신청, 외부 문의 발송, 데이터 변경을 수행하지 않는다.

### 2.1 첫 출시 등급 상한

D-12의 첫 출시 범위는 공개·등록형 공개와 기관 제한 자산까지다. 등급 정의는 [보안·신뢰·운영 설계 §3](../02-architecture/security-trust-and-operations.md#3-데이터-등급과-경로), 정책 경로는 [metadata·정책 profile §8](../02-architecture/metadata-and-policy-profile.md#8-정책-등급)을 정본으로 사용하며 이 문서에서 재정의하지 않는다.

| 자산 판정 | 첫 출시 처리 | 선행 증거 | 실패 처리 |
| --- | --- | --- | --- |
| 공개·등록형 공개 | 기존 공개 원천 인터페이스를 Provider Data Plane의 source binding으로 유지하고 Consumer가 계약 뒤 Provider Data Plane에서 PULL하는 승인 경로를 적용 | license, Provider 권한, source·Distribution, 회수방법 | `catalog-only` 또는 제외 |
| 기관 제한 | 사업자 데이터의 기관 자격·목적·기간과 통제 경로를 자산별 승인 | 권리 inventory, 수신자·목적·기간, 통제 Data Plane, 감사 | 증거 하나라도 없으면 제외 |
| 개인정보·가명정보 | 첫 출시 제외 유지 | 2차 secure analysis 결정 전에는 평가만 기록 | `excluded` |
| 공개제한 공간정보 | 첫 출시 제외 유지 | 보안심사·승인환경·반출통제 결정 전에는 평가만 기록 | `excluded` |
| secure analysis | 2차 출시 이월 | [DEF-08 운영 원칙](../02-design/governance-and-operating-principles.md#4-서비스-portfolio-원칙) 결정과 결과 반출 Gate | 1차 경로 생성 금지 |

자산별 판정은 단계 1 종료 전에 완료한다. 기관·플랫폼 단위의 포괄 승인을 자산 판정으로 대신하지 않는다.

권리·등급 판정이 철회되거나 번복되면 해당 자산을 첫 출시 범위에서 자동 제외한다. Offering 상태는 [보안 Gate의 fail-closed 규칙](../02-architecture/security-trust-and-operations.md#9-개인정보공간정보-gate)에 따라 `PENDING_EVIDENCE`, `CATALOG_ONLY` 또는 `QUARANTINED`를 벗어나지 않는다.

### 2.2 확정 결정과 적용 경계

| ID | 결정문 |
| --- | --- |
| `E-15` | 기존 **제출 창구** 대체 목표를 **2028년**으로 옮기고 2027년은 병행 시범·준비기간으로 재정의한다 |
| `E-16` | 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다 |
| `E-17` | 초기 출범을 **허브 섭외에 종속시키지 않는다.** `E-11`은 **유지하되 초기 범위에서 제외하고 확장 단계로 옮긴다** |
| `E-18` | 허브 연계 범위는 **재제공권 확인목록**으로 한다. 기본값은 미연계이고 재제공 권리가 문서로 확인된 데이터셋만 추가한다 |
| `E-19` | 기존 정산 시스템(회계처리·버스경영관리시스템)은 **Consumer로 온보딩**한다. 계약을 맺고 운수사 원천에서 당겨온다 |
| `E-20` | 제출 이행은 **계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료**의 세 조건이 모두 충족된 때 성립한다 |
| `E-21` | payload 전송은 **Provider Data Plane 경유로 단일화**한다. 원천 직접 방식(Consumer가 원천 token·signed URL로 원천에 직접 접근)은 채택하지 않는다 |

`Provider`는 계약별 기능이며 기관의 고정 지위가 아니다. 허브는 기본값이 아니지만, 포괄 위임이 문서로 확인된 데이터셋에서는 그 계약의 Provider 기능을 수행할 수 있다.

`E-19`의 “운수사 원천에서 당겨온다”는 업무 층위의 승인 문구다. Consumer에게 원천 접근권을 부여한다는 뜻이 아니며, 기술 전송은 `E-21`에 따라 Consumer가 Provider Data Plane에서 PULL하고 Data Plane이 source binding으로 운수사 원천에서 읽어 응답하는 경로를 따른다.

## 3. 단계 개요

| 단계 | 담당 | 입력·선행조건 | 주요 산출물 | 수행 시점 | 완료조건 |
| --- | --- | --- | --- | --- | --- |
| 0. 조사 기준선 | Research owner | 공식 자료와 로그인 후 정제 증거 | 사례 연구, capability profile, source·claim register | 실증 설계 전 | 사실·추론·결정 구분과 출처 검토 완료 |
| 1. 플랫폼·후보 판정 | Data steward·governance | source record와 권리·역할 증거 | Dataset Passport, 역할·권리 matrix, 후보 결정 | 단계 0 승인 뒤 | `G0~G3` 통과 |
| 2. 계약·제품 설계 | Architecture·security owner | 승인 후보와 southbound 요구 | mock contract, architecture, ADR, spike plan | 후보 확정 뒤 | interface·보안 review 통과 |
| 3. Discovery Bridge | Offering onboarding owner | 승인 metadata source와 schema | harvester, mapper, discovery diff | 계약 설계 뒤 | non-Dataset·삭제·중복 시험 통과 |
| 4. Mock Full Lifecycle | Connector·Bridge owner | mock source와 DSP target | Provider/Consumer, mock platform, Reconciler | Discovery Gate 뒤 | `G4~G6`와 실패·보상 시험 통과 |
| 5. Sandbox 연계 | Platform·Bridge owner | 운영기관 승인, sandbox와 credential | sandbox adapter, Offering, audit bundle | mock 종단시험 뒤 | Agreement→Transfer→revoke 실증 통과 |
| 6. 전달 방식 확대 | Data Plane owner | 승인된 전달 방식별 후보 | adapter profile과 domain test 결과 | 첫 sandbox 종단시험 뒤 | 방식별 권리·성능·보안 Gate 통과 |
| 7. 운영·연합 | SRE·governance owner | 승인된 실증 결과와 운영 요구 | runbook, DR, onboarding, federation ADR | 운영 전환 전 | 법무·보안·운영 승인 |

각 Gate의 세부 조건은 [PoC 후보 목록](poc-candidate-shortlist.md)의 `G0~G6`을 사용한다.

### 3.1 Gate와 사업·권리 시퀀스

다음 여섯 단계는 사업·권리 시퀀스이며 단계 0~7의 진입·종료조건을 대체하지 않는다. 각 단계는 대응 Gate의 증거를 충족한 뒤 다음 단계로 진행하며, 단계 6의 전달 방식별 검증은 독립적으로 유지한다.

| 순서 | 사업·권리 단계 | 입력·동작 | 기존 Gate와의 관계 | 산출물·완료 증거 |
| ---: | --- | --- | --- | --- |
| 1 | 원천 권리 확정 | 파일럿 지자체 조례·준공영제 협약·정산 위수탁계약·운수사 데이터 권리를 확인 | 단계 1의 `G0~G3` 판정 입력 | 원문별 권리·제한·계약별 Provider 기능 주체를 추적한 Dataset Passport |
| 2 | 표준 참여계약과 데이터 분류 확정 | 미동의·민감 항목은 제외 / 집계 / 폐쇄환경 중 하나로 판정 | 단계 1~2의 권리·정책·보안 review | 서명된 계약·부속합의서와 항목별 분류 기록 |
| 3 | **허브 없이 Provider Data Plane 경유 PULL 1건 완주** | 초기 출범 범위로서 Consumer가 계약을 맺고 Provider Data Plane에서 PULL하며 Data Plane이 source binding으로 운수사 원천에서 읽어 응답 | 단계 3~5의 Provider Data Plane 종단 실증 | Agreement→승인된 PULL 사건→source binding→Provider Data Plane 응답→종료·회수의 상관관계 증거 1건 |
| 4 | 재제공권이 확인된 데이터만 첫 허브 1곳에 연계 | `재제공권 확인목록`에 오른 데이터셋만 추가 | 허브 미사용 연계 완주 뒤 자산별 `G0~G6` 재통과 | 데이터셋별 위임문서와 허브 종단시험 증거 |
| 5 | 패턴 확정 후 타부처 협의 | 허브 미사용·허브 연계 실증의 계약·API·보안·비용·책임 결과를 협의 입력으로 사용 | 단계 7의 연합 확장 | 협의 안건과 기관별 보완·결정 기록 |
| 6 | NTIC·K-MaaS·오픈마켓은 유즈케이스 발생 시 확장 | 실제 수요·권리·운영 책임이 확인된 대상만 추가 | 단계 7의 유즈케이스별 확장 | 허브별 승인 범위와 독립 종단시험 증거 |

- **(Inferred)** 초기 유즈케이스에 필요한 허브는 0곳이고 지시만으로 기능·계약·보안·권리를 모두 반영할 수 있는 허브도 0곳임
  - **(근거)** [기존 플랫폼 섭외 가능성 조사 §2.2·§3.2](../01-research/hub-recruitment-feasibility.md#22-최소-필요-구성), 조사 외부자료 확인일 2026-08-02
- **(Inferred)** 권리 협상 리드타임은 산정 불가
  - **(한계)** 조사 입력의 “법정 상한 없음” 주장은 직접 근거 URL이 없어 `Unverified`이며 기간 수치로 대체하지 않음 — [같은 조사 §5.1](../01-research/hub-recruitment-feasibility.md#51-산정-결과)

## 4. 단계 0: 조사 기준선

### 4.1 작업

1. MDS–Mobilithek의 metadata, 계약, subscription, 전송, 종료 역할을 1차 출처로 재구성한다.
2. 바덴뷔르템베르크(Baden-Württemberg, `BW`) 모빌리티 데이터 플랫폼 MobiData의 자체 Connector 방식을 별도 토폴로지로 정리한다.
3. 통합채널의 공개·회원 화면 관찰을 `hosted·brokered·index-only·unknown` 질문으로 다시 분류한다.
4. 확인되지 않은 DSP revision, identity mapping, provisioning API를 구현 사실로 쓰지 않는다.
5. 운영기관 질문서와 필요한 증거 형식을 정리한다.
6. source register와 claim matrix에 참조 사례와 설계 판단을 등록한다.

### 4.2 종료 조건

- 참조 사례의 공식 출처가 주장 가까이에 연결됨
- 통합채널의 확인 기능과 미확인 기능이 별도 표에 있음
- 로그인 화면 관찰을 공식 API·SLA로 오인한 문장 0건
- API key, cookie, token, 개인 연락처가 evidence에 없음
- 현재 문서의 역할 용어가 원 보유기관·Offering Provider·Connector·전달 운영자로 정리됨

## 5. 단계 1: 플랫폼과 후보 판정

### 5.1 후보 순서

| 순서 | 후보 | 사용 목적 | 현재 상태 |
| --- | --- | --- | --- |
| 1 | 파일럿 운수사 원천의 승인된 정산 Dataset | 허브 없는 Provider Data Plane 경유 PULL full lifecycle | 대상 미정, 조례·협약·위수탁계약·데이터 권리 증거 필요 |
| 2 | 분석 데이터셋 metadata `GET` | Discovery Bridge | 설계 가능, endpoint·HTTPS 확인 전 실행 차단 |
| 3 | ITS 표준 노드·링크 파일 | finite snapshot fallback | 권리·source 계약 필요 |
| 4 | 통계누리 공개 통계 REST | REST gateway fallback | proxy·credential·quota 확인 필요 |
| 5 | ITS 교통소통 REST | 실시간성·freshness 후속시험 | quota·version 확인 필요 |
| 6 | VWorld 공개 WFS/WMS | 공간 query 정책 후속시험 | layer 권리·보안등급 확인 필요 |
| 확장 | 통합채널에서 hosted·brokered 증거와 재제공권이 확인된 공개 Dataset | `E-11`의 Mobilithek형 full lifecycle | 허브 미사용 Provider Data Plane 연계 1건 완주 뒤 대상 식별·운영기관 증거 필요 |

근거와 제외조건은 [PoC 후보 목록](poc-candidate-shortlist.md)에 기록한다.
`E-11` 후보는 폐기하지 않으며 `E-17`에 따라 초기 출범 범위가 아닌 확장 순서에 둔다.

### 5.2 Dataset Passport

후보마다 다음을 채운다.

- 원 데이터 보유기관, Publisher·steward
- 플랫폼 역할과 판정 evidence
- Offering Provider, 법적 계약 당사자, Provider authority
- Connector·Data Delivery 운영자
- license, proxy·cache·재제공·파생물 조건
- metadata baseline·delta·delete
- Distribution, DataService와 private source binding
- platform identity·subscription·token·revoke capability
- 보유·삭제·장애·변경통지와 SLO

### 5.3 종료 조건

- `G0`: 실제 Dataset이며 source ID가 있음
- `G1`: Offering Provider와 권리 증거가 있음
- `G2`: 공식 metadata interface 또는 승인된 export가 있음
- `G3`: 실제 Distribution·source 계약과 회수방법이 있음

하나라도 실패하면 Full Offering 후보로 사용하지 않는다. `catalog-only`, `pending` 또는 `excluded` 상태와 이유를 남긴다.

## 6. 단계 2: 플랫폼 계약과 제품 Spike

### 6.1 Southbound contract

[기존 플랫폼 인터페이스 계약](../02-architecture/platform-interface-contract.md)의 mock을 먼저 고정한다.

- Dataset baseline·delta·delete
- subscription·entitlement create/read/suspend/resume/delete
- scoped token 또는 signed URL 발급·revoke
- identity binding
- 상태 event 또는 polling·reconciliation
- audit query와 external resource ID
- 409·429·5xx·timeout·응답유실 오류

### 6.2 Connector·CaaS 비교

| 평가축 | 확인 방법 |
| --- | --- |
| DSP | 2025-1-err1 schema·상태·version discovery·상호운용 시험 |
| Offering management | Dataset·policy·contract definition 등록·갱신·철회 API |
| Lifecycle hook | Agreement·Transfer event와 external provisioning 확장점 |
| Data Plane | custom source, external gateway, push·pull·finite·non-finite 지원 |
| Source resolution | public metadata와 private source binding 분리 가능성 |
| Identity | 기존 PKI/OAuth·기관 service identity·선택적 DCP 연계 |
| CaaS | tenant, Provider 대리, source network, secret·audit·offboarding 경계 |
| Persistence | state export, migration, outbox, restart와 reconciliation |
| Security | management API 비공개, Vault/HSM, egress, SBOM·patch |
| Operations | metric·trace·audit, backup·restore, upgrade·지원 수명주기 |

EDC는 사례와 확장성을 확인할 후보지만 채택을 가정하지 않는다. 과거 handbook 예제의 객체나 내장 proxy를 현재 production 기능으로 그대로 가정하지 않고 선택한 release의 공식 API·decision record로 다시 확인한다.

### 6.3 결정할 ADR

- Connector 또는 CaaS 제품·version
- Offering 등록과 source binding mapping
- platform provisioning·reconciliation 방식
- participant와 platform identity binding
- Provider Data Plane 경유 REST·snapshot·stream transfer profile
- production identifier namespace
- secret·audit·state store와 network 배치
- Catalog Broker 필요 여부

## 7. 단계 3: Discovery Bridge

### 7.1 작업 순서

1. 운영기관이 승인한 metadata source에서 baseline을 수집한다.
2. record를 Dataset, 기관·시스템, 활용사례, 게시물로 분류한다.
3. Dataset을 hosted·brokered·index-only·unknown으로 판정한다.
4. source ID, 수정시각, provenance, landing page를 canonical model로 정규화한다.
5. delta·delete·duplicate·out-of-order fixture를 처리한다.
6. Offering Gate가 닫힌 record에는 DSP Offer·Distribution·source binding을 만들지 않는다.

### 7.2 종료 조건

- non-Dataset이 DSP Catalog Dataset으로 생성된 건수 0
- 권리·Distribution이 없는 record에 Offer가 생성된 건수 0
- 삭제·수정·중복의 최종 Catalog가 source desired state와 일치
- secret·내부 URL·session 값 노출 0
- 모든 판정이 source record와 evidence ID로 추적 가능

## 8. 단계 4: Mock Full Lifecycle

실제 플랫폼의 운영 API가 준비되지 않아도 Bridge 자체의 상태설계를 먼저 시험한다.

### 8.1 정상 흐름

1. 공개 Dataset 하나와 Distribution 하나를 Provider Connector에 게시한다.
2. Consumer가 Catalog를 조회하고 Agreement 교환·검증·수신 확인(Acknowledgement, ACK)을 거쳐 Contract Negotiation을 `FINALIZED`한다.
3. 필수 필드를 갖춘 Transfer Request와 Provider ACK 뒤 mock platform에 entitlement를 생성한다.
4. external ID와 source binding을 Data Plane에 연결한다.
5. Consumer가 Provider Data Plane의 pull `dataAddress`에 접근해 Transfer Start와 ACK 뒤 payload를 PULL한다.
6. Transfer Completion·Termination 뒤 Transfer scope token·job·snapshot을 삭제한다.
7. 같은 Agreement로 두 번째 Transfer를 수행해 Agreement scope subscription이 유지됐는지 확인한다.
8. local Agreement 만료·해지 뒤 subscription·entitlement를 삭제한다.
9. Reconciler가 orphan resource 0개를 확인한다.

### 8.2 실패 주입

- entitlement 생성 성공 후 응답 유실
- 같은 callback과 Transfer Request 반복
- DSP 메시지 ACK 유실·ERROR와 양측 PID 상태 불일치
- Connector restart 전·후 external resource 존재
- platform `429`, timeout, `5xx`, schema drift
- delete API 실패와 callback 유실
- Dataset delete와 진행 중 Transfer 경합
- source event 순서 뒤바뀜

### 8.3 종료 조건

- `G4`: DSP mapping과 상태흐름 검증
- `G5`: provision·revoke·reconciliation 검증
- `G6`: secret·TLS·audit·장애격리 검증
- 같은 멱등키의 활성 external resource 최대 1개
- `COMPLETED·TERMINATED` Transfer의 Transfer scope 자원 0개
- 종료된 local Agreement와 `WITHDRAWN` Offering의 Agreement scope 자원 0개
- Agreement→Transfer→external ID→source request→cleanup evidence 조회 가능

## 9. 단계 5: 실제 sandbox 연계

### 9.1 진입 조건

- 운영기관의 공식 hostname·DNS view·HTTPS·TLS 확인
- 기관용 credential과 server-to-server 사용 승인
- 대상 Dataset과 Provider 권리 승인
- sandbox 또는 공개 Dataset과 호출량 확보
- metadata, source, subscription 또는 token API contract test 통과
- 장애·삭제 시험의 운영기관 동의

### 9.2 실행

1. mock adapter의 southbound client만 실제 sandbox client로 교체한다.
2. 같은 contract test를 실행한다.
3. metadata 한 건을 게시한다.
   - Provider transfer worker는 Connector가 승인한 PULL 사건에 따라 원천 플랫폼 token 또는 signed URL을 발급한다.
   - worker는 발급 결과를 Connector 관리면으로 넘겨 Provider Data Plane의 source binding 입력을 만든다.
   - Consumer가 계약 범위에서 Provider Data Plane에 접근해 payload를 한 번 PULL하면 Data Plane은 source binding으로 원천에서 읽어 응답한다.
4. 재시도·만료·정지·종료를 낮은 호출량으로 시험한다.
5. platform audit와 Connector audit의 correlation을 확인한다.
6. 생성한 계정·token·subscription·snapshot을 모두 정리한다.

통합채널 hosted·brokered Dataset을 찾지 못해 지능형교통체계(Intelligent Transport Systems, ITS)나 통계누리 원천으로 시험했다면 결과를 “원천 플랫폼 Bridge”로 기록한다. “통합채널 broker 연계”로 부르지 않는다.

## 10. 단계 6: 전달 방식 확대

### 10.1 File snapshot

- source version과 immutable manifest
- checksum, byte·record count
- signed endpoint TTL
- 재시도·부분실패와 만료 삭제

### 10.2 REST gateway

- method·path·query allowlist
- 기관 credential 은닉
- participant·Agreement별 quota
- pagination, timeout, retry·circuit breaker

### 10.3 OGC

- layer·collection, 경계상자(Bounding Box, BBOX), CRS·axis
- feature·byte·filter complexity 제한
- 공개제한 feature와 좌표 정밀도 통제

### 10.4 Stream

- topic·consumer group·접근제어목록(Access Control List, ACL), schema registry
- retention·replay·ordering·duplicate
- non-finite 종료와 credential 회수

### 10.5 Compute-to-data

- 허용 workload·package·network·resource
- source read-only, 결과 반출심사
- workspace·key·결과 만료·파기

DSP 기본 규격이 실제 transfer protocol, stream 또는 원격 작업 형식을 정의한다고 쓰지 않는다. 데이터셋별 별도 profile과 상호운용 시험이 필요하다.

## 11. 단계 7: 운영과 연합

- Dataset·Offering·adapter별 SLO와 support window
- Connector·Bridge·platform dashboard와 공통 correlation
- backup·restore·재해복구(Disaster Recovery, DR)와 상태 reconciliation drill
- certificate·source key·service identity rotation
- **(변경관리)** Change manager는 schema·policy·endpoint·license 변경요청을 compatibility report로 검토하며, 완료조건은 배포 전 compatibility test 통과와 승인자 서명 기록
- vulnerability·소프트웨어 자재명세서(Software Bill of Materials, SBOM)·patch SLA
- participant·Provider·platform onboarding·offboarding
- 법무·개인정보·공간정보·보안 승인 갱신
- quota·capacity·비용과 책임 분담
- 여러 Provider Catalog가 생겼을 때 Broker의 필요성·SLO·fallback 결정

## 12. Workstream

| Workstream | 책임 역할 | 주요 산출물 |
| --- | --- | --- |
| Reference research | Research owner | MDS 사례, 공식 출처, claim matrix |
| Platform capability | 통합채널·원천 플랫폼 운영자 | host·broker·index matrix, API·SLA |
| Governance·legal | 국토부 정책·법무·보안 | Provider 권한, 위임, license·등급 |
| Offering onboarding | data steward·Bridge 개발 | harvester, mapper, Passport, withdrawal |
| Connector Control Plane | protocol·platform 개발 | DSP, policy, Agreement·Transfer state |
| Platform lifecycle | Bridge·플랫폼 개발 | entitlement·subscription·identity·reconcile |
| Data Plane | API·GIS·stream 개발 | source binding, gateway·snapshot·stream |
| Operations | 인프라·SRE·SOC | secret, audit, monitoring, DR·patch |
| Verification | QA·상호운용·보안 | contract·conformance·failure evidence |

## 13. 사용자·외부기관이 필요한 시점

현재 공개자료 조사와 문서 정리는 별도 조치 없이 진행할 수 있다. 다음 단계에는 명시적인 확인이 필요하다.

| 시점 | 필요한 조치 | 주의사항 |
| --- | --- | --- |
| 회원 session 만료 | 사용자가 정상 브라우저에서 재로그인 | 비밀번호·cookie를 전달하지 않음 |
| 운영 API 확인 | 운영기관에 질문서 발송 | 프로젝트가 초안을 만들고 발송 전 승인 |
| 활용신청·key | 사용자가 신청·약관을 확인하고 승인 | key 값은 문서·대화에 기록하지 않음 |
| PoC Dataset 확정 | Provider·운영기관이 권리·sandbox 승인 | 승인 전 payload 호출 금지 |
| 외부 상태 변경 | 신청·subscription·resource 생성·삭제 승인 | 작업 범위·정리계획을 먼저 제시 |

## 14. 일정·외부 대기 전제

### 14.1 제출 창구 대체 목표와 선례

`E-15`에 따라 2027년은 병행 시범·준비기간이고 2028년은 기존 제출 창구 대체 목표다. 연도 도달만으로 단계 0~7의 진입·종료조건이나 참가자별 `E-20` 조건을 충족한 것으로 보지 않는다. 기준일: 2026-08-03.

| 선례 | 판정 | 일정 근거 | 출처 |
| --- | --- | --- | --- |
| 부산·광주 준공영제 | `Verified` | 부산은 공포 뒤 약 9개월, 광주는 2024-05-31 공포 뒤 2024-12-01 시행까지 약 6개월의 준비기간을 둠 | [의무화·간주 규정 선례 조사 §8.1](../01-research/mandate-and-deeming-precedents.md#81-준비기간-선례), [부산광역시의회 회의록](https://council.busan.go.kr/assem/user/assem/minute/preView.busan?command=update&minuteSid=22522), [광주 조례](https://www.ulex.co.kr/%EB%B2%95%EB%A5%A0/1934603-2196172-%EA%B4%91%EC%A3%BC%EA%B4%91%EC%97%AD%EC%8B%9C%EC%8B%9C%EB%82%B4%EB%B2%84%EC%8A%A4), [광주 개정 의안](https://clik.nanet.go.kr/potal/search/searchView.do?DOCID=CLIKC481293014420275&collection=bill), 확인일 2026-08-02 |
| 폐기물 전자정보처리프로그램 | `Verified` | 폐기물관리법 제45조제3항은 2007-08-03 개정 뒤 2008-08-04 시행되어 약 12개월의 준비기간을 둠 | [의무화·간주 규정 선례 조사 §2.2](../01-research/mandate-and-deeming-precedents.md#22-일정-판정), [폐기물관리법 제45조제3항](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1030481523), 확인일 2026-08-02 |
| 인천 이행협약 | 사실 `Verified`·적용 `Inferred` | 2025-09-01 체결됐고 2년 주기 합의 개정을 규정하므로 2027년 9월 전 변경에는 조합과 별도 중도합의가 필요 | [의무화·간주 규정 선례 조사 §2.2](../01-research/mandate-and-deeming-precedents.md#22-일정-판정), [인천 이행협약 공개자료](https://www.incheon.go.kr/open/OPEN010201/beffatInfoPublictDetail?bbsNo=3003868), 확인일 2026-08-02 |

- **(Verified)** 6~9개월은 부산·광주 선례이며 전국 공식 통계가 아님
- **(Unverified)** 전국 자치법규 개정 소요기간의 공식 집계통계는 문서 미확인

### 14.2 외부 대기 항목

- **(완료조건)** DS 수신자료가 정산자료 제출로 인정되고, 미사용·장애·정정 시 효과가 규정된 상태
- **(경계)** 법규 공포만으로 완료 처리하지 않음

이 완료조건의 “DS 수신자료”는 데이터 스페이스가 payload를 수신·보관·중계한다는 뜻이 아니다.
`E-19`에 따라 Consumer로 온보딩된 기존 정산 시스템이 계약을 맺고 Provider Data Plane에서 PULL한 자료와 그 계약·감사 기록을 뜻한다.
Provider Data Plane은 참가자(Provider)의 전송 경계이며 source binding으로 운수사 원천에서 읽어 응답한다.

| ID | 외부 대기와 현재 판정 | 필요한 조치·완료 증거 | 담당 | 기한 | 근거 |
| --- | --- | --- | --- | --- | --- |
| `LEG-01` | 인천·광주 조례 개정 — `E-19` 채택으로 조례 개정 없이 세부기준 위임으로 처리할 여지가 있다는 판정. `Inferred`·조건부 불필요이며 법제심사 미확정은 `Unverified` | 법제심사 결과가 위임 범위 안의 처리 가능성을 확인하고 공통 완료조건을 충족 | 미정 | 미정 | [의무화·간주 규정 선례 조사 §5.2](../01-research/mandate-and-deeming-precedents.md#52-인천과-광주의-직접-명령위임), [인천 조례](https://www.ulex.co.kr/%EB%B2%95%EB%A5%A0/1802189-2191126-%EC%9D%B8%EC%B2%9C%EA%B4%91%EC%97%AD%EC%8B%9C%EC%8B%9C%EB%82%B4%EB%B2%84%EC%8A%A4), [광주 조례](https://www.ulex.co.kr/%EB%B2%95%EB%A5%A0/1934603-2196172-%EA%B4%91%EC%A3%BC%EA%B4%91%EC%97%AD%EC%8B%9C%EC%8B%9C%EB%82%B4%EB%B2%84%EC%8A%A4), 확인일 2026-08-02 |
| `RULE-02` | 서울·대전·부산·대구 규칙·운영·정산지침 개정. 현행 문서와 개정 권한 일부가 `Unverified` | 개정문서 승인과 공통 완료조건 충족 | 미정 | 미정 | [의무화·간주 규정 선례 조사 §5.1·§5.3](../01-research/mandate-and-deeming-precedents.md#51-도시별-개정-단위), 확인일 2026-08-02 |
| `AGR-03` | 6개 도시 협약·부속합의서와 특히 인천 중도합의가 `Unverified` | 당사자 합의문서 체결과 공통 완료조건 충족 | 미정 | 미정 | [의무화·간주 규정 선례 조사 §8.1](../01-research/mandate-and-deeming-precedents.md#81-준비기간-선례), [인천 이행협약 공개자료](https://www.incheon.go.kr/open/OPEN010201/beffatInfoPublictDetail?bbsNo=3003868), 확인일 2026-08-02 |

`RULE-02`의 한계는 다음과 같다.

- **(Unverified)** 서울 현행 시행협약·정산지침의 개정주체와 개정조항은 문서 미확인
- **(Unverified)** 대전에서 확인한 변경절차는 2020년본이며 현행 2023년 지침 전문은 문서 미확인 — [의무화·간주 규정 선례 조사 §5.3](../01-research/mandate-and-deeming-precedents.md#53-현행-문서-한계), `SRC-MAN-036`, 확인일 2026-08-02
- **(Unverified)** 부산 현행 협약·운영지침의 개정조항과 최종 결재선은 문서 미확인
- **(Unverified)** 대구 2025-09-22 현행 통합본문의 관련 조문은 최종 대조 전이므로 판정 불가

### 14.3 Gate와 온보딩 완료율

- **(Inferred)** `E-20`으로 전환 일정의 성격이 바뀐다. 기술적 온보딩이 끝나지 않은 참가자는 DS 경유 이행이 성립하지 않으므로 기존 경로 병행이 필수다. 따라서 2028년 전환은 날짜가 아니라 온보딩 완료율을 조건으로 판정해야 함 — 기준일: 2026-08-03
  - 완료조건: `OPEN-PRM-04`에서 완료율 분모·임계값·증거와 기존 경로 종료조건을 승인한 뒤 적용
- **(Decision)** 단계 0~7은 기술·운영 증거 Gate로 유지하고, 2028년 목표는 Gate 종료조건을 면제하지 않음 — 기준일: 2026-08-03
- **(Unverified)** 완료율의 분모·임계값·증거와 판정 주체는 미정이며 이 문서에서 결정하지 않음 — `DRV-01`~`DRV-04`

여기서 DS 경유 이행은 데이터 스페이스의 신원·Catalog·계약·정책·감사 흐름을 뜻한다. payload는 `E-19`의 Consumer가 `E-21`에 따라 Provider Data Plane에서 PULL하고, Data Plane이 source binding으로 운수사 원천에서 읽어 응답한다.

### 14.4 개정 이력

| 개정일 | 종전 상태 | 개정 내용 | 근거 결정 |
| --- | --- | --- | --- |
| 2026-08-03 | 선행 조사는 2027년 병행 시범과 기존 창구 종료 가능성을 함께 검토 | 2027년을 병행 시범·준비기간으로 두고 기존 제출 창구 대체 목표를 2028년으로 이동 | `E-15` |
| 2026-08-03 | `E-11` 후보가 초기 후보 순서 1위에 있었음 | `E-11`을 폐기하지 않고 초기 범위에서 제외해 확장 단계로 이동 | `E-17` |
| 2026-08-03 | 선행 조사는 인천·광주 조례 개정을 필요 조건으로 판정 | 기존 정산 시스템을 Consumer로 온보딩하는 구조에서 세부기준 위임 처리 여지가 있어 `LEG-01`을 조건부 불필요로 변경하되 법제심사 미확정을 유지 | `E-19` |
| 2026-08-04 | 2026-08-03 개정에서 Consumer가 원천 token·signed URL로 원천에 직접 접근하는 서술을 잘못 추가 | Consumer는 계약 범위에서 Provider Data Plane에 접근해 PULL하고 Data Plane이 source binding으로 원천에서 읽어 응답하는 경로로 정정 | `E-21` |

### 14.5 산정 입력

달력 일정은 다음 외부 대기와 개발 작업을 분리한 뒤 정한다.

- 운영기관 담당부서 식별과 공식 회신
- metadata·subscription·identity API 명세·sandbox 확보
- 지원 hostname·DNS·TLS·망·방화벽 확인
- Provider·license·proxy·cache·credential 권리 검토
- Connector/CaaS spike와 확장 개발량
- 공공망·보안영역 인프라와 보안성 검토
- test quota, source 장애·삭제 시뮬레이션 승인
- 법무·개인정보·공간정보 검토 lead time

승인 대기시간을 개발기간에 숨기지 않는다.

## 15. Definition of Done

단계 완료에는 문서와 코드 외에 다음 증거가 필요하다. 이 증거 목록은 단계 0~7의 완료 판정이며, 참가자별 “기술적 온보딩 완료”의 기준과 판정 주체를 확정하지 않는다.

- 담당 owner와 승인자
- 재현 가능한 command 또는 procedure
- machine-readable 결과와 human review 기록
- source, schema, policy, Connector와 platform version
- Agreement·Transfer·external resource·source request·cleanup correlation
- 실패·중복·restart·reconciliation 결과
- secret·개인정보 노출 검사
- 운영 중단·복구·회수 runbook
- 요구사항·test·source evidence 추적
- 알려진 제한과 잔여위험 승인

## 16. 미확인 사항과 결정 요청

| ID | 파생 ID | 상태 | 미확인 사항 또는 결정 요청 | 영향 | 담당 | 기한 | 종료 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN-PRM-01` | `DRV-01` | `Unverified` | “기술적 온보딩 완료”의 판정 기준과 증거. 참가자 수준 종단시험 절차가 필요 | `E-20`의 세 번째 조건 판정 불가 | 미정 | 미정 | 판정 기준·증거와 참가자 수준 종단시험 절차 승인 |
| `OPEN-PRM-02` | `DRV-02` | `Unverified` | 완료 판정 주체 — 운영자·정산주체·제3자 중 미정 | 제출 이행 승인 권한 판정 불가 | 미정 | 미정 | 판정 주체와 이의·재판정 절차 승인 |
| `OPEN-PRM-03` | `DRV-03` | `Unverified` | 세 조건의 충족 상태를 기계 판독 가능하게 표현하고 감사 기록으로 남기는 방법 | 자동 판정과 사후 감사 방식 미정 | 미정 | 미정 | 상태 표현·감사 schema와 검증 절차 승인 |
| `OPEN-PRM-04` | `DRV-04` | `Unverified` | 온보딩 미완료 참가자는 DS 경유 이행이 성립하지 않으므로 **기존 경로 병행이 필수**. 전환 일정(`E-15`)은 온보딩 완료율에 종속 | 2028년 제출 창구 대체 판정 기준 미정 | 미정 | 미정 | 완료율 분모·임계값·증거와 기존 경로 종료조건 승인 |
| `OPEN-PRM-05` | `LEG-01` | `Unverified` | 인천·광주 조례 개정의 조건부 불필요 판정에 대한 법제심사 미확정 | 하위 세부기준만으로 제출 인정 효과를 둘 수 있는지 판정 불가 | 미정 | 미정 | 법제심사 결과와 근거 조문 기록 |
| `OPEN-PRM-06` | `RULE-02` | `Unverified` | 서울·대전·부산·대구 현행 규칙·운영·정산지침과 개정문서 미확보 | 도시별 제출 인정·장애·정정 효과 판정 불가 | 미정 | 미정 | 현행 원문·개정 권한·승인본과 공통 완료조건 증거 확보 |
| `OPEN-PRM-07` | `AGR-03` | `Unverified` | 6개 도시 협약·부속합의서와 인천 중도합의 미체결 | 실제 사용의무·전환일정·책임분담 확정 불가 | 미정 | 미정 | 서명된 합의문서와 공통 완료조건 증거 확보 |
