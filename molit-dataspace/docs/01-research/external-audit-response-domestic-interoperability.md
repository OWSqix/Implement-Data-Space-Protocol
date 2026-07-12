# 국내 실사용 표준 상호운용성 외부 감사 대응서

작성일: 2026-07-12  
감사 기준일: 2026-07-12  
상태: 조치 중 / release blocked

## 1. 판정

외부 감사 의견은 부분 수용한다. MOLIT-DCAT-AP 0.1.0은 고정한 국제 프로파일의 SHACL·RDF 기술시험을 통과했지만, 국내 표준 원문 조항과 기관 실물 레코드에 대한 적합성·상호운용성은 입증하지 못했다.

감사의 핵심 지적처럼 현재 구현은 미확정 값을 거부하는 fail-closed 초안이다. 다만 다음 세 문장은 사실관계에 맞게 고쳐야 한다.

1. CRS는 2종이 아니라 source-reference 7종을 허용한다. geometry literal만 2종으로 제한한다.
2. 독립 검증기는 pySHACL과 Apache Jena까지 구현됐다. 유럽 카탈로그·DSP 소비자와의 종단 간 상호운용은 아직 시험하지 않았다.
3. 국가 데이터 통합플랫폼 원-윈도우 연계 가이드는 DCAT-AP 2.0이 아니라 DCAT-AP 2.1 준용을 명시한다. 근거: `C-080`, `C-083`.

외부 공개 문장은 다음 범위로 제한한다.

> DCAT-AP 3.0.1·GeoDCAT-AP 3.1.0의 고정 SHACL과 공개 fixture를 대상으로 기술 호환성을 시험한 Working Draft다. 국내 표준 원문 조항 적합성과 기관별 운영 상호운용성은 실물 fixture·version migration·기관 승인을 완료한 뒤 판정한다.

## 2. 감사 의견별 수용 여부

| 감사 대상 문장·주장 | 판정 | 저장소·공식 근거 | 정정 문장 |
| --- | --- | --- | --- |
| `국제·유럽 계층 — 검증된 정합` | 부분 수용 | `manifest.json`, Jena 13사례 증거, `publish-check` 차단 | 고정 SHACL의 기술 호환성은 시험했다. URI 게시, EU export adapter, 외부 Catalog·DSP 소비시험은 미완료다. |
| `두 엔진(자체 + pyshacl)` | 정정 | primary `rdf-validate-shacl`, pySHACL 0.40.0, Jena SHACL 6.1.0 | 기본 lane은 primary와 pySHACL을 실행하고 win32-x64 release lane은 Jena differential을 추가한다. |
| `발신 상호운용성은 실질적으로 확보` | 불수용 | `REL-URI-001`, 차단형 `publish-check`, DSP TCK 미실행 | 기술 fixture 호환성만 확인했다. 외부 소비자 종단 간 상호운용은 미입증이다. |
| `CRS allowlist가 CRS84 + EPSG:5179 단 2종` | 불수용 | machine register `referenceSystems` 7건, profile §6 | source-reference는 CRS84·EPSG:4737·5179·5185·5186·5187·5188이다. geometry literal은 CRS84·5179다. |
| `EPSG:5186을 추가` | 불수용 | `ogc-crs-allowlist.ttl`, `molit-spatial.ttl` | EPSG:5186은 source-reference에 이미 있다. geometry literal 승격은 별도 변환·정확도 시험이 필요하다. |
| `EPSG:4326·3857·Bessel 계열 추가` | 조건부 수용 | VWorld의 4326·3857 지원과 NGII·국토교통의 5179·5186 사용 확인 | API 지원, source-reference와 geometry literal을 구분한다. Bessel 계열은 corpus·변환근거가 필요하다. 근거: `C-088`. |
| `KS 공간 metadata crosswalk 문서가 없다` | 부분 수용 | 기존 `external-profile-alignment.md` §5와 국내 조사 문서 존재 | 기준선 문서는 있으나 KS X ISO 19115·19131 조항별 crosswalk와 기관 fixture 시험은 없다. |
| `NetworkReference는 구조적 정합, 실물 미검증` | 수용·증거 보강 | ontology·합성시험, 2026-344호와 2026-07-01 배포본 digest 확인 | 실제 배포본은 식별했으나 ingest·crosswalk·회귀 fixture로 실행하지 않았다. 근거: `C-086`. |
| `crosswalk 33행 중 ready 8 / conditional 15 / blocked 10` | 수용 | `platform-field-crosswalk.csv` | 해당 수치는 현재 파일과 일치한다. blocked 행이 있으면 게시 projection으로 승격하지 않는다. |
| `ONE-윈도우는 DCAT-AP 2.0 기반` | 정정 | NIA 가이드 v1.0은 DCAT-AP 2.1 준용 명시 | 원-윈도우 연계 기준은 확인된 가이드의 DCAT-AP 2.1로 기록하고 2.1→3.0.1 migration을 시험한다. 근거: `C-083`. |
| `국내 통제어가 미확정` | 수용 | `REL-VOC-001`, 승인 Provider entry 0건 | 기관·행정구역·법령·license 식별자의 권위원과 운영정책이 미확정이다. |
| `공공누리 4유형 IRI 정책 결정` | 조건부 수용 | 현재 공공누리 유형안내는 제0·제1~4·AI유형 제시 | 제1~4유형만 고정하지 않는다. 적용 유형, 증서 URL 안정성, 변경·폐지정책을 기관이 승인해야 한다. 근거: `C-084`. |
| `QUDT 단위 6종에 km/h 추가` | 설계 변경 후 수용 | 6종은 DQV 품질측정 allowlist, QUDT speed Unit은 별도 존재 | `km/h`를 품질 allowlist에 바로 넣지 않는다. 교통 관측속도 property·관측모델·fixture를 먼저 정의한다. 근거: `C-085`. |
| `실물 표본 수백 건 검증` | 목적 수용·수량 정정 | `REL-MAP-001`, 실관찰 fixture는 제한적 | 임의의 수백 건 기준 대신 모집단·층·오차 목표를 기록한 전수 또는 층화 표본으로 시험한다. |
| `설계 방향은 국내 표준과 충돌하지 않는다` | 정정 | 조항별 crosswalk가 없음 | 시험한 부분집합에서 확인된 충돌은 없으나 국내 표준 전체와의 비충돌은 아직 판정할 수 없다. |

## 3. 확인된 수치와 범위

### 3.1 CRS

CRS의 용도를 분리한다.

| 용도 | 현재 수 | 허용값 | 의미 |
| --- | ---: | --- | --- |
| 원천 참조체계 `dct:conformsTo` | 7 | CRS84, EPSG:4737·5179·5185·5186·5187·5188 | 원천 데이터가 따르는 CRS 식별 |
| 공개 geometry literal | 2 | CRS84, EPSG:5179 | 공개 검색용 Point geometry literal |
| 고정 authority 증거 | 9 | CRS 정의 7건, coordinate system 정의 2건 | byte·SHA-256·축 semantic offline 검증 |

`EPSG:5186 source-reference 허용`과 `EPSG:5186 geometry literal 허용`은 다른 결정이다. 현재 후자는 고의로 거부한다. 4326과 CRS84는 축 의미가 다르므로 별칭으로 합치지 않는다. 근거: `C-080`.

### 3.2 mapping

`platform-field-crosswalk.csv`는 header를 제외한 33행이다.

| 상태 | 행 수 | 게시 의미 |
| --- | ---: | --- |
| `ready` | 8 | 해당 행의 변환규칙이 정의됨 |
| `conditional` | 15 | 권위값·언어·권리 등 추가 확인 필요 |
| `blocked` | 10 | 현재 자동 게시 금지 |

이 수치는 mapping 설계의 진행률이지 기관 상호운용 성공률이 아니다. `platform-to-profile.md`가 판정한 대로 Bridge v1 graph를 DCAT-AP 적합 graph로 게시하지 않는다.

### 3.3 검증 엔진과 외부 소비

| 검증 범위 | 구현 상태 | 남은 범위 |
| --- | --- | --- |
| primary SHACL | 구현 | 외부 제품과 결과 차이 감시 |
| pySHACL 0.40.0 | Core·Geo 독립 lane 구현 | 기관 fixture 확대 |
| Apache Jena SHACL 6.1.0 | 13개 사례 differential 구현 | 다른 운영체제 release lane |
| EU 통제어 진단 | 별도 audit profile 구현 | corporate body·place export mapping |
| DSP Catalog 소비 | 미실행 | URI 게시, Catalog 조회, 계약·전송 종단 간 시험 |

검증 엔진 통과와 유럽 포털 또는 DSP Connector의 실제 소비 성공을 같은 결과로 보고하지 않는다.

### 3.4 공식 기준선 추가 확인

외부 감사 대응 중 다음 기준선을 추가 확인했다.

| 대상 | 확인 결과 | 설계 반영 |
| --- | --- | --- |
| 표준 노드·링크 구축기준 | 현행판은 국토교통부고시 제2026-344호, 2026-07-01 시행 | 관리지침 2023-23호와 별도 기준으로 version 기록 |
| 2026-07-01 node·link 배포 | 257,182,267 byte, SHA-256 `219020fac55f2faab1029ec9306563a00968f9b27f3910b80c534583b750b9ab` | 실물 fixture 후보로 등록, 저장소에는 원본 미복제 |
| node·link PRJ | 매개변수는 EPSG:5186과 일치하나 EPSG authority code 없음 | `5186 확정`이 아니라 매개변수 기반 추론으로 보존 |
| 기본교통정보 기술기준 | I·II·III·IV가 센터간·현장·Open API·무선 경계에 병렬 적용 | interface별 validator routing 필요 |
| 국가공간정보포털 | 2023-12-31 종료, VWorld로 대체 | 종료 포털의 현행 기본 CRS라는 표현 금지 |
| VWorld·NGII CRS | VWorld는 4326·3857·5179·5180~5188 등을 API별 지원, NGII·국토교통은 5179·5186 실사용 | 지원목록과 공개 geometry allowlist를 분리 |
| 국내 코드 | 행정동·법정동은 별도 10자리, 행정표준기관코드는 7자리 | scheme·code·유효기간을 분리 저장 |

근거: `C-086`부터 `C-090`.

## 4. 문서 정정 지시

| 대상 파일·절 | 기존 문장·판정 | 반영할 문장·조치 |
| --- | --- | --- |
| `profiles/.../index.md` §12 | `CLI 입력 형식은 Turtle만 지원` | Turtle·N-Triples·N-Quads·RDF/XML·JSON-LD 5종과 원격 참조 차단 범위를 명시 |
| `profiles/.../index.md` §13 `REL-ENGINE-001` | `제2 engine 미수행` | pySHACL과 Jena differential 구현, 기관 fixture 확대 미완료로 정정 |
| `profiles/.../index.md` §13 `REL-INTEGRITY-001` | RDFC와 서명 모두 `미구현` | RDFC-1.0 digest 구현, detached signature 미구현으로 분리 |
| `profiles/.../mappings/external-profile-alignment.md` §2.1 | 공개 package·validator·fixture 모두 미구현 | 125개 manifest와 offline XSD·Schematron smoke 구현, 승인 cache·왕복시험 미완료로 정정 |
| `docs/01-research/korean-standards-interoperability.md` §3.3 | CRS 응답 byte·digest 미고정 | 9건 snapshot과 offline Gate 구현, Point 외 geometry·변환 정확도 미완료로 정정 |
| `docs/01-research/standards-and-legal-baseline.md` §4.1 | XSD·Schematron 시험 미구현 | 공개 기술 lane과 국내 조항 판정을 분리 |
| `docs/02-architecture/metadata-and-policy-profile.md` §4.2 | XSD·Schematron 시험 미구현, 원-윈도우 version 조사 중 | 기술 lane 구현과 NIA DCAT-AP 2.1 기준을 반영 |
| `evidence/claim-evidence-matrix.md` `C-080` | CRS snapshot 미고정 | content-addressed snapshot 구현 범위로 정정 |
| `standards/korean-interoperability-register.json` | 실물·CRS 폭·국내 통제어·교통 단위가 암묵적 gap | 네 항목을 release 차단 blind spot으로 명시 |

## 5. 즉시 조치

이번 대응에서 다음 조치를 반영한다.

- `domestic-standards-alignment.md`를 신설해 국내 기준선과 증거 수준을 한 문서에서 대조
- `domestic-real-data-validation-plan.md`를 신설해 `REL-MAP-001`의 표본·지표·합격조건을 고정
- `CRS-COVERAGE-001`, `REL-VOC-001`, `TRANSPORT-UNIT-001`을 명시적 미해소 control로 등록
- CRS·mapping·단위 수치를 contract test로 고정
- 원-윈도우의 확인된 기반판을 DCAT-AP 2.1로 정정
- km/h를 DQV 품질 단위에 기계적으로 추가하지 않고 교통 관측모델 결정사항으로 분리

## 6. 외부 증거 요청

내부 코드 변경으로 해소할 수 없는 자료는 다음과 같다.

| 제출 주체 | 필요한 자료 | 해소 대상 |
| --- | --- | --- |
| 통합채널 운영기관 | export schema, stable ID, delta·delete, 대표 정상·오류 record | `REL-MAP-001` |
| ITS 운영기관 | 확인한 2026-07-01 배포본의 이용조건·변경이력, 소통정보 payload schema | NetworkReference·교통 단위 |
| 공간정보 담당기관 | 실제 CRS 분포, legacy CRS 변환정책, 기준점·허용오차 | `CRS-COVERAGE-001` |
| 표준 담당 | KS·TTA 합법 원문과 조항별 판정 | 국내 조항 crosswalk |
| 카탈로그 운영기관 | NIA 가이드 적용판, 원-윈도우 정상·오류 fixture | DCAT-AP 2.1→3.0.1 migration |
| license·식별자 담당 | 기관·행정구역·법령·공공누리 URI 권위원과 변경정책 | `REL-VOC-001` |

## 7. 종료 조건

감사 조치는 문서 작성만으로 닫지 않는다. 다음 조건을 모두 충족해야 한다.

1. 수집한 source inventory의 모든 field가 mapping·제외·격리 중 하나로 분류된다.
2. 자동 게시 후보는 선택한 profile의 blocking 결과와 Warning이 0건이다.
3. 미분류 거부와 묵시적 field 유실이 0건이다.
4. 국내 profile 2.1 입력과 3.0.1 출력의 차이·손실·reverse rule이 fixture별로 기록된다.
5. CRS 후보는 authority snapshot, 축, geometry 구문과 변환 정확도 시험을 통과한다.
6. 기관·license·행정구역 식별자의 운영 주체와 변경절차가 승인된다.
7. 외부 Catalog와 DSP 소비자가 게시 URI를 실제로 조회하는 종단 간 시험을 통과한다.

## 8. 근거

- [NIA 국가 데이터 통합 연계를 위한 데이터 카탈로그 표준 가이드 v1.0](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28715&cbIdx=26537&parentSeq=28715)
- [TTA DCAT-AP-KR 표준정보](https://committee.tta.or.kr/data/standard_view.jsp?commit_code=PG1004&nowPage=3&pk_num=TTAK.OT-10.1406)
- [국가법령정보센터 표준 노드·링크 관리지침](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000218571)
- [국가법령정보센터 표준 노드·링크 구축기준 2026-344호](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000281252)
- [국가교통정보센터 표준 노드·링크 배포](https://www.its.go.kr/opendata/opendataList?service=nodelink)
- [국가법령정보센터 기본교통정보 교환 기술기준](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000204935)
- [VWorld WMS·WFS API 2.0](https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do)
- [국가공간정보포털 서비스 종료 공지](https://www.data.go.kr/bbs/ntc/selectNotice.do?originId=NOTICE_0000000003431)
- [행정안전부 행정동·법정동 코드 2026-07-01 변경](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039)
- [공공누리 유형안내](https://www.kogl.or.kr/info/license.do)
- [QUDT KiloM-PER-HR](https://qudt.org/vocab/unit/KiloM-PER-HR)
