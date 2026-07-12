# 온톨로지 재사용 판단과 competency question

작성일: 2026-07-13  
적용판: MOLIT-DCAT-AP 1.0.0-rc.1  
상태: Release Candidate / 운영기관 승인 전

## 1. 목적과 범위

이 문서는 로컬 class와 property가 답해야 하는 질문을 고정한다. 질문에 답할 수 있다는 사실은 SHACL 적합성, 기관 승인 또는 DSP 전송 성공을 뜻하지 않는다.

검증할 graph는 다음 두 부분으로 제한한다.

```text
candidate metadata graph
+ release가 지정한 support graph
```

W3C DCAT, DQV, SOSA, QUDT 전체 ontology를 data graph에 임의로 병합하지 않는다. Query는 RDFS·OWL 추론을 전제하지 않는다. 외부 ontology 병합이나 추론이 필요한 구현은 별도 결과로 표시한다.

## 2. 재사용과 로컬 확장의 경계

| 필요한 의미 | 재사용한 표준 | 로컬 term이 필요한 이유 |
| --- | --- | --- |
| Dataset·Distribution·DataService | DCAT 3·DCAT-AP 3.0.1 | 공통 카탈로그 구조는 새로 만들지 않는다. |
| 시간 범위·시간 해상도 | DCTERMS·DCAT 3 | `dct:temporal`과 `dcat:temporalResolution`을 유지한다. 집계기간은 최소 시간해상도와 같지 않을 수 있어 `molit:aggregationPeriod`를 분리했다. |
| 공간 범위·CRS | DCAT 3·GeoDCAT-AP 3.1.0 | 공간 일반화 수준과 국내 공개정책은 상위 profile에 없어 `molit:spatialDisclosureLevel`로 분리했다. |
| 관측 instance | SOSA/SSN | 실제 센서 관측을 표현할 때 재사용한다. `molit:ObservationDataset`은 관측 instance가 아니라 Dataset의 카탈로그 설명이므로 SOSA class와 동치로 선언하지 않았다. |
| 관측항목·관측대상 | SOSA 참조 | SOSA property는 Observation instance에 적용한다. Dataset 전체가 담는 관측항목과 대상 유형을 요약하기 위해 별도 metadata property를 둔다. |
| 수치 단위 | QUDT | 의미가 맞는 QUDT Unit은 재사용한다. 차량/시간·차량/일은 QUDT factor-unit 모델을 따른 로컬 후보 DerivedUnit으로 분리한다. 관측값 단위와 DQV 품질값 단위를 구분한다. |
| 품질 측정 | DQV | `dqv:QualityMeasurement`, `dqv:Metric`, `dqv:value`를 유지한다. 평가방법, 범위, 결과 유형과 변환 손실은 DQV 기본 property만으로 고정할 수 없어 로컬 property를 추가했다. |
| 계보와 증거 객체 | PROV-O | 증거의 존재와 계보를 표현한다. 증거의 진위, 서명과 승인 효력을 PROV-O 추론으로 판정하지 않는다. |
| 파일 무결성 | SHA-256·`xsd:hexBinary` | NetworkReference에서 판별 단위를 단순화하기 위해 RC.1 checksum 알고리즘을 SHA-256으로 고정했다. 다른 알고리즘은 다음 판의 명시적 변경 대상이다. |
| Profile과 artifact 기술 | Profiles Vocabulary | 응용 프로파일과 배포 artifact를 기술한다. Dataset 내용 schema의 `dct:conformsTo`와 profile marker를 혼동하지 않는다. |
| 제공 메타데이터 | DCAT Resource + 로컬 class | DCAT Dataset만으로 DSP 운영 자격을 주장하지 않기 위해 `molit:DataspaceOfferingMetadata`를 별도 정보 객체로 둔다. DSP Offer·Agreement와 동치가 아니다. |

로컬 term에는 `rdfs:isDefinedBy`, `owl:versionInfo`와 `adms:status`를 기록한다. RC.1에서 현행 term은 `term-status:candidate`, 대체된 `TransferableDataset`과 `TransferDistribution`은 `term-status:deprecated`다. Candidate 표시는 기술검토 가능 상태이며 기관 표준 승인을 뜻하지 않는다.

## 3. 관측 데이터셋

### 3.1 CQ-OBS-01: 무엇을 어떤 대상과 단위로 관측했는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?dataset ?property ?subjectType ?unit
WHERE {
  ?dataset a molit:ObservationDataset ;
           molit:observedProperty ?property ;
           molit:observationSubjectType ?subjectType ;
           molit:observationUnit ?unit .
}
```

기대 답은 Dataset, 관측항목 Concept, 관측대상 유형 Concept와 Unit이다. `속도`라는 label만으로 `km/h`를 추론하지 않는다.

교통량에는 QUDT 공식 `NUM`, RC.1 후보 `vehicle-per-hour` 또는 `vehicle-per-day`를 사용할 수 있다. 두 후보 IRI는 QUDT 공식 어휘가 아니라 `qudt:DerivedUnit`으로 작성한 로컬 term이다. `veh/d`의 집계 경계 시간대는 별도 Dataset 설명에서 확인한다.

### 3.2 CQ-OBS-02: 제공값은 어떻게 집계됐는가

```sparql
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?dataset ?resolution ?method ?period
WHERE {
  ?dataset a molit:ObservationDataset ;
           dcat:temporalResolution ?resolution ;
           molit:observationAggregation ?method ;
           molit:aggregationPeriod ?period .
}
```

`resolution`은 Dataset이 구분할 수 있는 시간 간격이고 `period`는 값 하나를 계산한 시간창이다. 두 값이 같다는 규칙은 없다.

### 3.3 CQ-OBS-03: 결측값을 통계에 어떻게 반영했는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?dataset ?policy ?method
WHERE {
  ?dataset a molit:ObservationDataset ;
           molit:missingValuePolicy ?policy ;
           molit:observationAggregation ?method .
}
```

`exclude-from-aggregation`이면 유효 관측수 또는 coverage를 payload schema·provenance·Quality module 중 적용 가능한 경로에 보존한다. `imputed`이면 대치방법과 원값·대치값 구분도 남긴다.

RC.1 Observation Shape는 외부 payload schema의 해당 필드를 검사하지 않는다. 따라서 이 CQ의 metadata 결과만으로 coverage 보존이나 대치절차 준수를 주장하지 않는다.

### 3.4 CQ-OBS-04: 품질값의 단위를 관측값 단위로 오인하지 않는가

```sparql
PREFIX dqv: <http://www.w3.org/ns/dqv#>
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
PREFIX sdmx: <http://purl.org/linked-data/sdmx/2009/attribute#>
SELECT ?dataset ?observationUnit ?measurement ?qualityUnit
WHERE {
  ?dataset a molit:ObservationDataset ;
           molit:observationUnit ?observationUnit ;
           dqv:hasQualityMeasurement ?measurement .
  ?measurement sdmx:unitMeasure ?qualityUnit .
}
```

두 단위는 독립된 값이어야 한다. 예를 들어 속도 관측은 `KiloM-PER-HR`, 완전성 측정은 `PERCENT`를 사용할 수 있다.

## 4. 교통망 참조

### 4.1 CQ-NET-01: 어떤 발급기관의 어느 판을 참조하는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?dataset ?authority ?networkId ?edition
WHERE {
  ?dataset a molit:NetworkDataset ; molit:networkReference ?reference .
  ?reference molit:networkAuthority ?authority ;
             molit:networkIdentifier ?networkId ;
             molit:networkVersion ?edition .
}
```

동일한 `networkId` 문자열도 발급기관과 판이 다르면 같은 참조로 병합하지 않는다. `owl:sameAs`로 판 차이를 지우지 않는다.

### 4.2 CQ-NET-02: 판의 byte와 생명주기를 고정할 수 있는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?reference ?checksum ?status ?from ?until
WHERE {
  ?reference a molit:NetworkReference ;
             molit:networkSnapshotChecksum ?checksum ;
             molit:networkLifecycleStatus ?status ;
             molit:networkValidFrom ?from .
  OPTIONAL { ?reference molit:networkValidUntil ?until }
}
```

checksum은 RC.1에서 SHA-256 `xsd:hexBinary`다. 배포일, 유효 시작일과 checksum 생성일은 같은 날짜로 간주하지 않는다.

### 4.3 CQ-NET-03: 과거 데이터가 사용한 판을 복원할 수 있는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
PREFIX lifecycle: <https://data.molit.go.kr/id/concept/network-lifecycle-status/>
SELECT ?dataset ?edition ?checksum
WHERE {
  ?dataset molit:networkReference ?reference .
  ?reference molit:networkVersion ?edition ;
             molit:networkSnapshotChecksum ?checksum ;
             molit:networkLifecycleStatus lifecycle:superseded .
}
```

`superseded` 판은 신규 조인의 기본값이 아니지만 과거 데이터 재현을 위해 tombstone과 checksum을 유지한다.

## 5. 제공 메타데이터와 운영 자격

### 5.1 CQ-OFF-01: metadata 적합과 운영 자격을 구분할 수 있는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?offeringMetadata ?dataset ?readiness
WHERE {
  ?offeringMetadata a molit:DataspaceOfferingMetadata ;
                    molit:describesOfferingDataset ?dataset ;
                    molit:offeringReadinessStatus ?readiness .
}
```

결과가 `metadata-conformant`여도 운영 자격은 확인되지 않은 것이다. `operationally-qualified`는 승인된 외부 Provider authority registry의 유효한 판정과 evidence가 있을 때만 사용한다.

### 5.2 CQ-OFF-02: 자격판정에 사용한 evidence를 찾을 수 있는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
PREFIX offering: <https://data.molit.go.kr/id/concept/offering-readiness-status/>
SELECT ?offeringMetadata ?evidence
WHERE {
  ?offeringMetadata a molit:DataspaceOfferingMetadata ;
                    molit:offeringReadinessStatus offering:operationally-qualified ;
                    molit:qualificationEvidence ?evidence .
}
```

Query가 evidence IRI를 반환해도 서명, 발급자, 유효기간과 철회 여부는 운영 registry에서 다시 검증한다.

## 6. 품질 측정과 정보 손실

### 6.1 CQ-QUAL-01: 어떤 방법과 범위에서 나온 결과인가

```sparql
PREFIX dqv: <http://www.w3.org/ns/dqv#>
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?measurement ?metric ?value ?method ?scope ?resultKind
WHERE {
  ?measurement a dqv:QualityMeasurement ;
               dqv:isMeasurementOf ?metric ;
               dqv:value ?value ;
               molit:qualityEvaluationMethod ?method ;
               molit:qualityEvaluationScope ?scope ;
               molit:qualityResultKind ?resultKind .
}
```

`qualityEvaluationScope`는 RC.1의 공개용 문자열 projection이다. 구조화된 모집단, 표본설계와 속성범위는 원천 품질보고서에서 보존한다.

### 6.2 CQ-QUAL-02: 원천 품질 요소가 DQV로 어떻게 옮겨졌는가

```sparql
PREFIX molit: <https://data.molit.go.kr/def/molit-dcat-ap#>
SELECT ?measurement ?mapping ?sourceElement ?targetMetric ?loss ?note
WHERE {
  ?measurement molit:qualityMappingStatement ?mapping .
  ?mapping a molit:QualityMappingStatement ;
           molit:sourceQualityElement ?sourceElement ;
           molit:qualityLossDisposition ?loss .
  OPTIONAL { ?mapping molit:mappedQualityMetric ?targetMetric }
  OPTIONAL { ?mapping molit:qualityLossNote ?note }
}
```

`unmapped`와 `not-published`는 target metric을 두지 않는다. `lossless`가 아닌 모든 상태에는 손실·미매핑·게시제외 사유를 적은 note가 필요하다. `reversible-loss`는 원문 위치와 역변환 규칙이 필요하다. `irreversible-loss`를 무손실로 승격하지 않는다.

### 6.3 CQ-QUAL-03: 측정값이 연결한 Dataset과 실제 평가대상이 같은가

```sparql
PREFIX dqv: <http://www.w3.org/ns/dqv#>
SELECT ?dataset ?measurement ?computedOn
WHERE {
  ?dataset dqv:hasQualityMeasurement ?measurement .
  ?measurement dqv:computedOn ?computedOn .
  FILTER (?dataset != ?computedOn)
}
```

기대 결과는 0건이다. 결과가 있으면 다른 Dataset의 측정값을 재사용한 관계 오류다.

## 7. 후보 국내 registry

### 7.1 CQ-GOV-01: 후보 IRI가 권위식별자로 유통되지 않는가

```sparql
PREFIX adms: <http://www.w3.org/ns/adms#>
PREFIX status: <https://data.molit.go.kr/id/concept/term-status/>
SELECT ?resource
WHERE {
  ?resource adms:status status:candidate .
  FILTER (STRSTARTS(STR(?resource), "https://data.molit.go.kr/candidate/"))
}
```

이 Query의 결과는 검토목록이다. 기관, 행정구역, 법령, 공공누리와 network edition 후보 IRI를 운영 Dataset의 권위값으로 승인하지 않는다.

## 8. RC.1 통과 기준

| 항목 | RC.1 판정 |
| --- | --- |
| Query 결과 | `ontology/competency-registry.json`에 고정한 변수와 binding이 정확히 일치해야 함 |
| Module fixture | 여섯 module의 양성 fixture에서 Catalog ASK가 모두 `true`여야 함 |
| 관계 불변식 | CQ-QUAL-03의 불일치 결과가 정확히 0건이어야 함 |
| 온톨로지 일관성 | OWL-RL closure에 `owl:Nothing` instance, disjoint·equivalence 충돌, 잘못된 domain·range 사용이 없어야 함 |
| 후보 registry | `/candidate/` IRI에 `term-status:candidate`가 있어야 함 |
| 운영 자격 | RDF만으로 `operationally-qualified`를 부여하지 않으며 외부 registry 판정이 필요함 |

KS·TTA 원문 조항, 기관 fixture와 권위 registry가 확보되지 않은 항목은 competency question을 통과해도 국내 표준 적합으로 표시하지 않는다.

### 8.1 기계시험

정본은 다음 두 종류다.

- Query와 기대 binding: `ontology/competency-registry.json`
- 실행 Query: `ontology/queries/*.rq`

문서의 SPARQL fence와 `.rq` 파일이 다르면 시험을 시작하지 않는다. 각 Query에는 `ontology/molit-dcat-ap.ttl`, 정확한 `bundles/support.ttl`, 해당 module의 양성 fixture 하나만 넣는다.

ARQ 단계의 entailment는 `none`이다. OWL 검사는 같은 세 graph에 OWL-RL closure를 별도로 계산한다. 어느 단계도 URL에서 graph를 가져오지 않는다.

0건인 결과는 다음처럼 판정한다.

- CQ-NET-03: 현재 fixture에 `superseded` 판이 없어서 0건이다. 일반 불변식이 아니다.
- CQ-OFF-02: 후보가 `metadata-conformant` 상태라 자격 evidence가 없어서 0건이다.
- CQ-QUAL-03: Dataset과 `computedOn` 불일치가 없어야 하므로 0건이 불변식이다.

실행 명령은 다음과 같다.

```powershell
npm run profile:ontology:verify
```

명령은 저장소에 byte와 digest가 고정된 Jena 6.1.0·Temurin 21.0.11+10을 검증한 뒤 ARQ를 실행한다. OWL 단계는 Python 3.12, RDFLib 7.6.0과 owlrl 7.6.2가 정확히 일치할 때만 실행한다.

Query drift, 기대행 차이, 도구판 차이와 OWL finding은 모두 실패다.
