# MOLIT DCAT-AP 1.0.0-rc.1 구현 해설

작성일: 2026-07-13
적용판: 1.0.0-rc.1
상태: 구현자용 비규범 해설

이 문서는 국토교통 메타데이터 응용 프로파일(MOLIT DCAT-AP) 후보판을 실제 카탈로그와 Bridge에 적용하는 순서를 설명한다. 규범 문구는 release의
[`index.md`](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/index.md),
[`CONFORMANCE.md`](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/CONFORMANCE.md),
`manifest.json`, 요구사항 원장과 SHACL을 따른다.

## 1. 적용 범위와 판정 경계

### 1.1 이 프로파일이 정하는 것

MOLIT DCAT-AP는 데이터 파일의 열 이름이나 API 응답 본문을 정하지 않는다. 카탈로그에서 Dataset, Distribution, DataService와 국토교통 분야의 공간·교통망·관측·품질 정보를 RDF로 기술하는 방법을 정한다.

다음 정보가 규범 대상이다.

- Catalog와 CatalogRecord가 같은 Dataset 집합을 가리키는 관계
- Dataset의 식별자, 한국어 제목·설명, 발행기관, 분야 분류와 접근권한
- Distribution의 배포 형식, media type, 접근·다운로드 주소와 checksum
- DataService의 공개 endpoint와 제공 Dataset
- 공간 공개수준, 좌표참조체계와 제한된 geometry 표현
- 교통망의 발급기관, 망 식별자, 판, checksum과 생명주기
- 교통 관측의 대상, 항목, 집계, 결측 처리와 단위
- DQV 품질 측정과 원천 품질정보를 옮길 때의 손실 기록
- 데이터 스페이스 제공 후보를 가리키는 발견용 metadata

DSP Catalog 메시지, 계약협상, 전송요청과 실제 payload 전송은 이 프로파일의 규범 범위가 아니다. `dataspace-offering`을 통과한 Dataset도 Provider 권한, Connector 상태와 전송 binding이 확인되지 않으면 DSP Offering으로 게시할 수 없다.

### 1.2 현재 후보판의 사용 제한

`manifest.json`은 namespace 상태를 `proposed-not-yet-dereferenceable`로 기록한다. `publication/content-negotiation.json`도 실제 HTTPS 배포가 아니라 후보 배포계약이다. 운영 namespace를 열기 전에는 다음 표현을 사용하지 않는다.

- 국토교통부 Recommendation
- KS·TTA 표준 적합
- DCAT-AP-KR 완전 호환
- 원-윈도우 상호운용성 입증
- DSP 제공권한 승인

검증 report의 `gatePassed=true`는 선택한 RC.1 module의 기술 제약을 통과했다는 뜻이다. 기관 승인과 운영 적합성은 별도 Gate에서 판정한다.

## 2. 규격 계층과 모듈 구조

### 2.1 공통 계층

MOLIT DCAT-AP는 기존 표준을 복제하지 않고 필요한 계층을 합성한다.

```text
W3C DCAT 3
  -> DCAT-AP 3.0.1
      -> MOLIT core
          -> observation | quality | dataspace-offering

W3C DCAT 3
  -> GeoDCAT-AP 3.1.0
      -> MOLIT geo
          -> network

선택한 conformance module
  -> publication-policy 후속 점검
```

DCAT은 Dataset·Distribution·DataService의 기본 의미를 제공한다. DCAT-AP는 공공 카탈로그의 cardinality와 range를 추가한다.

GeoDCAT-AP는 공간 metadata를 추가한다. MOLIT module은 한국어 검색필드, 국토교통 분류, 공간 공개수준, 망 판, 관측 단위와 품질 손실에 필요한 제약을 더한다.

### 2.2 일곱 개 module

여섯 개는 내용 적합성을 판정하는 conformance module이다. `publication-policy`는 내용 module을 통과한 graph에 적용하는 후속 정책이다.

| 이름 | 기준 | 선택 조건 | Marker IRI 끝부분 |
| --- | --- | --- | --- |
| `core` | DCAT-AP 3.0.1 | 일반 카탈로그 metadata | `/1.0.0-rc.1` |
| `geo` | GeoDCAT-AP 3.1.0 | 공간 Dataset·geometry | `/1.0.0-rc.1/geo` |
| `network` | Geo 기반 | 판이 있는 교통망 참조 | `/1.0.0-rc.1/network` |
| `observation` | Core 기반 | 교통량·속도·통행시간 관측 | `/1.0.0-rc.1/observation` |
| `quality` | Core 기반 | DQV 측정과 손실명세 | `/1.0.0-rc.1/quality` |
| `dataspace-offering` | Core 기반 | 제공 후보 발견 metadata | `/1.0.0-rc.1/dataspace-offering` |
| `publication-policy` | 후속 정책 | 권고값·폐기 IRI 점검 | `/1.0.0-rc.1/publication-policy` |

`eu-controlled-audit`는 EU controlled vocabulary 교환 준비상태를 확인하는 diagnostic이다. 국내 발행 적합성 선언에 포함하지 않는다.

### 2.3 module 선택

Resource의 실제 내용에 따라 module을 선택한다.

| Resource 내용 | 실행할 module |
| --- | --- |
| 일반 Dataset과 파일 배포본 | `core` |
| 좌표계·위치·geometry가 있는 Dataset | `geo` |
| 표준 노드·링크 판을 참조하는 Dataset | `network` |
| 교통량·속도·통행시간 관측 Dataset | `observation` |
| DQV 품질측정값을 게시하는 Dataset | `quality` |
| 데이터 스페이스 제공 후보를 별도 기술 | `dataspace-offering` |

한 Catalog가 여러 의미를 가지면 marker를 함께 기록하고 module을 각각 검증한다. `network`가 Geo constraint를 포함하더라도 `network`와 `observation`은 서로를 대신하지 않는다.

```turtle
@prefix dct: <http://purl.org/dc/terms/> .

<https://example.go.kr/catalog/traffic>
    dct:conformsTo
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/network>,
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/observation> .
```

같은 marker를 관련 CatalogRecord에도 기록한다. 위 graph는 `network`와 `observation` 검증을 따로 통과해야 한다.

## 3. Core graph 작성

### 3.1 작업 시작점

빈 Turtle 파일에서 모든 DCAT-AP 조건을 기억해 작성하지 않는다. 적용 module의 양성 fixture를 복사한 뒤 IRI와 값을 원천 record에 맞게 바꾼다.

| 용도 | 시작 fixture |
| --- | --- |
| 일반 카탈로그 | `examples/valid/core-catalog.ttl` |
| 공간정보 | `examples/valid/geo-catalog.ttl` |
| 교통망 | `examples/valid/network-catalog.ttl` |
| 관측정보 | `examples/valid/observation-catalog.ttl` |
| 품질정보 | `examples/valid/quality-catalog.ttl` |
| 제공 후보 | `examples/valid/dataspace-offering-catalog.ttl` |
| 분야·DataService 구조 | `examples/valid/sector-and-service-catalog.ttl` |

표 안의 경로 기준점은 `profiles/molit-dcat-ap/releases/1.0.0-rc.1/`이다. Fixture의 `example` IRI와 시험용 기관·라이선스를 운영값으로 복사하지 않는다.

### 3.2 Catalog와 CatalogRecord

Catalog는 게시 단위이며 CatalogRecord는 Dataset metadata의 수집·수정 이력 단위다.

```turtle
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://example.go.kr/catalog/transport>
    a dcat:Catalog ;
    dct:title "교통 데이터 카탈로그"@ko ;
    dct:description "도로와 교통 관측 데이터의 공개 목록이다."@ko ;
    dct:publisher <https://example.go.kr/id/organization/publisher> ;
    dct:language <http://publications.europa.eu/resource/authority/language/KOR> ;
    dct:conformsTo
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1> ;
    dcat:dataset <https://example.go.kr/dataset/traffic-volume> ;
    dcat:record <https://example.go.kr/record/traffic-volume> .

<https://example.go.kr/record/traffic-volume>
    a dcat:CatalogRecord ;
    dct:title "시간대별 교통량 레코드"@ko ;
    dct:modified "2026-07-13"^^xsd:date ;
    dct:language <http://publications.europa.eu/resource/authority/language/KOR> ;
    dct:conformsTo
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1> ;
    foaf:primaryTopic <https://example.go.kr/dataset/traffic-volume> .
```

이 코드는 구조 발췌본이며 독립 양성 fixture가 아니다. DCAT-AP가 요구하는 발행일, 라이선스와 상태값은 선택한 전체 fixture에서 확인한다.

Catalog의 `dcat:dataset` 집합과 각 Record의 `foaf:primaryTopic` 집합은 같아야 한다. Dataset A를 목록에 올리고 Record가 Dataset B를 가리키면 각 값이 존재하더라도 `MOLIT-CAT-REL-001`에서 거부한다.

### 3.3 Dataset

Dataset은 파일 하나가 아니라 같은 주제와 관리 수명주기를 가진 데이터 자원이다. 월별 파일을 한 Dataset의 Distribution으로 둘지 월별 Dataset으로 나눌지는 식별·변경·폐기 단위를 기준으로 결정한다.

```turtle
<https://example.go.kr/dataset/traffic-volume>
    a dcat:Dataset, dcat:Resource ;
    dct:identifier "traffic-volume-hourly" ;
    dct:title "시간대별 교통량"@ko ;
    dct:description "지점별 시간대 교통량 집계값이다."@ko ;
    dct:publisher <https://example.go.kr/id/organization/publisher> ;
    dct:modified "2026-07-13T09:00:00+09:00"^^xsd:dateTime ;
    dct:accessRights <https://example.go.kr/id/access-right/public> ;
    dcat:theme <https://data.molit.go.kr/id/concept/domain/transport> ;
    dcat:distribution <https://example.go.kr/distribution/traffic-volume-csv> .
```

`dct:identifier`는 문자열이며 같은 candidate graph의 Publisher 범위에서 하나만 사용한다. 저장소 밖의 전역 중복은 운영 식별자 registry가 검사해야 한다. `dct:title`과 `dct:description`에는 한국어 값을 둔다. 다른 언어 값을 함께 두는 것은 허용한다.

`dcat:theme`에는 국토교통 분야 IRI가 하나 이상 필요하다. EU `TRAN`이나 `REGI`는 교환용으로 추가할 수 있지만 국내 분야값을 대신하지 않는다.

### 3.4 Distribution

Distribution은 Dataset을 받거나 접근하는 한 가지 표현이다. CSV 파일, JSON API와 GeoPackage는 서로 다른 Distribution으로 기술한다.

```turtle
<https://example.go.kr/distribution/traffic-volume-csv>
    a dcat:Distribution ;
    dct:title "시간대별 교통량 CSV 배포본"@ko ;
    dct:description "UTF-8 CSV 파일이다."@ko ;
    dcat:accessURL <https://example.go.kr/dataset/traffic-volume> ;
    dcat:downloadURL <https://example.go.kr/download/traffic-volume.csv> ;
    dcat:mediaType
        <https://www.iana.org/assignments/media-types/text/csv> .
```

`dcat:mediaType`, `dcat:compressFormat`와 `dcat:packageFormat`에는 IANA media type IRI를 사용한다. `"text/csv"` 문자열은 사용하지 않는다. File Type, availability와 주기의 EU controlled vocabulary는 Core 국내 Gate와 `eu-controlled-audit`의 역할을 구분한다.

접근 URL은 landing page나 인증절차로 이어질 수 있다. 다운로드 URL은 파일을 직접 받는 위치다. 둘을 확인하지 않고 같은 URL로 채우지 않는다.

### 3.5 DataService

DataService는 API나 질의 endpoint를 설명한다. Distribution이 파일 표현을 기술한다면 DataService는 실행 가능한 데이터 접근서비스를 기술한다.

```turtle
<https://example.go.kr/service/traffic-api>
    a dcat:DataService, dcat:Resource ;
    dct:title "교통량 조회 API"@ko ;
    dct:publisher <https://example.go.kr/id/organization/publisher> ;
    dcat:endpointURL <https://api.example.go.kr/traffic> ;
    dcat:servesDataset <https://example.go.kr/dataset/traffic-volume> ;
    dcat:theme <https://data.molit.go.kr/id/concept/domain/transport> .
```

HTTPS IRI가 있다는 사실은 서비스 가용성, 제공 권한이나 인증 성공을 입증하지 않는다. 원천 API endpoint와 Provider Connector의 DSP endpoint도 같은 값으로 간주하지 않는다. Bridge는 source binding에서 둘을 분리한다.

## 4. 분야 module 작성

### 4.1 Geo

공간 Dataset은 `dcat:Dataset`과 `molit:SpatialDataset`을 함께 선언한다. Source CRS와 공개 geometry CRS는 별도 값으로 관리한다.

```turtle
@prefix geodcatap: <http://data.europa.eu/930/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .

<https://example.go.kr/dataset/road-centerline>
    a dcat:Dataset, molit:SpatialDataset ;
    dct:spatial <https://example.go.kr/location/service-area> ;
    dcat:spatialResolutionInMeters "1.0"^^xsd:decimal ;
    geodcatap:referenceSystem
        <http://www.opengis.net/def/crs/EPSG/0/5186> ;
    molit:spatialDisclosureLevel
        <https://data.molit.go.kr/id/concept/spatial-disclosure-level/exact> .

<https://example.go.kr/location/service-area>
    a dct:Location ;
    dcat:bbox
        "<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POLYGON((126 37,127 37,127 38,126 38,126 37))"^^geo:wktLiteral .
```

실제 property 구성은 `geo-catalog.ttl`을 따른다. RC.1의 공개 WKT subset은 CRS를 명시한 2차원 Point, LineString과 단일 ring Polygon이다. BBOX는 닫힌 Polygon, centroid는 Point다. GML은 GML 3.2 Point subset만 허용한다.

`exact`는 제출한 공간값을 프로파일 단계에서 더 줄이지 않았다는 선언이다. 원천과 공개값이 같다는 감사증거는 아니다. `withheld`이면 location, BBOX, centroid와 geometry를 공개 graph에서 모두 제거한다.

### 4.2 Network

Network module은 Dataset이 어떤 교통망 판을 기준으로 작성됐는지 고정한다.

```turtle
<https://example.go.kr/dataset/road-link>
    a dcat:Dataset, molit:NetworkDataset ;
    molit:networkReference
        <https://example.go.kr/network-reference/standard-node-link/2026-07-01> .

<https://example.go.kr/network-reference/standard-node-link/2026-07-01>
    a molit:NetworkReference ;
    molit:networkAuthority
        <https://example.go.kr/id/organization/network-authority> ;
    molit:networkIdentifier "standard-node-link" ;
    molit:networkVersion "2026-07-01" ;
    molit:networkElementType
        <https://data.molit.go.kr/id/concept/network-element-type/link> .
```

완전한 참조에는 snapshot checksum, 생명주기와 유효일이 필요하다. 동일성 키는 `(networkAuthority, networkIdentifier, networkVersion)`이다. 같은 키에 다른 checksum이 있으면 새 Dataset으로 덮지 않고 충돌로 처리한다.

`superseded` 판은 `dct:isReplacedBy`로 후속 판을 가리킨다. 두 판의 유효기간은 겹치지 않아야 한다. `withdrawn` 판은 이력과 tombstone을 남긴다. `owl:sameAs`로 서로 다른 판을 합치지 않는다.

### 4.3 Observation

Observation module은 개별 센서값이 아니라 Dataset 수준의 관측 의미를 기록한다.

| 질문 | Property | 예시 |
| --- | --- | --- |
| 무엇을 관측했는가 | `molit:observedProperty` | speed·traffic-volume·travel-time |
| 무엇을 대상으로 했는가 | `molit:observationSubjectType` | site·section·network-element |
| 어떻게 집계했는가 | `molit:observationAggregation` | mean·sum·instantaneous |
| 한 값의 시간창은 얼마인가 | `molit:aggregationPeriod` | `PT1H` |
| 결측값은 어떻게 처리했는가 | `molit:missingValuePolicy` | preserve·exclude·imputed |
| 관측값 단위는 무엇인가 | `molit:observationUnit` | `KiloM-PER-HR`·`vehicle-per-hour` |

속도에는 `KiloM-PER-HR` 또는 `M-PER-SEC`, 교통량에는 `vehicle-per-hour`, `vehicle-per-day` 또는 `NUM`, 통행시간에는 `SEC` 또는 `MIN`을 사용한다. Property와 맞지 않는 단위는 `MOLIT-OBS-UNIT-001`에서 거부한다.

`vehicle-per-hour`와 `vehicle-per-day`는 RC.1 후보 DerivedUnit이다. QUDT 공식 등록이나 기관 승인을 뜻하지 않는다. 일 단위 교통량에는 집계일의 시간대와 경계시각을 설명에 남긴다.

개별 관측을 RDF payload로 제공할 때는 SOSA/SSN을 별도 payload profile에서 사용한다. `molit:ObservationDataset`을 `sosa:Observation`과 동치로 만들지 않는다.

### 4.4 Quality

Quality module은 품질상태만 붙이는 방식과 측정결과를 게시하는 방식을 구분한다.

- `not-assessed`: `dqv:hasQualityMeasurement`를 두지 않음
- `assessed`, `warning`, `failed`, `stale`: 측정값을 하나 이상 연결

각 `dqv:QualityMeasurement`에는 측정대상, metric, 값, 평가방법, 평가범위, 결과 유형과 loss ledger 연결이 필요하다. 수치 metric의 단위는 의미에 맞춰 선택한다.

| Metric | 단위 |
| --- | --- |
| completeness·logical-consistency | `PERCENT` |
| positional-accuracy | `M` |
| temporal-accuracy | `SEC` |
| timeliness | `SEC`, `MIN`, `HR` 또는 `DAY` |

원천 ISO 19157 품질요소를 DQV로 옮기면 `molit:QualityMappingStatement`에 원천 요소, 대상 metric, 손실상태와 설명을 기록한다. `lossless`가 아니면 `qualityLossNote`가 필요하다. 옮기지 못한 값을 임의의 수치 metric으로 바꾸지 않는다.

`qualityStatus=assessed`는 품질 합격을 뜻하지 않는다. 평가가 존재한다는 뜻이다. 합격기준과 제품사양 판정은 별도 정책과 증거로 관리한다.

### 4.5 Dataspace offering

`molit:DataspaceOfferingMetadata`는 Catalog Dataset과 제공 후보 record를 연결한다.

```turtle
@prefix offerstatus:
    <https://data.molit.go.kr/id/concept/offering-readiness-status/> .

<https://example.go.kr/offering-metadata/traffic-volume>
    a molit:DataspaceOfferingMetadata ;
    dct:identifier "offering-traffic-volume-001" ;
    dct:title "교통량 데이터 제공 후보"@ko ;
    dct:modified "2026-07-13"^^xsd:date ;
    molit:describesOfferingDataset
        <https://example.go.kr/dataset/traffic-volume> ;
    molit:offeringReadinessStatus offerstatus:metadata-conformant .
```

허용 후보상태는 `drafting`, `metadata-conformant`, `qualification-pending`이다. `operationally-qualified`는 외부 authority registry가 부여하는 운영 판정이므로 RC.1 SHACL 값에 포함하지 않는다.

0.1.0의 `molit:TransferableDataset`과 `molit:TransferDistribution`은 호환 읽기용 폐기 용어다. 신규 graph에는 DCAT Dataset·Distribution과 별도 Offering metadata를 사용한다.

### 4.6 Publication policy

Publication policy는 권고 property와 폐기 IRI를 Warning으로 찾는다. 내용 적합성 Violation을 대신하지 않는다. 현재 waiver 절차가 승인되지 않았으므로 실제 게시 후보에는 Warning 0건을 요구한다.

`publish-check`는 선택한 conformance module과 `publication-policy`를 순서대로 실행하고 두 report를 하나의 decision digest로 묶는다.

## 5. 요구사항과 오류 수정

### 5.1 requirement ID의 역할

SHACL 메시지만 읽으면 같은 문구가 다른 class에 적용됐는지 구분하기 어렵다. RC.1은 각 로컬 제약에 `requirementId`를 붙인다.

```text
규격 또는 로컬 채택근거
  -> requirement ID
  -> SHACL constraint
  -> 양성 fixture
  -> 그 조건만 위반하는 음성 fixture
  -> 오류 메시지와 수정절차
```

로컬 요구사항 129건과 고정 upstream 요구사항 990건은 단일 통합 coverage로 검사한다. 현재 원장의 `integratedCoverage`는 1,119건 모두에 양성·음성 증거가 있고 blocker가 0건이라고 기록한다. 숫자를 구현 상수로 사용하지 않고 검증기가 원장을 다시 계산하도록 둔다.

### 5.2 validation report 읽기

Report의 각 result에서 다음 필드를 먼저 본다.

| 필드 | 처리 |
| --- | --- |
| `focusNode` | 고칠 RDF resource 확인 |
| `path` | 문제가 발생한 property 경로 확인 |
| `requirementId` | 원장의 같은 행 조회 |
| `messages` | 위반 의미 확인 |
| `severity` | Violation·Warning 구분 |
| `value` | 거부된 값 확인 |
| `sourceConstraintComponent` | 개수·자료형·패턴 등 제약 종류 확인 |

다음 명령은 특정 requirement의 property, cardinality, range, 통제어와 수정절차를 조회한다.

```powershell
$req = "MOLIT-DS-001-P-TITLE-001"
Import-Csv `
  profiles/molit-dcat-ap/releases/1.0.0-rc.1/requirements/profile-requirements.csv |
  Where-Object requirementId -eq $req |
  Select-Object requirementId, property, minCount, maxCount, range, `
    controlledVocabulary, messages, remediation, positiveFixtureId, `
    negativeFixtureId
```

`missing-korean-title.ttl`의 제목 오류를 고칠 때 영문 제목을 삭제할 필요는 없다. 같은 Dataset에 `dct:title "..."@ko`를 추가하고 다시 검증한다. 다른 result가 함께 있으면 각 requirement ID를 따로 처리한다.

### 5.3 출처 확인

`profile-requirements.csv`의 `sourceStandard`, `sourceClause`와 `localRationale`을 함께 읽는다.

- DCAT-AP·GeoDCAT-AP constraint: 고정 upstream 원장에서 원본 locator 확인
- 국토교통 로컬 constraint: 로컬 조항 또는 명시한 외부 출처 확인
- 국내 표준 후보정렬: crosswalk의 증거등급과 claim 상태 확인
- Publication 권고: 내용 필수조건과 구분해 후속 정책으로 처리

CSV를 직접 고치지 않는다. JSON 정본, SHACL, fixture와 생성 절차를 같은 변경에서 갱신한다.

## 6. 통제어와 식별자

### 6.1 IRI와 문자열의 구분

식별자 문자열과 참조 IRI는 역할이 다르다.

| 위치 | 값 형태 | 예시 |
| --- | --- | --- |
| `dct:identifier` | 관리범위 안의 문자열 | `traffic-volume-hourly` |
| `dct:publisher` | Agent IRI | 기관 식별자 IRI |
| `dcat:theme` | SKOS Concept IRI | 국토교통 분야 IRI |
| `dct:accessRights` | RightsStatement IRI | 공개등급 IRI |
| `dcat:mediaType` | IANA media type IRI | `.../text/csv` |
| `dct:conformsTo` | version profile IRI | RC.1 module marker |

`dct:accessRights "public"`, `dcat:theme "교통"`, `dcat:mediaType "text/csv"`처럼 label을 넣지 않는다. Label은 참조한 Concept나 별도 UI projection에서 제공한다.

### 6.2 registry metadata

`vocabulary/registry-metadata.json`은 현재 124개 통제어를 다음 정보와 함께 projection한다.

- scheme과 notation
- 언어별 preferred label
- status와 유효기간
- source와 replacedBy

Turtle 어휘가 정본이며 JSON은 조회용 projection이다. 두 표현의 차이는 `profile:vocabulary:verify`가 거부한다.

### 6.3 국내 후보 식별자

`vocabulary/domestic-candidate-registries.ttl`의 값은 모두 `/candidate/` namespace에 있다. 다음 운영값으로 사용하지 않는다.

- 기관 후보를 `dct:publisher` 또는 Provider authority로 사용
- 행정구역 후보를 권위 `dct:spatial` 값으로 사용
- 공공누리 후보 Concept를 `dct:LicenseDocument`로 사용
- 빈 법령 후보 registry에서 개별 법령 IRI를 임의 발급

기관·법정동·행정동·법령·라이선스 IRI는 발급기관, 판, 폐지와 대체정책이 승인된 뒤 승격한다. 내부 canonical record에는 원천 scheme, code, 기준일과 source를 보존한다.

## 7. DSP와 Bridge의 경계

### 7.1 네 개의 서로 다른 객체

플랫폼 연결에서는 다음 객체를 합치지 않는다.

| 객체 | 관리 주체 | 포함 정보 |
| --- | --- | --- |
| 원천 record | 기존 플랫폼 | 원천 ID, 화면·API 필드, 수정·삭제 상태 |
| MOLIT DCAT-AP graph | Metadata pipeline | Dataset·Distribution·DataService 의미 |
| DSP Catalog object | Provider Connector | Dataset 표현, Offer와 protocol message |
| Source binding | Bridge 내부 registry | 원천 endpoint, object key, credential reference |

MOLIT graph를 DSP Catalog wire message로 그대로 보내지 않는다. Connector 제품과 DSP 판에 맞는 projection을 거친다. 반대로 DSP Offer의 존재를 원천 제공권한의 근거로 사용하지 않는다.

### 7.2 Bridge onboarding 순서

기존 데이터 플랫폼의 record 하나를 연결할 때 다음 순서를 사용한다.

1. 원천 ID, 수정시각, 삭제표시, 역할과 delivery path를 수집한다.
2. Dataset 경로를 `hosted`, `brokered`, `index-only` 또는 `unknown`으로 분류한다.
3. 원천 필드를 canonical record로 변환하고 사용하지 못한 필드를 loss ledger에 남긴다.
4. 적합한 MOLIT module을 선택해 RDF graph를 만든다.
5. Module별 `validate`와 게시 대상의 `publish-check`를 실행한다.
6. Provider가 계약·제공할 권한과 라이선스 근거를 authority registry에서 확인한다.
7. 원천 endpoint와 credential을 공개 graph가 아닌 source binding registry에 넣는다.
8. Connector 전용 Dataset·Offer·Distribution·DataService projection을 만든다.
9. DSP Catalog 조회 결과와 공개 RDF graph에서 secret·내부 URL이 없는지 확인한다.
10. 변경·철회·계약종료 때 Catalog와 플랫폼 접근자원을 회수하는 시험을 실행한다.

`index-only` record는 discovery metadata로 남긴다. 원천 landing page만 있다는 이유로 동작하지 않는 Distribution이나 Offer를 만들지 않는다.

### 7.3 Offering 상태와 metadata 상태

`metadata-conformant`는 graph가 후보 SHACL을 통과했다는 상태다. Bridge의 `APPROVED`나 `PUBLISHED` 상태와 다르다.

```text
metadata-conformant
  + Provider authority
  + license and policy
  + source binding
  + Connector readiness
  + revocation path
  -> operational qualification decision
```

운영 판정에는 승인주체, 판정시각, 유효기간과 철회상태가 필요하다. 이 값을 RDF graph 안의 self-assertion으로 대신하지 않는다.

### 7.4 계약과 전송

DSP Contract Negotiation이 끝나도 payload가 자동으로 이동하는 것은 아니다. Bridge worker는 Agreement와 Transfer 사건을 플랫폼 자원으로 변환한다.

- Agreement 범위: 장기 subscription·tenant entitlement
- Transfer 범위: token·signed URL·export job·임시 snapshot·ACL
- Request 범위: 단일 query lease·일회용 credential

Transfer Completion 때 Transfer 범위 자원을 회수한다. Agreement가 끝나면 관련 Transfer를 중지하고 Agreement·Transfer 범위 자원을 모두 회수한다. Reconciler는 Connector 상태와 플랫폼 자원이 어긋난 항목을 다시 찾는다.

## 8. 검증 실행

### 8.1 설치와 release 확인

저장소 root에서 고정 dependency를 설치하고 release lock을 확인한다.

```powershell
npm ci
node src/profile/cli.mjs list --version 1.0.0-rc.1
node src/profile/cli.mjs verify --version 1.0.0-rc.1
```

`verify`는 release 파일 byte와 artifact lock을 검사한다. Metadata 내용 적합성은 다음 단계에서 별도로 검사한다.

### 8.2 단일 module 검증

Report 경로는 기존 파일과 겹치지 않는 새 경로를 사용한다.

```powershell
Remove-Item .local/core-report.json -ErrorAction SilentlyContinue
node src/profile/cli.mjs validate `
  --version 1.0.0-rc.1 `
  --input data.ttl `
  --profile core `
  --report .local/core-report.json
```

Exit code `0`은 선택 module Gate 통과, `2`는 적합성 실패, `1`은 입력·구성 오류다. Report의 `authority.publicationAuthorized=false`는 기술 report를 발행승인으로 바꾸지 못하게 하는 정상 경계다.

### 8.3 복수 module 검증

교통망 관측 Dataset처럼 marker가 둘이면 같은 입력을 두 번 검증한다.

```powershell
node src/profile/cli.mjs validate `
  --version 1.0.0-rc.1 --input data.ttl --profile network
node src/profile/cli.mjs validate `
  --version 1.0.0-rc.1 --input data.ttl --profile observation
```

두 report의 input byte digest가 같아야 한다. 한 module만 통과한 graph에 두 module 적합성을 표시하지 않는다.

### 8.4 게시 전 점검

```powershell
node src/profile/cli.mjs publish-check `
  --version 1.0.0-rc.1 `
  --input data.ttl `
  --profile observation
```

이 명령은 Observation Violation과 Publication Warning을 함께 판정한다. 기관 namespace·라이선스·서명 Gate는 별도다.

### 8.5 규격과 증거 점검

```powershell
npm run profile:requirements:verify
npm run profile:requirements:upstream:verify
npm run profile:ontology:governance:verify
npm run profile:ontology:verify
npm run profile:vocabulary:verify
npm run profile:domestic-crosswalk:verify
npm run profile:network:verify
npm run profile:publication:verify
```

전체 저장소 점검은 다음 명령으로 실행한다.

```powershell
npm run verify
```

Node 검증기는 candidate instance graph에 lock으로 고정한 `bundles/support.ttl`만 추가한다. W3C DCAT ontology, GeoSPARQL ontology, MOLIT ontology나 SHACL graph를 data graph에 병합하지 않는다. Entailment는 `none`이다.

외부 SHACL engine에는 다음 구성을 사용한다.

```text
data graph   = candidate instance graph + exact bundles/support.ttl
shapes graph = bundles/{selected-module}.ttl
entailment   = none
```

외부 engine의 SHACL 통과만으로 공식 CLI의 parser-backed geometry, XML 안전성, 복잡도와 public graph preflight를 재현했다고 표시하지 않는다.

## 9. 국내 표준 정렬 결과 읽기

### 9.1 증거등급

국내 정렬 문서는 다음 등급을 사용한다.

| 등급 | 확인 범위 | 허용 표현 |
| --- | --- | --- |
| E1 | 표준번호·제목·판·발급원 | 비교 대상 확인 |
| E2 | 공식 XSD·Schematron·어휘·예제 | 기술시험 실행 |
| E3 | 원문 조항·cardinality·코드·손실 | 조항 mapping 완료 |
| E4 | 기관 정상·오류·변경·삭제 fixture | 해당 interface 시험 완료 |
| E5 | 기관 서명·범위·판·만료일 | 승인 범위 운영 판정 |

`informative-pending`은 표준의 의미 항목과 MOLIT property 후보를 연결했지만 정식 조항 적합성을 판정하지 않았다는 뜻이다. `verified`는 해당 행에 요구되는 출처와 fixture가 실제로 검증됐을 때만 사용한다.

### 9.2 Crosswalk 확인

국내 표준 행은 다음 파일에서 조회한다.

```powershell
Import-Csv `
  profiles/molit-dcat-ap/releases/1.0.0-rc.1/mappings/domestic-standards-crosswalk.csv |
  Where-Object source_standard_id -eq "KS-X-ISO-19115-1" |
  Select-Object mapping_id, source_clause, target_property_or_class, `
    loss_disposition, evidence_level, conformance_claim, verification_gate
```

`source_clause=PENDING-LAWFUL-FULLTEXT`인 행은 구현 대기열이다. 같은 행에 SHACL requirement와 fixture가 연결돼 있어도 KS 조항 적합성을 뜻하지 않는다.

DCAT-AP-KR과 원-윈도우의 DCAT-AP 2.1 계열 metadata는 3.0.1 출력으로 변환할 때 class, property, cardinality, 통제어와 손실을 기록한다. 원-윈도우 전용 API·Excel·Database 코드는 프로파일 본체가 아니라 Bridge adapter에서 관리한다.

## 10. Stable namespace 배포

### 10.1 IRI 구조

운영 namespace는 용도별 IRI를 섞지 않는다.

| 용도 | IRI |
| --- | --- |
| Profile stable IRI | `https://data.molit.go.kr/profile/molit-dcat-ap` |
| RC.1 Core version IRI | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1` |
| Module stable IRI | `.../profile/molit-dcat-ap/{module}` |
| Module version IRI | `.../profile/molit-dcat-ap/1.0.0-rc.1/{module}` |
| Ontology stable IRI | `https://data.molit.go.kr/def/molit-dcat-ap` |
| Ontology version IRI | `https://data.molit.go.kr/def/molit-dcat-ap/1.0.0-rc.1` |
| Instance IRI | 운영기관이 승인한 `/id/` 하위 경로 |

Stable IRI는 현재 승인판 표현을 직접 `200`으로 제공한다. Version IRI도 해당 판의 표현을 직접 제공하며 같은 byte와 의미를 유지한다.

새 승인판을 발행할 때는 Stable IRI의 표현 binding만 새 승인판으로 바꾼다. 이전 Version IRI의 응답은 바꾸지 않는다.

RC.1 marker를 graph에 기록할 때 Stable IRI 대신 RC.1 Version IRI를 사용한다. Live 배포 전에는 두 IRI 모두 후보계약이며 dereference 완료로 표시하지 않는다.

### 10.2 HTTP 응답 계약

`publication/content-negotiation.json`은 Profile과 ontology IRI에 다음 표현을 지정한다.

| Accept | 표현 |
| --- | --- |
| `text/html` | `index.html` 또는 `ontology.html` |
| `text/turtle` | `profile-description.ttl` 또는 ontology Turtle |
| `application/ld+json` | `serializations/*.jsonld` |

응답에는 `Vary: Accept`를 넣는다. 지원하지 않는 Accept는 `406`, 없는 IRI는 `404`를 반환한다. Trailing slash 정규화는 query를 보존하는 `308`을 사용한다. Tombstone은 `publication/tombstones.json`의 대체·영구응답 규칙을 따른다.

운영 배포는 release에서 lock으로 고정한 byte를 그대로 제공하거나 새 release를 만들어야 한다. 웹서버에서 Turtle prefix, HTML 날짜나 JSON-LD context를 자동 치환하지 않는다.

### 10.3 배포 확인

운영기관은 최소한 다음 증거를 남긴다.

1. DNS와 TLS 인증서의 소유기관
2. Stable·version IRI별 `GET`·`HEAD` 결과
3. 세 Accept 표현의 status, content type와 body digest
4. `Vary: Accept`, 308, 404와 406 시험결과
5. 외부 network에서의 dereference 결과
6. 배포 artifact와 `artifact-lock.json`의 byte 비교
7. rollback 대상 version과 tombstone 처리결과

이 증거가 `RA-NAMESPACE`에 연결되기 전에는 후보계약을 실제 stable namespace 배포로 표시하지 않는다.

## 11. 운영 체크리스트

### 11.1 Metadata 작성

- [ ] 원천 record ID와 canonical Dataset IRI의 mapping을 고정함
- [ ] Catalog Dataset 집합과 Record primary topic 집합이 같음
- [ ] 한국어 title·description과 Publisher를 확인함
- [ ] 국토교통 분야 IRI를 하나 이상 사용함
- [ ] Distribution과 DataService의 역할을 구분함
- [ ] Media type은 IANA IRI를 사용함
- [ ] 적용 module의 version marker를 Catalog와 Record에 기록함
- [ ] 원천에서 생략·변환한 필드를 loss ledger에 기록함

### 11.2 분야 module

- [ ] Geo의 source CRS와 공개 geometry CRS를 구분함
- [ ] `withheld` graph에서 location과 geometry를 제거함
- [ ] Network identity key와 snapshot checksum을 함께 보존함
- [ ] Observation property·aggregation·unit 조합을 확인함
- [ ] Quality status와 측정값 존재조건을 맞춤
- [ ] 품질 projection의 손실상태와 설명을 기록함
- [ ] Offering metadata를 운영자격 self-assertion으로 사용하지 않음

### 11.3 Bridge와 Connector

- [ ] 원천 역할을 hosted·brokered·index-only·unknown으로 판정함
- [ ] Provider authority와 라이선스 증거를 Dataset별로 확인함
- [ ] 원천 endpoint·credential을 공개 graph와 분리함
- [ ] Source binding에 판과 철회방법이 있음
- [ ] Connector projection을 DSP 판과 제품 schema로 검증함
- [ ] Agreement·Transfer·Request 범위 자원을 구분함
- [ ] 종료·철회 때 token·subscription·snapshot을 회수함
- [ ] Reconciler가 누락 event와 잔존 자원을 탐지함
- [ ] Public Catalog와 log에 secret·내부 URL이 없음

### 11.4 검증과 발행

- [ ] 선택한 모든 module을 같은 input digest로 검증함
- [ ] 게시 대상은 module별 `publish-check`를 통과함
- [ ] Requirement ID별 오류를 원장의 remediation으로 수정함
- [ ] Candidate graph에 ontology나 shape graph를 병합하지 않음
- [ ] Artifact lock과 공개 표현 동등성을 확인함
- [ ] 국내 crosswalk의 informative·verified 상태를 구분함
- [ ] Stable namespace의 실제 HTTP 증거를 보존함
- [ ] 기관 라이선스·서명·governance 승인상태를 확인함
- [ ] Metadata 통과와 DSP 운영자격을 별도 report로 남김

## 12. 파일별 확인 순서

구현 중 확인 순서는 다음과 같다.

1. `manifest.json`: 적용판, module, bundle, example과 실행한도
2. `examples/valid/{module}-catalog.ttl`: 전체 양성 graph 구조
3. `requirements/profile-requirements.csv`: 로컬 요구사항과 수정절차
4. `shacl/molit-*.ttl`: 실제 constraint와 메시지
5. `ontology/molit-dcat-ap.ttl`: 로컬 class·property 의미
6. `vocabulary/registry-metadata.json`: 허용값의 상태·출처·대체관계
7. `mappings/domestic-standards-crosswalk.csv`: 국내 의미정렬과 증거수준
8. `CONFORMANCE.md`: 검증결과에 허용하는 주장
9. `publication/content-negotiation.json`: namespace 응답계약
10. `release-acceptance.json`: Candidate와 Recommendation의 machine 판정

Bridge 구현은 [기존 플랫폼과 Connector 사이의 Bridge](../02-architecture/platform-connector-bridge.md),
[Offering 온보딩과 접근 수명주기](../02-architecture/offering-onboarding-lifecycle.md),
[Discovery Bridge 구현](discovery-bridge.md)을 함께 사용한다. 프로파일은 공개 의미를 고정하고 Bridge는 원천 수집, 권리, binding과 DSP 수명주기를 처리한다.
