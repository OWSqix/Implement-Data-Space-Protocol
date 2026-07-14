# MOLIT 메타데이터를 EDC Offering으로 게시하는 경계

목적: MOLIT DCAT-AP 검증을 통과한 메타데이터와 EDC의 Asset·Policy Definition·Contract Definition을 섞지 않고 연결하는 게시 절차를 고정한다.

작성일: 2026-07-13
상태: EDC Management API v4 Adapter와 격리 시험 구현 완료, 기관 운영 Connector 실증 전

## 1. 목적과 구현 범위

`src/bridge-runtime/edc-v4-management-client.mjs`는 EDC 0.18.0 Management API v4에 다음 자원을 순서대로 등록한다.

1. 접근 Policy Definition
2. 계약 Policy Definition
3. Asset와 DataAddress
4. 해당 Asset만 선택하는 Contract Definition

MOLIT DCAT-AP는 데이터셋 설명 규격이다. EDC Asset JSON, ODRL 계약 정책, DataAddress를 대신하지 않는다.

EDC Asset 등록 성공도 MOLIT DCAT-AP 적합성을 뜻하지 않는다. Bridge는 SHACL Gate 결과와 승인 digest를 먼저 확인한 뒤 이 Adapter를 호출한다.

EDC 0.18.0의 안정 Management API 기준은 v4다. `/v5beta/participants/{participantContextId}` 계열은 가상 다중 tenant 후보 API이므로 이 Adapter에서 사용하지 않는다.

## 2. 입력 계약

입력 Schema는 `contracts/edc-v4-publication.v1.schema.json`이다. 작성 예시는 `fixtures/runtime/edc-v4-publication.example.json`에 있다.

게시 의도에는 다음 객체가 필요하다.

| 객체 | 필수 내용 | Adapter가 추가하거나 고정하는 내용 |
| --- | --- | --- |
| `asset` | 결정적 ID, 공개 속성, HTTP 원천 주소 | Management v4 context, 검증한 메타데이터 digest와 profile 정보 |
| `accessPolicy` | 결정적 ID, untargeted ODRL Set | 게시 소유권 marker |
| `contractPolicy` | 결정적 ID, untargeted ODRL Set | 게시 소유권 marker |
| `contractDefinition` | 결정적 ID | 두 Policy ID와 Asset ID 동등 조건 |

호출자가 `assetsSelector`를 직접 넣을 수 없게 했다. Adapter가 다음 조건을 만든다.

```json
{
  "@type": "Criterion",
  "operandLeft": "id",
  "operator": "=",
  "operandRight": "urn:molit:asset:road-traffic-speed-seoul-v1"
}
```

이 조건이 없으면 하나의 Contract Definition이 의도하지 않은 다른 Asset까지 공개할 수 있다.

## 3. DCAT-AP에서 EDC Asset으로 옮기는 값

EDC Catalog에 전체 RDF graph를 복제하지 않는다. 소비자가 검색과 원문 확인에 필요한 값만 Asset 공개 속성으로 옮기고, 정본은 `metadataIri`가 가리키는 MOLIT DCAT-AP 표현으로 남긴다.

| MOLIT 메타데이터 또는 검증 증거 | EDC Asset 공개 속성 | 정보 손실 처리 |
| --- | --- | --- |
| 대표 제목 | `name` | 한 개 대표 문자열만 게시한다. 다국어 전체 값은 RDF 정본에 남긴다. |
| 대표 설명 | `description` | 요약만 게시한다. 상세 설명은 RDF 정본에 남긴다. |
| Distribution media type | `contenttype` | 실제 전송 응답의 Content-Type과 별도로 시험한다. |
| 메타데이터 정본 IRI | `metadataIri` | HTTPS IRI만 허용한다. |
| 검증 입력 SHA-256 | `molitMetadataSha256` | Bridge 검증 결과에서 주입한다. 호출자가 덮어쓸 수 없다. |
| 적합성 class와 버전 | `molitProfileName`, `molitProfileVersion` | Bridge 검증 결과에서 주입한다. |
| 검증 결정 digest | `molitValidationDecisionDigest` | 승인한 검증 결정과 동일한지 dispatch 전에 확인한다. |
| 주제·공간·시간·품질·계보 전체 | 직접 평탄화하지 않음 | `metadataIri`의 RDF graph에서 보존한다. |

ODRL Policy Definition은 DCAT-AP의 라이선스 문장과 같은 객체가 아니다. 라이선스·접근권 메타데이터는 데이터셋 설명에 남기고, 실제 계약 조건은 별도 정책 심의 결과로 만든다.

## 4. 재시도와 부분 실패

EDC Management API v4가 `Idempotency-Key`를 보장한다고 가정하지 않는다. 따라서 이 Adapter는 해당 header를 보내지 않고 POST를 자동 재시도하지 않는다.

각 자원에는 결정적 ID와 다음 private marker를 넣는다.

```text
molitManagedBy
molitResourceDigest
```

`molitResourceDigest`는 private marker를 제외한 자원 본문의 stable digest다. 내용이 같은 공통 Policy는 여러 Asset 게시에서 재사용할 수 있지만, 같은 ID에 다른 Policy를 넣을 수는 없다.

게시 순서는 Policy, Asset, Contract Definition이다. 마지막 Contract Definition이 만들어지기 전의 부분 상태는 Catalog offer를 완성하지 못한다.

네트워크 단절 뒤 다시 실행하면 먼저 GET으로 자원을 읽는다. Adapter는 marker뿐 아니라 다음 관리 대상 본문도 비교한다.

- Policy 본문
- Asset 공개 속성과 DataAddress
- Contract Definition의 두 Policy ID와 Asset selector

모든 값이 처음 게시한 값과 같아야 이미 처리한 단계로 인정한다. marker만 남기고 본문을 바꾼 경우에도 `EDC_PUBLICATION_CONFLICT`로 중단한다.

기존 자원을 자동 삭제하거나 덮어쓰지 않는다.

동시 생성으로 POST가 `409`를 반환한 경우에도 GET 결과의 marker를 다시 확인한다. Adapter가 소유하지 않은 자원을 보상 삭제하면 기존 계약을 훼손할 수 있으므로 삭제 기반 보상은 사용하지 않는다.

## 5. DataAddress 보안 규칙

초기 Adapter는 EDC `HttpData` 원천만 받는다. `baseUrl` origin은 `management.allowedDataOrigins`에 정확히 등록되어야 한다. HTTP 원천은 `allowHttpData=true`를 명시한 시험·폐쇄망 구성에서만 허용한다.

원천 인증값은 게시 JSON에 넣지 않는다.

- `authCode`, bearer token, API key 값, Cookie, 임의 header는 거부한다.
- `authKey`에는 `authorization`, `x-api-key`, `api-key`, `x-auth-token`, `ocp-apim-subscription-key`만 넣는다. 이름은 소문자로 고정한다.
- `secretName`에는 상대 경로 형식의 EDC Data Plane Vault alias만 넣는다. 빈 segment, `.`·`..`, 절대 경로와 scheme은 거부한다.
- `authKey`와 `secretName`은 함께 있어야 한다.
- URL userinfo와 fragment는 거부한다.
- 고정 query는 `management.allowedDataQueryParameters`에 등록한 이름만 받는다.
- query 이름과 반복 디코딩한 값에서 인증 scheme, credential 대입식, 서명 parameter, URL userinfo를 검사한다.
- `path`는 반복 디코딩한 뒤 authority 변경, `.`·`..`, encoded slash·backslash와 origin 변경을 거부한다.

Vault alias가 있다는 사실만으로 egress가 안전해지지는 않는다. 운영 Data Plane에는 DNS 재결합을 고려한 egress allowlist, redirect 차단, 응답 크기와 timeout, 내부 주소 정책을 별도로 적용한다.

## 6. Bridge 설정

설정 예시는 `fixtures/runtime/config.edc-v4.example.json`이다.

```json
{
  "management": {
    "adapter": "edc-v4",
    "baseUrl": "https://connector-management.example.go.kr/management/",
    "allowedDataOrigins": ["https://platform.example.go.kr"],
    "allowedDataQueryParameters": ["format", "page"],
    "auth": {
      "type": "api-key",
      "env": "MOLIT_EDC_MANAGEMENT_API_KEY",
      "header": "x-api-key"
    }
  }
}
```

`baseUrl`은 EDC Management API root다. Adapter는 그 아래의 `v4/assets`, `v4/policydefinitions`, `v4/contractdefinitions`만 호출한다. API key 값은 환경 변수나 배포 secret store에서 주입하고 설정 파일에 기록하지 않는다.

## 7. 시험 범위

`tests/unit/edc-v4-publication.test.mjs`는 다음 조건을 고정한다.

- 네 자원의 생성 순서와 Management v4 경로
- Contract Definition의 단일 Asset 선택 조건
- 검증 메타데이터 digest 주입
- 원문 credential 비저장
- 두 번째 실행의 GET 기반 재조정
- 동시 생성 `409`의 소유권 확인
- 다른 게시가 소유한 ID 충돌 차단
- DataAddress origin과 credential 차단
- presigned URL의 `sig`·`signature`·`code`·`key` 계열 query 차단
- `metadataIri`의 userinfo·query·fragment 차단
- 게시 의도와 Bridge 설정의 JSON Schema 적합성
- 소유권 marker를 유지한 Policy·Asset·DataAddress·selector 변조 차단
- Management API 응답은 plain key, `edc:` key와 EDC 공식 namespace만 같은 필드로 해석하고 충돌 alias를 차단
- `target`, `odrl:target`, 전체 ODRL target IRI와 로컬 `@context` alias 차단

이 시험은 HTTP fixture를 사용한 Adapter 계약 시험이다. 실제 EDC 두 인스턴스의 Catalog·계약·전송 시험은 `deploy/edc`와 `tools/edc`에서 별도로 실행한다. 같은 EDC 구현 두 개가 통과한 결과는 교차 구현 상호운용 증거가 아니다.

## 8. 운영 전 남은 조건

1. 기관이 승인한 EDC Management endpoint와 API 인증 방식을 설정한다.
2. 운영 Vault에 `secretName` alias를 만들고 값 조회 권한을 Data Plane별로 분리한다.
3. 실제 MOLIT DCAT-AP 레코드에서 공개 속성 projection과 손실표를 표본 검증한다.
4. EDC Catalog에서 `metadataIri`와 profile 증거가 보존되는지 확인한다.
5. 계약 체결 뒤 실제 응답 byte, Content-Type, SHA-256을 검증한다.
6. 외부 DSP 구현과 Catalog·계약·전송 시험을 수행한다.

## 9. 공식 근거

- EDC 0.18.0 release: <https://github.com/eclipse-edc/Connector/releases/tag/v0.18.0>
- EDC 0.18.0 source: <https://github.com/eclipse-edc/Connector/tree/911a22ba6b90688ffeb35bb92bf5cc040ffdf37f>
- EDC Management API: <https://eclipse-edc.github.io/Connector/openapi/management-api/>
- EDC Management v4 Asset Schema: <https://w3id.org/edc/connector/management/schema/v4/asset-schema.json>
- EDC Management v4 Policy Definition Schema: <https://w3id.org/edc/connector/management/schema/v4/policy-definition-schema.json>
- EDC Management v4 Contract Definition Schema: <https://w3id.org/edc/connector/management/schema/v4/contract-definition-schema.json>
