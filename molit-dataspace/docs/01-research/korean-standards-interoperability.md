# 국내 표준 상호운용성 및 blind spot 검증

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft 검증기준

## 1. 현재 판정

MOLIT-DCAT-AP 0.1.0은 DCAT-AP 3.0.1과 GeoDCAT-AP 3.1.0 RDF를 검사하는 실행 가능한 초안이다. 국내 표준 적합 profile은 아직 아니다.

이번 검증에서 다음 범위를 실행했다.

- release artifact 목록 변경을 자동 승인하지 못하도록 lock 갱신기를 차단형으로 변경
- 잘못된 XSD 날짜·시간 lexical form을 SHACL 실행 전에 거부
- `withheld` 공간정보가 GeoSPARQL 1.1의 다른 property로 위치를 노출하지 못하도록 shape 확장
- pySHACL 0.40.0 독립 engine에서 정상·오류 fixture를 재검증
- Apache Jena 6.1.0과 Core·Geo 13개 사례의 구조 정규화 결과를 비교
- RDF 5개 직렬화의 안전 ingest·RDFC-1.0 digest와 Jena parser 결과를 비교
- source inventory, XSD datatype registry, IANA·CRS snapshot Gate를 실행
- 공공데이터포털 실제 RDF/XML을 content-addressed golden-negative로 고정하고 관찰 결과 10건을 다섯 범주로 분류
- 국내 현행·폐지·확인필요 표준을 machine register로 분리하고 검증하지 않은 준수 문구를 contract test로 차단

다음 범위는 release 차단사항으로 남는다.

- ISO 19115 Part 1 official bytes의 재배포 허가 또는 기관 승인 private cache
- KS X ISO 19115-3 원문 조항 판정과 기관 XML↔RDF 왕복 변환
- TTAK.OT-10.1406, TTAK.KO-10.1422, TTAK.KO-10.1510-Part3, TTAK.KO-10.1557의 원문 조항 crosswalk
- Point 외 WKT·GML geometry 구문과 좌표변환 정확도 검증
- 기관 DB metadata와 공개 Catalog metadata 사이의 실행 가능한 범주 변환 Gate
- 기관·원 보유자·Offering Provider의 승인 entry와 운영 trust anchor

따라서 외부 설명은 다음 문장으로 제한한다.

> 공개 스키마와 고정 공개 fixture를 대상으로 시험한 DCAT-AP 3.0.1 기반 Working Draft다. 국내 기관 profile 및 국가표준 준수 여부는 원문 조항·기관 fixture·독립 engine 시험을 완료한 뒤 별도로 판정한다.

## 2. 증거 수준

표준 번호를 문서에 적는 것과 해당 표준에 적합한 구현을 갖는 것은 다른 상태다.

| 수준 | 확인 내용 | 허용하는 문장 |
| --- | --- | --- |
| 공식 metadata 확인 | 표준번호, 제목, 발행·확인일, 현행·폐지 상태와 공개 초록 | `현행 비교 대상이다` |
| 공개 구현자료 식별 | 공식 XSD·Schematron·예제의 위치와 version | `공개 구현자료를 식별했다` |
| 구현시험 | 고정된 schema와 fixture를 validator로 실행하고 결과·digest를 기록 | `지정 schema와 fixture 시험을 통과했다` |
| 원문 조항 crosswalk | 원문 조항, 항목, cardinality, 코드표와 변환 손실을 검토 | `해당 판의 조항을 mapping했다` |
| 기관 상호운용시험 | 기관 export·API와 정상·오류·삭제 fixture를 양방향 시험 | `해당 기관 interface와 상호운용시험을 통과했다` |
| 기관 적합성 승인 | 지정 기관과 표준 담당자가 판정 기준과 결과를 승인 | 승인 범위 안에서만 `적합` 사용 |

현재 KS·TTA 대부분은 첫 번째 수준이다. ISO/TC 211 공개 schema를 식별한 항목도 국내 KS 원문 적합성을 대신하지 않는다.

machine 정본은 [`standards/korean-interoperability-register.json`](../../standards/korean-interoperability-register.json)이다. 상태 사건의 종류·발생일·확인일을 `statusEventType`, `statusEventDate`, `statusObservedAt`으로 나누고, `implementationEvidence`, `crosswalkEvidence`, `conformanceClaimAllowed`를 별도 field로 관리한다.

표준 lifecycle은 [`evidence/source-register.yaml`](../../evidence/source-register.yaml)의 `lifecycle_*`·`status_event_*` field와 정본 값을 대조한다. 행정규칙과 상태 확인필요 항목도 이 대조에서 제외하지 않는다. 포털 snapshot은 source의 `artifact_path`, `retrieved_at`, `sha256`, `bytes`, `content_type`, `disposition`을 register와 다시 대조한다.

blind spot의 `evidence`는 자유문자열 배열이 아니다. `repository-file`, `source-id`, `control-id`, `note`를 구분한 객체로 기록한다. 저장소 파일은 실제 경로·일반 파일 여부까지 검사한다. `fixed` 상태에는 실행된 control 또는 저장소 파일이 적어도 하나 있어야 한다.

표준 lifecycle, CRS allowlist, blind spot inventory·release 정책과 현재 비차단 결정을 register 밖의 검토 digest로 한 번 더 고정했다.

source와 register를 함께 바꾸거나 무관한 기존 파일을 해소 증거로 넣어도 baseline Gate를 통과하지 못한다.

digest 갱신에는 근거 검토가 필요하다. 이 장치는 공식 응답 원문 snapshot을 대신하지 않는다.

## 3. 국내 현행 기준선

### 3.1 공간 metadata·품질·인코딩

| 기준 | 현행 확인 | profile에서 맡을 일 | 0.1.0 상태 |
| --- | --- | --- | --- |
| KS X ISO 19115-1 | 2025-12-12 확인 | 공간정보와 서비스의 기본 metadata 개념 mapping | 원문 조항 미검토 |
| KS X ISO 19115-2 | 2025-01-24 개정 | 영상·센서·관측의 획득·처리 metadata 보존 | 확장 model 미구현 |
| KS X ISO 19115-3 | 2025-12-12 제정, ISO 19115-3:2023 IDT | 현행 XML XSD·Schematron ingest | 125개 artifact manifest와 offline smoke lane 구현, 승인 cache 대기 |
| KS X ISO 19110 | 2024-05-17 확인 | 지형지물 catalogue와 Dataset 연결 | 제품 routing 미구현 |
| KS X ISO 19111 | 2025-01-24 개정 | CRS와 좌표축 의미 | 7개 CRS 축 정책과 Point lexical 왕복 구현, 변환 정확도 미검증 |
| KS X ISO 19131 | 2025-01-24 개정 | 제품사양과 품질 합격값 연결 | link·판정 미구현 |
| KS X ISO 19157-1 | 2025-12-12 제정 | 품질 요소·척도·평가·보고 | 일부 DQV 수치 projection만 존재 |
| KS X ISO 19157 | 2025-12-12 확인 | 기존 국내 제품표준이 인용하는 품질 계열 | 제품별 적용 routing 미구현 |
| KS X ISO/TS 19157-2 | 2025-12-12 확인 | 기존 19157 계열 품질 XML 인코딩 | XML validator·왕복시험 미구현 |
| KS X ISO 19135-1 | 2024-12-27 확인 | 통제어·코드 등록과 변경관리 | 운영 레지스트리 미승인 |
| KS X ISO 19136-1·-2 | 현행 | GML 기본·확장 인코딩 | root `srsName` pattern만 검사 |
| KS X ISO 19139 | 2022-12-30 폐지 | legacy XML 식별 | 신규 규범 인용 금지 |
| KS X ISO/TS 19139-1 | 2022-12-30 제정 | UML→XML Schema 인코딩 규칙 | 원문 조항 미검토 |
| KS X ISO 19119 | 2024-05-17 확인 | 공간정보 서비스와 `dcat:DataService` 정렬 | service model crosswalk 미구현 |

KS X ISO 19115-1 설명에 `품질`을 포함하면 안 된다. 2018년 개정에서 품질 영역이 분리됐다. 품질 구조는 KS X ISO 19157 계열, 허용값은 KS X ISO 19131 기반 제품사양과 함께 판정한다. 근거: `C-064`, `C-065`.

ISO/TC 211의 current metadata 구현 package는 `/19115/-1/` v1.3.0이며 XSD·Schematron·XML 예제를 공개한다. `/19115/-3/`의 v1.0·v2.0 package는 historical이다.

current package의 125개 URL·digest manifest와 offline smoke lane을 구현했다. ISO 허가 또는 기관 승인 private cache가 없으므로 official bytes Gate는 차단 상태다. 이 결과를 국내 KS 원문 조항 판정으로 바꾸지 않는다. 근거: `SRC-TECH-033`, `SRC-TECH-036`.

비분할 KS X ISO 19136은 폐지됐지만 KS X ISO 19136-1과 -2는 현행이다. 폐지 표준 lint는 비분할 번호를 신규 규범 기준으로 쓰는 경우만 막아야 한다. 근거: `C-067`.

KS X ISO 19157과 KS X ISO 19157-1은 등록부에서 모두 현행으로 표시된다. 기존 제품표준이 인용한 번호를 임의로 새 번호로 바꾸지 않는다.

ISO/TC 211의 unparted 19157 XML package와 19157 Part 1 JSON package도 별도 구현 branch로 고정한다. 근거: `C-065`.

비분할 KS X ISO 19139는 폐지됐다. 현행 KS X ISO/TS 19139-1은 XML 인코딩 규칙이므로 같은 번호로 취급하지 않는다. legacy XML을 수용해도 현행 metadata profile을 준수한다고 판정하지 않는다. 근거: `C-068`.

### 3.2 국내 DCAT·국토정보 profile

| 기준 | 관계 | 필요한 검증 |
| --- | --- | --- |
| TTAK.OT-10.1406 DCAT-AP-KR | DCAT-AP 2.1.0 기반 국내 profile | DCAT-AP 3.0.1로의 class·property·cardinality migration |
| TTAK.KO-10.1422 | DCAT-AP-KR을 확장하는 국내 공간정보 profile | 원문 기반판 확인, GeoDCAT-AP 3.1.0 차이와 국내 fixture 검증 |
| TTAK.KO-10.1510-Part3 | 디지털 국토정보 플랫폼의 Catalog·Dataset·Service metadata | 필수·선택 요소, datatype, 코드표와 profile SHACL 대조 |
| TTAK.KO-10.1557 | 빅데이터 플랫폼 연계용 공통 Catalog 항목 | source 항목별 DCAT path와 손실 등급 대조 |
| TTAE.IT-Y.3603 | 데이터 Catalog metadata 요구사항과 개념모델 | canonical model의 개념 coverage 대조 |
| TTAK.KO-10.1352-Part2 | 공간·교통 용어 mapping | 관계 강도와 적용 문맥 검토 뒤 ontology 반영 |

TTAK.OT-10.1406과 TTAK.KO-10.1422를 현재 profile에 그대로 병합하지 않는다. 기반 DCAT-AP 판이 다르므로 같은 property 이름도 cardinality·range·통제어 요구가 다를 수 있다. 원문을 확보하기 전에는 공개 초록에서 항목을 추정하지 않는다. 근거: `C-070`, `C-071`, `C-074`.

### 3.3 행정규칙

행정안전부 「공공기관의 데이터베이스 표준화 지침」은 기관 내부 DB의 표준용어, 논리·물리 구조와 운영 metadata를 관리한다. 국토지리정보원 「공간정보 표준화지침」은 기관표준의 등록·개정·폐지·공개와 이력을 관리한다.

2026-05-28 시행 「수치지형도 작성 작업 및 성과에 관한 규정」과 별지 2·3은 적용 대상 수치지형도의 metadata·품질 확인항목을 제시한다.

두 지침의 역할은 다음과 같이 분리한다.

```text
기관 DB inventory와 표준용어
  -> private compliance record

공개가 승인된 Dataset 설명과 제공 경로
  -> public DCAT projection

기관표준 번호·판·적용범위·상태
  -> profile and vocabulary registry
```

DB 운영자, DBMS, 물리 테이블과 개인정보·암호화 flag를 public DCAT graph에 복사하지 않는다. 기관표준 등록절차는 ontology axiom의 정확성을 자동 보증하지 않는다. 근거: `C-075`, `C-076`.

2026-07-12 OGC resolver의 CRS84와 EPSG:4737·5179·5185·5186·5187·5188 정의를 고정했다. EPSG coordinate system 2건도 byte와 digest로 보존했다.

offline Gate는 release RDF의 source-reference 7종, authority code와 축 semantic field를 snapshot과 대조한다.

CRS84·EPSG:4737·5179·5185~5188의 공식 축 정책과 2차원 Point WKT·GML lexical tuple은 시험했다. 이 결과는 LineString·Polygon 등 다른 geometry 구문과 좌표변환 정확도를 증명하지 않는다. 근거: `C-080`.

NGII 별지에서 EPSG로 표기한 `102080`부터 `102084`는 공식 authority mapping을 확인하기 전까지 IRI로 만들지 않는다. 근거: `SRC-LAW-018`, `SRC-CRS-001`부터 `SRC-CRS-007`.

VWorld API가 4326·3857 등을 지원하고 NGII·국토교통 Dataset에서 5179·5186을 사용한다는 공식 근거를 확인했다. API 지원목록, 원천 CRS와 공개 geometry literal 허용목록은 같은 개념이 아니다. 종료된 국가공간정보포털을 현행 CRS 근거로 사용하지 않는다. 근거: `C-088`, `C-089`.

표준 노드·링크 구축기준 현행판은 제2026-344호다. 관리지침 제2023-23호와 분리해 적용한다. 2026-07-01 실제 배포본의 byte·digest와 PRJ를 관찰했지만 profile ingest·crosswalk fixture로 실행하지는 않았다. 근거: `C-086`.

기본교통정보 교환 기술기준 I·II·III·IV는 적용 interface가 다르다. 센터간, 현장장비, 인터넷 Open API와 무선 노변·차량 lane에 각각 routing한다. 근거: `C-087`.

행정동·법정동 10자리 code와 행정표준기관 7자리 code를 같은 namespace에 넣지 않는다. 역참조 가능한 국가 공통 IRI를 확인하기 전에는 scheme·code·유효기간과 source를 함께 보존한다. 근거: `C-090`.

## 4. 상호운용 architecture

### 4.1 입력 lane

입력 format과 표준 세대를 한 parser에서 추측하지 않는다.

| lane | 입력 | 검증 순서 | 출력 |
| --- | --- | --- | --- |
| ISO19115-current | KS X ISO 19115-3 계열 XML | namespace·판 식별 → XSD → Schematron → semantic mapping | canonical record + loss ledger |
| ISO19139-legacy | 구 ISO 19139 XML | legacy XSD → 구형임을 표시 → 변환 | canonical record + legacy provenance |
| DCAT-KR | TTAK.OT-10.1406 RDF | RDF parser → 해당 판 profile → 2.1.0→3.0.1 migration | canonical RDF + migration report |
| Korean-GeoDCAT | TTAK.KO-10.1422 RDF | 국내 profile → GeoDCAT-AP migration → MOLIT 제약 | canonical Geo RDF + migration report |
| public-portal-dialect | data.go.kr RDF/XML | 안전 parser → 관찰 범주 분류 → 승인된 보정 | quarantine 또는 canonical 후보 |
| institution-db-export | 기관 JSON·CSV·DB metadata | schema → 운영 metadata 분리 → 공개 eligibility | private compliance + public 후보 |

ISO19139-legacy가 통과해도 KS X ISO 19115-3 적합으로 승격하지 않는다. SEMIC의 ISO 19139→GeoDCAT XSLT는 proof-of-concept 참고자료이며 현재 KS XML lane의 oracle이 아니다.

### 4.2 canonical record와 공개 projection

하나의 공개 RDF graph에 원천 값, 기관 compliance 정보와 DSP Offering 정보를 모두 넣지 않는다.

```text
source snapshot
  -> immutable source evidence
  -> canonical metadata record
       -> private compliance record
       -> public DCAT projection
       -> DSP Offering candidate
```

- source evidence는 원값, schema version, 수집시각과 digest를 보존한다.
- canonical record는 다국어 값, 원천 cardinality와 미공개 값을 보존한다.
- private compliance record는 담당자 개인정보, DB 운영정보, 제품 품질확인서와 승인 evidence를 보존한다.
- public DCAT projection은 승인된 기관 연락처와 role mailbox만 게시한다.
- DSP Offering candidate는 Distribution, DataService, 권리와 실제 source binding이 확인된 Dataset만 받는다.

공개 Catalog 적합성과 DSP Offering 가능성은 별도 Gate다. metadata 변환이 성공해도 제공·계약·재제공 권한이 없으면 Offering을 만들지 않는다.

### 4.3 crosswalk record

각 변환 행은 다음 field를 가져야 한다.

```text
sourceProfile
sourcePointerOrXPath
sourceCardinality
targetPath
transform
authority
lossClass
reverseRule
publicationGate
fixtureIds
```

`lossClass`는 `lossless`, `normalized`, `derived`, `many-to-one`, `not-published`, `unmapped` 중 하나다. source field가 mapping 표와 명시적 제외목록 어디에도 없으면 release를 차단한다.

다음 mapping은 자동 확정하지 않는다.

| 원천 값 | 잘못된 자동 변환 | 처리 |
| --- | --- | --- |
| 시스템 구축일·개선일 | Dataset `dct:issued`·`dct:modified` | private 운영이력에 보존 |
| DB 용량 | Distribution `dcat:byteSize` | 실제 배포 artifact 크기 확인 전 미대응 |
| DBMS 종류 | `dct:format` | private 기술 inventory에 보존 |
| 운영자 전화·이메일 | 공개 `dcat:contactPoint` | 내부 compliance record에 보존 |
| DB·테이블 공개 여부 | `dct:license`·`dct:accessRights` | 법적 공개·권리 심사 입력으로만 사용 |
| BRM·포털 분류 | MOLIT·EU `dcat:theme` | 승인 mapping registry가 없으면 후보 상태 |
| 대표축척 `1:n` | `dcat:spatialResolutionInMeters` | 축척분모와 원문 보존, 미터 자동 환산 금지 |

## 5. 실제 공공데이터포털 RDF/XML 시험

공공데이터포털 상세페이지는 schema.org와 DCAT metadata 다운로드를 제공한다. 실제 endpoint `https://www.data.go.kr/dcat/metadata/linked/100299070`의 2026-07-12 응답을 고정했다.

| 항목 | 고정값 |
| --- | --- |
| fixture | `fixtures/interoperability/data-go-kr-100299070.rdf` |
| 응답 media type | `application/xml;charset=UTF-8` |
| byte 수 | 2,265 |
| SHA-256 | `2e3d631d39d517d6aeb8ba4c63ef87a04963d7f6ce50560d33c519b0984f2115` |
| engine | pySHACL 0.40.0 + rdflib 7.6.0 |
| 0.1.0 Core 결과 | 부적합, 39건 |
| 처리 | golden-negative, quarantine |

고정본의 관찰 결과를 한 종류의 표준 위반으로 묶지 않는다.

| 관찰 | 범주 | 판정 범위 |
| --- | --- | --- |
| 한국어 문자열에 `kr` 지정 | `adapter-normalization` | `kr`은 유효한 Kanuri 코드다. 내용 언어를 확인한 뒤 Korean 코드 `ko`로 보정 |
| timestamp text를 `xsd:date`로 선언 | `datatype-lexical-error` | XSD lexical form 오류 |
| literal `dcat:theme`·`dct:accrualPeriodicity` | `dcat-ap-conformance-error` | 통제 개념 resource가 필요한 위치 |
| `dcat:format`, 쉼표 결합 keyword | `adapter-normalization` | source dialect의 predicate·list 보정. 그 자체를 DCAT syntax 오류로 부르지 않음 |
| 빈 `dcat:mediaType` | `dcat-ap-conformance-error` | media-type resource가 아닌 빈 literal |
| blank publisher·Catalog | `enrichment-required` | 승인된 안정 기관·Catalog 식별자 해소 필요 |
| MOLIT profile marker 없음 | `molit-profile-requirement` | 공공데이터포털 일반 결함이 아니라 이 프로젝트 입력조건 미충족 |

언어코드 판정 근거는 IANA Language Subtag Registry다. `kr`을 미등록 코드라고 설명하지 않는다. 근거: `SRC-IANA-001`, `SRC-KR-003`.

[`data-go-kr-dcat-dialect.v1.json`](../../standards/mappings/data-go-kr-dcat-dialect.v1.json)은 관찰한 source path 17개를 mapping 결정 17개에 일대일로 연결한다. 각 행은 변환, 권위, 손실 등급, reverse rule과 publication Gate를 가진다. 날짜·기관·주제·갱신주기와 실제 제공형태는 자동 게시하지 않는다.

이 관찰은 공공데이터포털 전체가 부적합하다는 판정이 아니다. 고정 endpoint와 고정 시각의 응답에 대한 결과다.

- adapter는 내용 언어를 source 계약 또는 담당자 검토로 확인한 경우에만 `kr→ko`를 적용한다. 포털 날짜 format과 keyword 분리는 별도 dialect rule로 기록한다.
- 주제·갱신주기·license·publisher는 승인 사전과 권위 레지스트리 없이는 자동 확정하지 않는다.

PR CI는 live endpoint를 호출하지 않는다. scheduled drift job은 아직 구현하지 않았다. 후속 job은 새 응답을 별도 경로에 저장하고 digest·schema·관찰 분류 차이를 검토 요청으로 만들어야 한다.

## 6. 실행한 blind spot 검증

### 6.1 수정 완료

| ID | 기존 결함 | 수정·시험 |
| --- | --- | --- |
| BS-ARTIFACT-INVENTORY | release 아래 새 JSON·TTL·CSV가 lock 갱신 때 자동 승인됨 | 기존 inventory와 다르면 `ARTIFACT_INVENTORY_CHANGE_REQUIRES_REVIEW`; `ST-SUPPLY-001` |
| BS-XSD-LEXICAL | SHACL engine이 잘못된 날짜 lexical form을 놓칠 수 있음 | fatal lexical validator와 `ST-RDF-XSD-001` |
| BS-SPATIAL-WITHHELD | 다른 GeoSPARQL property로 위치 공개 가능 | location·bbox·centroid·geometry·serialization 전 경로 차단 fixture |
| BS-SHACL-ENGINE | production engine과 Apache Jena 결과의 구조 비교가 없었음 | Core·Geo 13개 사례의 focus·path·severity·constraint·shape·value 정규화 비교, Jena 6.1.0 win32-x64 lane |
| BS-RDF-SERIALIZATION | Turtle 외 RDF 직렬화를 production loader가 받지 못했음 | RDF/XML·JSON-LD·N-Triples·N-Quads ingest, RDFC-1.0 digest, Jena parser 비교와 named graph 시험 |
| BS-VALIDATOR-DEPENDENCIES | 실제 설치 module과 validator toolchain byte가 고정되지 않았음 | 격리 `npm ci`, 152개 설치 package tree·153개 SPDX package SBOM, Jena·JRE archive와 설치 tree digest |
| BS-CROSSWALK-INVENTORY | source inventory와 mapping 행의 동시 누락을 검출하지 못했음 | 안전 RDF/XML parser 생성 inventory와 17개 canonical path 완전 대조 |
| BS-XSD-DATATYPE-COVERAGE | 미승인 XSD datatype을 preflight가 건너뛸 수 있었음 | 승인된 15개 datatype의 lexical·value 검사와 unknown XSD datatype 거부 |
| BS-NETWORK-REGISTRY-DRIFT | 수기 IANA 주소표가 official bytes와 연결되지 않았음 | IANA CSV 3종 snapshot, digest 검증과 생성 network policy |
| BS-CRS-REGISTRY-EVIDENCE | OGC resolver 응답 byte와 digest가 없었음 | CRS 7종과 EPSG coordinate system 2종 snapshot, manifest·정책 생성 검증 |

### 6.2 부분 검증

| ID | 확인한 범위 | 남은 차단사항 |
| --- | --- | --- |
| BS-CRS-AXIS | CRS84의 east·north와 EPSG:4737·5179·5185~5188의 north·east 정책 생성, 2차원 Point WKT·GML lexical tuple 왕복 | LineString·Polygon 등 geometry 구문, 좌표변환과 정확도 시험 |

### 6.3 미해결 P0

| ID | release를 막는 이유 | 해소 증거 |
| --- | --- | --- |
| BS-ISO19115-XML-TECH | 125개 official artifact manifest와 offline XSD·Schematron smoke는 구현됐으나 공식 bytes의 저장·재배포 근거가 없음 | ISO 허가 또는 기관이 승인한 private cache |
| BS-ISO19115-KS-CLAUSE | 공개 구현자료로 국내 KS 원문 조항과 기관 XML 왕복성을 판정할 수 없음 | 합법 KS 원문, 조항표와 기관 fixture |
| BS-TTA-CROSSWALK | 국내 최신 국토정보 metadata 조항 미검토 | 합법 원문과 항목별 mapping·fixture |
| BS-DCAT-KR-VERSION | 국내 DCAT profile과 EU 최신판의 차이 미검증 | version migration 표와 이중 validator |
| BS-DB-CATALOG-CATEGORY | 내부 DB 값을 공개 Catalog로 잘못 승격할 수 있음 | `MAP-CATERR-001` negative corpus |
| BS-AUTHORITY-REGISTRY | fail-closed registry·resolver는 구현됐으나 승인 기관 entry와 trust anchor가 없음 | 기관 승인·위임·유효기간·철회·서명 evidence와 운영 trust store |
| BS-REAL-DATA-COVERAGE | 운영 모집단·승인 표본의 mapping coverage와 유실 분포 미측정 | `REL-MAP-001` 실물 검증보고서·fixture·digest |
| BS-CRS-COVERAGE | API·Dataset 실사용 CRS를 확인했지만 지원 geometry·변환 정확도 미검증 | `CRS-COVERAGE-001` corpus·snapshot·geometry 시험 |
| BS-DOMESTIC-VOCABULARY | 국내 code scheme은 확인했으나 공통 IRI와 변경정책 미승인 | `REL-VOC-001` 운영 registry 승인 |

### 6.4 미해결 P1

| ID | 남은 문제 | 해소 Gate |
| --- | --- | --- |
| BS-QUALITY-LOSS | ISO 19157 result·method·scope의 축약 손실을 되돌릴 규칙 없음 | `ISO-DQV-001`, `MAP-LOSS-001` |
| BS-LIVE-DRIFT | 포털·기관 API 변경의 scheduled 비교 없음 | `LIVE-DRIFT-001` |
| BS-STANDARD-STATUS-EVIDENCE | 표준 lifecycle record와 source register가 같은 변경에서 함께 위조될 수 있고 공식 응답 고정본이 없음 | 검토 baseline digest, 공식 status HTML·PDF·WARC 고정본과 SHA-256 |
| BS-CLAIM-SEMANTIC-VARIANTS | 문자열 Gate가 등록하지 않은 동의어·문맥을 완전하게 판정할 수 없음 | 구조화 conformance declaration, 승인자·범위·만료 workflow와 사람 검토 |
| BS-TRANSPORT-UNIT-SEMANTICS | 교통 관측속도 의미·집계·단위 projection과 ITS fixture 없음 | `TRANSPORT-UNIT-001` 관측모델·crosswalk·fixture |

전체 목록과 상태는 machine register의 `blindspots` 배열이 정본이다. `releaseGateRequired`는 문제가 해소된 뒤에도 회귀 방지 Gate를 유지할지를 기록한다. `currentlyBlocksRelease`는 현재 release를 실제로 막는지를 기록한다. `fixed`와 `not-applicable`은 `currentlyBlocksRelease=false`다. 미해결 항목은 `releaseGateRequired=true`일 때만 `currentlyBlocksRelease=true`다.

## 7. 시험 Gate

### 7.1 지금 실행하는 Gate

```powershell
npm run profile:verify
npm run profile:verify:independent
npm run test:contract
npm run verify:release:win32-x64
npm run release:status
```

| Gate | 합격 조건 |
| --- | --- |
| artifact lock | 기존 52개 machine artifact의 digest 일치, inventory 무단 증감 0건 |
| Node profile | release·shape·fixture·preflight 전체 시험 통과 |
| independent SHACL | pySHACL의 정상·오류 기대판정 일치 |
| Jena SHACL differential | 13개 Core·Geo 사례의 정규화 결과와 Jena 6.1.0 결과 일치 |
| RDF parser differential | 5개 직렬화와 named graph N-Quads의 RDFC-1.0 digest 일치 |
| dependency evidence | review lock과 격리 `npm ci`의 152개 설치 package tree·153개 SPDX package SBOM 일치 |
| registry snapshots | IANA CSV와 OGC·EPSG 응답의 byte·digest·semantic field 일치 |
| public portal golden-negative | digest 일치, 10개 관찰의 code·category 일치, Core SHACL 39건 |
| source provenance | 34개 표준·행정규칙의 lifecycle field와 포털 snapshot 6개 provenance field가 source register와 일치 |
| CRS record | IRI의 authority·code와 HTTPS URL, local English `skos:prefLabel` 불일치 0건 |
| public portal crosswalk | 관찰 source path 누락 0건, 모든 손실 행에 reverse rule, 미확정 의미의 자동 게시 0건 |
| public claim | Markdown 표시 text의 named entity·link·default-ignorable 문자 우회 0건, 주석 외 raw HTML 0건 |
| domestic evidence contract | 폐지 표준의 규범 사용 0건, 미검증 표준의 적합성 허용 0건, 모든 P0 미해결 항목의 `releaseGateRequired`·`currentlyBlocksRelease`가 참, `fixed`의 실행 증거 누락 0건 |

### 7.2 잔여 P0 Gate

| ID | 시험 | 합격 조건 |
| --- | --- | --- |
| KS-XML-001 | 현행 ISO 19115 XML | 고정 XSD·Schematron 정상·오류 corpus 통과 |
| KS-XML-002 | legacy ISO 19139 | legacy lane으로만 판정, 현행 적합 승격 0건 |
| MAP-LOSS-001 | 변환 손실 | 모든 행에 loss class와 reverse rule 존재 |
| MAP-CATERR-001 | DB·Catalog 범주 오류 | 금지 자동변환 전부 거부 |
| RT-SPATIAL-ACCURACY-001 | CRS 변환 정확도 | 승인 좌표변환 library와 기준점 corpus가 허용 오차 이내 |
| GEO-LIT-COVERAGE-001 | geometry 구문 | 지원 geometry별 WKT·GML parser 정상·오류 corpus 통과 |
| ISO-DQV-001 | 품질 mapping | 지원 result만 lossless, 미지원 값은 `unmapped` |

engine 결과가 다르면 다수결로 결정하지 않는다. W3C SHACL 의미론, 최소 재현 fixture와 engine issue를 연결하고 판정 전 release를 막는다.

## 8. 기관 증거 확보

### 8.1 표준 원문

프로젝트 또는 발주기관이 다음 원문을 합법적으로 확보해야 한다.

1. TTAK.OT-10.1406
2. TTAK.KO-10.1422
3. TTAK.KO-10.1510-Part1·Part2·Part3
4. TTAK.KO-10.1557
5. TTAK.KO-10.1352-Part2
6. KS X ISO 19115-1·-2·-3
7. KS X ISO 19110·19111·19119·19131·19135-1·19136-1·19136-2
8. KS X ISO 19157·19157-1과 KS X ISO/TS 19157-2·19139-1

표준 PDF는 저장소에 commit하지 않는다. 내부 evidence vault에 다음 항목만 등록한다.

```text
standardId
edition
acquiredOn
lawfulAccessBasis
artifactSha256
reviewedClauses
reviewer
crosswalkVersion
```

### 8.2 기관 interface

국토교통 통합채널과 원천기관에서 다음 자료를 받아야 한다.

- 공식 export·API schema, enum과 version 정책
- stable ID, pagination, baseline·delta·delete 규칙
- 정상·오류·삭제·비공개 상태의 비식별 fixture
- 기관·원 보유자·Offering Provider와 위임 권한 정본
- BRM·공공데이터 분류에서 MOLIT·EU theme로 가는 승인 mapping
- 갱신주기, format, media type과 license 사전
- CRS, 축, 정밀도와 공간 비공개 정책
- file·API·공간·교통망·관측·제한 데이터별 대표 record
- 기관이 인정할 적합성 판정서 형식과 승인자

로그인 화면이나 내부 API 관찰은 공식 interface 계약을 대신하지 않는다. 개인 계정 cookie·API key·표준 원문은 이 저장소에 넣지 않는다.

## 9. blind spot 탐색 절차

탐색은 문서 검토로 끝내지 않고 현재 실행 증거와 다음 Gate를 한 행에 연결한다.

| 탐색 절차 | 현재 실행 증거 | 미해결 Gate |
| --- | --- | --- |
| inventory-extension mutation | `ST-SUPPLY-001`이 release artifact 삽입을 거부 | parser가 추출한 source path와 crosswalk를 대조하는 `BS-CROSSWALK-INVENTORY` |
| parser·engine differential | Node·pySHACL·Jena 13개 사례 결과와 5개 RDF 직렬화의 RDFC-1.0 digest 일치 | 새 shape·직렬화 추가 시 candidate digest 재승인 |
| XSD lexical·value-space mutation | 승인된 15개 datatype 검사와 unknown XSD datatype 거부 | 승인 datatype 목록 변경 시 registry·음성 fixture 동시 검토 |
| semantic roundtrip·loss ledger | mapping 행의 loss class·reverse rule 검사 | ISO 19115 XML, ISO 19157 result와 CRS 좌표의 왕복 corpus |
| 표준 status·version contradiction | `CT-KR-STD-004`·`CT-KR-STD-005`가 상태 조합·날짜 역전·source lifecycle 위조를 거부 | live 표준 등록부 scheduled recheck |
| evidence 독립성·TOCTOU·path traversal | portal body digest, 구조화 evidence path, installed tree·SBOM, no-follow read와 atomic write | signed capture metadata와 live drift review |
| claim negative Gate | `CT-KR-CLAIM-001`이 게시 Markdown의 표시 text를 HTML AST 기준으로 검사하고 주석 외 raw HTML을 거부 | 승인 후 허용범위와 만료를 기록하는 authority workflow |
| live registry drift | IANA CSV 3종과 OGC·EPSG 응답 9종의 content-addressed snapshot·생성 정책 | scheduled refetch와 snapshot 유효기간 Gate |

## 10. 문서 수정 위치

이번 검증으로 다음 문장을 교정했다.

| 파일·절 | 대상 문장·항목 | 교정 |
| --- | --- | --- |
| `standards-and-legal-baseline.md` §4 기존 KS X ISO 19115-1 행 | `식별, 책임, 범위, 품질, 배포와 계보 metadata` | 품질을 제거하고 19157·19131로 분리 |
| 같은 문서 §4 기존 GML 문단 | 비분할 19136 폐지만 설명 | 현행 19136-1·-2를 추가하고 `GML 전체 폐지` 오독 차단 |
| `metadata-and-policy-profile.md` §4 발행·수정 행 | `timezone 포함 ISO 8601` | `xsd:date`와 `xsd:dateTime`의 정밀도·timezone 규칙 분리 |
| 같은 문서 §4 공간해상도 행 | 미터 값만 기록 | 대표축척 분모와 실제 미터 해상도 분리 |
| 같은 문서 §4.2 외부 profile 표 | EU profile 중심 | DCAT-AP-KR·국내 공간 DCAT·TTA 국토정보 profile 추가 |
| 같은 문서 §6 CRS·축 행 | `EPSG URI와 longitude/latitude 순서` | 각 CRS·직렬화의 공식 축 순서로 변경 |
| 같은 문서 §12 첫 문단 | 국내 SHACL 기술 적합성으로 읽힐 표현 | 프로젝트 RDF 검사와 국내 기관 적합성 판정을 분리 |
| `metadata-and-policy-profile.md` §12 검증 표 | `Apache Jena 비교 미구현`, `Turtle만 허용` | 13개 Jena 사례와 RDF 5개 직렬화 구현 범위로 변경 |
| `verification-plan.md` §4.2 Gate 표 | Jena·RDF·Node·IANA·CRS가 모두 미구현이라는 판정 | 구현 Gate와 live drift·좌표변환 잔여범위를 분리 |
| `README.md` §5.1 `.local` 초기화 명령 | `.local` 전체 recursive 삭제 | Discovery 상태 파일만 삭제하고 toolchain cache 보존 |
| `README.md` §5.2 검증 명령 | 기본 `verify`만 제시 | win32-x64 기술 lane과 별도 release 판정 명령 추가 |

## 11. 완료 판정

`표준 수준 완성`은 문서에 표준 번호를 추가한 상태가 아니다. 다음 결과가 모두 있어야 한다.

1. 모든 normative source의 정확한 판과 합법 원문 digest
2. 조항·항목·cardinality·datatype·통제어 crosswalk
3. source field 누락과 묵시적 손실 0건
4. 현행·legacy XML lane의 분리된 schema 시험
5. 국내 DCAT profile version migration과 이중 validator
6. 독립 parser·SHACL engine 결과 일치
7. CRS 축·geometry·품질의 의미 왕복시험
8. 기관 정상·오류·삭제 fixture와 운영 interface 시험
9. authority·vocabulary·표준 변경 governance 승인
10. 기관이 지정한 적합성 판정서와 승인 기록

0.1.0은 Working Draft다. SHACL engine 비교, 다중 RDF parser와 source inventory를 구현했다. XSD datatype, IANA·CRS snapshot과 win32-x64 dependency evidence도 검증한다.

합법 원문, 국내 version migration과 CRS 변환 정확도는 확보되지 않았다. 기관 fixture, 운영 authority와 판정서도 남아 있다. machine register는 현재 차단 상태와 해소 뒤 회귀 Gate를 따로 기록한다.
