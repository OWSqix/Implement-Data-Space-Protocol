# 프로젝트 헌장

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 문제 정의

- **(현행 공통 플랫폼)** 데이터 통합채널, 공공데이터포털, 통계누리, 국가교통정보센터와 VWorld 운영
- **(기관별 플랫폼)** 산하기관별 Data Lake와 Data Hub 운영
- **(기존 기능)** 각 플랫폼이 저장·검색·API·파일 배포·이용신청·구독을 자체 방식으로 처리

새 데이터 스페이스를 만든다고 이 기능을 다시 구축하면 원본이 둘로 나뉘고, 최신성·권리·운영책임도 함께 갈라진다. 반대로 기존 포털의 링크를 DSP Catalog에 복사하기만 하면 검색은 가능해도 계약과 전송은 작동하지 않는다.

- **(목적)** 거래 가능한 Offering을 선별하고 DSP 계약·전송 상태를 기존 플랫폼의 실제 접근권한과 연결
- **(범위)** 기존 플랫폼의 저장·검색·API·파일 배포 기능은 유지하고 Platform Bridge가 수명주기 변환 담당
- **(제외)** 기존 플랫폼 교체, 원본 일괄 이관과 검색 링크의 무검증 DSP Catalog 복사
- **(완료 판정)** 공개 데이터 PoC에서 Offering 게시부터 계약 종료 후 권한 회수까지 재현하고 감사 증거 확보

## 2. 조사 항목과 판정 기준

### 2.1 플랫폼 역할

- **(확인 대상)** 통합채널의 payload 직접 hosting, 기관 간 전달 brokerage 또는 위치 index 기능
- **(판정 단위)** 서비스 전체가 아닌 Dataset과 delivery path별 역할 차이
- **(필요 증거)** 원 데이터 보유기관과 DSP Offering Provider가 다를 때의 계약·재제공 권리와 위임 근거

### 2.2 Offering 온보딩

- **(입력)** DSP Dataset·Offer·Distribution·DataService 생성에 필요한 metadata와 권리정보
- **(수명주기)** 원천 record의 수정·비활성화·삭제를 Offering 상태에 동기화하는 절차
- **(판정 기준)** 검색 record와 거래 가능한 Offering을 구분하는 권리·Distribution·DataService 증거

### 2.3 계약과 플랫폼 권한

- **(상태 변환)** DSP Agreement를 기존 플랫폼의 subscription, entitlement, token, export job 또는 stream 접근제어목록(Access Control List, ACL)로 변환하는 규칙
- **(identity binding)** 데이터 스페이스 참가자의 identity를 기존 플랫폼 계정 또는 service identity에 연결하는 조건
- **(종료 검증)** 계약 종료와 Dataset 철회 뒤 외부 자원의 삭제 여부를 확인하는 reconciliation 증거

### 2.4 실제 전달

- **(전달 방식)** Dataset별 direct pull, gateway, snapshot, push, stream 또는 compute-to-data 적용 조건
- **(운영 책임)** source credential, quota, schema, 장애와 audit를 담당하는 운영자
- **(검증 분리)** DSP 상호운용 시험과 국토교통 도메인 의미·보안 적합성 시험의 범위

## 3. 목표와 산출물

1. MDS–Mobilithek과 기존 데이터 플랫폼의 데이터 스페이스 참여 사례를 1차 출처로 재구성한다.
2. 국토교통 통합채널을 `hosted`, `brokered`, `index-only` 관점에서 평가한다.
3. 기존 플랫폼과 Provider Connector 사이의 재사용 가능한 Bridge 구조를 정의한다.
4. 데이터 관리 역할과 계약·기술 역할을 분리한다.
   - 데이터 관리 역할: 원 보유기관, Publisher, 플랫폼 운영자
   - 계약·기술 역할: Offering Provider, Connector 운영자, 계약 당사자, 전달 운영자
5. metadata 수집부터 Offering 게시·수정·철회까지의 수명주기를 설계한다.
6. DSP Agreement와 플랫폼 subscription·entitlement의 상태 mapping과 보상·reconciliation을 설계한다.
7. REST, file, OGC, stream과 안전한 분석의 source binding·전송 경계를 정의한다.
8. 공개 데이터 한 건으로 종단 PoC를 수행할 수 있는 후보, Gate와 시험 절차를 마련한다.
9. 운영기관이 답해야 할 API, 권리, identity, SLA 질문을 문서화한다.

## 4. 적용 범위

### 4.1 포함

- MDS–Mobilithek과 MobiData BW 공식 사례 조사
- 기존 Data Lake·Data Hub·공공 플랫폼의 데이터 스페이스 연결 패턴
- 국토교통 통합채널의 공개·회원 화면 읽기 전용 조사
- DSP 2025-1 Catalog, Contract Negotiation, Transfer Process
- DCAT 3, ODRL과 국토교통 도메인 metadata
- Offering eligibility, publication, update, withdrawal
- Platform-to-Dataspace Bridge와 Connector/CaaS 배치 선택지
- identity binding과 subscription·entitlement orchestration
- REST, file, OGC, stream, compute-to-data 전달 패턴
- 권리·개인정보·교통카드·공간정보·보안 Gate
- 감사, 장애 보상, reconciliation, offboarding
- 공개 데이터 기반 mock·sandbox PoC

### 4.2 제외

- 모든 국토교통 데이터를 새 중앙 저장소로 이관
- 모든 검색 record를 자동으로 DSP Offering으로 등록
- DSP 규격 자체의 재구현
- 특정 Connector 또는 CaaS의 선결 채택
- 다음 민감 원천의 초기 PoC 사용
  - 실제 개인정보·원시 교통카드·번호판
  - 폐쇄회로 텔레비전(Closed-Circuit Television, CCTV) 영상·개인 이동경로
- 공개제한 공간정보의 승인 전 외부망·public cloud 전송
- 운영기관 승인 없는 이용신청·API key 발급·상태 변경
- 브라우저 내부 API를 production 연계 계약으로 가정
- DSP Agreement로 법적 제공근거나 기관 보안승인을 대체

## 5. 산출물과 완료 조건

| 산출물 | 완료 조건 |
| --- | --- |
| 참조 사례 | MDS–Mobilithek의 역할·metadata·계약·구독·전달을 확인 사실과 미확인으로 분리 |
| 플랫폼 연결 패턴 | discovery-only부터 full lifecycle bridge까지 선택 조건과 책임 명시 |
| MOLIT 역량 프로필 | `hosted·brokered·index-only·unknown` 판정과 근거·미확인 질문 연결 |
| 운영기관 질문서 | endpoint, 권리, identity, subscription, 변경, SLA별 증거 요청 정의 |
| 권리 인벤토리 | 후보별 원 보유기관, Offering Provider, 계약권한, 재제공·credential 권한 기록 |
| 요구사항 기준선 | Offering·platform lifecycle 요구사항에 고유 ID와 시험 연결 |
| 목표 아키텍처 | Bridge, Connector, 기존 플랫폼, 데이터 스페이스의 책임 경계 명시 |
| 인터페이스 계약 | metadata, source, subscription, identity, event, audit의 southbound 계약 정의 |
| PoC 계획 | 후보, 진입·종료 Gate, mock·sandbox·실제 source 단계와 증거 정의 |
| 위험·ADR | 선택지, 잔여위험, 승인자와 재검토 조건 기록 |

## 6. 책임 모델

기관명이 아니라 역할로 먼저 정의한다. 한 기관이 여러 역할을 맡을 때도 Dataset Passport에는 각각 기록한다.

| 역할 | 주요 책임 |
| --- | --- |
| 원 데이터 보유기관 | 법적 제공 판단, 원천 품질, 원천 변경 |
| Publisher·Steward | metadata, schema, 품질지표, 연락처 |
| 기존 플랫폼 운영자 | host·broker·index 기능, source·subscription API, SLA |
| Offering Provider Participant | Offer, Agreement, 제공조건과 계약 책임 |
| Connector 운영자 | DSP endpoint, 상태·policy·secret·upgrade 운영 |
| Data Delivery Operator | source binding, token·ACL·snapshot·payload 전달 |
| 데이터 스페이스 운영자 | 참가자 신뢰, 공통 profile, 검색·지원·적합성 기준 |
| Catalog Broker 운영자 | Provider Offering 수집, provenance·visibility 보존 |
| 법무·개인정보·공간정보·보안 승인자 | 권리, 등급, 배포환경, 전달·보유·파기 승인 |
| 소비기관 | 목적·자격 증명, Agreement 준수, 사용·삭제 증적 |

국토교통 통합채널이 어떤 역할을 맡을지는 조사와 거버넌스 결정의 결과다. 헌장에서 중앙 Broker 또는 단일 Provider로 확정하지 않는다.

## 7. 검증 가능한 성공 기준

- PoC Offering이 실제 payload 또는 실행 가능한 서비스로 이어진다.
- 원 보유기관과 Offering Provider가 다르면 계약·재제공 권한 증거가 있다.
- Catalog-only record에는 DSP Offer를 만들지 않는다.
- public Catalog의 DataService가 Provider Connector를 가리키고 source secret·내부 URL은 비공개 binding에 남는다.
- DSP Agreement와 platform subscription·entitlement·Transfer·source request를 하나의 감사 흐름으로 추적할 수 있다.
- 계약 종료·만료·철회 뒤 token, ACL, subscription과 임시 object가 제거된다.
- metadata 수정·삭제가 정의된 reconciliation 절차로 Catalog에 반영된다.
- 공개 데이터의 기존 license가 DSP Offer로 축소되지 않는다.
- timeout, quota, duplicate event, Connector restart와 정리 실패를 재현해 안전한 최종 상태를 확인한다.
- 미확인 사실을 운영 사실이나 규격 요구사항으로 서술한 문장이 없다.

## 8. Dataset별 중단 조건

- 실제 payload 또는 승인된 실행 서비스가 없음
- Offering Provider와 계약·재제공 권한을 확인할 수 없음
- 공식 server-to-server 연계 인터페이스를 확보할 수 없음
- 플랫폼이 contract 종료 후 접근 철회 또는 증적을 제공할 수 없음
- 원천 약관이 필요한 proxy·credential 대행·cache·subscription을 허용하지 않음
- 공개 license와 제안한 ODRL Offer가 충돌함
- 개인정보 처리근거, 공간정보 보안심사 또는 필수 보안검토가 완료되지 않음
- source schema·quota·SLA가 PoC 종료조건을 검증하기에 부족함

중단 조건에 해당하는 record는 `catalog-only`, `pending` 또는 `excluded`로 전환하고 판정 근거를 기록한다. Dataset별 중단은 프로젝트 전체 중단과 구분한다.

## 9. 검증 대기 가정

- 기존 플랫폼은 최소한 metadata export 또는 재현 가능한 수동 export를 제공할 수 있다.
- 첫 PoC는 공개 license와 전달권한이 확인된 데이터만 사용한다.
- 운영 플랫폼 API가 확인되기 전에는 mock platform으로 상태·보상·reconciliation을 시험한다.
- 제한 데이터는 합성·집계 데이터로 통제 흐름만 검증한다.
- Connector 구현, CaaS, identity와 배포 위치는 비교시험과 ADR 뒤에 정한다.

## 10. 미결정 사항과 종료 기준

- 통합채널 Dataset·delivery path별 `hosted·brokered·index-only·unknown` 판정
- Offering Provider와 계약 당사자, Connector·Delivery 운영자
- metadata baseline·delta·delete용 공식 endpoint
- 기관용 identity federation·service account·quota 정책
- subscription·entitlement·token 생성·삭제 API
- Connector 제품, CaaS, 지원 DSP/DCP version
- direct, gateway, snapshot, stream 전달 profile
- Catalog Broker의 필요 여부와 운영기관
- public/private network, 국내 리전, 보안영역 배치
- 국토교통 metadata·ODRL profile URI와 owner
- cache·보유·파기·국외처리·파생데이터 정책

미결정 사항은 운영기관 답변, 공식 문서, contract test 또는 ADR로 종료한다. 종료 전까지 설계 사실로 사용하지 않는다.
