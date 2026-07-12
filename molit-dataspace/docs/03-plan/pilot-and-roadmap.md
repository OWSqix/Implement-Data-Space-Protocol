# 실증과 로드맵

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

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
  -> Transfer Process와 payload 접근
  -> Transfer 완료·종료와 단기자원 회수
  -> Agreement 해지·Dataset 철회와 장기자원 회수
  -> reconciliation
```

metadata만 동기화하면 Discovery Bridge PoC다. Agreement와 실제 플랫폼 접근 수명주기까지 연결해야 Full Offering Bridge PoC다. 두 결과를 같은 완료로 보고하지 않는다.

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

| 순위 | 후보 | 사용 목적 | 현재 상태 |
| ---: | --- | --- | --- |
| 1 | 통합채널 hosted·brokered 공개 Dataset | Mobilithek형 full lifecycle | 대상 미식별, 운영기관 증거 필요 |
| 2 | 분석 데이터셋 metadata `GET` | Discovery Bridge | 설계 가능, endpoint·HTTPS 확인 전 실행 차단 |
| 3 | ITS 표준 노드·링크 파일 | finite snapshot fallback | 권리·source 계약 필요 |
| 4 | 통계누리 공개 통계 REST | REST gateway fallback | proxy·credential·quota 확인 필요 |
| 5 | ITS 교통소통 REST | 실시간성·freshness 후속시험 | quota·version 확인 필요 |
| 6 | VWorld 공개 WFS/WMS | 공간 query 정책 후속시험 | layer 권리·보안등급 확인 필요 |

근거와 제외조건은 [PoC 후보 목록](poc-candidate-shortlist.md)에 기록한다.

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
- direct·gateway·snapshot transfer profile
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
5. pull `dataAddress`를 포함한 Transfer Start와 Consumer ACK 뒤 payload를 읽는다.
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
3. metadata 한 건을 게시하고 실제 payload를 한 번 전달한다.
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

## 14. 일정 산정 전제

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

단계 완료에는 문서와 코드 외에 다음 증거가 필요하다.

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
