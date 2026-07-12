# 원천·권리 인벤토리

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 적용 Gate

- **(목적)** 검색 레코드와 기존 플랫폼 Dataset의 DSP Catalog Offering 승격 가능 여부 판정
- **(확인 범위)** 플랫폼 역할, 실제 원천, Provider 권한, 이용권리, 기술 접근과 종료 후 회수조건
- **(Gate)** 필수 증거가 없는 레코드는 DSP Dataset과 Offer 생성 금지
- **(산출물)** Dataset별 판정 상태, 책임 주체, source binding, 권리 근거와 회수 검증 기록

상세 조사에는 [데이터셋 패스포트 템플릿](../../templates/dataset-passport.md)을 사용한다.

## 2. Offering 적격성 판정 상태

| 상태 | 의미 | DSP 처리 |
| --- | --- | --- |
| `catalog-only` | 소재와 설명만 공개 가능 | 포털·DCAT discovery에 설명과 원천 landing page 제공; DSP Catalog Dataset은 만들지 않음 |
| `transferable-open` | 공개 license와 재제공 경로 확인 | 공개 Distribution 또는 간소 Offer |
| `transferable-controlled` | 특정 참가자·목적에 제공 가능 | 자격·계약·Data Plane 통제 후 제공 |
| `secure-analysis` | 원시 전송은 부적절하나 분석 가능 | 원격 분석·compute-to-data와 결과 반출심사 |
| `excluded` | 법·보안·권리·운영 사유로 제공 불가 | 외부 Catalog 제외 또는 최소 존재정보만 제공 |
| `unverified` | 증거 부족 | Offer 생성 금지 |

## 3. 필수 증거 필드

### 3.1 책임과 권리

- 통합 채널 record ID와 원천 dataset ID
- 원 데이터 보유기관, 업무부서, Publisher·steward
- 플랫폼 운영자와 `hosted·brokered·index-only·unknown` 판정근거
- Offering Provider Participant와 법적 계약 당사자
- Connector 운영자와 Data Delivery Operator
- 대행·중개 위임 범위, 기간, 재제공·credential·사고 책임 증거
- 적용 법령과 제공 근거
- license, 공공누리 유형, 제3자 권리
- 재제공, 파생데이터, AI 학습, 국외처리 허용 여부
- 허용 수신자, 목적, 지역, 이용기간

### 3.2 기술

- source system과 공식 base URL
- REST·파일·웹 맵 서비스(Web Map Service, WMS)·웹 피처 서비스(Web Feature Service, WFS)·stream 접근방식
- 인증, credential owner, quota, 승인유형
- schema·API version, update frequency, change notification
- format, media type, 압축, checksum
- CRS, axis order, 경계 상자(Bounding Box, BBOX), spatial resolution
- time zone, observation interval, unit, latency
- 표준 node/link와 코드표 version
- SLA, timeout, retry, pagination, 최대 크기
- metadata baseline·delta·delete와 stable ID
- subscription·entitlement·token·job 생성·조회·삭제 API
- dataspace participant와 platform identity binding

### 3.3 보호와 운영

- 공개·제한·개인정보·가명정보·위치정보·공간정보 등급
- 필드별 masking·aggregation·filter 규칙
- cache·복제·보유·파기 정책
- 보안심사·영향평가·법무검토의 문서번호와 유효기간
- incident owner와 제공중단 절차
- 마지막 원천·권리 확인일
- Agreement 종료·Dataset 철회 후 외부 자원 회수와 reconciliation 방식

## 4. 초기 실증 후보 판정

- **(용도)** 조사 우선순위와 추가 증거 식별
- **(제한)** 후보 등록은 제공 승인이나 Offering 적격성 확정을 의미하지 않음

| 후보 | 형태 | 확인된 사실 | 미확인 항목 | 초기 판정 |
| --- | --- | --- | --- | --- |
| 통계누리 공개 통계표 | REST/JSON | 공개 통계 범위, 인증키와 시계열 조회 | 대상 표 ID, 운영 key, quota, cache 허용 | `unverified` → open 후보 |
| ITS 교통소통정보 | REST | 인증키 기반 API, link ID·속도·통행시간·생성시각 | 운영 quota, schema version, proxy 허용 | `unverified` → open 후보 |
| ITS 표준 노드·링크 | 파일 | 파일 배포와 변경이력, 국가 관리지침 | 선택 지역·버전, checksum, license | `unverified` → open snapshot 후보 |
| VWorld 공간 layer | WFS/WMS | OGC 기반 layer·feature 접근 | 대상 layer, CRS, traffic, 원천 URL 노출정책 | `unverified` → GIS 후보 |
| 통합 채널 분석센터 metadata | REST 후보 | API 정의·신청 흐름·metadata 필드 | 문서 host DNS 실패; 운영 host, HTTPS, SLA, bulk·delta 지원 | `unverified` → Catalog source 후보 |
| 통합 채널 hosted·brokered 공개 Dataset | 미확인 | Mobilithek형 Bridge의 목표 후보 유형 | 대상 목록, Provider 권한, Distribution, subscription·revoke API | `unverified` → 최우선 조사 |
| 교통카드 집계자료 | 파일·분석 | 일반 제공은 집계자료 원칙 | 원 권한기관·Offering Provider, 재제공 권한, 목적·수신자 | 초기 실증 제외 |
| 공개제한 공간정보 | GIS·파일 | 보안심사와 통제 의무 | 등급, 승인환경, 반출정책 | 초기 실증 제외 |

### 4.1 분석센터 Open API 판정

화면에 게시된 정의와 production 연계 가능성을 분리한다. 근거: `SRC-MOLIT-004`, `SRC-MOLIT-009`, `SRC-MOLIT-010`.

| API | 문서상 경로 | 신청 | Catalog 연계 판정 |
| --- | --- | --- | --- |
| 통합검색 | `GET /api/openapi/search/getOpenApiSearchList` | 필요·자동승인 | 후보. 검색 결과와 Dataset을 구분하는 mapping 필요 |
| 분석 데이터셋 | `GET /api/openapi/dataset/getOpenApiDatasetList` | 필요·자동승인 | 후보. metadata 범위는 유용하나 bulk·delta·삭제 동기화 미확인 |
| 분석과제 등록 | `POST /api/openapi/asmt/add` | 필요·심의승인 | Catalog 수집 대상 아님. 초기 실증에서 신청·호출하지 않음 |

세 경로의 문서상 base URL은 HTTP다. 2026-07-11에는 문서상 host의 A record를 정상적으로 얻지 못해 TLS와 wire response를 확인하지 못했다. 따라서 read API도 `transferable-open`으로 판정하지 않고, [운영기관 확인 질문](operator-questionnaire.md)의 P0 증거를 받은 뒤 다시 판정한다.

## 5. 역할과 Offering Provider 판정 절차

1. 통합 채널 record에서 `publisher`, 관리기관, 원천 URL과 실제 Distribution을 추출한다.
2. Dataset과 delivery path의 `platformRecordRole`을 `hosted·brokered·index-only·unknown` 중 하나로 판정한다.
3. 원 데이터 보유기관, Publisher·steward와 플랫폼 운영자를 확인한다.
4. DSP Offer·Agreement의 Provider Participant와 법적 계약 당사자를 정한다.
5. 원 보유기관과 다른 주체가 Provider가 되면 위임 범위, 기간, 재위임, 재제공, credential과 사고책임을 문서화한다.
6. Connector 운영자, Data Delivery Operator와 source·subscription API 책임을 정한다.
7. 법무·개인정보·공간정보 보안 담당이 등급과 제공·회수 경로를 승인한다.
8. 승인된 자산만 Provider Connector에 등록한다.

## 6. 공개 데이터 판정

- **(판정)** 다음 조건을 모두 충족한 자산만 `transferable-open`으로 분류

- 정보공개법상 비공개 대상과 제3자 권리 문제가 없음
- 데이터 상세의 license와 실제 payload의 license가 일치함
- 중앙 proxy·cache·재제공이 원천 이용조건과 충돌하지 않음
- API key를 공유하거나 대행할 경우 원천기관이 이를 허용함
- source URL, schema, update, quota와 장애 연락처가 확인됨
- Agreement와 Transfer에 필요한 접근 생성·종료 방식이 확인됨
- Dataset 수정·삭제와 external token·subscription 회수 방법이 확인됨
- 개인정보·위치정보·공개제한 공간정보가 포함되지 않음

## 7. 제한 데이터 판정

- **(판정)** `transferable-controlled` 또는 `secure-analysis`에는 다음 증거를 추가로 요구

- 수신기관 자격과 이용목적을 판단할 기준
- 계약기간, 보유기간, 삭제·파생물 처리조건
- Catalog에서 노출할 최소 metadata 범위
- row·column·area·time filter와 결과 반출규칙
- 계약 정지·철회 시 token·접근제어목록(Access Control List, ACL)·복제본 회수 절차
- 소비자 측 감사·파기 증적과 위반 대응절차

## 8. 조사 완료 기준

자산별 조사 담당자는 다음 항목을 문서 증거와 연결한다.

1. 원 데이터 보유기관과 metadata·품질 관리주체
2. Dataset·delivery path의 `hosted·brokered·index-only·unknown` 역할
3. DSP Offering Provider, 계약 당사자와 권한 근거
4. source endpoint, 기관용 credential owner와 접근조건
5. Distribution, DataService와 transfer profile
6. Agreement와 subscription·entitlement·token·job의 대응관계
7. 계약 전·중·후 policy 집행점과 시험 결과
8. 수정·삭제·만료·사고 시 회수 대상, 통지 주체와 reconciliation 증거
