# 보안·신뢰·운영 설계

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적과 보안 범위

보안 설계는 participant identity부터 source request와 자원 회수까지의 경계를 대상으로 한다. 공개 데이터와 제한 데이터는 같은 전송·운영 경로를 사용하지 않는다.

1. 권한 있는 참가자만 Catalog, 계약과 payload에 접근한다.
2. source credential과 내부 endpoint를 소비자에게 노출하지 않는다.
3. 공개, 기관 제한, 개인정보·가명정보, 공개제한 공간정보의 경로를 분리한다.
4. local Agreement 만료·철회 정책 event를 활성 Transfer의 DSP Suspension·Termination과 token·접근제어목록(Access Control List, ACL)·임시자원 회수로 연결한다.
5. 참가자부터 source request까지 변조 탐지 가능한 감사를 제공한다.
6. 중앙 Broker나 한 원천의 장애·침해가 전체 연합으로 확산되지 않게 한다.

## 2. 신뢰 모델

### 2.1 Credential 분리

| 종류 | 목적 | 보관·발급 주체 |
| --- | --- | --- |
| Participant identity·qualification | 기관 신원과 공공기관·연구기관 등 자격 | 거버넌스가 신뢰하는 issuer, participant wallet/service |
| DSP request token | Connector 간 요청 인증 | participant STS 또는 채택한 auth profile |
| Platform organization·service identity | 기존 플랫폼 tenant·기관·service account | 플랫폼 IAM 또는 승인된 federation·credential broker |
| Source credential | 통계누리·지능형교통체계(Intelligent Transport Systems, ITS)·VWorld·기관 API 호출 | Provider Secret Store |
| Data Plane access token | 계약별 임시 payload 접근 | Provider Data Plane/STS |
| Administrator credential | 관리 API와 운영 작업 | 중앙 IAM/PAM |

이 credential을 하나의 API key나 token으로 통합하지 않는다.

### 2.2 단계적 identity

- 공개 실증: TLS, Connector identity와 최소한의 OAuth2·JSON 웹 토큰(JSON Web Token, JWT) 또는 상호 합의한 인증
- 기관 제한: participant registry, 기관 자격 claim, issuer·revocation 운영
- 연합 상호운용: DCP 1.0의 DID·VC 도입 여부를 spike와 ADR로 결정

DCP는 credential 제시·검증 절차를 제공하지만 trust anchor와 자격요건을 정하지 않는다.

## 3. 데이터 등급과 경로

| 등급 | Catalog | 전송·분석 환경 | 필수 Gate |
| --- | --- | --- | --- |
| 공개 | 전체 metadata | public Data Plane 또는 원천 direct | license·Provider 확인 |
| 등록형 공개 | 전체 metadata | 인증·quota가 있는 public Data Plane | 원천 credential 정책 |
| 기관 제한 | 자격별 최소 metadata | 기관용 통제 Data Plane | 수신자·목적·기간 승인 |
| 개인정보·가명정보 | 최소·비식별 metadata | privacy zone·secure analysis | 법적 근거·위험평가·필요 시 결합전문기관 |
| 공개제한 공간정보 | 외부 미노출 또는 추상화 | 승인된 security zone | 공간정보 보안심사 |
| 비공개·기반시설 | 외부 Catalog 제외 | 별도 폐쇄환경 검토 | 법·보안기관 승인 |

업무상 `민감 데이터`와 개인정보 보호법상 법정 `민감정보`를 구분한다.

### 3.1 국내 공공 배치 기준

Connector·Bridge·CaaS의 배치 결정에는 데이터 등급과 별도로 국내 공공 부문 요건을 확인한다. 다음 항목은 배치 후보 비교와 운영기관 협의에서 확인해야 할 조사 항목이며, 확인 전에는 특정 배치를 승인된 것으로 서술하지 않는다.

- public cloud 또는 CaaS 배치는 클라우드컴퓨팅법에 따른 보안인증(CSAP)의 적용 대상과 인증 등급·범위를 확인한다. 근거: `SRC-LAW-014`.
- 운영 주체의 정보보호 관리체계(ISMS-P 등) 인증 의무와 적용 범위를 확인한다.
- 원천 시스템이 행정망·기관망 등 분리된 망에 있는 경우 망 연계 방식, 망분리 예외 승인과 중계 구간 통제를 확인한다.
- 기관 보안성 검토·사전 협의 절차와 소요 기간을 배치 일정에 반영한다.
- 조달 규정이 Connector·CaaS 제품 선택과 계약 방식에 두는 제약을 확인한다.

확인 결과는 Dataset Passport의 배포환경 항목과 [위험 대장](../03-plan/risk-register.md)의 `R-038`에 연결한다.

## 4. Trust zone과 통신

- Public DSP endpoint와 management API를 서로 다른 listener·route·network policy로 분리한다.
- management API는 public ingress에 노출하지 않는다.
- Data Plane은 등록된 source host로만 egress할 수 있다.
- source zone은 service account·mTLS 또는 승인된 기관 인증을 사용한다.
- 사람 비밀번호·browser cookie·사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 방어 token·개인용 API key는 Bridge 또는 CaaS service identity로 사용하지 않는다.
- dataspace participant와 platform tenant binding에는 승인자, scope, expiry와 revoke 절차를 둔다.
- 공개제한·개인정보 영역은 일반 Data Plane과 cluster·account·key를 분리하는 방안을 우선한다.
- 모든 외부 통신은 TLS를 사용하고 certificate·key rotation을 운영한다.
- 소비자가 제공한 callback·sink URL은 사전 검증하고 loopback·link-local·private·reserved·cloud metadata service 주소를 차단한다.
- 승인된 private source는 등록된 DNS view, hostname과 port 안에서만 허용한다.
- 등록된 클래스 없는 도메인 간 라우팅(Classless Inter-Domain Routing, CIDR) 범위와 egress zone도 벗어나면 안 된다.
- 등록과 호출 시 DNS를 다시 해석한다. rebinding, 예상 밖 정규 이름(Canonical Name, CNAME)과 승인 범위 이탈은 차단한다.
- public DSP endpoint에는 rate limit, 요청 크기 한도와 동시 negotiation 상한을 적용해 Control Plane 자체를 보호한다.
- DSP 메시지의 JSON-LD 처리는 배포에 고정된 context만 사용하고 원격 context 조회를 비활성화한다.

공개 metadata projection에는 다음 제약을 적용한다.

- access·download·endpoint·landing URL은 query·fragment가 없는 HTTPS IRI로 발급한다.
- 개인 mailbox 대신 release policy와 RDF support registry에 정확한 IRI로 함께 등록한 기관 role mailbox만 공개한다. domain·local-part pattern은 승인 근거가 아니다.
- 0.1.0은 기관 대표번호를 포함한 `vcard:hasTelephone`을 전면 금지한다. `foaf:Person`, `vcard:Individual`, `prov:Person`, `schema:Person`과 개인 전자우편·주민등록번호 형식도 공개 graph에서 거부한다.
- NamedNode scheme은 HTTP·HTTPS와 승인 role mailbox의 `mailto`만 허용한다.
- 접근·서비스 URL은 stable-host allowlist, 다른 HTTP(S) IRI는 release의 exact public-host registry로 제한한다. Registry는 DNS 이름만 받으며 IPv4·IPv6 literal은 허용하지 않는다.
- metadata URL을 호출하는 구성요소는 승인 DNS 이름을 사용하더라도 IANA 특수·예약·미할당 주소와 IPv4-mapped IPv6를 DNS 해석, redirect와 접속 시점마다 다시 차단한다.
- 공개 안전검사에 실패한 graph는 SHACL 실행 전 quarantine한다.

고정 SHACL bundle은 위 preflight를 포함하지 않는다. 전체 게시 Gate는 release lock 검증, fatal UTF-8 parse, 공개 graph preflight, Core·Geo routing, SHACL 순서로 실행한다.

Validation report의 profile bundle digest와 국토교통 validator build digest를 함께 감사한다.

## 5. 위협과 통제

| 위협 | 예방 | 탐지·대응 |
| --- | --- | --- |
| 허위 Provider·participant | registry, issuer allowlist, signature 검증 | credential·issuer 이상 경보, 즉시 revoke |
| Catalog를 통한 정보노출 | visibility policy, 최소 metadata | 비인가 query test, access audit |
| 서버 측 요청 위조(Server-Side Request Forgery, SSRF)·source 우회 | immutable private source binding, public callback·sink의 private-address 차단, private source의 DNS·CIDR·egress allowlist | 비정상 destination·DNS·redirect 경보 |
| API key 유출 | Vault·하드웨어 보안 모듈(Hardware Security Module, HSM), reference only, log masking | secret scanning, rotation, source usage anomaly |
| 계약 우회 | Agreement binding token, policy 재평가 | agreement 없는 요청 탐지·차단 |
| 과도한 query·비용공격 | query allowlist, quota, timeout, budget | rate·cost·lag metric과 circuit breaker |
| 재식별 | 최소화, aggregation, secure analysis | 결과 반출 검토, privacy attack test |
| 정밀 공간정보 유출 | 등급별 layer·경계 상자(Bounding Box, BBOX)·precision 통제 | 다운로드·반출 audit와 이상량 경보 |
| replay·중복 | short TTL, nonce/jti, idempotency key | duplicate·replay metric과 상태 검증 |
| 계약 종료 후 잔존접근 | 짧은 token TTL, revoke hook, ACL 회수 | scheduled reconciliation·접근시험 |
| DSP·platform 상태 불일치 | 외부 호출 전 outbox·멱등키, 응답 후 durable external ID | orphan·missing·duplicate reconciliation |
| 공용 platform 계정의 confused deputy | participant→tenant binding, scoped token·quota | Agreement·participant별 source audit |
| CaaS cross-tenant 접근 | tenant별 Provider authority·secret·network policy | isolation test·CaaS audit export |
| 공급망 취약점 | pinning, 소프트웨어 자재 명세서(Software Bill of Materials, SBOM), signed image, patch SLA | vulnerability scan, emergency patch process |
| Control Plane 요청 폭주·비용공격 | public DSP endpoint rate limit, 요청 크기 한도, 동시 negotiation 상한 | 요청량·실패율·callback storm 경보 |
| 원격 JSON-LD context 조회를 통한 SSRF·DoS | 배포 고정 context, 원격 context 조회 비활성화, 미지의 context fail-closed | context 조회 시도·처리 실패 경보 |

## 6. Secret 관리

- source key, OAuth client secret, signing key는 Secret Store reference로만 구성한다.
- platform subscription·token API credential과 CaaS tenant secret도 Provider·source별로 분리한다.
- secret은 public Catalog property, Agreement, callback body에 포함하지 않는다.
- 개발·검증·운영 secret과 tenant를 분리한다.
- key owner, 용도, source, rotation 주기, 최종 사용과 폐기일을 기록한다.
- secret 조회 권한은 adapter runtime과 승인된 운영자에게만 준다.
- secret 값은 trace·exception·support bundle에서 자동 마스킹한다.
- Connector의 identity·signing key는 rotation 주기, key ceremony 절차와 유출 시 revoke·재발급 runbook을 별도로 정하고 source credential과 같은 저장소 정책으로 관리하지 않는다.

## 7. 정책 평가

정책 평가는 한 번으로 끝나지 않는다.

1. Catalog: Dataset 존재와 metadata를 보여줄 자격
2. Negotiation: 참가자·목적·기간·승인조건
3. Transfer start: Agreement, credential, security approval의 현재 유효성
4. Data access: token, request scope, quota, filter
5. Long-running transfer: credential과 local Agreement 만료·철회 정책 재평가, 필요 시 DSP Suspension·Termination
6. Post-use: 파기·출처표시·결과반출·재제공 증적

정책 함수가 알 수 없는 operand나 datatype을 받으면 허용하지 않고 실패 처리한다.

Agreement는 DSP 상태 머신이 아니다. 만료·철회는 계약·정책·거버넌스의 local lifecycle event로 관리하고, Connector 간 동작이 필요하면 활성 Transfer Process에 DSP Suspension 또는 Termination Message를 보낸다.

## 8. 감사

### 8.1 공통 식별자

- participant ID
- Catalog request ID
- Contract Negotiation consumer/provider PID와 Agreement ID
- Transfer consumer/provider PID
- Data Plane flow ID
- platform entitlement·subscription·token·job ID
- source system request ID
- approval·policy decision ID

### 8.2 감사 이벤트

- Catalog visibility decision
- Offer 선택과 계약 제안·합의·종료
- credential 검증과 policy decision
- transfer prepare·start·suspend·complete·terminate
- source 접근, row/byte/request 수와 오류
- token·ACL·snapshot 생성·회수
- platform external resource create·suspend·resume·delete와 reconciliation
- metadata upsert·delete·quarantine
- 관리자 변경과 긴급 접근
- 파기·결과 반출·사고 처리

감사로그는 목적에 필요한 metadata만 저장하고 payload·secret·불필요한 개인정보를 제외한다. 접근권한, 보존기간, 무결성 보호와 시간동기화를 운영 기준선으로 정한다.

## 9. 개인정보·공간정보 Gate

### 9.1 개인정보·가명정보

- 개인정보 해당성과 처리·제3자 제공 근거 확인
- 목적 적합성, 최소항목·기간과 정보주체 위험 평가
- 가명처리·적정성 검토와 추가정보 분리
- 기관 간 결합 시 전문기관 경로 확인
- 안전한 분석환경과 결과 반출규칙 승인
- 영향평가 대상 여부와 자율 영향평가 필요성 검토

### 9.2 공간정보

- 공개·공개제한·비공개 등급 확인
- Catalog metadata 공개범위 심사
- 보안심사와 승인환경 확인
- layer·경계 상자·좌표정밀도·download 제한
- 국내 저장·처리와 국외반출 여부 확인
- 이용기간 만료 후 원본·복제·backup 파기 증적

Gate가 완료되지 않은 자산은 [원천·권리 인벤토리](../01-research/source-and-rights-inventory.md)의 판정 상태를 `unverified` 또는 `excluded`로 유지하고, Offering 게시 상태는 [Offering 온보딩과 접근 수명주기](offering-onboarding-lifecycle.md)의 `PENDING_EVIDENCE`, `CATALOG_ONLY` 또는 `QUARANTINED`를 벗어나지 않게 한다.

## 10. 운영 관측성

| 신호 | 주요 지표 |
| --- | --- |
| Catalog | 수집 성공률, stale age, invalid·quarantine 수, 삭제 반영 지연 |
| Negotiation | 성공률, 소요시간, policy denial 원인, callback retry |
| Transfer | 시작·완료·중지율, byte·record, token provisioning 실패 |
| Adapter | source latency·5xx·quota·schema error, circuit state |
| Platform lifecycle | entitlement 생성·삭제 실패, orphan·duplicate, reconcile lag |
| Security | 인증 실패, visibility denial, secret access, revoke lag |
| Quality | freshness, checksum, missing field, CRS·unit validation |

metric label에 participant·dataset 원문이나 개인정보를 넣지 않는다. 고유 ID와 제한된 cardinality를 사용한다.

## 11. Backup·재해 복구(Disaster Recovery, DR)

- Control Plane state, contract·policy store와 audit를 일관되게 backup한다.
- Secret Store backup과 복구는 별도 key·접근승인을 사용한다.
- Catalog cache는 원천에서 재구성 가능해야 하지만 provenance·approval은 별도 보존한다.
- 임시 payload cache를 영구 backup하지 않는다.
- 복구 후 Contract Negotiation·Transfer Process, local Agreement policy와 platform subscription·token·ACL·snapshot을 reconciliation한다.
- 복구 시점 목표(Recovery Point Objective, RPO)와 복구 시간 목표(Recovery Time Objective, RTO)는 배포환경과 원천기관 SLA 확인 후 확정한다.

## 12. 사고 대응

1. 영향을 받은 participant, Dataset, Agreement, Transfer Process와 source credential을 식별한다.
2. 관련 token·credential·ACL을 정지·폐기한다.
3. Catalog visibility와 신규 negotiation을 필요 범위에서 중단한다.
4. 감사·source log·snapshot provenance를 보존한다.
5. 법정·계약상 통지와 원천기관 협업을 수행한다.
6. 복구 전 credential rotation, 취약점 제거와 replay 방지를 검증한다.
7. ADR·risk·runbook·test를 갱신한다.
