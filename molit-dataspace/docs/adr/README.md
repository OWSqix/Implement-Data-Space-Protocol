# Architecture Decision Records

작성일: 2026-07-12  
상태: Active

## 1. 목적

아키텍처 결정의 맥락, 선택지, 근거, 결과와 재검토 조건을 기록한다. 설계 문서가 현재 구조를 설명한다면 ADR은 왜 그 구조를 선택했는지 보존한다.

## 2. 상태

- `Proposed`: 검토 중
- `Accepted`: 결정권자 승인
- `Rejected`: 채택하지 않음
- `Superseded`: 후속 ADR로 대체
- `Deprecated`: 신규 적용 중단

Accepted ADR의 내용은 본문을 수정해 바꾸지 않는다. 결정이 바뀌면 새 ADR을 만들고 `Superseded by`를 연결한다. 오탈자·링크 수정은 가능하다. `Proposed` 단계에서 Accepted 없이 후속 ADR로 대체된 경우에도 `Superseded`로 표기할 수 있으며, 이때 본문에 Accepted 이력이 없었다는 사실을 남긴다.

`Proposed` ADR의 결정 문안을 제자리 개정하면 template §8에 작성일·사유·이전 문안과의 차이를 기록하고 목록의 개정일을 갱신한다.

## 3. 목록

| ADR | 제목 | 상태 | 개정일 |
| --- | --- | --- | --- |
| [0001](0001-federated-provider-model.md) | 중앙 Catalog Broker와 원천기관 Provider 혼합형 | Superseded | — |
| [0002](0002-data-stays-at-source.md) | 원천 유지와 adapter 기반 전달 | Accepted | — |
| [0003](0003-existing-platform-integration-topology.md) | 기존 플랫폼 Bridge를 우선 연구·실증 | Accepted | — |
| [0004](0004-connector-neutral-discovery-bridge.md) | Connector 중립 Discovery Bridge부터 구현 | Accepted | — |
| [0005](0005-dcat-ap-3-profile-baseline.md) | DCAT-AP 3.0.1을 metadata profile 기준으로 고정 | Accepted | — |
| [0006](0006-selective-notary-evidence.md) | 선별적 notary 증적 체제 | Proposed | 2026-08-01 |
| [0007](0007-governance-function-separation.md) | 거버넌스 기능 3분리와 2계층 DSGA | Proposed | 2026-08-06 |
| [0008](0008-provider-default-and-existing-system-participation.md) | Provider 기본값과 기존 시스템 참여 | Proposed | — |

## 4. 후속 후보

- Connector·CaaS 구현과 version
- Catalog Broker 필요 여부와 구현 방식
- 플랫폼 Dataset·delivery path별 `hosted·brokered·index-only·unknown` 판정 승인
- Dataset별 Agreement-to-subscription provisioning trigger 승인. trigger 선택지 자체는 [Offering 온보딩과 접근 수명주기](../02-architecture/offering-onboarding-lifecycle.md) §5.3과 `FR-PLT-005`가 정본이며, 이 ADR은 Dataset·플랫폼별 예외와 승인 절차를 다룬다.
- production identifier namespace
- metadata profile 운영 URI와 owner, ODRL profile
- ADR 작성자는 [DEF 색인](../01-research/dssc-gap-register.md#32-이월-색인-정본)의 선행 조건이 충족되면 DEF-04 identity 4요소 또는 DEF-08 secure analysis·유상 과금의 결정·시험·rollback을 ADR로 기록하고 두 색인을 연결
- REST·file·OGC transfer profile
- cache·snapshot·보존정책
- 플랫폼 자체·CaaS·기관별 Connector의 운영모델
- 증적 법적·계약적 근거 확인 후 [ADR-0006](0006-selective-notary-evidence.md) 재검토
- 분리 원칙의 목표 아키텍처 통합 — [ADR-0007](0007-governance-function-separation.md) 승인 뒤 §3·§4 반영

새 ADR은 [template.md](template.md)를 복사해 작성한다.
