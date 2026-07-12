# 외부 프로파일 정렬 기준

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft

## 1. DCAT-AP 3.0.1

DCAT-AP 3.0.1은 규범 기반이다. 국토교통 프로파일은 base property를 제거하거나 cardinality를 느슨하게 하지 않는다. 한국어 값, 기관별 식별자, 통제어 부분집합, 공간 공개 정밀도와 망 버전을 추가로 요구한다.

공식 single-ID SHACL은 무수정 저장했다. 이 파일이 DataService의 `endpointURL`과 `endpointDescription` PropertyShape를 참조하면서 `sh:path`·range 정의를 생략하므로, 같은 3.0.1 release의 `ranges.ttl`에서 해당 두 정의만 `shacl/compatibility/dcat-ap-3.0.1-closure.ttl`로 복사했다. 게시 Core bundle은 W3C SHACL-SHACL 검사를 통과해야 한다.

권고 property와 deprecated URI 검사는 publication 검증 정책에서 별도 실행한다. `core-publication`과 `geo-publication`은 새로운 적합성 IRI가 아니다.

## 2. GeoDCAT-AP 3.1.0

GeoDCAT-AP 3.1.0은 `molit:SpatialDataset`에 적용한다. 공통 Dataset에 일괄 적용하지 않는다. 국토교통 추가 조건은 다음과 같다.

- `molit:SpatialDataset`의 OGC CRS IRI 1개 이상
- 공개 geometry 정밀도 수준 필수
- 보안 검토 전 exact geometry 공개 금지
- 공간 해상도는 미터 단위 양수 값으로 제한

원 데이터의 `referenceSystem`과 검색용 geometry literal의 CRS는 별도 의미다. 두 값의 일치를 강제하지 않는다.

ISO 19115 원문 metadata를 GeoDCAT RDF로 변환할 때 publisher, license, identifier, Dataset·DataService 관계를 별도 검증한다. reference XSLT 결과를 검토 없이 게시하지 않는다.

### 2.1 ISO 19115 XML 세대 분리

| 입력 lane | 검증 기준 | 0.1.0 판정 |
| --- | --- | --- |
| 현행 | KS X ISO 19115-3에 대응하는 ISO/TC 211 XSD·Schematron | current package 125개 manifest와 offline XSD·Schematron smoke 구현, 승인 official bytes·KS 조항·기관 왕복시험 대기 |
| legacy | ISO 19139 XML Schema | legacy ingest 후보, 현행 국내표준 검증 결과로 승격 금지 |

SEMIC의 `iso-19139-to-dcat-ap` XSLT는 구 ISO 19139 입력을 위한 one-way proof-of-concept다. 현행 KS X ISO 19115-3 mapping의 정답으로 사용하지 않는다. 변환시험에 쓰는 경우 commit과 artifact digest를 고정하고 자체 변환과의 차이만 보고한다.

## 3. mobilityDCAT-AP

| 버전 | 기반 | 0.1.0 처리 |
| --- | --- | --- |
| 1.1.0 Recommendation | DCAT-AP 2.0.1 | SHACL 미병합, Transport Mode 어휘 재사용 |
| 3.0.0 Editor's Draft | DCAT-AP 3.0.1 | 연구·advisory만 허용 |

안정판 1.1.0의 constraint를 DCAT-AP 3.0.1 graph에 합치면 base cardinality와 term 사용이 충돌할 수 있다.

3.0.0이 NAPCORE Recommendation으로 발행되고 import 오류가 해결된 뒤 별도 migration을 수행한다.

## 4. EU controlled-vocabulary audit

DCAT-AP EU SHACL은 EU corporate body, place와 authority table을 전제로 한다. 국내 게시 적합성과 EU portal export 적합성을 한 Gate로 판정하지 않는다.

- 국내 게시: 국토교통 organization·주제·공간 URI와 local allowlist 검증
- EU export 준비: `eu-controlled-audit` 실행 후 corporate body·place mapping을 export adapter에서 보완

같은 원천 graph를 억지로 EU 기관 코드에 맞추지 않는다. export용 파생 graph에는 변환 provenance를 남긴다.

## 5. 국내 DCAT·국토정보 profile

| profile | 기반·범위 | 필요한 산출물 |
| --- | --- | --- |
| TTAK.OT-10.1406 DCAT-AP-KR | DCAT-AP 2.1.0 기반 국내 Catalog profile | 2.1.0→3.0.1 property·cardinality·통제어 migration 표 |
| TTAK.KO-10.1422 | DCAT-AP-KR 확장 국내 공간정보 profile | 원문 기반판 확인과 GeoDCAT-AP 3.1.0 차이표 |
| TTAK.KO-10.1510-Part3 | 디지털 국토정보 플랫폼의 Catalog·Dataset·Service metadata | 필수·선택 요소와 MOLIT SHACL path의 조항별 crosswalk |
| TTAK.KO-10.1557 | 플랫폼 연계용 공통 Catalog 항목 | source 항목, target path, 변환, 손실과 reverse rule 표 |

2026-07-12 현재 위 profile의 공개 상세정보만 확인했다. 로그인 원문을 합법적으로 확보하기 전에는 항목·range·cardinality를 추정하거나 국내 표준 적합성을 표시하지 않는다. 상세 상태는 [`korean-interoperability-register.json`](../../../../../standards/korean-interoperability-register.json)에 기록한다.

NIA의 원-윈도우 연계 가이드 v1.0은 공통 카탈로그가 DCAT-AP 2.1을 준용한다고 명시한다. 원-윈도우 기준을 DCAT-AP 2.0으로 기록하지 않는다. 2.1→3.0.1 migration과 실제 원-윈도우 fixture 검증은 별도 차단조건이다. 상세 국내 정렬은 [`domestic-standards-alignment.md`](domestic-standards-alignment.md)에 기록한다. 근거: `C-083`.
