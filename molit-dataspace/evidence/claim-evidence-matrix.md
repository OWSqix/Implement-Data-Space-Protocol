# 주장-근거 매트릭스

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 상태 기준

- **(목적)** 설계·검토 문서의 주장, 근거, 사용 위치와 재검토 조건을 claim ID로 추적
- **(판정 기준)** 상태가 복합이면 직접 확인 범위와 그 사실에서 도출한 판단을 같은 claim 행에 명시
- **(Verified)** 1차 출처 또는 재현 가능한 관찰에서 직접 확인
- **(Inferred)** 확인 사실로부터 도출한 설계 판단
- **(Unverified)** 담당기관·운영환경에서 확인 필요
- **(Decision)** 프로젝트가 채택을 제안한 선택
- **(Superseded decision)** 후속 ADR이 대체해 신규 설계에 적용하지 않는 선택
- **(한정 표기)** `Verified`에는 확인 방식 한정어를 붙일 수 있다: `observation`(화면·네트워크 관찰), `repository observation`(코드 저장소 확인), `implementation reference/decision/source`(구현 문서·결정·소스), `local-document observation`(제공 문서 확인), `operator-published description`(운영자 공표 자료로 확인했으나 실제 동작은 미관찰). 한정어가 붙은 Verified는 그 확인 방식의 한계 안에서만 유효하다.
- **(유지관리 담당)** Research owner가 source 변경 시 연결 requirement·ADR·test와 재검토 조건을 갱신

## 2. 주장

| ID | 상태 | 주장 | 근거 | 사용 위치 | 재검토 조건 |
| --- | --- | --- | --- | --- | --- |
| C-001 | Verified | 통합 채널은 데이터뿐 아니라 기관·시스템·통계·활용자료를 함께 검색한다. | SRC-MOLIT-001, SRC-MOLIT-002, SRC-MOLIT-003, SRC-MOLIT-008 | 현행 조사 | 검색 model 변경 |
| C-002 | Verified | 검색 가능한 레코드가 모두 전송·재제공 가능한 데이터는 아니다. | SRC-MOLIT-001, SRC-LAW-001, SRC-LAW-002, SRC-LAW-003 | 자산 판정·요구사항 | 권리·법령 변경 |
| C-003 | Verified | DSP는 Catalog·계약·Transfer Process를 규정하고 실제 Data Transfer Protocol은 규정하지 않는다. | SRC-TECH-001 | 전체 architecture | DSP version 변경 |
| C-004 | Verified | DSP는 Catalog Broker를 허용하고 upstream access control requirements를 `SHOULD honor`하도록 규정한다. | SRC-TECH-001 | ADR-0001 | DSP version 변경 |
| C-005 | Verified | DCAT는 Dataset, Distribution, DataService를 구분한다. | SRC-TECH-002 | metadata profile | DCAT revision |
| C-006 | Verified+Inferred | ODRL은 정책표현이며 실제 집행은 policy engine·Data Plane·계약·감사가 필요하다. | SRC-TECH-003, SRC-TECH-005 | policy·security | 구현·profile 결정 |
| C-007 | Verified | DCP는 DID·VC 기반 신원·자격 제시 규격이지만 DSP의 필수 payload 규격은 아니다. | SRC-TECH-004, SRC-TECH-001 | identity roadmap | DSP/DCP revision |
| C-008 | Verified | 공개 데이터는 기존 license와 제3자 권리·비공개 예외를 보존해야 한다. | SRC-LAW-001, SRC-LAW-002, SRC-LAW-003, SRC-LAW-010 | rights gate | 2026-08-28 이후 법령 재검토 |
| C-009 | Verified+Inferred | 개인 이동·가명 데이터에는 법적 근거와 재식별 위험·이용환경 검토가 필요하다. | SRC-LAW-004, SRC-LAW-005, SRC-LAW-006 | secure analysis | 데이터·목적·가이드 변경 |
| C-010 | Verified | 일반 교통카드 데이터 제공은 집계자료가 원칙이고 수신자의 임의 제3자 제공이 금지된다. | SRC-LAW-009 | 초기 제외·Provider 모델 | 법령 개정 |
| C-011 | Verified | 공개제한 공간정보는 보안심사와 별도 통제·사후관리가 필요하다. | SRC-LAW-007, SRC-LAW-008 | security zone | 2026-12-03 이후 재검토 |
| C-012 | Verified | 공간·교통 의미 호환에는 OGC, KS 공간정보 표준과 국가 ITS·node/link 기준이 별도로 필요하다. | SRC-TECH-006, SRC-TECH-007, SRC-TECH-008, SRC-STD-001, SRC-STD-002, SRC-STD-003, SRC-STD-004, SRC-STD-005, SRC-STD-006 | domain profile | 표준 revision |
| C-013 | Verified | 실제 원천은 REST, 파일, WMS/WFS 등 서로 다른 인터페이스와 인증·quota를 사용한다. | SRC-MOLIT-002, SRC-MOLIT-005, SRC-MOLIT-006, SRC-MOLIT-007 | adapter architecture | source onboarding |
| C-014 | Verified observation | 분석센터 화면은 Open API 3종, 활용신청·승인 방식, 계정별 공통 key와 HTTP URL을 문서화한다. | SRC-MOLIT-004, SRC-MOLIT-009 | metadata source 후보 | 화면·정의 변경 |
| C-015 | Inferred | 원천을 system of record로 유지하고 adapter로 전달하는 것이 DSP 범위와 운영 책임에 맞다. | SRC-TECH-001, SRC-TECH-005, C-013 | ADR-0002 | source SLA 부적합 |
| C-016 | Superseded decision | 통합 채널 Broker·원천기관 Provider 혼합형을 기본으로 제안했으나, 플랫폼 역할 조사 전 토폴로지를 고정하므로 ADR-0003으로 대체했다. | C-001~004, SRC-CASE-001, SRC-CASE-004 | ADR-0001·0003 | ADR-0003 재검토 |
| C-017 | Verified | EDC는 가능한 구현 후보이며 DSP가 EDC 채택을 요구하지 않는다. | SRC-TECH-001, SRC-TECH-005 | 제품 spike | Connector ADR |
| C-018 | Verified repository observation | 기존 `dsp-python` scaffold는 version endpoint 단계이며 완성 Connector가 아니다. | SRC-REPO-001 | gap analysis | 해당 프로젝트 확장 |
| C-019 | Verified observation | 2026-07-11 문서상 Open API host의 A 조회는 공개 resolver에서 `SERVFAIL`이었고 조사 환경에서는 loopback을 반환해 HTTP response에 도달하지 못했다. | SRC-MOLIT-010 | endpoint Gate·위험 | 다른 환경 결과·DNS 변경 |
| C-020 | Unverified | 운영기관이 지원하는 현재 hostname·접근망·HTTPS endpoint가 production 연계에 사용 가능하다. | SRC-MOLIT-004, SRC-MOLIT-010; 운영기관 답변 필요 | metadata source Gate | 공식 답변·연결시험 |
| C-021 | Unverified | 분석센터 read API가 bulk·delta, quota, 변경통지와 SLA를 production 용도로 지원한다. | SRC-MOLIT-004; 운영기관 답변 필요 | 수집·운영 설계 | 명세·SLA 확보 |
| C-022 | Verified+Inferred | 로그인 SPA는 session cookie·CSRF와 조회용 내부 API를 사용하지만 이는 공식 server-to-server 계약을 증명하지 않는다. | SRC-MOLIT-009 | 연계 금지선·위험 | 공식 API 계약 확보 |
| C-023 | Verified | 현행 KS는 공간 metadata, 좌표참조와 데이터 제품 사양 기준을 제공한다. 비분할 `KS X ISO 19136`은 폐지됐고 현행 GML은 `KS X ISO 19136-1`·`-2`로 구분된다. | SRC-STD-003, SRC-STD-004, SRC-STD-005, SRC-STD-006, SRC-STD-011, SRC-STD-012 | 공간 metadata profile | KS revision |
| C-024 | Verified | 데이터산업법의 거래·계약 일반기준은 개인정보·저작권·공공데이터 특별법을 우회하지 않는다. | SRC-LAW-010 | 법제 Gate | 법령 개정 |
| C-025 | Verified | 기본·공공측량성과의 지도·측량용 사진은 국외반출 허가·협의 대상 여부를 별도로 판정해야 한다. | SRC-LAW-011 | 배포환경·국외처리 Gate | 법령·자산 변경 |
| C-026 | Verified | DSP Catalog의 Dataset은 Offer와 Distribution을 가져야 하며 DSP 2025-1 wire schema에서 각 Distribution의 `accessService`는 DataService 객체 또는 ID 하나다. Catalog도 Connector를 가리키는 DataService를 가진다. | SRC-TECH-001 | metadata validation·catalog-only 분리 | DSP version 변경 |
| C-027 | Verified | Agreement는 Contract Negotiation의 결과 객체이며 Dataset 접근은 negotiation이 `FINALIZED`된 뒤 가능하다. | SRC-TECH-001 | 계약·전송 상태 설계 | DSP version 변경 |
| C-028 | Verified | Transfer Request의 `format`은 Agreement target Dataset의 Distribution에서 선택하며 push는 Request, pull은 Start Message에 `dataAddress`를 둔다. | SRC-TECH-001 | adapter·transfer 검증 | DSP version 변경 |
| C-029 | Verified | Catalog·Dataset에 포함된 Offer는 target을 두지 않고, Contract Request·Offer Message의 Offer는 Dataset target을 가져야 한다. | SRC-TECH-001 | ODRL/DSP contract validation | DSP version 변경 |
| C-030 | Verified | MDS는 Mobilithek 연계에서 참가자 인증·metadata 게시·검색을 맡고 실제 data transmission은 Mobilithek과 MDS 회원 사이에서 수행된다. | SRC-CASE-001, SRC-CASE-005 | 참조 사례·목표 architecture | 운영 설명 변경 |
| C-031 | Verified operator-published description | MDS 연계 대상은 Mobilithek이 hosted 또는 brokered하고 open-data license를 가진 Offering이며 MDS 회원은 별도 Mobilithek 등록 없이 이용한다. | SRC-CASE-001, SRC-CASE-003 | Offering eligibility·identity 질문 | 대상조건 변경·운영자 확인 |
| C-032 | Verified operator-published description | MDS에서 brokered Mobilithek 데이터의 이용계약을 체결·종료하면 Mobilithek이 subscription 활성화·삭제 절차를 자동 수행한다. 실제 자동화 동작과 실패 처리 방식은 미관찰이다. | SRC-CASE-001, SRC-CASE-002, SRC-CASE-003 | platform lifecycle·PoC | 운영방식 변경·운영자 확인 |
| C-033 | Verified | MobiData BW는 기존 open-data platform을 유지하면서 자체 Connector로 MDS를 추가 제공 채널로 사용한다. | SRC-CASE-004, SRC-CASE-005 | topology 비교 | 사례·운영 변경 |
| C-034 | Inferred+Decision | 기존 플랫폼을 system of record로 두고 Offering mapping·source binding·Agreement-to-entitlement orchestration을 담당하는 Bridge를 연구·PoC의 기준축으로 삼는다. | C-030~033, SRC-TECH-010, SRC-TECH-011 | ADR-0003·목표 architecture | PoC·거버넌스 결과 |
| C-035 | Verified+Inferred | Catalog Broker는 upstream Provider Offering을 연합하지만 Provider가 없는 legacy record에 제공권한·Distribution·전송경로를 자동으로 만들지 않는다. | SRC-TECH-001, SRC-TECH-009 | Broker·Bridge 경계 | DSP·DSSC revision |
| C-036 | Verified repository observation | 2026-07-11 확인 시 EDC 최신 공개 release는 v0.18.0이며 과거 handbook 예제를 현재 고정 API로 사용하려면 version별 재검증이 필요하다. | SRC-TECH-005, SRC-TECH-012 | Connector spike·metadata projection | EDC release 변경 |
| C-037 | Verified implementation reference | EDC v0.18.0 Data Plane Framework는 finite transfer·작은 event payload를 대상으로 하고 고용량 stream·ETL은 전문 인프라에 위임한다. | SRC-TECH-013 | stream·data-plane pattern | EDC release 변경 |
| C-038 | Verified implementation decision | EDC v0.18.0 tree는 core full HTTP proxy를 폐기하고 외부 전문 proxy 통합을 지향한다. | SRC-TECH-014 | REST gateway 설계 | EDC decision 변경 |
| C-039 | Verified observation+Unverified capability | 통합 채널의 metadata 검색과 일부 index-only 정황은 확인됐지만 일반적인 payload host·subscription broker 기능은 확인되지 않았다. | SRC-MOLIT-001, SRC-MOLIT-009 | capability profile·PoC 후보 | 운영기관 증거 확보 |
| C-040 | Verified implementation source | EDC v0.18.0은 `Asset.dataAddress` 직접 보관을 deprecated했고 source `DataAddress` resolution과 data-plane profile metadata를 별도 확장점으로 둔다. | SRC-TECH-015 | EDC mapping·source binding | EDC release 변경 |
| C-041 | Verified | DSP Contract Negotiation과 Transfer Process는 메시지의 수신·ACK 뒤 상태를 전이하며 ERROR 응답은 상태를 바꾸지 않는다. | SRC-TECH-001 | Connector 상태·재시도·장애시험 | DSP version 변경 |
| C-042 | Verified | Transfer Request에는 `consumerPid·agreementId·format·callbackAddress`가 필수이고, Transfer Start에는 `providerPid·consumerPid`가 필수다. push Request와 pull Start에는 각각 `dataAddress`가 필요하다. | SRC-TECH-001 | schema validation·adapter 입력 | DSP version 변경 |
| C-043 | Verified | DCAT 3의 `dcat:mediaType`은 IANA가 정의한 media type에 사용하며, 그 밖의 format에는 `dct:format`을 사용할 수 있다. | SRC-TECH-002 | metadata mapping·validation | DCAT revision |
| C-044 | Verified local-document observation | 기획보고서는 DSP·DCP·DCAT·ODRL·C2D·AI Agent와 기존 플랫폼 연계를 기술동향, architecture와 과제카드의 구현·성과 기준으로 제시한다. | SRC-REPORT-001 | 기획보고서 기술 검토 | 보고서 개정본 수령 |
| C-045 | Verified | 2026-07-11 기준 base DCAT-AP 권고판은 3.0.1이고 GeoDCAT-AP의 별도 release가 3.1.0이다. | SRC-TECH-016, SRC-TECH-017 | 기획보고서 version 교정 | profile release 변경 |
| C-046 | Verified | ISO/IEC FDIS 20151-1은 데이터 스페이스 개념·특성의 승인 단계 문서이고, DSP·DCP의 ISO/IEC DIS 26450·26451은 개발 중이므로 ISO 표준화 완료가 아니다. | SRC-TECH-018, SRC-TECH-020, SRC-TECH-021 | 표준 상태·RFP 기준선 | ISO stage 변경 |
| C-047 | Verified | IDS-RAM 5는 Working Draft이며 단일 blueprint가 아닌 design space로 설명된다. | SRC-TECH-019 | 참조 architecture·성숙도 교정 | RAM 5 release 변경 |
| C-048 | Verified | DIN EN 18235-1과 18235-2는 2026-07-11 기준 draft standard다. | SRC-TECH-027, SRC-TECH-028 | 표준 상태 교정 | CEN·DIN publication 변경 |
| C-049 | Verified+Inferred | JSON-LD context는 선언된 term을 IRI로 확장·구분하지만 서로 다른 vocabulary의 개념 동치와 값 변환을 자동 판정하지 않는다. | SRC-TECH-029 | semantic mapping·검증 | JSON-LD revision |
| C-050 | Verified+Inferred | DSP·DCP TCK는 규격 test set의 compatibility·compliance를 시험하며, 통과만으로 독립 인증서나 Platform Bridge·payload·보안·운영 전체가 검증되지는 않는다. | SRC-TECH-022, SRC-TECH-023 | conformance·verification | TCK scope·인증제도 변경 |
| C-051 | Verified | DCAT-AP는 metadata application profile이며 system의 실제 data exchange mechanism과 implementation behavior를 규정하지 않는다. | SRC-TECH-016 | Catalog·Broker 경계 | DCAT-AP revision |
| C-052 | Verified+Inferred | MCP는 agent-to-tool·resource 연결, A2A는 agent-to-agent 통신을 다루며 DSP Agreement 권한·DCP claims·법적 책임을 대신하지 않는다. | SRC-TECH-024, SRC-TECH-030 | AI Agent 권한 경계 | MCP·A2A revision |
| C-053 | Verified+Inferred | Container 기반 C2D는 image·registry·orchestrator·runtime·host 위협을 별도 통제해야 하며 정상실행만으로 원본 비유출을 입증할 수 없다. | SRC-TECH-025 | C2D·SPE threat model | container platform 변경 |
| C-054 | Verified+Inferred | PROV-O는 provenance 표현·교환 ontology이며 audit log의 완전성·무결성·부인방지를 자체 제공하지 않는다. | SRC-TECH-026 | observability·audit evidence | PROV revision |
| C-055 | Inferred+Decision | 기존 플랫폼 full lifecycle 연계는 역할·권리 판정, Offering mapping, private source binding, Agreement·Transfer provisioning·revoke와 reconciliation을 포함하는 Bridge로 검증한다. | C-027~C-035, C-041, C-042, SRC-CASE-001, SRC-CASE-002 | 기획보고서 수정·architecture·RFP | PoC·운영기관 interface 결과 |
| C-056 | Inferred+Decision | 중앙·연합·분산 topology를 성숙도 순서로 고정하지 않고 권리·Offering lifecycle·restricted-data·상호운용·operations capability Gate와 별도 ADR로 평가한다. | C-034, C-047 | 기획보고서 성숙도 수정 | 사업 governance 결정 |
| C-057 | Decision | 정량지표는 numerator·denominator·exclusion·severity·gold set·owner·tool version·재현 절차를 정의하고 문서·시나리오 개수와 분리한다. | C-041, C-042, C-049, C-050, C-055 | 기획보고서 과제카드·검증계획 | 성과지표 승인 |
| C-058 | Verified repository observation | Distribution당 단일 `accessService`는 DSP 2025-1 wire schema의 제약이다. 스펙 main branch prose는 Distribution당 DataService를 `at least one`으로 서술하므로 차기 version에서 완화될 수 있다. | SRC-TECH-001, SRC-TECH-031 | metadata profile·validation | DSP 차기 release |
| C-059 | Verified | DSSC Blueprint의 최신판은 v3.0(2026-02)이며 DSSC 프로젝트는 2026-03 종료 후 후속 조직(DSSC 2)으로 전환됐다. Blueprint 인용은 v3.0으로 version을 고정한다. | SRC-TECH-009 | 참조 architecture 인용 기준 | 후속 조직·Blueprint 발표 |
| C-060 | Verified | DCP 규격의 정식 URL은 2026-07-11 확인 시 현행 게시본 v1.0.1로 redirect된다. DCP 인용은 1.0.1 revision으로 고정한다. | SRC-TECH-004 | identity 기준선·version pin | DCP release 변경 |
| C-061 | Verified+Unverified | 2025-10-01 국가데이터처가 출범했고, 국가데이터기본법 제정 추진은 2차 보도로만 확인됐다. 국토교통 profile·거버넌스는 국가 데이터 카탈로그·법제와의 정합을 확인해야 한다. | SRC-KR-001, SRC-KR-002 | 법제 기준선·profile crosswalk | 법 제정·업무계획 원문 확보 |
| C-062 | Verified | mobilityDCAT-AP 1.1.0은 유럽 NAP·모빌리티 포털의 metadata 교환용 DCAT-AP 확장이며 NAPCORE Recommendation이다. | SRC-TECH-032 | 국토교통 profile crosswalk 후보 | profile release 변경 |
| C-063 | Unverified | KALDA와 회원사가 MDS 운영측과 협력 체계를 추진한다는 2025-12 보도가 있으나 1차 MoU 문서는 확인되지 않았다. | SRC-CASE-006 | 참조 사례 조사 경로 | 공식 발표·1차 문서 확보 |
| C-064 | Verified metadata | 현행 국내 ISO 19115 계열은 기본 개념모델 `KS X ISO 19115-1`, 획득·처리 확장 `-2`, XML Schema·Schematron 구현 `-3`으로 구분된다. `-1`만으로 현행 XML 적합성을 주장할 수 없다. | SRC-STD-003, SRC-STD-007, SRC-STD-008 | 국내 표준 기준선·XML ingest | KS 판 변경·원문 확보 |
| C-065 | Verified metadata+Inferred | `KS X ISO 19157-1`은 품질 구조·평가·보고를 정하지만 최소 허용 품질값은 정하지 않는다. 적용 제품사양과 함께 판정해야 한다. | SRC-STD-009, SRC-STD-005, SRC-TECH-035 | 품질 model·validator routing | 표준·제품사양 변경 |
| C-066 | Verified metadata+Inferred | 국토교통 통제어·코드표를 표준 수준으로 운영하려면 등록·상태·변경·폐지 절차를 갖춘 레지스터가 필요하다. | SRC-STD-010, SRC-LAW-016 | vocabulary governance | 운영기관·절차 승인 |
| C-067 | Verified metadata | 비분할 `KS X ISO 19136`은 폐지됐지만 현행 `KS X ISO 19136-1`과 `-2`가 존재한다. GML 전체가 폐지됐다는 설명은 틀리다. | SRC-STD-006, SRC-STD-011, SRC-STD-012 | GML 기준선 | KS 판 변경 |
| C-068 | Verified metadata+Partially implemented | 공개 ISO/TC 211 current XSD·Schematron·예제를 확인했다. 고정 package smoke validation은 즉시 가능한 기술 작업이고, 국내 KS 원문 조항 및 기관 XML↔RDF 왕복 판정은 별도 증거가 필요하다. | SRC-STD-008, SRC-TECH-033, SRC-TECH-036 | XML interoperability | pinned schema test·KS 원문·기관 fixture 확보 |
| C-069 | Verified metadata | TTAK.KO-10.1510 시리즈는 데이터 모델, GML 인코딩, 메타데이터를 분리한다. Part3은 2026-06-26 제정된 현행 메타데이터 표준이다. | SRC-STD-013, SRC-STD-014, SRC-STD-015 | 국내 국토정보 profile | TTA revision·원문 확보 |
| C-070 | Verified metadata+Unverified crosswalk | TTAK.KO-10.1510-Part3과 TTAK.KO-10.1557은 국내 metadata crosswalk의 P0 대상이지만 로그인 원문 없이 항목·cardinality·코드표 적합성을 주장할 수 없다. | SRC-STD-015, SRC-STD-016, SRC-STD-017 | 국내 상호운용성 matrix | 합법 원문·fixture 확보 |
| C-071 | Verified metadata+Unverified ontology mapping | TTAK.KO-10.1352-Part2는 공간정보와 교통정보 용어의 관계를 다루지만, 공개 초록만으로 `owl:equivalentClass` 같은 강한 공리를 만들 수 없다. | SRC-STD-018 | ontology mapping | 원문·전문가 검토 |
| C-072 | Verified+Unverified | TTAS.KO-10.0157은 폐지됐고 TTAS.KO-10.0139/R1의 현행·대체 관계는 확인이 필요하다. | SRC-STD-019, SRC-STD-020 | legacy standard guard | TTA 공식 답변 |
| C-073 | Verified metadata+Inferred | 지형지물 카탈로그와 제품별 품질표준은 모든 DCAT Dataset에 일괄 적용하지 않고 `dct:conformsTo`와 제품유형으로 validator를 선택해야 한다. | SRC-STD-021, SRC-STD-005, SRC-STD-009 | profile routing | 제품표준 원문·fixture 확보 |
| C-074 | Verified metadata+Unverified crosswalk | 국내 DCAT-AP-KR과 공간정보 DCAT 응용 프로파일은 현행 국내 비교 대상이지만, 이 프로젝트의 DCAT-AP 3.0.1·GeoDCAT-AP 3.1.0에 자동 적합하지 않는다. | SRC-STD-022, SRC-STD-023, SRC-TECH-016, SRC-TECH-017 | version migration | TTA 원문·차이표·fixture 확보 |
| C-075 | Verified+Inferred | 공공기관 DB 표준화지침의 운영·논리·물리 DB metadata는 공개 Catalog metadata와 같은 범주가 아니다. 자동 승격 전에 공개·권리·의미 mapping을 심사해야 한다. | SRC-LAW-015 | source adapter·mapping gate | 기관 export schema 확보 |
| C-076 | Verified | 국토지리정보원 공간정보 표준화지침은 기관표준의 등록·개정·폐지·공개·이력관리 절차를 둔다. | SRC-LAW-016 | profile governance | 지침 개정 |
| C-077 | Verified observation | 공공데이터포털의 실제 DCAT RDF/XML 100299070은 한국어 문자열에 의미상 맞지 않는 Kanuri 코드 `kr`, 잘못된 날짜 lexical form, literal 통제값과 빈 값 등을 포함하며 0.1.0 Core bundle의 pySHACL 고정시험에서 39건을 보고한다. | SRC-KR-003, SRC-IANA-001 | dialect adapter golden-negative | endpoint·registry·bundle·engine version 변경 |
| C-078 | Verified metadata | `KS X ISO 19157`, `KS X ISO 19157-1`, `KS X ISO/TS 19157-2`는 모두 현행으로 표시되며 unparted XML과 Part 1 JSON 구현 branch를 분리해야 한다. | SRC-STD-009, SRC-STD-024, SRC-STD-025, SRC-TECH-034, SRC-TECH-035 | 품질 validator routing | KS·ISO package 변경 |
| C-079 | Verified metadata | 비분할 `KS X ISO 19139`는 폐지됐고 `KS X ISO/TS 19139-1`과 `KS X ISO 19119`는 현행이다. legacy XML, XML 인코딩 규칙과 서비스 모델을 서로 다른 lane으로 관리한다. | SRC-STD-026, SRC-STD-027, SRC-STD-028 | XML legacy guard·DataService crosswalk | KS 판 변경 |
| C-080 | Verified snapshot+Partial implementation | 2026-07-12 OGC·EPSG 응답 9건을 byte·digest로 고정했고 release의 CRS 7종과 Point 축 정책을 offline 검증한다. 식별자와 2차원 Point 시험은 다른 geometry와 좌표변환 정확도를 대신하지 않는다. | SRC-LAW-017, SRC-LAW-018, SRC-LAW-019, SRC-CRS-001, SRC-CRS-002, SRC-CRS-003, SRC-CRS-004, SRC-CRS-005, SRC-CRS-006, SRC-CRS-007 | CRS·NGII compliance routing | 규정·resolver 변경, geometry 확대, 변환 정확도 시험 |
| C-081 | Verified | IANA Language Subtag Registry에서 `kr`은 Kanuri이고 `ko`는 Korean이다. 내용 언어 확인 없이 문자열 치환만 수행하지 않는다. | SRC-IANA-001 | portal dialect language normalization | IANA registry 변경 |
| C-082 | Verified snapshot+Operational drift pending | IANA IPv4·IPv6 official CSV 3종을 byte·digest로 고정하고 생성한 network policy와 대조한다. scheduled refetch와 변경승인은 운영과제로 남는다. | SRC-IANA-002, SRC-IANA-003 | network preflight registry | registry 변경, scheduled refetch·승인 |
| C-083 | Verified official guide+Unverified migration | NIA의 원-윈도우 연계 가이드 v1.0은 공통 카탈로그가 DCAT-AP 2.1을 준용한다고 명시한다. 이 근거로 DCAT-AP 2.0이라고 쓰지 않으며 3.0.1 migration은 별도로 시험한다. | SRC-KR-004, SRC-STD-022 | 국가 데이터 카탈로그 연계 | 가이드 개정, 2.1→3.0.1 차이표·fixture |
| C-084 | Verified current page+Governance required | 공공누리 현재 유형안내는 제0유형, 제1~4유형과 AI유형을 함께 제시한다. 제1~4유형만 고정한 license 정책은 현재 유형 전체를 포괄하지 않는다. | SRC-KR-005 | 국내 license identifier 정책 | 유형·증서 URL 변경, 기관 승인 |
| C-085 | Verified vocabulary+Inferred model boundary | QUDT의 `KiloM-PER-HR`는 기호 `km/h`인 Unit이다. 교통 관측속도는 DQV 품질측정 단위와 다른 데이터 계층이므로 속도 property·관측모델·fixture를 정한 뒤 적용한다. | SRC-TECH-037 | 교통 관측 단위 모델 | QUDT 판 변경, 교통 payload schema·fixture |
| C-086 | Verified official standard+Observed distribution | 표준 노드·링크 구축기준 현행판은 2026-344호이며 관리지침 2023-23호와 역할이 다르다. 2026-07-01 배포본의 투영 매개변수는 EPSG:5186과 일치하지만 PRJ에 EPSG authority code는 없다. | SRC-STD-001, SRC-STD-029, SRC-MOLIT-014 | NetworkReference·CRS routing | 고시·배포판 변경, fixture ingest |
| C-087 | Verified official rules | 기본교통정보 교환 기술기준 I·II·III·IV는 센터간, 센터·현장, 인터넷 Open API, 무선 노변·차량이라는 서로 다른 경계에 적용한다. 가장 최근 번호 하나로 대체하지 않는다. | SRC-STD-002, SRC-STD-030, SRC-STD-031, SRC-STD-032 | 교통 interface routing | 고시 개정, payload fixture |
| C-088 | Verified official service documentation+Implementation pending | VWorld는 API별로 EPSG:4326·3857·5179·5180~5188 등을 지원하고, NGII·국토교통 실제 서비스에서 5179·5186 사용이 확인된다. service 지원과 profile geometry literal 허용은 별도 결정이다. | SRC-TECH-038, SRC-TECH-039, SRC-MOLIT-011, SRC-MOLIT-012, SRC-MOLIT-013 | CRS coverage | API·Dataset 변경, 축·geometry·변환 시험 |
| C-089 | Verified official notice | 기존 국가공간정보포털은 2023-12-31 종료됐으며 현행 CRS 근거는 VWorld 개별 API와 실제 배포 Dataset에서 확인해야 한다. | SRC-KR-006 | 플랫폼 기준선 | 대체서비스·공지 변경 |
| C-090 | Verified official code files+IRI gap | MOIS 행정동·법정동은 서로 다른 10자리 코드표이고 행정표준기관코드는 별도 7자리 체계다. 코드별 국가 공통 역참조 IRI는 확인하지 못했다. | SRC-KR-007, SRC-KR-008, SRC-KR-009 | 국내 식별자 registry | 코드판 변경, 공식 IRI 정책 |

## 3. 금지 주장

다음 문장은 현재 근거로 사용할 수 없다.

| 금지 주장 | 올바른 표현 |
| --- | --- |
| 통합 채널의 모든 데이터는 제공 가능하다. | 검색 레코드별 제공·재제공 권한을 확인한다. |
| DSP가 데이터를 전송한다. | DSP가 transfer를 조정하고 실제 payload는 별도 protocol로 전송된다. |
| DCP는 DSP의 필수 요소다. | DCP는 제한 데이터 단계에서 평가할 identity·claims profile이다. |
| ODRL이면 사후 사용이 자동 통제된다. | ODRL 표현과 기술·법적 집행을 연결해야 한다. |
| 내부 `/api/*`는 공식 연계 API다. | 공식 지원·SLA가 확인된 endpoint만 사용한다. |
| 통합 채널이 모든 Dataset의 Provider다. | 실제 권한기관 또는 명시적 수임기관이 Provider다. |
| EDC만 DSP를 구현할 수 있다. | EDC는 후보 구현이며 제품 비교 후 결정한다. |
| ISO/IEC 20151로 DSP·DCP 표준화가 완료됐다. | ISO/IEC FDIS 20151-1과 ISO/IEC DIS 26450·26451의 현재 stage를 구분한다. |
| DCAT-AP가 분산 crawling과 Catalog Broker 동작을 규정한다. | DCAT-AP는 metadata profile이고 DSP Catalog·Broker와 crawler 구현을 별도로 정의한다. |
| TCK를 통과하면 인증 Connector이고 글로벌 상호운용성이 보장된다. | version-pinned TCK 적합성, 이기종 wire, payload, 보안과 운영시험을 각각 수행한다. |
| JSON-LD context가 서로 다른 용어를 자동 mapping한다. | 명시적 mapping registry와 gold-set 검증을 사용한다. |
| C2D면 개인정보·민감정보를 법적 검토 없이 활용할 수 있다. | C2D는 원본 반출을 줄일 뿐 법적 근거·보안승인·output review를 대체하지 않는다. |
| MCP/A2A Agent가 독립 계약 당사자로 DSP를 자동 실행한다. | Participant가 위임한 범위 안에서 Agent를 사용하고 결정론적 Control Plane과 승인 Gate가 집행한다. |
| 탈중앙화가 항상 가장 높은 데이터 스페이스 성숙도다. | topology와 검증된 capability를 별도 축으로 평가한다. |

## 4. 유지관리

새 설계 주장에는 source ID 또는 상위 claim ID를 붙인다. `Unverified`가 해결되면 답변 문서, 담당자, 확인일과 artifact 위치를 source register에 추가한다. source가 변경되면 연결된 요구사항·ADR·시험을 함께 재검토한다.
