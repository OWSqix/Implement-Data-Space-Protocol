# 저기술 참가자 온보딩 선례 조사

작성일: 2026-08-03  
작성 기준: 2026-08-02  
상태: Draft  
작성자: 연구 담당  
관련 결정: 없음

## 1. 목적과 범위

- **(목적)** 자체 커넥터와 데이터 게시 역량이 낮은 참가자를 수용한 국내외 선례와 책임 경계의 판정
- **(질문)** 누가 원자료를 읽고 변환·전송하며, 참가자·대행자·운영자·검증기관에 어떤 책임이 남는가
- **(포함 범위)** 네덜란드 제조·물류, Catena-X·Ouranos·DjustConnect, 국내 전산 제출 의무화와 버스 정산 사례
- **(제외 범위)** Connector 제품 선택, 대행 서비스 상세 요금 산정, 세 선택지의 최종 채택, 요구사항·시험 설계
- **(판정 기준)** 실제 운영 여부, 저기술 입력 경로, 대행 범위, 원천사실 책임, 비용 부담, 정정·검증 경로

조사 방법은 입력 원문에 수록된 공개 자료의 비교다. 외부 자료 확인일은 2026-08-02로 유지한다.
이 문서에서 Offering은 Dataset, 제공조건, Distribution과 접근서비스를 묶어 거래 대상으로 제시한 것을 뜻한다.

## 2. 현재 판정

### 2.1 핵심 판정

- **(Inferred)** 확인된 저기술 온보딩 경로는 네 유형으로 분류된다.
  - **(근거)** 업무시스템 벤더 경유는 `SRC-LOW-001`~`SRC-LOW-006`, 인증 제공자 분리는 `SRC-LOW-007`~`SRC-LOW-014`에서 확인됨
  - **(근거)** 원천시스템 API 제공은 `SRC-LOW-015`~`SRC-LOW-017`, 국내 혼합형은 `SRC-LOW-024`~`SRC-LOW-034`에서 확인됨
- **(Inferred)** 위임은 원천사실 책임을 이전하지 않는다.
  - **(근거)** Tuinte의 원천 정비, Catena-X 참가자의 직접 약관 수락, 화물운송실적 신고자의 최종책임 — `SRC-LOW-004`, `SRC-LOW-008`, `SRC-LOW-025`
- **(Inferred)** 국내 의무화 선례는 단계 확대, 무료 최소수단, 복수 경로, 비용지원, 정정·유예와 최영세층 예외를 조합함
  - **(근거)** 전자세금계산서·현금영수증·하도급지킴이·화물운송실적신고 — `SRC-LOW-018`~`SRC-LOW-027`
- **(Unverified)** API·자체 시스템 전용 경로는 조사 범위에서 미발견 — 5.1절
  - **(조건)** 국내 전산 제출 제도의 전수조사 결과가 아님
- **(Unverified)** 전국 데이터 없음 — 판정 불가
  - **(조건)** 인천·경기와 업체 규모 수치는 지역·시점·집계범위가 한정된 사례이며 전국 자체기장 비중이 아님
- **(Decision)** 네 주체 책임분할을 설계안으로 제시하되 세 온보딩 선택지 중 하나를 채택하지 않음
  - **(조건)** 대행 실적·비용·오류배상 자료와 선택지별 비용 부담 주체를 확인한 뒤 별도 결정 필요

### 2.2 상태 구분

| 상태 | 이 문서의 적용 | 판정 경계 |
| --- | --- | --- |
| `Verified` | 운영규칙·고시·사례자료에서 직접 확인한 경로와 수치 | 해당 자료의 시점·지역·대상만 포함 |
| `Inferred` | 확인 사례를 묶은 4유형, 지원 패턴과 책임 원칙 | 전국 보급률이나 일반 법칙으로 확대하지 않음 |
| `Unverified` | 전국 비중, 미발견 주장, 비공개 비용·배상·실적 | 7절의 확인 자료가 확보될 때까지 판정 불가 |
| `Decision` | 국토교통 데이터 스페이스에 적용할 책임분할 제안 | 미채택 상태이며 관련 결정 문서 없음 |

## 3. 저기술 온보딩 4유형

### 3.1 업무시스템 벤더 경유형

전사적 자원관리(Enterprise Resource Planning, ERP) 또는 운송관리(Transportation Management System, TMS) 벤더가 연결 복잡성을 흡수하는 유형이다.
스마트 커넥티드 서플라이어 네트워크(Smart Connected Supplier Network, SCSN)는 제조망에 해당한다.
기본 데이터 인프라(Basic Data Infrastructure, BDI)는 네덜란드 물류 실증에 해당한다 — 근거: `SRC-LOW-001`, `SRC-LOW-005`, `SRC-LOW-006`

| 사례 | 상태 | 확인 경로 | 참가자에게 남는 작업 | 한계 | 근거 |
| --- | --- | --- | --- | --- | --- |
| SCSN | `Verified` | 서비스 프로바이더가 기업 IT를 연결하고 메시지를 처리 | 원천 마스터데이터 정비와 거래 사실 확인 | 수기장부 입력대행 사례는 문서 미확인 | `SRC-LOW-001`~`SRC-LOW-004` |
| BDI | `Verified` | TMS·DigiDrop이 증명과 신원을 처리하고 운전자는 QR·PIN 사용 | 원천 운송정보와 대표권 확인 | 실증이며 대규모 중소기업 정착 사례가 아님 | `SRC-LOW-005`, `SRC-LOW-006` |

- **(Verified)** SCSN은 2025-08-12 기준 430개 이상 기업의 연결을 발표함 — 근거: `SRC-LOW-002`
- **(Verified)** 서비스 프로바이더 목록에는 2026-08-02 확인 시점에 12개 사업자가 표시됨 — 근거: `SRC-LOW-003`
  - **(제한)** 430개 기업과 12개 사업자는 기준시점이 다르므로 같은 시점의 비율로 계산할 수 없음
- **(Verified)** Tuinte는 기존 ERP 공급사 Isah에 연결·시험을 맡겼으나 원천 마스터데이터 정리에 수개월·100시간 이상을 투입함 — 근거: `SRC-LOW-004`
- **(Inferred)** 벤더 경유는 커넥터·메시지 변환 부담을 낮추지만 품목·운송 사실의 정비 책임을 없애지 않음
  - **(근거)** `SRC-LOW-004`, `SRC-LOW-005`

### 3.2 인증 제공자 분리형

| 사례 | 상태 | 분리 역할 | 참가자에게 남는 행위 | 성숙도 한계 | 근거 |
| --- | --- | --- | --- | --- | --- |
| Catena-X | `Verified` | 온보딩, 관리형 커넥터, 업무 앱, 자문, 적합성 평가 | 약관 수락, 데이터계약, 원천자료 판단 | 중소기업 비용·역량 병목이 남음 | `SRC-LOW-007`~`SRC-LOW-010` |
| Ouranos | `Verified` | 제품 탄소발자국 계산 앱, 앱 개발지원, 업무지원, 기술통합 | 활동량·부품명세서 입력, 공유범위 통제 | 자동차 부품 중소기업은 도구·교육·실증 확대 단계 | `SRC-LOW-011`~`SRC-LOW-014` |

- **(Verified)** Catena-X는 온보딩 서비스 제공자, 커넥터 서비스 제공자, 업무 앱 제공자와 적합성 평가기관을 분리함
  - **(근거)** `SRC-LOW-007`
- **(Verified)** CX-0006 v1.1.3은 참가기업이 프레임워크·운영자·데이터 스페이스 약관을 직접 수락하는 구조를 둠
  - **(근거)** `SRC-LOW-008`
- **(Verified)** Catena-X의 데이터 교환 거버넌스는 별도 합의가 없으면 데이터 품질·일관성·완전성을 보증하지 않는 구조임
  - **(근거)** `SRC-LOW-009`
- **(Verified)** 독일의 2026년 Data Space Accelerator는 2,300만 유로 규모이며 검증된 결과 뒤 보상하는 프로그램임
  - **(근거)** `SRC-LOW-010`
  - **(제한)** 지원액은 실제 구현비의 전액 보전이 아니며 중소기업 병목 해소 완료의 증거가 아님
- **(Verified)** Ouranos 배터리 제품 탄소발자국(Product Carbon Footprint, CFP) 서비스는 계산 앱과 업무·기술 지원자를 인증하는 역할분리 구조를 운영함
  - **(근거)** `SRC-LOW-011`~`SRC-LOW-013`
- **(Unverified)** 자동차 부품 중소기업의 엑셀 계산 결과가 Ouranos 생산망으로 자동 전송됐거나 다수 업체가 교환을 완료했다는 문서는 미확인
  - **(근거)** 확인된 범위는 계산도구 교육 — `SRC-LOW-014`

### 3.3 원천시스템 API 제공형

- **(Verified)** DjustConnect의 등록 농·원예인은 2025-01-17 기준 3,000명 이상이고, 데이터 연결 56개와 애플리케이션 17개가 발표됨
  - **(근거)** `SRC-LOW-015`
- **(Verified)** 농가는 파일을 만드는 대신 데이터 요청을 승인·거부·철회하고, 기존 원천시스템이 API로 데이터를 제공함
  - **(근거)** `SRC-LOW-016`, `SRC-LOW-017`
- **(Verified)** 원천 제공자는 협동조합, 정부, 수의·검사, 장비 클라우드와 구매 시스템을 포함함
  - **(근거)** `SRC-LOW-017`
- **(Unverified)** 수기 자료만 보유한 농가를 별도 입력대행자가 디지털화한 사례와 비개인 데이터 정확성 배상조항은 문서 미확인
  - **(확인 방법)** 표준계약과 서비스 운영기록을 DjustConnect 운영자에게 요청

### 3.4 공공·산업조직 혼합형

- **(Inferred)** 국내 버스 정산과 화물운송실적신고는 표준 엑셀, 웹입력, 행정데이터 대조, 조합·회계법인 검증과 대행을 조합하는 유형임
  - **(근거)** 경기·대전·전남·화물운송실적신고 운영자료 — `SRC-LOW-024`~`SRC-LOW-033`
- **(Verified)** 경기 사례는 업체 작성, 회계법인 검증·수정, 행정데이터 대조와 업체 최종확인의 순서임
  - **(근거)** `SRC-LOW-031`
- **(Verified)** 전남 사례는 운수사가 전용 웹에 입력하고 도·시군·회계기관이 원장·증빙과 대조한 방식임
  - **(근거)** `SRC-LOW-028`
- **(Verified)** 대전 사례는 운수사 입력, 카드수입 자동계산, 조합·협의회 정산과 회계기관 검증을 분리함
  - **(근거)** `SRC-LOW-032`, `SRC-LOW-033`
- **(Unverified)** 확인된 버스 사례에서 지자체가 수기 원장을 전부 대신 입력한 모델은 문서 미확인
  - **(확인 방법)** 17개 시·도 정산 매뉴얼과 위·수탁계약 확보

## 4. 화물운송실적신고 선례

### 4.1 화물운송실적신고시스템(FPIS) 3분할

화물운송실적신고시스템(FPIS)은 조사 범위에서 대행 허용과 책임 유지를 함께 규정한 국내에서 가장 명확한 법적 선례로 판단한다. 상태는 `Inferred`다 — 근거: `SRC-LOW-024`, `SRC-LOW-025`

| 분할 | 상태 | 원문에서 확인한 내용 | 근거 |
| --- | --- | --- | --- |
| 신고경로·정정기간 | `Verified` | 월별 직접입력, 지정 엑셀 일괄입력, 자체 시스템 DB 연계, 신고대행을 병렬 제공. 다음 해 3월 말 제출, 6월 말까지 수정 | `SRC-LOW-024` |
| 대행 가능 주체 | `Verified` | 운영위탁기관, 법정 협회, 연합회, 운송가맹사업자, 인증 화물정보망 | `SRC-LOW-025` |
| 책임 경계 | `Verified` | 대행기관의 확인 의무와 신고자의 최종책임을 함께 규정. 가맹사업자·인증정보망은 자기 망 실적만 대행 | `SRC-LOW-025` |

- **(Verified)** 대행기관은 신고자가 신고 내용을 확인할 수 있게 하는 확인 의무를 부담함 — 근거: `SRC-LOW-025`
- **(Verified)** 신고내역의 최종책임은 신고자에게 남음 — 근거: `SRC-LOW-025`
- **(제한)** FPIS 3분할은 세 기능 블록이며 대행기관을 세 종류로 나눈다는 뜻이 아님
- **(제한)** 신고대행 건수·수수료·부담주체·오류 통계는 문서 미확인

### 4.2 책임분할 제안

다음 표는 FPIS와 버스 정산 선례를 국토교통 데이터 스페이스에 적용한 `Decision` 제안이다. 현행 법제의 4주체 규정이나 채택 완료 상태가 아니다.

| 주체 | 제안 책임 | 책임 경계 | 상태 | 근거 |
| --- | --- | --- | --- | --- |
| 운수사 | 원자료·증빙·최종확인·신고내용 최종책임 | 거래·운행 사실과 누락·허위의 정정 | `Decision` | `SRC-LOW-025`, `SRC-LOW-032` |
| 대행자 | 정해진 매핑·입력·전송·처리로그·신고자 확인기회 | 원천 거래·운행 사실을 대신 보증하지 않음 | `Decision` | `SRC-LOW-004`, `SRC-LOW-025` |
| 데이터 스페이스 운영자 | 인증·접속·전송상태·감사로그 | 원천 회계와 운행 의미의 판정에서 제외 | `Decision` | `SRC-LOW-025` 책임 경계를 적용한 제안 |
| 지자체·검증기관 | 행정데이터 대조·이상탐지·환수·정정절차 | 업체 최종확인 없이 원천사실 책임을 인수하지 않음 | `Decision` | `SRC-LOW-028`, `SRC-LOW-031`, `SRC-LOW-032` |

- **(Inferred)** 위임은 원천사실 책임을 이전하지 않는다.
  - **(근거)** FPIS 최종책임, Tuinte 원천 정비, 경기 업체 최종확인 — `SRC-LOW-004`, `SRC-LOW-025`, `SRC-LOW-031`
- **(조건)** 이 책임분할은 변환 대행 경로의 설계 근거이며 대행 허용안을 다른 선택지보다 우월하다고 판정하지 않음

## 5. 국내 의무화 지원 패턴

### 5.1 교차 사례

| 지원 패턴 | 상태 | 확인 사례 | 적용 한계 | 근거 |
| --- | --- | --- | --- | --- |
| 단계적 대상 확대 | `Verified` | 전자세금계산서 대상 기준의 단계 하향, FPIS 신고 단위·대상 조정 | 제도별 일정과 대상이 다름 | `SRC-LOW-018`, `SRC-LOW-026`, `SRC-LOW-027` |
| 무료 공공 최소수단 | `Verified` | 홈택스·손택스, 자동응답전화(ARS), 세무서 대리발급 | 세무사·회계사무소의 무료 대행을 뜻하지 않음 | `SRC-LOW-019` |
| 복수 제출 경로 | `Inferred` | 웹·ARS·엑셀·API·방문·대행을 사례별로 병렬 제공 | 한 제도가 경로 전부를 제공한다는 뜻이 아님 | `SRC-LOW-019`, `SRC-LOW-022`, `SRC-LOW-024`, `SRC-LOW-028` |
| 비용지원·세액공제 | `Verified` | 전자세금계산서·현금영수증 세액공제 | 대행비 전액 보전으로 해석할 수 없음 | `SRC-LOW-020`, `SRC-LOW-022` |
| 정정기간·유예 | `Verified` | FPIS 수정기간, 전자세금계산서 시행 유예, 현금영수증 자진정정 | 제도별 기한이 다름 | `SRC-LOW-021`, `SRC-LOW-022`, `SRC-LOW-024` |
| 최영세층 예외 | `Verified` | FPIS 1대 운송사업자 제외, 하도급지킴이 소액·단기공사 제외 | 데이터 스페이스 예외기준은 별도 결정 필요 | `SRC-LOW-023`, `SRC-LOW-027` |

- **(Inferred)** 국내 의무화 지원 패턴은 단계적 대상 확대, 무료 공공 최소수단, 복수 경로, 비용지원·세액공제, 정정기간·유예와 최영세층 예외의 조합임
  - **(근거)** `SRC-LOW-018`~`SRC-LOW-027`
- **(Unverified)** 처음부터 API나 자체 시스템만을 요구한 사례는 찾지 못했다.
  - **(조건)** 조사 범위 밖 제도의 존재 여부는 판정 불가

### 5.2 적용 경계

- **(Inferred)** 관리형 커넥터만 제공하고 참가자가 직접 Offering을 게시하게 하는 경로는 수기·외부기장·비연계 ERP 참가자를 포괄하지 못함
  - **(근거)** 관리형 역할과 참가자 약관 수락, Tuinte 원천 정비, 국내 비연계 ERP — `SRC-LOW-004`, `SRC-LOW-007`, `SRC-LOW-008`, `SRC-LOW-029`, `SRC-LOW-030`
- **(Inferred)** 대행 허용 여부는 원자료 판독, 표준 항목 판단, 업로드, 최종확인, 오류 정정·배상과 비용 부담의 여섯 기능으로 나누어 판정할 필요가 있음
  - **(근거)** FPIS와 경기·대전 책임 분리 — `SRC-LOW-025`, `SRC-LOW-031`, `SRC-LOW-032`

## 6. 국내 버스 실태

### 6.1 전국 판정

- **(Unverified)** 전국 데이터 없음 — 판정 불가
  - **(미확인)** 전국 대표 자체기장·외부기장·조합대행 비중
  - **(제한)** 외부감사 건수, ERP 사용률과 지역 준공영제 자료로 대체할 수 없음
- **(판정 경고)** ERP 사용률을 자력 Offering 게시 가능률로, 외부기장을 규격변환 책임 이전으로 해석해서는 안 된다.
  - **(근거)** 경기 ERP는 대부분 도 시스템과 미연계이고, 외부기장은 산업별 정산규격 변환의 증거가 아님 — `SRC-LOW-029`, `SRC-LOW-030`

### 6.2 지역·규모 수치

| 범위·시점 | 상태 | 확인 수치 | 해석 한계 | 근거 |
| --- | --- | --- | --- | --- |
| 인천 준공영제, 2019년 | `Verified` | 32개사 중 17개사, 53%가 외부 회계법인 기장 | 전국 대표가 아니며 공통 ERP 설치 전후 시점 구분 필요 | `SRC-LOW-029` |
| 경기 시내버스, 2024년 | `Verified` | 75개사 중 65개사, 86.7%가 ERP 사용 | 대부분 도 시스템과 미연계. 자체기장률이 아님 | `SRC-LOW-030` |
| 시내버스 규모 분포 | `Verified` | 388개사 중 50대 이하 105개사, 27.1% | 자료의 기준연도·집계범위 안에서만 유효 | `SRC-LOW-034` |
| 농어촌버스 규모 분포 | `Verified` | 88개사 중 50대 이하 83개사, 94% | 시내버스 분모와 합산할 수 없음 | `SRC-LOW-034` |

- **(Verified)** 인천의 17개 외부기장사와 15개 개별 ERP사는 같은 32개사를 나눈 수치임 — 근거: `SRC-LOW-029`
  - **(제한)** 자료는 공통 ERP 설치도 함께 발표하므로 설치 전 실태인지 설치 후 상태인지 문서만으로 분리되지 않음
- **(Verified)** 경기의 통합 ERP는 2024-05-22 추진 계획이며 구축·연계 완료 증거가 아님 — 근거: `SRC-LOW-030`
- **(제한)** 시내버스 50대 이하 27.1%와 농어촌버스 94%는 개별 규모 분포이며 전국 전산화 수준을 나타내지 않음 — 근거: `SRC-LOW-034`

### 6.3 정산 제출형태

| 지역 | 상태 | 제출·검증 방식 | 원천 책임 | 근거 |
| --- | --- | --- | --- | --- |
| 경기 | `Verified` | 표준 엑셀 작성, 회계법인 검증·수정, 버스관리시스템·카드·보조금·ERP 대조, 업체 최종확인 | 운수사 확인과 대표자 날인 | `SRC-LOW-031` |
| 대전 | `Verified` | 운수사 직접입력, 카드 자동계산, 조합·협의회 정산, 회계기관 검증 | 운행·현금·예외 입증은 운수사 | `SRC-LOW-032`, `SRC-LOW-033` |
| 전남 | `Verified` | 운수사 월별 웹입력, 도·시군·회계기관 현장대조 | 운수사가 수입·지출·급여·차량·노선 입력 | `SRC-LOW-028` |
| 인천 | `Verified` | 준공영제 32개사 공통 ERP와 관리자 교육 | 구축비 부담주체는 문서 미확인 | `SRC-LOW-029` |

- **(Inferred)** 확인된 구현은 직접 웹입력, 엑셀 회수, 카드·버스관리시스템 자동수집, 증빙과 조합·회계법인 검증을 섞은 혼합형임
  - **(근거)** `SRC-LOW-028`~`SRC-LOW-033`
- **(Unverified)** 대전 책임분할은 2020-10-30 개정본 전문 기준이며 2023-10-30 개정본 전문은 안정적으로 대조하지 못함 — 근거: `SRC-LOW-032`, `SRC-LOW-035`
  - **(확인 방법)** 최신 개정본 전문을 확보해 운수사·조합·협의회·회계기관 조항 대조

## 7. 미확인 사항과 결정 요청

| ID | 상태 | 미확인 사항 또는 결정 요청 | 영향 | 확인 방법 또는 종료 조건 |
| --- | --- | --- | --- | --- |
| `OPEN-LOW-01` | `Unverified` | 전국 자체기장·외부기장·조합대행 비중 | 저기술 참가자 규모 판정 | 17개 시·도·버스조합 자료와 규모층별 표본조사 확보 |
| `OPEN-LOW-02` | `Unverified` | 회계·세무사무소의 정산파일 변환·업로드 비율과 요금 | 대행 수요와 비용 산정 | 운수사·대행사 표본조사와 계약서 확인 |
| `OPEN-LOW-03` | `Unverified` | 지자체별 최신 매뉴얼·엑셀·API·데이터사전·오류코드 | 공통 입력경로와 변환범위 정의 | 17개 시·도 정보공개청구 |
| `OPEN-LOW-04` | `Unverified` | 조합·지자체 위·수탁협약, 비용분담과 오류배상 조항 | 책임·배상 경계 확정 | 위·수탁계약과 준공영제 최신 지침 확보 |
| `OPEN-LOW-05` | `Unverified` | FPIS 대행 건수·수수료·부담주체·오류 통계 | 국내 법적 선례의 운영 실효 판정 | FPIS 운영기관 통계와 표준계약 요청 |
| `OPEN-LOW-06` | `Unverified` | SCSN의 수기장부 입력·변환 사례 | ERP 미보유 참가자 적용 가능성 | 서비스 프로바이더 사례·계약 확인 |
| `OPEN-LOW-07` | `Unverified` | DjustConnect 가격표와 비개인 데이터 정확성 배상조항 | 원천시스템형 비용·책임 판정 | 운영자 표준계약 요청 |
| `OPEN-LOW-08` | `Unverified` | Catena-X 지원사업의 중소기업별 실제 구현비·완료율 | 비용지원 효과 판정 | 2026년 사업 결과보고서 확보 |
| `OPEN-LOW-09` | `Unverified` | Ouranos 자동차 부품 중소기업 생산환경 교환 완료 업체 수 | 인증지원자형 성숙도 판정 | ABtC·JAPIA 운영실적 확인 |
| `OPEN-LOW-10` | `Unverified` | BDI의 영세기업 상용 참여비와 대규모 운영성과 | TMS 경유형의 상용성 판정 | 2026년 구성요소 개발 후 운영자료 확인 |
| `OPEN-LOW-11` | `Decision` | 자력·대행·지자체 변환 중 기본 경로와 병렬 허용 범위 | 온보딩 대상과 운영비 배분 | 기능별 비용·오류·처리량 자료를 비교한 승인 필요 |
| `OPEN-LOW-12` | `Decision` | 대행자 자격, 비용 부담, 최종확인과 배상 한도 | 시장 진입과 무권한 제공 위험 | 표준계약·인증수준·보조기준을 확정한 승인 필요 |
| `OPEN-LOW-13` | `Decision` | 4주체 책임분할 제안의 채택 여부 | 운영규칙과 계약 책임 배치 | `OPEN-LOW-01`~`OPEN-LOW-05` 종결 뒤 별도 결정 기록 |

## 8. 출처

| SRC-ID | 발행기관 | 문서명 | version 또는 상태 | 발행일 | URL | 확인일 | 페이지 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SRC-LOW-001` | SCSN Foundation | SCSN Questions and Answers | 현행 웹페이지 | 발행일 미표시 | https://smart-connected.nl/en/about-scsn/questions-and-answers | 2026-08-02 | 해당 없음 |
| `SRC-LOW-002` | SCSN Foundation | SCSN: the standard for digital collaboration | 보도자료 | 2025-08-12 | https://smart-connected.nl/en/news-events/scsn-the-standard-for-digital-collaboration-in-the-manufacturing-industry | 2026-08-02 | 해당 없음 |
| `SRC-LOW-003` | SCSN Foundation | 서비스 프로바이더 목록 | 현행 목록 | 발행일 미표시 | https://smart-connected.nl/en/the-network/service-providers | 2026-08-02 | 해당 없음 |
| `SRC-LOW-004` | SCSN Foundation | Tuinte 도입사례 | 사례기사 | 2026-06-09 | https://smart-connected.nl/nl/blogs/tuinte-over-werken-met-scsn-als-je-veel-orderregels-hebt-scheelt-het-enorm-veel-werk | 2026-08-02 | 해당 없음 |
| `SRC-LOW-005` | Topsector Logistiek·BDI | JWS as Digital Proof | 실증보고서 | 2025-01-30 | https://content.bdinetwork.org/wp-content/uploads/sites/2/2025/02/20250130_TSL_BDI-JWS-as-digital-proof.pdf | 2026-08-02 | 문서 미확인 |
| `SRC-LOW-006` | BDI Network | Conclusion starts work on BDI components | 발표 | 2026-05-28 | https://bdinetwork.org/en/conclusion-starts-work-on-bdi-components | 2026-08-02 | 해당 없음 |
| `SRC-LOW-007` | Catena-X Automotive Network e.V. | Catena-X Collaboration Roles | 현행 웹페이지 | 발행일 미표시 | https://catena-x.net/ecosystem/collaboration-roles/ | 2026-08-02 | 해당 없음 |
| `SRC-LOW-008` | Catena-X e.V. | CX-0006 Registration and Initial Onboarding | v1.1.3 | 2024-01 | https://catena-x.net/fileadmin/user_upload/Standard-Bibliothek/Update_Januar_2024/CX-0006-RegistrationAndInitialOnboarding-v1.1.3.pdf | 2026-08-02 | 문서 미확인 |
| `SRC-LOW-009` | Catena-X e.V. | Data Exchange Governance | v1.0 | 2024-06-07 | https://catena-x.net/fileadmin/user_upload/04_Einfuehren_und_umsetzen/Governance_Framework/240607_Catena-X_Data_Exchange_Governance_final__1_.pdf | 2026-08-02 | 문서 미확인 |
| `SRC-LOW-010` | Catena-X·IDSA | Data Space Accelerator 발표 | 보도자료 | 2026-06-08 | https://catena-x.net/news/e23-million-data-space-accelerator-launched-to-fast-track-sme-integration-within-the-catena-x-ecosystem/ | 2026-08-02 | 해당 없음 |
| `SRC-LOW-011` | ABtC | Ouranos 배터리 CFP 서비스 발표 | 보도자료 | 2024-05-16 | https://abtc.or.jp/news/240516-1 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-012` | ABtC | 인증제도 | 현행 웹페이지 | 발행일 미표시 | https://abtc.or.jp/program_certification | 2026-08-02 | 해당 없음 |
| `SRC-LOW-013` | ABtC | 인증사업자 목록 | 현행 목록 | 발행일 미표시 | https://abtc.or.jp/program_certification/company | 2026-08-02 | 해당 없음 |
| `SRC-LOW-014` | 일본자동차부품공업회 | JAMA 계산시트 설명회 | 행사 안내 | 게시일 미표시·행사 2026-05-15 | https://www.japia.or.jp/seminar/topics_detail109/id%3D6468 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-015` | ILVO | DjustConnect celebrates fifth birthday with solid growth | 발표 | 2025-01-17 | https://ilvo.vlaanderen.be/en/news/djustconnect-celebrates-fifth-birthday-with-solid-growth | 2026-08-02 | 해당 없음 |
| `SRC-LOW-016` | DjustConnect·ILVO | How does it work | 현행 웹페이지 | 발행일 미표시 | https://djustconnect.be/en/how-does-it-work | 2026-08-02 | 해당 없음 |
| `SRC-LOW-017` | DjustConnect·ILVO | ConnectShop | 현행 목록 | 발행일 미표시 | https://djustconnect.be/en/ConnectShop | 2026-08-02 | 해당 없음 |
| `SRC-LOW-018` | 국세청 | 전자세금계산서 의무대상 | 상시 안내 | 발행일 미표시 | https://s.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7787&mi=2461 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-019` | 국세청 | 발급방법 및 절차 | 상시 안내 | 발행일 미표시 | https://j.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7788&mi=2462 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-020` | 국세청 | 혜택·가산세 | 상시 안내 | 발행일 미표시 | https://i.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7790&mi=2464 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-021` | 기획재정부 | 전자세금계산서 전송 관련 세법개정 | 정책뉴스 | 2011-12-20 | https://www.korea.kr/news/policyNewsView.do?newsId=148724425 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-022` | 국세청 | 현금영수증 20년 성과·2026 확대 | 보도자료 | 2026-05-26 | https://d.nts.go.kr/yeosu/na/ntt/selectNttInfo.do?bbsId=1028&mi=2201&nttSn=1351766 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-023` | 조달청 | 하도급지킴이 안내 | 상시 안내 | 발행일 미표시 | https://pps.go.kr/kor/content.do?key=01178 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-024` | 국토교통부·FPIS | FPIS 신고안내 | 상시 안내 | 발행일 미표시 | https://fpis.go.kr/mobile/info/mobileInfo1_View.do | 2026-08-02 | 해당 없음 |
| `SRC-LOW-025` | 국토교통부 | 화물운송실적신고제 시행지침 제3조 | 국토교통부고시 제2017-824호 | 2017-12-15 | https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000105630 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-026` | 국토교통부 | 2015년 화물운송실적신고 제도개선 | 발표 | 2015-11-17 | https://www.molit.go.kr/USR/I0204/m_45/dtl.jsp?idx=13862 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-027` | 국토교통부·FPIS | 2016년 1대 운송사업자 제외 안내 | 안내 | 2016·페이지 일자 미표시 | https://www.fpis.go.kr/html/notice2016-1.jsp | 2026-08-02 | 해당 없음 |
| `SRC-LOW-028` | 전라남도 | 버스경영수지분석 성과 | 지자체 발표 | 2016-05-12 | https://www.jeonnam.go.kr/M7116/boardView.do?displayHeader=&infoReturn=&menuId=jeonnam0202000000&pageIndex=56&searchText=&searchType=&seq=1935341 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-029` | 인천광역시 버스정책과 | 인천시 공통 ERP 구축 | 보도자료 | 2019-12-01 | https://press.incheon.go.kr/citynet/jsp/sap/SAPNewsBizProcess.do?command=searchDetailSvp&flag=&matOfYmd=20191201&matSno=13&sido=&viFlag=in | 2026-08-02 | 해당 없음 |
| `SRC-LOW-030` | 경기도 버스정책과 | 경기도 통합 ERP 추진 | 계획 발표 | 2024-05-22 | https://gnews.gg.go.kr/briefing/brief_gongbo_view.do?BS_CODE=S017&number=61712 | 2026-08-02 | 해당 없음 |
| `SRC-LOW-031` | 경기도·대현회계법인 | 2019년 경기도 버스운송업체 일반 및 재무현황 조사 | 조사 2020·공개 2021 | 공개 2021 | https://ebook.gg.go.kr/src/viewer/download.php?host=main&no=4&site=20210322_163033 | 2026-08-02 | 문서 미확인 |
| `SRC-LOW-032` | 대전광역시 | 시내버스 준공영제 운영지침 | 2020-10-30 개정본 | 2020-10-30 | https://clik.nanet.go.kr/clikr-collection/policyinfo/84/451/2020/CLIKC2950390708233749_attach_1.pdf | 2026-08-02 | 문서 미확인 |
| `SRC-LOW-033` | 대전광역시버스운송사업조합 | 조직·업무 | 현행 조직표 | 발행일 미표시 | https://www.daejeonbus.or.kr/sub0104.do | 2026-08-02 | 해당 없음 |
| `SRC-LOW-034` | 국회예산정책처 | 2026년도 예산안 위원회별 분석 | 2025-10 발간본 | 발간심의 2025-10-30 | https://nabo.go.kr/board/file/down.do?fid=33318898 | 2026-08-02 | 84~85쪽 |
| `SRC-LOW-035` | 대전광역시 버스정책과 | 2023년 준공영제 운영지침 개정본 게시 | 개정본 게시 | 개정 2023-10-30·게시 2023-11-29 | https://www.daejeon.go.kr/drh/depart/board/boardNormalView.do?boardId=normal_0179&menuSeq=2709&ntatcSeq=1444968171&pageIndex=1 | 2026-08-02 | 해당 없음 |
