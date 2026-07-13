# 국토교통 메타데이터 응용 프로파일 1.0.0-rc.1

작성일: 2026-07-13  
적용판: 1.0.0-rc.1  
상태: Candidate / 발행 승인 전

## 1. 목적과 범위

이 응용 프로파일은 국토교통 데이터 카탈로그가 Dataset, Distribution, DataService, 공간 범위, 교통망 판, 교통 관측, 품질과 데이터 스페이스 제공 후보를 RDF로 교환하는 규칙을 정한다.

다음 항목은 적용 범위 밖이다.

- DSP Catalog·Contract Negotiation·Transfer Process wire message
- 계약 체결, 제공 권한, 접근통제와 Connector 운영 자격
- 원천 Database, object key, credential과 private source binding
- 기관별 XML·API·Excel·Database 수집 adapter
- 원-윈도우를 포함한 기존 플랫폼 전용 입출력 형식

`dataspace-offering` 모듈은 발견용 메타데이터를 검증한다. 이 모듈을 통과해도 DSP Offer가 생성되거나 전송 권한이 승인되지 않는다.

## 2. 후보판 상태와 판정 경계

`manifest.json`의 상태는 `candidate`다. Namespace는 `proposed-not-yet-dereferenceable`이다. 다음 사항은 완료되지 않았다.

- 운영기관의 profile owner·steward·변경심의 승인
- Stable·version IRI의 dereference와 content negotiation
- 로컬 명세·온톨로지·통제어의 공개 라이선스 승인
- Detached release signature와 외부 timestamp
- KS·TTA 원문 조항 기반 crosswalk와 기관 fixture 검증
- 국내 기관·행정구역·법령·공공누리 권위 registry 승인

따라서 이 판을 `MOLIT Recommendation`, 기관 표준 또는 국내 표준 적합판으로 표시하지 않는다. 검증 명령의 exit code `0`은 선택한 후보 모듈의 기술 제약을 통과했다는 뜻이다.

RC.1 Gate는 `release-acceptance.json`, 독립 검토 digest가 고정된 `standards/korean-interoperability-register.json`, `artifact-lock.json`, Gate 시작·종료 시점의 release 경로 Git 상태를 함께 읽는다. 입력이 누락되거나 schema·digest·Git 상태가 맞지 않으면 발행 허용으로 해석하지 않는다.

Candidate 판정은 로컬 기술증거와 `standard-core`·`module-conditional` 결함을 확인한다. Recommendation 판정은 Candidate 조건에 외부 표준 원문과 기관 승인증거를 더한다. `bridge-runtime` 항목은 Profile 판정에 섞지 않고 connector 배포 Gate에서 별도로 닫는다.

## 3. 규범 기준과 참고 기준

### 3.1 규범 기준

| 계층 | 규격 | RC.1 적용 |
| --- | --- | --- |
| 공통 RDF 어휘 | W3C DCAT 3 Recommendation | Dataset·Distribution·DataService 공통 의미 |
| 공공 카탈로그 | DCAT-AP 3.0.1 | `core`, `observation`, `quality`, `dataspace-offering` 기반 SHACL |
| 공간 카탈로그 | GeoDCAT-AP 3.1.0 | `geo`, `network` 기반 SHACL |
| 제약 언어 | W3C SHACL 1.0 | Machine-readable constraint |
| 분류체계 | W3C SKOS | 국토교통 후보 어휘와 mapping 관계 |
| 품질 | W3C DQV | 품질 측정값과 metric |
| 계보 | W3C PROV-O | 방법·증거·변환 계보 참조 |
| 단위 | QUDT | 공식 Unit 재사용과 QUDT factor-unit 모델을 따른 국토교통 후보 DerivedUnit |
| 프로파일 기술 | W3C Profiles Vocabulary | Module과 artifact 기술 |

2026-07-13 기준 normative upstream 판과 source URL을 고정했다. 근거: [manifest](manifest.json), [artifact lock](artifact-lock.json). Runtime에서 최신판을 조회해 바꾸지 않는다.

### 3.2 참고 기준

mobilityDCAT-AP 1.1.0은 DCAT-AP 2.0.1 기반이다. RC.1은 Transport Mode 1.0.0 어휘만 재사용하며 mobilityDCAT-AP SHACL을 blocking bundle에 병합하지 않는다.

SOSA/SSN은 실제 Observation instance 모델의 재사용 후보다. `molit:ObservationDataset`은 카탈로그 Dataset이며 SOSA Observation 또는 ObservationCollection과 동치가 아니다.

### 3.3 국내 기준의 현재 상태

`mappings/domestic-standards-crosswalk.csv`는 0.1.0 legacy 국내 상호운용 register에 등록된 표준마다 검토행을 하나 이상 둔다. KS·TTA 원문을 합법적으로 확보하지 못한 행은 다음 값으로 고정했다.

```text
source_clause = PENDING-LAWFUL-FULLTEXT
conformance_claim = informative-pending
```

이 행은 구현 순서와 손실검토 위치를 정한다. `exactMatch`, 조항 적합성 또는 국내 표준 준수를 주장하지 않는다.

## 4. 적합성 문서와 우선순위

| Artifact | 역할 |
| --- | --- |
| `manifest.json` | Module, bundle, validation dataset와 실행 한도 |
| `requirements/profile-requirements.json` | Property constraint별 requirement ID와 출처 |
| `requirements/upstream-requirement-inventory.json` | 고정한 DCAT-AP·GeoDCAT-AP constraint와 격리 시험의 통합 하위 원장 |
| `requirements/upstream-profile-requirements.csv` | Upstream requirement의 출처·메시지·수정절차·fixture 검토용 표 |
| `requirements/conformance-cases.json` | Requirement와 양성·음성 fixture 연결 |
| `requirements/local-normative-clauses.json` | 로컬 requirement의 규범 문장과 채택 근거 |
| `shacl/upstream/` | 판이 고정된 DCAT-AP·GeoDCAT-AP 원본 constraint |
| `shacl/molit-*.ttl` | 국토교통 로컬 constraint |
| `bundles/*.ttl` | 외부 SHACL engine용 결정적 module bundle |
| `bundles/support.ttl` | 검증기가 추가하는 유일한 trusted support graph |
| `ontology/competency-registry.json`, `ontology/queries/*.rq` | Module별 competency 기대결과와 실행 Query |
| `ontology/term-governance.json` | 로컬 용어별 재사용 판단, domain·range, 상태, 대체정책과 시험 증거 |
| `vocabulary/registry-metadata.json` | 통제어 124개의 상태·유효기간·출처·대체관계 projection |
| `migration/semantic-diff.json` | 0.1.0과 RC.1의 module·requirement·ontology·통제어 차이 |
| `mappings/domestic-standards-crosswalk.csv` | 국내 표준 의미항목과 로컬 constraint·fixture의 조항별 후보 정렬 |
| `publication/content-negotiation.json` | Profile·ontology IRI의 표현 선택 계약 |
| `publication/tombstones.json` | 폐기한 로컬 IRI의 영구 응답과 대체 IRI 계약 |
| `publication/institutional-approval-provenance.candidate.json` | 기관 승인·서명·timestamp가 아직 없음을 고정한 불변 템플릿. 승인본은 release 밖의 detached envelope로 발행 |
| `index.html`, `ontology.html`, `serializations/*.jsonld` | HTML·JSON-LD 공개 표현 |
| `CONFORMANCE.md` | 적합성 주장과 실행 절차 |

문서와 machine artifact가 다르면 어느 한쪽을 임의로 우선하지 않는다. 차이를 release 결함으로 등록하고 같은 변경에서 명세, requirement, shape와 fixture를 함께 고친다.

## 5. 일곱 개 Module

RC.1은 여섯 개 conformance module과 한 개 publication validation policy를 제공한다. `eu-controlled-audit`는 별도 diagnostic이며 일곱 개에 포함하지 않는다.

| 이름 | 종류 | Profile IRI | 포함 범위 |
| --- | --- | --- | --- |
| `core` | Conformance | `/1.0.0-rc.1` | DCAT-AP 3.0.1과 국토교통 공통 카탈로그 규칙 |
| `geo` | Conformance | `/1.0.0-rc.1/geo` | GeoDCAT-AP 3.1.0, 공간 공개수준과 geometry |
| `network` | Conformance | `/1.0.0-rc.1/network` | `geo` 기반과 판이 있는 교통망 참조 |
| `observation` | Conformance | `/1.0.0-rc.1/observation` | `core` 기반과 관측항목·집계·결측·단위 |
| `quality` | Conformance | `/1.0.0-rc.1/quality` | `core` 기반과 DQV·방법·범위·결과·손실 |
| `dataspace-offering` | Conformance | `/1.0.0-rc.1/dataspace-offering` | `core` 기반과 제공 후보 메타데이터 |
| `publication-policy` | Validation policy | `/1.0.0-rc.1/publication-policy` | 권고 property와 deprecated IRI 점검 |

### 5.1 Module 선언

Catalog와 해당 CatalogRecord는 주장하는 각 conformance module의 version IRI를 `dct:conformsTo`로 선언한다. 여러 module IRI를 함께 선언할 수 있다.

예를 들어 교통 관측 Dataset에 품질 측정값이 있으면 다음 두 marker를 함께 선언할 수 있다.

```turtle
@prefix dct: <http://purl.org/dc/terms/> .

<https://data.molit.go.kr/id/example/catalog>
    dct:conformsTo
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/observation>,
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/quality> .
```

각 marker는 독립된 주장이다. 위 graph는 `observation`과 `quality` bundle을 각각 통과해야 한다. 한 module 통과 결과를 다른 module의 결과로 재사용하지 않는다.

### 5.2 Module 조합

- `network` bundle은 GeoDCAT-AP와 공간 constraint를 이미 포함한다.
- `geo`와 `network`를 함께 선언하면 두 module을 각각 검증한다.
- `observation`, `quality`와 `dataspace-offering`은 필요에 따라 함께 선언할 수 있다.
- `core` marker는 공통 module 자체의 적합성을 별도로 주장할 때 선언한다. Domain module bundle에는 필요한 공통 constraint가 이미 들어 있다.
- `publication-policy`는 2단계 검증 정책이다. Dataset 내용 profile marker로 대신 사용하지 않는다.
- `eu-controlled-audit`는 EU 교환 진단이다. 한국 게시 적합성 marker가 아니다.

`publish-check`는 선택한 conformance module에 `publication-policy`를 자동으로 적용한다. 여러 module을 선언한 graph는 module마다 `publish-check`를 실행한다.

## 6. 검증 Dataset 구성

### 6.1 Candidate graph

검증 입력은 instance metadata만 포함한다. Class와 property IRI를 사용하는 것은 허용하지만 다음 ontology·shape graph의 본문을 입력에 병합하지 않는다.

- W3C `dcat.ttl`
- GeoSPARQL ontology
- MOLIT ontology
- SHACL shape graph

Candidate graph에서 `owl:imports`와 `sh:shapesGraph`로 원격 graph를 가져오지 않는다.

### 6.2 Support graph

검증기는 lock으로 고정한 `bundles/support.ttl`만 trusted background로 추가한다.

```text
validation data graph = candidate instance graph + exact locked support.ttl
entailment = none
```

Support graph는 제출 metadata가 아니며 입력 digest에 섞지 않는다. 외부 검증기도 같은 byte의 support graph를 별도 입력으로 사용해야 한다.

### 6.3 Ontology merge를 금지하는 이유

Ontology의 domain, range와 subclass triple을 candidate graph에 합치면 SHACL target이 늘어날 수 있다. 같은 instance graph가 ontology 병합 여부에 따라 적합과 부적합으로 뒤집히면 상호운용 가능한 판정이 아니다.

따라서 “더 많은 배경지식을 넣으면 더 정확하다”는 방식으로 graph를 확장하지 않는다. 추가 추론 결과가 필요하면 RC.1 적합성 결과와 분리해 보고한다.

## 7. 공통 Core 규칙

### 7.1 Catalog와 CatalogRecord

| Resource | 핵심 요구사항 |
| --- | --- |
| Catalog | 한국어 title·description, Publisher IRI 하나, Dataset·Record 각각 하나 이상, KOR language |
| CatalogRecord | 한국어 title, modified 하나, `foaf:primaryTopic` Dataset 하나, KOR language |
| 관계 | `Catalog/dcat:dataset` 집합과 `Catalog/dcat:record/foaf:primaryTopic` 집합이 일치 |
| Module marker | 주장하는 각 module IRI를 Catalog와 관련 Record에 선언 |

Record가 Catalog에 없는 다른 Dataset을 `foaf:primaryTopic`으로 가리키면 `MOLIT-CAT-REL-001`로 거부한다.

### 7.2 Dataset

Dataset에는 다음 국토교통 공통값이 필요하다.

- Publisher scope에서 관리하는 `dct:identifier` 하나. 같은 candidate graph에서는 Publisher–identifier 중복을 거부하고 graph 밖 중복은 운영 registry가 검사
- 한국어 `dct:title`과 `dct:description`
- `foaf:Agent` Publisher IRI 하나
- 국토교통 주제분류 IRI 하나 이상
- 승인된 `dct:accessRights` IRI 하나
- `dct:modified` 하나
- Dataset을 포함하는 Catalog와 CatalogRecord

EU `TRAN`·`REGI`는 교환용으로 추가할 수 있지만 RC.1 Core의 국내 주제값을 대신하지 않는다. 0.1.0과 달리 EU 주제값을 의무화하지 않는다.

### 7.3 DataService와 Agent

DataService에는 한국어 title, HTTPS endpoint와 제공 Dataset 연결이 필요하다. Agent에는 한국어 명칭이 필요하다. Endpoint가 공개 metadata에 안전하다는 판정과 실제 서비스 가용성은 다른 문제다.

## 8. 분야별 의미

### 8.1 Geo

`molit:SpatialDataset`은 DCAT Dataset 유형, reference system과 공간 공개수준을 가진다.

| 용도 | RC.1 후보 범위 |
| --- | --- |
| Source reference system | CRS84, EPSG:4326·3857·4737·5179·5185·5186·5187·5188 |
| 공개 geometry CRS | CRS84, EPSG:4326·3857·5179·5186 |
| WKT geometry | 명시적 CRS가 있는 2차원 Point·LineString·단일 ring Polygon 후보 subset |
| GML geometry | GML 3.2 Point 후보 subset |
| 공개수준 | RC.1 발행 Gate: exact·withheld |

`exact`는 제출된 공간정보를 profile이 추가로 일반화하거나 제거하지 않았다는 선언이다. 비공개 원천과 제출 geometry가 같다는 증거는 아니다.

`withheld`인 공개 graph에는 location, bbox, centroid와 geometry serialization을 넣지 않는다.

`generalized`, `administrative-area`, `bounding-box`, `grid`는 source-to-public 변환 증거와 국내 식별자 registry가 마련될 때까지 vocabulary 후보로만 남긴다. RC.1 적합 graph에는 사용하지 않는다.

Source CRS, 검색용 geometry CRS와 API 요청 CRS가 같다고 가정하지 않는다.

`RA-CRS=fixed`는 다섯 CRS의 고정 근거 byte, RC.1 geometry subset 왕복시험과 EPSG:5186 표준노드링크 표본 1건을 확인했다는 bounded 기술 판정이다.

이 판정은 전체 기관 corpus의 CRS 분포, 지원하지 않는 geometry·수직 CRS·coordinate epoch 또는 운영 변환 정확도를 입증하지 않는다. Recommendation의 국내 실증은 층화 corpus와 기관 승인 fixture로 별도 수행한다.

### 8.2 Network

Network module은 `molit:NetworkDataset`과 `molit:NetworkReference`를 사용한다. NetworkDataset에는 고정한 mobilityDCAT-AP Transport Mode 1.0.0 값 하나 이상과 NetworkReference 하나가 필요하다.

| 의미 | Property |
| --- | --- |
| 발급기관 | `molit:networkAuthority` |
| 망 식별자 | `molit:networkIdentifier` |
| 망 판 | `molit:networkVersion` |
| 요소 유형 | `molit:networkElementType` |
| Snapshot byte | `molit:networkSnapshotChecksum` SHA-256 `xsd:hexBinary` |
| 생명주기 | candidate·current·superseded·withdrawn |
| 유효일 | `molit:networkValidFrom`, 선택 `networkValidUntil` |
| 후속 판 | `dct:isReplacedBy` |

망 식별자 문자열이 같아도 발급기관이나 판이 다르면 같은 참조로 병합하지 않는다. 과거 판은 `superseded` 상태와 checksum을 보존해 과거 Dataset을 재현한다.

국가교통정보센터의 `[2026-07-01]NODELINKDATA.zip`을 관찰해 [checksum·CRS·최소 node–link 관계 fixture](examples/source-evidence/standard-node-link-2026-07-01.json)를 만들었다. 이 표본은 구조시험 근거이며 자료의 재배포 허가나 CC BY 적용을 뜻하지 않는다. 권리 승인 전에는 원 ZIP을 release artifact로 배포하지 않는다.

`policy/network-reference-policy.json`은 참조의 동일성 키를 `(networkAuthority, networkIdentifier, networkVersion)`으로 고정한다. 같은 키의 logical record는 하나만 허용한다.

같은 키에 서로 다른 checksum을 붙이면 checksum 충돌이다. 같은 checksum으로 record만 중복해도 중복 identity 오류다. 판이 바뀌었는데 checksum이 같아도 판 변경 근거를 다시 확인한다.

`superseded` 판은 graph 안의 후속 `NetworkReference` IRI 하나를 `dct:isReplacedBy`로 가리키며 유효기간이 겹치지 않아야 한다. candidate·current·withdrawn 판에는 이 링크를 두지 않는다.

`withdrawn` 식별자는 tombstone으로 남긴다.

원천 DBF의 `NODE_ID`·`LINK_ID`는 관찰한 10자리 숫자 문법으로 시험한다. 이 표본 하나를 모든 발급기관의 보편 문법으로 확대하지 않는다.

원천 Shapefile 좌표는 `east-x, north-y` 순서다. RDF에서 EPSG:5186 authority axis를 표기할 때는 `north, east` 순서로 바꾼다. 이 순서 변경은 좌표변환이 아니며 두 단계를 같은 함수로 처리하지 않는다.

`cli validate --profile network`는 SHACL 뒤에 RDF NetworkReference 집합을 policy record로 투영한다. 같은 키의 checksum 충돌, 후속 판 존재, 후속 판의 허용 상태와 유효기간 비중첩을 검사한다.

같은 판의 candidate→current 같은 상태변경 이력은 입력 graph에 없으므로 runtime 판정 범위가 아니다.

`requirements/network-runtime-controls.json`은 이 whole-graph 판정의 control ID, 구현 함수, 양성·음성 lifecycle case와 수정 방법을 고정한다. `npm run profile:network:verify`는 정책, 4개 runtime control과 14개 lifecycle case의 닫힌 대응을 다시 실행한다.

### 8.3 Observation

Observation module은 관측 metadata를 다음 축으로 분리한다.

| 의미 | Property | 후보값 또는 datatype |
| --- | --- | --- |
| 관측기간 | `dct:temporal` | `dct:PeriodOfTime` |
| 시간해상도 | `dcat:temporalResolution` | `xsd:duration` |
| 집계기간 | `molit:aggregationPeriod` | 값 하나를 계산한 시간창인 `xsd:duration` |
| 관측항목 | `molit:observedProperty` | traffic-volume·speed·travel-time |
| 집계방식 | `molit:observationAggregation` | instantaneous·mean·sum·min·max·median |
| 결측정책 | `molit:missingValuePolicy` | preserve·explicit-code·exclude·imputed |
| 관측대상 | `molit:observationSubjectType` | site·section·network-element·facility·vehicle-population·area |
| 단위 | `molit:observationUnit` | 속도: QUDT `KiloM-PER-HR`·`M-PER-SEC`; 교통량: 후보 `vehicle-per-hour`·`vehicle-per-day` 또는 QUDT `NUM`; 통행시간: QUDT `SEC`·`MIN` |

이 Module은 `dcat:Dataset` 수준의 관측 metadata를 정의한다. 개별 관측값이나 센서 이벤트를 `molit:ObservationDataset` 인스턴스로 만들지 않는다.

배포 파일이나 API payload에서 개별 관측을 RDF로 표현할 때는 SOSA/SSN의 Observation·ObservationCollection을 사용한다. Dataset metadata와의 연결 규칙은 별도 payload profile에서 정한다.

따라서 RC.1 ontology는 `molit:ObservationDataset`과 SOSA class를 동치로 선언하지 않는다.

관측값 단위와 DQV 품질값 단위를 혼동하지 않는다. 예를 들어 속도값의 `KiloM-PER-HR`와 완전성 품질값의 `PERCENT`는 다른 경로에 기록한다.

`vehicle-per-hour`와 `vehicle-per-day`는 QUDT 공식 vocabulary 항목이 아니다. RC.1이 QUDT `DerivedUnit`·`FactorUnit` 구조로 정의한 `candidate` term이며 운영기관과 QUDT의 승인을 주장하지 않는다. `vehicle-per-day`를 쓰면 하루 집계 경계의 시간대를 Dataset 설명에 기록한다.

### 8.4 Quality

Quality module은 Dataset의 품질상태와 DQV QualityMeasurement를 검증한다.

`not-assessed` 상태에는 측정값을 연결하지 않는다. `assessed`, `warning`, `failed`, `stale`에는 하나 이상의 `dqv:hasQualityMeasurement`가 필요하다. `stale`은 발행자가 적용 방법과 범위에 따라 내린 판정이다. RC.1 SHACL은 현재 시각이나 최신성 기준시간을 계산하지 않는다.

측정값에는 다음 정보가 필요하다.

- `dqv:computedOn`, `dqv:isMeasurementOf`, `dqv:value`와 품질값 단위
- `molit:qualityEvaluationMethod`
- 공개 projection 범위인 `molit:qualityEvaluationScope`
- `molit:qualityResultKind`
- 별도 `molit:qualityMappingStatement`

`molit:qualityEvaluationMethod`는 방법 유형이고 `molit:qualityEvaluationScope`는 공개 가능한 평가 범위 설명이다. 두 값만으로 실행 알고리즘, 매개변수, 수행주체나 재현 가능성을 주장하지 않는다.

`qualityResultKind`가 `quantitative`이면 5개 수치 metric, `xsd:decimal` `dqv:value`와 metric별 QUDT 단위가 필요하다. `boolean`은 `validation-conformance`, `descriptive`는 `assessment-note` metric을 사용한다.

`categorical`은 `currency-status` metric을 사용한다. DQV·GeoDCAT-AP의 `dqv:value` 범위에 맞춰 `current`, `outdated`, `unknown` 중 한 코드를 `xsd:string`으로 기록한다.

같은 범주의 통제 개념 IRI는 `molit:qualityResultConcept`로 연결한다. 비수치 유형에는 단위를 붙이지 않는다.

결과 유형과 metric·값·단위·범주 개념 조합은 하나의 `sh:xone` 분기로 판정한다.

QualityMappingStatement는 원천 품질요소, 대상 DQV metric, 손실상태와 손실설명을 기록한다.

측정값에 연결된 statement의 `mappedQualityMetric`은 그 측정값의 `dqv:isMeasurementOf`와 같아야 한다. 손실상태는 `lossless`, `reversible-loss`, `irreversible-loss` 중 하나다.

`lossless`가 아닌 모든 상태에는 `molit:qualityLossNote`가 필요하다.

`unmapped`·`not-published` 항목은 DQV 측정값에 연결하지 않고 별도 ledger에 둔다. 대상 metric도 만들지 않는다.

지원하지 않는 ISO 19157 결과를 기존 수치 metric으로 임의 축약하지 않는다.

`dqv:hasQualityMeasurement`로 연결한 Dataset과 `dqv:computedOn` Dataset 집합은 일치해야 한다.

### 8.5 Dataspace offering

신규 제공 후보는 `molit:DataspaceOfferingMetadata`로 기술한다.

| Property | 요구사항 |
| --- | --- |
| `dct:identifier` | Registry scope 식별자 하나 |
| `dct:title` | 한국어 title 하나 이상 |
| `molit:describesOfferingDataset` | 카탈로그 Dataset 하나 |
| `molit:offeringReadinessStatus` | drafting·metadata-conformant·qualification-pending 중 하나 |
| `dct:modified` | 날짜 또는 날짜시각 하나 |

`operationally-qualified`는 승인된 외부 authority registry가 부여하는 운영 판정이다. RC.1 SHACL의 후보 readiness 값에 포함하지 않는다.

`molit:TransferableDataset`과 `molit:TransferDistribution`은 0.1.0 호환 읽기를 위한 deprecated term이다. 신규 graph에는 각각 `dcat:Dataset`, `dcat:Distribution`과 별도 `DataspaceOfferingMetadata`를 사용한다.

### 8.6 Publication policy

Publication policy는 권고 property와 deprecated IRI를 Warning으로 점검한다. Conformance module의 Violation 판정을 대신하지 않는다. Warning waiver 체계가 승인되기 전에는 Warning 0건을 요구한다.

## 9. 통제어와 후보 Registry

### 9.1 로컬 어휘 상태

로컬 ontology와 SKOS term은 `rdfs:isDefinedBy`, `owl:versionInfo`와 `adms:status`를 가진다. RC.1 신규 term의 상태는 `candidate`다. Deprecated term은 `deprecated`로 표시하고 change note를 유지한다.

`vocabulary/registry-metadata.json`은 124개 통제어의 scheme, notation, 원천에 있는 언어별 preferred label, 상태, 유효기간, 출처와 대체관계를 조회용 JSON으로 고정한다. Turtle 정본과 JSON projection이 다르면 `npm run profile:vocabulary:verify`가 실패한다. Registry의 `candidate` 상태를 기관 승인으로 해석하지 않는다.

### 9.2 국내 후보 Registry

`vocabulary/domestic-candidate-registries.ttl`의 모든 식별자는 `/candidate/` 아래에 있다.

- 기관 후보는 운영 `dct:publisher` 또는 Provider authority가 아니다.
- 행정구역 후보는 운영 `dct:spatial` 값이 아니다.
- 법령 후보 registry는 개별 법령 IRI를 아직 발급하지 않는다.
- 공공누리 후보 Concept는 `dct:LicenseDocument`가 아니다.

운영기관 승인과 변경·철회정책 없이 후보 IRI를 권위식별자로 승격하지 않는다.

## 10. 검증 실행

### 10.1 Artifact 검증

```powershell
node src/profile/cli.mjs verify --version 1.0.0-rc.1
```

이 명령은 manifest와 artifact lock의 경로·digest 일치를 검사한다.

RC.1 manifest의 `artifactInventoryPolicy`는 `all-release-files`다. Lock 파일 자체를 제외한 release의 모든 일반 파일을 `artifact-lock.json`에 넣는다. Markdown 문서, HTML·JSON-LD 표현, publication 계약과 ontology Query도 예외가 아니다.

이 파일 중 하나를 고치면 lock과 그 lock digest를 대상으로 한 detached signature는 더 이상 유효하지 않다. 변경검토, lock 재생성과 기관 재서명을 차례로 거쳐야 한다. 기관 키 서명은 `RA-INSTITUTIONAL-SIGNATURE`가 열려 있으므로 아직 완료됐다고 표시하지 않는다.

### 10.2 공개 표현 검증

```powershell
npm run profile:publication:verify
```

검증 대상은 Profile의 `index.html`, `profile-description.ttl`, `serializations/profile-description.jsonld`와 ontology의 `ontology.html`, `ontology/molit-dcat-ap.ttl`, `serializations/molit-dcat-ap.jsonld`다.

`publication/content-negotiation.json`은 `text/html`, `text/turtle`, `application/ld+json`, `Vary: Accept`와 지원하지 않는 Accept의 406 응답을 고정한다. Turtle과 JSON-LD RDF graph가 다르면 실패한다. 이 시험은 배포계약의 일관성만 확인한다. 실제 HTTPS dereference는 `RA-NAMESPACE`가 닫히기 전까지 완료로 표시하지 않는다.

### 10.3 Ontology 의미 검증

```powershell
npm run profile:ontology:verify
```

이 명령은 여섯 module fixture, 열아홉 competency query의 정확한 결과와 OWL-RL 일관성을 검사한다. 자세한 판정은 [competency question](docs/ontology/competency-questions.md)에 있다.

### 10.4 통제어와 이관 차이 검증

```powershell
npm run profile:vocabulary:verify
npm run profile:semantic-diff:verify
npm run profile:ontology:governance:verify
npm run profile:domestic-crosswalk:verify
npm run profile:network:verify
```

첫 명령은 `vocabulary/registry-metadata.json`, 둘째 명령은 `migration/semantic-diff.json`을 정본 Turtle·manifest·requirement와 다시 계산해 byte 단위로 비교한다. Machine diff는 breaking change의 의미검토와 승인을 대신하지 않는다.

### 10.5 요구사항 원장과 격리 증거

```powershell
npm run profile:requirements:upstream:verify
npm run profile:requirements:verify
npm run profile:requirements:upstream:engines
```

첫 명령은 upstream 990행, 3개 격리 shard와 CSV projection을 원문 shape에 다시 대조한다. 둘째 명령은 로컬 requirement와 포함 원장의 digest·합계·blocker를 한 번에 판정한다.

셋째 명령은 shard별 양성·음성 graph를 Node, pySHACL과 Jena로 실행한다.

원문에 constraint component가 없는 폐기 URI 6행은 upstream 원문 적합성에 포함하지 않는다. 로컬 publication-policy 운용으로 별도 집계한다.

### 10.6 단일 Module 검증

```powershell
node src/profile/cli.mjs validate `
  --version 1.0.0-rc.1 `
  --input profiles/molit-dcat-ap/releases/1.0.0-rc.1/examples/valid/network-catalog.ttl `
  --profile network `
  --report .local/network-validation.json
```

### 10.7 복수 Module 검증

Observation과 quality marker를 함께 선언한 graph는 같은 byte 입력을 두 번 검증한다.

```powershell
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input observation.ttl --profile observation
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input observation.ttl --profile quality
```

### 10.8 Publication check

```powershell
node src/profile/cli.mjs publish-check `
  --version 1.0.0-rc.1 `
  --input observation.ttl `
  --profile observation
```

Manifest v2의 `publish-check`는 선택한 conformance module과 `publication-policy`를 같은 입력에 순서대로 적용한다. 두 기술 Gate를 통과해도 release acceptance와 Korean register의 발행조건이 열려 있으면 `publicationAuthorized=false`와 exit code `2`를 반환한다.

### 10.9 RDF 직렬화 동등성

```powershell
npm run profile:rc:serialization-parity:verify
```

이 Gate는 requirement-linked fixture를 Turtle, RDF/XML, JSON-LD, N-Triples와 N-Quads로 변환한다. Canonical graph digest와 Node 판정을 비교하며 Profile별 coverage가 빠지면 실패한다.

Jena parser smoke와 3-engine SHACL 판정은 별도 matrix evidence에서 확인한다. 두 결과를 합쳐 형식 동등성과 engine 동등성을 구분해 판정한다.

## 11. Artifact 구성

| 경로 | 내용 |
| --- | --- |
| `ontology/` | 국토교통 로컬 class·property와 lifecycle |
| `vocabulary/` | 로컬 후보 어휘, 외부 allowlist와 고정 upstream 어휘 |
| `shacl/` | Upstream·로컬·module marker constraint |
| `bundles/` | 7개 module/policy bundle과 support graph |
| `requirements/` | Property constraint 원장과 conformance case |
| `migration/` | 0.1.0→RC.1 semantic diff |
| `examples/` | Module별 양성·음성 fixture |
| `mappings/` | 외부 profile·국내 표준 후보 crosswalk |
| `context/` | Protected JSON-LD context |
| `artifact-lock.json` | Machine-readable artifact inventory와 digest |
| `profile-description.ttl` | W3C PROF 기반 profile·resource 기술 |
| `release-acceptance.json` | 기술시험과 외부 발행승인의 분리 판정 |

외부 artifact의 저작권과 라이선스는 `NOTICE.md`에 기록한다. 로컬 artifact의 라이선스 상태는 `LICENSE.md`를 따른다.

## 12. 0.1.0에서 이관

0.1.0의 Core·Geo 상호배타 marker 구조는 RC.1의 독립 module 복수 선언 구조로 바뀌었다. 자동 문자열 치환만으로 이관하지 않는다.

주요 변경은 다음과 같다.

- Core에서 공간·교통망·관측·품질·제공 의미를 분리
- Core의 EU `TRAN`·`REGI` 의무를 제거하고 국내 주제를 기본으로 변경
- Network checksum·lifecycle·validity 추가
- Observation 항목·대상·집계·결측·단위 추가
- Quality method·scope·result·mapping loss 추가
- `Transferable*` 유형을 폐기하고 `DataspaceOfferingMetadata`로 이관
- Candidate graph와 support graph 분리, entailment `none` 고정
- `core-publication`·`geo-publication` 이름을 없애고 module별 `publish-check`로 변경

구체적인 변환 순서와 rollback 기준은 `MIGRATION.md`에 둔다.

## 13. 원-윈도우와 기존 플랫폼 Adapter

원-윈도우, 통합채널, 기관 Data Lake·Data Hub의 API·Excel·Database 변환기는 이 profile의 규범 artifact가 아니다.

Adapter는 다음 경계를 지킨다.

1. 원천 field와 판을 보존한다.
2. 후보 crosswalk의 손실상태를 기록한다.
3. 출력 RDF에 적용 module marker를 선언한다.
4. 선언한 module마다 검증한다.
5. 운영 자격과 전송 권한을 metadata 적합성으로 대체하지 않는다.

DCAT-AP-KR 또는 원-윈도우와의 변환이 성공해도 RC.1 전체 국내 상호운용성을 입증하지 않는다. 해당 adapter의 mapping·fixture·운영승인은 별도 release로 관리한다.

## 14. Release Gate

RC.1의 machine 판정은 release acceptance, Korean interoperability register의 reviewed bytes, artifact lock과 시작·종료 Git snapshot을 함께 사용한다.

아래 표는 외부 evidence 범위를 설명한 것으로 machine 상태를 대체하지 않는다.

`npm run release:status:rc:candidate`는 Candidate 조건을 판정한다. `npm run release:status:rc`는 기본 대상인 Recommendation을 판정한다. 기존 플랫폼 connector의 권한·mapping·실데이터 항목은 `bridge-runtime` 배포 Gate에서 별도로 확인한다.

Candidate에서 발행판으로 전환하려면 최소한 다음 외부 Gate가 닫혀야 한다.

| Gate | 필요한 증거 |
| --- | --- |
| Owner·governance | 운영기관 승인서, 역할·적용범위·유효기간 |
| Namespace | HTTPS dereference, content negotiation, tombstone 시험 |
| Local license | 명세·온톨로지·어휘·shape의 공개 라이선스 승인 |
| Signature | Detached signature, signer trust와 검증 결과 |
| Domestic standards | 합법 원문, 조항 crosswalk와 이중 validator |
| Domestic vocabulary | 기관·지역·법령·공공누리 권위 registry와 철회정책 |
| Real data | 승인된 층화표본, coverage·loss·거부분포와 digest |
| Geo·transport | Geometry 변환 정확도와 ITS 관측 fixture |
| Operations | 변경·폐기·rollback·민원·복구 runbook |

기술시험 성공은 이 표의 외부 승인을 자동으로 완료하지 않는다. 미해결 상태를 위험수용으로 덮으려면 별도 승인근거, 범위와 만료일이 필요하다.

## 15. 규격 출처

- [W3C DCAT 3](https://www.w3.org/TR/vocab-dcat-3/)
- [SEMIC DCAT-AP 3.0.1](https://semiceu.github.io/DCAT-AP/releases/3.0.1/)
- [SEMIC GeoDCAT-AP 3.1.0](https://semiceu.github.io/GeoDCAT-AP/releases/3.1.0/)
- [W3C SHACL](https://www.w3.org/TR/shacl/)
- [W3C SKOS](https://www.w3.org/TR/skos-reference/)
- [W3C Data Quality Vocabulary](https://www.w3.org/TR/vocab-dqv/)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [W3C Profiles Vocabulary](https://www.w3.org/TR/dx-prof/)
- [OGC GeoSPARQL 1.1](https://www.ogc.org/standards/geosparql/)
- [QUDT](https://qudt.org/)
- [mobilityDCAT-AP 1.1.0](https://w3id.org/mobilitydcat-ap/releases/1.1.0/)
