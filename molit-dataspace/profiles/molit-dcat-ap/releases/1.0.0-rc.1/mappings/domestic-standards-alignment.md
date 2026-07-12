# 국내 표준 정렬 기준

작성일: 2026-07-13  
작성 기준: 2026-07-13  
상태: Working Draft / 조항 적합성 미판정

## 1. 적용 범위

이 문서는 MOLIT-DCAT-AP 1.0.0-rc.1과 국내 공간정보·교통·카탈로그 기준의 관계를 기록한다. 표준 제목이나 공개 초록만 확인한 항목을 조항 적합으로 표시하지 않는다.

현재 판정은 다음과 같다.

- 국제 SHACL과 RDF 직렬화 기술시험은 실행했다.
- 국내 표준의 역할을 담을 class·property·입력 lane은 설계했다.
- KS·TTA 원문 조항 crosswalk와 기관 실물 fixture 시험은 완료하지 않았다.
- 따라서 이 문서는 정렬 계획과 증거 경계를 제공하며 국내 기관의 적합성 인증서를 대신하지 않는다.

`standards/korean-interoperability-register.json`은 reviewed digest가 고정된 0.1.0 legacy 기준선이다. RC.1을 위해 내용을 바꾸지 않으며 RC.1의 현재 발행상태를 판정하지 않는다.

RC.1 Gate의 machine 정본은 release root의 `release-acceptance.json`이다. 이 문서와 CSV는 legacy 기준선의 표준 ID를 source inventory로 참조한다.

항목별 후보 관계는 [`domestic-standards-crosswalk.csv`](domestic-standards-crosswalk.csv)에 둔다. CSV는 machine register의 국내 표준마다 한 행 이상을 두어 누락 여부를 확인한다. `source_clause`가 `PENDING-LAWFUL-FULLTEXT`인 행은 조항 mapping이 아니라 검토 대기열이다. `candidate-related`와 `candidate-migration`을 `exactMatch` 또는 적합성 주장으로 읽지 않는다.

## 2. 증거 등급

| 등급 | 요구 증거 | 허용 판정 |
| --- | --- | --- |
| E1 공식 metadata | 표준번호·제목·판·상태·발급원 | 비교 대상 |
| E2 공개 구현자료 | 공식 XSD·Schematron·어휘·예제와 digest | 기술시험 대상 |
| E3 조항 crosswalk | 원문 조항·항목·cardinality·코드표·손실 | 조항 mapping 완료 |
| E4 기관 fixture | 정상·오류·삭제·변경 record와 기대결과 | 해당 interface 시험 완료 |
| E5 운영 승인 | 담당기관 서명, 적용범위·판·만료일 | 승인 범위의 운영 판정 |

현재 국내 기준선 대부분은 E1이다. ISO/TC 211 공개 package의 offline 시험은 E2이며 KS 원문 조항 판정은 E3 이후다.

## 3. 공간 metadata·제품·품질

| 기준 | profile 역할 | 현재 증거 | 미해소 조건 |
| --- | --- | --- | --- |
| KS X ISO 19115-1 | Dataset·DataService 식별·책임·범위·배포 개념 | E1 | 원문 조항과 DCAT path 대조 |
| KS X ISO 19115-2 | 센서·영상의 획득·처리 확장 | E1 | 확장 class와 기관 XML fixture |
| KS X ISO 19115-3 | 현행 ISO 19115 XML 입력 lane | E2 | 승인 official bytes, KS 조항, XML↔RDF 왕복 |
| KS X ISO 19131 | 제품사양과 품질 합격값 연결 | E1 | 제품유형 routing과 제품사양 fixture |
| KS X ISO 19157 계열 | 품질 요소·척도·평가·보고 | E1·부분 구현 | result·method·scope loss ledger와 왕복 |
| KS X ISO 19111 | CRS 식별·축·좌표참조 | E2·부분 구현 | Point 외 geometry와 좌표변환 정확도 |
| KS X ISO 19135-1 | 통제어 등록·변경·폐지 절차 | E1 | 운영 registry·책임자·변경통제 승인 |

ISO 19115 XML은 다음과 같이 세대를 분리한다.

```text
KS X ISO 19115-3 계열 XML
  -> current ISO XSD
  -> current Schematron
  -> canonical record + loss ledger

legacy ISO 19139 XML
  -> legacy validator
  -> legacy 표시
  -> canonical 후보
```

legacy XML이 parse되더라도 현행 KS XML 판정으로 승격하지 않는다.

공개 ISO package 125개 artifact의 manifest와 offline XSD·Schematron smoke lane은 구현했다. ISO 허가 또는 기관 승인 private cache, KS 원문 조항과 기관 왕복 fixture는 확보하지 못했다.

RC.1은 DQV projection에 다음 로컬 의미를 추가했다.

| 의미 | RC.1 term | 경계 |
| --- | --- | --- |
| 평가방법 유형 | `molit:qualityEvaluationMethod` | SKOS 후보값. 알고리즘·표본설계·매개변수는 판이 있는 방법 문서에 보존 |
| 평가범위 | `molit:qualityEvaluationScope` | 공개용 `xsd:string` projection. 구조화 원문을 대체하지 않음 |
| 결과 유형 | `molit:qualityResultKind` | 수치·논리·범주·서술을 구분 |
| 매핑 명세 연결 | `molit:qualityMappingStatement` | Measurement와 별도 loss ledger를 연결 |
| 원천 품질요소 | `molit:sourceQualityElement` | 검토한 원천 element identifier |
| 대상 DQV metric | `molit:mappedQualityMetric` | 동치가 아니라 projection 대상 |
| 손실 처리 | `molit:qualityLossDisposition` | 무손실·원문복원·비가역·미매핑·게시제외 구분 |
| 손실 설명 | `molit:qualityLossNote` | 생략 의미와 역변환 조건 |

이 구조가 KS X ISO 19157 조항 정합성을 입증하지는 않는다. 합법 원문으로 source element, result type, method와 scope를 대조하고 기관 품질보고서를 왕복하기 전까지 `BS-QUALITY-LOSS`는 열린 상태다.

## 4. 교통 기준

### 4.1 표준 노드·링크

표준 노드·링크 구축기준 현행판은 국토교통부고시 제2026-344호이며 2026-07-01 시행됐다. 구축 및 관리지침 제2023-23호와 같은 문서로 취급하지 않는다. 전자는 세계측지계 사용을 요구하고, 후자는 SHP·MIF·GML 배포와 변경이력 파일을 다룬다. 근거: `C-086`.

`molit:NetworkReference`는 다음 값을 분리한다.

| 의미 | profile property | 현재 Gate |
| --- | --- | --- |
| 교통수단 | `mobilitydcatap:transportMode` | Transport Mode 1.0.0 허용값. 국내 분류와의 mapping은 별도 |
| 발급기관 | `molit:networkAuthority` | 승인된 기관 식별자 필요 |
| 망 식별자 | `molit:networkIdentifier` | 필수 |
| 망 판 | `molit:networkVersion` | 필수 |
| 요소유형 | `molit:networkElementType` | node·link 통제값 |
| snapshot byte | `molit:networkSnapshotChecksum` | RC.1 SHA-256 `xsd:hexBinary` |
| 생명주기 | `molit:networkLifecycleStatus` | candidate·current·superseded·withdrawn 후보값 |
| 유효기간 | `molit:networkValidFrom`, `molit:networkValidUntil` | `xsd:date`, 종료일은 선택 |

version 없는 참조와 `owl:sameAs` 기반 병합은 거부한다. 이 구조는 합성 fixture로 시험했다.

국가교통정보센터의 `[2026-07-01]NODELINKDATA.zip`은 257,182,267 byte이며 관찰 SHA-256은 `219020fac55f2faab1029ec9306563a00968f9b27f3910b80c534583b750b9ab`이다. PRJ 매개변수는 EPSG:5186과 일치하지만 EPSG authority code가 없다. 원본 ingest·crosswalk·회귀 fixture 시험 전에는 5186이 명시됐다고 기록하지 않는다. 근거: `C-086`.

### 4.2 기본교통정보와 관측 단위

기본교통정보 교환 기술기준은 번호가 큰 하나의 최신판을 선택하는 구조가 아니다. 근거: `C-087`.

| 기준 | 적용 경계 |
| --- | --- |
| 제2021-1059호 | 센터와 센터 |
| II 제2021-1060호 | 센터와 현장장비, 현장장비 사이 |
| III 제2023-20호 | 인터넷 공개 Open API |
| IV 제2016-208호 | 무선 노변장치와 차량장치 |

공개 metadata profile만으로 네 payload interface를 대체하지 않는다. connector adapter는 실제 연계 경계에 맞는 기준과 fixture를 선택한다. 근거: `C-087`.

기존 QUDT 6종은 DQV 품질측정에 유지한다.

| 품질 의미 | 허용 단위 |
| --- | --- |
| 완전성·논리 일관성 | `PERCENT` |
| 위치 정확도 | `M` |
| 시간 정확도 | `SEC` |
| 적시성 | `SEC`, `MIN`, `HR`, `DAY` |

교통 관측속도의 `km/h`는 품질값이 아니다. RC.1은 관측 metadata를 다음과 같이 분리했다. 근거: `C-085`.

| 의미 | RC.1 term 또는 어휘 |
| --- | --- |
| 관측항목 | `molit:observedProperty`; traffic-volume·speed·travel-time 허용. facility-status는 어휘 후보이며 RC.1 SHACL에서는 미허용 |
| 관측대상 유형 | `molit:observationSubjectType`; site·section·network-element·facility·vehicle-population·area 후보값 |
| 집계방식 | `molit:observationAggregation`; 순간값·합계·평균·최솟값·최댓값·중앙값 후보값 |
| 집계기간 | `molit:aggregationPeriod` `xsd:duration` |
| 결측 처리 | `molit:missingValuePolicy`; 유지·명시코드·집계제외·대치 후보값 |
| 관측값 단위 | `molit:observationUnit`; property–unit 조합검사까지 통과하는 값은 `KiloM-PER-HR`·`M-PER-SEC`·`vehicle-per-hour`·`vehicle-per-day`·`NUM`·`SEC`·`MIN` |

QUDT `KiloM-PER-HR`의 공식 entry를 확인해 RC.1 support와 Observation SHACL allowlist에 넣었다. Shape는 다음 조합을 검사한다.

- `speed↔KiloM-PER-HR·M-PER-SEC`
- `traffic-volume↔vehicle-per-hour·vehicle-per-day·NUM`
- `travel-time↔SEC·MIN`

이 기술 제약은 국내 ITS payload의 숫자와 상태코드를 해당 의미로 변환했다는 증거가 아니다. 원천 단위, 집계기간, 지점·구간 구분, 결측·비정상 코드와 왕복 rule을 기관 fixture로 검증하기 전까지 `TRANSPORT-UNIT-001`은 닫지 않는다.

`vehicle-per-hour`·`vehicle-per-day`는 QUDT factor-unit 모델로 작성한 RC.1 로컬 후보 DerivedUnit이다. QUDT 공식 Unit 또는 기관 승인 단위라고 표시하지 않는다. `vehicle-per-hour`와 QUDT `NUM-PER-HR`의 관계는 `skos:closeMatch`이며 동치가 아니다.

## 5. 국내 Catalog profile

| 기준 | 확인된 기반·범위 | 필요한 migration |
| --- | --- | --- |
| TTAK.OT-10.1406 DCAT-AP-KR | DCAT-AP 2.1.0 기반 | 2.1→3.0.1 class·property·cardinality·통제어 |
| TTAK.KO-10.1422 | DCAT-AP-KR 확장 공간정보 profile | 기반판 확인과 GeoDCAT-AP 3.1.0 차이 |
| TTAK.KO-10.1510-Part3 | 디지털 국토정보 플랫폼 metadata | 원문 항목과 MOLIT SHACL path 대조 |
| TTAK.KO-10.1557 | 플랫폼 연계용 공통 Catalog 항목 | source path·손실·reverse rule·fixture |
| NIA 원-윈도우 가이드 v1.0 | DCAT-AP 2.1 준용 공통항목과 유통 확장항목 | 가이드 항목과 3.0.1 출력의 양방향 시험 |

원-윈도우 기준을 DCAT-AP 2.0으로 기록하지 않는다. NIA 공식 가이드가 명시한 값은 DCAT-AP 2.1이다. 근거: `C-083`.

2.1→3.0.1 migration은 다음 산출물을 가져야 한다.

```text
source profile and version
source path and cardinality
target path and cardinality
transform and authority
loss class and reverse rule
source validator result
target validator result
fixture digest
```

원문을 합법적으로 확보하기 전에는 항목·range·cardinality를 초록에서 추정하지 않는다.

RC.1 crosswalk는 모든 KS·TTA 조항 칸을 `PENDING-LAWFUL-FULLTEXT`로 기록한다. 현재 행은 구현 순서와 손실검토 위치를 정할 뿐이다. 이 파일만으로 국내 표준에 대한 conformity claim을 표시하지 않는다.

## 6. 국내 기관·행정구역·법령·license

`REL-VOC-001`은 다음 네 레지스트리를 하나로 뭉치지 않는다.

| 레지스트리 | 필요한 결정 | 현재 상태 |
| --- | --- | --- |
| 기관 | 식별자 발급원, 합병·폐지·위임, Provider authority 연결 | 미승인 |
| 행정구역 | 법정동·행정동 구분, 기준일·경계판·폐지 URI | 미확정 |
| 법령 | 법령·행정규칙 식별자, 개정판·시행일 표현 | 미확정 |
| license | 공공누리·기타 이용조건 식별자와 증서 변경정책 | 미확정 |

공공누리 정책을 제1~4유형만으로 고정하지 않는다. 현재 공식 유형안내는 제0유형과 AI유형도 제시한다. 안정 HTTPS 페이지를 `dct:LicenseDocument` 후보로 검토하되 URI 지속성·기계판독성·폐지정책을 운영기관이 승인해야 한다. 근거: `C-084`.

기관이나 행정구역 URI를 임의의 project namespace로 발급해 국가 권위식별자인 것처럼 게시하지 않는다.

RC.1의 [`domestic-candidate-registries.ttl`](../vocabulary/domestic-candidate-registries.ttl)은 이 원칙을 파일 경로에도 적용한다. 모든 후보 IRI는 `/candidate/` 아래에 있고 `term-status:candidate`로 표시한다. 이 값은 다음 property의 운영값으로 승인되지 않았다.

- 기관 후보: `dct:publisher`, Provider Participant 또는 Provider authority로 사용 금지
- 행정구역 후보: `dct:spatial`의 권위 지역 IRI로 사용 금지
- 법령 후보: 개별 법령을 아직 발급하지 않는 빈 registry
- 공공누리 후보: `dct:LicenseDocument`로 typing하지 않고 `dct:license` 값으로 사용 금지

행정안전부 실사용 코드도 scheme을 분리한다.

| scheme | code 길이 | 의미 |
| --- | ---: | --- |
| `MOIS_KIK_H` | 10 | 행정동·주민등록 행정기관코드 |
| `MOIS_KIK_B` | 10 | 법정동코드 |
| `KR_ADMIN_ORG` | 7 | 행정표준기관코드 |

행정동과 법정동은 `KIKmix` 관계로 연결하며 이름이나 code 위치만으로 조인하지 않는다. code별 국가 공통 역참조 IRI는 확인되지 않았다. 내부 canonical identifier는 `scheme`, `code`, `validFrom`, `validTo`, `status`, `source`를 보존한다. 근거: `C-090`.

## 7. CRS 정책

### 7.1 현재 범위

| 구분 | 허용 범위 |
| --- | --- |
| source-reference | CRS84, EPSG:4326·3857·4737·5179·5185·5186·5187·5188 |
| geometry literal | CRS84, EPSG:4326·3857·5179·5186 |
| WKT geometry subset | 2차원 Point·LineString·단일 ring Polygon |
| GML geometry subset | 2차원 Point |
| 좌표변환 policy | CRS84, EPSG:4326·3857·5179·5186 |
| 좌표변환 제외 | 높이·수직 CRS·coordinate epoch |

`standards/generated/crs-transformation-policy.v1.json`은 위 다섯 좌표변환 CRS의 축 순서, PROJ 정의, 근거 byte digest와 왕복 오차 기준을 고정한다.

WKT 2차원 Point·LineString·단일 ring Polygon의 lexical 왕복과 CRS84↔4326·3857·5179·5186 좌표 왕복은 저장소 계약시험 대상이다.

Source-reference allowlist의 4737·5185·5187·5188은 이 좌표변환 구현 범위에 포함되지 않는다.

VWorld 공식 API 문서는 4326·3857·5179·5180~5188 등을 지원한다. Geocoder와 WMS의 기본값은 4326이고 WFS 기본값은 900913이며, WMS 1.3은 일부 CRS의 BBOX 축 순서 예외가 있다.

NGII ngii맵의 5179와 연속지적정보의 5186 사용도 공식 record에서 확인했다. 이 자료와 VWorld 근거를 검토해 RC.1 geometry 후보에는 4326·3857·5186을 추가했다. 근거: `C-088`.

이 선택은 국내 기관 corpus 전체의 CRS 분포, 개별 Dataset 좌표의 정확도 또는 변환 결과의 운영 승인을 뜻하지 않는다. API 요청 CRS, 원천 CRS와 공개 geometry CRS를 따로 기록한다.

기존 국가공간정보포털은 2023-12-31 종료됐다. 현행 CRS 근거는 VWorld 개별 API와 실제 배포 Dataset에서 확인한다. 근거: `C-089`.

### 7.2 후보 확정·추가 절차

현재 allowlist는 RC 기술검증용 후보집합이다. `CRS-COVERAGE-001`을 닫고 Recommendation에서 후보를 확정하거나 새 후보를 추가하려면 다음 절차를 통과한다.

1. 실제 기관 corpus에서 CRS 식별자와 사용 빈도를 추출한다.
2. authority·code·판·폐지상태를 공식 source에서 확인한다.
3. 응답 byte와 SHA-256을 snapshot manifest에 고정한다.
4. 공식 축 순서와 parser의 tuple 순서를 대조한다.
5. source-reference, geometry literal, 변환목적 중 용도를 선택한다.
6. 정상·오류 geometry와 기준점 변환오차 fixture를 추가한다.
7. 독립 검토 뒤 artifact lock과 Gate를 갱신한다.

EPSG:4326과 CRS84를 같은 값으로 취급하지 않는다. EPSG:3857이 RC allowlist에 포함돼 있어도 사용 편의만으로 운영 승인을 얻은 것은 아니다. Legacy Bessel 계열도 편의만으로 후보에 넣지 않는다. 근거: `C-080`.

## 8. 실물 검증

구조적 정렬은 실제 플랫폼 상호운용 증거가 아니다. `REL-MAP-001`은 [`domestic-real-data-validation-plan.md`](../../../../../docs/03-plan/domestic-real-data-validation-plan.md)에 따라 실행한다.

최소 판정은 다음과 같다.

- source inventory 누락 0건
- 미분류 거부 0건
- 묵시적 field 유실 0건
- 게시 승인 subset의 blocking·Warning 0건
- 모든 거부에 requirement ID와 source pointer 존재
- 층·판·수집시각·digest를 포함한 표본 provenance 존재

## 9. Release 판정

0.1.0 legacy 기준선에는 다음 control이 열린 상태로 보존돼 있다. 이 표는 RC.1의 live machine 상태가 아니다.

| control | 차단 이유 | 해소 증거 |
| --- | --- | --- |
| `REL-MAP-001` | 기관 실물 mapping 미검증 | 전수 또는 승인 표본 보고서·fixture·digest |
| `CRS-COVERAGE-001` | 실제 CRS 폭과 변환 정확도 미확정 | corpus 분포·authority snapshot·geometry 시험 |
| `REL-VOC-001` | 국내 권위식별자와 변경정책 미승인 | 운영기관·registry·철회·version 정책 |
| `TRANSPORT-UNIT-001` | 교통 관측속도 의미와 단위 projection 미정 | 관측모델·crosswalk·ITS fixture |

RC.1의 `RA-CRS=fixed`는 CRS84·4326·3857·5179·5186에 한정한 변환 policy, geometry subset 왕복시험과 EPSG:5186 표준노드링크 표본 1건을 근거로 한다. 이는 legacy `CRS-COVERAGE-001`이 제기한 전체 기관 corpus coverage를 해결했다는 판정이 아니다.

RC.1에서 관측모델과 후보 어휘를 추가했으므로 `TRANSPORT-UNIT-001`의 저장소 설계 부분은 진행됐다. ITS payload fixture와 기관 승인 단위 projection은 Recommendation의 별도 실증대상이다.

문서에 slot이 있다는 이유로 국내 표준 적합성을 표시하지 않는다.
