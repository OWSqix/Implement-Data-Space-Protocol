# 변경 이력

## 1. 문서 목적

이 문서는 국토교통 데이터 카탈로그 응용 프로파일의 release별 변경 내용을 기록한다.

## 2. 1.0.0-rc.1 - 2026-07-13

상태: Candidate / 발행 승인 전

### 2.1 Breaking change

- Manifest schema를 v1에서 v2로 변경
- Core·Geo 중심의 상호배타 marker를 독립 conformance module 복수 선언으로 변경
- `core-publication`·`geo-publication` profile 이름을 제거하고 module별 `publish-check`가 `publication-policy`를 자동 적용하도록 변경
- Core bundle에서 공간·교통망·관측·품질·제공 의미를 분리
- Candidate instance graph와 exact `support.ttl`만 사용하는 validation dataset policy 추가
- Entailment를 `none`으로 고정하고 W3C DCAT·GeoSPARQL·MOLIT ontology와 shape graph의 candidate 병합 금지
- Dataset theme 규칙에서 EU `TRAN`·`REGI` 의무를 제거하고 국토교통 주제 하나 이상을 기본으로 변경
- 모든 Dataset에 적용하던 `qualityStatus`를 Quality module 범위로 이동

### 2.2 Module 추가

- `core`
- `geo`
- `network`
- `observation`
- `quality`
- `dataspace-offering`
- `publication-policy`

`eu-controlled-audit`는 한국 publication Gate가 아닌 diagnostic으로 유지한다.

### 2.3 Ontology·Vocabulary 추가

- ObservationDataset에 관측항목·대상·집계·집계기간·결측정책·QUDT 단위 의미 추가
- QUDT factor-unit 모델을 적용한 후보 `vehicle-per-hour`·`vehicle-per-day` DerivedUnit과 교통량–단위 조합검사 추가
- NetworkReference에 SHA-256 snapshot checksum, lifecycle과 유효일 추가
- `DataspaceOfferingMetadata`와 제공 준비상태를 추가하고 metadata 적합과 운영 자격을 분리
- QualityMeasurement에 평가방법·범위·결과 유형과 별도 QualityMappingStatement 연결 추가
- 품질 매핑의 원천 요소·대상 DQV metric·손실상태·손실설명 추가
- 모든 로컬 ontology term에 `rdfs:isDefinedBy`, version, candidate·deprecated status와 한·영 정의 추가
- Observation, network lifecycle, offering readiness, quality semantics와 term status SKOS scheme 추가
- 기관·행정구역·법령·공공누리 `/candidate/` registry 추가

### 2.4 Deprecated

- `molit:TransferableDataset`
- `molit:TransferDistribution`

신규 graph는 `dcat:Dataset`, `dcat:Distribution`과 별도 `molit:DataspaceOfferingMetadata`를 사용한다. Deprecated term은 0.1.0 graph 읽기와 migration에만 유지한다.

### 2.5 검증·증거 구조

- Catalog–Record–Dataset 관계 집합 일치 constraint 추가
- DQV Measurement와 `computedOn` Dataset 관계 일치 constraint 추가
- Property constraint 단위 requirements registry 추가
- Requirement와 양성·음성 fixture를 연결하는 conformance case registry 추가
- Manifest에 release-acceptance register와 validation dataset policy 추가
- Module별 published bundle과 공통 support bundle 추가
- `publish-check` report를 conformance module과 publication policy의 결합 판정으로 변경
- 0.1.0 migration, conformance, release-local governance와 license 상태 문서 추가

### 2.6 국내 상호운용성

- Machine register의 국내 표준마다 검토행을 둔 crosswalk 추가
- 합법 원문 조항 미확보 행을 `PENDING-LAWFUL-FULLTEXT`, `informative-pending`으로 고정
- DCAT-AP-KR·GeoDCAT 국내판·KS ISO 19115·19157·19111·표준 노드링크·기본교통정보 후보 관계와 손실 Gate 기록
- 원-윈도우·기존 플랫폼 adapter를 비규범 패키지로 분리

### 2.7 미완료 Release Gate

- 운영기관 owner·steward 승인
- Namespace dereference와 content negotiation
- 로컬 artifact 공개 license
- Detached signature와 외부 timestamp
- KS·TTA 원문 조항 및 기관 fixture
- 국내 기관·행정구역·법령·공공누리 권위 registry
- CRS 변환정확도·ITS 관측·품질손실 실증
- 운영·rollback·tombstone·민원 runbook

따라서 RC.1은 Recommendation 또는 기관 표준으로 발행하지 않는다.

## 3. 0.1.0 - 2026-07-12

- DCAT-AP 3.0.1 공통 SHACL 고정
- GeoDCAT-AP 3.1.0 공간 SHACL 고정
- 국토교통 공통·공간·교통망·관측 품질 SHACL 추가
- 국토교통 ontology와 SKOS scheme 추가
- mobilityDCAT-AP Transport Mode 1.0.0 어휘 재사용
- protected JSON-LD context와 W3C PROF description 추가
- 원격 import를 차단한 검증 CLI와 JSON report contract 추가
- Core·Geo profile marker 정확히 1개와 공간 graph 하향 선택 방지 추가
- DCAT-AP DataService PropertyShape closure와 W3C SHACL-SHACL 검사 추가
- OGC GeoSPARQL 1.1 ontology를 고정하고 6 class·54 property와 GeoDCAT property 15개의 Core·Geo routing 대조 추가
- DCAT bbox·centroid coverage literal의 Core 예외와 임의 Geo datatype 하향 선택 차단 추가
- exact role mailbox JSON 정책과 `vcard:Email` support registry 대조 추가
- 기관 대표번호를 포함한 전화 게시 금지, exact public host 정책과 IPv4·IPv6 literal 전면 거부 추가
- fatal UTF-8, credential-safe 진단값과 validator source·report schema digest 추가
- 정상 2종, 오류 13종 fixture와 conformance·publication·보안 회귀시험 추가
- 운영 namespace와 기관 승인 전 상태를 Working Draft로 제한
