# 규범 요구사항 추적 원장

## 1. 목적과 범위

`profile-requirements.json`은 응용 프로파일 규격, 로컬 SHACL 제약과 적합성시험 fixture를 한 행으로 연결한다. SHACL 파일에 제약을 추가하고 원장이나 시험사례를 빠뜨리는 변경은 release Gate를 통과하지 못한다.

원장이 추적하는 대상은 다음과 같다.

- 버전 namespace에 속하는 로컬 `sh:NodeShape`
- 로컬 `sh:PropertyShape`
- 로컬 shape에서 `sh:property`로 직접 연결한 property constraint
- 위 제약의 양성 fixture와 표적 음성 fixture

DCAT-AP와 GeoDCAT-AP의 고정 upstream shape는 로컬 requirement 행으로 복제하지 않는다. 로컬 스캐너는 `manifest.json`이 참조하는 Turtle 파일 중 로컬 shape namespace가 나타난 파일만 읽는다.

대신 별도 upstream 원장을 `includedRequirementRegistries`로 결합한다. 따라서 출처는 분리하지만 최종 Gate는 로컬과 upstream coverage를 한 번에 판정한다.

`sh:or`, `sh:not`, `sh:node`와 qualified shape 안에서만 사용하는 property shape는 독립 MUST로 세지 않는다.  
검증: traceability Gate에서 보조 노드의 별도·충돌 requirement ID가 0건이어야 한다.

이 보조 노드는 가장 가까운 named shape 또는 직접 property requirement ID를 상속한다. 보조 노드가 다른 ID로 의미를 덮어쓰면 Gate가 거부한다.

## 2. 파일

| 파일 | 역할 |
| --- | --- |
| `profile-requirements.json` | 요구사항과 shape의 machine register |
| `profile-requirements.csv` | JSON 정본에서 생성한 사람 검토용 열 projection |
| `source-overrides.json` | 채택 판단을 다시 확인해야 하는 constraint의 출처·조항·로컬 강화 이유 |
| `local-normative-clauses.json` | 외부 source override가 없는 로컬 requirement의 규범 문장과 채택 이유를 1:1로 고정한 조항 원장 |
| `upstream-requirement-inventory.json` | 고정 upstream constraint, 원본 locator, 격리 증거와 coverage 합계 |
| `upstream-profile-requirements.csv` | upstream JSON 원장이 digest로 고정한 사람 검토용 projection |
| `conformance-cases.json` | fixture case, digest와 예상 결과의 machine register |
| `coverage-blockers.json` | `RA-REQUIREMENTS`의 로컬 미충족 목록과 integrated coverage 합계 |
| `network-runtime-controls.json` | SHACL 한 노드만으로 판정할 수 없는 NetworkReference 집합 제약과 lifecycle case 연결 |
| `../../../../../contracts/profile-requirements.v1.schema.json` | 원장 JSON Schema |
| `../../../../../tools/profile/verify-requirement-traceability.mjs` | SHACL·원장·fixture 교차검증기 |
| `../../../../../tools/profile/build-requirement-evidence.mjs` | 양성 case 검증, 표적 mutation 생성과 coverage 재계산 |
| `../../../../../tests/contract/profile-requirement-traceability.test.mjs` | Gate의 양성·음성 contract test |

`profile-requirements.json`의 `fixtureCaseRegistry`가 `conformance-cases.json`을 가리킨다. 두 파일의 profile version과 manifest 경로가 일치해야 한다.

CSV는 `requirementId`, `conformanceClass`, `resourceClass`, `property`, `obligation`, `minCount`, `maxCount`, `range`, `controlledVocabulary`, `severity`, `messages`, `remediation`, 출처 3개 필드, shape·fixture 식별자를 이 순서로 기록한다. 배열은 한 셀 안의 JSON 배열로 보존한다. CSV를 직접 고치지 않고 JSON 정본과 생성 명령을 고친다.

## 3. 요구사항 행

| 필드 | 기록 내용 |
| --- | --- |
| `requirementId` | SHACL constraint에 적은 고유 `molit:requirementId` |
| `constraintKey` | source file과 constraint 위치를 묶은 machine locator |
| `constraintKind` | `node-shape`, `property-shape`, `direct-property-constraint` 중 하나 |
| `conformanceClass` | 이 shape 파일을 사용하는 manifest profile 이름 |
| `resourceClass` | `sh:targetClass`에서 확인한 대상 class IRI |
| `property` | `sh:path`의 IRI 또는 정규화한 복합 경로. NodeShape에는 `null`을 기록할 수 있음 |
| `obligation` | `MUST`, `MUST-NOT`, `SHOULD`, `SHOULD-NOT`, `MAY` 중 하나 |
| `cardinality` | 직접 `sh:minCount`와 `sh:maxCount`로 확인되는 최소·최대 수 |
| `range` | 직접 `sh:class`, `sh:datatype`, `sh:nodeKind`로 확인되는 IRI |
| `vocabulary` | 직접 `sh:in` 또는 `sh:hasValue`로 고정한 IRI |
| `severity` | SHACL severity. 생략 시 `Violation` |
| `messages` | constraint의 실제 `sh:message`. 언어 태그와 본문을 함께 기록함 |
| `remediation` | 위반값에서 고칠 property, 개수, datatype, class 또는 허용 IRI를 적은 수정 절차 |
| `sourceStandard` | 요구사항을 가져온 표준·행정규칙·로컬 정책 이름 |
| `sourceClause` | 원문 조항이나 로컬 규격 조항 |
| `localRationale` | 상위 규격보다 강화·축소·분기한 이유 |
| `shapeId` | named shape IRI. blank property constraint에는 이를 소유한 named shape IRI |
| `shapeFile` | constraint를 선언한 release-relative Turtle 경로 |
| `positiveFixtureId` | 이 요구사항을 충족하는 case ID |
| `negativeFixtureId` | 검증 결과에 이 요구사항의 위반을 실제 포함한 case ID |

`constraintKey`는 blank node 식별자를 공개 식별자로 사용하지 않는다. blank property constraint는 source file, 소유 shape와 해당 파일의 `sh:property` 순번으로 찾는다. SHACL 구조를 바꾸면 초안을 다시 만들고 변경된 locator를 심사한다.

## 4. Fixture case

각 case는 release 아래의 고정 파일 한 개를 가리킨다. `sha256`이 파일 바이트를 고정한다.

- 양성 case는 `expectedOutcome=conforms`이며 `expectedRequirementIds`가 비어 있어야 한다.
- 음성 case는 `expectedOutcome=violates`이며 표적으로 실패할 ID를 `expectedRequirementIds`에 기록한다.
- `atomicConditionFamilyIds`는 SHACL result의 `sourceShape`에서 가장 가까운 독립 requirement ID를 하나만 기록한다. `sh:NodeConstraintComponent`의 detail child는 wrapper 대신 child family로 정규화한다. 서로 독립된 top-level result는 같은 owner IRI를 쓴다는 이유로 합치지 않는다.
- `validationMode=profile`은 선택 profile 전체를 실행한다. 등록되지 않은 upstream·unknown result가 함께 나오거나 독립 family가 둘 이상이면 이 case는 음성 증거가 아니다.
- `validationMode=constraint-unit`은 전체 profile에서 원자적으로 분리할 수 없을 때만 쓴다. 검증기가 원본 constraint와 owner target으로 test-only shape를 다시 구성한다. 발행 bundle은 바꾸지 않는다. 이 mode는 음성 case 한 개와 `targetRequirementId` 한 개만 허용한다.
- `coversRequirementIds`는 해당 파일이 시험하는 전체 요구사항을 기록한다.
- 요구사항 행의 양성·음성 case ID와 case의 coverage가 서로를 가리켜야 한다.

파일 존재와 digest, case ID, 역방향 coverage는 추적 Gate에서 검사한다. Gate는 여기서 멈추지 않고 모든 case를 지정 profile SHACL에 다시 실행한다.

실제 outcome, owner를 포함한 requirement ID와 nearest-sourceShape atomic family가 원장과 다르면 digest가 맞아도 실패한다. requirement가 음성 증거로 가리키는 case는 atomic family가 정확히 하나여야 한다.

## 5. 로컬 정책과 EU 진단의 경계

주기, EU File Type, EU language, Distribution status와 Availability는 Core 적합성 조건이 아니다. DataService의 EU theme·access-right 목록도 같은 원칙을 적용한다.

이 값은 공식 upstream `mdr-vocabularies`를 사용하는 `eu-controlled-audit`에서 진단한다. 국내 발행 어휘가 정해지기 전에는 EU 목록을 Core MUST로 고정하지 않는다.
검증: Core profile의 로컬 shape에는 위 EU 전용 allowlist가 없어야 한다. `eu-controlled-audit`에는 upstream `mdr-vocabularies.shape.ttl`이 남아 있어야 한다.

Core에는 다음 조건을 남겼다.

- Dataset과 DataService는 국토교통 세부 주제를 한 개 이상 가짐
- Dataset accessRights는 값 한 개와 IRI 형식만 검사함
- checksum 알고리즘·길이와 IANA media type은 전송 무결성 조건으로 검사함
- 한국어 검색·표시 필드와 단일 publisher 조건을 검사함

`source-overrides.json`은 외부 표준·발행정책을 직접 채택한 조건의 출처·조항·강화 이유를 requirement ID별로 고정한다. 나머지 로컬 조건은 `local-normative-clauses.json`에 같은 ID의 정식 local clause가 있어야 한다.

이 원장은 SHACL message에서 고정한 규범 문장과 채택 이유를 가진다. ID를 `sourceClause`에 되풀이하기만 하고 조항 원장 행이 없는 fallback은 승인할 수 없다.

## 6. 증거와 blocker 재계산

다음 명령은 기존 양성 module fixture를 검증하고 property·node requirement에 적용할 mutation을 실행한다.

먼저 전체 profile에서 목표 ID 하나만 실패하는 후보를 찾는다. 다른 leaf나 등록되지 않은 result가 함께 나오면 버리고, 같은 후보 풀을 constraint-unit lane에서 다시 검사한다.

두 lane에서 모두 격리하지 못한 requirement는 blocker로 남긴다.

```bash
npm run profile:requirements:evidence
```

명령은 다음 파일을 함께 갱신한다.

- `profile-requirements.json`과 `profile-requirements.csv`
- `conformance-cases.json`과 `coverage-blockers.json`
- `examples/invalid/mutation-*.ttl`

요구사항·case·atomic mutation과 잔여 blocker 수는 `coverage-blockers.json`에서 매번 다시 계산한다. 서로 다른 leaf 조건을 함께 깨는 mutation은 coverage로 세지 않는다.

독립 결과를 만들지 않는 순수 container NodeShape는 규범 requirement에서 제외하거나 한 descendant family의 owner로만 귀속해야 한다.

음성 case의 `expectedRequirementIds`에는 실제 SHACL 결과에서 해당 source shape와 소유 NodeShape까지 추적한 ID를 모두 남긴다. `atomicConditionFamilyIds`에는 nearest leaf만 남긴다.

한 property 변경이 역방향 링크나 별도 의미 조건까지 깨뜨려 family가 둘 이상이면 해당 requirement의 격리 증거로 사용할 수 없다.

양성·음성 증거가 모두 있는 requirement만 완전 coverage로 계산한다. 한쪽이라도 없으면 원장 상태를 `draft`로 유지하고 `coverage-blockers.json`에 requirement ID와 누락 종류를 기록한다.

고정된 개수를 문서에 적어 승인 상태를 주장하지 않는다. Gate가 현재 SHACL, case와 포함 원장을 다시 읽어 계산한 값만 사용한다.

## 7. 초안 갱신

다음 명령은 현재 RC의 manifest와 SHACL을 읽어 두 초안을 표준출력으로 만든다.

```powershell
node tools/profile/verify-requirement-traceability.mjs --draft |
  Set-Content -Encoding utf8 profiles/molit-dcat-ap/releases/1.0.0-rc.1/requirements/profile-requirements.json

node tools/profile/verify-requirement-traceability.mjs --draft-cases |
  Set-Content -Encoding utf8 profiles/molit-dcat-ap/releases/1.0.0-rc.1/requirements/conformance-cases.json
```

초안은 다음 값을 의도적으로 미확정 상태로 둔다.

- SHACL에 ID가 없는 constraint에는 `MOLIT-DRAFT-*` 임시 ID를 부여함
- `sourceStandard`, `sourceClause`, `localRationale`에 검토 표식을 둠
- 양성·음성 fixture 연결을 `null`로 둠
- 두 원장의 `registryStatus`를 `draft`로 둠

자동 생성 결과를 그대로 승인하지 않는다. 원문 조항과 fixture 결과를 검토하고 SHACL의 `molit:requirementId`를 맞춘 뒤 두 원장의 `registryStatus`를 `approved`로 바꾼다.

## 8. Gate 실행

```bash
node tools/profile/verify-requirement-traceability.mjs
```

합격 조건은 다음과 같다.

1. 로컬 NodeShape, PropertyShape와 직접 property constraint가 각각 정확히 하나의 고유 requirement ID를 가짐
2. 스캔한 constraint와 원장 행이 `constraintKey` 기준으로 일대일 대응함
3. SHACL에서 계산한 profile, class, path, cardinality, range, vocabulary와 severity가 원장 값과 같음
4. 원장이 `approved` 상태이며 검토 표식이나 빈 fixture 연결이 없음
5. fixture case ID, 파일, digest, outcome과 양방향 requirement 연결이 모두 유효함
6. 모든 fixture를 SHACL에 재실행한 outcome·sourceShape requirement·atomic family가 원장과 일치하고 requirement별 음성 fixture가 family 하나만 위반함
7. `profile-requirements.csv`의 행과 열 값이 JSON 정본의 projection과 byte 단위로 일치함
8. 필수 source override 또는 승인된 local normative clause가 1:1로 존재하고 JSON 원장의 출처·조항·로컬 이유와 일치함

## 9. Upstream 권위 원장 결합

`upstream-requirement-inventory.json`은 고정한 DCAT-AP 3.0.1, GeoDCAT-AP 3.1.0과 publication-policy constraint를 로컬 requirement와 분리해 기록한다.

각 행은 권위 원본의 shape 파일과 locator를 유지한다. `localRationale`은 원문을 변경 없이 채택했는지, inert 폐기 행을 로컬 정책으로 운용했는지만 설명하며 원본 constraint의 출처나 내용을 바꾸지 않는다.

Upstream 음성 증거는 원본 PropertyShape마다 test-only target을 붙인 격리 shard에서 실행한다. Blank property shape는 원본 quad와 동등한 결정적 skolem copy를 사용한다.

폐기 URI 파일처럼 원본에 실제 constraint component가 없는 항목은 upstream constraint로 세지 않고 로컬 publication-policy wrapper로 분리한다.

`profile-requirements.json`의 `includedRequirementRegistries`는 포함 원장의 경로, schema version, SHA-256, CSV 경로·SHA-256, requirement 수, 완전 coverage 수와 blocker 수를 고정한다.

`integratedCoverage`는 로컬 원장과 포함 원장의 합계를 기록한다. 검증기는 포함 원장과 CSV를 다시 읽어 digest와 합계를 계산한다.

파일이 바뀌었거나 blocker가 하나라도 남으면 로컬 fixture가 모두 연결되어 있어도 통합 원장을 승인하지 않는다.

현재 포함 원장은 upstream requirement 990개와 각 requirement의 격리 양성·음성 증거를 기록한다. 이 수는 설명용 현재 값이다. 승인 조건에는 990을 상수로 넣지 않는다. Gate는 원장 행 수, `isolatedPositive`, `isolatedNegative`, `blockers`, status와 digest를 매번 대조한다.

합격은 exit code `0`, 추적성 위반은 `2`, 입력·구성 오류는 `1`을 반환한다. `--allow-draft`는 원장 편집 중 진단에만 사용한다. release Gate에서는 사용하지 않는다.
