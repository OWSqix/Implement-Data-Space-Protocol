# 적합성 선언과 검증 절차

작성일: 2026-07-13  
적용판: 1.0.0-rc.1  
상태: Candidate conformance policy

## 1. 목적과 범위

이 문서는 RC.1의 기술 적합성, publication policy와 실제 발행승인을 구분한다. 검증 결과를 기관 표준 인증, 국내 표준 적합성 또는 DSP 운영 자격으로 확대해석하지 않는다.

## 2. 판정 단계

| 단계 | 질문 | 성공 조건 | 성공해도 입증하지 않는 것 |
| --- | --- | --- | --- |
| Artifact integrity | Release byte가 검토본과 같은가 | Manifest·all-release-file lock·digest 일치 | Metadata 적합성 |
| Parse·preflight | 입력이 안전한 instance graph인가 | Parse 성공, public graph·복잡도·lexical finding 0건 | Module cardinality |
| Module conformance | 선택 module 제약을 지키는가 | Violation 0건 | Publication readiness |
| Publication policy | 권고·deprecated 정책을 지키는가 | Warning·Violation 0건 | 운영기관 발행승인 |
| Release acceptance | 외부 소유권·법무·운영 Gate가 닫혔는가 | Machine acceptance register blocker 0건 | 개별 DSP 계약·전송 성공 |
| Operational qualification | 제공 권한과 Connector가 유효한가 | 승인 registry·서명·유효기간·철회검사 통과 | Metadata profile 변경 |

단계는 생략하거나 뒤 순서의 성공으로 앞 단계를 대체할 수 없다.

RC.1은 `artifact-lock.json` 자체를 제외한 release의 모든 일반 파일을 lock에 넣는다. 이 문서, `LICENSE.md`, `governance.md`, `MIGRATION.md`, 공개 HTML·JSON-LD와 배포계약도 포함된다.

Detached signature payload는 lock과 manifest digest를 고정한다. 문서만 고쳐도 변경검토, lock 재생성과 재서명이 필요하다. 기관 서명 Gate가 열려 있는 동안에는 기술검증 성공을 서명된 발행승인으로 표시하지 않는다.

## 3. 적합성 대상

### 3.1 제공자

제공자는 다음 항목을 제출한다.

- Candidate instance graph
- 주장하는 conformance module 이름과 version IRI
- 입력 byte digest
- 사용한 RC.1 version과 bundle digest
- Module별 validation report
- Publication 대상이면 Module별 publication-check report

Provider가 직접 작성하지 않은 원천 record를 변환했다면 source record, crosswalk 판과 loss ledger를 별도 evidence로 보존한다.

### 3.2 수신자

수신자는 DCAT 3와 선택 module term을 RDF로 보존한다. 지원하지 않는 로컬 term 때문에 DCAT 공통 metadata를 삭제하거나 다른 의미로 바꾸지 않는다.

수신자는 다음 추론을 하지 않는다.

- `DataspaceOfferingMetadata` 존재 → 운영 제공 승인
- `metadata-conformant` → Provider authority 확인
- `qualityStatus=assessed` → 품질 합격
- 같은 network identifier → 같은 network 판
- Candidate 국내 IRI → 권위식별자

### 3.3 Validator

Validator는 manifest v2의 module 정의, exact locked artifact와 validation dataset policy를 사용한다. Runtime network import, remote JSON-LD context와 임의 entailment를 사용하지 않는다.

직렬화 parity evidence는 Core 양성 fixture에 대한 Jena smoke test를 남긴다.

별도로 7개 non-diagnostic profile의 모든 requirement-linked 양성·음성 fixture를 Turtle, RDF/XML, JSON-LD, N-Triples, N-Quads로 변환한다.

각 변환은 RDFC-1.0 canonical graph digest와 Node SHACL 판정이 원본과 같은지 검사한다.

Profile별 fixture·requirement·format 수와 requirement registry, case registry digest를 report에 기록한다.

## 4. Module 선언

### 4.1 Conformance Module

| Module | Marker IRI |
| --- | --- |
| `core` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1` |
| `geo` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/geo` |
| `network` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/network` |
| `observation` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/observation` |
| `quality` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/quality` |
| `dataspace-offering` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/dataspace-offering` |

Catalog와 관련 CatalogRecord에 주장할 marker를 `dct:conformsTo`로 선언한다.

### 4.2 복수 Module

RC.1 module은 독립적으로 조합할 수 있다. Canonical marker 복수 선언은 오류가 아니다.

```turtle
@prefix dct: <http://purl.org/dc/terms/> .

<https://data.molit.go.kr/id/example/catalog>
    dct:conformsTo
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/network>,
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/observation>,
        <https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1/quality> .
```

위 graph의 기술 적합성은 세 번 검증한다.

```powershell
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input data.ttl --profile network
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input data.ttl --profile observation
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input data.ttl --profile quality
```

세 report의 input digest가 같아야 한다. 일부 module만 통과하면 graph 전체에 대해 세 module 적합을 주장할 수 없다.

### 4.3 Module을 선언하지 않는 경우

Graph에 domain resource가 없으면 해당 marker를 선언하지 않는다. Shape target이 없어서 결과가 비어 있는 경우를 module 구현 증거로 사용하지 않는다.

`publication-policy`와 `eu-controlled-audit`는 내용 conformance marker가 아니다.

## 5. Validation Dataset

### 5.1 입력 Graph

입력은 instance metadata graph다. 다음 graph를 candidate에 병합하지 않는다.

- W3C DCAT ontology
- GeoSPARQL ontology
- MOLIT ontology
- SHACL shape graph
- 다른 판의 support graph

### 5.2 Trusted Support

Validator가 추가할 수 있는 background는 RC.1 `bundles/support.ttl` 하나다.

```text
candidateGraph = instance-data-only
allowedSupportGraph = bundles/support.ttl
entailment = none
```

Support graph의 byte가 lock과 다르면 판정하지 않는다. Candidate와 support는 입력 digest와 report에서 구분한다.

### 5.3 외부 SHACL Engine

외부 engine은 다음 입력을 분리한다.

```text
data graph: candidate + exact support.ttl
shapes graph: selected bundles/{module}.ttl
entailment: none
```

Bundle만 실행하면 공식 CLI의 parse·public graph·profile alias·complexity preflight 전체를 재현하지 못할 수 있다. 동등한 기술 적합성을 주장하려면 preflight와 conformance case도 구현하거나 공식 CLI report를 제출한다.

특히 WKT Polygon 폐합, 좌표 차원·개수, GML 3.2 Point element 구조와 active XML 차단은 parser-backed publication preflight다.

SHACL의 datatype·CRS·geometry-type 정규식 판정과 섞어 “세 engine 동일 판정”이라고 부르지 않는다. SHACL matrix는 materialized shape graph의 판정만 비교한다.

Node preflight 결과는 별도 control ID와 evidence로 기록한다.

## 6. Requirement 판정

`requirements/profile-requirements.json`은 로컬 constraint를 property 단위로 식별하고, `includedRequirementRegistries`로 고정 upstream 원장을 결합한다. 포함 JSON과 검토용 CSV의 digest, status, 양성·음성 격리 수, blocker 수와 통합 합계 중 하나라도 맞지 않으면 단일 원장 Gate가 실패한다. 각 record는 다음 연결을 가져야 한다.

```text
requirement ID
-> source standard or local rationale
-> shape and constraint key
-> applicable module
-> positive case
-> isolated negative case
-> remediation
```

`requirements/conformance-cases.json`의 `TODO`, 빈 fixture 연결 또는 미검토 상태는 요구사항 coverage 완료로 세지 않는다. 모든 blocking requirement에 승인된 양성·음성 case가 있어야 발행 후보가 된다.

로컬 음성 case는 전체 profile을 다시 실행해 독립 atomic family 하나만 실패해야 한다. `sh:NodeConstraintComponent`의 detail child는 wrapper 대신 child family로 센다.

다른 leaf나 로컬 원장에 귀속되지 않은 upstream result가 함께 나오면 해당 case를 쓰지 않는다.

전체 profile에서 격리하지 못한 조건은 원본 constraint와 owner target만 복사한 `constraint-unit` test overlay로 검사한다. 이 overlay는 적합성 증거용이며 발행 bundle의 규범 범위를 바꾸지 않는다.

Upstream DCAT-AP·GeoDCAT-AP requirement와 로컬 requirement를 같은 출처로 표시하지 않는다. Upstream 원문 PropertyShape는 test-only `sh:targetNode` overlay로 다른 shape와 분리한다.

Blank node shape는 원문 quad를 보존한 결정적 skolem copy임을 검증한다.

원문에 실제 constraint component가 없는 폐기 URI 행은 upstream 적합성으로 세지 않는다. 로컬 publication-policy wrapper로 운용했음을 기록한다.

Ontology 의미시험은 `npm run profile:ontology:verify`로 실행한다. 이 명령은 여섯 module 양성 fixture의 Catalog ASK, 열세 competency query의 정확한 binding과 OWL-RL closure를 검사한다. SHACL 적합성시험을 대신하지 않으며 두 Gate를 모두 통과해야 한다.

## 7. Module별 최소 주장

### 7.1 Core

Core 적합성은 DCAT-AP 3.0.1과 국토교통 공통 constraint를 통과했다는 주장이다. Catalog–Record–Dataset 관계 집합도 일치해야 한다.

### 7.2 Geo

Geo 적합성은 GeoDCAT-AP 3.1.0과 RC.1 공간 공개·CRS·geometry subset을 통과했다는 주장이다. 공간 공개수준은 기계 검증 가능한 `exact`와 `withheld`만 허용한다.

`exact` 통과는 profile이 제출값을 추가로 가리지 않았다는 뜻이며 비공개 원천과의 동일성을 입증하지 않는다. 모든 GeoDCAT-AP 구현 또는 임의 geometry 변환 정확도를 뜻하지 않는다.

GML 양성 fixture는 `srsDimension="2"`를 명시한 GML 3.2 Point다. WKT Point·LineString·single-ring Polygon의 parser 왕복과 좌표변환 시험은 Node preflight evidence이며 SHACL regex만 실행한 외부 engine의 geometry 계산 정확도를 뜻하지 않는다.

### 7.3 Network

Network 적합성은 Geo 기반, Transport Mode 1.0.0 값과 NetworkReference identifier·edition·checksum·lifecycle·validity를 통과했다는 주장이다.

CLI는 SHACL 통과 뒤 전체 NetworkReference 집합에서 동일 edition key의 checksum 충돌을 검사한다. `dct:isReplacedBy` 후속 판, 후속 판 허용 상태와 유효기간 비중첩도 검사한다.

같은 판의 상태변경 event history는 RC.1 입력에 없으므로 검사하지 않는다.

실제 표준 노드·링크 배포물과의 동일성은 checksum 대상과 기관 fixture가 있어야 별도로 입증된다.

### 7.4 Observation

Observation 적합성은 관측항목·대상·집계·결측·단위 조합을 통과했다는 주장이다. `vehicle-per-hour`·`vehicle-per-day` 통과는 RC.1 후보 DerivedUnit 사용을 뜻하며 QUDT 공식 등록 또는 기관 단위 승인을 뜻하지 않는다. 기본교통정보 교환 payload interface 준수도 별도로 입증한다.

### 7.5 Quality

Quality 적합성은 상태와 측정 증거의 존재관계, DQV 측정, Dataset 관계, 방법 유형·범위·결과 유형·metric 조합과 별도 mapping loss statement를 통과했다는 주장이다.

방법 유형과 범위만으로 실행 알고리즘의 재현성을 주장하지 않는다. `stale`의 현재 시각·기준시간 계산도 RC.1 SHACL 범위가 아니다.

KS X ISO 19157 적합성이나 제품사양 합격을 뜻하지 않는다.

### 7.6 Dataspace offering

Dataspace-offering 적합성은 제공 후보 metadata의 식별자, Dataset 연결과 candidate readiness를 통과했다는 주장이다. Provider authority, DSP Offer·Agreement와 전송 가능성을 뜻하지 않는다.

## 8. Publication Policy

Manifest v2에서 다음 명령은 conformance module과 publication policy를 자동 합성한다.

```powershell
node src/profile/cli.mjs publish-check `
  --version 1.0.0-rc.1 `
  --input data.ttl `
  --profile quality
```

Report에는 두 하위 report와 결합 decision digest가 있어야 한다.

- Conformance Gate: Violation 0건
- Publication policy Gate: Warning·Violation 0건
- Input byte: 두 하위 report에서 동일
- Profile version: 두 하위 report에서 동일

복수 module graph에는 module별 `publish-check`를 실행한다.

Profile과 ontology 공개 표현은 다음 명령으로 따로 검사한다.

```powershell
npm run profile:publication:verify
```

`publication/content-negotiation.json`은 `text/html`, `text/turtle`, `application/ld+json`, `Vary: Accept`와 지원하지 않는 Accept의 406 응답을 정한다. 실제 파일은 `index.html`, `ontology.html`, 두 Turtle과 `serializations/*.jsonld`다. 검증기는 Turtle–JSON-LD graph 동등성도 확인한다. 이 시험은 `data.molit.go.kr`의 실제 HTTPS 배포를 입증하지 않는다. 배포 증거는 `RA-NAMESPACE`에서 다룬다.

## 9. 허용하는 기술 적합성 문구

Release-acceptance 전에는 다음 범위의 문구만 사용한다.

> 이 graph는 MOLIT-DCAT-AP 1.0.0-rc.1의 `quality` 후보 모듈 기술검증을 통과했다. 입력 digest, bundle digest와 검증보고서는 별도 첨부한다.

복수 module이면 통과한 module 이름을 모두 적고 report를 각각 첨부한다.

다음 문구는 사용하지 않는다.

- 국토교통부 표준 적합
- MOLIT Recommendation 준수
- KS·TTA 표준 적합
- DCAT-AP-KR 완전 호환
- 원-윈도우 상호운용성 입증
- DSP 제공 권한 승인
- 운영 전송 가능 보장

## 10. Diagnostic 결과

`eu-controlled-audit`는 EU controlled-vocabulary 준비상태를 Warning으로 확인한다. Diagnostic 통과 또는 실패는 한국 publication Gate 결과를 바꾸지 않는다.

Diagnostic report를 conformance report로 이름 바꾸지 않는다.

## 11. Release Acceptance

기술 적합성과 publication policy를 모두 통과해도 다음 항목이 열려 있으면 발행할 수 없다.

- 운영기관 owner·governance 승인
- 실제 HTTPS Namespace dereference와 content negotiation 배포
- 로컬 공개 라이선스
- 기관 소유 키의 detached signature와 signer trust
- 국내 표준 조항·실물 fixture
- 국내 권위 vocabulary
- 기관 CRS corpus·ITS 관측 단위·ISO 19157 품질 손실 실증
- 운영·rollback runbook

Machine acceptance report의 `candidateEligible` 또는 `recommendationEligible`이 false이면 사람이 작성한 요약문으로 해당 상태를 바꾸지 않는다. RC 기술후보 판정과 기관 Recommendation 판정은 서로 다른 blocker 집합을 사용한다.

## 12. 독립 구현자 제출물

독립 구현자는 다음 파일을 제출한다.

1. Validator 이름·판·설정
2. Candidate graph digest
3. Support graph digest
4. Module bundle digest
5. Entailment 설정 `none`
6. Parse·preflight 결과
7. SHACL validation report
8. Conformance case 실행결과
9. 차이가 있으면 focus·path·severity·constraint·shape·value 비교표

Message 문자열과 blank node label만 다른 경우와 실제 constraint 결과가 다른 경우를 구분한다.
