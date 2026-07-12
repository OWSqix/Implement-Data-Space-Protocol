# Provider 권한 레지스트리

작성일: 2026-07-12  
상태: Working Draft / 외부 권한증거 대기

## 1. 목적

Connector를 운영한다는 사실만으로 Dataset의 Offering Provider가 되지는 않는다. 플랫폼 운영자, 원 보유기관, 계약 당사자와 전송 운영자는 서로 다른 역할이다.

Provider 권한 레지스트리는 참가자가 특정 source의 특정 asset에 대해 다음 행위를 수행할 법적·행정적 권한이 있는지를 기록한다.

- Catalog 게시
- DSP 계약협상
- 데이터 전송
- 제3자 위임

정본은 [`standards/provider-authority-registry.json`](../../standards/provider-authority-registry.json)이다. 현재 정본에는 승인 entry가 없으며 `releaseDecision=blocked-no-approved-authority`다.

## 2. 권한 entry

계약은 [`contracts/provider-authority-registry.v1.schema.json`](../../contracts/provider-authority-registry.v1.schema.json)에서 정의한다.

| 묶음 | 필드 | 판정 목적 |
| --- | --- | --- |
| 주체 | `participantId`, `providerId`, `legalEntityName` | 참가자와 권한 주체를 구분 |
| 범위 | `sourceSystemId`, `assetIds`, `allowedActions` | 플랫폼 전체 포괄승인을 금지 |
| 역할 | `roles` | 원 보유자·위임 Provider·플랫폼·Connector 역할 분리 |
| 근거 | `basis.kind`, `issuerId`, `subjectId`, `evidenceId` | 소유·위임·법정 권한의 발행자와 수임자 확인 |
| 고정본 | `artifactSha256`, `artifactLocator` | 계약·결정문 원문을 evidence vault에서 식별 |
| 유효기간 | `effectiveFrom`, `validUntil` | 미래·만료 권한 차단 |
| 철회 | `revocationStatus`, `revocationCheckedAt` | 정지·철회 권한 차단 |
| 승인 | `decision`, `approval` | 승인자·서명·독립 확인 기록 |

`assetIds`의 wildcard는 허용하지 않는다. source와 Provider가 같아도 asset별 권한 근거가 없으면 별도 entry가 필요하다.

## 3. 실행 판정

[`src/governance/provider-authority.mjs`](../../src/governance/provider-authority.mjs)는 다음 순서로 판정한다.

1. registry 구조와 시간관계, 중복 ID를 검사한다.
2. participant, Provider, source, asset과 action이 모두 같은 entry를 한 건 찾는다.
3. 승인·서명 확인·철회 상태와 유효기간을 검사한다.
4. 두 건 이상이면 `AUTHORITY_AMBIGUOUS`, 없으면 `AUTHORITY_NOT_FOUND`로 거부한다.
5. 모든 조건을 통과한 경우에만 `authorityId`, `evidenceId`, `validUntil`을 반환한다.

현재 Discovery Bridge의 `synthetic-test-only` approval은 이 레지스트리를 대신하지 않는다. production 연결은 Provider 권한 정본과 runtime signature verification을 추가한 뒤 별도 ADR로 활성화한다.

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

운영기관은 다음 자료를 evidence vault에 제공해야 한다.

1. 원 보유기관과 데이터셋 식별자
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
- 범위 밖 asset과 만료시각 요청
- timezone 없는 시각, 문자열 `0`, 존재하지 않는 달력 날짜
- request·asset·action·evidence·검증자·PEP가 receipt와 다른 경우
- 서명 projection이나 detached proof 참조·digest가 서명 뒤 바뀐 경우
- host 없는 HTTPS 값, userinfo·잘못된 percent encoding과 DID URL
- URI처럼 보이는 source·asset·trust anchor·key local ID

구조와 fail-closed resolver는 구현했지만 실제 기관 entry가 없으므로 `BS-AUTHORITY-REGISTRY`는 해소되지 않았다.
