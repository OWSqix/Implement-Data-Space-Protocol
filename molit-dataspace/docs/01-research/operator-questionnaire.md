# 운영기관 확인 질문

작성일: 2026-07-11  
상태: Draft  
진행: 답변 대기

## 1. 사용 목적과 증거 기준

- **(목적)** 기존 플랫폼 Bridge 방식의 데이터 스페이스 연결 가능 범위를 운영기관 증거로 판정
- **(질문 범위)** 분석센터 Open API, Dataset·delivery path별 역할, subscription·identity·종료 수명주기
- **(증거 기준)** 적용 서비스·Dataset, 발행부서, version·시행일이 있는 명세·운영정책·시험 결과 또는 승인 문서
- **(제한)** 구두 답변은 조사 단서로만 사용하며 P0 Gate 종료 증거에서 제외
- **(수집 금지)** API key, 비밀번호, cookie와 실제 개인정보

## 2. P0 Endpoint와 전송보안

- **(관찰)** 2026-07-11 화면은 `http://openapi.molit.go.kr`을 안내했으나 공개 DNS의 IPv4 주소 레코드(Address record, A record) 조회는 `SERVFAIL` 반환
- **(조사 환경)** 기본 resolver는 loopback 주소 반환
- **(Gate)** 운영 hostname·DNS·HTTPS 확인 전 key 발급과 API 호출 제외
- **(요청)** 다음 항목에 현재 적용되는 명세의 version·시행일 또는 실행시험 결과

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-001 | 현재 지원되는 운영·시험 hostname은 무엇인가 | 최신 API 명세 또는 운영 공지 | 미확인 |
| OP-Q-002 | 인터넷, 행정망, 기관망 중 어느 network에서 접근하는가 | network 구성·방화벽·IP allowlist 안내 | 미확인 |
| OP-Q-003 | public DNS와 split-horizon DNS 중 무엇을 사용하는가 | 권한 DNS의 A·AAAA·CNAME 또는 접속 절차 | 미확인 |
| OP-Q-004 | HTTPS URL과 최소 TLS version은 무엇인가 | 인증서 chain·hostname, TLS 정책 | 미확인 |
| OP-Q-005 | HTTP 요청은 차단되는가, HTTPS로 redirect되는가 | gateway 정책과 시험 결과 | 미확인 |
| OP-Q-006 | `serviceKey`를 query가 아닌 header로 보낼 수 있는가 | 인증 parameter 명세 | 미확인 |

## 3. API Contract

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-010 | 통합검색·분석 데이터셋 API가 공식 server-to-server 연계 API인가 | 지원 범위가 적힌 명세·공문 | 미확인 |
| OP-Q-011 | 운영 version과 versioning 정책은 무엇인가 | OpenAPI·JSON Schema·version 정책 | 미확인 |
| OP-Q-012 | 실제 request·response Content-Type은 무엇인가 | wire sample 또는 contract test; `applycation/json` 정정 여부 | 미확인 |
| OP-Q-013 | pagination의 최대 page size와 전체 export 방법은 무엇인가 | parameter·limit 명세 | 미확인 |
| OP-Q-014 | 수정분·삭제분을 수집할 delta 또는 change feed가 있는가 | `modifiedSince`, tombstone, cursor 또는 webhook 명세 | 미확인 |
| OP-Q-015 | rate limit, 일·분당 quota와 동시호출 제한은 무엇인가 | quota 정책과 응답 header·오류코드 | 미확인 |
| OP-Q-016 | timeout, 재시도, `Retry-After`와 idempotency 규칙은 무엇인가 | 오류 모델과 운영 가이드 | 미확인 |
| OP-Q-017 | 내부 단일 페이지 애플리케이션(Single-Page Application, SPA) `/api/*`와 외부 Open API의 지원 경계는 무엇인가 | 지원 endpoint 목록 | 미확인 |

## 4. Credential과 계정

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-020 | 계정당 한 개 key를 기관 service account로 사용할 수 있는가 | 계정·credential 정책 | 미확인 |
| OP-Q-021 | 중앙 proxy가 여러 DSP participant의 요청을 대신 호출할 수 있는가 | proxy·대행 허용 조항 | 미확인 |
| OP-Q-022 | key를 API·환경·용도별로 분리할 수 있는가 | scope·추가 key 발급 정책 | 미확인 |
| OP-Q-023 | key rotation·revoke·분실 신고 절차와 소요시간은 무엇인가 | 운영 절차·지원 연락처 | 미확인 |
| OP-Q-024 | 호출량과 책임을 participant·Agreement별로 구분할 수 있는가 | usage log·quota export 명세 | 미확인 |

## 5. Provider와 이용권리

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-030 | 검색 레코드별 실제 Provider와 계약권한자는 누구인가 | 데이터 관리대장·책임부서 | 미확인 |
| OP-Q-031 | 통합 채널이 원천 데이터를 proxy·cache·재제공할 권한이 있는가 | 법령·위임·원천기관 계약 | 미확인 |
| OP-Q-032 | 공개 URL을 DSP Distribution으로 추가 노출할 수 있는가 | 이용약관·license·출처 조건 | 미확인 |
| OP-Q-033 | 제한 데이터의 Catalog metadata 공개범위는 무엇인가 | 공개등급·보안심사 기준 | 미확인 |
| OP-Q-034 | 분석 데이터셋 API의 `license`, `accessRights`, `publisher`는 어떤 원천에서 관리되는가 | 필드 정의·steward·갱신 절차 | 미확인 |
| OP-Q-035 | 원천 수정·삭제·제공중단을 외부 연계자에게 어떻게 통지하는가 | 변경·삭제·중단 절차 | 미확인 |

## 6. 운영과 변경관리

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-040 | 가용시간, 응답시간, 복구목표와 지원시간은 무엇인가 | SLA·SLO 또는 운영정책 | 미확인 |
| OP-Q-041 | schema·endpoint·인증 변경의 사전 통지기간은 얼마인가 | 변경관리 정책 | 미확인 |
| OP-Q-042 | 개발·검증용 sandbox와 합성 데이터가 있는가 | sandbox 접속·데이터 정책 | 미확인 |
| OP-Q-043 | 장애·보안사고·key 유출 연락처와 처리절차는 무엇인가 | incident runbook·연락체계 | 미확인 |
| OP-Q-044 | API 사용로그를 어느 기간 보관하고 기관별로 제공할 수 있는가 | 감사·보존 정책 | 미확인 |

## 7. 플랫폼 역할과 Offering 범위

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-050 | 통합채널이 payload를 직접 저장·호스팅하는 Dataset은 무엇인가 | 데이터 관리대장, source system·운영 owner·Distribution 목록 | 미확인 |
| OP-Q-051 | 외부 기관 데이터를 통합채널이 중개하고 전달하는 Dataset은 무엇인가 | `brokered` 업무정의, 위탁·위임·책임분장, 대상 목록 | 미확인 |
| OP-Q-052 | 원천 landing URL만 제공하는 `index-only` record를 식별하는 field나 code가 있는가 | field 정의, 코드표, 대표 record | 미확인 |
| OP-Q-053 | `hosted·brokered·index-only·unknown` 역할은 Dataset·delivery path별로 바뀔 수 있으며 변경을 어떻게 통지하는가 | lifecycle·변경통지 정책 | 미확인 |
| OP-Q-054 | 통합채널 또는 지정 운영자가 DSP Offering Provider·계약 당사자가 될 수 있는 범위는 어디까지인가 | 법령·위임·계약과 Dataset별 authority matrix | 미확인 |
| OP-Q-055 | 원 보유기관, Publisher, 플랫폼 운영자, 계약 당사자와 전달 운영자를 구분하는 관리 필드가 있는가 | 데이터 관리 schema·책임분장 | 미확인 |
| OP-Q-056 | DSP Catalog에 게시 가능한 공개 Dataset을 선별하는 별도 승인절차가 가능한가 | 승인 workflow, 담당자, 취소·재검토 규칙 | 미확인 |
| OP-Q-057 | Dataset 비활성화·삭제 때 외부 연계처에 tombstone 또는 event를 보낼 수 있는가 | event schema, retry·보존·replay 정책 | 미확인 |

## 8. 계약·구독·접근 수명주기

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-060 | 이용신청·승인·구독을 server-to-server API로 생성·조회·해지할 수 있는가 | API·상태모델·sandbox 명세 | 미확인 |
| OP-Q-061 | 자동승인과 심의승인 상태를 어떤 code와 event로 구분하는가 | 상태표, 전이도, callback·polling 명세 | 미확인 |
| OP-Q-062 | 같은 계약요청이 재시도될 때 구독을 하나만 만드는 idempotency 기능이 있는가 | idempotency key·conflict 처리 계약시험 | 미확인 |
| OP-Q-063 | 계약 또는 Transfer별 API token·signed URL·ACL을 발급할 수 있는가 | token issuer, scope·audience·TTL·quota 명세 | 미확인 |
| OP-Q-064 | 접근 정지·재개·종료 명령과 완료 확인 방법은 무엇인가 | suspend·resume·revoke·delete API와 조회 결과 | 미확인 |
| OP-Q-065 | 구독 삭제가 기존 token, stream ACL, export·snapshot에도 적용되는가 | cascade·보존정책과 실제 sandbox 시험 | 미확인 |
| OP-Q-066 | Dataset 철회 시 신규 신청, 기존 승인·구독과 진행 중 전달을 어떻게 처리하는가 | withdrawal runbook·계약조건 | 미확인 |
| OP-Q-067 | callback 유실·중복·순서 뒤바뀜 뒤 상태를 맞추는 목록조회·reconciliation API가 있는가 | list/filter API, event replay, quota | 미확인 |
| OP-Q-068 | Agreement·Transfer ID 같은 외부 correlation ID를 플랫폼 감사기록에 보관할 수 있는가 | 허용 field·길이·검색 API·보존기간 | 미확인 |
| OP-Q-069 | 구독·token·source request·삭제 결과를 기관별로 export할 수 있는가 | audit schema, masking·보존·접근권한 | 미확인 |

## 9. Identity와 기관 계정

| ID | 질문 | 필요한 증거 | 상태 |
| --- | --- | --- | --- |
| OP-Q-070 | 개인 회원계정과 별도로 기관용 service account를 지원하는가 | 계정정책, 발급·offboarding 절차 | 미확인 |
| OP-Q-071 | 외부 데이터 스페이스 participant ID를 플랫폼 organization·tenant에 binding할 수 있는가 | federation·mapping 설계, 승인자 | 미확인 |
| OP-Q-072 | 별도 사람 회원가입 없이 기관 단위 접근을 provision하는 방식이 있는가 | SSO·OAuth federation·certificate·service identity 명세 | 미확인 |
| OP-Q-073 | participant 탈퇴·credential revoke·조직 변경을 플랫폼 권한에 반영하는 event 또는 API가 있는가 | identity lifecycle·revocation 명세 | 미확인 |
| OP-Q-074 | 기관별 quota와 감사가 개인용 공통 key 없이 분리되는가 | quota key, tenant·agreement별 usage report | 미확인 |

## 10. 1차 회신 요청 범위

- **(목적)** 소관 API·권리·신원·접근관리(Identity and Access Management, IAM) 부서 식별과 P0 조사 착수
- **(범위)** 1차 회신에서는 다음 질문 ID를 우선 요청

1. `OP-Q-001~006`: 현재 지원 hostname·접근망·HTTPS·인증방식
2. `OP-Q-010~017`: 공식 metadata server-to-server API와 baseline·delta·delete
3. `OP-Q-050~055`: `hosted·brokered·index-only·unknown` 대상과 Offering Provider 권한
4. `OP-Q-060`, `OP-Q-064~065`: subscription·revoke API와 삭제 의미
5. `OP-Q-070~072`: 기관용 identity·service account

1차 회신에서 담당 API·권리·IAM 부서를 식별한 뒤 나머지 질문을 소관별로 분리한다.

## 11. 회신 반영 절차

1. 답변 문서에 발행기관, 담당부서, 확인일과 적용 환경을 기록한다.
2. endpoint·schema·정책 문서를 evidence source로 등록한다.
3. 관련 claim과 requirement를 다시 판정한다.
   - Claim: `C-020`, `C-021`, `C-022`, `C-039`
   - Requirement: `R-003`, `R-004`, `R-010`, `R-027~R-031`
4. 승인된 hostname과 synthetic request로 DNS·TLS·Content-Type contract test를 수행한다.
5. `platformRecordRole`과 원 보유기관·Offering Provider·Connector·계약·전달 운영자를 Dataset Passport에 기록한다.
6. Provider·proxy·cache·subscription·identity 권한이 확인된 API만 Full Offering 실증 후보에 넣는다.
7. metadata만 확인된 source는 Discovery Bridge로 분리하고 full lifecycle 완료로 보고하지 않는다.
