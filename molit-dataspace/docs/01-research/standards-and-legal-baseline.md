# 표준·법제 기준선

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 적용 원칙

- **(목적)** 기술 규격, 참고 구현, 국내 법령과 운영 지침의 역할·강제력 구분
- **(법적 경계)** DSP 계약과 ODRL 정책은 법적 제공 근거, 개인정보 처리 근거와 공간정보 보안심사를 대체하지 않음
- **(승인 분리)** 검색·Catalog 등록 승인과 계약·전송 승인을 별도 판정
- **(권리 제한)** 검색 가능 여부는 원문 조회, 파일 전달, API 중계 또는 제3자 재제공 권한의 증거가 아님
- **(ODRL 범위)** ODRL Offer는 확보된 권한과 조건을 표현하며 제공권한을 확장하지 않음
- **(시행일 기준)** 2026-07-11 이후 시행 예정 개정은 현재 기준선과 분리하고 생산 전환 승인일에 재검토

## 2. 기술 규격

| 항목 | 성격 | 이 프로젝트에서의 역할 | 필수 여부 |
| --- | --- | --- | --- |
| DSP 2025-1 errata | 상호운용 규격 | Catalog, 계약 협상, Transfer Process | DSP 연계에 필수 |
| DCAT 3 | W3C Recommendation | Dataset·Distribution·DataService 메타데이터 | Catalog 프로필에 필수 |
| ODRL 2.2 | W3C Recommendation | Permission·Prohibition·Duty·Constraint 표현 | Offer·Agreement 표현에 필수 |
| DCP 1.0 | Eclipse 규격 | DID·VC 기반 참가자 자격 제시·검증 | 선택; 제한 데이터 단계에서 검토 |
| EDC | 참고 구현·컴포넌트 | Control Plane, Data Plane, policy·extension 구현 후보 | 선택 |
| OGC API Features | 공간정보 API 표준 | feature 단위 공간 데이터 접근 | 신규 GIS adapter에 권장 |
| WMS·WFS·WMTS | 공간정보 서비스 표준 | 기존 VWorld·기관 GIS 호환 | 기존 서비스 연결에 필요 |
| mobilityDCAT-AP 1.1.0 | NAPCORE 권고 profile | 유럽 NAP·모빌리티 포털 metadata 교환; 국토교통 profile crosswalk 참조 | 선택; crosswalk 후보 |

근거: `SRC-TECH-001`부터 `SRC-TECH-008`, `SRC-TECH-032`.

### 2.1 DSP의 범위

DSP가 규정하는 것은 다음 네 가지다.

1. Catalog를 통한 Dataset과 Offer 광고
2. ODRL 기반 이용조건 표현
3. Agreement를 만드는 계약 협상
4. 실제 전송의 시작·정지·완료·종료를 조정하는 Transfer Process

- **(DSP 범위)** 실제 Data Transfer Protocol은 DSP 규정 대상에서 제외
- **(파일 전송)** 파일 전송 프로토콜(File Transfer Protocol, FTP)은 별도 transfer profile로 정의
- **(경량 message)** 경량 발행·구독 메시징 프로토콜(Message Queuing Telemetry Transport, MQTT)은 양쪽 Data Plane 구현에서 합의
- **(기업 message)** 고급 메시지 큐 프로토콜(Advanced Message Queuing Protocol, AMQP)도 별도 합의. 근거: `SRC-TECH-001`

- **(Agreement 객체)** Agreement는 Contract Negotiation의 결과 Policy 객체이며 별도 Agreement 상태 머신을 갖지 않음
- **(ACK 정의)** 수신 확인(Acknowledgement, ACK)은 DSP Message 처리 성공을 송신자에게 알리는 응답
- **(Negotiation 상태)** Agreement Message·ACK 뒤 `AGREED`, Agreement Verification·ACK 뒤 `VERIFIED`, Provider `FINALIZED` event·ACK 뒤 `FINALIZED`
- **(ERROR 처리)** ERROR 응답은 Contract Negotiation 상태를 변경하지 않음
- **(전송 형식)** Transfer Request는 Agreement target Dataset의 Distribution에 광고된 `format` 선택
- **(Data address)** push는 Request, pull은 Provider Transfer Start Message에 transport-specific `dataAddress` 배치
- **(근거)** `C-027`, `C-028`, `C-041`, `C-042`

- **(포함 Offer)** Catalog·Dataset 안의 Offer는 enclosing Dataset에서 target을 유도하므로 `target` 제외
- **(독립 Offer)** Contract Request·Offer Message의 standalone Offer에는 Dataset target을 두고 contained Rule에서는 target 제외. 근거: `C-029`

### 2.2 Catalog Broker

- **(규격 범위)** DSP는 하나 이상의 upstream Catalog를 단일 Catalog Service로 제공하는 Catalog Broker 허용
- **(규격 강도)** Broker의 upstream access control Policy 처리는 `SHOULD honor` 요구사항
- **(프로젝트 기준)** upstream visibility·Offer·provenance 무손실을 필수 내부 시험으로 적용
- **(권한 경계)** Catalog Broker 역할은 데이터 제공권한을 부여하지 않음. 근거: `SRC-TECH-001`

- **(Dataset 구성)** DSP Catalog Dataset은 하나 이상의 Offer와 Distribution 필요
- **(Access service)** DSP 2025-1 wire schema의 Distribution별 `accessService`는 Provider DataService 객체 또는 ID 하나
- **(복수 endpoint)** endpoint마다 Distribution을 분리하고 Catalog DataService는 Provider Connector를 지시
- **(Catalog-only 처리)** 소재와 landing page만 있는 레코드는 포털 또는 DCAT discovery에 두고 DSP Catalog Dataset 직렬화에서 제외
- **(승격 조건)** 전송 또는 승인된 secure-analysis 경로가 준비된 뒤 DSP Dataset으로 승격. 근거: `C-026`

### 2.3 DCAT와 국토교통 의미체계

DCAT는 Catalog 상호운용을 위한 공통 어휘다. CRS, 표준 노드·링크 의미, 센서 관측 정의, 교통량·속도 산식까지 정의하지 않는다. 다음 계층을 분리한다.

- Catalog 공통: DCAT 3
- 계약·이용조건: ODRL과 국토교통 ODRL Profile
- 공간 의미: OGC·ISO와 한국산업표준(Korean Industrial Standards, KS) 공간정보 표준
- 도로·교통 의미: 국가 지능형교통체계(Intelligent Transport Systems, ITS) 기술기준과 표준 노드·링크
- 데이터 제품 사양: 국토교통 Data Product Passport

### 2.4 ODRL 집행 한계

ODRL은 정책을 표현하지만 실행엔진 자체가 아니다. 다음 집행지점을 별도로 구현한다.

| 시점 | 집행 내용 |
| --- | --- |
| Catalog | Dataset visibility와 최소 메타데이터 노출 |
| 계약 협상 | 참가자 자격, 목적, 관할, 계약기간 |
| Transfer Process | Agreement 유효성, 정지·철회 여부 |
| Data Plane | endpoint token, row·column·BBOX·quota 필터 |
| 전달 이후 | 법적 계약, 소비자 측 통제, 감사, 파기 증적 |

완전히 전달된 파일의 사후 사용을 Provider Connector만으로 통제할 수 없다. 고위험 데이터는 proxy, 원격 분석 또는 compute-to-data를 우선한다. 근거: `SRC-TECH-003`, `SRC-TECH-005`.

### 2.5 DCP와 신뢰 거버넌스

- **(규격 범위)** DCP는 DID와 Verifiable Credential의 제시·검증 절차 제공
- **(거버넌스 범위)** 신뢰 issuer와 연구기관·공공기관·사업자 인정 기준은 데이터 스페이스 운영규칙으로 결정
- **(적용 Gate)** 공개 데이터 실증의 선행 조건에서 제외하고 기관 제한 데이터 단계에서 필요성·운영비 평가. 근거: `SRC-TECH-004`

## 3. 국내 법제 기준선

- **(용도)** 시스템 설계와 Dataset별 법무 검토의 입력 기준
- **(제한)** 개별 데이터 제공 가능성을 확정하는 법률 의견이 아님
- **(적용 단위)** Dataset·필드·수신자·목적·전달 방식별 별도 승인 필요

| 분류 | 적용 기준 | 시스템 설계 의미 |
| --- | --- | --- |
| 공공데이터 | 공공데이터법, 공공데이터포털 이용정책 | 공개 원칙, 비공개정보·제3자 권리 제외, 기존 이용허락 보존 |
| 정보공개 | 정보공개법 제9조 | Catalog 메타데이터 자체도 비공개 사유 검토 |
| 개인정보 | 개인정보 보호법 | 처리·제3자 제공 근거, 최소화, 안전조치, 기록 필요 |
| 가명정보 | 개인정보 보호법 제28조의2~4 | 목적 제한, 재식별 방지, 기관 간 결합은 전문기관 경로 |
| 개인위치정보 | 위치정보법 | 개인과 연결 가능한 이동경로의 동의·제공·보호조치 검토 |
| 교통카드 | 대중교통법 제10조의9 | 일반 제공은 집계자료, 수신자의 임의 제3자 제공 금지 |
| 공간정보 | 국가공간정보 기본법 | 공개·공개제한·비공개 분류와 보안관리 |
| 공개제한 공간정보 | 보안심사 규정 | 수신자·목적 심사, 망·단말·저장·로그·파기 통제 |
| 데이터 거래 | 데이터산업법 제7조 | 거래·표준계약의 일반 기준이며 개인정보·저작권·공공데이터 특별법을 우선 적용 |
| 국외 처리 | 개인정보 보호법 제28조의8, 공간정보 구축·관리법 | 국외 조회·위탁·보관 및 측량성과 반출 여부를 각각 판정 |
| 기관 간 공유 | 데이터기반행정 활성화에 관한 법률 | 공공기관 소비자 경로의 제공·공동활용 절차와 등록 요건을 공공데이터법과 별도로 판정 |
| AI 학습 | 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법 | Dataset Passport의 AI 학습 허용 판정 시 적용 의무 확인 |
| 클라우드 배치 | 클라우드컴퓨팅 발전 및 이용자 보호에 관한 법률 | CaaS·public cloud 배치 시 보안인증(CSAP)과 공공기관 이용 기준 확인 |

근거: `SRC-LAW-001`부터 `SRC-LAW-014`. 데이터산업법은 `SRC-LAW-010`, 측량성과 국외반출은 `SRC-LAW-011`에 별도로 등록했다. 데이터기반행정법(`SRC-LAW-012`), AI 기본법(`SRC-LAW-013`), 클라우드컴퓨팅법(`SRC-LAW-014`)은 법령 존재와 적용 영역만 기준선에 올렸고 조문 단위 적용 판정은 미완료 조사 항목이다.

### 3.1 시행 시점

| 기준 | 2026-07-11 기준선 | 이후 시행 규정 처리 |
| --- | --- | --- |
| 공공데이터법 | 이날 시행 중인 본문을 적용한다. | 2026-08-28 시행 예정 개정은 현재 판정에 적용하지 않고 시행 후 재검토한다. |
| 국가공간정보 기본법 | 2026-01-02 시행본을 적용한다. | 2026-12-03 시행 예정 조문은 현재 판정과 분리하고 시행 후 재검토한다. |
| 그 밖의 법령·행정규칙 | source register에 기록한 확인일과 시행본을 적용한다. | 생산 전환 승인일과 계약 갱신일에 다시 고정한다. |

국가법령정보센터 화면에 현행 조문과 미래 시행 조문이 함께 나타날 수 있다. 미래 시행일이 붙은 문장은 현재 설계 근거로 인용하지 않는다.

2025-10-01 출범한 국가데이터처가 국가데이터기본법 제정을 추진한다는 보도가 있다. 근거: `C-061`. 제정·시행이 확정되면 이 기준선과 데이터 스페이스 거버넌스 정렬을 재고정하고, 국토교통 metadata profile은 국가 데이터 카탈로그와의 crosswalk을 함께 검토한다.

### 3.2 공개 데이터

공개 데이터는 별도 Catalog에서도 찾을 수 있게 만들 수 있지만, DSP 회원만 사용하거나 비영리 목적만 허용하도록 기존 이용허락을 축소해서는 안 된다. 출처표시 등 기존 license 의무는 `dct:license`와 ODRL Duty에 일관되게 표현한다.

API key와 rate limit은 서비스 안정성을 위한 접근조건일 수 있으나 데이터 자체의 법적 이용권과 혼동하지 않는다.

### 3.3 개인정보·가명정보·위치정보

개인별 승하차, 차량번호 결합 운행이력, 번호판과 폐쇄회로 텔레비전(Closed-Circuit Television, CCTV)은 식별 가능성을 먼저 평가한다. 개인 단말 이동경로는 위치정보 해당 여부도 함께 평가한다.

공공기관이 소관 업무로 수집했다는 사실은 민간 참가자 제공의 법적 근거가 아니다.

2026년 가명정보 처리 가이드라인은 데이터 자체뿐 아니라 이용자, 이용장소와 환경을 포함한 위험도 기반 검토를 제시한다. 원시 이동경로는 가명처리 후에도 재식별 위험이 높을 수 있으므로 안전한 분석환경과 결과 반출심사를 기본 후보로 둔다. 근거: `SRC-LAW-004`, `SRC-LAW-005`, `SRC-LAW-006`.

### 3.4 교통카드 데이터

대중교통법상 일반 제공은 집계자료가 원칙이며, 제공받은 자는 데이터를 제3자에게 임의 제공하거나 유출할 수 없다. 통합 채널이나 중간 사업자가 제공받은 데이터를 다시 DSP 자산으로 배포하는 구조를 기본안으로 삼지 않는다. 원 권한기관이 직접 Provider가 되거나 별도 법적 위임을 확보해야 한다. 근거: `SRC-LAW-009`.

### 3.5 원 보유기관과 Offering Provider

- **(기본 Provider)** 제한 데이터의 제공·계약·재제공 권한 위임문서가 없으면 원 보유기관을 DSP Offering Provider로 모델링
- **(Index-only)** 통합채널이 index-only이면 discovery와 원천 링크만 제공
- **(대행 조건)** 통합채널 또는 기존 플랫폼이 Provider가 되려면 법령·위임·계약에서 제공·계약·재제공 권한 확인
- **(책임 증거)** Provider 대행 범위에는 credential 사용과 사고 책임 포함

- **(Connector 경계)** Connector나 CaaS 운영 사실은 Offering Provider 권한의 증거가 아님
- **(역할 분리)** 원 데이터 생산기관과 Offering Provider는 적법한 위임이 있으면 다른 주체가 될 수 있음
- **(기록)** Dataset Passport에 원 보유기관, 플랫폼 운영자, Offering Provider, 계약 당사자, Connector와 전달 운영자를 각각 기록

공개 데이터는 기존 공개 URL과 이용조건을 유지한 채 추가 Distribution으로 연결할 수 있다. 제한 데이터는 원천기관의 승인 경계 안에서 proxy 또는 compute-to-data 방식으로 제공하고, 원본을 중앙에 복제하는 방식은 별도 승인을 받은 경우에만 사용한다.

### 3.6 공개제한 공간정보

- **(Catalog Gate)** 공개제한 공간정보의 상세 metadata 공개부터 보안심사 대상이 될 수 있음
- **(배치 Gate)** 보안심사 전 외부 Connector와 일반 cloud 적재 금지
- **(통제환경)** 승인된 국내 환경에 접근권한·암호화·반출입 기록과 만료 후 파기 증적 적용. 근거: `SRC-LAW-007`, `SRC-LAW-008`

### 3.7 국외 제공·처리

개인정보의 국외 제공에는 국외에서의 조회·처리위탁·보관도 포함될 수 있으므로 개인정보 보호법 제28조의8의 근거, 고지와 보호조치를 별도로 검토한다. 기본·공공측량성과의 지도와 측량용 사진은 공간정보 구축·관리법의 국외반출 허가·협의 대상 여부를 확인한다.

Passport에는 저장 region뿐 아니라 운영자와 수탁자의 원격 접근 국가, 재이전, 백업 위치를 기록한다. 공개 데이터에 국내 처리 조건을 일괄 추가하지 않으며, 개인정보·측량성과·공개제한 공간정보 등 특별한 근거가 있는 자산에만 해당 조건을 적용한다. 근거: `SRC-LAW-004`, `SRC-LAW-011`.

## 4. 국토교통·국내 metadata 표준

2026-07-12 기준 현행 여부, 공개 구현자료 확인 여부와 원문 조항 검토 여부를 구분한다. 표준 상세페이지에서 제목·판·범위를 확인한 사실은 조항 단위 적합성 증거가 아니다. 전체 판정표는 [국내 표준 상호운용성 검증](korean-standards-interoperability.md)과 machine register에 둔다.

### 4.1 KS·ISO 공간정보 계열

| 표준 | 적용 대상 | 이 프로젝트의 처리 |
| --- | --- | --- |
| KS X ISO 19115-1 | 공간정보와 서비스의 metadata 기본사항 | 식별·범위·책임·참조체계·배포의 개념 mapping 기준. 2018년 개정에서 품질 영역이 제거됐으므로 품질 기준으로 쓰지 않음 |
| KS X ISO 19115-2 | 획득 및 처리 metadata | 영상·센서·관측 데이터용 확장 mapping 대상. 원문 조항 crosswalk 미완료 |
| KS X ISO 19115-3 | 19115-1·-2의 XML Schema·Schematron 구현 | current ISO package 125개 manifest와 offline XSD·Schematron smoke 구현. 승인 official bytes·KS 조항·기관 왕복시험 대기 |
| KS X ISO 19110 | 지형지물 목록작성 | 공간 제품의 feature catalogue 연결 기준. 모든 Dataset에 일괄 적용하지 않음 |
| KS X ISO 19111 | 좌표참조 | CRS 식별자, datum, 좌표계와 공식 축 순서 검증 기준 |
| KS X ISO 19131 | 공간 데이터 제품 사양 | 목적·범위·내용·취득·유지·배포와 품질 합격값의 근거 문서 |
| KS X ISO 19157-1 | 공간 데이터 품질 | 품질 요소·척도·평가·보고 구조. 최소 허용값은 정하지 않으므로 제품사양과 함께 판정 |
| KS X ISO 19135-1 | 항목 등록 절차 | 국토교통 통제어·코드표의 등록·변경·폐지 governance 기준 |
| KS X ISO 19136-1·-2 | GML 기본·확장 인코딩 | GML validator와 기관 fixture를 확보한 뒤 별도 적합시험 수행 |

`KS X ISO 19136` 비분할판은 2022-12-30 폐지됐다. GML 자체가 폐지된 것은 아니다. 신규 구현은 데이터 구조와 인코딩 범위에 따라 현행 `KS X ISO 19136-1`과 `KS X ISO 19136-2`의 정확한 판을 기록한다. 단순한 `GML 호환` 표기는 적합성 증거로 사용하지 않는다. 근거: `C-064`부터 `C-068`, `C-073`.

### 4.2 국내 Catalog 응용 프로파일

| 표준 | 확인한 범위 | 0.1.0 상태 |
| --- | --- | --- |
| TTAK.OT-10.1406 DCAT-AP-KR | DCAT-AP 2.1.0 기반 국내 데이터 포털 profile | DCAT-AP 3.0.1 migration crosswalk 미구현 |
| TTAK.KO-10.1422 | 국내 공간정보 분야 DCAT 응용 profile | 원문과 정확한 기반판을 확보한 뒤 GeoDCAT-AP 3.1.0 차이 분석 필요 |
| TTAK.KO-10.1510-Part3 | 2026-06-26 제정된 디지털 국토정보 플랫폼의 Catalog·Dataset·Service metadata | 공개 초록만 확인. 필수·선택 요소와 cardinality mapping 차단 |
| TTAK.KO-10.1557 | 빅데이터 유통 플랫폼 간 공통 Catalog 항목 | 항목별 crosswalk 차단 |
| TTAE.IT-Y.3603 | 데이터 Catalog metadata 요구사항과 개념모델 | 개념모델 비교 차단 |
| TTAK.KO-10.1352-Part2 | 공간정보·교통정보 교차 도메인 용어 mapping | 원문 검토 전 ontology 동치 공리 생성 금지 |

TTA 원문은 로그인 뒤 제공된다. 이 저장소에는 원문을 복제하지 않는다. 합법적으로 확보한 원문은 내부 evidence vault에 판·취득일·SHA-256·검토 조항만 등록한다. 근거: `C-069`부터 `C-071`, `C-074`.

### 4.3 기관 DB metadata와 공개 Catalog의 경계

행정안전부 「공공기관의 데이터베이스 표준화 지침」은 표준용어, 논리 DB, 물리 DB와 운영 metadata를 관리한다.

- 시스템 구축일, DB 용량과 DBMS를 `dct:issued`, `dcat:byteSize`, `dct:format`으로 자동 변환하지 않는다.
- 운영자 연락처와 공개 여부를 공개 `contactPoint`와 `dct:license`로 자동 변환하지 않는다.
- 기관 내부 compliance record에 원값을 남기고 공개 Dataset 후보는 별도 심사를 거친다. 근거: `C-075`.

### 4.4 교통·서비스 계열

| 표준·지침 | 적용 대상 | Catalog·Data Product 정보 |
| --- | --- | --- |
| 표준 노드·링크 구축기준 제2026-344호 | 도로망 구축·좌표 | 세계측지계, node·link 구축요건과 적용판 |
| 표준 노드·링크 구축 및 관리지침 제2023-23호 | 배포·변경관리 | SHP·MIF·GML, 배포판과 변경이력 파일 |
| 기본교통정보 교환 기술기준 I·II·III·IV | 센터간·현장·Open API·무선 교환 | interface별 message 의미, 관측시각, 단위, 제공주기 |
| OGC 웹 맵 서비스(Web Map Service, WMS)·웹 피처 서비스(Web Feature Service, WFS)·OGC API | 공간 layer·feature | CRS, 축 순서, 경계 상자(Bounding Box, BBOX), layer, format, limit |
| DCAT 3 | 전체 Catalog | 식별자, publisher, temporal·spatial extent, Distribution |

기준 I·II·III·IV는 개정 세대가 아니라 적용 경계가 다르다. 구축기준 2026-344호에 EPSG code가 명시됐다고 쓰지 않는다. 근거: `C-086`, `C-087`.

전체 근거: `SRC-STD-001`부터 `SRC-STD-032`, `SRC-LAW-015`, `SRC-LAW-016`, `SRC-TECH-006`부터 `SRC-TECH-008`, `SRC-TECH-033`, `SRC-TECH-034`.

## 5. 버전 기준

- DSP: `2025-1-err1`을 조사 기준으로 사용한다.
- DCAT: W3C DCAT 3 Recommendation을 사용한다.
- DCP: 1.0을 후보 identity 규격으로 조사하며 인용 revision은 현행 게시본 1.0.1로 고정한다. 근거: `C-060`.
- EDC: 제품 채택 전 대상 release가 DSP 2025-1과 필요한 transfer profile을 지원하는지 검증한다.
- 국내 법령·행정규칙: 생산 전환 승인일에 시행 중인 본문을 다시 고정한다.
- 원천 API: base URL, schema, quota, license의 확인일과 version을 자산별로 기록한다.

## 6. 금지할 설명

- 통합 채널의 모든 검색 결과는 제공 가능하다.
- DSP가 실제 데이터를 전송한다.
- DCP는 DSP의 필수 구성요소다.
- ODRL을 적으면 다운로드 이후 사용이 자동 통제된다.
- 웹 화면의 내부 API는 공식 연계 API다.
- 통합 채널은 모든 자산의 Provider다.
- Connector·CaaS 운영자는 자동으로 데이터 계약권한을 가진다.
- Catalog Broker가 legacy record를 수집하면 전송 가능한 Offering이 된다.
- EDC를 사용해야만 DSP를 구현할 수 있다.
