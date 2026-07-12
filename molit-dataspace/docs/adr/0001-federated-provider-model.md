# ADR-0001: 중앙 Catalog Broker와 원천기관 Provider 혼합형

작성일: 2026-07-11  
상태: Superseded  
대체: [ADR-0003](0003-existing-platform-integration-topology.md)  
결정권자: 미지정

## 1. 결정 상태와 대체 범위

이 ADR의 기본 토폴로지 결정은 [ADR-0003](0003-existing-platform-integration-topology.md)으로 대체됐다. 중앙 Catalog Broker와 원천기관 Provider 혼합형은 기본 구조가 아니라 조건부 배치 선택지로 유지한다.

이 ADR은 `Accepted` 단계 없이 `Proposed` 상태에서 대체됐다. 결정권자 승인 이력이 없으므로 이 문서를 승인된 기본 구조의 근거로 인용하지 않는다.

국토교통 데이터 통합채널은 여러 기관·시스템의 데이터 소재와 metadata를 검색한다. 실제 payload는 통계누리, 지능형교통체계(Intelligent Transport Systems, ITS), VWorld, 공공데이터포털과 기관 자체 시스템에서 제공되고 권리·API·품질·장애 책임도 원천별로 다르다.

이 관찰에서 다음 기본안을 제안했다.

1. 통합채널은 중앙 DSP Catalog Broker가 된다.
2. 원천기관은 각자 Provider Connector를 운영한다.
3. 중앙 대행 Provider는 명시적 위임이 있는 자산만 맡는다.

이 제안은 통합채널이 원천 데이터 제공권한을 자동으로 갖는다는 오류를 피하고, DSP Catalog Broker의 upstream policy·provenance 보존 원칙을 적용하려는 것이었다. 근거: `SRC-MOLIT-001`, `SRC-MOLIT-002`, `SRC-MOLIT-003`, `SRC-TECH-001`.

## 2. 대체 근거

이 토폴로지는 가능한 선택지이지만 플랫폼 역할을 조사하기 전에 연구 범위를 고정했다.

- 기존 플랫폼이 payload를 host하거나 broker하는 경우 플랫폼 자체가 하나의 Provider Gateway로 참여할 수 있다.
- Mobilithek 사례는 원 제공기관마다 Connector를 설치하는 방식이 아니라 플랫폼 단위 Offering·subscription bridge를 보여준다.
- 통합채널의 Dataset과 delivery path가 `hosted`, `brokered`, `index-only`, `unknown` 중 어디에 해당하는지는 조사 결과여야 한다.
- Catalog Broker는 이미 존재하는 Provider Offering을 연합한다. legacy record에 Offering과 전달경로를 만들어 주지는 않는다.
- 원 데이터 보유기관, DSP Offering Provider와 Connector 운영자는 항상 같은 조직이 아니다.

따라서 “통합채널 Broker+기관별 Provider”를 기본안으로 두지 않고 [ADR-0003](0003-existing-platform-integration-topology.md)의 배치 선택지 중 하나로 내린다.

## 3. 유효 제약

- 중앙기관이 모든 Dataset의 제공권한을 자동으로 가진다고 가정하지 않는다.
- 위임받은 Provider는 계약·재제공·credential 사용 권한 증거를 가져야 한다.
- Catalog Broker는 upstream visibility, proof 요구, Offer 의미, Provider endpoint와 provenance를 약화하지 않는다.
- 제한 데이터의 존재와 상세 schema를 자격 없는 소비자에게 노출하지 않는다.
- Provider와 source별 장애·quota·secret을 격리한다.

## 4. 재채택 조건

다음 조건에서는 중앙 Broker와 원천기관 Connector 혼합형을 다시 선택할 수 있다.

- 통합채널이 대부분 `index-only`이며 payload host·broker 권한이 없다.
- 원천기관이 Provider와 계약 당사자로 남아야 한다.
- 기관별로 Connector 또는 CaaS를 운영할 역량과 예산이 있다.
- 중앙 검색 경험이 필요하고 Provider local Catalog를 연합할 수 있다.
- Broker 장애 때 Provider direct discovery 또는 복구 경로가 있다.

선택 시 별도 ADR에서 대상 기관, Connector 운영모델, Broker 구현과 SLO를 확정한다.

## 5. 근거

- `SRC-MOLIT-001`, `SRC-MOLIT-002`, `SRC-MOLIT-003`
- `SRC-TECH-001`, `SRC-TECH-002`
- `SRC-LAW-001`, `SRC-LAW-009`
- `SRC-CASE-001`, `SRC-CASE-002`
