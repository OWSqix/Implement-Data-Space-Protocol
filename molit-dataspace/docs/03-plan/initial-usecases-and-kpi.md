# 초기 유즈케이스·KPI

작성일: 2026-08-01  
작성 기준: 설계 인터뷰 D-13·20·DEF-06  
상태: Draft

## 1. 목적과 경계

이 문서는 첫 실증의 비즈니스 유즈케이스 두 건과 결과 KPI·중단조건을 정의한다. 기술 후보의 준비도와 Full Offering 인정은 기존 PoC Gate에서 별도로 판정한다.

- 유즈케이스 1: 준공영제 정산 — 상위 등급 경로 검증
- 유즈케이스 2: 교통 공공데이터 연합 검색·구독 — 기본 등급 경로 검증
- 수치 목표: DEF-06으로 미결정
- 제외 지표: 조직 설립 건수, 프레임 채택 건수, 문서 작성 건수

착수·완료 원칙은 [분야 구성 연구 §5.2·§7](../01-research/dataspace-topology-single-vs-sectoral.md#52-착수-순서)과 [기획보고서 기술 검토 T-27](../01-research/planning-report-technical-review.md#t-27-시스템-수문서-작성-여부-중심의-완료-기준)을 링크해 사용한다. 이 문서에서 해당 원칙을 다시 정의하지 않는다.

## 2. 공통 진입 Gate

| Gate | 판정 입력 | 통과 증거 | 실패 상태 |
| --- | --- | --- | --- |
| 자산 | Dataset Passport, source·version, Provider 권한 | 자산별 승인 판정 ID | `excluded` 또는 `pending` |
| 참가 경로 | 기본 또는 상위 등급, credential, 경로 binding | 유효한 참가·재평가 판정 | `BLOCKED` |
| 계약·정책 | 목적·수신자·기간, license·법적 근거 | 승인 Offer·Agreement와 정책 판정 | 협상·전송 차단 |
| 전달·회수 | source binding, 전달 방식, token·구독 회수 | G0~G6와 cleanup 증거 | Full Offering 불인정 |
| 측정 | KPI 사건·시각·분모와 test run ID | 재현 가능한 집계 query | KPI 집계 제외 |

첫 출시의 데이터 등급 상한과 자산별 판정은 [실증 로드맵 §2.1](pilot-and-roadmap.md#21-첫-출시-등급-상한)을 따른다.

## 3. 준공영제 정산 유즈케이스

### 3.1 가치·업무 경계

| 항목 | 정의 |
| --- | --- |
| 수혜자 | 정산 자료를 제출하는 운수사와 승인 범위에서 대사하는 지자체·정산 담당 |
| Provider 기능 | 승인된 운수사 Participant가 정산 명세와 로컬 증적을 제출 |
| Consumer 기능 | 승인된 정산 주체가 계약 범위의 명세·대사 결과를 조회 |
| 교환 단위 | 분야 DSGA가 승인할 정산 명세 version과 공통 감사 ID |
| 결과 | 제출·검증·불일치·보완·승인 상태와 대사 증거 |
| 등급 경로 | 의무 거래에 적용할 상위 등급 경로 후보 |

정산 유즈케이스 대상은 정산 명세 수준, pilot:36의 원시 교통카드 제외 유지.

원시 승하차 record, 개인·가명 식별값과 결제수단 원문은 첫 실증 자산에 포함하지 않는다. payload 필드는 DEF-05의 실물 조사와 분야 DSGA 승인 전에는 확정하지 않는다.

### 3.2 실행 흐름과 완료조건

1. 운수사 경로·자산 권한·정산 명세 version을 승인한다.
2. 계약의 목적·수신자·기간과 정기 정산 제출 범위를 고정한다.
3. 정산 명세, 로컬 증적과 공통 감사 ID를 제출한다.
4. 정산자는 감사 ID로 존재 증명을 조회하고 명세를 대사한다.
5. 불일치를 상태·사유·보완 요청과 연결하고 재제출을 같은 업무 건에 묶는다.
6. 종료 뒤 접근 token·임시자원을 회수하고 보존·개봉 사건을 기록한다.

완료조건은 승인 자산의 제출부터 대사·불일치 처리·회수까지 같은 test run ID로 조회되는 것이다. ADR-0006이 `Proposed`인 동안 중앙 notary의 실제 운영 의무를 완료조건으로 승격하지 않는다.

### 3.3 중단조건

- 원시 교통카드 또는 개인·가명정보가 입력에 포함됨
- 정산 명세의 source·version·Provider 권한을 확인할 수 없음
- 참가 상위 등급 또는 계약의 목적·수신자·기간 판정이 만료·철회됨
- 거래유형의 증적 근거가 미확인인데 중앙 notary 의무로 승격됨
- 제출·대사·개봉·회수 사건을 공통 감사 ID와 test run ID로 연결할 수 없음

## 4. 교통 공공데이터 연합 검색·구독 유즈케이스

### 4.1 가치·업무 경계

| 항목 | 정의 |
| --- | --- |
| 수혜자 | 여러 공공 원천의 Dataset을 한 검색 경로에서 찾고 승인 접근을 구독하는 기관·사업자 |
| Provider 기능 | 원 보유기관 또는 권한을 증명한 Participant가 metadata와 승인 Distribution을 게시 |
| Consumer 기능 | 검색 결과에서 Offer를 선택하고 구독·접근 상태를 관리 |
| 교환 단위 | 공개 Dataset metadata, 기존 license, Distribution·DataService와 source binding |
| 결과 | 연합 검색 결과, Agreement 또는 공개 접근 경로, 구독·변경·해지 사건 |
| 등급 경로 | 공개·등록형 공개의 기본 등급 경로 |

기존 공개 URL과 license를 유지한다. 연합 검색 record만 있는 자산을 거래 가능한 Offering이나 payload 구독으로 판정하지 않는다.

### 4.2 실행 흐름과 완료조건

1. 원천 Dataset·Publisher·Provider 권한과 공개 license를 판정한다.
2. metadata를 canonical graph로 변환하고 source·Distribution·DataService를 구분한다.
3. 자격과 visibility에 맞는 연합 검색 결과를 제공한다.
4. Offering 적격 자산만 계약 또는 공개 접근 경로와 구독 상태를 만든다.
5. 원천 변경·삭제를 구독 통지와 Catalog 상태에 반영한다.
6. 해지·철회 뒤 token·subscription·임시자원을 회수하고 reconciliation을 수행한다.

완료조건은 연합 검색 Dataset과 실제 구독 건을 별도 분모로 집계하고, 각 구독에 source·권리·접근·변경·해지 증거가 연결되는 것이다.

### 4.3 중단조건

- 검색 record를 Dataset으로 확인할 source ID·version이 없음
- Provider 권한·license·Distribution 또는 회수방법이 없음
- 내부 source endpoint·credential이 공개 Catalog에 노출됨
- 원천 삭제가 Catalog·구독 상태에 반영되지 않음
- Discovery 건을 payload 구독 건으로 중복 집계함

## 5. KPI 초안과 수치 결정

### 5.1 준공영제 정산

| KPI | 정의·분모 | 증거 | 수치 상태 |
| --- | --- | --- | --- |
| 검증 소요시간 | 유효 제출 접수부터 대사 결과 확정까지의 경과시간; 중단·재제출은 별도 구간 | 제출·대사·결정 시각과 test run ID | DEF-06 미정 |
| 불일치 발견 건수 | 승인 명세 규칙 또는 당사자 대사에서 확인된 고유 불일치 업무 건 | 규칙 ID·양측 상태·보완 결과 | DEF-06 미정 |
| 참가 운수사 수 | 유효한 상위 등급 경로로 정산 흐름을 끝까지 완료한 고유 운수사 | 참가 판정·Agreement·대사·회수 증거 | DEF-06 미정 |

### 5.2 공공데이터 연합 검색·구독

| KPI | 정의·분모 | 증거 | 수치 상태 |
| --- | --- | --- | --- |
| 연합 검색 Dataset 수 | source와 Provider 권한을 확인하고 검색 가능한 고유 Dataset | Dataset Passport·Catalog snapshot·source diff | DEF-06 미정 |
| 구독 건수 | Offering 적격 자산에서 생성·변경·해지를 추적할 수 있는 고유 구독 | Agreement 또는 공개 접근 근거·subscription·cleanup | DEF-06 미정 |

수치 목표와 기준기간은 실증 착수 때 DEF-06 변경 기록으로 승인한다. 기준선 없이 임의 목표를 기입하지 않는다.

## 6. PoC 후보 문서와의 경계

[PoC 후보 목록](poc-candidate-shortlist.md)은 자산·권리·source·수명주기의 기술 준비도를 판정하는 정본이다. 이 문서의 유즈케이스 채택은 후보 자산의 G0~G6 통과를 대신하지 않는다.

| 문서 | 판정 질문 | 서로 대신할 수 없는 결과 |
| --- | --- | --- |
| 이 문서 | 어떤 업무 결과와 KPI를 검증하는가 | 비즈니스 유즈케이스와 중단조건 |
| PoC 후보 목록 | 어떤 자산·경로가 반복시험 가능한가 | G0~G6 후보 판정과 Dataset Passport |
| 실증 로드맵 | 어떤 순서로 종단 수명주기를 검증하는가 | 단계별 진입·종료 Gate와 운영 전환 증거 |

## 7. 검증과 승인 기록

유즈케이스 결과에는 후보 자산 동결본, 참가·권리 판정, Agreement·Transfer 또는 공개 접근 근거, 업무 결과, KPI 원시 사건과 cleanup 증거를 연결한다.

사람 검수는 다음을 확인한다.

1. 정산 입력에 원시 교통카드·개인·가명정보가 없음
2. 검색 Dataset 수와 구독 건의 분모가 분리됨
3. 조직 설립·프레임 채택·문서 작성 건수가 KPI에 없음
4. DEF-05 payload와 DEF-06 수치가 승인 없이 확정되지 않음
5. 중단조건 발생 건이 성공 KPI에 포함되지 않음
