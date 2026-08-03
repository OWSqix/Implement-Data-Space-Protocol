# 기존 허브의 데이터 스페이스 연계 역량 조사

작성일: 2026-08-03  
작성 기준: 외부 자료 확인일 2026-08-02, 저장소 정본 2026-07-11  
상태: Draft  
작성자: 연구 담당  
관련 결정: [ADR-0003](../adr/0003-existing-platform-integration-topology.md) — 분류표 영향 기록, ADR 변경 제외

## 1. 목적과 범위

- **(목적)** 기존 허브가 데이터 스페이스 참여자와 모빌리티 데이터 스페이스(Mobility Data Space, MDS)–Mobilithek 연계 허브 역할을 맡을 수 있는지 공개 문서로 판정
- **(질문)** 허브별 데이터 보유·계약·회수·감사·인증·권리·이용조건은 데이터 스페이스 연계에 충분한가
- **(포함 범위)** 아래 7개 허브
  - 국가대중교통정보센터(입력 표기, TAGO)와 국가교통정보센터(입력 표기, NTIC)
  - K-MaaS와 국토교통 데이터 통합채널
  - 공공데이터포털과 국가데이터인프라(입력 표기, NDI)·데이터 원윈도우
  - 국가교통 데이터 오픈마켓
- **(제외 범위)** 17개 빅데이터 플랫폼 전수평가, 비공개 시스템 실행시험, 법률의견 확정, ADR 파일 열람·수정
- **(판정 기준)** 7개 판정 축, 데이터셋·전달 경로별 4분류, 원천 권리와 종단시험 증거를 함께 적용

외부 사실은 입력 원문의 확인일인 2026-08-02를 유지했다. 국가교통 데이터 오픈마켓은 국토교통 분야의 대표 사례이며, 17개 빅데이터 플랫폼 전체의 평균 판정이 아니다. 근거: [SRC-HUB-00](../../.local/research-input/codex-m6-hub.md).

## 2. 현재 판정

### 2.1 핵심 판정

- **(Verified)** 공개 문서로 축 2·3·4를 모두 충족하는 허브는 0곳
  - **(근거)** 3절의 허브별 7축 판정과 5.1절의 비교표
  - **(범위)** 공개 문서와 저장소 정본 기준의 판정이며, 비공개 운영 기능의 부재를 단정하지 않음
- **(Inferred)** 현 상태 그대로 MDS–Mobilithek 역할을 맡길 수 있는 허브는 0곳
  - **(근거)** 계약별 구독·회수·감사를 함께 확인한 허브가 없음
- **(Verified)** 공개 문서만으로 확정되는 `brokered` 전달 경로는 0개
  - **(판정 경계)** “중개”라는 사업 용어는 계약·구독 기술역할의 증거로 사용하지 않음
- **(Inferred)** K-MaaS와 교통 오픈마켓은 `brokered` 후보이나 확정 경로가 아님
- **(Inferred)** TAGO·NTIC의 전달 기반과 교통 오픈마켓의 거래 기반은 연계 출발 자산에 해당
  - **(제한)** 축 2·3·4와 권리 증거를 대신하지 못함
- **(Inferred)** 권리가 기술보다 큰 장애라는 입력 판정은 유지
  - **(근거)** 기술 보강만으로는 원천기관의 재제공 위임과 데이터셋별 이용조건을 만들 수 없음

### 2.2 공통 장애

- **(Unverified)** 계약-ID와 원천 구독을 잇는 생성·정지·재개·삭제·감사 인터페이스 부재
  - **(확인 범위)** 공개 문서에서 인터페이스와 계약시험 결과를 확인하지 못함
- **(Unverified)** 허브가 수집한 지자체·운수사 데이터를 데이터 스페이스 조건으로 재제공할 위임 근거 비공개
  - **(확인 범위)** 원천별 협약·업무협약(Memorandum of Understanding, MOU)·위탁계약의 재제공 조항을 확인하지 못함

### 2.3 상태와 역할 기준

| 구분 | 이 문서의 의미 |
| --- | --- |
| `Verified` | 1차 출처 또는 저장소의 재현 가능한 관찰에서 직접 확인 |
| `Inferred` | 확인 사실과 판정 기준에서 도출한 해석 |
| `Unverified` | 필요한 문서 또는 계약시험을 확보하지 못해 문서 미확인·판정 불가 |
| `Decision` | 이 조사에서 적용하거나 후속 의사결정을 요청하는 선택 |

| 역할 | 정본 기준 |
| --- | --- |
| `hosted` | 운영 endpoint, payload 계약시험, 운영 책임, 안정 식별자, format·schema·version·삭제 처리, 이용권리·재제공 범위가 확인된 경로 |
| `brokered` | 위임권한, 신청·승인·구독·정지·해지, 계약-ID 매핑, 발급·회수 멱등성·감사·복구, identity 정책, 종료 후 차단시험이 확인된 경로 |
| `index-only` | 소재·설명·원천 링크를 검색하게 하지만 payload 전달과 계약 대행을 하지 않는다고 확인된 경로 |
| `unknown` | 공개 문서만으로 전달·책임 구조를 판정할 수 없는 경로 |
| 메타데이터 역할 | 메타데이터 자체를 저장·제공하지만 원천 payload의 `hosted` 근거가 아닌 경로 |

`unknown`은 `index-only`가 아니다. 검색 전용 역할이 확인돼야 `index-only`로 판정한다. 증거가 부족하면 Full Offering을 만들지 않고 `unknown`을 유지한다. 근거: [SRC-HUB-01](molit-platform-capability-profile.md).

### 2.4 입력과 정본의 증거 기준 격차

- **(Verified)** 저장소 정본은 통합채널 자신의 payload `hosted`도 `Unverified`로 유지
  - **(근거)** payload 미조회, 운영 책임·Distribution·재제공 범위 미확인 — [SRC-HUB-01](molit-platform-capability-profile.md)
- **(Decision)** 입력 원 판정은 변경하지 않고 4.2절에 별도 보존
- **(Decision)** 정본 기준 증거가 없는 `hosted` 입력 행은 4.2절에서 `unknown`으로 낮춤
- **(Decision)** 메타데이터만 다루는 경로는 정본 열에서 메타데이터 역할로 구분
- **(Inferred)** 공개 API가 payload를 반환한다는 사실은 `hosted`의 증거이지만 `hosted` 판정의 충분조건은 아님
- **(Inferred)** 같은 잣대를 다른 허브에 적용하지 않으면 판정 기준이 허브마다 달라짐

이 조정은 축 2·3·4 충족 0곳, `brokered` 확정 경로 0개와 권리 장애 판정을 바꾸지 않는다. 오히려 “우리가 아직 모른다”는 결론을 강화한다.

## 3. 허브별 7축 판정

### 3.1 TAGO

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | 한국교통안전공단은 TAGO를 지자체·운송기관 정보의 국가 단위 수집·가공·제공 체계로 설명한다. API는 JSON/XML payload를 반환하고 전국 버스정류장 CSV도 배포한다. 물리 저장·캐시 구조는 미공개다. [SRC-HUB-02](https://main.kotsa.or.kr/portal/contents.do?menuCode=01080800) [SRC-HUB-03](https://www.data.go.kr/data/15098534/openapi.do) [SRC-HUB-05](https://www.data.go.kr/data/15067528/fileData.do) | `Verified`·`Unverified` — API·파일 전달 경로는 `hosted` |
| 2. 구독·엔타이틀먼트 | 개발·운영계정 신청, 자동승인 또는 운영 활용사례 심사, 일일 트래픽 한도와 인증키 발급은 있다. 계약-ID별 entitlement CRUD, 원천 구독 매핑과 이벤트 통지는 문서에서 확인되지 않는다. [SRC-HUB-03](https://www.data.go.kr/data/15098534/openapi.do) [SRC-HUB-06](https://www.data.go.kr/data/15124045/fileData.do?recommendDataYn=Y) | `Verified`·`Unverified` — 부분 충족 |
| 3. 접근 회수 | 인증키 재발급 시 기존 키 무효화와 이용제한·중지 상태는 확인된다. 특정 데이터셋·계약만 삭제하는 API, 종료 전파 SLA와 삭제 증적은 미확인이다. [SRC-HUB-06](https://www.data.go.kr/data/15124045/fileData.do?recommendDataYn=Y) [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) | `Verified`·`Unverified` — 부분 충족 |
| 4. 수신확인·감사 | 활용신청 상태와 트래픽 조회 기능은 있다. 데이터·version·전달량을 계약-ID·상관관계-ID로 조회·내보내는 기능은 확인되지 않는다. [SRC-HUB-06](https://www.data.go.kr/data/15124045/fileData.do?recommendDataYn=Y) | `Verified`·`Unverified` — 미충족·문서 미확인 |
| 5. 인증 체계 | 일반·사업자·기관 회원과 이용자별 인증키가 중심이다. 조직 대표 서비스계정, 기관 자격 연속 검증, OIDC federation과 mTLS는 미확인이다. [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) | `Verified`·`Unverified` — 개인·계정 중심 |
| 6. 원천 권리 | 법은 국가 교통정보 수집·제공 기반을 두고 다른 기관 정보 제공에 사전협의를 둔다. 제3자 권리 데이터는 적법한 이용허락이 필요하다. 원천별 재제공 위임계약은 비공개다. [SRC-HUB-08](https://www.law.go.kr/LSW/lsInfoP.do?lsId=001968) [SRC-HUB-09](https://www.law.go.kr/LSW/lsInfoP.do?lsId=011895) | `Verified`·`Unverified` — 높음 |
| 7. 이용 조건 | 개별 API와 정류장 파일은 무료·이용허락범위 제한 없음으로 표시된다. 유상 제공, 재판매, 캐시·파생물까지 위임한다는 문서는 아니다. 웹사이트 약관과 API 라이선스도 구분해야 한다. [SRC-HUB-03](https://www.data.go.kr/data/15098534/openapi.do) [SRC-HUB-05](https://www.data.go.kr/data/15067528/fileData.do) [SRC-HUB-10](https://main.kotsa.or.kr/portal/contents.do?menuCode=07010000) | `Verified`·`Unverified` — 공개이용은 넓으나 DSP Offering 조건은 미확인 |

### 3.2 NTIC와 표준노드링크

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | NTIC는 교통량·돌발·예측·검지기·VMS·CCTV·가변속도 정보를 통합 DB로 수집·가공해 API와 파일로 제공한다. 표준노드링크도 파일과 변경이력을 배포한다. CCTV 영상 바이트가 NTIC를 경유하는지는 미확인이다. [SRC-HUB-11](https://intl.its.go.kr/korea-its/system/traffic-center/ntic) [SRC-HUB-12](https://www.its.go.kr/opendata/intro) [SRC-HUB-13](https://its.go.kr/opendata/opendataList?service=cctv) [SRC-HUB-14](https://its.go.kr/opendata/opendataList?service=nodelink) | `Verified`·`Unverified` — 일반 API·파일 `hosted`, 영상 스트림 `unknown` |
| 2. 구독·엔타이틀먼트 | 회원이 인증키를 신청하고 관리자가 통상 3~5영업일 내 승인하는 절차가 문서화돼 있다. 계약별 entitlement API와 원천 구독 매핑은 없다. [SRC-HUB-15](https://www.its.go.kr/file/opendata/openapi_manual.pdf) | `Verified`·`Unverified` — 부분 충족 |
| 3. 접근 회수 | 계약별 key scope 삭제, 원천 센터 구독 철회, TTL·토큰 폐기 API, 종료 증적은 공개 문서에서 확인되지 않는다. [SRC-HUB-15](https://www.its.go.kr/file/opendata/openapi_manual.pdf) | `Unverified` — 미충족·문서 미확인 |
| 4. 수신확인·감사 | 센터 간 교통정보 교환표준은 이용기관별 DSP 수신확인·감사 로그가 아니다. 요청·응답 로그의 외부 조회·내보내기 규격도 미확인이다. [SRC-HUB-16](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000204935) | `Verified`·`Unverified` — 미충족 |
| 5. 인증 체계 | 회원계정·인증키와 신청서상의 기관명은 확인된다. 기관 법적 자격 검증, 서비스계정, federation과 mTLS는 미확인이다. [SRC-HUB-15](https://www.its.go.kr/file/opendata/openapi_manual.pdf) | `Verified`·`Unverified` — 계정·키 중심 |
| 6. 원천 권리 | 법령은 국가교통정보센터 운영과 교통정보사업 계약을 규율한다. 목적 외 사용이나 다른 사업자 제공에는 사전협의가 필요하다. 원천 ITS센터별 DSP 재제공 동의서는 비공개다. 표준노드링크의 구축·관리·배포 근거는 상대적으로 명확하다. [SRC-HUB-08](https://www.law.go.kr/LSW/lsInfoP.do?lsId=001968) [SRC-HUB-17](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=281649) [SRC-HUB-18](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20251031&lsiSeq=279469&urlMode=lsInfoP) [SRC-HUB-19](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000218571) | `Verified`·`Unverified` — 센터 수집자료 높음, 표준노드링크는 상대적으로 낮음 |
| 7. 이용 조건 | 교통량·돌발·예측·노드링크 항목은 무료·이용허락범위 제한 없음으로 표시된다. DSP 재판매·프록시·캐시·파생물 조건은 확인되지 않는다. [SRC-HUB-21](https://www.data.go.kr/data/15040463/openapi.do) [SRC-HUB-22](https://www.data.go.kr/data/15025526/fileData.do) [SRC-HUB-15](https://www.its.go.kr/file/opendata/openapi_manual.pdf) | `Verified`·`Unverified` — 공개이용 가능, DSP 조건 미확인 |

### 3.3 K-MaaS

K-MaaS는 대광위 사업, 한국도로공사의 공공 중계플랫폼과 민간 서비스 앱 슈퍼무브를 분리해 판정한다.

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | 공공 중계플랫폼은 철도·항공·버스·PM 등 사업자 정보를 연계·중개하고 민간 플랫폼이 통합 검색·예약·결제를 제공하게 한다. 표준 Open API 설명은 있으나 운영 명세와 원천 payload 저장 구조는 비공개다. [SRC-HUB-23](https://www.molit.go.kr/mtc/USR/N0201/m_36770/dtl.jsp?id=95090311&lcmspage=3) [SRC-HUB-24](https://smartcity.go.kr/2024/12/13/%ED%86%B5%ED%95%A9%EB%AA%A8%EB%B9%8C%EB%A6%AC%ED%8B%B0%ED%94%8C%EB%9E%AB%ED%8F%BC/) | `Verified`·`Unverified` — 표준 조회응답은 제한적 `hosted`, 원천 실시간·예약 경로는 `unknown` |
| 2. 구독·엔타이틀먼트 | 사업자 공모·선정과 공공·민간 MOU는 확인된다. 일반 참여기관이 구독을 생성·조회·변경·삭제하는 API 규격은 미확인이다. [SRC-HUB-25](https://www.korea.kr/news/policyNewsView.do?newsId=148913608) [SRC-HUB-26](https://tilit.molit.go.kr/srocm/USR/N0201/m_13551/dtl.jsp?id=95087801&lcmspage=1) | `Verified`·`Unverified` — 수동 제휴만 확인 |
| 3. 접근 회수 | 제휴 종료 시 API token·운송사 구독·예약 권한을 연동 철회하는 공개 규격과 SLA가 없다. [SRC-HUB-25](https://www.korea.kr/news/policyNewsView.do?newsId=148913608) | `Unverified` — 문서 미확인 |
| 4. 수신확인·감사 | 예약·결제 서비스는 확인된다. 중계 계층의 호출·수신확인·계약 상관관계 로그 조회·내보내기는 확인되지 않는다. 슈퍼무브 소비자 기록을 K-MaaS 감사기능으로 간주할 수 없다. [SRC-HUB-23](https://www.molit.go.kr/mtc/USR/N0201/m_36770/dtl.jsp?id=95090311&lcmspage=3) | `Verified`·`Unverified` — 문서 미확인 |
| 5. 인증 체계 | 참여 사업자가 선정·MOU로 기관 수준에서 참여한 사실은 확인된다. 런타임 API key, OAuth2, mTLS, 서비스계정과 기관 federation 문서는 없다. [SRC-HUB-25](https://www.korea.kr/news/policyNewsView.do?newsId=148913608) | `Verified`·`Unverified` — 조직 온보딩 일부, 기술 인증 미확인 |
| 6. 원천 권리 | 운송·플랫폼 사업자와 MOU를 맺었다는 사실만 공개돼 있다. 재제공·재라이선스·캐시·유상 Offering·종료 후 처리 조항은 비공개다. [SRC-HUB-25](https://www.korea.kr/news/policyNewsView.do?newsId=148913608) | `Verified`·`Unverified` — 매우 높음 |
| 7. 이용 조건 | 소비자 통합예약 서비스 개시는 확인된다. K-MaaS B2B API의 현행 요금·쿼터·SLA·상업적 재사용·재배포 약관은 미확인이다. [SRC-HUB-23](https://www.molit.go.kr/mtc/USR/N0201/m_36770/dtl.jsp?id=95090311&lcmspage=3) | `Verified`·`Unverified` — 문서 미확인 |

### 3.4 국토교통 데이터 통합채널

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | 기존 조사에서 메타데이터 검색·색인과 외부 원천 링크를 확인했다. 현재 안내에도 검색·분석데이터셋 메타데이터 API는 있으나 원천 payload 보관·전달 책임의 추가 근거는 없다. [SRC-HUB-01](molit-platform-capability-profile.md) [SRC-HUB-28](https://data.molit.go.kr/anals/open-api/guide) | `Verified`·`Unverified` — 메타데이터 `hosted`, 외부 링크 `index-only`, payload `unknown` |
| 2. 구독·엔타이틀먼트 | 자체 API 이용신청·key와 원천 플랫폼 구독 생성은 서로 다른 기능이다. 후자의 신규 공개 문서는 확인되지 않았다. [SRC-HUB-01](molit-platform-capability-profile.md) [SRC-HUB-28](https://data.molit.go.kr/anals/open-api/guide) | `Unverified` — 미충족 |
| 3. 접근 회수 | 계약 종료와 원천 구독 삭제를 연결하는 공개 근거가 없다. [SRC-HUB-01](molit-platform-capability-profile.md) | `Unverified` — 문서 미확인 |
| 4. 수신확인·감사 | payload 전달 수신확인·상관관계-ID·감사 내보내기 근거가 없다. [SRC-HUB-01](molit-platform-capability-profile.md) | `Unverified` — 문서 미확인 |
| 5. 인증 체계 | 계정·key 외 기관 자격·서비스계정·federation 근거는 기존 조사에서 확인되지 않았다. [SRC-HUB-01](molit-platform-capability-profile.md) | `Unverified` — 미확인 |
| 6. 원천 권리 | 통합채널에 색인됐다는 사실만으로 각 제공기관 데이터의 DSP 재제공권을 취득했다고 볼 문서는 없다. [SRC-HUB-01](molit-platform-capability-profile.md) | `Unverified` — 원천별 확인 필요 |
| 7. 이용 조건 | 메타데이터·원천별 이용조건은 개별 데이터셋에 종속된다. 채널 공통 DSP 상업·재배포 정책은 미확인이다. [SRC-HUB-01](molit-platform-capability-profile.md) | `Unverified` — 데이터셋별 |

2026-07-11 이후 공개 근거를 찾았으나 payload `hosted`, `brokered` lifecycle과 회수·감사 기능을 새로 입증하는 공식 문서는 찾지 못했다. 시스템 변경이 없었다는 단정이 아니라 공개 문서로 기존 판정을 바꿀 수 없다는 뜻이다. 근거: [SRC-HUB-00](../../.local/research-input/codex-m6-hub.md).

### 3.5 공공데이터포털

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | 포털 자체 메타데이터 API, 원본 등록 파일과 자동변환 API는 직접 전달된다. 제공기관 연동 API의 payload 호스팅·중계 책임은 데이터셋별로 다를 수 있다. 원천 URL만 안내하는 항목도 있다. [SRC-HUB-31](https://www.data.go.kr/data/15112888/openapi.do) [SRC-HUB-32](https://www.data.go.kr/data/15077093/openapi.do) [SRC-HUB-33](https://www.data.go.kr/data/15118670/fileData.do) | `Verified`·`Unverified` — 메타데이터·원본파일·자동변환 `hosted`, 링크 `index-only`, 제공기관 API 일부 `unknown` |
| 2. 구독·엔타이틀먼트 | 개발계정 자동승인, 운영계정 자동 또는 2~3일 심사, 이용자·활용사례별 key와 트래픽 한도가 있다. 계약-ID 매핑, 원천 구독 CRUD와 event는 없다. [SRC-HUB-34](https://www.data.go.kr/ugs/selectPublicDataUseGuideView.do) | `Verified`·`Unverified` — 부분 충족 |
| 3. 접근 회수 | 약관상 제공기관·포털은 이용조건 위반 등에 따라 제공을 제한·중단할 수 있다. 계약 단위 회수 API와 원천 시스템 전파 증적은 없다. 이미 내려받은 파일 처리는 별도다. [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) [SRC-HUB-35](https://www.data.go.kr/bbs/ntc/selectNotice.do?nttApiYn=N&originId=NOTICE_0000000004887&pageIndex=1&searchCondition2=2) | `Verified`·`Unverified` — 운영상 정지 가능, Mobilithek식 회수 미충족 |
| 4. 수신확인·감사 | 신청 상태와 트래픽 통계는 제공된다. 데이터 version·응답·수신기관·계약-ID를 결합한 외부 감사 API는 미확인이다. [SRC-HUB-34](https://www.data.go.kr/ugs/selectPublicDataUseGuideView.do) [SRC-HUB-06](https://www.data.go.kr/data/15124045/fileData.do?recommendDataYn=Y) | `Verified`·`Unverified` — 부분 기능만 존재 |
| 5. 인증 체계 | 일반·사업자·기관 회원이 있고 기관 회원은 기관정보·인증 절차를 거친다. API 접근은 이용자·활용사례별 key가 중심이다. [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) [SRC-HUB-34](https://www.data.go.kr/ugs/selectPublicDataUseGuideView.do) | `Verified` — 조직 구분은 있으나 federation 아님 |
| 6. 원천 권리 | 포털 약관에서 Provider는 데이터를 보유·관리하는 공공기관이다. 제3자 권리가 있으면 적법한 이용허락이 필요하다. 포털 등록이 별도 재라이선스권을 넘긴다는 근거는 없다. [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) [SRC-HUB-36](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20231117&lsiSeq=251023&urlMode=lsInfoP) | `Verified`·`Unverified` — 포털이 아닌 원 제공기관이 Provider |
| 7. 이용 조건 | 무료·유료, 이용허락 제한 없음, 공공누리 유형과 제3자 권리 등 조건이 데이터셋별로 다르다. 제3자 권리는 상업적 이용 원칙과 별개다. [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) [SRC-HUB-36](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20231117&lsiSeq=251023&urlMode=lsInfoP) | `Verified` — Offering별 조건 승계 필요 |

### 3.6 NDI와 데이터 원윈도우

NDI의 현재 운영 서비스와 정책·구축계획을 분리해 판정한다.

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | 데이터 원윈도우는 공공·민간 플랫폼의 데이터 위치정보와 카탈로그를 연계한다. 검색결과에는 원천·가격·파일형식·프로필·품질·샘플이 표시된다. 실제 payload는 원천 플랫폼으로 연결되는 구조가 중심이다. [SRC-HUB-37](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28579&cbIdx=90549) [SRC-HUB-38](https://www.data1window.kr/noti/userInfo) [SRC-HUB-39](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28715&cbIdx=26537&parentSeq=28715) | `Verified` — 원천 `index-only`, 프로필·샘플은 메타데이터 `hosted` |
| 2. 구독·엔타이틀먼트 | 원윈도우의 데이터 요청·회원 기능은 확인된다. 원천 플랫폼의 계약·구독을 생성하는 운영 API는 미확인이다. NDI 전략의 참여자 인증·데이터 주권 목표는 운영 기능의 증거가 아니다. [SRC-HUB-38](https://www.data1window.kr/noti/userInfo) [SRC-HUB-40](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=27081&cbIdx=90549) | `Verified`·`Unverified` — 운영상 미충족 |
| 3. 접근 회수 | 사이트 회원·서비스 이용 제한은 있으나 원천 데이터 접근을 회수하는 API는 없다. [SRC-HUB-41](https://www.data1window.kr/noti/terms) | `Verified`·`Unverified` — 미충족 |
| 4. 수신확인·감사 | 원천 데이터 전달을 수행하는 구조가 공개적으로 확인되지 않았다. 전달 ACK·감사 API도 확인되지 않는다. [SRC-HUB-37](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28579&cbIdx=90549) | `Unverified` — 미충족 |
| 5. 인증 체계 | 법인·개인 회원은 있다. NDI의 참여자 자격·federation은 전략 목표로만 제시됐다. [SRC-HUB-40](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=27081&cbIdx=90549) [SRC-HUB-41](https://www.data1window.kr/noti/terms) | `Verified`·`Unverified` — 사이트 회원과 NDI 신뢰체계 분리 필요 |
| 6. 원천 권리 | 원윈도우 약관은 연계된 타 플랫폼 정보·거래의 책임과 지식재산권을 원 제공자에게 둔다. 원윈도우가 원천 데이터 Provider가 된다는 근거는 없다. [SRC-HUB-41](https://www.data1window.kr/noti/terms) | `Verified`·`Unverified` — 원천 제공자가 Provider |
| 7. 이용 조건 | 약관은 원윈도우 자체 정보의 무단 상업 이용·복제·배포를 제한한다. 실제 데이터 조건은 원천 제공자에 종속된다. 사이트 약관은 원천 데이터 라이선스가 아니다. [SRC-HUB-41](https://www.data1window.kr/noti/terms) | `Verified` — 원천별 |

### 3.7 국가교통 데이터 오픈마켓

| 판정 축 | 공개 문서의 확인 사실과 한계 | 상태·입력 판정 |
| --- | --- | --- |
| 1. 데이터 보유 형태 | 전달 방식에는 플랫폼 다운로드, 이메일, FTP와 오프라인 저장장치가 있다. 플랫폼 다운로드 파일은 `hosted`다. 외부 전송·API 상품의 전달 토폴로지는 공개 문서만으로 구분되지 않는다. 외부 플랫폼 상품은 링크형이다. [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) [SRC-HUB-45](https://docs.bigdata-transportation.kr/open/open_2.html) | `Verified`·`Unverified` — 플랫폼 다운로드 `hosted`, 외부 플랫폼 `index-only`, 그 밖은 `unknown` |
| 2. 구독·엔타이틀먼트 | 구매·결제·판매자 승인·구매내역·상품 전달 절차가 있다. 판매자 미승인 시 자동취소도 규정한다. 계약별 API entitlement CRUD는 없다. [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) [SRC-HUB-46](https://www.bigdata-transportation.kr/howto/purchase) | `Verified`·`Unverified` — 웹 거래 절차는 강함, 기계 인터페이스 미충족 |
| 3. 접근 회수 | 회원탈퇴·이용제한은 가능하지만 기존 판매계약은 유지될 수 있다. 이미 제공한 파일·외부 FTP 데이터의 회수·삭제 증명 기능은 확인되지 않는다. [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) | `Verified`·`Unverified` — 미충족 |
| 4. 수신확인·감사 | 구매내역·상품·예정일·계약 정보는 남는다. endpoint 호출·전달량·계약 상관관계-ID를 갖춘 감사 API는 미확인이다. [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) [SRC-HUB-45](https://docs.bigdata-transportation.kr/open/open_2.html) | `Verified`·`Unverified` — 거래기록 부분 충족 |
| 5. 인증 체계 | 구매자 본인확인과 판매자의 사업자등록 등 자격자료가 요구된다. 런타임 기관 서비스 인증은 미확인이다. [SRC-HUB-46](https://www.bigdata-transportation.kr/howto/purchase) [SRC-HUB-47](https://www.bigdata-transportation.kr/join) | `Verified`·`Unverified` — 거래 당사자 확인은 부분 충족 |
| 6. 원천 권리 | 약관상 플랫폼은 원칙적으로 중개자이고 판매자가 데이터·개인정보·지식재산권 책임을 진다. 명시적으로 판매를 위탁받은 경우에만 플랫폼이 판매자 역할을 맡는다. [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) | `Verified` — 판매자가 Provider, 명시 위탁 때만 플랫폼 Provider 가능 |
| 7. 이용 조건 | 판매자가 가격·이용조건을 정한다. 구매 목적 외 사용, 무단 제3자 공개, 판매자 동의 없는 재판매·결합가공 신상품화가 제한된다. [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) | `Verified` — DSP 재배포와 충돌 가능성 높음 |

## 4. 데이터셋·전달 경로별 4분류

### 4.1 분류 기준

- **(Decision)** 허브 전체에 단일 역할을 부여하지 않고 데이터셋·전달 경로별로 판정
- **(Decision)** 입력 원 판정은 [SRC-HUB-00](../../.local/research-input/codex-m6-hub.md)의 값을 그대로 보존
- **(Decision)** 정본 열은 [SRC-HUB-01](molit-platform-capability-profile.md)의 증거 기준을 적용
- **(Decision)** 메타데이터만 다루는 경로는 `hosted`가 아닌 메타데이터 역할로 표시
- **(Verified)** `brokered` 확정 경로는 0개
  - **(판정 경계)** API key·이용신청·판매승인·“중개”라는 사업 용어만으로 `brokered`를 부여하지 않음

### 4.2 입력 원 판정과 정본 기준 적용 판정

| 허브 | 데이터셋·전달 경로 | 입력 원 판정 | **정본 기준 적용 판정** | 격차 사유 |
| --- | --- | --- | --- | --- |
| TAGO | 버스 정류소·노선 기준정보 API | `hosted` | `unknown` | payload 반환은 확인됐으나 계약시험, 운영 책임, 안정 식별자, version·삭제 처리와 재제공 권리가 미확인 [SRC-HUB-02](https://main.kotsa.or.kr/portal/contents.do?menuCode=01080800) [SRC-HUB-03](https://www.data.go.kr/data/15098534/openapi.do) |
| TAGO | 버스 위치·도착, 고속·시외·철도·지하철·항공·선박 API | `hosted` | `unknown` | 수집·가공 응답의 전달은 확인됐으나 경로별 계약시험, 책임·ID·version·삭제와 재제공 권리가 미확인 [SRC-HUB-04](https://www.data.go.kr/data/15098533/openapi.do) |
| TAGO | 카셰어링·PM 위치·상태 API | `hosted` | `unknown` | 전달 설명 외 정본 증거가 없고 민간 원천 재제공 권리 위험이 큼 [SRC-HUB-04](https://www.data.go.kr/data/15098557/openapi.do) |
| TAGO | 전국 버스정류장 CSV·자동변환 API | `hosted` | `unknown` | 파일 배포는 확인됐으나 계약시험, 안정 ID, version·삭제 처리와 재제공 범위가 미확인 [SRC-HUB-05](https://www.data.go.kr/data/15067528/fileData.do) |
| TAGO | 원천 사업자 구독을 대신 생성하는 경로 | `unknown` | `unknown` | 계약·구독 lifecycle, 위임권한과 발급·회수 시험 문서 없음 |
| NTIC | 교통량·돌발·검지기·VMS·가변속도·예측 API | `hosted` | `unknown` | payload 반환 외 계약시험, 운영 책임, 안정 ID, version·삭제 처리와 재제공 권리가 미확인 [SRC-HUB-21](https://www.data.go.kr/data/15040463/openapi.do) |
| NTIC | 표준노드링크 SHP/MIF/GML·변경이력 | `hosted` | `unknown` | 직접 파일 배포와 관리 근거는 있으나 계약시험, 안정 ID, 삭제 처리와 재제공 범위의 묶음 증거가 없음 [SRC-HUB-14](https://its.go.kr/opendata/opendataList?service=nodelink) [SRC-HUB-20](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulId=32722&efYd=0) |
| NTIC | CCTV 위치·형식·URL 메타데이터 | `hosted` | 메타데이터 역할 | API가 반환하는 것은 영상 payload가 아니라 위치·형식·URL 메타데이터 [SRC-HUB-13](https://its.go.kr/opendata/opendataList?service=cctv) |
| NTIC | `cctvurl`이 가리키는 실제 영상 스트림 | `unknown` | `unknown` | NTIC relay인지 원천센터 직접 송신인지 문서 미확인 |
| K-MaaS | K-MaaS가 정규화해 만든 검색·경로 조회 응답 | `hosted` | `unknown` | 중계플랫폼 설명만 있고 운영 API 명세, 계약시험, owner, 안정 ID, version·삭제와 권리 문서가 없음 [SRC-HUB-24](https://smartcity.go.kr/2024/12/13/%ED%86%B5%ED%95%A9%EB%AA%A8%EB%B9%8C%EB%A6%AC%ED%8B%B0%ED%94%8C%EB%9E%AB%ED%8F%BC/) |
| K-MaaS | 운송사 실시간 좌석·운임·예약·결제 | `unknown` | `unknown` | `brokered` 후보이나 계약별 구독·회수·감사와 원천별 위임권한이 미확인 |
| K-MaaS | 슈퍼무브 소비자 거래·개인정보 | K-MaaS 범위 밖 | K-MaaS 범위 밖 | 민간 서비스 플랫폼 자산을 공공 중계플랫폼 데이터셋으로 볼 근거 없음 |
| 통합채널 | 카탈로그·검색·분석데이터셋 메타데이터 | `hosted` | 메타데이터 역할 | 메타데이터 자체의 저장·제공은 원천 payload `hosted` 판정과 다름 [SRC-HUB-01](molit-platform-capability-profile.md) [SRC-HUB-28](https://data.molit.go.kr/anals/open-api/guide) |
| 통합채널 | 외부 원천 URL 레코드 | `index-only` | `index-only` | 원천 링크 제공과 payload·계약 대행 부재가 확인된 범위 |
| 통합채널 | 원천 payload·분석 저장소 전달 | `unknown` | `unknown` | 기존 조사 이후 운영 endpoint·계약시험·책임·권리의 추가 근거 없음 |
| 공공데이터포털 | 포털 카탈로그·검색 API | `hosted` | 메타데이터 역할 | 포털 자체 메타데이터이며 원천 payload 호스팅 근거가 아님 [SRC-HUB-31](https://www.data.go.kr/data/15112888/openapi.do) [SRC-HUB-32](https://www.data.go.kr/data/15077093/openapi.do) |
| 공공데이터포털 | 원본 등록 파일·자동변환 API | `hosted` | `unknown` | 파일·변환 응답은 확인됐으나 데이터셋별 계약시험, owner·책임, 안정 ID, version·삭제와 재제공 권리가 미확인 [SRC-HUB-33](https://www.data.go.kr/data/15118670/fileData.do) |
| 공공데이터포털 | 제공기관 연동 API | `unknown` | `unknown` | gateway·backend 운영 책임과 정본 증거의 데이터셋별 확인 필요 |
| 공공데이터포털 | 제공기관 URL만 제시하는 항목 | `index-only` | `index-only` | 링크 이후 payload 전달과 책임은 제공기관에 있음 |
| 데이터 원윈도우 | 원천 플랫폼 데이터·서비스 | `index-only` | `index-only` | 위치정보·원천 링크 중심이며 원윈도우가 payload·계약을 맡는 근거 없음 [SRC-HUB-37](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28579&cbIdx=90549) |
| 데이터 원윈도우 | 카탈로그 프로필·품질·샘플 미리보기 | `hosted` | 메타데이터 역할 | 프로필·품질·샘플은 원천 payload `hosted` 판정과 분리 [SRC-HUB-39](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28715&cbIdx=26537&parentSeq=28715) |
| NDI | 실제 주권형 데이터 교환 | `unknown` | `unknown` | 전략·기획은 있으나 운영 endpoint, 계약시험, 책임, lifecycle과 재제공 권리의 증거 없음 [SRC-HUB-40](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=27081&cbIdx=90549) |
| 교통 오픈마켓 | 플랫폼 내 다운로드 상품 | `hosted` | `unknown` | 다운로드 경로는 확인됐으나 데이터셋별 계약시험, 운영 책임, 안정 ID, version·삭제와 재제공 권리가 미확인 [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) |
| 교통 오픈마켓 | 이메일·FTP·오프라인 전달 | `unknown` | `unknown` | 상거래 이행 외 계약별 구독·회수·감사와 전달 책임 구조가 문서 미확인 |
| 교통 오픈마켓 | API 상품 | `unknown` | `unknown` | 인증·구독·호스팅 규격과 계약시험이 비공개 |
| 교통 오픈마켓 | 외부 빅데이터 플랫폼 상품 레코드 | `index-only` | `index-only` | 외부 플랫폼으로 연결하며 자체 payload 전달을 확인할 근거 없음 |

### 4.3 격차의 영향

- **(Inferred)** 입력의 `hosted` 13개 행 가운데 정본 기준으로 확정되는 `hosted` 경로는 0개
  - **(근거)** 4.2절에서 9개는 `unknown`, 4개는 메타데이터 역할로 구분
- **(Inferred)** 강등은 기능 부재 판정이 아니라 정본이 요구하는 묶음 증거의 부재 판정
- **(Inferred)** 통합채널과 다른 허브에 같은 기준을 적용해 비교 가능성을 유지
- **(Verified)** 입력의 4분류 표에는 네 역할값이 아닌 `K-MaaS 범위 밖` 행이 1개 있음
  - **(처리)** 다섯 번째 역할값으로 해석하지 않고 입력 원 판정과 범위 제외를 그대로 보존
- **(Unverified)** 이 격차가 ADR-0003 분류표에 미치는 실제 변경 범위는 판정 불가
  - **(확인 방법)** 9절 `OPEN-HUB-09`에서 결정권자 검토와 개정 범위를 요청

## 5. MDS–Mobilithek 역할 격차

### 5.1 축 2·3·4 비교

`부분`은 이용신청·key·거래 등 일부 기능이 있다는 뜻이다. 계약별 자동 lifecycle을 충족한다는 의미가 아니다.

| 허브 | 축 2 구독·엔타이틀먼트 | 축 3 접근 회수 | 축 4 수신확인·감사 | 추가 확인·구현 항목 |
| --- | --- | --- | --- | --- |
| TAGO | 부분 — 자동승인·key·quota | 부분 — 공통 key 무효화·이용중지 | 미충족 | 계약별 entitlement CRUD, scoped key, Agreement↔TAGO 신청 매핑, 종료 event, 전달 감사·삭제 증적 |
| NTIC | 부분 — 관리자 수동승인 | 미확인 | 미충족 | NTIC adapter, 계약별 key·scope, suspend·resume·delete, 원천 ITS센터 구독 전파, 감사 export |
| K-MaaS | 제휴·MOU만 확인 | 미확인 | 미확인 | 공개 B2B API 계약, 서비스 인증, partner entitlement, 운송사별 종료 연동, ACK와 거래·호출 감사 분리 |
| 통합채널 | 자체 메타데이터 API key만 부분 | 미확인 | 미확인 | 원천 플랫폼 adapter와 lifecycle 전체 신설 |
| 공공데이터포털 | 부분 — 신청·key·심사 | 부분 — 정지 가능 | 통계만 부분 | 계약별 key·scope, 제공기관 API와 양방향 상태 동기화, 감사·삭제 증적 |
| 원윈도우·NDI | 데이터 구독 기능 미확인 | 미충족 | 미충족 | payload 역할을 맡기면 전체 기능 신설, 카탈로그 역할만 맡기면 제외 |
| 교통 오픈마켓 | 부분 — 주문·승인·결제 | 미충족 | 거래기록 부분 | 거래계약-ID API, API 상품 token 발급·회수, 파일 삭제확약, 호출·전달 감사 API |

### 5.2 최소 인터페이스 기준

- **(Decision)** 허브 adapter의 entitlement 기능 후보는 `create/get/suspend/resume/delete/listEntitlement`
  - **(완료 증거)** 같은 idempotency key의 재시도 결과와 상태 event를 8.1절 종단시험에서 확인
- **(Decision)** 데이터 스페이스 Agreement ID와 허브 신청·주문·구독 ID는 1:1 또는 명시적 N:1로 mapping
  - **(완료 증거)** 생성·정지·재개·삭제 event와 양쪽 ID가 같은 감사 export에 남음
- **(Decision)** scoped credential, 서비스계정과 기관 federation은 소비자 조직 단위 접근을 구분하는 후보
  - **(완료 증거)** 계약 종료 뒤 해당 scope 접근에서 401 또는 403을 확인
- **(Decision)** 종료 SLA, 실패 보상·재시도와 삭제확약은 운영 계약의 후보 항목
  - **(완료 증거)** 고의 실패와 재시도 뒤 허브 상태와 Agreement 상태가 일치함
- **(Decision)** 감사 기록은 요청기관·계약·전달 결과를 같은 상관관계로 연결
  - **(기록 필드)** 데이터셋·version, 계약-ID, 시각과 처리결과
  - **(기록 필드)** 요청기관, 전달량과 correlation ID
  - **(완료 증거)** 8.1절 6단계에서 동일 상관관계의 export를 재현

## 6. 원천 권리 위험

### 6.1 허브별 위험과 Provider 구조

**법정 수집권과 DSP 재라이선스권은 동일하지 않다.** 수집·가공·공개 근거가 있어도 유상 Offering, 재라이선스와 제3자 재배포 권리는 데이터셋별로 따로 확인한다.

| 허브 | 위험 등급 | 충돌 가능성 | 권고 Provider 구조 |
| --- | --- | --- | --- |
| TAGO | 높음 | 지자체·운수사·철도·항공·선박·민간 모빌리티 자료의 DSP 재판매·재라이선스 위임 미확인 [SRC-HUB-08](https://www.law.go.kr/LSW/lsInfoP.do?lsId=001968) [SRC-HUB-09](https://www.law.go.kr/LSW/lsInfoP.do?lsId=011895) | 국토교통부 또는 실제 원천기관을 Offering Provider Participant로 두고 한국교통안전공단·TAGO는 기술 운영자·전달자로 배치 |
| NTIC | 높음 | 지역 ITS센터 정보가 목적·조건과 사전협의에 묶일 수 있음 [SRC-HUB-18](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20251031&lsiSeq=279469&urlMode=lsInfoP) | 국토교통부·원천 ITS센터를 Offering Provider Participant로 두고 NTIC는 전달자로 배치. 표준노드링크도 국토교통부를 Offering Provider Participant로 두는 구조 권고 |
| K-MaaS | 매우 높음 | 운송사·예약사업자·PM사업자 MOU의 재제공·캐시·유상화·재라이선스 범위 비공개 [SRC-HUB-25](https://www.korea.kr/news/policyNewsView.do?newsId=148913608) | 각 운송·플랫폼 사업자를 Offering Provider Participant로 배치. 한국도로공사 K-MaaS는 전달 중개자·기술 운영자로 두고 포괄 위임 확인 항목만 Provider 후보 |
| 통합채널 | 높음 | 색인·분석을 위해 받은 권리와 제3자 제공권은 다를 수 있음 | 데이터셋 원 제공기관을 Offering Provider Participant로 유지 |
| 공공데이터포털 | 데이터별 | 포털 약관도 원 제공기관을 권리·책임 주체로 두며 제3자 권리는 별도 허락 대상 [SRC-HUB-07](https://www.data.go.kr/ugs/selectPortalPolicyView.do) [SRC-HUB-36](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20231117&lsiSeq=251023&urlMode=lsInfoP) | 포털은 배포 gateway·catalog, 원 공공기관은 Offering Provider Participant |
| 데이터 원윈도우 | 높음 | 원천 링크·카탈로그 연계이며 원윈도우가 거래·권리를 인수하지 않음 [SRC-HUB-41](https://www.data1window.kr/noti/terms) | 원천 플랫폼·데이터 보유자를 Offering Provider Participant로 유지 |
| 교통 오픈마켓 | 높지만 구조는 명확 | 판매자 조건이 재판매·외부공개·신상품화를 제한할 수 있음 [SRC-HUB-44](https://www.bigdata-transportation.kr/frn/tou) | 판매자를 Offering Provider Participant로 배치. 명시적 판매 위탁계약이 있을 때만 한국도로공사·플랫폼을 Provider 후보로 검토 |

- **(Decision)** 통합채널 위험 등급은 사용자 지정에 따라 `높음`으로 표기
  - **(한계)** 입력 원 표기는 `높음·불명`이며 데이터셋별 위임문서 부재로 불명확성이 남음

### 6.2 데이터셋별 권리 확인 항목

| 권리 묶음 | 분리 확인 항목 | 확인 증거 |
| --- | --- | --- |
| 전달·복제 | 원본 전달, 캐시·복제 | 원천별 위탁·이용허락 조항과 허용 저장기간 |
| 거래 | 서브라이선스, 유상 제공 | 가격 부과·재판매·대행권 조항 |
| 가공 | 가공·결합·파생물 생성 | 파생물 소유권·허용 목적·반출 조건 |
| 재배포 | 제3자 재배포·국외이전 | 수령자 범위·지역 제한·재이전 조건 |
| 종료 | 종료 후 보존·삭제 | 보존기간·삭제확약·감사 증적 |
| 보호정보 | 개인정보·영업비밀·운행보안 | 법적 근거·보안등급·비식별 또는 접근통제 승인 |
| 철회 | 제공기관 철회 시 기존 계약 영향 | 기존 Agreement 존속·중단·통지·보상 조항 |

### 6.3 법률 검토 경계

- **(Unverified)** 법령 개정이 즉시 필요하다고 단정할 공개 근거는 없음
- **(Inferred)** 현행 자료가 사전협의·계약을 전제하므로 우선 경로는 법 개정보다 원천기관 동의·위임계약과 약관 정비
- **(Decision)** 기존 수집목적을 넘어 유상 재제공·재라이선스하는 데이터셋은 국토교통부 공식 법률검토 대상으로 등록
  - **(완료 증거)** 데이터셋별 법률의견에 Provider, 허용 행위, 금지 행위와 종료 효과가 명시됨

## 7. 중복·경쟁과 역할분담

### 7.1 허브별 병존 판정

- **(Inferred)** 대체를 권고할 허브는 0곳
  - **(근거)** 기존 허브는 원천 수집·공개배포·검색·상거래 중 일부를 수행하지만 데이터 스페이스의 계약별 회수·감사를 대신하지 못함

| 허브 | 겹치는 기능 | 판정 | 권고 역할 |
| --- | --- | --- | --- |
| TAGO | 교통 카탈로그, 표준화, 실시간 API 전달, key 발급 | 역할분담 | 대중교통 데이터의 system of record·전달 계층 |
| NTIC | ITS 수집·통합, 표준 API·파일 전달 | 역할분담 | 도로교통 전달 계층, 데이터 스페이스 계약 종료를 NTIC entitlement에 연결하는 adapter 후보 |
| K-MaaS | 기관 간 연계, 표준 API, 예약 중개 | 역할분담 | 실시간 조회·예약·결제 전달 중개 계층 |
| 통합채널 | 국토교통 메타데이터 검색·카탈로그 | 병존·역할분담 | 기존 카탈로그 연합수집, 계약에 필요한 최소 Offering 메타데이터 추가 |
| 공공데이터포털 | 공개 데이터 검색·신청·key·배포 | 병존 | 무조건 공개 가능한 데이터의 현행 배포 유지, 제한·계약형 데이터만 데이터 스페이스 대상으로 분리 |
| 데이터 원윈도우 | 범정부·민간 통합검색과 카탈로그 표준 | 병존 | 상위 국가 카탈로그·연합검색, 국토교통 도메인의 계약·정책·전달 상태와 분리 |
| 교통 오픈마켓 | 데이터 상품등록·가격·구매·결제 | 병존·역할분담 | 상거래·정산, 데이터 스페이스의 기계식 entitlement·감사와 분리 |

### 7.2 3계층 역할분담

| 계층 | 주체 | 담당 역할 | 비담당 역할 |
| --- | --- | --- | --- |
| 1. 카탈로그 연합 | 데이터 원윈도우·통합채널·공공데이터포털 | 원천 카탈로그 수집·검색과 출처 연결 | 제한 데이터 계약, 원천 접근권한 발급·회수 |
| 2. 데이터 스페이스 | 국토교통 데이터 스페이스 | 기관 인증, Offering, 계약, 정책과 감사 상관관계 | 원천 payload의 system of record, 예약·결제 운영 |
| 3. 원천 전달 | TAGO·NTIC·K-MaaS·교통 오픈마켓 | 원천 연계, 구독·주문, payload 전달과 예약·결제 | 데이터 스페이스 전체 참가자 규칙과 계약정책 제정 |

- **(Decision)** 공공데이터포털의 공개배포와 데이터 원윈도우의 범정부 검색은 복제 대상에서 제외
- **(Decision)** 데이터 스페이스는 계약별 entitlement·회수·감사 기능과 Offering 조건에 범위를 한정
- **(조건)** 기존 허브의 구독·주문 ID와 Agreement ID를 연결한 종단시험을 통과한 경로만 3계층 전달 경로로 승인

## 8. 역량 검증 방법

### 8.1 6단계 종단시험

| 단계 | 입력·선행조건 | 실행 주체와 동작 | 합격 기준 | 증거 |
| --- | --- | --- | --- | --- |
| 1. Entitlement 생성 | 체결된 데이터 스페이스 Agreement와 허브 대상 Dataset | 허브 adapter가 Agreement ID로 entitlement를 한 번 생성 | 허브 entitlement ID가 Agreement ID와 mapping되고 중복 활성 객체 0개 | 생성 response, mapping record, 상태 event |
| 2. 접근·감사 | 활성 entitlement와 scoped credential | 소비자 서비스계정이 계약-ID를 포함해 payload 접근 | 접근 성공, 데이터셋·version·전달량·결과가 같은 correlation ID로 기록 | access log, payload checksum, audit record |
| 3. 정지·재개 | 활성 entitlement | adapter가 `suspend` 뒤 접근을 시도하고 `resume` 뒤 다시 시도 | 정지 중 401 또는 403, 재개 뒤 동일 scope 접근 성공 | 상태 event, 두 접근 response, audit record |
| 4. 종료·회수 | 종료된 Agreement | adapter가 원천 구독·key·임시 자원을 삭제하고 기존 credential로 재접근 | 원천 상태가 종료되고 신규·기존 credential 접근에서 401 또는 403 | 삭제 response, 원천 상태 조회, 접근 거부 log |
| 5. 멱등 재시도 | 각 단계와 같은 idempotency key | adapter가 생성·정지·재개·삭제 요청을 재전송 | 상태가 한 번만 전이되고 중복 구독·key·청구 0개 | 재시도 response, 객체 수 조회, 상태 이력 |
| 6. 감사·삭제 증적 | 단계 1~5의 correlation ID | 운영자가 감사 export와 삭제·철회 증적을 생성 | 요청기관·계약·Dataset·version·결과·전달량·회수 시각을 한 묶음으로 조회 | 서명 또는 무결성 검증 가능한 export, 삭제확약 |

> **(경고)** 이 시험을 통과하기 전에는 “API가 있다”, “승인 절차가 있다”, “중계플랫폼이다”라는 설명만으로 Mobilithek형 역량을 인정해서는 안 된다.

### 8.2 파일 데이터의 접근 회수

- **(Verified)** 이미 내려받은 파일 복제본은 허브가 기술적으로 회수할 수 없음
- **(Decision)** 계약 종료 뒤의 향후 다운로드 차단으로 접근 회수를 대체
  - **(합격 기준)** 종료 뒤 원 다운로드 URL·credential 재사용에서 401 또는 403 확인
- **(Decision)** 소비자의 삭제·보존종료 확인 절차로 기존 복제본 처리를 보완
  - **(합격 기준)** 소비자가 파일 ID·checksum·삭제 시각·잔여 보존 예외를 기재한 확인서를 제출
- **(한계)** 삭제 확인 절차는 소비자 저장장치의 물리적 삭제를 기술적으로 보장하는 기능이 아님

## 9. 미확인 사항과 결정 요청

| ID | 미확인 사항 | 영향 | 확인 방법 |
| --- | --- | --- | --- |
| `OPEN-HUB-01` | 입력의 `hosted` 증거 기준과 저장소 정본의 묶음 증거 기준 사이의 격차 | 4.2절의 입력 원 판정과 정본 판정 차이, 허브 간 비교 일관성 | 아키텍처 책임자가 정본의 6개 증거 항목을 판정 체크리스트로 승인하고 입력 조사자와 경로별 증거를 재대조 |
| `OPEN-HUB-02` | TAGO 원천별 협약, gateway 소유·캐시 구조, scoped key 회수 API, 호출감사 export, 안정 ID와 version·삭제 처리 | TAGO API·파일 경로의 `hosted` 확정과 원천 재제공 권리 | 국토교통부·한국교통안전공단에 가림 처리한 협약 표준본, OpenAPI 운영규격, owner·책임분장, 인증키 상태모델과 로그 schema 정보공개청구. 승인 fixture로 payload 계약시험 수행 |
| `OPEN-HUB-03` | NTIC의 ITS센터별 재제공 동의, CCTV stream 경로, key 폐기·감사 API, 노드링크 안정 ID·version·삭제 처리 | NTIC API·파일의 `hosted`와 CCTV 경로 판정 | 국토교통부·NTIC에 센터 간 협약, CCTV URL DFD, gateway 운영규정, owner·책임분장과 로그 보존 절차 요청. API·파일 계약시험 수행 |
| `OPEN-HUB-04` | K-MaaS B2B API 명세, MOU 권리 조항, OAuth2·mTLS, partner 종료·감사 절차, 응답 안정 ID·version 정책 | 제한적 `hosted` 입력 판정과 `brokered` 후보 판정, 매우 높은 권리 위험 | 대광위·한국도로공사에 OpenAPI·AsyncAPI, 온보딩·오프보딩 규정, MOU 데이터권리 부속서, owner·책임분장과 sandbox 요청. 계약·종료 시험 수행 |
| `OPEN-HUB-05` | 통합채널 payload 저장·전달 책임, 내부 SPA API의 공식성, 원천 구독 lifecycle, Distribution 안정 ID·version·삭제와 재제공 권리 | 통합채널 payload `hosted`와 `brokered` 판정 | 운영기관에 외부공개 API 목록, version 정책, 데이터흐름도, owner·책임분장과 원천 연계계약 요청. 승인 endpoint로 payload 계약시험 수행 |
| `OPEN-HUB-06` | 공공데이터포털 데이터셋별 gateway·backend 책임, 계약 단위 key 회수, 감사 export, 원본 파일 ID·version·삭제와 재제공 범위 | 원본 파일·자동변환 API의 `hosted` 확정과 제공기관 API 책임 판정 | 공공데이터활용지원센터에 책임분장표, 인증키 상태 API, 제공기관 연동 규격과 감사정책 요청. 대표 파일·API의 계약시험과 삭제 통지시험 수행 |
| `OPEN-HUB-07` | NDI·원윈도우의 운영형 participant identity, sovereign exchange, 계약·회수 API, payload owner·ID·version·권리 | NDI 주권형 교환의 `unknown` 판정과 원윈도우 역할 경계 | 과학기술정보통신부·NIA에 단계별 아키텍처, 참조모델 적합성 시험, 2026년 기획사업 산출물과 운영전환 계획 요청. payload 역할을 제안하면 정본의 6개 `hosted` 증거 확보 |
| `OPEN-HUB-08` | 교통 오픈마켓 API 상품 전달규격, 다운로드 후 삭제확약, 플랫폼 위탁판매 범위, 상품 안정 ID·version과 운영 책임 | 다운로드 상품의 `hosted` 확정, API 상품 역할과 Provider 판정 | 한국도로공사·판매자에게 판매자계약서, API 상품 규격, 주문상태 API와 감사 절차 요청. 대표 상품 계약시험과 종료·삭제 확인 수행 |
| `OPEN-HUB-09` | 4.2절의 정본 기준 강등이 ADR-0003 분류표에 미치는 변경 행과 결정 상태 | 기존 분류표와 후속 설계의 기준 불일치 가능성 | ADR 결정권자가 이 보고서의 26개 행을 기존 분류표와 대조해 변경 후보·유지 행·근거를 승인. 이 조사에서는 ADR 파일을 변경하지 않음 |
| `OPEN-HUB-10` | 유상 재제공·재라이선스 경로에서 법령 개정, 위임계약 또는 약관 정비 중 필요한 조치 | Provider 적법성, Offering 조건과 기존 계약의 유효성 | 국토교통부 법무 담당이 데이터셋별 수집근거·원천권리·이용조건을 검토해 법률의견 발행. 문서 확보 전에는 법령 개정 필요 여부 판정 불가 |

## 10. 출처

페이지 개념이 없는 웹 자료와 저장소 Markdown은 `해당 없음`으로 표시했다. PDF의 인용 page를 입력에서 확인하지 못한 경우 `문서 미확인`으로 유지했다. 외부 자료 확인일은 입력 원문대로 2026-08-02다.

| SRC-ID | 발행기관 | 문서명 | version 또는 상태 | 발행일 | 페이지 | URL | 확인일 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SRC-HUB-00` | 작업 입력 | codex-m6-hub.md | 조사 입력 | 발행일 미표기 | 해당 없음 | [저장소 입력](../../.local/research-input/codex-m6-hub.md) | 2026-08-03 |
| `SRC-HUB-01` | DSP 저장소 | 국토교통 데이터 통합 채널 역할 평가 | Draft | 2026-07-11 | 해당 없음 | [저장소 문서](molit-platform-capability-profile.md) | 2026-08-02 |
| `SRC-HUB-02` | 한국교통안전공단 | 국가대중교통정보센터 서비스 소개 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://main.kotsa.or.kr/portal/contents.do?menuCode=01080800) | 2026-08-02 |
| `SRC-HUB-03` | 공공데이터포털·국토교통부 | 정류소 API | Open API, 등록 2022-01-24 | 2023-07-12 수정 | 해당 없음 | [원문](https://www.data.go.kr/data/15098534/openapi.do) | 2026-08-02 |
| `SRC-HUB-04` | 공공데이터포털·국토교통부 | 버스위치·도착·노선과 교통수단별 Open API 묶음 | 노선정보와 추가 교통수단 API | 2025-06-16 또는 2026-03-05~06 최종 수정 | 해당 없음 | [버스위치](https://www.data.go.kr/data/15098533/openapi.do)<br>[도착정보](https://www.data.go.kr/data/15098530/openapi.do)<br>[노선정보](https://www.data.go.kr/data/15098529/openapi.do)<br>[고속버스](https://www.data.go.kr/data/15098522/openapi.do)<br>[고속버스 도착](https://www.data.go.kr/data/15098516/openapi.do)<br>[시외버스](https://www.data.go.kr/data/15098541/openapi.do)<br>[항공](https://www.data.go.kr/data/15098526/openapi.do)<br>[열차](https://www.data.go.kr/data/15098552/openapi.do)<br>[선박](https://www.data.go.kr/data/15098523/openapi.do)<br>[지하철](https://www.data.go.kr/data/15098554/openapi.do)<br>[카셰어링](https://www.data.go.kr/data/15098557/openapi.do)<br>[PM](https://www.data.go.kr/data/15117668/openapi.do) | 2026-08-02 |
| `SRC-HUB-05` | 공공데이터포털·국토교통부 | 전국 버스정류장 위치정보 CSV | 파일데이터, 기준일 2025-10-31, 등록 2025-11-09 | 2025-12-09 수정 | 해당 없음 | [원문](https://www.data.go.kr/data/15067528/fileData.do) | 2026-08-02 |
| `SRC-HUB-06` | 행정안전부 공공데이터정책과 | 공공데이터포털 FAQ 파일 | 파일데이터, 기준일 2025-06-18, 등록 2025-06-24 | 2025-07-07 수정 | 문서 미확인 | [원문](https://www.data.go.kr/data/15124045/fileData.do?recommendDataYn=Y) | 2026-08-02 |
| `SRC-HUB-07` | 행정안전부·한국지능정보사회진흥원 공공데이터활용지원센터 | 공공데이터포털 운영정책 | 약관 | 2023-06-08 시행 | 해당 없음 | [원문](https://www.data.go.kr/ugs/selectPortalPolicyView.do) | 2026-08-02 |
| `SRC-HUB-08` | 대한민국·법제처 | 국가통합교통체계효율화법 | 법률 제20727호, 시행 2026-02-01 | 2025-01-31 공포 | 해당 없음 | [원문](https://www.law.go.kr/LSW/lsInfoP.do?lsId=001968) | 2026-08-02 |
| `SRC-HUB-09` | 대한민국·법제처 | 공공데이터의 제공 및 이용 활성화에 관한 법률 | 법률 제19408호, 시행 2023-11-17 | 2023-05-16 공포 | 해당 없음 | [원문](https://www.law.go.kr/LSW/lsInfoP.do?lsId=011895) | 2026-08-02 |
| `SRC-HUB-10` | 한국교통안전공단 | 웹사이트 이용약관 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://main.kotsa.or.kr/portal/contents.do?menuCode=07010000) | 2026-08-02 |
| `SRC-HUB-11` | ITS 국제협력센터·ITS Korea | NTIC 소개 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://intl.its.go.kr/korea-its/system/traffic-center/ntic) | 2026-08-02 |
| `SRC-HUB-12` | 국토교통부 국가교통정보센터 | 공공데이터 소개 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://www.its.go.kr/opendata/intro) | 2026-08-02 |
| `SRC-HUB-13` | 국토교통부 국가교통정보센터 | CCTV 페이지 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://its.go.kr/opendata/opendataList?service=cctv) | 2026-08-02 |
| `SRC-HUB-14` | 국토교통부 국가교통정보센터 | 표준노드링크 페이지 | 현행 배포 기준일 2026-07-01 | 발행일 미표기 | 해당 없음 | [원문](https://its.go.kr/opendata/opendataList?service=nodelink) | 2026-08-02 |
| `SRC-HUB-15` | 국토교통부 국가교통정보센터 | OpenAPI 이용 매뉴얼 | PDF, 판 미표기 | 발행일 미표기 | 문서 미확인 | [원문](https://www.its.go.kr/file/opendata/openapi_manual.pdf) | 2026-08-02 |
| `SRC-HUB-16` | 국토교통부 | 기본교통정보 교환 기술기준 | 고시 제2021-1059호 | 2021-09-01 시행 | 해당 없음 | [원문](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000204935) | 2026-08-02 |
| `SRC-HUB-17` | 대한민국·법제처 | 국가통합교통체계효율화법 시행령 | 대통령령 제35948호, 시행 2026-01-02 | 2025-12-30 공포 | 해당 없음 | [원문](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=281649) | 2026-08-02 |
| `SRC-HUB-18` | 국토교통부·법제처 | 국가통합교통체계효율화법 시행규칙 | 국토교통부령 제1531호 | 2025-10-31 시행 | 해당 없음 | [원문](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20251031&lsiSeq=279469&urlMode=lsInfoP) | 2026-08-02 |
| `SRC-HUB-19` | 국토교통부 | ITS 표준노드링크 구축·관리지침 | 고시 제2023-23호 | 2023-01-06 시행 | 해당 없음 | [원문](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000218571) | 2026-08-02 |
| `SRC-HUB-20` | 국토교통부 | ITS 표준노드링크 구축·관리지침 현행 구축기준 | 고시 제2026-344호 | 2026-07-01 공포·시행 | 해당 없음 | [원문](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulId=32722&efYd=0) | 2026-08-02 |
| `SRC-HUB-21` | 공공데이터포털·국토교통부 | 교통량·돌발·예측 API 묶음 | Open API 3종, 등록 2019-10-18~21 | 2025-06-24 수정 | 해당 없음 | [교통량](https://www.data.go.kr/data/15040463/openapi.do)<br>[돌발](https://www.data.go.kr/data/15040465/openapi.do)<br>[예측](https://www.data.go.kr/data/15040507/openapi.do) | 2026-08-02 |
| `SRC-HUB-22` | 공공데이터포털·국토교통부 | 표준노드링크 파일 | 파일데이터, 등록 2019-07-19 | 2025-06-24 수정 | 해당 없음 | [원문](https://www.data.go.kr/data/15025526/fileData.do) | 2026-08-02 |
| `SRC-HUB-23` | 국토교통부 대도시권광역교통위원회 | 전국 MaaS 서비스 개시 | 보도자료 | 2024-10-28 | 해당 없음 | [원문](https://www.molit.go.kr/mtc/USR/N0201/m_36770/dtl.jsp?id=95090311&lcmspage=3) | 2026-08-02 |
| `SRC-HUB-24` | 국토교통부 스마트시티 종합포털 | 통합 모빌리티 플랫폼·Open API 소개 | 운영 소개 | 2024-12-13 | 해당 없음 | [원문](https://smartcity.go.kr/2024/12/13/%ED%86%B5%ED%95%A9%EB%AA%A8%EB%B9%8C%EB%A6%AC%ED%8B%B0%ED%94%8C%EB%9E%AB%ED%8F%BC/) | 2026-08-02 |
| `SRC-HUB-25` | 국토교통부·정책브리핑 | 전국 MaaS 민관협력 업무협약 | 보도자료 | 2023-04-07 | 해당 없음 | [원문](https://www.korea.kr/news/policyNewsView.do?newsId=148913608) | 2026-08-02 |
| `SRC-HUB-26` | 국토교통부 대도시권광역교통위원회 | 전국 MaaS 시범사업자 선정 | 보도자료 | 2023-01-18 | 해당 없음 | [원문](https://tilit.molit.go.kr/srocm/USR/N0201/m_13551/dtl.jsp?id=95087801&lcmspage=1) | 2026-08-02 |
| `SRC-HUB-27` | 국토교통부 | MaaS 협력포럼 보도자료 | 지속 운영 정황, 인터페이스 역량 증거에서 제외 | 2025-06-24 | 해당 없음 | [원문](https://www.molit.go.kr/USR/NEWS/m_71/dtl.jsp?id=95091017) | 2026-08-02 |
| `SRC-HUB-28` | 국토교통 데이터 통합채널 | Open API 안내 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://data.molit.go.kr/anals/open-api/guide) | 2026-08-02 |
| `SRC-HUB-29` | 국토교통부 | 국토교통 데이터 통합채널 홈페이지 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://data.molit.go.kr/) | 2026-08-02 |
| `SRC-HUB-30` | 국토교통부 | 국토교통 데이터 통합채널 서비스 개시 보도자료 | 역사적 근거 | 2021-02-25 | 해당 없음 | [원문](https://www.korea.kr/briefing/pressReleaseView.do?newsId=156438269) | 2026-08-02 |
| `SRC-HUB-31` | 공공데이터활용지원센터 | 공공데이터포털 데이터셋 검색 API | Open API | 2023-03-21 등록·수정 | 해당 없음 | [원문](https://www.data.go.kr/data/15112888/openapi.do) | 2026-08-02 |
| `SRC-HUB-32` | 공공데이터활용지원센터 | 공공데이터 목록 API | Open API, 등록 2021-02-09 | 2022-12-27 수정 | 해당 없음 | [원문](https://www.data.go.kr/data/15077093/openapi.do) | 2026-08-02 |
| `SRC-HUB-33` | 공공데이터포털·충청남도 | 포털 원본등록 파일과 자동변환 API 사례 | 파일데이터, 등록 2025-11-30 | 2025-12-12 수정 | 해당 없음 | [원문](https://www.data.go.kr/data/15118670/fileData.do) | 2026-08-02 |
| `SRC-HUB-34` | 행정안전부·한국지능정보사회진흥원 | 공공데이터포털 이용가이드 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://www.data.go.kr/ugs/selectPublicDataUseGuideView.do) | 2026-08-02 |
| `SRC-HUB-35` | 공공데이터활용지원센터 | 인증키·신청 관리 중단을 포함한 정기점검 공지 | 공지 | 2026-07-24 | 해당 없음 | [원문](https://www.data.go.kr/bbs/ntc/selectNotice.do?nttApiYn=N&originId=NOTICE_0000000004887&pageIndex=1&searchCondition2=2) | 2026-08-02 |
| `SRC-HUB-36` | 대한민국·법제처 | 공공데이터의 제공 및 이용 활성화에 관한 법률 | 시행본 | 2023-11-17 시행 | 해당 없음 | [원문](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20231117&lsiSeq=251023&urlMode=lsInfoP) | 2026-08-02 |
| `SRC-HUB-37` | 한국지능정보사회진흥원 | 데이터 원윈도우 구축·운영 소개 | 운영 소개 | 2025-09-10 | 해당 없음 | [원문](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28579&cbIdx=90549) | 2026-08-02 |
| `SRC-HUB-38` | 데이터 원윈도우·한국지능정보사회진흥원 | 사용자 이용안내 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://www.data1window.kr/noti/userInfo) | 2026-08-02 |
| `SRC-HUB-39` | 한국지능정보사회진흥원 | 플랫폼 간 메타데이터 카탈로그 및 데이터 원윈도우 연계 표준 | DCAT-AP 2.1 기반 공통·확장 field | 2025-10-31 | 해당 없음 | [원문](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=28715&cbIdx=26537&parentSeq=28715) | 2026-08-02 |
| `SRC-HUB-40` | 한국지능정보사회진흥원 | 국가데이터인프라 추진전략 | 추진전략 | 2024-08-05 | 해당 없음 | [원문](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=27081&cbIdx=90549) | 2026-08-02 |
| `SRC-HUB-41` | 데이터 원윈도우·한국지능정보사회진흥원 | 이용약관 | 약관 | 2025-01-01 시행 | 해당 없음 | [원문](https://www.data1window.kr/noti/terms) | 2026-08-02 |
| `SRC-HUB-42` | 한국지능정보사회진흥원 | 한국형 데이터 스페이스 참조모델 | v1.0 | 2026-03-27 | 해당 없음 | [원문](https://www.nia.or.kr/site/nia_kor/ex/bbs/ListBusiness.do?businessMnCd=23000900) | 2026-08-02 |
| `SRC-HUB-43` | 과학기술정보통신부·한국지능정보사회진흥원 | 일반산업 데이터 스페이스 기획 공모 | 2026년 말까지 기획사업, 운영 entitlement 증거에서 제외 | 2026-04-10 | 해당 없음 | [원문](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=29253&cbIdx=78336&parentSeq=29253) | 2026-08-02 |
| `SRC-HUB-44` | 국가교통 데이터 오픈마켓·한국도로공사 | 이용약관 | 약관 | 2024-07-30 최종 시행 | 해당 없음 | [원문](https://www.bigdata-transportation.kr/frn/tou) | 2026-08-02 |
| `SRC-HUB-45` | 국가교통 데이터 오픈마켓·한국도로공사 | 구매·외부데이터 안내 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://docs.bigdata-transportation.kr/open/open_2.html) | 2026-08-02 |
| `SRC-HUB-46` | 국가교통 데이터 오픈마켓·한국도로공사 | 구매가이드 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://www.bigdata-transportation.kr/howto/purchase) | 2026-08-02 |
| `SRC-HUB-47` | 국가교통 데이터 오픈마켓·한국도로공사 | 회원가입·판매자 자격 안내 | 상시 운영 페이지 | 발행일 미표기 | 해당 없음 | [원문](https://www.bigdata-transportation.kr/join) | 2026-08-02 |
| `SRC-HUB-48` | 한국지능정보사회진흥원 | 빅데이터 플랫폼 소식 | 플랫폼 출범 근거 | 2024-03-29 | 해당 없음 | [원문](https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?bcIdx=26535&cbIdx=26537&parentSeq=26535) | 2026-08-02 |
