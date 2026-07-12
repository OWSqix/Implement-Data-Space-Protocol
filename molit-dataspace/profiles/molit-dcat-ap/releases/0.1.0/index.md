# 국토교통 데이터 카탈로그 응용 프로파일 0.1.0

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft

## 1. 적용 범위와 상태

이 프로파일은 국토교통 데이터 카탈로그에서 Dataset, Distribution, DataService, 공간 범위, 교통망 참조와 품질 상태를 RDF로 교환하는 규칙을 정한다. DSP 계약·전송 메시지와 Connector 내부 자산 객체는 적용 대상이 아니다.

0.1.0의 SHACL, 온톨로지, 통제어, 예시와 검증기는 실행 가능하다. 다음 조건이 충족되기 전에는 `MOLIT Recommendation` 또는 기관 표준으로 표시하지 않는다.

- 국토교통부가 운영 namespace와 장기 URI 정책을 승인
- 국토·도시·주택·건축·부동산·건설·도로·철도·항공·물류 담당자가 용어와 cardinality를 검토
- 통합채널과 원천 플랫폼의 실제 레코드로 mapping과 누락률을 검증
- 법무·개인정보·공간정보 보안 검토를 완료
- 운영기관이 변경·폐기·민원 처리 절차를 인수

## 2. 규범 기준

| 계층 | 적용 규격 | 적용 방식 |
| --- | --- | --- |
| 공통 의미 | W3C DCAT 3 Recommendation, 2024-08-22 | Dataset·Distribution·DataService 의미와 RDF 용어 사용 |
| 공공 카탈로그 프로파일 | DCAT-AP 3.0.1 Recommendation, 2025-10-27 | 공통 class·property·range·cardinality의 하한선 |
| 공간정보 | GeoDCAT-AP 3.1.0 Recommendation, 2026-02-16 | 공간 데이터에 한해 추가 검증 |
| 공간 RDF 어휘 | OGC GeoSPARQL 1.1 | Geo profile 선택 term과 geometry literal datatype 판정 |
| 제약 언어 | W3C SHACL Recommendation, 2017-07-20 | machine-readable 적합성 검사 |
| 분류체계 | W3C SKOS Recommendation, 2009-08-18 | 통제어와 계층·mapping 표현 |
| 계보 | W3C PROV-O Recommendation, 2013-04-30 | 기관·활동·산출물 계보 표현 |
| 프로파일 기술 | W3C Profiles Vocabulary Note, 2019-12-18 | profile resource와 artifact 역할 기술 |

DCAT-AP 3.0.0 대신 3.0.1을 고정했다. 3.0.1은 `dct:rights`, `dcat:spatialResolutionInMeters`, `dcat:byteSize`와 SHACL 오류를 보정한 같은 3.0 계열 릴리스다.

mobilityDCAT-AP 1.1.0은 DCAT-AP 2.0.1 기반이다. 이 SHACL은 DCAT-AP 3.0.1 bundle에 합치지 않는다.

Transport Mode 어휘만 원 발급 IRI와 버전을 보존해 재사용한다. mobilityDCAT-AP 3.0.0은 Editor's Draft이므로 blocking validation에서 제외한다.

## 3. 적합성 등급

### 3.1 제공자 적합성

0.1.0 제공자 적합성을 주장하려면 다음 조건을 모두 충족해야 한다.

1. 교환 RDF가 `core` 또는 공간자료의 `geo` 검증을 통과한다.
2. 게시 RDF가 `core-publication` 또는 `geo-publication` 검증을 통과한다.
3. Catalogue와 CatalogueRecord가 같은 profile version IRI를 가지며 Core와 Geo marker를 중복 선언하지 않는다.
4. source binding, credential, 원문 evidence ID와 내부 endpoint가 공개 그래프에 없다.
5. 원천 레코드와 공개 RDF 사이의 mapping 이력을 비공개 감사 영역에 보존한다.

Working Draft 동안 이 적합성은 구현 시험 결과를 뜻한다. 기관 표준 적합성 인증을 뜻하지 않는다.

### 3.2 수신자 적합성

수신자는 DCAT-AP 3.0.1의 class와 property를 처리하고, 알 수 없는 국토교통 확장 term을 버리지 않은 채 RDF로 보존해야 한다. 수신자가 지원하지 않는 확장 term 때문에 DCAT 공통 metadata를 거부해서는 안 된다. 접근통제와 법적 제공 권한은 OWL 추론 결과로 판정하지 않는다.

## 4. Namespace와 버전 IRI

| 용도 | 제안 URI | 0.1.0 상태 |
| --- | --- | --- |
| Profile stable IRI | `https://data.molit.go.kr/profile/molit-dcat-ap` | 게시 승인 전 |
| Profile version IRI | `https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0` | 게시 승인 전 |
| Geo subprofile stable IRI | `https://data.molit.go.kr/profile/molit-dcat-ap/geo` | 게시 승인 전 |
| Geo subprofile version IRI | `https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/geo` | 게시 승인 전 |
| Ontology stable IRI | `https://data.molit.go.kr/def/molit-dcat-ap` | 게시 승인 전 |
| Ontology term namespace | `https://data.molit.go.kr/def/molit-dcat-ap#` | 게시 승인 전 |
| Shape namespace | `https://data.molit.go.kr/shape/molit-dcat-ap/0.1.0#` | 게시 승인 전 |
| Concept scheme | `https://data.molit.go.kr/scheme/{scheme}` | 게시 승인 전 |
| Concept | `https://data.molit.go.kr/id/concept/{scheme}/{code}` | 게시 승인 전 |
| Instance | `https://data.molit.go.kr/id/{class}/{identifier}` | 게시 승인 전 |

운영 도메인은 국토교통부가 소유하고 DNS, TLS, redirect와 tombstone 수명을 관리해야 한다.

0.1.0 artifact의 URI는 제안값이며 현재 dereference 가능하다고 주장하지 않는다. 승인 과정의 URI 변경은 Working Draft 안에서 처리한다.

Recommendation 이후에는 stable term IRI를 재사용하거나 다른 의미로 바꾸지 않는다.

## 5. Class 구조

| Class | 상위 class | 용도 |
| --- | --- | --- |
| `dcat:Catalog` | DCAT | 국토교통 데이터 카탈로그 |
| `dcat:CatalogRecord` | DCAT | 원천 수집·수정 이력 단위 |
| `dcat:Dataset` | DCAT | 검색·계약 대상 논리 데이터셋 |
| `molit:TransferableDataset` | `dcat:Dataset` | 승인된 배포본을 전송할 수 있는 데이터셋 |
| `molit:SpatialDataset` | `dcat:Dataset` | 공간 범위와 CRS가 있는 데이터셋 |
| `molit:NetworkDataset` | `molit:SpatialDataset` | 버전이 있는 도로·철도·교통망 데이터셋 |
| `molit:ObservationDataset` | `dcat:Dataset` | 시간 간격을 갖는 관측 데이터셋 |
| `dcat:Distribution` | DCAT | 파일·API·스트림 등 제공 형태 |
| `molit:TransferDistribution` | `dcat:Distribution` | 계약 뒤 다운로드할 파일 또는 고정 데이터 표현 |
| `dcat:DataService` | DCAT | 데이터 접근 서비스의 공개 기술 |
| `molit:NetworkReference` | 국토교통 확장 | 망 식별자·버전·요소 유형 묶음 |
| `dqv:QualityMeasurement` | DQV | 측정항목·수치·단위가 있는 품질 결과 |

확장 class는 SHACL 적용 범위를 표시한다. `molit:NetworkDataset` 유형만 선언해 DCAT Dataset 유형을 생략하지 않는다. 추론을 수행하지 않는 수신자를 위해 교환 RDF에는 `dcat:Dataset` 유형을 함께 적는다.

## 6. 공통 cardinality

### 6.1 Catalogue와 CatalogueRecord

| Class | Property | Cardinality | 추가 조건 |
| --- | --- | --- | --- |
| Catalogue | `dct:title` | 1..n | 한국어 값 1개 이상, 언어별 최대 1개 |
| Catalogue | `dct:description` | 1..n | 한국어 값 1개 이상, 언어별 최대 1개 |
| Catalogue | `dct:publisher` | 1..1 | `foaf:Agent` IRI |
| Catalogue | `dcat:dataset` | 1..n | `dcat:Dataset` |
| Catalogue | `dcat:record` | 1..n | `dcat:CatalogRecord` |
| Catalogue | `dct:language` | 1..n | `KOR` 포함 |
| Catalogue | `dct:conformsTo` | 1..n | Core·Geo marker 중 정확히 1개, 선택 bundle과 일치 |
| CatalogueRecord | `dct:title` | 1..n | 한국어 값 1개 이상 |
| CatalogueRecord | `dct:modified` | 1..1 | `xsd:date` 또는 `xsd:dateTime` |
| CatalogueRecord | `foaf:primaryTopic` | 1..1 | 기술 대상 Dataset |
| CatalogueRecord | `dct:language` | 1..n | `KOR` 포함 |
| CatalogueRecord | `dct:conformsTo` | 1..n | Catalogue와 같은 marker, Core·Geo 중 정확히 1개 |

### 6.2 Dataset

| Property | Cardinality | 추가 조건 |
| --- | --- | --- |
| `dct:identifier` | 1..1 | 발급기관 범위 안에서 고유한 문자열 |
| `dct:title` | 1..n | 한국어 값 1개 이상, 언어별 최대 1개 |
| `dct:description` | 1..n | 한국어 값 1개 이상, 언어별 최대 1개 |
| `dct:publisher` | 1..1 | 원천 발행책임 기관 `foaf:Agent` |
| `dcat:theme` | 2..n | EU `TRAN` 또는 `REGI` 1개 이상과 국토교통 주제 1개 이상 |
| `dct:accessRights` | 1..1 | 승인된 `dct:RightsStatement` IRI |
| `dct:issued` | 0..1 | `xsd:date` 또는 `xsd:dateTime` |
| `dct:modified` | 1..1 | `xsd:date` 또는 `xsd:dateTime` |
| `molit:qualityStatus` | 1..1 | 품질 상태 scheme의 Concept |
| `dcat:distribution` | 1..n | `molit:TransferableDataset`에 적용 |

`open`, `registered`, `restricted` 같은 문자열은 `dct:accessRights` 값으로 쓰지 않는다. Platform Bridge의 문자열 enum은 mapping 과정에서 `PUBLIC`, `RESTRICTED`, `NON_PUBLIC` RightsStatement IRI로 변환한다.

Dataset의 `dct:conformsTo`는 데이터 내용이 따르는 schema나 기술 표준을 가리킨다. 메타데이터 응용 프로파일 IRI를 Dataset에 복사하지 않는다.

### 6.3 Distribution과 DataService

| Class | Property | Cardinality | 추가 조건 |
| --- | --- | --- | --- |
| TransferDistribution | `dcat:accessURL` | 1..n | 공개 가능한 IRI |
| TransferDistribution | `dct:format` | 1..1 | 승인된 EU File Type IRI |
| TransferDistribution | `dcat:mediaType` | 0..1 | IANA media type IRI |
| TransferDistribution | `dcatap:availability` | 1..1 | 승인된 availability IRI |
| TransferDistribution | `dct:license` 또는 `dct:rights` | 1..n | 둘 중 하나 이상 |
| DataService | `dct:title` | 1..n | 한국어 값 1개 이상 |
| DataService | `dcat:endpointURL` | 1..n | 공개 서비스 endpoint |
| DataService | `dcat:servesDataset` | 1..n | 제공 Dataset 연결 |
| DataService | `dct:conformsTo` | 0..n | DSP·OGC API 등 서비스가 구현한 기술 표준 |

`dcat:accessURL`은 사용자가 배포본에 접근하는 공개 진입점이다. 원천 DB, object key, API key가 필요한 내부 URL과 `sourceBindingRef`는 이 property로 내보내지 않는다.

Distribution의 `dct:conformsTo`는 CSV schema, GML application schema처럼 배포 내용이 따르는 표준을 가리킨다. API와 stream은 `dcat:DataService`로 기술하고 Distribution에서 `dcat:accessService`로 연결한다.

## 7. 분야 모듈

### 7.1 공간정보

`molit:SpatialDataset`은 공개 수준이 `withheld`가 아닐 때 `dct:spatial`을 하나 이상 가져야 한다. 원 데이터의 CRS는 GeoDCAT-AP `referenceSystem`으로 하나 이상 기록한다.

- 0.1.0은 OGC CRS84와 EPSG:4737·5179·5185·5186·5187·5188을 source reference system으로 허용한다.
- 이 목록은 2026-07-12 EPSG 공식 resolver에서 확인한 코드만 포함한다.
- 국토지리정보원 서식의 `102080`부터 `102084`는 EPSG IRI로 만들지 않는다. authority 확인 전에는 legacy alias 후보로 둔다.

공간 범위 geometry의 CRS는 WKT 또는 GML literal 안에 별도로 적는다. 원 데이터가 EPSG:5186이고 검색용 BBOX가 CRS84인 조합은 오류가 아니다.

- 0.1.0은 실제 geometry parser와 국내 CRS 축 왕복시험을 아직 제공하지 않는다.
- 공개 geometry literal은 CRS84 또는 EPSG:5179로 제한한다.
- `referenceSystem`에 다른 허용 CRS가 있어도 geometry literal과 같은 값일 것을 요구하지 않는다.

`molit:spatialDisclosureLevel`은 공개 geometry가 원 정밀도, 일반화, 행정구역, BBOX, 격자 또는 비공개 중 어느 수준인지 표시한다. 이 값은 보안 등급과 접근 정책을 대신하지 않는다. CCTV 위치, 개인 이동경로, 핵심시설과 결합 가능한 정밀 geometry는 공개 projection 전에 일반화하거나 제거한다.

공개 geometry를 가진 Catalogue, Dataset, DatasetSeries와 DataService는 각각 공개 수준을 기록한다.

- `withheld` 자원에는 `dct:spatial`, bbox, centroid, geometry node 또는 serialization을 함께 게시하지 않는다.
- 0.1.0은 CRS 검사 규칙이 있는 WKT와 GML만 허용한다.
- GeoJSON·KML·DGGS와 일반 `geo:hasSerialization`은 거부한다.

GML 검사는 다음 범위로 제한한다.

- root geometry 요소의 `srsName`과 허용 CRS를 확인한다.
- XML Schema 전체 검증은 수행하지 않는다.
- IRI 또는 blank node로 연결한 외부 geometry의 내용은 가져오지 않는다.
- GML schema 검증과 외부 geometry materialization은 게시 전 변환 단계에서 수행한다.

### 7.2 교통망

`molit:NetworkDataset`은 다음 값을 갖는다.

- `molit:networkReference` 1개
- 망 식별자 발급기관 IRI 1개
- 망 식별자 1개
- 망 버전 1개
- 망 요소 유형 1개 이상
- mobilityDCAT-AP Transport Mode Concept 1개 이상

도로 링크 ID가 같아도 발급기관과 망 버전이 다르면 같은 자원으로 합치지 않는다. `owl:sameAs`는 사용하지 않는다.

### 7.3 관측과 품질

`molit:ObservationDataset`은 관측 기간, `xsd:duration` 시간 해상도와 DQV 품질 측정값을 하나 이상 가진다. 품질 측정값은 대상 Dataset, metric, 숫자와 QUDT Unit IRI를 함께 기록한다.

품질 status와 measurement는 다른 정보다. `assessed`는 평가 절차가 끝났다는 상태이며 값이 우수하다는 뜻이 아니다.

0.1.0의 다섯 metric은 국토교통 운영 초안의 수치 projection이다.

KS X ISO 19157-1 전체의 result type, 품질요소, 측정방법, scope와 적합판정을 구현하지 않는다.

지원하지 않는 품질 결과는 이 다섯 metric 중 하나로 축약하지 않고 `unmapped`로 보존한다. 제품별 합격값은 KS X ISO 19131 기반 제품사양과 내부 품질보고서에서 별도로 관리한다.

## 8. 통제어 정책

| 용도 | 발급원 | 0.1.0 처리 |
| --- | --- | --- |
| 언어·접근권한·파일형식·갱신주기·가용성 | EU Vocabularies | 운영에 허용할 부분집합을 local allowlist로 고정 |
| 공통 데이터 주제 | EU Data Theme | `TRAN`, `REGI` 중 하나 이상 요구 |
| 국토교통 상세 주제 | 국토교통 제안 scheme | 국토·도시·주택·건축·부동산·건설·도로·철도·항공·물류 등 |
| 교통수단 | mobilityDCAT-AP Transport Mode 1.0.0 | 원 IRI와 CC BY 4.0 attribution 유지 |
| 망 요소 | 국토교통 제안 scheme | node·link·section·station·stop·facility·zone·sensor-site |
| 품질 상태·metric | 국토교통 제안 scheme | 상태와 측정항목 분리 |
| media type·압축·패키징 | IANA Media Types | 0.1.0 검증 allowlist에 고정된 실제 등록 IRI |
| 단위 | QUDT Unit | PERCENT·M·SEC·MIN·HR·DAY 고정 allowlist |

`eu-authority-allowlist.ttl`은 EU authority table 전체 복제본이 아니다. 0.1.0에서 허용한 코드의 scheme membership을 고정한 검증 배경이다. 새 코드는 원 발급 URI의 유효성과 의미를 확인한 뒤 minor release로 추가한다.

국토교통 Concept과 외부 Concept의 의미가 입증되지 않으면 `skos:exactMatch`를 쓰지 않는다. 유사 검색은 `skos:closeMatch`, 상하위 관계는 `skos:broadMatch`와 `skos:narrowMatch`를 검토한다.

## 9. SHACL bundle과 판정

| Profile name | 포함 constraint | Gate |
| --- | --- | --- |
| `core` | 공통 conformance bundle: DCAT-AP 3.0.1 + 국토교통 필수 constraint | Violation 0건 |
| `geo` | Geo conformance bundle: GeoDCAT-AP 3.1.0 all-in-one + 국토교통 constraint | Violation 0건 |
| `core-publication` | 공통 profile에 권고·deprecated URI 운영 Gate 추가 | Violation·Warning 0건 |
| `geo-publication` | Geo subprofile에 권고·deprecated URI 운영 Gate 추가 | Violation·Warning 0건 |
| `eu-controlled-audit` | EU 전용 통제어 진단 정책 | 한국 게시 Gate가 아님 |

Core와 Geo는 서로 대체할 수 없다.

- Catalogue와 CatalogueRecord의 marker는 선택한 bundle과 같아야 한다.
- Core·Geo marker를 함께 적을 수 없다.
- `molit:SpatialDataset`·`molit:NetworkDataset`·`molit:networkReference`, GeoDCAT-AP 3.1.0 property 15개, LOCN `geometry`, GeoSPARQL 1.1 class 6개와 property 54개를 사용하면 Geo bundle을 선택한다.
- DCAT 3의 `dcat:bbox`·`dcat:centroid`에 허용된 CRS를 명시한 `geo:wktLiteral` 또는 `geo:gmlLiteral`만 쓴 coverage는 Core에 남을 수 있다. 다른 predicate에서 GeoSPARQL datatype을 쓰면 Geo로 보낸다. 공개 수준과 literal CRS 규칙은 두 profile에 모두 적용한다.

DCAT-AP EU controlled-vocabulary SHACL은 EU corporate body와 유럽 location vocabulary를 전제로 한다.

이를 한국 게시 Gate에 그대로 합치면 국내 기관 registry와 행정구역 URI도 Warning이 된다.

0.1.0은 EU 교환 준비 점검을 `eu-controlled-audit`로 분리한다. 한국 게시 Gate에는 국토교통 allowlist constraint를 적용한다.

SHACL severity는 그 자체로 배포를 중단시키지 않는다. 이 구현은 `Violation`을 수집·게시 거부로 처리하고 publication 검증 정책에서는 `Warning`도 거부한다. 서명된 waiver 검증 체계가 구현되기 전에는 Warning 예외를 허용하지 않는다.

`core-publication`과 `geo-publication`은 별도 응용 프로파일이 아니라 운영 검증 정책이다. 적합성 IRI는 각각 공통 profile과 Geo subprofile을 유지한다.

## 10. 공개 그래프 안전 규칙

전체 Gate는 고정 SHACL bundle만으로 구성되지 않는다. 검증기는 먼저 국토교통 preflight를 실행하고, 통과한 graph에 SHACL을 적용한다.

`bundles/core.ttl`이나 `bundles/geo.ttl`만 실행하면 PII·secret·host·profile alias 검사와 datatype-only routing을 재현하지 못한다.

외부 구현은 같은 preflight를 구현하거나 이 저장소의 고정 검증기와 보고서를 사용해야 한다.

Preflight에서 다음 값이 있으면 `MOLIT-SEC-PUBLIC-*` Violation을 낸다.

- `owl:imports`, `sh:shapesGraph`
- `binding:`, `vault:`, `secret:`, `jdbc:`, `file:` IRI
- 모든 IPv4·IPv6 literal host와 `.internal`, `.local`, `.invalid`, `.home.arpa` host
- `sourceBindingRef`, credential, approval evidence, provider authority predicate
- bearer token, private key, AWS·GitHub credential 형식
- 주민등록번호·전화번호·전자우편 주소 형식의 자유문자열
- `foaf:Person`, `vcard:Individual`, `prov:Person`, `schema:Person`
- `vcard:hasTelephone`로 표현한 기관 대표번호와 개인번호 전부
- 20,000자를 넘는 literal

Runtime은 원격 import를 허용하지 않는다. 공식 artifact와 필요한 import closure는 검토 시점에 저장하고 SHA-256으로 고정한다.

공개 predicate는 DCAT·DCT·PROV·DQV·GeoSPARQL·GeoDCAT-AP·국토교통 확장 등 승인 namespace로 제한한다. 새 외부 어휘는 보안·의미 검토 뒤 allowlist에 추가한다.

공개 NamedNode의 scheme은 HTTP, HTTPS와 `policy/public-value-policy.json`에 정확한 IRI로 등록한 기관 role mailbox의 `mailto`만 허용한다. Domain이나 local-part pattern으로 새 mailbox를 자동 허용하지 않는다.

`vcard:hasEmail`의 object이고, `dcat:contactPoint`가 가리키는 `vcard:Kind`에 속할 때만 입력 graph에서 허용한다.

등록 mailbox의 `vcard:Email` 유형은 `vocabulary/approved-role-mailboxes.ttl` support graph가 제공한다. 두 파일의 목록은 시험에서 대조한다.

0.1.0은 `vcard:hasTelephone`을 기관 대표번호까지 전면 금지한다. 이는 기관 전화 게시를 허용할 수 있는 상위 GeoDCAT-AP보다 엄격한 국내 공개 projection 정책이다. 전화 공개가 필요하면 별도 승인 registry와 개인정보·민원 정책을 정한 다음 release를 올린다.

공개 접근 URL에는 다음 규칙을 적용한다.

- `accessURL`, `downloadURL`, `endpointURL`, `endpointDescription`, `landingPage`와 `homepage`는 query·fragment가 없는 HTTPS IRI만 허용한다.
- 위 접근 URL의 host는 같은 정책 파일의 stable-host allowlist에 있어야 한다. 그 밖의 HTTP(S) IRI도 exact public-host registry에 있어야 한다.
- public-host registry는 승인된 DNS 이름만 받는다. IPv4·IPv6 literal은 공개 도달 가능 여부와 관계없이 거부한다.
- 이 검사는 게시 metadata의 1차 Gate다.
- 실제 crawler와 상태 점검기는 DNS A·AAAA, redirect와 connect target을 다시 검사한다.

단일 subject·predicate는 최대 1,000개 값을 허용하며 제목과 설명은 100개로 제한한다. 공개 안전검사에서 하나라도 위반하면 고비용 SHACL 실행을 시작하지 않는다. SHACL engine의 wall-clock·heap 격리는 아직 구현하지 않았다.

검증기는 artifact lock을 확인하면서 읽은 byte snapshot을 그대로 parse하고 digest에 사용한다. 검증 도중 release 파일을 다시 읽지 않는다.

검증 중 파일 교체와 복원으로 다른 shape를 사용하게 하는 ABA 변경을 허용하지 않는다. RDF text 입력과 runtime JSON은 replacement character를 허용하지 않는 fatal UTF-8 decoding을 사용한다.

## 11. Artifact 구성

| 경로 | 역할 |
| --- | --- |
| `profile-description.ttl` | W3C PROF 기반 machine-readable profile 기술 |
| `ontology/molit-dcat-ap.ttl` | 국토교통 확장 class와 property |
| `shacl/molit-*.ttl` | 국토교통 필수·권고·profile 선택 constraint |
| `shacl/compatibility/dcat-ap-3.0.1-closure.ttl` | 원본이 참조만 한 DataService PropertyShape 2개의 동일 release closure |
| `shacl/upstream/` | 무수정 DCAT-AP·GeoDCAT-AP SHACL |
| `shacl/upstream/w3c-shacl-2017/shacl-shacl.ttl` | local shape와 게시 bundle의 SHACL Core 문법 점검 |
| `vocabulary/upstream/geosparql-1.1/geo.ttl` | Core·Geo routing term 완전성 시험에 쓰는 OGC 1.1.0 고정본 |
| `vocabulary/approved-role-mailboxes.ttl` | exact mailbox의 `vcard:Email` support registry |
| `vocabulary/` | SKOS scheme, 외부 어휘 고정본과 allowlist |
| `policy/public-value-policy.json` | exact mailbox·stable host·public host와 전화 게시 정책 |
| `context/` | remote import가 없는 protected JSON-LD context |
| `bundles/core.ttl`, `bundles/geo.ttl` | 외부 검증기에 게시할 결정적 conformance SHACL bundle |
| `bundles/support.ttl` | 후보 data graph에 합친 뒤 SHACL을 실행할 고정 ontology·통제어 support graph |
| `examples/valid/` | 적합 RDF fixture |
| `examples/invalid/` | constraint별 오류 fixture |
| `artifact-lock.json` | 원본 URL·버전·license·SHA-256 |
| `manifest.json` | profile 구성과 resource limit |

`artifact-lock.json`의 digest는 파일을 수정했다고 자동 갱신되지 않는다. 변경한 release 상대경로를 하나씩 검토한 뒤 다음과 같이 명시한다.

```bash
node tools/profile/update-artifact-lock.mjs \
  --reviewed bundles/core.ttl \
  --reviewed shacl/molit-controlled-vocabularies.ttl
```

- 명시한 경로와 실제 변경 경로가 다르면 갱신을 거부한다.
- upstream artifact의 byte가 바뀌면 URL·판·license 등 provenance도 실제 변경내용과 함께 검토한다.
- 새 파일 추가와 기존 파일 삭제는 이 명령으로 승인하지 않는다. inventory와 provenance를 먼저 수동 심사한다.

## 12. 검증 실행

```bash
node src/profile/cli.mjs verify
node src/profile/cli.mjs validate \
  --input profiles/molit-dcat-ap/releases/0.1.0/examples/valid/road-network-catalog.ttl \
  --profile geo-publication \
  --report .local/molit-profile-report.json
```

정상 결과는 exit code `0`, Gate 불합격은 `2`, 입력·구성 오류는 `1`을 반환한다. 보고서는 `molit.shacl-validation-report/1` JSON Schema를 따른다.

보고서에는 국토교통 검증기 source artifact 11개의 결합 SHA-256과 보고서 schema SHA-256을 기록한다. 같은 profile bundle digest라도 검증기 build digest가 다르면 같은 판정 실행으로 보지 않는다.

application build digest와 설치 의존성 증거는 분리한다. win32-x64 release lane은 격리 `npm ci`로 설치한 Node package tree·SBOM, Jena·JRE archive와 설치 tree의 byte·digest를 별도 검증한다.

0.1.0 CLI는 확장자로 판별한 Turtle, N-Triples, N-Quads, RDF/XML과 JSON-LD를 직접 읽는다.

JSON-LD remote context, RDF/XML 외부 entity·XInclude와 RDF 원격 import는 가져오지 않는다. 지원하지 않는 확장자와 media type은 추측해 parse하지 않는다.

일반 `validate`의 exit code `0`은 기술 적합성만 뜻한다. 게시 전에는 다음 명령을 사용한다.

```bash
node src/profile/cli.mjs publish-check \
  --input metadata.ttl \
  --profile geo-publication
```

Working Draft, 미게시 namespace와 미검증 release signature 때문에 0.1.0의 `publish-check`는 적합한 예시도 exit code `2`로 종료한다. 보고서의 `authority.publicationAuthorized`도 `false`다.

## 13. 1.0.0 전환 조건

| ID | 조건 | 0.1.0 상태 |
| --- | --- | --- |
| REL-URI-001 | URI dereference, HTML·Turtle·JSON-LD content negotiation | 미구현 |
| REL-GOV-001 | 운영기관·분야 담당자 승인과 책임자 지정 | 미승인 |
| REL-LIC-001 | 로컬 명세·ontology·vocabulary의 공개 license 승인 | 미승인 |
| REL-MAP-001 | 실제 통합채널 표본과 원천 플랫폼별 mapping 검증 | 일부 조사, 실행 검증 전 |
| REL-VOC-001 | 기관·행정구역·법령·라이선스 국내 통제어 확정 | 미확정 |
| CRS-COVERAGE-001 | 실제 기관 corpus의 CRS 폭·축·geometry·변환 정확도 검증 | source-reference 7종, geometry literal 2종, 실물 분포 미검증 |
| TRANSPORT-UNIT-001 | 교통 관측속도 의미·집계·단위와 ITS fixture 검증 | DQV 품질 단위와 분리, 관측모델 미구현 |
| REL-COMPAT-001 | 직전 release와 semantic diff·migration report | 0.1.0 최초 release |
| REL-ENGINE-001 | 독립 SHACL engine 교차검증 | primary·pySHACL 검증과 Jena 6.1.0 13사례 differential 구현 |
| REL-INTEGRITY-001 | RDFC-1.0 canonical digest와 detached signature | 5개 직렬화 canonical digest 구현, detached signature 미구현 |
| REL-BRIDGE-001 | Platform Bridge v2 canonical model과 fail-closed 연동 | 미구현 |
| REL-SEC-001 | 악성 RDF·대용량·정보누출·SSRF 보안시험 | fatal UTF-8, remote context·entity·import, PII·credential, 비공개 주소, UNC·결과 상한 시험 구현, 외부 침투시험 전 |
| REL-RUNTIME-001 | worker 격리, wall-clock·heap limit, Warning 대량발생 시험 | 값 cardinality·보고서 500건 상한 구현, engine 내부 메모리 상한 미구현 |
| REL-OPS-001 | 변경·폐기·tombstone·민원·복구 runbook | 미작성 |

따라서 0.1.0은 profile과 ontology의 기술 기반 구현이며 최종 표준 완성을 뜻하지 않는다.

## 14. 규격 출처

- [W3C DCAT 3 Recommendation](https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/)
- [SEMIC DCAT-AP 3.0.1 Recommendation](https://semiceu.github.io/DCAT-AP/releases/3.0.1/)
- [SEMIC DCAT-AP reuse guidelines](https://semiceu.github.io/DCAT-AP-reuse-guidelines/)
- [SEMIC GeoDCAT-AP 3.1.0 Recommendation](https://semiceu.github.io/GeoDCAT-AP/releases/3.1.0/)
- [OGC GeoSPARQL 1.1](https://opengeospatial.github.io/ogc-geosparql/geosparql11/)
- [NAPCORE mobilityDCAT-AP 1.1.0 Recommendation](https://w3id.org/mobilitydcat-ap/releases/1.1.0/)
- [W3C SHACL Recommendation](https://www.w3.org/TR/2017/REC-shacl-20170720/)
- [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml)
- [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)
- [IANA IPv6 Global Unicast Address Space](https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.xhtml)
- [W3C SKOS Recommendation](https://www.w3.org/TR/2009/REC-skos-reference-20090818/)
- [W3C PROV-O Recommendation](https://www.w3.org/TR/2013/REC-prov-o-20130430/)
- [W3C Profiles Vocabulary](https://www.w3.org/TR/dx-prof/)
- [OGC GeoSPARQL 1.1](https://www.ogc.org/standards/geosparql/)
- [QUDT schema](https://qudt.org/doc/2026/02/DOC_SCHEMA-QUDT.html)
