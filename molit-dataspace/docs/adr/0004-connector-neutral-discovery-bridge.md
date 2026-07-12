# ADR-0004: Connector 중립 Discovery Bridge부터 구현

작성일: 2026-07-11  
상태: Accepted

## 1. 목적과 맥락

국토교통 통합채널의 검색·metadata 화면은 확인했으나 운영용 hostname, stable ID, delta·delete, server-to-server 인증과 payload hosting·brokerage는 확인하지 못했다. Connector 제품과 배포환경도 선택하지 않았다.

실제 운영 endpoint나 특정 Connector 객체부터 구현하면 미확인 interface와 제품 model이 Bridge domain에 고정된다. 반대로 문서 검토만 계속하면 분류·Gate·증분동기화의 결함을 실행으로 확인할 수 없다.

## 2. 결정

첫 구현 슬라이스를 합성 fixture 기반 Connector 중립 Discovery Bridge로 정한다.

- Node.js 24 ESM과 내장 test runner 사용
- metadata batch의 baseline·delta·명시적 tombstone 계약 구현
- Dataset·비-Dataset과 `hosted·brokered·index-only·unknown` 분류
- Provider·권리·Distribution·source binding·revoke evidence Gate
- source mapping, version, 판정과 제품 중립 등록 후보 영속화
- 합성 approval registry의 source record digest 승인과 공개범위 분리
- occurrence sequence, supersede와 pending 정렬을 가진 local outbox 생성
- upsert·review command에 approval Gate를 기록하고 검토 직전 registry·config·clock 재검증
- 승인된 원천 snapshot에서 active projection을 다시 생성하고 outbox ID·payload digest 검증
- executable JSON Schema와 semantic Gate 이중 검증
- 모든 outbox의 자동 dispatch 금지
- 운영 플랫폼 API와 DSP Connector 호출 금지

`catalogProjection`은 DCAT 지향 프로젝트 초안으로 표시한다. DSP wire message, 완전한 ODRL Offer 또는 Connector Management API payload로 취급하지 않는다.

## 3. 대안

### 3.1 운영 통합채널 API부터 연계

지원 endpoint와 인증 계약이 확인되지 않아 제외한다. browser 내부 API와 개인 session을 운영 연계로 고정할 위험이 있다.

### 3.2 EDC runtime부터 조립

Connector 후보 Spike에는 필요하지만 첫 단계에서는 제외한다. Platform Bridge의 canonical model과 제품 adapter 경계를 먼저 고정한다.

### 3.3 Full Lifecycle mock을 한 번에 구현

metadata Gate, DSP 상태와 플랫폼 entitlement 오류가 한 단계에 섞이므로 제외한다. Discovery 동기화와 외부 자원 수명주기를 별도 Gate로 검증한다.

## 4. 결과

### 4.1 이점

- 운영 credential 없이 분류·수렴·차단 규칙을 반복 시험할 수 있다.
- Connector 제품을 교체해도 canonical model과 source mapping을 유지할 수 있다.
- index-only record가 DSP Offering으로 승격되는 오류를 코드에서 차단한다.

### 4.2 비용과 제한

- 합성 fixture 통과는 운영 플랫폼 연계를 증명하지 않는다.
- JSON 상태 저장은 단일 process PoC에만 사용한다.
- JSON rename은 전원 손실 durability와 state·report 간 transaction을 보장하지 않는다.
- state digest는 우발적 손상 탐지용이며 keyed integrity나 서명을 제공하지 않는다.
- review assessment는 실행 권한이나 queue claim이 아니며 실제 applied Connector 자원 ledger가 없다.
- publication·candidate history marker는 state 자체 주장이라 delete·withdraw 실행 근거로 사용할 수 없다.
- Connector adapter와 Full Lifecycle 구현 전에는 DSP 상호운용 결과가 없다.

## 5. 후속 결정

- Connector·CaaS 제품과 version
- policy registry와 Connector 객체 mapping
- transactional outbox와 운영 database
- provisioning hook과 Agreement·Transfer trigger
- 실제 metadata source adapter와 service identity

## 6. 관련 문서

- [Discovery Bridge 구현](../04-implementation/discovery-bridge.md)
- [실증·로드맵](../03-plan/pilot-and-roadmap.md)
- [기존 플랫폼 인터페이스 계약](../02-architecture/platform-interface-contract.md)
- [기존 플랫폼 연계 토폴로지](0003-existing-platform-integration-topology.md)
