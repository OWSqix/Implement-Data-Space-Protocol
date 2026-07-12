# 0.1.0에서 1.0.0-rc.1 이관

작성일: 2026-07-13  
대상: MOLIT-DCAT-AP 0.1.0 graph와 검증 설정  
상태: Candidate migration guide

## 1. 목적과 범위

이 문서는 0.1.0 metadata graph를 RC.1 module 구조로 이관하는 순서, breaking change와 rollback 기준을 정한다. 원천 record를 삭제하거나 운영 Dataset을 자동 게시하는 절차가 아니다.

원-윈도우, 통합채널과 기관 플랫폼 adapter는 이 문서의 규범 대상이 아니다. Adapter 출력이 RC.1 graph라면 이 문서의 변환·검증 절차를 적용한다.

## 2. 먼저 확인할 변경

| 0.1.0 | 1.0.0-rc.1 | 영향 |
| --- | --- | --- |
| Manifest schema v1 | Manifest schema v2 | Profile·bundle 선택 코드 변경 |
| `core`, `geo` 중심 | 6 conformance module + publication policy | Domain별 marker와 반복 검증 필요 |
| Core·Geo marker 상호배타 | 독립 module marker 복수 선언 허용 | 선언한 module을 모두 검증 |
| `core-publication`, `geo-publication` | Module별 `publish-check` | Publication policy 자동 합성 |
| Core에 공간·망·관측·품질 shape 혼합 | Domain별 bundle 분리 | 잘못된 module 선택과 빈 주장을 검토 |
| EU `TRAN`·`REGI` + 국내 주제 의무 | 국내 주제 1개 이상, EU 주제 선택 | EU 주제만 있던 graph는 국내 주제 추가 |
| Dataset마다 `qualityStatus` | Quality module에서 품질 의미 검증 | Core-only graph에서 품질 placeholder 제거 가능 |
| `TransferableDataset`·`TransferDistribution` | Deprecated | DCAT resource + 별도 Offering metadata로 이관 |
| Observation 기간·해상도 중심 | 항목·대상·집계·결측·단위 추가 | 기존 관측 graph 보강 필요 |
| Network 식별자·판 중심 | Checksum·lifecycle·validity 추가 | 실제 snapshot evidence 필요 |
| DQV 수치 projection | Method·scope·result kind·loss statement 추가 | 품질 원문과 loss ledger 필요 |
| CRS84·EPSG:5179 중심 allowlist | CRS84·4326·3857·4737·5179·5185~5188과 authority axis policy | 원천 좌표 순서와 RDF authority tuple을 분리해 검토 |
| Support 사용을 구현에 의존 | Instance-only candidate + exact support 규범 | 외부 ontology 병합 제거 |
| Machine artifact 중심 lock inventory | Lock 자체를 제외한 모든 release 일반 파일 | Markdown·HTML·JSON-LD 변경도 lock·서명 갱신 필요 |

`migration/semantic-diff.json`은 0.1.0과 RC.1의 module, requirement, ontology term과 통제어 차이를 기계가 읽는 형태로 고정한다. 다음 명령은 두 판의 정본에서 이 파일을 다시 계산해 byte 단위로 비교한다.

```powershell
npm run profile:semantic-diff:verify
```

Machine diff에 없는 의미변경을 허용한다는 뜻이 아니다. `reviewedBreakingChanges`의 각 항목을 이 문서의 변환규칙, fixture와 rollback 조건에 대조한다.

## 3. 이관 전 보존

변환 전에 다음 값을 고정한다.

1. 원천 graph byte와 SHA-256
2. 사용한 0.1.0 profile marker
3. 원천 시스템·record ID·수집시각과 판
4. 0.1.0 검증보고서와 validator build digest
5. 원천 crosswalk와 unmapped field 목록
6. 비공개 source binding과 공개 projection의 분리 상태

원천 graph는 수정하지 않는다. RC.1 후보 graph를 새 파일 또는 새 graph 이름으로 만든다.

## 4. Module 선택

### 4.1 선택 기준

| Graph 내용 | 선언할 후보 Module |
| --- | --- |
| 공통 DCAT metadata만 있음 | `core` |
| 공간 extent·GeoDCAT·GeoSPARQL 사용 | `geo` |
| `NetworkDataset`·`NetworkReference` 사용 | `network` |
| `ObservationDataset` 사용 | `observation` |
| DQV 측정과 품질 projection 사용 | `quality` |
| 제공 후보 metadata 사용 | `dataspace-offering` |

하나의 graph가 여러 조건에 해당하면 marker를 함께 선언한다. 예를 들어 교통망 관측 Dataset에 품질 측정이 있으면 `network`, `observation`, `quality`를 각각 검토한다.

### 4.2 Marker 변환

0.1.0 marker를 RC.1 IRI로 단순 치환하지 않는다.

```text
0.1.0 core
  -> core, observation, quality, dataspace-offering 중 graph 의미로 선택

0.1.0 geo
  -> geo 또는 network 선택
  -> observation·quality·dataspace-offering이 있으면 추가 선언
```

Catalog와 관련 CatalogRecord에 같은 module 주장 집합을 기록한다. Publication policy IRI와 diagnostic IRI는 Dataset 내용 module marker로 쓰지 않는다.

## 5. Deprecated 제공 유형 이관

### 5.1 0.1.0 입력

```turtle
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix ex: <https://data.molit.go.kr/id/example/> .
@prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .

ex:dataset
    a dcat:Dataset, molit:TransferableDataset ;
    dcat:distribution ex:distribution .

ex:distribution
    a dcat:Distribution, molit:TransferDistribution .
```

### 5.2 RC.1 출력

```turtle
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex: <https://data.molit.go.kr/id/example/> .
@prefix molit: <https://data.molit.go.kr/def/molit-dcat-ap#> .
@prefix readiness: <https://data.molit.go.kr/id/concept/offering-readiness-status/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:dataset
    a dcat:Dataset ;
    dcat:distribution ex:distribution .

ex:distribution a dcat:Distribution .

ex:offering-metadata
    a molit:DataspaceOfferingMetadata ;
    dct:identifier "offering-candidate-001" ;
    dct:title "데이터 스페이스 제공 후보"@ko ;
    dct:modified "2026-07-13"^^xsd:date ;
    molit:describesOfferingDataset ex:dataset ;
    molit:offeringReadinessStatus readiness:drafting .
```

### 5.3 변환 규칙

- `molit:TransferableDataset` 유형을 신규 graph에 복사하지 않는다.
- 기본 `dcat:Dataset` 유형과 Dataset metadata는 유지한다.
- `molit:TransferDistribution` 대신 `dcat:Distribution`을 사용한다.
- Dataset마다 제공 후보가 자동 생성된다고 가정하지 않는다.
- 제공 의도와 책임자가 확인된 Dataset에만 OfferingMetadata를 만든다.
- 초기 status는 `drafting`이다.
- Module 기술검증을 통과한 뒤 `metadata-conformant`로 바꿀 수 있다.
- 외부 자격검토를 실제로 요청한 뒤 `qualification-pending`을 사용할 수 있다.
- RC.1 metadata graph에서 운영 자격 확인값을 자체 발급하지 않는다.

기존 `Transferable*` triple은 원천 archive에 유지한다. 수신자는 migration 기간에 읽을 수 있지만 신규 발신자는 쓰지 않는다.

## 6. Observation 보강

0.1.0 ObservationDataset에는 기간, 시간해상도와 DQV 품질 측정만 있을 수 있다. RC.1에서는 다음 값을 원천 schema와 실제 payload 의미에서 확인한다.

1. `molit:observedProperty`
2. `molit:observationSubjectType`
3. `molit:observationAggregation`
4. `molit:missingValuePolicy`
5. `molit:observationUnit`
6. 필요한 경우 `molit:aggregationPeriod`

Label이나 column 이름만으로 값을 정하지 않는다.

- `speed`는 지점속도와 구간속도를 구분한다.
- `traffic-volume`은 집계기간과 차량 선별조건을 보존한다.
- `travel-time`은 출발·도착 또는 구간 정의를 보존한다.
- 결측코드, 장애코드와 숫자 0을 같은 값으로 취급하지 않는다.
- 품질값 단위를 관측값 단위로 복사하지 않는다.

교통량이 시간당 차량 수 또는 일당 차량 수라면 각각 RC.1 후보 `vehicle-per-hour`, `vehicle-per-day`를 검토한다. 전자는 QUDT `NUM-PER-HR`와 `skos:closeMatch`지만 같은 공식 Unit이라고 주장하지 않는다. 후자는 하루 집계 경계의 시간대를 함께 보존한다.

그 밖에 허용 Unit IRI가 없는 단위는 임의의 로컬 IRI로 바꾸지 않는다. 원천값을 보존하고 module 등록 절차를 거친다.

## 7. Network 보강

NetworkDataset의 기존 `mobilitydcatap:transportMode`를 보존하고 Transport Mode 1.0.0 허용값인지 확인한다. 문자열 교통수단은 label만 보고 IRI로 바꾸지 않는다.

각 NetworkReference에 다음 값을 추가한다.

- SHA-256 `networkSnapshotChecksum`
- `networkLifecycleStatus`
- `networkValidFrom`
- 알려진 경우 `networkValidUntil`

Checksum은 metadata 파일이 아니라 참조하는 고정 snapshot 또는 승인 manifest의 byte를 대상으로 한다. ZIP을 해제한 파일별 checksum과 ZIP byte checksum을 혼용하지 않는다.

Lifecycle 이관 기준은 다음과 같다.

| 원천 상태 | RC.1 후보값 |
| --- | --- |
| 배포 전 검토판 | `candidate` |
| 발급기관의 현행 조인 기준 | `current` |
| 새 판으로 대체됐지만 과거 재현에 사용 | `superseded` |
| 오류·권한·무결성 사유로 사용 중단 | `withdrawn` |

원천 상태 evidence가 없으면 `current`를 기본값으로 넣지 않는다.

## 8. Quality 보강

### 8.1 Dataset와 Measurement 관계

`dqv:hasQualityMeasurement`로 측정값을 연결한 Dataset 집합과 `dqv:computedOn` 집합을 일치시킨다. 다른 Dataset의 측정값을 재사용하지 않는다.

### 8.2 평가 의미

각 QualityMeasurement에 다음 값을 기록한다.

- `molit:qualityEvaluationMethod`
- `molit:qualityEvaluationScope`
- `molit:qualityResultKind`
- `molit:qualityMappingStatement`

QualityMappingStatement에는 원천 품질요소, `qualityLossDisposition`과 조건에 맞는 대상 DQV metric을 둔다. `lossless`가 아닌 모든 상태에는 `qualityLossNote`가 필요하고, `unmapped`·`not-published`에는 대상 metric을 두지 않는다.

KS X ISO 19157 원문 요소를 확인하지 못했다면 source element를 추정해 만들지 않는다. `unmapped`로 남기고 원문 위치와 검토상태를 loss ledger에 기록한다.

## 9. Core와 주제 이관

0.1.0은 `TRAN` 또는 `REGI`와 국내 주제를 함께 요구했다. RC.1은 국내 주제를 하나 이상 요구하고 EU 주제는 선택값으로 유지한다.

| 원천 theme | 처리 |
| --- | --- |
| 국내 주제 + `TRAN`·`REGI` | 모두 유지 가능 |
| 국내 주제만 있음 | 유지 |
| `TRAN`·`REGI`만 있음 | 검토한 국내 주제 추가 필요 |
| 문자열 분류만 있음 | 승인된 mapping 뒤 국내 주제 IRI로 변환 |
| 의미를 결정할 수 없음 | 게시 후보에서 제외하고 unmapped 유지 |

EU 주제를 제거할 필요는 없지만 국내 주제를 자동으로 `TRAN` 하나에 축약하지 않는다.

## 10. Validation Dataset 정리

RC.1 candidate graph에는 instance metadata만 둔다. 0.1.0 검증을 위해 붙였던 다음 graph는 입력에서 분리한다.

- W3C DCAT ontology
- GeoSPARQL ontology
- MOLIT ontology
- SHACL shapes
- 검증기용 vocabulary support triple

검증 실행 때 RC.1의 exact locked `bundles/support.ttl`만 trusted background로 추가한다. Entailment는 `none`이다.

Ontology를 제거한 뒤 RDF type이 사라지는 instance가 있으면 필요한 instance type을 candidate graph에 명시한다. Ontology의 domain·range 추론으로 type을 보충하지 않는다.

0.1.0의 machine artifact 중심 lock 범위를 RC.1에 복사하지 않는다. RC.1 manifest는 `artifactInventoryPolicy: all-release-files`를 사용한다. 따라서 이 migration 문서, 라이선스·거버넌스 문서와 공개 표현도 `artifact-lock.json` inventory에 포함한다.

문서 변경 뒤에는 검토, lock 재생성과 기관 detached signature 갱신이 필요하다. 기관 서명 Gate가 열려 있으면 이관 완료와 release 서명 완료를 구분한다.

## 11. 검증 명령 이관

### 11.1 0.1.0 명령

```powershell
node src/profile/cli.mjs validate --input data.ttl --profile geo-publication
```

### 11.2 RC.1 명령

```powershell
node src/profile/cli.mjs validate `
  --version 1.0.0-rc.1 `
  --input data.ttl `
  --profile network

node src/profile/cli.mjs publish-check `
  --version 1.0.0-rc.1 `
  --input data.ttl `
  --profile network
```

복수 module graph에는 명령을 module 수만큼 반복한다. 모든 명령에서 입력 byte가 같은지 report의 input digest로 대조한다.

## 12. One-window와 Platform Adapter

One-window adapter는 다음 작업만 담당한다.

- 원천 record와 판 수집
- Field 단위 변환과 loss ledger
- 후보 RDF 생성
- Module 선택 근거 기록
- RC.1 validator 호출

Adapter는 다음 결정을 바꾸지 못한다.

- RC.1 cardinality와 통제어
- Candidate graph와 support graph 경계
- 운영 자격 승인
- KS·TTA 적합성 상태
- 국내 권위 IRI 승인

Adapter 자체의 API·Excel·Database mapping은 비규범 패키지로 versioning한다. Adapter가 바뀌어도 RC.1 ontology 의미를 조용히 바꾸지 않는다.

## 13. 이관 완료 판정

Dataset 하나의 이관은 다음 조건을 모두 만족해야 완료다.

1. 원천 graph와 변환 graph의 digest가 있다.
2. 변환에 사용한 crosswalk 판이 있다.
3. 모든 원천 field에 mapped·unmapped·not-published 결정이 있다.
4. 선언한 module을 각각 통과한다.
5. Publication policy 결과가 있다.
6. 손실과 역변환 가능 여부가 기록돼 있다.
7. 운영 자격을 metadata 적합성과 분리했다.
8. 원천 rollback 위치와 담당자가 있다.

RC.1 전체 release 승인은 Dataset 단위 이관 완료와 별도다.

## 14. Rollback

다음 조건이면 RC.1 graph 게시를 중단한다.

- 원천 ID 또는 Publisher 범위가 달라짐
- Catalog–Record–Dataset 관계가 바뀜
- 관측 단위·집계·결측 의미를 확인할 수 없음
- Network snapshot checksum이 일치하지 않음
- Quality mapping의 손실이 기록되지 않음
- Candidate registry IRI가 운영값으로 사용됨
- 일부 선언 module만 통과함

Rollback은 원천 graph로 되돌아가는 것이 아니라 RC.1 후보 graph를 비게시 상태로 전환하고 원천 archive에서 변환을 다시 시작하는 절차다.
