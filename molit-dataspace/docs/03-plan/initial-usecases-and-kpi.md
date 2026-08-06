# 초기 유즈케이스·KPI

작성일: 2026-08-01  
개정일: 2026-08-03  
작성 기준: 설계 인터뷰 D-13·20·DEF-06, 확정 결정 `E-16`·`E-17`·`E-19`·`E-20`  
상태: Draft

## 1. 목적과 경계

이 문서는 초기 출범 유즈케이스 한 건과 확장 단계 유즈케이스 한 건의 업무 결과, 성과지표(Key Performance Indicator, KPI)와 중단조건을 정의한다. 기술 후보의 준비도와 Full Offering 인정은 적용 경로의 PoC Gate에서 별도로 판정한다.

- 초기 출범 유즈케이스: 준공영제 정산 — 승인 운수사의 Provider Data Plane을 경유하는 PULL 경로 검증
- 확장 단계 유즈케이스: 교통 공공데이터 연합 검색·구독 — Platform Bridge와 기본 등급 경로 검증
- 수치 목표: DEF-06으로 미결정
- 제외 지표: 조직 설립 건수, 프레임 채택 건수, 문서 작성 건수

데이터 스페이스는 신원·Catalog·계약·정책·감사를 담당하며 payload를 보관하거나 중계하지 않는다. Provider Data Plane은 참가자(Provider)의 전송 경계이며 데이터 스페이스 공통 서비스가 아니다.

실제 바이트는 Provider Data Plane이 source binding으로 원천에서 읽어 Consumer에게 응답한다.

- **(Decision, `E-17`)** 초기 출범을 **허브 섭외에 종속시키지 않는다.** `E-11`은 **유지하되 초기 범위에서 제외하고 확장 단계로 옮긴다**
- **(Decision, `E-20`)** 제출 이행은 **계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료**의 세 조건이 모두 충족된 때 성립한다
- **(Decision, `E-21`)** payload 전송은 **Provider Data Plane 경유로 단일화**한다. 원천 직접 방식(Consumer가 원천 token·signed URL로 원천에 직접 접근)은 채택하지 않는다

### 1.1 초기 출범 최소 조합

- **(Inferred)** 최소 조합은 파일럿 지자체 또는 정산주체 1곳 + 참여 운수사 1곳 이상 + 데이터 스페이스 계약·신원·연계·감사 구성요소다.
  - **(근거)** [기존 플랫폼 섭외 가능성 조사 §2.2](../01-research/hub-recruitment-feasibility.md#22-최소-필요-구성)의 필요 허브 0곳 판정과 최소 필요 구성, 확인일 2026-08-03
- **(Decision)** TAGO·NTIC·K-MaaS·통합채널·공공데이터포털·NDI·오픈마켓은 필수 경유지가 아니라 선택이다.
- **(Decision)** 준공영제 정산은 **승인 운수사의 Provider Data Plane → 지자체·정산주체 PULL 경로**로 채택한다.

착수·완료 원칙은 [분야 구성 연구 §5.2·§7](../01-research/dataspace-topology-single-vs-sectoral.md#52-착수-순서)과 [기획보고서 기술 검토 T-27](../01-research/planning-report-technical-review.md#t-27-시스템-수문서-작성-여부-중심의-완료-기준)을 링크해 사용한다. 이 문서에서 해당 원칙을 다시 정의하지 않는다.

## 2. 공통 진입 Gate

| Gate | 판정 입력 | 통과 증거 | 실패 상태 |
| --- | --- | --- | --- |
| 자산 | Dataset Passport, source·version, Provider 권한 | 자산별 승인 판정 ID | `excluded` 또는 `pending` |
| 참가 경로 | 기본 또는 상위 등급, credential, 경로 binding | 유효한 참가·재평가 판정 | `BLOCKED` |
| 계약·정책 | 목적·수신자·기간, license·법적 근거 | 승인 Offer·Agreement와 정책 판정 | 협상·Provider Data Plane 접근 차단 |
| 제출 이행 | 계약 체결, 수신 가능 상태, 기술적 온보딩 완료 | 세 조건의 충족 상태와 감사 기록 | 제출 이행 불성립 |
| 전송·source binding 회수 | source binding, 승인된 PULL 방식, token·구독 회수 | Provider Data Plane 경유 종단시험·cleanup 증거; 확장 단계는 G0~G6 추가 | Provider Data Plane 접근 또는 Full Offering 불인정 |
| 측정 | KPI 사건·시각·분모와 test run ID | 재현 가능한 집계 query | KPI 집계 제외 |

첫 출시의 데이터 등급 상한과 자산별 판정은 [실증 로드맵 §2.1](pilot-and-roadmap.md#21-첫-출시-등급-상한)을 따른다.

제출 이행 Gate의 기술적 온보딩 판정 기준·증거, 판정 주체와 기계 판독 표현은 `DRV-01`~`DRV-03`의 미결이다. 이 문서에서 값을 정하지 않는다.

## 3. 준공영제 정산 유즈케이스

### 3.1 가치·업무 경계

Provider는 기관의 지위가 아니라 계약별 기능이다.

- **(Decision, `E-16`)** 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다
- **(Decision, `E-19`)** 기존 정산 시스템(회계처리·버스경영관리시스템)은 **Consumer로 온보딩**한다. 계약을 맺고 운수사 원천에서 당겨온다
- **(해석 경계)** `E-19`의 “운수사 원천에서 당겨온다”는 업무 층위 서술이며 Consumer에게 원천 접근권을 부여한다는 뜻이 아니다. Consumer는 계약 범위에서 Provider Data Plane에 접근하고, Data Plane이 source binding으로 운수사 원천에서 읽어 응답한다.

| 항목 | 정의 |
| --- | --- |
| 수혜자 | 정산 명세를 원천에서 제공 가능한 상태로 만드는 승인 운수사와 Provider Data Plane을 경유해 PULL·대사하는 지자체·정산주체 |
| Provider 기능 | 해당 계약의 승인 운수사가 Offering을 게시하고 정산 명세와 로컬 증적을 원천에서 제공 가능한 상태로 유지 |
| Consumer 기능 | 지자체·정산주체와 기존 정산 시스템이 Consumer로 참여해 계약 범위의 정산 명세를 Provider Data Plane에서 PULL |
| 교환 단위 | 분야 DSGA가 승인할 정산 명세 version과 공통 감사 ID |
| 결과 | 계약 체결·수신 가능·기술적 온보딩 상태와 Offering 게시·PULL·대사·보완·회수 증거 |
| 등급 경로 | 의무 거래에 적용할 상위 등급 경로 후보 |

정산 유즈케이스 대상은 정산 명세 수준, pilot:36의 원시 교통카드 제외 유지.

원시 승하차 record, 개인·가명 식별값과 결제수단 원문은 첫 실증 자산에 포함하지 않는다. payload 필드는 DEF-05의 실물 조사와 분야 DSGA 승인 전에는 확정하지 않는다.

### 3.2 실행 흐름과 완료조건

1. 운수사 원천 경로·자산 권한·정산 명세 version과 계약별 Provider 기능을 승인한다.
2. 운수사는 정산 명세, 로컬 증적과 공통 감사 ID를 원천에서 제공 가능한 상태로 만들고 Offering을 게시한다.
3. 지자체·정산주체와 기존 정산 시스템을 Consumer로 온보딩하고 계약의 목적·수신자·기간을 고정한다.
4. Connector가 승인한 PULL 전송 사건을 Provider transfer worker가 받아 원천 플랫폼 token 또는 signed URL을 발급하고, 발급 결과를 Connector를 거쳐 Provider Data Plane의 source binding으로 설정한다.
5. Consumer는 계약 범위에서 Provider Data Plane에 PULL로 접근하고, Data Plane은 source binding으로 운수사 원천에서 읽어 응답한다. Consumer는 수신한 바이트를 감사 ID와 연결하고 명세를 대사한다.
6. Consumer는 불일치를 상태·사유·보완 요청과 연결한다.
7. 운수사는 보완한 명세를 원천에서 다시 제공 가능한 상태로 만들고 Consumer는 같은 업무 건에서 다시 PULL한다.
8. 계약 종료 뒤 원천 접근 token·임시자원을 회수하고 보존·개봉 사건을 기록한다.

Provider transfer worker는 EDC Data Plane이나 DSP endpoint가 아니다. 데이터 스페이스는 위 흐름의 payload를 보관하거나 중계하지 않는다.

유즈케이스 성공 판정에는 `E-20`의 세 조건이 모두 충족되고 Offering 게시·Provider Data Plane 경유 PULL·대사·불일치 처리·회수 사건이 같은 test run ID로 연결된 증거가 필요하다. 기술적 온보딩 완료의 기준·증거·판정 주체와 기계 판독 표현은 `DRV-01`~`DRV-03`의 미결이므로 이 문서에서 확정하지 않는다.

ADR-0006이 `Proposed`인 동안 중앙 notary의 실제 운영 의무를 완료조건으로 승격하지 않는다.

### 3.3 중단조건

- **(Decision, `T-04`)** 정산 원자료에 교통카드·개인·결제 데이터가 다시 포함되면 권리·샌드박스 경로를 재판정해야 한다.
  - **(근거)** [기존 플랫폼 섭외 가능성 조사 §4.3](../01-research/hub-recruitment-feasibility.md#43-초기-유즈케이스의-재판정-조건), 확인일 2026-08-03
- 정산 명세의 source·version·Provider 권한을 확인할 수 없음
- 참가 상위 등급 또는 계약의 목적·수신자·기간 판정이 만료·철회됨
- 거래유형의 증적 근거가 미확인인데 중앙 notary 의무로 승격됨
- Offering 게시·Provider Data Plane 경유 PULL·대사·개봉·회수 사건을 공통 감사 ID와 test run ID로 연결할 수 없음

## 4. 확장 단계 교통 공공데이터 연합 검색·구독 유즈케이스

### 4.1 가치·업무 경계

| 항목 | 정의 |
| --- | --- |
| 수혜자 | 여러 공공 원천의 Dataset을 한 검색 경로에서 찾고 승인 접근을 구독하는 기관·사업자 |
| Provider 기능 | 원 보유기관 또는 포괄 위임이 문서로 확인된 Participant가 metadata와 승인 Distribution을 게시 |
| Consumer 기능 | 검색 결과에서 Offer를 선택하고, 계약 기반이면 Provider Data Plane에서 PULL, 계약 없이 공개 접근 근거로만 이용하면 기존 공개 경로를 사용 |
| 교환 단위 | 공개 Dataset metadata, 기존 license, Distribution·DataService와 source binding |
| 결과 | 연합 검색 결과, Agreement 또는 공개 접근 경로, 구독·변경·해지 사건 |
| 등급 경로 | 공개·등록형 공개의 기본 등급 경로 |

기존 공개 URL과 license를 유지한다. 연합 검색 record만 있는 자산을 거래 가능한 Offering이나 payload 구독으로 판정하지 않는다.

### 4.2 실행 흐름과 완료조건

1. 원천 Dataset·Publisher·Provider 권한과 공개 license를 판정한다.
2. metadata를 canonical graph로 변환하고 source·Distribution·DataService를 구분한다.
3. 자격과 visibility에 맞는 연합 검색 결과를 제공한다.
4. Consumer는 Offering 적격 자산에 대해서만 계약 또는 공개 접근 근거와 구독 상태를 만든다.
5. 계약 기반 자산은 Consumer가 계약 범위에서 Provider Data Plane에 PULL로 접근하고, Data Plane이 source binding으로 원천에서 읽어 응답한다.
   - **(적용 범위 — `E-21`)** 데이터 스페이스 계약에 따른 payload 전송에 적용한다.
   - **(공개 접근 예외)** 계약 없이 공개 접근 근거로만 이용하는 자산은 기존 공개 경로를 유지할 수 있다.
     - **(근거)** [ADR-0002 §3.3](../adr/0002-data-stays-at-source.md)은 필요한 자산에만 Data Plane을 추가하고 공개 데이터의 direct access 유지를 허용한다.
   - **(경계 유지 근거)** 제출 이행 판정(`E-20`)은 계약 기반 전송에만 적용되므로 감사 증거가 필요한 영역은 전부 Data Plane 경유로 남는다.
6. Provider 기능 수행 주체는 원천 변경·삭제를 구독 통지와 Catalog 상태에 반영한다.
7. Consumer와 Provider 기능 수행 주체는 해지·철회 뒤 token·subscription·임시자원을 회수하고 reconciliation을 수행한다.

확장 단계 완료조건은 연합 검색 Dataset과 실제 구독 건을 별도 분모로 집계하고, 각 구독에 source·권리·Provider Data Plane 경유 PULL·변경·해지 증거가 연결되는 것이다.

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
| 검증 소요시간 | `E-20` 세 조건 충족 뒤 Consumer의 첫 Provider Data Plane PULL 시작부터 대사 결과 확정까지의 경과시간; 중단·재PULL은 별도 구간 | 계약·수신 가능·기술적 온보딩·PULL·대사·결정 시각과 test run ID | DEF-06 미정 |
| 불일치 발견 건수 | 승인 명세 규칙 또는 당사자 대사에서 확인된 고유 불일치 업무 건 | 규칙 ID·양측 상태·보완 결과 | DEF-06 미정 |
| 참가 운수사 수 | `E-20` 세 조건과 Provider Data Plane 경유 PULL·대사·회수를 같은 test run에서 완료한 고유 운수사 | 참가 판정·Agreement·PULL·대사·회수 증거 | DEF-06 미정 |
| 온보딩 완료율 | 참가자 수준의 “기술적 온보딩 완료” 비율; 판정 기준·분자·분모는 `DRV-01`·`DRV-03`·`DRV-04`에서 미정 | 판정 증거와 집계 방법이 미정이므로 현재값 산정 불가 | 목표치 미정 |

### 5.2 확장 단계 공공데이터 연합 검색·구독

| KPI | 정의·분모 | 증거 | 수치 상태 |
| --- | --- | --- | --- |
| 연합 검색 Dataset 수 | source와 Provider 권한을 확인하고 검색 가능한 고유 Dataset | Dataset Passport·Catalog snapshot·source diff | DEF-06 미정 |
| 구독 건수 | Offering 적격 자산에서 생성·변경·해지를 추적할 수 있는 고유 구독 | Agreement 또는 공개 접근 근거·subscription·cleanup | DEF-06 미정 |

수치 목표와 기준기간은 실증 착수 때 DEF-06 변경 기록으로 승인한다. 기준선 없이 임의 목표를 기입하지 않는다.

## 6. PoC 후보 문서와의 경계

[PoC 후보 목록](poc-candidate-shortlist.md)은 자산·권리·source·수명주기의 기술 준비도를 검토하기 위한 `Draft` 참고자료다. 이 문서의 유즈케이스 채택은 후보 자산의 G0~G6 통과를 대신하지 않는다.

**(참조 판정 근거: C2-01)** 대상 문서가 `Draft` 상태이므로 정본으로 선택하거나 승격하지 않고 후보 기술 준비도 검토의 참고자료로만 사용한다.

| 문서 | 판정 질문 | 서로 대신할 수 없는 결과 |
| --- | --- | --- |
| 이 문서 | 어떤 업무 결과와 KPI를 검증하는가 | 비즈니스 유즈케이스와 중단조건 |
| PoC 후보 목록 | 어떤 자산·경로가 반복시험 가능한가 | G0~G6 후보 판정과 Dataset Passport |
| 실증 로드맵 | 어떤 순서로 종단 수명주기를 검증하는가 | 단계별 진입·종료 Gate와 운영 전환 증거 |

### 6.1 A-04 재분류

- **(후보 성격)** `poc-candidate-shortlist.md`의 후보 6개는 전부 기존 공개 플랫폼을 감싸 Platform Bridge를 검증하는 후보다.
- **(경유 구분)** 후보 1·2는 국토교통 데이터 통합 채널을 경유한다. 후보 3~6은 국가교통정보센터·통계누리·VWorld 같은 원천 플랫폼에 직접 붙는다.
  - **(근거)** 후보 목록은 후보 3을 "통합 채널의 broker 기능을 증명하지는 않지만 Platform Bridge의 file path를 검증한다"고 규정한다.
- **(현재 상태)** 우선순위 1은 "대상 미식별·운영기관 증거 대기" 상태다.
- **(초기 출범 구도)** 준공영제 정산은 승인 운수사가 Provider 기능을 수행하고 지자체·정산주체와 기존 정산 시스템이 Consumer로 참여하는 Provider Data Plane 경유 PULL 경로다.
- **(판정)** 초기 출범은 기존 공개 플랫폼을 감싸는 Platform Bridge를 필요로 하지 않는다. `E-17`이 정한 초기 범위와 일치한다.

`A-04`는 **초기 출범을 막는 차단이 아니라 확장 단계 준비를 막는 차단**으로 재분류한다. 후보 선택은 **기존 공개 플랫폼 연계 착수 시점**으로 이연한다.
2026-08-06 결정으로 우선 후보는 후보 3(ITS 표준 노드·링크 파일 snapshot)으로 지정하되, 착수와 확정 기록은 연계 착수 시점의 G0~G6 통과를 조건으로 유지한다.

- **(상태)** 후보 6개와 우선순위 1의 문서상 상태는 `Verified`, `E-17` 적용과 `A-04` 재분류·이연은 `Decision`, 우선 후보는 후보 3으로 지정(`Decision`, 2026-08-06)하며 착수 전 G0~G6 판정은 `Unverified`
- **(근거)** [PoC 후보 목록](poc-candidate-shortlist.md), [내부 일관성 감사 §4의 A-04](../01-research/internal-consistency-audit-2026-08.md#4-a축-미등록-미결), 확인일 2026-08-03

## 7. 검증과 승인 기록

초기 출범 결과에는 Provider Data Plane 경유 경로의 자산 동결본, 참가·권리 판정, Agreement·승인된 PULL, Consumer의 Provider Data Plane 접근과 source binding 작동 증거를 연결한다.

업무 결과, KPI 원시 사건과 cleanup 증거도 같은 결과에 연결한다. Platform Bridge 후보 동결본과 G0~G6 판정은 확장 단계 결과에만 추가한다.

사람 검수는 다음을 확인한다.

1. 정산 원자료에 교통카드·개인·결제 데이터가 다시 포함되면 `T-04` 재판정이 시작됨
2. 운수사가 Offering을 게시하고 Consumer가 Provider Data Plane에서 실제 바이트를 PULL하며 Data Plane이 source binding으로 운수사 원천에서 읽어 응답함
3. 지자체·정산주체와 기존 정산 시스템이 Consumer로 온보딩됨
4. `E-20` 세 조건의 미충족 건이 유즈케이스 성공으로 집계되지 않음
5. 온보딩 완료율의 목표치·분모·판정 기준이 승인 없이 확정되지 않음
6. 검색 Dataset 수와 구독 건의 분모가 분리됨
7. 조직 설립·프레임 채택·문서 작성 건수가 KPI에 없음
8. DEF-05 payload와 DEF-06 수치가 승인 없이 확정되지 않음
9. 중단조건 발생 건이 성공 KPI에 포함되지 않음
10. `A-04` 후보 미선택이 초기 출범 차단으로 집계되지 않음

## 8. 미확인 사항과 결정 요청

| ID | 파생 ID | 상태 | 미확인 사항 또는 결정 요청 | 영향 | 담당 | 기한 | 종료 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN-IUK-01` | `DRV-01` | `Unverified` | "기술적 온보딩 완료"의 판정 기준과 증거. 참가자 수준 종단시험 절차가 필요 | `E-20`의 세 번째 조건과 온보딩 완료율 판정 불가 | 미정 | 미정 | 판정 기준·증거와 참가자 수준 종단시험 절차 승인 |
| `OPEN-IUK-02` | `DRV-02` | `Unverified` | 완료 판정 주체 — 운영자·정산주체·제3자 중 미정 | 제출 이행과 유즈케이스 성공의 승인 주체 판정 불가 | 미정 | 미정 | 판정 주체 승인 |
| `OPEN-IUK-03` | `DRV-03` | `Unverified` | 세 조건의 충족 상태를 기계 판독 가능하게 표현하고 감사 기록으로 남기는 방법 | 자동 판정·KPI 집계·사후 감사 방법 미정 | 미정 | 미정 | 상태 표현·감사 기록 방법과 검증 절차 승인 |
| `OPEN-IUK-04` | `DRV-04` | `Unverified` | 온보딩 미완료 참가자는 DS 경유 이행이 성립하지 않으므로 **기존 경로 병행이 필수**. 전환 일정(`E-15`)은 온보딩 완료율에 종속 | 전환 시점과 기존 경로 종료조건 판정 불가 | 미정 | 미정 | 완료율 분모·임계값·증거와 기존 경로 종료조건 승인 |
| `OPEN-IUK-05` | `A-04` | `Decision` | 우선 후보를 후보 3(ITS 표준 노드·링크 파일 snapshot)으로 지정(2026-08-06). 착수·확정은 기존 공개 플랫폼 연계 착수 시점의 G0~G6 통과 조건 | 초기 출범은 차단하지 않고 확장 단계 준비를 차단 | 프로젝트 의뢰자 | 확장 단계 착수 시 | 착수 시 후보 3의 G0~G6 판정과 확정 기록 기입 |
| `OPEN-IUK-06` | `DEF-05` | `Unverified` | 정산 payload 필드와 첫 실증 자산 범위 미확정. 범주 골격은 2026-08-06 승인 | 정산 명세의 필드 수준 계약시험 판정 불가 | 분야 DSGA(KAIA 잠정) | 미정 | 리서치·실물 조사(우선 후보 청주, 잠정)로 필드 확정 후 payload 범위 승인 |
| `OPEN-IUK-07` | `DEF-06` | `Unverified` | KPI 수치 목표와 기준기간 미결정. 측정 설계는 2026-08-06 승인 | 목표 대비 성과 판정 불가 | 분야 DSGA(KAIA 잠정) | 미정 | 기준선 측정 우선, 수치 목표는 리서치·실증 착수 후 변경 기록으로 승인 |

여기서 DS 경유 이행은 데이터 스페이스의 신원·Catalog·계약·정책·감사 절차를 뜻한다. payload는 Consumer가 Provider Data Plane에서 PULL하고, Data Plane이 source binding으로 운수사 원천에서 읽어 응답한다.

## 9. 개정 이력

| 개정일 | 종전 상태 | 개정 내용 | 근거 결정 |
| --- | --- | --- | --- |
| 2026-08-01 | 첫 실증 유즈케이스 두 건과 운수사 송신·정산주체 조회 중심 흐름 | 최초 문서 작성 | 설계 인터뷰 D-13·20·DEF-06 |
| 2026-08-03 | PoC 후보 목록을 기술 준비도 판정 정본으로 서술 | `Draft` 참고자료로 완화하고 C2-01 참조 판정 근거 추가 | C2-01 |
| 2026-08-03 | 초기 출범과 확장 단계의 경계 없음 | §1의 `E-17` 결정문, 허브 0곳 최소 조합과 선택 경유지 반영 | `E-17` |
| 2026-08-03 | 운수사 송신·정산주체 조회 중심 흐름 | §3.1의 `E-16`·`E-19` 결정문과 원천 직접 PULL 흐름 반영 | `E-16`, `E-19` |
| 2026-08-03 | 제출 이행의 성공조건과 온보딩 KPI 없음 | §1의 `E-20` 결정문, 온보딩 완료율 KPI와 `DRV-01`~`DRV-04` 등록 | `E-20` |
| 2026-08-03 | 민감 원자료 재포함 트리거와 A-04 단계 구분 없음 | 권리·샌드박스 경로 재판정 트리거와 확장 단계 준비 차단 재분류 | `T-04`, `A-04` |
| 2026-08-04 | `E-16`·`E-19` 적용 때 Consumer의 원천 직접 PULL 서술을 잘못 추가 | Consumer가 Provider Data Plane에서 PULL하고 Data Plane이 source binding으로 원천에서 읽어 응답하도록 정정 | `E-21` |
