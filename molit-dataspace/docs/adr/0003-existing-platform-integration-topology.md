# ADR-0003: 기존 플랫폼 Bridge를 우선 연구·실증한다

작성일: 2026-07-11  
상태: Accepted  
결정 범위: 연구 기준선과 PoC 방향  
결정권자: 프로젝트 의뢰자

## 1. 목적과 결정 요약

연구와 첫 PoC의 기준축으로 `Platform-to-Dataspace Bridge`를 채택한다. 통합채널 전체에 단일 배치 방식을 적용하지 않고 Dataset과 delivery path별 증거로 배치 방식을 결정한다.

이 프로젝트의 대상은 국토교통 데이터를 새로운 저장소에 모으는 일이 아니다. 기존 Data Lake, Data Hub와 통합 플랫폼의 기능을 데이터 스페이스에 연결한다.

연결 범위에는 metadata, API, 파일과 구독이 들어간다. 기존 운영 절차도 Offering·계약·전송 절차에 맞춰 연결한다.

MDS–Mobilithek 사례에서 MDS는 인증·metadata 게시·검색을 맡는다. Mobilithek은 hosted 또는 brokered한 적격 데이터의 구독과 전달을 수행한다.

- MDS의 계약 체결·종료는 Mobilithek subscription의 활성화·삭제에 연결된다.
- MobiData BW는 자체 Connector로 MDS를 추가 제공 채널로 사용한다.
- 근거는 `SRC-CASE-001`, `SRC-CASE-002`, `SRC-CASE-003`이다.

현재 국토교통 통합채널 조사에서는 metadata 검색, 원천 링크, 회원용 Open API 안내를 확인했다. 통합채널이 payload를 직접 host하거나 구독을 broker한다는 일반 증거는 아직 없다. 근거: `SRC-MOLIT-001`, `SRC-MOLIT-003`, `SRC-MOLIT-009`.

## 2. 결정

연구와 첫 PoC의 기준축을 `Platform-to-Dataspace Bridge`로 정한다.

1. 기존 플랫폼을 system of record로 유지한다.
2. Dataset과 delivery path마다 플랫폼 역할을 `hosted`, `brokered`, `index-only`, `unknown`으로 판정한다.
3. hosted·brokered 데이터는 플랫폼 자체 Connector, 플랫폼 옆 Bridge+Connector 또는 CaaS로 full lifecycle Offering을 만드는 방식을 우선 검토한다.
4. index-only 데이터는 discovery-only로 남기거나 실제 원천기관 Provider Connector에 연결한다.
5. Bridge는 metadata mapping뿐 아니라 Agreement-to-entitlement·subscription, token·접근제어목록(Access Control List, ACL)·snapshot 생성·회수와 reconciliation을 포함한다.
6. Catalog Broker는 Provider Offering을 연합할 필요가 확인됐을 때 선택적으로 추가한다.
7. Connector 제품, CaaS 사업자, identity와 transfer profile은 이 ADR에서 결정하지 않는다.

## 3. 배치 선택지는 열어 둔다

| 선택지 | 적용 조건 |
| --- | --- |
| 플랫폼 자체 Connector | 플랫폼이 Provider 권한, source·subscription 기능과 운영역량을 가짐 |
| 플랫폼 옆 Bridge+Connector | 플랫폼 변경을 줄이면서 API로 metadata·접근 수명주기를 제어 가능 |
| CaaS+플랫폼 Adapter | 기관이 Connector를 직접 운영하기 어렵고 tenant·secret·망 조건을 만족 |
| 원천기관별 Connector | 통합채널이 index-only이고 원천기관이 직접 Provider가 되어야 함 |
| 중앙 Catalog Broker | 여러 Provider Catalog를 한 검색 경로로 연합할 가치가 있음 |
| Discovery-only | 전달권한·Distribution·DataService 또는 회수수단이 없음 |

국토교통 통합채널 전체에 하나의 선택지를 일괄 적용하지 않는다. 데이터셋 또는 플랫폼 기능군별로 선택한다.

## 4. 제외한 접근

### 4.1 통합채널의 모든 record를 Offering으로 변환

기관·시스템·활용자료와 원천 링크가 섞여 있고 실제 Distribution이 없는 record가 존재한다. 검색 가능성과 계약·전송 가능성을 혼동하므로 제외한다.

### 4.2 원천기관별 Connector를 기본 의무로 지정

플랫폼이 적법하게 host·broker할 수 있는 데이터까지 기관별 배포로 분할한다. Mobilithek형 플랫폼 연계를 조사하려는 목적과 맞지 않으므로 기본안에서 제외한다.

### 4.3 중앙 Connector가 모든 원천을 대리

계약·재제공·credential 사용 권한과 tenant 격리 없이 사용할 수 없다. 위임이 확인된 Dataset의 선택지로만 남긴다.

### 4.4 metadata federation만으로 완료 선언

Agreement, source binding, 전송과 종료 후 회수를 검증하지 못한다. Discovery 실증으로 별도 기록한다.

## 5. 결과

### 5.1 긍정적 결과

- 기존 플랫폼의 데이터와 운영 절차를 재사용한다.
- Mobilithek형 사례와 같은 기준으로 국내 플랫폼을 비교할 수 있다.
- metadata 연계와 실제 Offering 연계를 분리해 과장된 완료 선언을 막는다.
- 플랫폼이 host·broker할 수 있는 경우 기관별 Connector 수를 줄일 수 있다.
- Agreement와 platform subscription의 불일치를 시험 가능한 문제로 다룬다.

### 5.2 비용과 제약

- Connector뿐 아니라 플랫폼 API와 권리·운영 문서를 조사해야 한다.
- DSP 상태와 플랫폼 상태 사이의 orchestration·보상·reconciliation이 필요하다.
- 동일 플랫폼 안에서도 데이터셋별 역할과 권리가 달라 onboarding 비용이 든다.
- 통합채널이 index-only라면 full lifecycle PoC를 다른 원천 플랫폼에서 먼저 수행할 수 있다.
- 운영기관이 subscription·identity API를 제공하지 않으면 자동화 수준이 낮아진다.

## 6. 검증

다음 시험을 모두 통과해야 full lifecycle bridge PoC로 인정한다.

1. 플랫폼 record의 수정·삭제가 Offering에 반영된다.
2. 승인되지 않은 record에는 DSP Offer를 만들지 않는다.
3. Contract Negotiation의 `FINALIZED` Event에 대한 확인 응답(Acknowledgement, ACK)이 교환되기 전에 source 또는 subscription을 사용하지 않는다.
4. Agreement를 교환·검증하고 Contract Negotiation의 `FINALIZED` 메시지까지 ACK한 뒤 entitlement·subscription·token·snapshot 중 필요한 자원을 멱등하게 만든다.
5. Transfer 완료·종료 후 Transfer scope 자원을 회수하고, local Agreement 만료·철회·해지 후 Agreement scope subscription·entitlement를 회수한다.
6. callback 유실과 Connector restart 뒤 Reconciler가 orphan resource를 찾아 정리한다.
7. Agreement, Transfer, platform resource와 source request가 감사 ID로 연결된다.
8. 공개 license와 Offering policy가 충돌하지 않는다.

## 7. 재검토 조건

- 통합채널이 공식적으로 중앙 Provider 또는 Broker 권한과 lifecycle API를 제공함
- 대상 데이터가 모두 원천기관 직접 계약만 허용함
- 플랫폼 API로 subscription·token 회수를 구현할 수 없음
- CaaS 또는 Connector 제품이 필요한 southbound 확장점을 제공하지 못함
- 법령·약관·보안정책이 gateway·proxy·cache·identity 대행을 금지함
- PoC 결과에서 상태 동기화 비용이 편익을 초과함

## 8. 관련 문서

- [MDS–Mobilithek 참조 사례](../01-research/mds-mobilithek-reference-case.md)
- [국토교통 통합채널 역량 프로필](../01-research/molit-platform-capability-profile.md)
- [Platform-to-Dataspace Bridge](../02-architecture/platform-connector-bridge.md)
- [Offering 수명주기](../02-architecture/offering-onboarding-lifecycle.md)
- [PoC 후보 목록](../03-plan/poc-candidate-shortlist.md)
