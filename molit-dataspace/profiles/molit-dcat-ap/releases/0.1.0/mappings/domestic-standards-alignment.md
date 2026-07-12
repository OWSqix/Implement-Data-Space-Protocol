# 국내 표준 정렬 기준

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft / 조항 적합성 미판정

## 1. 적용 범위

이 문서는 MOLIT-DCAT-AP 0.1.0과 국내 공간정보·교통·카탈로그 기준의 관계를 기록한다. 표준 제목이나 공개 초록만 확인한 항목을 조항 적합으로 표시하지 않는다.

현재 판정은 다음과 같다.

- 국제 SHACL과 RDF 직렬화 기술시험은 실행했다.
- 국내 표준의 역할을 담을 class·property·입력 lane은 설계했다.
- KS·TTA 원문 조항 crosswalk와 기관 실물 fixture 시험은 완료하지 않았다.
- 따라서 이 문서는 정렬 계획과 증거 경계를 제공하며 국내 기관의 적합성 인증서를 대신하지 않는다.

상세 machine 상태는 `standards/korean-interoperability-register.json`을 따른다.

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

## 4. 교통 기준

### 4.1 표준 노드·링크

표준 노드·링크 구축기준 현행판은 국토교통부고시 제2026-344호이며 2026-07-01 시행됐다. 구축 및 관리지침 제2023-23호와 같은 문서로 취급하지 않는다. 전자는 세계측지계 사용을 요구하고, 후자는 SHP·MIF·GML 배포와 변경이력 파일을 다룬다. 근거: `C-086`.

`molit:NetworkReference`는 다음 값을 분리한다.

| 의미 | profile property | 현재 Gate |
| --- | --- | --- |
| 발급기관 | `molit:networkAuthority` | 승인된 기관 식별자 필요 |
| 망 식별자 | `molit:networkIdentifier` | 필수 |
| 망 판 | `molit:networkVersion` | 필수 |
| 요소유형 | `molit:networkElementType` | node·link 통제값 |

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

현재 QUDT 6종은 DQV 품질측정에 사용한다.

| 품질 의미 | 허용 단위 |
| --- | --- |
| 완전성·논리 일관성 | `PERCENT` |
| 위치 정확도 | `M` |
| 시간 정확도 | `SEC` |
| 적시성 | `SEC`, `MIN`, `HR`, `DAY` |

교통 관측속도의 `km/h`는 품질값이 아니다. QUDT `KiloM-PER-HR`를 적용하려면 다음을 먼저 정한다. 근거: `C-085`.

1. 속도 관측 class와 property
2. 지점·구간·시간창과 집계방식
3. 결측·비정상·정체값 의미
4. 원천 숫자와 단위의 변환·반환 규칙
5. ITS 정상·오류 fixture

`TRANSPORT-UNIT-001`은 이 다섯 항목과 fixture 시험이 끝날 때까지 미해소다.

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
| source-reference | CRS84, EPSG:4737·5179·5185·5186·5187·5188 |
| geometry literal | CRS84, EPSG:5179 |
| 축 lexical 시험 | 2차원 Point WKT·GML |
| authority snapshot | CRS 7건, coordinate system 2건 |

EPSG:5186은 source-reference에 이미 포함된다. geometry literal 추가는 같은 변경이 아니다.

VWorld 공식 API 문서는 4326·3857·5179·5180~5188 등을 지원한다. Geocoder와 WMS의 기본값은 4326이고 WFS 기본값은 900913이며, WMS 1.3은 일부 CRS의 BBOX 축 순서 예외가 있다.

NGII ngii맵의 5179와 연속지적정보의 5186 사용도 공식 record에서 확인했다. 이 사실은 4326·3857을 MOLIT 공개 geometry literal로 자동 승인하는 근거가 아니다. API 요청 CRS, 원천 CRS와 공개 geometry CRS를 따로 결정한다. 근거: `C-088`.

기존 국가공간정보포털은 2023-12-31 종료됐다. 현행 CRS 근거는 VWorld 개별 API와 실제 배포 Dataset에서 확인한다. 근거: `C-089`.

### 7.2 후보 추가 절차

`CRS-COVERAGE-001`은 다음 절차를 통과한 후보만 allowlist에 추가한다.

1. 실제 기관 corpus에서 CRS 식별자와 사용 빈도를 추출한다.
2. authority·code·판·폐지상태를 공식 source에서 확인한다.
3. 응답 byte와 SHA-256을 snapshot manifest에 고정한다.
4. 공식 축 순서와 parser의 tuple 순서를 대조한다.
5. source-reference, geometry literal, 변환목적 중 용도를 선택한다.
6. 정상·오류 geometry와 기준점 변환오차 fixture를 추가한다.
7. 독립 검토 뒤 artifact lock과 Gate를 갱신한다.

EPSG:4326과 CRS84를 같은 값으로 취급하지 않는다. EPSG:3857과 legacy Bessel 계열도 사용 편의만으로 공개 geometry allowlist에 넣지 않는다. 근거: `C-080`.

## 8. 실물 검증

구조적 정렬은 실제 플랫폼 상호운용 증거가 아니다. `REL-MAP-001`은 [`domestic-real-data-validation-plan.md`](../../../../../docs/03-plan/domestic-real-data-validation-plan.md)에 따라 실행한다.

최소 판정은 다음과 같다.

- source inventory 누락 0건
- 미분류 거부 0건
- 묵시적 field 유실 0건
- 게시 승인 subset의 blocking·Warning 0건
- 모든 거부에 requirement ID와 source pointer 존재
- 층·판·수집시각·digest를 포함한 표본 provenance 존재

## 9. release 판정

다음 항목은 1.0.0 차단조건이다.

| control | 차단 이유 | 해소 증거 |
| --- | --- | --- |
| `REL-MAP-001` | 기관 실물 mapping 미검증 | 전수 또는 승인 표본 보고서·fixture·digest |
| `CRS-COVERAGE-001` | 실제 CRS 폭과 변환 정확도 미확정 | corpus 분포·authority snapshot·geometry 시험 |
| `REL-VOC-001` | 국내 권위식별자와 변경정책 미승인 | 운영기관·registry·철회·version 정책 |
| `TRANSPORT-UNIT-001` | 교통 관측속도 의미와 단위 projection 미정 | 관측모델·crosswalk·ITS fixture |

문서에 slot이 있다는 이유로 국내 표준 적합성을 표시하지 않는다.
