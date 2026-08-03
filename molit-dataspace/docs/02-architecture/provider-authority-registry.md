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

- **(범위 경계)** `data-transfer` 권한 판정은 데이터 스페이스의 payload 보관·중계 권한이 아니다. [ADR-0002](../adr/0002-data-stays-at-source.md)와 [아키텍처 §6](edc-caas-dsaas-architecture.md#6-offering-게시와-전송)에 따라 실제 바이트는 원천에서 Consumer로 직접 이동한다.
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

## 6. 시험 Gate

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

## 7. 미확인 사항과 결정 요청

아래에는 미확인 사항과 관련 위험의 관계를 등록한다. `OPEN-PAR-01`과 `OPEN-PAR-02`는 이번 개정에서 결정하지 않는다. 승인된 담당과 기한이 없어 모두 `미정`으로 기록한다.

- **(범위)** 위험 대장은 이번 작업에서 변경하지 않는다.

| ID | 상태 | 미확인 사항 또는 관계 | 영향 | 담당 | 기한 | 결정 요청 |
| --- | --- | --- | --- | --- | --- | --- |
| `OPEN-PAR-01` | `Unverified` | `E-16` 시행에 필요한 entry 등록·승인 절차의 설계와 승인 주체 | 원천기관 기본값과 허브 포괄 위임의 실행 정본 반영 절차 판정 불가 | 미정 | 미정 | 절차와 승인 주체 승인 |
| `OPEN-PAR-02` | `Unverified` | 승인 entry 0건으로 인한 release 차단의 해소 조건 | 운영 차단 해소 조건과 승인 증거는 판정 불가이며 release는 차단 상태로 유지 | 미정 | 미정 | 차단 해소 조건과 증거 승인 |
| `OPEN-PAR-03` | `Verified` | [`R-001`](../03-plan/risk-register.md#3-위험-목록)은 계약·재제공 권한 부재를 다루고 `E-16`의 entry 등록·승인 시행 공백은 담고 있지 않으므로 부분 중복 | 권리 부재와 시행 절차 부재의 범위 구분 | 미정 | 미정 | 없음 — 관계만 기록 |
