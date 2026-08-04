# 참가자 온보딩·보증 설계

작성일: 2026-08-01  
최종 개정일: 2026-08-03  
작성 기준: 설계 인터뷰 D-03~07·DEF-04·07  
개정 기준: 확정 결정 E-12·E-15·E-16·E-20  
상태: Draft

## 1. 목적과 범위

이 문서는 참가 조직이 아니라 데이터 경로에 참가 등급을 부여하는 기준을 정한다. 복수 온보딩 경로, 관리형·자체 운영 Connector 방식과 위임 책임의 경계도 정한다. 재승인 상태 전이, 관리 신원 구현과 DCP 검증 증거는 기존 정본을 참조한다.

- 결정 범위: D-03 참가 등급, D-04 경로 판정, D-05 강등 연결, D-06 책임 분할, D-07 인증 경계, E-12·E-15·E-16·E-20·E-21 반영
- 제외 범위: DEF-04 운영 증거 확정, 재평가 주기 수치, `DRV-01`·`DRV-02`·`DRV-04` 확정
- D-03~07 완료 증거: 경로 판정 기록, 운영자 통제 증거, 참가자 적법성 증거, 경계 위반 차단 시험

## 2. 경로 기반 참가 등급

### 2.1 현재 설계의 공백

- **(Inferred)** 현행 문서의 두 경로인 관리형 CaaS와 자체 운영은 수기 장부·외부기장·미연계 ERP 참가자를 어느 쪽에도 담지 못한다.
  - **(근거)** 관리형 커넥터(Connector)만 제공하고 참가자가 직접 Offering을 게시하게 하는 구조의 공백과 현행 3절의 두 운영 방식을 대조함
  - **(출처)** [저기술 참가자 온보딩 선례 조사 §5.2](../01-research/low-tech-onboarding-precedents.md#52-적용-경계)
- **(Inferred)** 저기술 참가자 공백은 원자료 보유가 아니라 Offering 게시 역량에서 발생한다.
  - **(근거)** 관리형 경로도 원자료 판독, 규격변환, 게시 승인과 최종확인을 맡을 주체가 없으면 제공 가능한 상태를 만들 수 없음
- **(Unverified)** 전국 데이터 없음 — 판정 불가
  - **(미확인)** 전국 대표 자체기장·외부기장·조합대행 비중
  - **(출처)** [저기술 참가자 온보딩 선례 조사 §6.1](../01-research/low-tech-onboarding-precedents.md#61-전국-판정)
- **(판정 경고)** ERP 사용률을 자력 Offering 게시 가능률로, 외부기장을 규격변환 책임 이전으로 해석해서는 안 된다
  - **(외부 근거)** [인천광역시 공통 ERP 구축](https://press.incheon.go.kr/citynet/jsp/sap/SAPNewsBizProcess.do?command=searchDetailSvp&flag=&matOfYmd=20191201&matSno=13&sido=&viFlag=in), [경기도 통합 ERP 추진](https://gnews.gg.go.kr/briefing/brief_gongbo_view.do?BS_CODE=S017&number=61712) (확인일: 2026-08-02)

### 2.2 복수 경로와 국내 선례

화물운송실적신고시스템(FPIS)은 조사 범위에서 대행 허용과 책임 유지를 함께 규정한 국내 법적 선례로 판단한다. 상태는 `Inferred`다.

- **(Decision · E-12)** 온보딩은 **복수 경로**로 하고 위임을 허용하되 **FPIS식 3분할 책임**을 적용한다. 참가자·원천시스템은 사실·증빙 책임, 대행자는 변환·전송·인증·로그 책임, 운영자는 접속·보안 책임을 진다

- **(Inferred)** 국내 의무화 지원 선례는 다음 패턴을 함께 사용함
  - **(제한)** 확인 사례의 조합이며 각 채널을 이 설계의 구현값으로 모두 채택한다는 뜻이 아님

| 지원 패턴 | 상태 | 확인 범위 | 적용 한계 |
| --- | --- | --- | --- |
| 단계적 대상 확대 | `Verified` | 전자세금계산서 대상 기준 하향, FPIS 대상·단위 조정 | 제도별 일정과 대상이 다름 |
| 무료 공공 최소수단 | `Verified` | 홈택스·손택스, ARS, 세무서 대리발급 | 민간 대행자의 무료 서비스를 뜻하지 않음 |
| 웹·ARS·엑셀·API·방문·대행 복수 경로 | `Inferred` | 여러 제도의 채널을 교차 비교 | 한 제도가 경로 전부를 제공한다는 뜻이 아님 |
| 비용지원·세액공제 | `Verified` | 전자세금계산서·현금영수증 세액공제 | 대행비 전액 보전으로 해석할 수 없음 |
| 정정기간·유예 | `Verified` | FPIS 수정기간, 전자세금계산서 시행 유예, 현금영수증 자진정정 | 제도별 기한이 다름 |
| 최영세층 예외 | `Verified` | FPIS 1대 운송사업자, 하도급지킴이 소액·단기공사 예외 | 데이터 스페이스 예외기준은 별도 결정 필요 |

- **(출처)** 패턴 판정과 제한은 [저기술 참가자 온보딩 선례 조사 §5.1](../01-research/low-tech-onboarding-precedents.md#51-교차-사례)을 따름
- **(외부 근거)** [국세청 의무대상](https://s.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7787&mi=2461), [발급방법 및 절차](https://j.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7788&mi=2462), [혜택·가산세](https://i.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7790&mi=2464) (확인일: 2026-08-02)
- **(외부 근거)** [현금영수증 20년 성과·2026 확대](https://d.nts.go.kr/yeosu/na/ntt/selectNttInfo.do?bbsId=1028&mi=2201&nttSn=1351766), [전자세금계산서 전송 관련 세법개정](https://www.korea.kr/news/policyNewsView.do?newsId=148724425) (확인일: 2026-08-02)
- **(외부 근거)** [FPIS 신고안내](https://fpis.go.kr/mobile/info/mobileInfo1_View.do), [2015년 제도개선](https://www.molit.go.kr/USR/I0204/m_45/dtl.jsp?idx=13862), [2016년 1대 운송사업자 제외 안내](https://www.fpis.go.kr/html/notice2016-1.jsp) (확인일: 2026-08-02)
- **(외부 근거)** [조달청 하도급지킴이 안내](https://pps.go.kr/kor/content.do?key=01178), [전라남도 버스경영수지분석 성과](https://www.jeonnam.go.kr/M7116/boardView.do?displayHeader=&infoReturn=&menuId=jeonnam0202000000&pageIndex=56&searchText=&searchType=&seq=1935341) (확인일: 2026-08-02)
- **(Unverified)** 처음부터 API나 자체 시스템만을 요구한 사례는 찾지 못했다.
  - **(조건)** 조사 범위 밖 제도의 존재 여부는 판정 불가

- **(Verified)** FPIS는 월별 직접입력·지정 엑셀 일괄입력·자체 시스템 DB 연계·신고대행과 정정기간을 둠
- **(Verified)** 화물운송실적신고제 시행지침은 대행 가능 주체를 열거하고 일부 대행자의 범위를 자기 망 실적으로 제한함
- **(Verified)** FPIS가 실제로 규정하는 책임은 대행기관의 확인 의무와 신고자의 최종책임임
- **(제한)** FPIS 3분할은 세 기능 블록이며 대행기관을 세 종류로 나눈다는 뜻이 아님
- **(Unverified)** 신고대행 건수·수수료·부담주체·오류 통계는 문서 미확인
- **(구분)** 4주체 책임분할은 FPIS 규정 자체가 아니라 4절에서 채택한 `Decision`임
- **(출처)** [저기술 참가자 온보딩 선례 조사 §4](../01-research/low-tech-onboarding-precedents.md#4-화물운송실적신고-선례)
- **(외부 근거)** [FPIS 신고안내](https://fpis.go.kr/mobile/info/mobileInfo1_View.do), [화물운송실적신고제 시행지침 제3조](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000105630) (확인일: 2026-08-02)

### 2.3 Offering 게시와 Connector 경계

- **(Decision)** 원천 플랫폼은 system of record로 유지하며 데이터 스페이스(DS)는 payload를 보관하거나 중계하지 않음
  - **(근거)** [ADR-0002](../adr/0002-data-stays-at-source.md), [EDC·CaaS·DSaaS 아키텍처 §6](edc-caas-dsaas-architecture.md#6-offering-게시와-전송)
- **(Decision · E-21)** payload 전송은 **Provider Data Plane 경유로 단일화**한다. 원천 직접 방식(Consumer가 원천 token·signed URL로 원천에 직접 접근)은 채택하지 않는다
- **(Decision)** 참가자가 Offering을 게시하려면 Connector가 필요함
  - **(동작)** Connector는 메타데이터·정책·계약 정의를 Control Plane에 등록함
  - **(경계)** 원천 endpoint·credential은 private source binding과 Secret Store에 두고 DSP message의 `dataAddress`와 구분함
  - **(전송 경계)** Consumer는 계약 범위에서 Provider Data Plane에 PULL로 접근하고, Provider Data Plane이 source binding으로 원천에서 읽어 응답함
  - **(책임 경계)** Provider Data Plane은 참가자(Provider) 측 전송 경계이며 데이터 스페이스 공통 서비스가 아님
- **(Decision)** Provider transfer worker는 Connector가 이미 승인한 PULL 전송 사건을 받아 원천 플랫폼 token이나 signed URL을 발급함
  - **(source binding)** 발급 결과는 Connector를 거쳐 Provider Data Plane의 source binding이 되며 Consumer에게 제공하지 않음
  - **(경계)** 이 worker는 EDC Data Plane이나 DSP endpoint가 아님
- **(Decision · E-21 · 정정 기록)** 2026-08-03에 잘못 추가된 Consumer의 원천 직접 접근 서술을 Provider Data Plane 경유 PULL로 정정함

| 온보딩 경로 | 적용 대상 | Offering 게시를 위한 기술 수행 | 남는 책임 |
| --- | --- | --- | --- |
| 관리형 CaaS | Connector를 직접 운영하지 않는 참가자 | 관리형 운영자가 Connector 운영 통제를 제공 | 참가자가 사실·증빙·정책과 최종확인을 담당 |
| 자체 운영 | 자체 Connector와 운영 증거를 갖춘 참가자 | 참가자가 Connector와 게시 절차를 운영 | 참가자가 사실·증빙과 기술·운영 통제를 담당 |
| 위임·대행 | 수기 장부·외부기장·미연계 ERP 참가자 | 위임받은 대행자가 변환·전송·인증·처리로그를 맡고 Connector 경로를 통해 Offering을 게시 | 참가자·원천시스템이 사실·증빙과 최종확인을 담당 |

관리형 CaaS와 대행 구조의 목적은 참가자의 Offering 게시 지원이다. 원천 payload 인수는 범위에서 제외한다.

- **(Decision)** 상세 채널 조합·대행자 자격·비용·배상은 [조사 보고서의 `OPEN-LOW-11`·`OPEN-LOW-12`](../01-research/low-tech-onboarding-precedents.md#7-미확인-사항과-결정-요청) 종료 전까지 확정하지 않음

### 2.4 제출 이행과 기술적 온보딩

- **(Decision · E-20)** 제출 이행은 **계약 체결 + 수신 가능 상태 + 기술적 온보딩 완료**의 세 조건이 모두 충족된 때 성립한다
- **(Decision · E-20 파생)** 기술적 온보딩 완료는 편의 절차가 아니라 법적 이행의 전제조건임
- **(Unverified)** 현행 법령에서 E-20과 동일한 세 조건의 자동 간주 조문은 문서 미확인
  - **(출처)** [의무화·간주 규정 선례 조사](../01-research/mandate-and-deeming-precedents.md)
- **(Decision)** 수신 가능 상태는 데이터 스페이스의 payload 수신을 뜻하지 않음
  - **(경계)** 계약된 Consumer가 Provider Data Plane에 PULL로 접근할 수 있어야 함
- **(Unverified)** 기술적 온보딩 완료의 구체 판정 기준과 증거는 `DRV-01`로 남김

### 2.5 등급 판정 단위

등급 부여 대상은 조직 전체가 아니라 Offering의 전송·분석 경로다. 한 참가기관이 기본 경로와 상위 경로를 함께 운영하면 각 경로를 독립적으로 심사하고 판정 ID를 분리한다.

| 등급 | 적용 경로 | 판정 입력 | 허용 조건 | 실패 상태 |
| --- | --- | --- | --- | --- |
| 기본 참가 | 공개·등록형 공개 자산 경로 | 기관 등록, 비즈니스 적격성, 담당자 지정, 이용규칙 서약 | 선택한 경로의 기술 Gate와 Provider 권한 판정 통과 | `PENDING_EVIDENCE` 또는 `BLOCKED` |
| 상위 등급 | 의무 거래·기관 제한·민감 데이터 경로 | 기본 참가 증거, 경로 통제 증거, 강화된 자격·감사 증거 | 자산 등급별 Gate와 상위 등급 credential 검증 통과 | 기본 경로로 강등하거나 해당 Offering 제외 |

상위 등급은 참가기관의 모든 데이터에 대한 포괄 승인이 아니다. 자산과 경로가 바뀌면 기존 등급을 재사용하지 않고 새 판정 입력을 만든다.

## 3. 경로 판정

이 절의 두 열은 전체 온보딩 경로가 아니라 Offering 게시 단계의 Connector 운영 방식이다. 위임·대행 입력은 계약별로 정한 관리형 CaaS 또는 자체 운영 Connector 경로로 이어진다.

기술 허들을 관리형 서비스가 흡수하더라도 참가자의 데이터 내용 책임과 계정·정책 책임은 이전되지 않는다. 데이터 등급별 전송·분석 Gate는 [보안·신뢰·운영 설계 §3](security-trust-and-operations.md#3-데이터-등급과-경로)를 따른다.

| 판정 축 | 관리형 CaaS 경로 | 자체 운영 경로 |
| --- | --- | --- |
| 기술·운영 통제 | 승인된 운영자 통제와 제3자 감사 증거를 경로에 상속 | 참가자가 동일 범위의 통제 설계·운영·시험 증거를 제출 |
| 최소 조직 요건 | 책임 담당자 지정, 회원규칙 서약, 계정·정책 관리자 지정 | 관리형 경로 요건과 자체 운영 책임자·비상연락·변경관리 증거 |
| 판정 단위 | 운영자 통제 버전과 참가자 경로 binding | 참가자 배포 경계와 경로별 통제 버전 |
| 변경 처리 | 운영자 통제 버전 또는 경로 binding 변경 시 재평가 | 배포·네트워크·identity·정책 경계 변경 시 재평가 |
| 실패 처리 | 상속 증거가 없거나 만료되면 상위 등급 사용 차단 | 필수 통제 증거가 하나라도 없으면 상위 등급 사용 차단 |

## 4. 운영자와 참가자 책임

### 4.1 기본 사례의 4주체 책임

다음 도해는 원천기관이 계약별 Provider 기능을 수행하는 기본 사례다. 도해의 위임은 기술 수행에 한정되며 기관의 고정 지위를 나타내지 않는다.

```text
Provider (원천기관: 운수사·지자체·ITS센터)  ─ 사실·증빙 책임, 최종 확인
      │  위임 (기술 수행만)
      ▼
대행자 (허브·회계법인·ERP 사업자·협회)      ─ 변환·전송·인증·처리로그 책임, 확인기회 제공
      ▼
DS 운영자                                    ─ 접속·보안·전송상태·감사로그 책임
      ▼
검증 주체 (지자체·검증기관)                  ─ 행정데이터 대조, 이상탐지, 환수·정정
```

- **(Decision · E-16)** 계약별로 **Provider 기능을 수행하는 주체의 기본값은 원천기관**이다. 허브가 특정 데이터셋에서 Provider 기능을 수행하려면 **포괄 위임이 문서로 확인**돼야 한다
- **(경계)** Provider는 계약별 기능이지 기관의 지위가 아님
  - **(예외)** 포괄 위임이 문서로 확인된 데이터셋에서는 허브가 Provider 기능을 수행할 수 있음
  - **(제한)** 포괄 위임 확인은 원천 사실·증빙 책임의 이전을 자동으로 뜻하지 않음

| 주체 | 상태 | 본문 책임 | 책임 경계와 증거 |
| --- | --- | --- | --- |
| 계약별 Provider 기능 수행 주체 | `Decision` | 사실·증빙 책임과 최종 확인 | 원자료·증빙·확인 기록. 기술 위임만으로 원천사실 책임이 이전되지 않음 |
| 대행자 | `Decision` | 변환·전송·인증·처리로그와 확인기회 제공 | 매핑 버전·인증·처리로그·확인 기록. 원천 사실을 대신 보증하지 않음 |
| DS 운영자 | `Decision` | 접속·보안·전송상태·감사로그 | 상태 사건과 감사 상관관계. payload 보관·중계와 원천 의미 판정에서 제외 |
| 검증 주체 | `Decision` | 행정데이터 대조·이상탐지·환수·정정 | 대조·조치 기록. Provider의 원천사실 책임을 인수하지 않음 |

### 4.2 관리형 통제 상속

다음 표는 관리형 CaaS의 통제 상속 책임이다. 관리형 운영자와 DS 운영자가 같은 주체라고 전제하지 않으며, 한 기관이 여러 기능을 맡아도 계약별 책임 기록을 분리한다.

| 주체 | 책임 | 제출 증거 | 책임에서 제외되는 항목 |
| --- | --- | --- | --- |
| 관리형 운영자 | 기술·운영 통제 구현, 변경관리, 장애·보안사고 처리, 정기 제3자 감사 수검 | 통제 버전, 경로 binding, 감사 결과, 시정조치 상태 | 데이터 내용의 적법성, 참가자 계정 사용, 개별 Offer 정책 결정 |
| 참가자 | 데이터 내용·제공권한의 적법성, 계정 관리, 자산별 정책 설정, 사고 통지 | Provider 권한, 자산 판정, 계정 책임자, 정책 승인 기록 | 관리형 운영자가 맡은 기반 통제의 배포·운영 |

통제 상속은 운영자 증거를 참가자별로 복제하는 절차가 아니다. 판정 기록은 운영자 통제 버전과 참가자 경로 binding을 함께 가리키고, 어느 한쪽이 만료되면 상속을 중단한다.

## 5. 재평가와 강등

승인 결정의 유효성 재검증, 만료·철회·Registry stale·digest mismatch 처리와 CaaS 정지는 [DSaaS 제어면 §6](../04-implementation/dsaas-control-plane.md#6-외부-승인-gate)을 정본으로 사용한다. 이 문서는 참가 등급 결과만 추가한다.

- 운영 정책이 정한 정기 재평가 또는 보안 사고·정책 위반·경로 변경·감사 지적 사건이 등록되면 해당 경로를 `REASSESSMENT_REQUIRED`로 둔다.
- 재평가가 끝나기 전에는 이전 상위 등급 credential로 새 계약·전송을 시작하지 않는다.
- 상위 조건을 잃고 기본 조건은 충족한 경로는 기본 참가로 강등한다.
- 기본 조건도 충족하지 못한 경로는 정지하고 관련 Offering을 차단 상태로 둔다.

재평가 주기 수치는 DEF-07 확정 전까지 기입하지 않는다.

## 6. 인증 경계

관리 평면과 참가자 간 데이터 스페이스 흐름은 서로 다른 신원 계약을 사용한다.

| 경계 | 신원 수단 | 정본·증거 | 차단 조건 |
| --- | --- | --- | --- |
| 관리 평면 | 운영 신원 정본의 관리 token | [운영 신원 계층 §3](../04-implementation/operational-identity.md#3-인증-경로) | 정본의 관리 경로 검증 실패 |
| 참가자 간 흐름 | 운영 신원 정본의 참가자 credential | [운영 신원 계층 §5](../04-implementation/operational-identity.md#5-dcp-경계) | 운영 증거가 미배치되거나 검증에 실패 |

DCP 채택은 승인된 profile과 trust service가 있을 때만 가능하다. 현재 미배치 상태는 성공 fixture로 대체하지 않고 fail-closed로 유지한다.

관리 OAuth token을 DSP 참가자 간 Catalog·협상·Transfer 흐름의 참가 자격으로 사용하지 않는다. [ST-ID-003](../03-plan/verification-plan.md#4-요구사항-추적)은 관리 token으로 참가자 흐름 접근을 시도해 전 요청 차단과 감사 사건 생성을 확인한다.

## 7. 미결정 등록

이월 항목의 단일 조회 지점은 [DSSC 갭 등록 §3.2](../01-research/dssc-gap-register.md#32-이월-색인-정본)다.

### 7.1 기존 이월 항목

| ID | 미결정 항목 | 현재 처리 | 선행 조건 |
| --- | --- | --- | --- |
| DEF-04 | [운영 신원 계층 §9의 운영 전 남은 증거](../04-implementation/operational-identity.md#9-운영-전-남은-증거) | DCP 경계를 fail-closed로 유지 | DSGA 체계 확정 후 후속 ADR |
| DEF-07 | 재평가 주기 수치 | 사건 트리거만 즉시 적용하고 수치 미기입 | 운영 정책 수립 |

### 7.2 미확인 사항과 결정 요청

- **(Decision · E-15 · 기준일: 2026-08-03)** 기존 **제출 창구** 대체 목표를 **2028년**으로 옮기고 2027년은 병행 시범·준비기간으로 재정의한다

| 등록 ID | 파생 미결 ID | 상태 | 미확인 사항과 영향 | 현재 처리 | 담당 | 기한 |
| --- | --- | --- | --- | --- | --- | --- |
| `OPEN-ONB-01` | `DRV-01` | `Unverified` | ‘기술적 온보딩 완료’의 판정 기준과 증거. 참가자 수준 종단시험 절차가 필요 | 기준·증거를 발명하지 않고 완료 판정을 보류 | 미정 | 미정 |
| `OPEN-ONB-02` | `DRV-02` | `Unverified` | 완료 판정 주체 — 운영자·정산주체·제3자 중 미정 | 판정 권한을 어느 주체에도 배정하지 않음 | 미정 | 미정 |
| `OPEN-ONB-03` | `DRV-04` | `Unverified` | 온보딩 미완료 참가자는 DS 경유 이행이 성립하지 않으므로 **기존 경로 병행이 필수**. 전환 일정(`E-15`)은 온보딩 완료율에 종속 | 완료율 임계값·전환 승인자·종료일을 확정하지 않음 | 미정 | 미정 |

- **(경계)** `DRV-04`의 DS 경유 이행은 신원·카탈로그·계약·정책·감사 절차를 거친 이행을 뜻하며 payload 경유를 뜻하지 않음

## 8. DAPS에서 DCP·VC로의 전환 로드맵

기획보고서의 세대 혼재는 목표 경계와 legacy 경계를 분리해 처리한다.

- 원문 인용: `DAPS에서 DCP로 전환`
- 원문 인용: `1단계 DAPS·DAT·CA`
- 출처: [기획보고서 기술 검토 T-09](../01-research/planning-report-technical-review.md#t-09-daps와-dcp를-동시에-기본모델로-둔-내부-모순), 보고서 p.210~211

| 단계 | 입력·동작 | 완료조건 | rollback |
| --- | --- | --- | --- |
| 0. 경계 고정 | DAPS endpoint·token·Participant ID·claim·issuer 사용 현황을 경로별 inventory로 기록 | 관리 평면과 참가자 간 흐름의 endpoint·audience가 분리됨 | 현행 경로 유지 |
| 1. legacy 격리 | DAPS를 별도 gateway로 격리하고 claim mapping과 감사 ID 연결을 고정 | 승인 mapping 밖 claim 거부와 우회 경로 차단 시험 통과 | legacy gateway 단독 경로로 복귀 |
| 2. DCP·VC 후보 병행 | 승인 후보 profile로 issuer·status·trust anchor·credential 검증을 dual-run | 동일 요청의 두 validator 결과와 불일치 기록 확보 | DCP 후보 경로 차단 |
| 3. cutover | 상위 등급 경로의 신원 수단을 승인된 DCP·VC profile로 전환 | ST-ID-003, 폐기·만료·재발급, 외부 참가자 상호운용 시험 통과 | 승인된 legacy gateway를 제한 기간 재개 |
| 4. 종료 | DAPS 신규 발급과 신규 경로 binding을 중단하고 잔여 token을 만료 처리 | 활성 Agreement·Transfer에 legacy 신원 참조가 없고 rollback 승인기간 종료 | 별도 변경 승인 필요 |

## 9. 검증과 판정 기록

온보딩 판정기는 다음 증거를 같은 판정 ID에 연결한다.

1. 참가기관 등록·비즈니스 적격성 결과
2. 자산·경로·등급과 관리형 또는 자체 운영 구분
3. 운영자 통제 버전과 참가자 경로 binding
4. Provider 권한·데이터 등급·정책 승인 결과
5. credential 검증 결과와 재평가 트리거
6. 허용·강등·정지·제외 결과와 시각
7. 계약 체결·Consumer 수신 가능 상태·기술적 온보딩 상태와 각 근거 참조

필수 입력이나 연결 증거가 없으면 상위 등급을 부여하지 않는다. 이 판정 기록만으로 기술적 온보딩 완료를 간주하지 않으며 `DRV-01`·`DRV-02`가 종결되기 전에는 E-20 완료 판정을 보류한다.

사람 검수는 경로 변경 뒤 이전 판정 ID가 재사용되지 않았는지 확인한다. 운영자·참가자·대행자·검증 주체의 책임 기록이 한 주체에 합쳐지지 않았는지도 확인한다.
