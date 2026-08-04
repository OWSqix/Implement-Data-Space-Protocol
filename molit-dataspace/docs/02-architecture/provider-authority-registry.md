# Provider 권한 레지스트리

작성일: 2026-07-12  
개정일: 2026-08-03  
상태: Working Draft / E-16 문서 채택·실행 정본 미시행 / 외부 권한증거 대기

## 1. 목적

Provider는 계약별 기능이며 기관의 고정 지위가 아니다. Connector를 운영한다는 사실만으로 특정 계약에서 Dataset의 Offering Provider 기능을 수행할 권한이 생기지 않는다. 플랫폼 운영자, 원천기관, 계약 당사자와 전송 운영자는 서로 다른 역할이다.

- **(Decision — E-16)** 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다
- **(Decision — E-16 시행 경계)** `E-16`의 기본값은 자동 권한이 아니다. 원천기관이 기본 Provider라는 결정은 entry 등록·승인 절차를 통해서만 시행된다.

Provider 권한 레지스트리는 참가자가 특정 source의 특정 asset에 대해 다음 행위를 수행할 법적·행정적 권한이 있는지를 기록한다.

- Catalog 게시
- DSP 계약협상
- 데이터 전송
- 제3자 위임

시행 상태와 아키텍처 경계는 다음과 같다.

- **(범위 경계)** `data-transfer` 권한 판정은 데이터 스페이스의 payload 보관·중계 권한이 아니다.
  - **(전송 경계 — `E-21`)** 실제 바이트는 원천에서 계약별 Provider 기능 수행 주체의 Data Plane을 경유해 Consumer로 이동한다.
  - **(근거)** [ADR-0002](../adr/0002-data-stays-at-source.md), [아키텍처 §6](edc-caas-dsaas-architecture.md#6-offering-게시와-전송)
- **(Verified — 2026-08-03 직접 확인)** Provider 권한의 실행 정본은 [`standards/provider-authority-registry.json`](../../standards/provider-authority-registry.json)이다. 승인 entry는 0건이며 `releaseDecision=blocked-no-approved-authority`다.
- **(Verified — 시행 상태)** `E-16`은 문서 수준에서 채택됐지만 실행 정본에서는 미시행이다.

## 2. 권한 entry

계약은 [`contracts/provider-authority-registry.v1.schema.json`](../../contracts/provider-authority-registry.v1.schema.json)에서 정의한다.

- **(Verified — 2026-08-03 직접 확인)** `roles` 열거에는 `data-owner`, `delegated-provider`, `platform-operator`, `connector-operator`가 있고 `allowedActions` 열거에는 `delegate`가 있다. 역할·위임의 모델 표현력은 이미 있지만 이 구조만으로 권한이 자동 부여되지는 않는다.

| 묶음 | 필드 | 판정 목적 |
| --- | --- | --- |
| 주체 | `participantId`, `providerId`, `legalEntityName` | 참가자와 권한 주체를 구분 |
| 범위 | `sourceSystemId`, `assetIds`, `allowedActions` | source·asset·action 범위를 명시하고 asset wildcard를 금지 |
| 역할 | `roles` | `data-owner`·`delegated-provider`·`platform-operator`·`connector-operator` 역할 분리 |
| 근거 | `basis.kind`, `issuerId`, `subjectId`, `evidenceId` | 소유·위임·법정 권한의 발행자와 수임자 확인 |
| 고정본 | `artifactSha256`, `artifactLocator` | 계약·결정문 원문을 evidence vault에서 식별 |
| 유효기간 | `effectiveFrom`, `validUntil` | 미래·만료 권한 차단 |
| 철회 | `revocationStatus`, `revocationCheckedAt` | 정지·철회 권한 차단 |
| 승인 | `decision`, `approval` | 승인자·검증자·시각·서명 참조 기록 |

`assetIds`의 wildcard는 허용하지 않는다. source와 Provider가 같아도 요청 asset이 승인 entry의 `assetIds`에 명시돼 있지 않으면 resolver는 거부한다.

- **(Inferred — 근거 범위)** [기존 허브의 데이터 스페이스 연계 역량 조사 §6](../01-research/hub-capability-assessment.md#6-원천-권리-위험)와 [기존 플랫폼 섭외 가능성 조사 §4](../01-research/hub-recruitment-feasibility.md#4-원천-권리와-조건부-가능-범위)는 수집권과 재제공권을 구분하고 데이터셋별 위임 문서 확인이 필요하다고 판정한다. 이 근거는 특정 데이터셋의 포괄 위임이나 승인 entry가 존재함을 입증하지 않는다.

## 3. 실행 판정

[`src/governance/provider-authority.mjs`](../../src/governance/provider-authority.mjs)는 다음 순서로 판정한다.

1. registry 구조와 시간관계, 중복 ID를 검사한다.
2. participant·provider·source가 정확히 같고 요청 asset·action을 명시적으로 포함하는 후보 entry를 찾는다.
3. 후보가 0건이면 `AUTHORITY_NOT_FOUND`, 복수이면 `AUTHORITY_AMBIGUOUS`로 거부한다.
4. 후보 한 건의 승인, `current` 여부, 유효기간과 revocation freshness를 검사한다.
5. 검증 receipt의 값과 freshness를 검사한 뒤 주입된 `verifyReceipt` callback에 검증 envelope를 전달하고 반환값이 원시 boolean `true`인지 확인한다.
6. 모든 조건을 통과한 경우에만 `authorityId`, `evidenceId`, `validUntil`을 반환한다.

현재 Discovery Bridge의 `synthetic-test-only` approval은 이 레지스트리를 대신하지 않는다.
production 연결은 승인 entry, 실제 기관 trust anchor와 production composition root adapter를 확보하고 runtime signature verification을 통과하도록 구성한 뒤 별도 ADR로 활성화한다.

## 4. trusted verifier 주입 경계

Provider 권한 resolver는 key 파일을 읽거나 KMS·vault·원격 JWKS에 접속하지 않는다.
이 작업은 production application의 composition root가 맡는다.
composition root는 보호된 설정에서 trust anchor와 현재 사용 가능한 key 목록을 읽고, 해당 목록만 사용하는 `verifyReceipt` callback을 만든다.
그 callback과 검증 대상 receipt를 다음 호출의 세 번째 인자로 주입한다.

```js
const decision = resolveProviderAuthority(registry, trustedRequest, {
  receipt,
  verifyReceipt,
});
```

`trustedRequest.policyEnforcementPointId`는 HTTP body나 DSP participant가 제출한 값을 그대로 쓰지 않는다. Connector 또는 policy enforcement point의 배포 설정에서 가져온 식별자를 넣는다. `trustedRequest.evaluatedAt`도 application의 신뢰 시계에서 만든다. 외부 요청자가 과거 시각을 골라 철회 검사를 우회하게 두어서는 안 된다.

resolver는 registry·request·receipt의 구조와 시간관계를 먼저 검사한다. 그다음 아래 envelope를 새 객체로 만들고 재귀적으로 동결한 뒤 callback에 전달한다.

| envelope 필드 | 묶이는 값 |
| --- | --- |
| `schemaVersion`, `canonicalization` | envelope 계약 버전과 `RFC8785` |
| `request` | `decisionRequestId`, `participantId`, `providerId`, `sourceSystemId` |
| `asset.assetId` | 판정 대상 asset |
| `action` | `catalog-publish`, `contract-negotiate`, `data-transfer`, `delegate` 중 요청한 행위 |
| `evidence` | `authorityId`, `evidenceId`, 근거·결정문 digest, entry digest, registry 시각·digest |
| `evaluatedAt` | strict RFC 3339 형식으로 검증한 판정 시각 |
| `verifier` | `verifierId`, `trustAnchorId`, `keyId`, `signatureRef`, 검증 artifact digest와 `verifiedAt` |
| `policyEnforcementPoint.id` | composition root가 확인한 PEP 식별자 |
| `payloadSha256` | entry·request·registry 판정 payload의 RFC 8785 digest |
| `receipt`, `receiptSha256` | receipt 전체와 detached proof 필드를 뺀 서명 projection의 RFC 8785 SHA-256 |

`receiptSha256`는 receipt 안에 넣지 않는다.
resolver는 receipt에서 `signatureRef`와 `verificationArtifactSha256`을 뺀 뒤 digest를 계산한다.
서명 artifact의 digest를 서명 대상에 다시 넣으면 순환 참조가 생기기 때문이다.
request·asset·action·evidence·판정 시각·verifier·PEP·trust anchor·key는 서명 projection에 남는다.
제외한 두 필드는 callback이 허용된 locator와 실제 artifact digest를 대조해 따로 묶는다.

callback은 다음 조건을 모두 확인한 경우에만 원시 boolean `true`를 반환한다.

1. `trustAnchorId`와 `keyId`가 composition root에 고정된 trust store에 있다.
2. receipt에 적힌 key 식별자나 인증서를 동적으로 신뢰하지 않는다.
3. `signatureRef`는 허용된 vault·KMS adapter로만 해석한다.
4. 가져온 검증 artifact의 SHA-256이 `verificationArtifactSha256`과 같다.
5. 서명 대상 digest가 envelope의 `receiptSha256`과 같고 서명이 고정 trust anchor로 검증된다.
6. key의 용도, 유효기간, 폐기·철회 상태가 판정 시각에 유효하다.

callback이 `false`, 다른 truthy 값, Promise를 반환하거나 예외를 던지면 resolver는 `AUTHORITY_SIGNATURE_UNVERIFIED`로 거부한다. resolver 내부에서 임의 callback을 만들거나 receipt가 지정한 trust anchor를 자동 등록하면 이 경계가 무너진다.

현재 repository에는 실제 기관 trust anchor와 production composition root adapter가 없다. 이 절은 주입 계약을 고정할 뿐이며 `blocked-no-approved-authority` 상태를 변경하지 않는다.

## 5. 확보할 증거

권한 entry 등록·승인 요청에는 evidence vault에서 식별할 수 있는 다음 자료가 필요하다.

1. 원천기관과 데이터셋 식별자
2. 재제공·계약협상·전송 권한의 법적 또는 계약상 근거
3. 위임 범위, 수임자, 유효기간과 재위임 가능 여부
4. 철회·정지 여부를 확인할 정본과 확인주기
5. 권한 승인자의 직무·서명검증 key와 독립 확인자
6. 원문 byte 수, SHA-256, 보관 위치와 접근기록

개인 계정, session cookie, 화면 캡처와 플랫폼 운영계약만으로 Provider 권한을 승인하지 않는다.

## 6. 등록·승인 시행 절차

- **(Decision 적용)** [§1의 `E-16` 결정문](#1-목적)을 그대로 적용한다.
- **(Inferred — 절차 접합)** [파일럿 권리 확정 패키지 §6~§8](../03-plan/pilot-rights-confirmation-package.md#6-provider-판정-절차)의 완성·승인된 데이터셋별 Provider 판정, 권리 9항목과 근거·승인 기록이 entry 작성의 입력이다. 빈 서식은 권한 증거가 아니다.
- **(Inferred — 승인 제한)** 요청한 행위에 영향을 주는 항목이 `문서 미확인` 또는 `판정 불가`이면 `decision=approved` entry를 등록하지 않는 fail-closed 절차안이다. 승인 주체와 절차안의 승인값은 미정이다.
- **(변경 범위)** 이 절은 시행 절차안의 범위를 제시한다. `standards/*.json`, `contracts/*.json`과 `src/`의 기계 정본은 변경하지 않는다.

### 6.1 판정 서식과 entry 입력

판정 서식은 데이터셋·version·전달 경로별로 작성한다. `PRC-CASE-*`는 Provider 최종 판정과 계약 당사자를, `PRC-RGT-*`는 권리 9항목을, `PRC-DOC-*`는 원문과 조항을 식별한다. 등록 요청은 세 산출물과 [판정 패키지 §8.5](../03-plan/pilot-rights-confirmation-package.md#85-근거승인-기록)의 승인 기록을 같은 증거 묶음으로 연결한다.

| entry 필드 | 판정 서식 입력 | 작성·거부 기준 |
| --- | --- | --- |
| `authorityId` | `PRC-CASE-*`, `PRC-RGT-*` | 권한 entry 식별자를 부여하고 두 판정 ID와의 관계를 근거 artifact에 기록. 판정 ID를 `authorityId`로 자동 전용하지 않음 |
| `participantId` | 법적 계약 당사자, 참가자 온보딩 신원 | 두 기록의 binding을 대조한 HTTPS 또는 분산 식별자(Decentralized Identifier, DID) 신원을 사용. resolver는 법적 관계를 추론하지 않고 값만 정확 일치 검사 |
| `providerId` | Provider 최종 판정 | 계약별 Provider 기능 주체의 승인된 신원을 사용하고 `basis.subjectId`와 정확히 일치시킴 |
| `legalEntityName` | 계약 당사자 원문, Provider 최종 판정 | 근거 원문에서 확인한 법적 명칭을 기록. 명칭으로 `participantId`·`providerId` 신원을 대체하지 않음 |
| `sourceSystemId` | system of record 판정 | 원천·보유 책임표에서 확인한 원천시스템의 runtime local ID를 사용 |
| `assetIds` | 데이터셋 ID·version, `PRC-RGT-*` | runtime의 명시적 asset ID만 기록. wildcard와 문서로 확인되지 않은 version 범위는 거부 |
| `allowedActions` | Provider 판정, 권리 9항목, 위임 조항 | `catalog-publish`, `contract-negotiate`, `data-transfer`, `delegate`를 행위별로 판정. Provider 판정 하나로 네 행위를 일괄 허용하지 않음 |
| `roles` | 역할·책임표, 위임 판정 | 문서로 확인한 역할만 기록. 원천기관이라는 이유만으로 `data-owner`를, 운영계약만으로 Provider 역할을 자동 부여하지 않음 |
| `basis` | `PRC-DOC-*`, 조항, 승인된 증거 묶음 | 근거 종류, 발행자·수임자, `EVD-AUTH-*`, 원문 SHA-256과 `vault://` 또는 `records://` 위치를 기록 |
| 유효·철회 필드 | 시행일·유효기간, `R-09`, 최신 철회 확인 | 근거 문서 범위보다 넓은 기간을 금지. 철회 정본과 확인 시각이 없으면 승인 보류 |
| `decision`, `approval` | 판정 패키지 §8.5 승인 기록 | 승인자, 승인 시각, 결정 artifact digest, 서명 참조, 검증자와 검증 시각을 확보한 뒤 승인 상태 기록 |

| action | 판정 서식 근거 | `allowedActions` 포함 조건 |
| --- | --- | --- |
| `catalog-publish` | Provider 판정 절차의 Offering 후보 승인 | 해당 데이터셋·version의 게시 후보 승인이 확인됨 |
| `contract-negotiate` | 법적 계약 당사자, 대리·위임 조항 | 계약협상·체결 권한이 문서로 확인됨 |
| `data-transfer` | `R-01`, 원천 접근자원 발급 절차와 적용되는 권리 항목 | Consumer 직접 제공과 원천 접근자원 발급 권한이 문서로 확인됨 |
| `delegate` | `PRC-Q-024`, `R-03`, 포괄 위임 문서 | 재위임이 명시적으로 허용되고 그 범위·기간·책임이 확인됨 |

다섯 판정 축은 `participantId`·`providerId`·`sourceSystemId`·`assetIds`·`allowedActions`다. `assetIds`와 `allowedActions`는 배열이므로 검토자는 각 participant·provider·source·asset·action 조합이 현재 registry snapshot에서 정확히 한 entry에만 포함되는지 대조한다.

권리 9항목은 허용 행위의 최대 범위와 근거 artifact를 정한다. cache·복제, 유상 제공, 파생물, 국외 이전, 종료 후 보존과 보호정보 조건은 현 schema에 별도 구조화 필드가 없다. 해당 조건을 근거 artifact에 고정하더라도 resolver가 그 의미를 판정하는 것은 아니다.

### 6.2 등록·승인 단계

- **(Inferred — fail-closed 절차안)** 아래 단계는 schema·resolver와 `E-16`에서 도출한 시행 후보 절차다. 승인 주체, 갱신 방식과 운영 기한은 §8의 미결로 유지한다.

| 단계 | 입력 | 판정 | 산출 | 증거 |
| --- | --- | --- | --- | --- |
| 1. 권리 판정 결과 접수 | 완성된 `PRC-CASE-*`, `PRC-RGT-*`, `PRC-DOC-*`, 근거·승인 기록 | 데이터셋·version·전달 경로, Provider 최종 판정, 권리 9항목과 현행 원문이 추적 가능한지 확인. 관련 항목이 `문서 미확인`·`판정 불가`이면 보류 | 접수 기록, 보류 사유, 증거 색인 | 판정 ID, 문서 ID, 조항, 유효기간, 원문 digest, 승인 기록 |
| 2. entry 초안 작성 | 접수 통과 묶음, 참가자 신원 binding, runtime source·asset ID | §6.1의 다섯 축과 나머지 필드를 작성. 원천기관 기본값을 적용하고 다른 주체에는 포괄 위임 문서를 요구 | 실행 registry 밖의 entry 변경 요청과 필드 mapping표 | identity binding, Provider 판정, 위임 조항, 권리 9항목 대응표 |
| 3. 검토 | entry 변경 요청, 현재 registry snapshot, 근거 artifact | `E-16`, 발행자·수임자, 다섯 축, action별 권리, 기간, 철회 상태와 중복 후보를 대조 | 검토 기록, 결함 목록, 승인 상정본 또는 반려본 | 대조표, 중복 탐지 결과, schema·semantic 사전검사 결과 |
| 4. 승인 | 승인 상정본, 검토 기록, 서명 대상 결정 artifact | 승인 권한, `approval.approvedBy=basis.issuerId`와 선택한 승인안의 검증·직무분리 기준을 대조. 승인 주체가 미정인 현재 상태에서는 승인 산출물을 만들 수 없음 | 승인·보류·반려 결정 artifact | 승인자 권한 증거, 결정 artifact SHA-256, 서명 참조, 검증자 기록 |
| 5. 등록과 서명 | 승인 결정 artifact, 고정된 근거 원문, entry 최종본 | schema와 `semanticAuthorityErrors`를 통과한 변경만 현재 registry snapshot에 반영. `asOf`, registry digest와 `releaseDecision`을 함께 검증 | 서명 참조가 있는 승인 entry, 새 registry snapshot, 변경 감사 기록 | `artifactSha256`, `decisionArtifactSha256`, `signatureRef`, registry digest, 검증 로그 |
| 6. 유효기간과 갱신 | 만료 예정 entry, 최신 권리 판정, 철회 확인 | 갱신 때 1~5단계를 다시 수행. 승인된 갱신 방식이 없으면 기간을 자동 연장하지 않고 현재 snapshot의 같은 다섯 축 후보를 정확히 한 건으로 제한 | 갱신 entry 또는 만료 상태, 이전 결정을 가리키는 감사 이력 | 새 판정·결정 artifact, 교체 전후 digest, 유효기간 대조 결과 |
| 7. 철회·정지와 전파 | 권리 철회·계약 종료·사고 결정, 최신 철회 정본 | `revocationStatus`, `revocationCheckedAt`과 registry `asOf`를 갱신하고 runtime registry 사용 지점에 변경을 전파. 전파 대상과 허용 지연은 미정 | 정지·철회 상태, 새 snapshot, 후속 요청 거부 상태 | 철회 결정문, 변경 digest, resolver 거부 결과, 원천 접근자원 철회 또는 만료 확인 기록 |

resolver는 상태와 기간보다 먼저 정확 일치 후보 수를 센다. 따라서 만료·철회된 entry와 갱신 entry라도 같은 다섯 축을 포함해 현재 snapshot에 함께 두면 `AUTHORITY_AMBIGUOUS`가 된다. 이전 결정의 보존 방식·위치와 보존기간은 미정이다.

승인 주체의 승인값은 없다. 선택지와 판단 기준은 다음과 같으며 이 문서에서 채택하지 않는다.

| 선택지 | 현 schema 적용 방식 | 판단 기준 |
| --- | --- | --- |
| 원천기관·권리 발행자 중심 | 권한 근거 발행자를 `basis.issuerId`와 `approval.approvedBy`에 기록하고 별도 검증자를 `verifiedBy`에 기록 | 원천 권리 확인 권한, 위임·철회 권한, 기관 서명 key와 책임 추적 가능성 |
| 분야 데이터 스페이스 거버넌스 기구(Data Space Governance Authority, DSGA) 최종 승인 | 기구가 근거 발행자가 아니면 현 구현의 `approvedBy=basis.issuerId` 조건과 충돌. `verifiedBy` 역할 또는 기계 계약 개정 검토 필요 | 법적 수권, 데이터셋 권리 전문성, 이해상충 통제, 철회 대응과 감사 독립성 |
| 발행자 승인과 독립 심의의 이중 통제 | 발행자는 `approvedBy`, 독립 기구는 `verifiedBy`로 기록하고 공동 심의 내용은 결정 artifact에 고정 | 직무분리, 단일 승인자·검증자로 표현할 수 없는 정족수, 재심과 이의제기 절차 |

공통 판단 기준은 권리 발행·철회 권한, `E-16`의 원천기관 기본값과 포괄 위임 예외, 승인·검증 직무분리, trust anchor 운영, 철회 대응, 감사 가능성과 §6.5의 책임 경계다.

### 6.3 resolver 요구사항 대응

| resolver 요구사항 | 충족 단계 | 절차 산출·검증 | 현재 미충족 사항 |
| --- | --- | --- | --- |
| 다섯 축 정확 일치 후보 한 건 | 2. 초안, 3. 검토, 6. 갱신 | 출시 범위의 조합별 coverage표, 중복 후보 0건, 인접 scope 거부 결과 | 출시 범위 조합 원장이 없어 운영 최소 entry 총수 산정 불가 |
| 승인과 `current` | 4. 승인, 5. 등록, 7. 철회 | `decision=approved`, `approval.status=verified`, `revocationStatus=current`와 반대 상태 거부 결과 | 승인 주체와 실제 승인 entry 미확정 |
| 유효기간 | 2. 초안, 3. 검토, 6. 갱신 | `effectiveFrom <= evaluatedAt < validUntil`, 경계시각 전후 시험 | 표준 유효기간과 갱신 착수시점 미정 |
| registry snapshot freshness | 5. 등록, 6. 갱신, 7. 철회, runtime 권한 요청 | strict RFC 3339 판정 시각과 `evaluatedAt <= registry.asOf`; 초과 시 `REGISTRY_SNAPSHOT_TOO_OLD` 거부 | snapshot 전파 대상·허용 지연 미정 |
| revocation freshness | 3. 검토, 6. 갱신, 7. 철회, runtime 권한 요청 | semantic 판정은 `asOf`, runtime은 `evaluatedAt`을 기준으로 철회 확인 시각·age와 future 상태를 검사 | 확인 주체·주기·전파 허용 지연 미정. 현재 `revocationMaxAgeSeconds`는 86,400 |
| 검증 receipt | runtime 권한 요청 | 요청·entry·registry·근거·정책집행점 digest 일치와 `approval.verifiedAt <= receipt.verifiedAt <= evaluatedAt`; receipt age 상한 검사 | 실제 기관 receipt 발급·검증 흐름과 production adapter 미확보 |
| 서명 | 5. 등록과 runtime 권한 요청 | 승인 결정의 `approval.signatureRef` 보존, 요청별 `receipt.signatureRef`와 주입된 `verifyReceipt` 검증 | 승인 결정 artifact 서명검증 절차와 실제 기관 trust anchor 미확보 |

- **(시점)** 요청별 receipt는 entry 등록 때 미리 만들 수 없다.
- **(결합 값)** receipt는 runtime의 participant·provider·source·asset·action, 판정 시각, 정책집행점과 registry digest를 묶는다.
- **(절차 경계)** 등록 절차는 receipt 발급에 필요한 승인 entry와 trust 자료를 준비하고 실제 검증은 요청 시점에 수행한다.

현 registry schema는 `approval.signatureRef`를 요구하지만 resolver는 그 참조가 가리키는 승인 결정 artifact의 암호서명을 직접 검증하지 않는다. runtime receipt 서명은 composition root가 주입한 `verifyReceipt`에서 검증한다. 두 서명의 검증 책임과 증거를 같은 것으로 간주하지 않는다.

### 6.4 release 차단 해소 조건

이 절의 release 차단은 legacy 운영·`bridge-runtime` 범위의 `BS-AUTHORITY-REGISTRY`와 `PROVIDER-AUTHORITY-APPROVAL`을 뜻한다. [release Gate 상태 §3~§4](../03-plan/release-gate-status.md#3-잔여-release-차단항목)의 RC profile 판정과 범위를 혼동하지 않는다.

- **(Verified — 기계 최소치)** registry semantic 판정의 `hasApprovedCurrent` 계산은 다음 조건을 모두 충족한 entry를 최소 1건 요구한다. registry 전체의 schema·semantic 오류 0건도 별도 필요하다.
  - `decision=approved`
  - `approval.status=verified`
  - `revocationStatus=current`
  - `effectiveFrom <= asOf < validUntil`
  - `revocationCheckedAt <= asOf`이고 철회 확인 후 경과시간이 `revocationMaxAgeSeconds` 이하
- **(Inferred — 운영 최소치)** 실제 출시 범위의 participant·provider·source·asset·action 조합마다 정확 일치 후보가 한 건 필요하다. 한 entry가 여러 asset·action을 포함할 수 있고 출시 범위 조합 원장이 없으므로 필요한 최소 entry 총수는 **산정 불가**다.
- **(Unverified — 현재 상태)** 승인 entry, 실제 기관 trust anchor와 production composition root adapter가 없으므로 1건 조건과 runtime 검증 조건을 충족하지 못했다.

| 조건 묶음 | 해소에 필요한 상태 | 증거·검증 |
| --- | --- | --- |
| entry 근거 | 승인된 `PRC-CASE-*`, Provider 판정, 권리 9항목과 현행 원문이 entry의 다섯 축·역할·기간·철회 범위를 지지 | `PRC-RGT-*`, `PRC-DOC-*`, `EVD-AUTH-*`, 원문·결정 artifact digest와 보관 위치 |
| registry 적격 | 기계 최소치 1건 이상, 출시 범위 조합별 후보 정확히 한 건, `releaseDecision=eligible-after-runtime-verification` | schema 검증, `semanticAuthorityErrors` 0건, registry digest와 reviewed baseline |
| 서명·철회 | 승인 결정 서명, 승인된 검증 역할, 실제 기관 trust anchor, 최신 철회 확인과 변경 전파 | `approvedBy`, `verifiedBy`, 서명검증 기록, trust store 설정 증거, 철회 조회·전파 로그 |
| runtime 판정 | 정확 scope 허용, 인접 scope·중복·만료·철회·stale receipt 거부, 신뢰된 receipt 서명 검증 | `AUTH-REG-001~006`, production composition root에서 원시 boolean `true`와 거부 code를 재현한 시험 결과 |
| 운영 Gate | `BS-AUTHORITY-REGISTRY`의 외부 증거를 확보하고 legacy release 검사와 registry 상태 계약을 일치 | 승인된 상태 변경, release 검사 결과와 감사 기록 |

- **(Verified — 정본 모순)** [`contracts/provider-authority-registry.v1.schema.json`](../../contracts/provider-authority-registry.v1.schema.json)과 resolver는 비차단 후보 상태로 `eligible-after-runtime-verification`을 사용한다. 그러나 [`tools/release/release-gate.mjs`](../../tools/release/release-gate.mjs)는 `releaseDecision=approved`를 요구하며 registry byte digest도 고정한다.
- **(판정)** schema는 `approved`를 허용하지 않으므로 현행 schema-valid registry만으로 legacy `PROVIDER-AUTHORITY-APPROVAL` 차단을 해소하는 방법은 **판정 불가**다. 기계 계약과 reviewed baseline의 승인된 정합화가 선행돼야 하며 이 작업에서는 변경하지 않는다.

### 6.5 위임 entry와 책임 분리

이 절에서 FPIS는 화물운송실적신고시스템을 뜻한다.

- **(Decision — E-12)** 온보딩은 **복수 경로**로 하고 위임을 허용하되 **FPIS식 3분할 책임**을 적용한다. 참가자·원천시스템은 사실·증빙 책임, 대행자는 변환·전송·인증·로그 책임, 운영자는 접속·보안 책임을 진다
- **(Decision — E-18)** 허브 연계 범위는 **재제공권 확인목록**으로 한다. 기본값은 미연계이고 재제공 권리가 문서로 확인된 데이터셋만 추가한다
- **(Verified — 선례 근거)** [저기술 참가자 온보딩 선례 조사 §4.1](../01-research/low-tech-onboarding-precedents.md#41-화물운송실적신고시스템fpis-3분할)은 대행기관의 확인 의무와 신고자의 최종책임 유지를 확인했다. 외부 원문 확인일은 2026-08-02, 저장소 문서 확인일은 2026-08-03이다. 적용 규칙은 위 `E-12` 결정문이다.

| 위임 항목 | entry 기록 | 판정 경계 |
| --- | --- | --- |
| 수임 역할 | `roles`에 `delegated-provider` | 플랫폼·Connector 운영 역할만으로 추가하지 않음 |
| 위임 근거 | `basis.kind=delegation-contract`, `issuerId`에 위임 권한자, `subjectId`에 수임자 | `subjectId`는 `providerId`와 정확히 일치. 포괄 위임 문서 미확인이면 승인 불가 |
| 위임 범위 | `sourceSystemId`, 명시적 `assetIds`, 행위별 `allowedActions` | 데이터셋·version·계약 범위를 넘는 wildcard와 행위 일괄 허용 금지 |
| 위임 기간 | `effectiveFrom`, `validUntil` | 원문 시행일·유효기간보다 넓게 설정 금지. 원문의 자동갱신 조항과 최신 철회 상태를 별도 확인하고 entry 갱신 방식은 미정으로 유지 |
| 재위임 | 포괄 위임 문서가 재위임을 명시적으로 허용한 경우에만 `allowedActions`에 `delegate` 포함 | `delegated-provider` 역할은 `delegate` 행위를 자동 허용하지 않음 |
| 사고 책임 | 사고 통지, 정정, 손해·배상, 접근자원 회수와 로그 제출 조항을 근거 artifact에 기록하고 digest·locator로 고정 | 현 schema에 사고 책임 필드가 없고 resolver는 조항 의미를 판정하지 않음 |
| 권리 9항목 | 항목별 결과·조건·주체·조항을 근거 artifact에 포함 | 권리 결과가 entry의 범위보다 좁으면 더 넓은 action 승인 금지 |

허브의 데이터셋은 재제공권 확인목록 등재만으로 entry가 생기지 않는다. 문서로 확인된 데이터셋을 후보로 삼아 `E-16`의 포괄 위임 판정과 1~5단계를 별도로 통과해야 한다.

| 책임 주체 | `E-12` 책임 | entry·증거 대응 | 자동 부여 금지 |
| --- | --- | --- | --- |
| 참가자·원천시스템 | 사실·증빙 | system of record, 데이터셋 식별, 권리 원문, 정정·철회 사실과 근거 artifact | 원천기관 지위만으로 `data-owner` 역할이나 승인 entry 부여 금지 |
| 대행자 | 변환·전송·인증·로그 | `delegated-provider`, 허용 action, 위임계약의 기술·사고 책임 조항과 실행 로그 | 포괄 위임 없이 Catalog 게시·계약협상·전송·재위임 권한 부여 금지 |
| 운영자 | 접속·보안 | 문서로 확인된 `platform-operator`·`connector-operator`, 접근·보안 운영 증거 | 운영 역할을 Provider 기능 권한으로 전용 금지 |

- **(권한 경계)** `data-transfer` action은 계약별 Provider 기능 판정 범위이며 데이터 스페이스의 payload 보관·중계 권한이 아니다.
- **(전송 경계 — `E-21`)** 실제 바이트는 원천에서 Provider Data Plane을 경유해 Consumer로 이동한다.
- **(Verified — resolver 효과)** 정지·철회 상태를 반영한 현재 registry snapshot을 사용하면 resolver는 이후 권한 요청을 거부한다.
- **(Inferred — worker 요구 동작)** 거부된 권한 요청에서는 Provider transfer worker가 새 token 또는 signed URL을 발급하지 않는 흐름이 필요하다.
- **(원천 접근자원)** 이미 발급된 접근자원은 원천이 지원하는 경우 철회하고, 지원하지 않으면 만료 여부를 확인한다.
- **(Unverified)** 접근자원별 철회 지원 여부, 전파 사건 schema, 대상별 허용 지연과 완료 판정 주체는 미정이다.

## 7. 시험 Gate

`AUTH-REG-001~006`은 다음 오류를 거부한다.

- 승인 entry가 없는 registry의 release 승격
- asset wildcard
- 미검증 승인
- Provider와 권한근거 subject 불일치
- 철회된 권한
- 중복 evidence ID
- 범위 밖 asset 요청
- timezone 없는 시각, 문자열 `0`, 존재하지 않는 달력 날짜
- request·asset·action·evidence·검증자·PEP가 receipt와 다른 경우
- 서명 projection이나 detached proof 참조·digest가 서명 뒤 바뀐 경우
- host 없는 HTTPS 값, userinfo·잘못된 percent encoding과 DID URL
- URI처럼 보이는 source·asset·trust anchor·key local ID

구조와 fail-closed resolver는 구현했지만 승인 entry가 0건이므로 `E-16`은 실행 정본에서 미시행이고 `BS-AUTHORITY-REGISTRY`는 해소되지 않았다.

## 8. 미확인 사항과 결정 요청

아래에는 미확인 사항과 관련 위험의 관계를 등록한다. 승인된 담당과 기한이 없어 모두 `미정`으로 기록한다.

- **(개정 이력 — 2026-08-03)** §6에 시행 절차안을 추가했다. `OPEN-PAR-01`은 승인 주체와 절차안 승인으로, `OPEN-PAR-02`는 출시 범위의 최소 entry 총수와 운영 증거로 범위를 좁혔다. 기존 결정은 변경하지 않았다.

- **(범위)** 위험 대장은 이번 작업에서 변경하지 않는다.

| ID | 상태 | 미확인 사항 또는 관계 | 영향 | 담당 | 기한 | 결정 요청 |
| --- | --- | --- | --- | --- | --- | --- |
| `OPEN-PAR-01` | `Unverified` | §6 절차안의 승인과 entry 승인 주체 | 승인 주체가 없어 승인 entry 생성·등록 책임 판정 불가 | 미정 | 미정 | 절차안, 승인 주체와 직무분리 승인 |
| `OPEN-PAR-02` | `Unverified` | 출시 범위의 다섯 축 조합 원장, 최소 entry 총수와 실제 승인 증거 | 기계 최소치는 1건이나 운영 최소 entry 총수는 산정 불가이며 release는 차단 상태로 유지 | 미정 | 미정 | 출시 범위 원장, coverage표, 승인 증거와 검증 결과 승인 |
| `OPEN-PAR-03` | `Verified` | [`R-001`](../03-plan/risk-register.md#3-위험-목록)은 계약·재제공 권한 부재를 다루고 `E-16`의 entry 등록·승인 시행 공백은 담고 있지 않으므로 부분 중복 | 권리 부재와 시행 절차 부재의 범위 구분 | 미정 | 미정 | 없음 — 관계만 기록 |
| `OPEN-PAR-04` | `Verified` | **상태값 충돌은 2026-08-04 해소됨.** release 검사가 `entry.decision`의 값인 `approved`를 `releaseDecision`과 비교해 어떤 schema-valid registry로도 차단을 풀 수 없었다. 비교 대상을 `eligible-after-runtime-verification`으로 바로잡고 `authorityBlocked`로 분리해 회귀시험 6건(`RELEASE-GATE-AUTH-001`~`006`)을 추가했다. 현행 데이터의 게이트 출력과 report digest는 불변 | **잔여** — reviewed digest 고정은 설계된 통제이므로 결함이 아니다. 승인 entry를 등록할 때 `tools/release/release-gate.mjs`와 `tools/release/reviewed-inputs.mjs`의 baseline sha256을 함께 갱신하는 절차가 필요 | 미정 | 미정 | entry 등록과 baseline 갱신을 한 변경으로 묶는 절차 승인 |
| `OPEN-PAR-05` | `Unverified` | 승인 결정 artifact의 서명검증 절차, 실제 기관 trust anchor, production composition root adapter와 요청별 receipt 발급·검증 구성 | 승인 entry가 생겨도 runtime 서명검증과 운영 release 판정 불가 | 미정 | 미정 | 승인 artifact·receipt 서명검증과 trust store 종단시험 승인 |
| `OPEN-PAR-06` | `Verified` | 사고 책임과 FPIS식 3분할 책임은 현 entry에 구조화되지 않고 근거 artifact로만 연결됨 | 책임 조항을 resolver에서 기계 판독·집행하는 범위 판정 불가 | 미정 | 미정 | evidence-only 유지 또는 기계 계약 확장 여부 승인 |
| `OPEN-PAR-07` | `Unverified` | 갱신·철회 운영 주체, 이전 snapshot 보존 정본, 전파 대상·허용 지연과 완료 판정 | 중복 후보 방지, 철회 freshness와 접근자원 철회·만료 처리 완료 판정 불가 | 미정 | 미정 | 운영 책임분장, 이력·전파 절차와 검증 기준 승인 |
