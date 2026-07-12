# 갭 분석

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 비교 기준

- **(목적)** 현행 플랫폼 증거와 DSP Offering 종단 수명주기 사이의 미확보 capability 식별
- **(현재)** 공개 서비스, 공식 문서와 인증 브라우저 탐색에서 확인한 데이터 통합채널·원천 플랫폼 기능
- **(목표)** 기존 플랫폼 Dataset을 DSP Offering으로 온보딩하고 계약·전송을 platform access 수명주기에 연결할 수 있는 상태
- **(우선순위)** `P0` 실증 전 필수, `P1` 제한 데이터 전 필수, `P2` 연합 운영 전 필수
- **(종료 원칙)** 담당자 승인, 실행 가능한 endpoint, 시험 결과와 재현 가능한 증거를 모두 확보한 경우에만 갭 종료

## 2. 기능 갭

| 영역 | 현재 확인 상태 | 목표 상태 | 갭·조치 | 우선순위 |
| --- | --- | --- | --- | --- |
| 검색·발견 | 여러 유형을 통합 검색 | 포털·DCAT discovery와 DSP Catalog, 자격별 visibility 분리 | 검색 레코드 분류, DSP 승격 Gate, pagination·cache | P0 |
| 플랫폼 역할 | 일부 record의 원천 링크·빈 Distribution 확인, 전체 역할 미확인 | Dataset별 hosted·brokered·index-only 판정 | 데이터 관리대장과 payload·subscription 기능 증거 | P0 |
| 책임 식별 | 제공·관리기관 metadata 존재 | 원 보유기관·Offering Provider·Connector·계약·전달 운영자 분리 | 역할·위임·책임 증거와 participant ID 등록 | P0 |
| metadata export | 통합검색·분석 데이터셋 `GET` 문서와 신청 화면 존재; bulk·delta·SLA 미확인 | 지원되는 bulk·delta feed | HTTPS 기반 공식 API/SLA 또는 read view 확보 | P0 |
| Dataset·Distribution | 원천 URL·형태가 레코드마다 다름 | 자산과 제공형태 분리 | Dataset/Distribution/DataService 매핑 | P0 |
| license·권리 | 이용허락 정보가 있으나 이질적 | 권리·재제공·목적 판정 | 권리 인벤토리와 Data Product Passport | P0 |
| 계약 협상 | 세 Open API 모두 활용신청; read 2종 자동승인, 등록 `POST` 심의승인 | DSP Contract Negotiation 상태와 결과 Agreement | API 신청·승인과 DSP 계약을 분리하고 공개·제한별 negotiation profile 정의 | P0/P1 |
| 실제 전송 | 원천 API·파일·GIS로 분산 | 계약과 연결된 Data Plane | REST·file·OGC adapter | P0 |
| identity | 회원 로그인과 계정별 공통 API key 방식; 기관 자격 연합검증은 없음 | 참가자·기관 자격의 연합 검증 | 포털 계정·API key와 DSP participant identity를 분리하고 초기 OAuth·공개키 기반구조(Public Key Infrastructure, PKI), 제한 단계 DCP 비교 | P1 |
| policy 집행 | 활용신청·자동/심의승인 중심; quota·재제공 집행은 미확인 | Catalog·계약·전송·사후 통제 | ODRL profile과 evaluation function | P1 |
| 감사 | 마이페이지에 신청 현황은 있으나 조사 계정 이력 0건; 원천 호출 감사범위 미확인 | Agreement부터 source 호출까지 상관관계 | 공통 correlation ID와 불변 감사로그 | P1 |
| 정지·철회 | API별 처리 | 계약 종료 시 token·ACL·복제본 회수 | lifecycle·reconciliation 설계 | P1 |
| Offering lifecycle | 검색 record 수정 외 공식 동기화 미확인 | publish·update·suspend·withdraw와 tombstone | Offering adapter, version·delete reconciliation | P0 |
| 계약→구독 | DSP 계약과 플랫폼 신청·구독 연결 없음 | Agreement→entitlement·subscription·token mapping | 멱등 provisioning·보상·external ID 저장 | P0 |
| identity binding | 회원 로그인만 확인 | participant→platform organization·service identity | federation·service account·offboarding 계약 | P0/P1 |
| 의미 호환성 | 분야별 코드·공간표준 존재 | 공통 국토교통 데이터 제품 프로필 | CRS·시간·단위·node/link 필수화 | P0 |
| 운영 | 지원·장애정책이 원천마다 다름 | SLO, 재시도, 회로차단, DR | 운영 계약과 adapter별 runbook | P2 |
| 연합 Catalog | 중앙 검색은 존재 | 필요 시 Provider Catalog의 정책 보존 연합 | Bridge PoC 뒤 Broker 필요성·crawl·cache·provenance 결정 | P2 |
| 국가 카탈로그 연계 | 국가데이터인프라·국가 데이터 카탈로그와의 연계 여부 미조사 | 국토교통 profile과 국가 데이터 카탈로그의 crosswalk | 적용 profile version·연계 절차 확인(`C-061`) | P2 |

## 3. 법·보안 갭

| 영역 | 현재 위험 | 필요한 조치 | Gate |
| --- | --- | --- | --- |
| 검색과 제공 혼동 | 검색 항목을 제공 가능 자산으로 오인 | `catalog-only`와 transfer 상태 분리 | 아키텍처 승인 전 |
| 공개 데이터 재제한 | 회원·계약 조건이 기존 license 축소 | license와 운영 접근제어 분리 | Offer 등록 전 |
| Open API endpoint 도달성 | 문서상 host의 A 조회가 공개 resolver에서 실패 | 운영기관이 지원하는 hostname·접근망·DNS 구성 확인 | key 발급·실증 호출 전 |
| Open API 전송보안 | 문서화된 HTTP base URL로 `serviceKey` 평문 전송 위험 | 지원되는 HTTPS endpoint·인증서·TLS와 HTTP 차단정책 확인 | 실증 호출 전 |
| 제3자 권리 | metadata만으로 권리 확보 여부 불명 | 권리자와 이용허락 증거 확보 | payload 연결 전 |
| 개인정보·위치정보 | 이동경로 재식별·목적 외 제공 | 법적 근거, 최소화, 위험평가, 안전한 분석 | 제한 실증 전 |
| 교통카드 | 수신자의 재제공 금지 | 원 권한기관 직접 Provider 또는 제공 제외 | 자산 등록 전 |
| 공개제한 공간정보 | 인터넷 Catalog·cloud 반출 위험 | 등급 판정, 보안심사, 승인된 별도 영역 | 모든 외부 연결 전 |
| 국외처리 | 해외 cloud·원격접속 가능성 | 데이터별 국외이전·반출 정책 | 배포환경 선정 전 |
| 공공 인증·망 요건 | CSAP·ISMS-P·망분리·보안성 검토 적용 여부 미조사 | 배치 후보별 인증·망 요건과 심사 기간 확인(`R-038`) | Connector·CaaS 배치 선정 전 |

## 4. 구현 갭

현재 저장소의 `docs/blog/code/dsp-python`은 version discovery 학습용 scaffold다. 이 코드를 프로젝트 Connector로 재사용할 수 있다고 전제하지 않는다.

재사용 판단에는 다음 기능의 구현 증거가 필요하다.

- Catalog·negotiation·transfer
- identity·policy·persistence
- Data Plane

Connector 평가 담당자는 후보별 비교표와 시험 결과를 작성한다. 비교표에는 다음 항목을 포함한다.

- DSP 2025-1 errata 지원 수준과 conformance evidence
- Catalog Broker 구현 또는 확장 가능성
- Offering Management API의 publish·update·withdraw 동작과 계약시험 결과
- Agreement·Transfer event에서 external subscription을 provision·revoke하는 확장점
- Connector-as-a-Service의 tenant·secret·source network 경계
- REST·file·OGC·stream adapter 확장성
- ODRL policy function과 custom vocabulary의 확장 방식·시험 결과
- DCP·기존 공개키 기반구조(Public Key Infrastructure, PKI)·OAuth 연계 가능성
- PostgreSQL, Vault·하드웨어 보안 모듈(Hardware Security Module, HSM), audit·metrics의 배포 구성과 장애시험 결과
- 국내 공공망·기관망·보안영역 배포 가능성
- upgrade, 보안패치, 운영인력과 장기 유지비

## 5. P0 해소 순서

1. 통합채널 Dataset·delivery path별 `hosted·brokered·index-only·unknown` 판정에 필요한 운영기관 증거를 요청한다.
2. 실증 후보 자산의 원 보유기관, Offering Provider, 계약권한과 이용권리를 확인한다.
3. 운영기관이 지원하는 hostname, 접근망, DNS와 HTTPS·TLS 구성을 서면 또는 공식 문서로 확인한다.
4. 통합채널 metadata의 공식 baseline·delta·delete 연계 경로를 확정한다.
5. 플랫폼 subscription·entitlement·identity·revoke 기능을 확인하거나 PoC mock 계약을 고정한다.
6. DCAT·국토교통 metadata profile과 validation rule을 승인한다.
7. Connector 후보의 DSP version, Offering API, lifecycle 확장점과 배포 제약을 시험한다.
8. 공개 데이터로 Catalog→Agreement→platform access→Transfer→revoke→reconciliation 종단 실증을 수행한다.

## 6. 갭 종료 기준

- **(필수 증거)** 담당자 승인, DNS·HTTPS가 확인된 실행 가능한 endpoint, 시험 결과와 재현 가능한 증거
- **(종료 금지)** 문서 작성만으로 P0 갭을 종료하지 않음
- **(승인 해석)** read API metadata의 `confmNeedAt=N`은 신청 불필요가 아닌 자동승인으로 판정
- **(Content-Type)** 문서의 `applycation/json`은 실제 wire response 시험 전까지 규격값으로 사용하지 않음
- **(추적)** 각 요구사항과 증거는 [검증 계획](../03-plan/verification-plan.md)에서 연결
