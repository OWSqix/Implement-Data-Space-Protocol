# 현행 플랫폼 조사

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 조사 목적과 잠정 판정

- **(목적)** 국토교통 데이터 통합채널과 원천 플랫폼의 역할·interface·권한을 Dataset별로 판정
- **(잠정 판정)** 통합채널은 metadata 검색과 원천 안내 기능이 확인됐으나 payload hosting과 계약·구독 brokerage는 미확인
- **(설계 제한)** 운영기관 증거와 실행시험을 확보하기 전까지 전체 레코드를 DSP Offering으로 전환하지 않음

확인 대상은 다음과 같다.

1. Dataset별 payload `hosted·brokered·index-only·unknown` 역할
2. 검색 레코드에서 실제 payload까지의 전달 경로
3. 공식 지원 API·파일·지리정보시스템(Geographic Information System, GIS) interface
4. 원 보유기관, Offering Provider, 계약 당사자, Connector와 전달 운영자
5. DSP Agreement와 platform subscription·entitlement·token의 연결 가능성
6. DSP 연계 전 운영기관이 제공해야 할 증거

## 2. 조사 범위와 방법

- 국토교통부·정부·공공데이터포털·국가법령정보센터 등 1차 출처 우선
- 공개 웹 화면과 네트워크 응답의 관찰 결과를 공식 규범과 구분
- 2026-07-11 회원 계정으로 마이페이지, Open API 목록·상세·활용신청 화면과 브라우저 네트워크 요청을 읽기 전용 확인
- 인증정보와 session 값은 증거에서 제외. 근거: `SRC-MOLIT-009`
- `Verified`는 공식 문서나 현재 서비스에서 확인된 사실이다.
- `Inferred`는 확인된 사실을 바탕으로 한 설계 판단이다.
- `Unverified`는 운영기관 확인이 필요한 사항이다.
- 출처 ID는 [source-register.yaml](../../evidence/source-register.yaml)에 정의한다.

## 3. 데이터 통합채널의 역할 판정

### 3.1 확인된 사실

- **(확인 범위)** metadata 검색, 원천 안내, 회원·기관정보 처리와 일부 Open API 문서
- **(제한)** 검색 가능 여부는 payload 보유, 계약 대행 또는 재배포 권한의 증거가 아님

- `Verified` 국토교통 데이터 통합 채널은 국토교통 분야에 흩어진 데이터의 소재를 통합 검색하고 활용·분석 정보를 제공하기 위해 개통됐다. 개통자료는 자동차365, 세움터, 공공데이터포털 등을 포함한 약 130개 정보시스템 연계를 설명한다. 근거: `SRC-MOLIT-001`, `SRC-MOLIT-002`.
- `Verified` 현재 검색 초기화 응답은 개방 데이터, 공개 데이터, 기관·시스템, 활용·통계 데이터, 창업정보·게시물을 서로 다른 검색 유형으로 구분한다. 근거: `SRC-MOLIT-003`.
- `Verified` 개별 상세 레코드는 제공기관·관리부서·공개 여부와 이용허락을 포함할 수 있다. 근거: `SRC-MOLIT-001`
- `Verified` 갱신주기·제공형태·원천 URL을 포함하거나 실제 파일 대신 원천 시스템으로 이동시키는 항목도 존재. 근거: `SRC-MOLIT-001`
- `Verified` 검색 결과에는 열람 이외의 제공이 제한된 자료도 존재한다. 검색 가능하다는 이유만으로 재배포 가능한 데이터라고 판단할 수 없다. 근거: `SRC-MOLIT-001`, `SRC-LAW-002`.
- `Verified` 국토교통부 개인정보처리방침은 데이터 통합 채널 회원·기관정보의 처리와 운영 책임부서를 확인하는 근거지만, 원천 데이터의 계약·재제공 권한을 통합 채널에 부여하는 문서는 아니다. 근거: `SRC-MOLIT-008`.

### 3.2 설계 판단

- **(판정)** 단일 원시 데이터 저장소보다 metadata·검색·원천 안내 허브의 성격이 강함
- **(보류)** 서비스 전체의 payload host·broker 기능 부재는 확인되지 않았으므로 단정하지 않음

- `Inferred` 현재 관찰한 기능은 단일 원시 데이터 저장소보다 metadata·검색·원천 안내 허브의 성격이 강하다. 다만 서비스 전체의 payload host·broker 기능이 없다는 결론은 아니다.
- `Inferred` 통합 채널의 레코드 전체를 자동으로 DSP `Dataset`과 Offer로 변환하면 열람 전용 자료, 정보시스템 소개, 분석사례까지 전송 가능한 자산으로 오인할 수 있다.
- `Decision candidate` 레코드는 최소한 `catalog-only`, `transferable`, `secure-analysis`, `excluded`로 분류한다. `catalog-only`는 포털·DCAT discovery에만 투영하고, Offer·Distribution·DataService가 없는 DSP Catalog Dataset으로 만들지 않는다.

## 4. 실제 제공 경로

| 시스템 | 확인된 제공방식 | 인증·운영 특성 | DSP 연계 시사점 |
| --- | --- | --- | --- |
| 국토교통 통계누리 | REST/JSON, 시계열 조회 | 인증키, 신청·승인, 요청 범위 제한 | HTTP pull adapter와 quota 정책 필요 |
| 국가교통정보센터 | REST API와 파일 | 인증키, 실시간·파일 데이터 혼재 | API와 finite snapshot을 별도 Distribution으로 모델링 |
| VWorld | WMS, WFS, WMTS, REST | layer·BBOX·traffic 조건 | OGC proxy와 CRS·layer 정책 필요 |
| 공공데이터포털 | REST, LINK API, 파일 | API별 승인·호출량·이용허락 상이 | 원천별 credential과 license 승계 필요 |
| 기관 자체 시스템 | 파일·웹페이지·API 등 | 지원 범위 미확인 | 공식 server-to-server 계약 없이는 연계 금지 |

근거: `SRC-MOLIT-005`, `SRC-MOLIT-006`, `SRC-MOLIT-007`, `SRC-LAW-002`.

## 5. 분석센터 Open API

### 5.1 문서와 인증 화면에서 확인된 내용

`Verified` 데이터 통합 채널은 협력형 분석센터에 다음 세 Open API를 문서화한다. 세 API 모두 활용신청이 필요하며 하나의 계정별 인증키를 공통으로 사용한다. 근거: `SRC-MOLIT-004`, `SRC-MOLIT-009`.

| API | Method | 승인 방식 | 확인한 용도 |
| --- | --- | --- | --- |
| 통합검색 | `GET` | 자동승인 | 분석센터 통합검색 |
| 분석 데이터셋 조회 | `GET` | 자동승인 | 특정 분석 데이터셋 조회 |
| 분석과제 등록 | `POST` | 심의승인 | 분석과제 등록; 가이드상 통상 2~3일 |

- `Verified` 분석 데이터셋 응답 문서는 제목·설명·제공기관·접근권한과 license 필드 제시
- `Verified` 시간범위·발행일·수정일 필드와 read API metadata의 `confmNeedAt=N` 확인

`Inferred` 세 API 모두 활용신청이 필요하고 read API 2종이 자동승인으로 표시된 사실을 함께 보면, `confmNeedAt=N`은 신청 불필요가 아니라 신청 후 심의가 필요하지 않은 자동승인으로 해석해야 한다.

`Verified` 로그인 후 마이페이지에서 관심데이터, 문의, 품질오류 현황을 확인할 수 있다. 현재 조사 계정에는 발급된 인증키와 활용신청 이력이 모두 0건이며, 이번 조사에서는 인증키 발급이나 활용신청을 수행하지 않았다.

`Verified` 문서의 base URL은 `http://openapi.molit.go.kr`로 표기되어 있고 Content-Type 예시에는 `application/json` 대신 `applycation/json`이라는 오탈자가 있다. 구현 시 오탈자를 규격으로 복제하지 말고 실제 wire response와 운영기관의 정정 내용을 확인해야 한다.

### 5.2 보안 Gate와 운영 확인이 필요한 내용

`Inferred` 문서대로 HTTP endpoint에 `serviceKey`를 전송하면 네트워크 구간에서 인증키와 요청 내용이 평문으로 노출될 수 있다. 운영기관이 지원 대상 HTTPS endpoint와 인증서 구성을 확인해 주기 전에는 실증 요청을 보내지 않는다.

- `Verified observation` 2026-07-11 공개 DNS의 IPv4 주소 레코드(Address record, A record) 조회에서 `openapi.molit.go.kr`은 `SERVFAIL` 반환
- `Verified observation` 조사 환경의 기본 resolver는 같은 host에 `127.0.0.1`을 반환하고 비교 대상 `data.molit.go.kr`은 공인 A record 반환
- `Verified observation` 인증키 없는 HTTP·HTTPS 요청은 HTTP response 이전의 이름해석 단계에서 실패. 근거: `SRC-MOLIT-010`
- `Unverified` 관찰 결과만으로 API 폐지, HTTPS 미지원, 일시 장애, 기관망 전용 DNS 또는 host 이전 여부를 구분할 수 없음
- `Decision` 현재 지원되는 hostname과 접근망을 먼저 확인하고 과거 인터넷 프로토콜(Internet Protocol, IP) 주소 직접 호출과 Host header 우회 시험은 제외

인증 화면과 문서만으로 다음 운영 조건은 확인되지 않았다.

- 현재 지원되는 운영·시험 hostname, DNS 접근범위와 HTTPS base URL
- TLS 인증서·최소 version과 HTTP 차단 또는 redirect 정책
- 운영·개발 endpoint 구분
- 계정별 공통 인증키를 기관 공용 또는 중앙 proxy credential로 사용할 수 있는지
- 호출량·timeout·pagination 한도와 대량 export 지원 범위
- schema와 endpoint 변경 통지 기간
- 장애·복구·지원 SLA
- Catalog 수집용 bulk export 또는 delta feed 제공 여부
- `applycation/json` 표기가 단순 문서 오탈자인지와 실제 Content-Type

## 6. 내부 웹 API 사용 원칙

- **(공개 화면)** 단일 페이지 애플리케이션(Single-Page Application, SPA)의 `/api/search/init`, `/api/search`, `/api/search/detail/*` 호출 확인
- **(로그인 화면)** SPA 관리 요청의 session cookie와 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 보호 확인
- **(용도)** 내부 endpoint는 현행 화면 구조 조사에만 사용
- **(제한)** 인증 성공 여부를 공식 server-to-server interface, 고정 schema 또는 운영 지원 계약의 증거로 사용하지 않음

권장 우선순위는 다음과 같다.

1. 공식 metadata export 또는 change feed
2. 운영기관이 보장하는 server-to-server API
3. 승인된 read replica 또는 데이터베이스(Database, DB) view
4. 최후 수단으로 제한된 crawler 사용 검토

Crawler를 사용하더라도 권리, robots 정책, 호출량, 변경 탐지, 삭제 동기화와 장애 대응을 별도로 승인받아야 한다.

## 7. 플랫폼 역할과 Provider 권한

`Verified` 통합 채널은 여러 기관의 데이터 소재를 수집하지만, 원천 데이터의 법적 제공자와 정책 책임자가 통합 채널이라고 명시한 근거는 데이터별로 확인해야 한다.

`Verified observation` 대표 record 일부는 원천 landing URL을 가리키며 Distribution이 비어 있었다. 이는 적어도 일부 record가 `index-only`일 수 있다는 증거다. 통합채널 전체가 index-only라는 뜻은 아니다. 근거: `SRC-MOLIT-009`.

`Unverified` 통합채널이 직접 payload를 host하는 Dataset 목록, 원 제공자를 대신해 subscription·token을 관리하는 broker 기능, 이를 DSP Agreement와 연결할 server-to-server API는 확인되지 않았다.

`Decision` 책임 모델을 미리 하나로 고정하지 않고 Dataset별로 다음 역할을 기록한다.

- 원 데이터 보유기관과 Publisher·steward
- 플랫폼 운영자와 `hosted·brokered·index-only·unknown` 판정
- DSP Offering Provider와 계약 당사자
- Connector 운영자와 Data Delivery Operator
- 위임이 있다면 범위·기간·재제공·credential·사고 책임

- **(hosted·brokered)** 플랫폼 단위 Bridge·Connector 후보로 분류
- **(index-only)** discovery-only로 유지하거나 실제 원천기관 Provider에 연결
- **(Catalog Broker)** 이미 게시된 Provider Offering의 연합 필요성이 확인된 경우에만 별도 검토

## 8. 조사 한계와 금지된 해석

- 회원 로그인과 마이페이지·Open API 신청 화면은 확인했지만, 별도 기관 승인이나 역할이 필요한 기능의 전체 범위는 확인하지 않았다.
- 현재 계정은 인증키와 활용신청 이력이 0건이다. 키를 발급하거나 신청하지 않았으므로 실제 payload, 오류응답과 quota를 시험하지 않았다. 문서상 host는 DNS 단계에서 실패해 TLS handshake도 수행하지 못했다.
- 원천기관별 약관과 내부 위임문서는 확보하지 않았다.
- 검색 건수와 정보시스템 수는 계속 변하므로 설계 기준으로 사용하지 않았다.
- 법적 제공 가능성은 데이터셋·컬럼·수신자·목적별 검토가 필요하다.

## 9. 후속 조사와 요구 증거

질문과 요구 증거의 상세 형식은 [운영기관 확인 질문](operator-questionnaire.md)에 정리한다.

| 질문 | 확인 주체 | 필요한 증거 |
| --- | --- | --- |
| Catalog 대량 export가 가능한가 | 통합 채널 운영자 | API 명세, schema, SLA |
| 통합채널이 host·broker·index하는 Dataset은 무엇인가 | 통합 채널 운영자 | 데이터 관리대장, 기능·책임 분류 |
| 데이터별 원 보유기관·Offering Provider·계약 당사자는 누구인가 | 국토부·원천기관 | 데이터 관리대장, 위임·계약 문서 |
| 중앙 proxy가 원천 API 약관상 가능한가 | 원천기관·법무 | 이용약관, 별도 합의 |
| 계정별 공통 인증키를 기관 공용·중앙 proxy용으로 사용할 수 있는가 | 통합 채널 운영자 | credential 정책, quota 문서 |
| 현재 지원되는 hostname과 접근망은 무엇인가 | 통합 채널 운영자 | 운영·시험 URL, DNS·방화벽 구성, 이전 공지 |
| 인증키를 안전하게 전송할 HTTPS endpoint가 지원되는가 | 통합 채널 운영자 | 지원 URL, 인증서·TLS 시험, HTTP 차단정책 |
| 삭제·수정 이벤트를 받을 수 있는가 | 통합 채널·원천기관 | webhook/change feed 명세 |
| Agreement에 맞춰 subscription·token을 생성·삭제할 수 있는가 | 통합 채널·원천 플랫폼 | API 명세, sandbox와 감사기록 |
| 데이터 스페이스 identity를 플랫폼 기관계정에 연결할 수 있는가 | IAM·통합 채널 운영자 | federation·service account 정책 |
| 공개제한·개인정보 레코드의 Catalog 노출 범위는 | 법무·보안 담당 | 등급 판정과 승인 기록 |
