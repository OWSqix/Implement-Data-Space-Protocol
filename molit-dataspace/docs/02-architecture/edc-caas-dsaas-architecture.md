# EDC 기반 CaaS·DSaaS 구성 설계

목적: 국토교통 데이터 스페이스의 Connector 실행 계층과 운영 제어 계층을 분리하고, 각 계층의 책임과 시험 범위를 고정한다.
작성일: 2026-07-13
개정일: 2026-08-03
관련 결정: `E-19`, `E-20`
상태: 구현 기준선 확정, 실운영 인프라와 기관 승인은 미확정

## 1. 적용 기준선

Connector 기준선은 Eclipse Dataspace Components 0.18.0이다. 소스 기준점은
`eclipse-edc/Connector`의 `911a22ba6b90688ffeb35bb92bf5cc040ffdf37f` 커밋이다.
해당 릴리스는 2026년 6월 30일에 공개됐다. 근거는 [EDC 0.18.0 릴리스](https://github.com/eclipse-edc/Connector/releases/tag/v0.18.0)이며, 확인일은 2026년 7월 13일이다.

프로토콜 기준선은 Dataspace Protocol 2025-1이며, 로컬 검증 묶음은 Errata 1 snapshot에 고정한다. 격리형 EDC 관리 API는 v4를 사용한다. 가상화형의 `/v5beta/participants/{participantContextId}` 경로는 운영 기준선에 넣지 않는다.

EDC는 완제품 Connector가 아니다. 필요한 모듈을 묶어 Control Plane과 Data Plane 배포판을 직접 만들어야 한다. 따라서 EDC 버전만 적은 배포 문서는 재현 가능한 배포 사양이 아니다. Gradle 의존성, EDC 소스 커밋, 컨테이너 기반 이미지, 설정 Schema를 함께 고정한다.

## 2. 계층 분리

국토교통 데이터 스페이스는 다음 다섯 계층으로 구성한다.

| 계층 | 책임 | 맡지 않는 책임 |
| --- | --- | --- |
| EDC Connector | Catalog, 계약 협상, 전송 상태, Data Plane 제어 | 원천 플랫폼 메타데이터 변환 |
| CaaS | Connector 인스턴스 배포·중지·상태 수렴 | DSP 계약 판단, 참가 승인 |
| DSaaS | 데이터 스페이스 정의, 서비스 기준선, 참가 승인, CaaS 조정 | 참가자 데이터 열람, Data Plane 대행 |
| Platform Bridge | 원천 메타데이터를 MOLIT DCAT-AP와 EDC Offering으로 변환 | DSP wire protocol 구현 |
| Provider transfer worker | 승인된 전송에 필요한 원천 플랫폼 자원 발급·회수 | DSP endpoint, 데이터 바이트 프록시 |

관리 API와 DSP endpoint는 같은 경로로 노출하지 않는다. Bridge, CaaS, DSaaS는 EDC 관리면의 클라이언트다. 외부 Connector가 호출하는 경로는 DSP endpoint다.

## 3. 배포 단위

### 3.1 격리형 Connector

초기 운영은 참가자마다 Control Plane, Data Plane, 데이터베이스, Vault 경계를 분리한다. 한 참가자의 설정 오류와 저장소 장애가 다른 참가자에게 번지지 않는다. 인프라 비용은 늘지만 장애 범위와 감사 대상을 설명하기 쉽다.

CaaS의 `isolated` plan은 이 배포 방식을 뜻한다. CaaS tenant와 데이터 스페이스 참가 신청은 같은 객체가 아니다. 다음 식별자를 각각 보관한다.

- 법적 기관 식별자 `organizationId`
- CaaS 내부 tenant 식별자 `caasTenantId`
- DSP와 DCP에 사용하는 `connectorParticipantId`
- 참가자별 Connector namespace `connectorNamespace`
- 데이터 스페이스 내부 신청 식별자 `participantId`

서로 의미가 다른 식별자를 한 필드에 넣지 않는다. DSaaS가 CaaS에 수렴을 요청할 때 다섯 값을 함께 보내고, CaaS는 사전 등록값과 정확히 비교한다.

공통 감사 ID는 현행 식별자 목록에 포함하지 않고 Proposed 후보로 분리한다.

| 후보 식별자 | 상태 | 준거 |
| --- | --- | --- |
| 공통 감사 ID | 후보 — ADR-0006 Proposed | 이 절의 식별자 분리 원칙 |

### 3.2 가상화형 Connector

EDC Virtual-Connector는 `participantContextId`를 경계로 여러 참가자를 한 Control Plane에 수용하는 개발 경로다.

2026년 7월 13일 현재 독립 안정 릴리스가 없고 0.18.0 snapshot 계열을 사용한다. 근거는 [공식 Virtual-Connector 저장소](https://github.com/eclipse-edc/Virtual-Connector)다.

관리 API는 OAuth2 access token의 참가자 context와 역할을 확인한다. 데이터베이스 질의와 Vault 경로도 같은 context에 묶어야 한다.

가상화형 배포는 기본값으로 채택하지 않는다. EDC Virtual-Connector의 보안 경계, participant context 필터, Vault 격리, 장애 복구, 부하 시험을 별도 통과한 뒤 `virtualized` plan을 연다. 현재 저장소의 기본 plan은 `isolated`다.

## 4. CaaS 제어면

CaaS는 사전 등록된 tenant의 desired state를 배포 상태로 수렴시킨다.

```text
NOT_PROVISIONED
  -> PROVISIONING -> PROVISIONED
  -> SUSPENDING -> SUSPENDED
  -> DELETING -> DELETED
  -> DEPROVISIONING -> NOT_PROVISIONED (legacy)
```

현행 상태 계약은 보존과 삭제를 `SUSPENDED`와 `DELETED`로 구분한다. `DEPROVISIONED`는 기존 호출 호환을 위한 legacy 상태로만 유지한다.

DSaaS 상태는 다음과 같이 번역한다.

| DSaaS 요청 | CaaS desired state | 실제 provisioner 수렴 응답 |
| --- | --- | --- |
| `ACTIVE` | `PROVISIONED` | `ACTIVE` |
| `SUSPENDED` | `SUSPENDED` | `SUSPENDED` |

**(정본 선택 근거: B-02)** `caas-control-plane.md`의 현행 수명주기 계약과 CaaS 구현이 `SUSPENDED`·`DELETED`를 구분하고 `DEPROVISIONED`를 legacy 호환으로 유지하므로 그 상태 경계를 따른다.

위 마지막 열은 실제 배포 자원을 재관찰하는 provisioner 기준이다. 현재 `dry-run-manifest`는 배포 의도 파일만 확인하므로 `ACTIVE` 요청에도 `PROVISIONING`을 반환하고 내부 관찰 상태를 `INTENT_READY`로 둔다.

`POST /v1/connectors/ensure`는 새 기관을 임의 등록하지 않는다. tenant onboarding이 먼저 끝나 있어야 한다. 요청의 plan, 기관 식별자, 참가자 식별자, namespace, 메타데이터 프로파일, 프로토콜 프로파일이 등록값과 다르면 배포하지 않는다.

DSaaS는 CaaS 관리자 credential을 공유하지 않는다. 전용 controller identity는 `connectors/ensure`만 호출할 수 있고, CaaS 설정에 고정한 dataspace·tenant·Connector plan 범위를 벗어나면 `403`으로 차단한다.

배포 Adapter는 인터페이스로 분리한다. 저장소에 포함된 manifest Adapter는 desired state를 배포 의도로 직렬화한다. Kubernetes나 클라우드 API를 직접 호출하는 Adapter는 별도 운영 패키지로 구현하고, 멱등 키와 fencing을 지원해야 한다.

## 5. DSaaS 제어면

DSaaS가 보관하는 대상은 데이터가 아니라 운영 의도와 승인 증거다.

- 데이터 스페이스 ID와 운영기관
- 적용할 MOLIT DCAT-AP 버전과 digest
- 거버넌스 묶음 버전과 digest
- DSP 버전과 신원 모델
- 필요한 CaaS·Identity Hub·Catalog 서비스
- 참가 신청, 승인자, 증거 digest
- CaaS Connector 관측 상태
- hash chain 감사 사건

데이터 스페이스는 필요한 서비스가 모두 `READY`이고, 승인된 참가자의 Connector가 desired state에 도달했을 때만 `ACTIVE`가 된다.

서비스 Registry가 비었거나 digest가 다르거나 필수 서비스가 `NOT_READY`·`STALE`이면 `BLOCKED`로 둔다. 활성 Connector에는 CaaS `SUSPENDED`를 요청한다.

현재 runtime은 시작 시 config에 Registry digest를 고정한다.

새 Registry snapshot과 승인된 config manifest를 함께 배포하고 process를 재시작해 새 digest 검증에 성공한 뒤에만 `ACTIVE`를 다시 요청한다. 서명 trust anchor를 이용한 무중단 Registry 갱신은 아직 지원하지 않는다.

참가 신청자와 승인자는 달라야 한다. 승인 입력의 `evidenceSha256`은 신청 시 고정한 증거 digest와 같아야 한다. 관리자 권한만으로 증거 digest를 바꾸면서 승인할 수는 없다.

### 5.1 notary 배치 선행 요건과 옵션 비교 축

이 절은 [ADR-0006](../adr/0006-selective-notary-evidence.md)이 제안한 증적 체제의 배치 요건과 비교 축을 등록한다. 세 옵션 가운데 배치 위치를 선택하지 않는다.

배치 비교 전에 다음 notary record 요건을 정의한다. 2026-08-01 부분 충족 기록은 스키마 충족과 열람 절차 정의이며, 주체별 권한·민감도·보존은 미확정이다.

- record 스키마: 서명 hash·시각·공통 감사 ID만 포함하고 당사자·자산 식별정보는 제외. schema artifact와 version은 후속 구현에서 고정
- record와 필드별 민감도 등급
- 열람: 정기 정산은 회원약정 사전 동의 범위에서 자동 제출하고 범위 밖·감사·분쟁은 건별 법적 근거 확인. 거래 당사자·제3자·운영자의 주체별 권한은 미정
- 원본 record·대사 결과·backup의 보존 범위

DSaaS는 §5에 정의된 운영 의도·승인 증거 외에 hash chain 감사 사건을 보관한다. notary record가 서명 hash와 증적 metadata로 한정되면 기존 보관 범위와 양립할 가능성이 있으나 record 스키마와 열람 경계가 없으므로 판정하지 않는다.

위 문단의 `record 스키마와 열람 경계가 없다`는 판단은 논리 필드 목록이나 개봉 절차 초안이 없다는 뜻이 아니다. 실행에 고정된 schema artifact·version과 집행 가능한 주체별 열람 권한이 없다는 뜻이며, 부분 충족 기록과 배치 미판정을 함께 유지한다.

| 옵션 | §2의 참가자 데이터 비열람 책임과 정합 | 거래 관계망 노출 범위 | 운영 주체 요건 | 비교 상태 |
| --- | --- | --- | --- | --- |
| DSaaS 내부 | hash·metadata 한정 여부와 열람 경계 확인 필요 | DSaaS 운영 경계에 의무 거래 관계가 모임 | DSaaS 운영과 DSGA 규칙 제정 권한 분리 증거 필요 | 후보 — 미선택 |
| 독립 연합 서비스 | DSaaS와 별도 열람 권한으로 분리 가능성 검토 | 독립 서비스 경계에 의무 거래 관계가 모임 | 독립 운영 계약과 DSGA 감독 권한 분리 증거 필요 | 후보 — 미선택 |
| 참여자 로컬 확장 | 참가자 경계에 record 유지 | 중앙 관계망 노출 없음 | 참여자별 운영·대사 책임 정의 필요 | 비교 기준 — 의무 거래의 제3자 증적 요건 미충족 |

운영 주체 판정은 [ADR-0007](../adr/0007-governance-function-separation.md)의 3분리 요건을 준거로 한다. 배치는 record 요건 정의와 운영 주체 확정 후 [ADR-0006 §6](../adr/0006-selective-notary-evidence.md#6-재검토-조건)의 절차에 따라 별도 ADR에서 결정한다.

## 6. Offering 게시와 전송

Provider 측 흐름은 다음 순서다.

```text
원천 플랫폼
  -> Platform Bridge 변환
  -> MOLIT DCAT-AP SHACL Gate
  -> 게시 권한 승인
  -> EDC Asset·Policy·Contract Definition 등록
  -> DSP Catalog
  -> 계약 협상
  -> 전송 요청
  -> EDC Data Plane 또는 승인된 platform provisioner
```

MOLIT DCAT-AP 적합 판정은 Offering의 메타데이터 판정이다. 전송 권한, 계약 성립, Data Plane 가용성을 대신 입증하지 않는다. `dataspace-offering` 모듈을 통과한 RDF라도 EDC 계약과 전송 준비가 끝나지 않으면 제공 가능한 데이터로 표시하지 않는다.

Provider transfer worker는 Connector가 이미 승인한 PULL 전송 사건을 받아 원천 플랫폼 token이나 signed URL을 발급하는 경계다.

발급 결과인 DataAddress 원문은 journal에 저장하지 않는다. 이 worker를 EDC Data Plane이나 DSP endpoint로 부르지 않는다.

### 6.1 기존 정산 시스템의 Consumer 배치

- **(Decision — E-19)** 기존 정산 시스템(회계처리·버스경영관리시스템)은 **Consumer로 온보딩**한다. 계약을 맺고 운수사 원천에서 당겨온다
- **(근거 구분)** 정산주체의 수요·수신 역할과 계약별 역할 구분은 [교통·물류 데이터 스페이스 참가자 지도](../01-research/transport-participant-map.md#91-동일-주체의-역할-차이)에서 `Verified`와 `Inferred`로 확인했다. Consumer 배치와 PULL 경로는 `E-19`의 `Decision`이다.

Consumer 측 흐름은 다음 순서다.

```text
기존 정산 시스템 운영기관의 기관 신원
  -> Consumer 측 Connector에서 DSP Catalog 조회
  -> 계약 협상
  -> 승인된 PULL 전송 요청
  -> Provider transfer worker의 원천 플랫폼 token 또는 signed URL 발급
  -> 운수사 원천에서 payload 직접 수신
  -> Consumer가 자기 시스템에 적재
```

- **(필요 기능)** 기존 시스템 운영기관에는 기관 신원, 계약 협상과 전송 요청 기능이 필요하다. 수신 뒤 자기 시스템 적재는 Consumer의 책임이다.
- **(책임 경계)** 데이터 스페이스는 신원·Catalog·계약·정책·감사 사건을 다룬다. payload 보관·중계, 기존 정산 시스템을 목적지로 한 바이트 전송과 내부 적재는 데이터 스페이스의 책임에서 제외한다.
- **(전송 경계)** 실제 바이트는 운수사 원천에서 Consumer로 직접 이동한다. Provider transfer worker의 책임은 승인된 PULL 사건에 대한 원천 접근 자원 발급으로 한정한다.

### 6.2 제출 이행 상태와 감사 공백

- **(Decision — E-20)** 제출 이행은 **계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료**의 세 조건이 모두 충족된 때 성립한다
- **(Decision — T-06 개정 이력)** 이전 정의인 “접수·영수증·재시도·중복방지 흐름 부재”는 폐기한다. 원천 유지와 PULL은 공백이 아니라 [ADR-0002](../adr/0002-data-stays-at-source.md)와 이 절의 정본이다.
- **(Verified — T-06)** `E-20`이 정한 제출 이행 성립 조건(계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료)을 **판정하고 사후에 증명할 상태 표현과 감사 기록이 현재 아키텍처에 없다.**
- **(Inferred)** 정산은 법정 제출이므로 “언제 이행됐는가”를 다투게 되며, 그때 제시할 증거 구조가 필요하다. 제출 성립 시점의 규율 필요성은 [의무화·간주 규정 선례 조사](../01-research/mandate-and-deeming-precedents.md#62-협약의-한계)를 근거로 한다.
- **(해석 경계)** 위 공백은 §5의 일반 hash chain 감사 사건이 없다는 뜻이 아니다. `E-20`의 세 조건과 연결된 상태 표현과 조건별 감사 기록이 없다는 뜻이다.
- **(Unverified)** 후속 설계에 필요한 범위는 다음 윤곽으로 한정한다. 각 항목의 상태값, schema, API와 전이 규칙은 미정이다.
  - 세 조건 각각의 기계 판독 가능한 상태 표현
  - 상태 전이 시각과 근거의 감사 기록
  - 계약 종료·정지 시 이행 상태의 처리
  - 참가자가 자기 이행 상태를 확인할 수 있는 수단

## 7. 상호운용 시험 판정

시험 결과는 세 단계로 나눈다.

1. 동일 구현 시험: EDC 0.18.0 Provider와 Consumer 사이의 Catalog, 협상, PULL 전송을 확인한다.
2. 규격 시험: DSP 공식 Schema와 TCK로 wire message와 상태 전이를 검사한다.
3. 이기종 시험: 다른 EDC 배포판 또는 다른 DSP 구현과 Catalog, 협상, 전송을 확인한다.

첫 단계만 통과한 상태를 이기종 상호운용 완료로 기록하지 않는다. 같은 EDC 배포판 두 개의 성공은 구성과 API 사용법을 검증하지만, 구현 간 차이를 찾지 못한다.

Data Plane 시험도 제어면 성공과 분리한다. 계약 협상이 끝났더라도 EDR 발급, 토큰 검증, source 접근, 응답 크기 제한, 취소와 만료를 확인하지 못하면 전송 상호운용은 미검증이다.

## 8. 신원과 권한

로컬 smoke 시험은 격리된 시험망에서만 `test-token`을 허용한다. 운영 DSaaS는 `dcp`만 허용한다. Identity Hub, Issuer Service, DID, VC 발급 규칙을 데이터 스페이스 거버넌스에 고정해야 한다.

DSaaS 관리 API는 OAuth2 introspection 결과의 다음 값을 확인한다.

- `active=true`
- issuer 정확 일치
- audience 정확 일치
- 만료 시각
- subject
- 역할
- 접근 가능한 dataspace ID 목록

CaaS 관리자 credential과 tenant credential은 분리한다. 저장소에는 환경 변수 이름만 남기고 값은 저장하지 않는다. 운영 배포에서는 Vault나 플랫폼 secret store가 환경 변수를 주입한다.

## 9. 운영 전환 조건

다음 조건이 끝나기 전에는 현재 구성을 운영 완료로 판정하지 않는다.

1. 운영기관이 DNS, TLS, participant ID, DID method를 승인한다.
2. EDC 배포판의 SBOM, 이미지 서명, 취약점 Gate를 운영 CI에 연결한다.
3. PostgreSQL과 Vault 기반 영속 배포를 구성한다.
4. CaaS와 DSaaS의 단일 파일 store를 트랜잭션 DB와 분산 fencing으로 교체한다.
5. DCP 기반 두 참가자 시험과 외부 DSP 구현 시험을 수행한다.
6. Data Plane source·sink의 SSRF, redirect, 크기, timeout, egress 정책을 검증한다.
7. 백업 복구, key rotation, tenant 삭제, 계약·감사 보존기간을 시험한다.

현재 구현은 운영 제어면의 상태 전이와 실패 차단 규칙을 실행한다. 기관별 인프라, 신원 발급, 외부 Connector와의 상호운용 증거는 아직 입력되지 않았다.

## 10. 공식 근거

- EDC 0.18.0: <https://github.com/eclipse-edc/Connector/releases/tag/v0.18.0>
- EDC 소스 기준점: <https://github.com/eclipse-edc/Connector/tree/911a22ba6b90688ffeb35bb92bf5cc040ffdf37f>
- EDC 개발자 설명서: <https://eclipse-edc.github.io/documentation/for-contributors/>
- EDC Virtual-Connector: <https://github.com/eclipse-edc/Virtual-Connector>
- Dataspace Protocol 2025-1 Errata 1: <https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/>

## 11. 미확인 사항과 결정 요청

아래 항목은 미결 등록만 수행한다. 승인된 담당과 기한은 없다.

### 11.1 OPEN-EDC-01 — DRV-01

- **(상태)** `Unverified`
- **(미확인 사항)** “기술적 온보딩 완료”의 판정 기준과 증거. 참가자 수준 종단시험 절차가 필요
- **(영향)** `E-20`의 세 번째 조건 충족 여부를 판정할 수 없다.
- **(종료 조건)** 판정 기준, 증거 정의와 참가자 수준 종단시험 절차의 승인 기록이 필요하다.
- **(담당)** 미정
- **(기한)** 미정

### 11.2 OPEN-EDC-02 — DRV-03

- **(상태)** `Unverified`
- **(미확인 사항)** 세 조건의 충족 상태를 기계 판독 가능하게 표현하고 감사 기록으로 남기는 방법
- **(영향)** 제출 이행 성립 시점의 자동 판정과 사후 증명이 불가능하다.
- **(종료 조건)** 상태 표현과 감사 기록 방법의 후속 설계 및 승인 기록이 필요하다.
- **(담당)** 미정
- **(기한)** 미정

### 11.3 OPEN-EDC-03 — T-06

- **(재정의 상태)** `Decision`
- **(해결 상태)** `Unverified`
- **(미확인 사항)** `E-20`의 세 조건을 판정하고 사후에 증명할 상태 표현과 감사 기록의 설계
- **(영향)** 정산 제출 이행 시점을 판정하고 분쟁 시 증명할 수 없다.
- **(종료 조건)** §6.2의 네 가지 윤곽에 대한 후속 설계와 승인 기록이 필요하다.
- **(담당)** 미정
- **(기한)** 미정
