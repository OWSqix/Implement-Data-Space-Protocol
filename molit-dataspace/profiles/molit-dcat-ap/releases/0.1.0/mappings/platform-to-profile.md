# Platform Bridge v1과 응용 프로파일 0.1.0 교차표

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft

## 1. 판정

현재 `platform-metadata-batch/1`과 `connector-registration-candidate/1`은 응용 프로파일 입력 계약이 아니다. 현재 projection을 JSON-LD로 직렬화해도 DCAT-AP 3.0.1 적합 graph가 되지 않는다.

구체적인 차이는 다음과 같다.

- Catalog와 CatalogRecord가 없다.
- 문자열 title·description에 언어 tag가 없다.
- `accessRights`가 RightsStatement IRI가 아니라 문자열이다.
- `format`이 File Type IRI가 아니라 `CSV` 같은 문자열이다.
- Distribution에 공개 `dcat:accessURL`이 없다.
- Publisher IRI가 승인된 organization registry와 연결되지 않는다.
- 공간 범위, CRS, 망 버전과 품질 상태가 없다.
- Catalogue와 CatalogRecord에 기록할 profile version IRI가 없다.

따라서 Bridge v1 Dataset 후보에 `conformsTo MOLIT-DCAT-AP`를 덧붙여 적합성을 주장해서는 안 된다. Bridge v2가 Catalogue와 CatalogRecord를 만들고 SHACL을 통과한 뒤 그 레코드에 profile IRI를 기록한다.

## 2. 공개와 비공개 경계

| v1 field | 공개 RDF | 비공개 저장 |
| --- | --- | --- |
| `sourceBindingRef` | 금지 | source-binding store |
| `evidenceIds` | 금지 | approval·provenance store |
| `providerAuthority` | 원문 금지 | Passport·authority evidence |
| `connectorOperatorId` | 자동 공개 금지 | Connector registration |
| `deliveryOperatorId` | 자동 공개 금지 | delivery operations |
| `policyRef` | 내부 ID 금지 | policy registry |
| `transferFormat` | DCAT format으로 공개 금지 | DSP transfer mapping |

공개가 필요한 기관 역할은 내부 ID를 복사하지 않고 승인된 기관 IRI와 역할 vocabulary로 새로 투영한다.

## 3. 접근권한 변환

| v1 값 | DCAT 후보 | 추가 판정 |
| --- | --- | --- |
| `open` | `access-right/PUBLIC` | license와 법적 공개 범위 확인 |
| `registered` | `access-right/RESTRICTED` | 등록 조건을 policy와 Passport에 기록 |
| `restricted` | `access-right/RESTRICTED` | 기관·목적·기간 조건 확인 |
| `secure` | `access-right/RESTRICTED` | 원시 반출 금지와 분석환경 조건 확인 |
| `excluded` | `access-right/NON_PUBLIC` | public Dataset projection 금지 |

이 표는 기계적 변환 규칙이 아니다. 법무·보안 판정 결과가 다르면 더 제한적인 값과 비노출 결정을 적용한다.

## 4. Bridge v2 입력에 필요한 field

| 그룹 | 추가 field | 이유 |
| --- | --- | --- |
| 언어 | title·description·keyword별 language tag | 한국어 최소값과 다국어 중복 검증 |
| 기관 | registry IRI, 기관 유형, 공개 연락부서 | Agent range와 공개 연락처 |
| 주제 | source code, EU theme, MOLIT concept | 통제어 mapping 근거 보존 |
| 공간 | Location IRI, geometry 또는 BBOX, CRS IRI, disclosure level | GeoDCAT와 민감 공간정보 통제 |
| 시간 | start·end, temporal resolution, source timestamp 의미 | 관측기간과 수집시각 분리 |
| 교통망 | issuer, network ID, version, element type, transport mode | ID 충돌과 잘못된 연결 방지 |
| 품질 | status, metric, value, unit, measuredAt | 상태와 측정값 분리 |
| 배포 | accessURL, downloadURL, File Type IRI, media type, availability | DCAT Distribution 적합성 |
| 프로파일 | Catalogue·CatalogRecord용 exact version IRI | 재현 가능한 메타데이터 적합성 판정 |

## 5. 연동 순서

1. Platform Bridge v1 discovery 흐름을 유지한다.
2. v2 canonical metadata 계약을 별도로 추가한다.
3. v2 record를 RDF graph로 투영한다.
4. release lock과 fatal UTF-8을 확인하고 공개 graph preflight를 실행한다.
5. 일반 graph는 `core`, 국토교통 공간 term·GeoDCAT property·GeoSPARQL class/property graph는 `geo`를 선택한다. CRS를 명시한 DCAT bbox·centroid coverage literal은 Core 예외로 둔다.
6. 선택한 SHACL과 publication validation policy를 실행한다.
7. graph byte digest, profile bundle digest, validator build digest와 validation report digest를 review candidate에 연결한다.
8. profile이 바뀌면 기존 graph를 전량 재투영하고 다시 승인한다.

DSP wire message와 DCAT RDF export를 하나의 JSON 객체로 합치지 않는다. Connector registration은 검증된 graph의 IRI와 digest만 참조한다.

## 6. 기계 판독 교차표

행 단위 mapping 상태와 Gate는 [platform-field-crosswalk.csv](platform-field-crosswalk.csv)에 기록했다. `blocked` 행이 하나라도 남은 v1 record는 0.1.0 적합 게시물로 승격하지 않는다.
