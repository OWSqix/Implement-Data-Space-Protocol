# Metadata Field 관찰 매트릭스

관찰일: 2026-07-11 한국 표준시(Korea Standard Time, KST)  
증거 등급: `OBS-NET`, `DOC-UI`

## 1. 범위

- **(Verified)** 대표 공개 Dataset 상세 한 건의 정상 route와 `/api/search/detail/{recordId}` 응답에서 field 이름과 자료형 구조를 확인
- **(수집 제외)** 값, 담당자 연락처, 원시 JSON과 다운로드 payload는 수집하지 않음
- **(Inferred)** 표의 canonical mapping은 구현 확정안이 아닌 후보
- **(Unverified)** 단일 페이지 애플리케이션(Single-Page Application, SPA) 내부 endpoint의 공식 수집 API 지위와 schema 안정성은 확인하지 않음
- **(적용 제한)** 운영기관의 공식 계약을 확보하기 전에는 해당 endpoint를 수집 interface로 사용하지 않음

## 2. 상세 화면 Field Group

| 관찰 group | 주요 field 이름 | canonical mapping 후보 | 판정 전 확인 |
| --- | --- | --- | --- |
| `resource` | `identifier`, `title`, `description`, `accessRights`, `license`, `rights`, `issued`, `modified`, `language`, `publisher`, `type`, `landingPage` | `dct:identifier`, `dct:title`, `dct:description`, `dct:accessRights`, `dct:license`, `dct:rights`, 날짜, 언어, 유형, landing page | code·날짜 datatype, license URI, publisher 식별자 |
| `agent` | 기관명·약칭·homepage와 contact 관련 field | `dct:publisher` 또는 source organization 후보 | 표시기관과 계약권한 Provider가 같은지, 연락처 공개범위 |
| `system` | 시스템명, 담당부서, 공개상태, keyword와 URL 관련 field | provenance, source system, landing page 후보 | public·internal URL 구분, 운영 owner |
| `dataset` | `accrualPeriodicity`, temporal start·end·resolution, spatial geometry·bbox·centroid·resolution, `reference` | DCAT temporal·spatial·frequency와 reference 후보 | 빈 값 허용, CRS·axis·단위, geometry encoding |
| `distributions` | Distribution 배열 | `dcat:distribution` 후보 | 대표 record에서는 항목이 없었음; 전체 record로 일반화 금지 |
| `keywords`·`concepts` | keyword와 분류 concept | `dcat:keyword`, `dcat:theme` 후보 | controlled vocabulary URI와 version |
| `metaData` | table·column·source system 관련 field | schema·lineage 내부 metadata 후보 | 공개 가능 범위와 공식 schema 여부 |

field가 존재한다는 사실과 값이 채워져 있다는 사실은 다르다. 대표 record의 빈 값은 플랫폼 전체의 결손율을 뜻하지 않는다.

## 3. Open API Mapping 후보

| Open API field | DCAT 후보 | 보강 필요 |
| --- | --- | --- |
| `title`, `description` | `dct:title`, `dct:description` | 다국어·길이·HTML 규칙 |
| `publisherNm`, `creatorNm` | `dct:publisher`, `dct:creator` | 문자열 대신 기관 registry ID |
| `keyword`, `conceptName` | `dcat:keyword`, `dcat:theme` | taxonomy URI·version |
| `language` | `dct:language` | IETF language tag 또는 URI |
| `landingPage`, `urlOutr`, `detailPage` | landing page·DataService·Distribution 후보 | URL 역할을 구분해야 함 |
| `license`, `accessRights` | `dct:license`, `dct:accessRights` | license URI, rights code mapping과 법적 검토 |
| temporal start·end | `dct:temporal` | timezone, open interval과 datatype |
| `issued`, `modified` | `dct:issued`, `dct:modified` | wire datatype과 변경 의미 |

## 4. 확인된 Gap

- **(Unverified)** Open API 문서 field만으로 stable Dataset identifier와 source record ID를 확정할 수 없음
- **(Unverified)** Distribution의 media type, schema, endpoint 역할, checksum과 version이 부족함
- **(Unverified)** Spatial extent, CRS, axis order와 공간 해상도는 read API 문서 field에서 확인되지 않음
- **(Inferred)** Provider 계약권한, 재제공, cache·proxy 허용 여부는 metadata 문자열만으로 판정할 수 없음
- **(Unverified)** Bulk·delta cursor, 삭제 tombstone과 schema 변경통지가 확인되지 않음

이 gap이 해결되지 않으면 Open API record는 `catalog-only` 또는 `unverified`로 유지하고 전송 Offer를 생성하지 않는다.
