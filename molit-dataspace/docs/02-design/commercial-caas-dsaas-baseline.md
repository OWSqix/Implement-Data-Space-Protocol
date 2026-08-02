# 상용 CaaS·DSaaS 제품 기준선

- 작성일: 2026-07-14
- 작성 기준: 2026-07-14
- 상태: 설계 기준선, 운영기관 승인 전
관련 설계: [EDC 기반 CaaS·DSaaS 구성 설계](../02-architecture/edc-caas-dsaas-architecture.md)

## 1. 목적과 판정

- **(목적)** sovity, T-Systems와 Dawex의 공식 공개자료를 기준으로 국토교통 데이터 스페이스 CaaS·DSaaS의 제품 범위와 운영 완료조건 확정
- **(포함 범위)** tenant, Connector 수명주기, 신원·신뢰, 정책·계약, Catalog, 관측성, 고가용성, 관리형 서비스, 과금·Marketplace와 compliance
- **(제외 범위)** 공급사 비공개 architecture, 실제 고객 계약의 SLA credit, 가격표, 국내 법률·인증 적용 여부의 최종 판단
- **(판정 기준)** 화면 기능의 존재가 아니라 tenant 격리, 배포·복구, 계약·전송, 감사와 서비스 수준을 재현한 기계 판독 증거

현재 production CaaS와 DSaaS에는 scope별 PostgreSQL authoritative state와 revision compare-and-swap이 구현돼 있다. state·lease pool, session advisory lock과 단조 증가 fencing token도 분리했다.

상태 전이, 멱등성, generation fence, 감사 원장과 graceful shutdown은 시험 대상으로 고정했다.

P0 소스 범위에는 Kubernetes EDC provisioner와 신원 경계가 구현돼 있다. OIDC JWKS는 개발·상호운용에 사용하고 production은 RFC 7662 introspection·mTLS를 강제한다.

OpenTelemetry metric·log·trace, WORM audit outbox, usage meter와 3개 zone 배치 manifest도 포함한다. PostgreSQL 동기 복제·PITR 시험기와 최종 image 공급망 Gate도 같은 범위다.

로컬 PostgreSQL·Keycloak·TLS·Docker·kind 시험은 구현의 실행 가능성을 확인한다.

운영기관의 IdP·CA·KMS, object storage·Vault와 OTLP·WORM 제품에서 만든 결과는 아직 없다. 다중 가용영역 cluster와 운영 registry의 서명 결과도 없다.

따라서 P0 소스 구현 완료와 상용 운영 Gate 통과를 같은 판정으로 쓰지 않는다.

sovity는 EDC 기반 관리형 Connector 상품의 서비스 등급을 공개한다. T-Systems는 관리형 Connector, 데이터 스페이스 운영환경과 법인 신뢰 서비스를 결합한다.

Dawex는 참가자 운영부터 가격·결제·수수료까지 포함하는 데이터 거래소 기능을 공개한다. 국토교통 제품은 세 범위를 한 실행계획에 넣되 CaaS, DSaaS와 Marketplace의 책임을 분리한다.

## 2. 조사 증거의 범위

공급사 관련 내용은 각 회사가 공개한 제품 설명이다. 공개 문서가 실제 배포 설정, 고객별 계약조건 또는 제3자 시험 결과를 제시하지 않으면 해당 내용을 검증 사실로 확대하지 않는다.

| 상태 | 이 문서의 의미 | 사용 방법 |
| --- | --- | --- |
| `공식 공개` | 공급사 또는 표준기관의 현재 공개 문서에서 확인 | 제품이 공개한 기능과 조건으로 기록 |
| `공개 근거 미확인` | 조사한 공식 공개 문서에 세부 근거가 없음 | 기능 부재로 단정하지 않고 제안요청서 확인사항으로 이동 |
| `외부 감사` | 독립 감사 또는 인증기관이 범위와 수준을 공개 | 제품 기능 설명과 별도 증거로 기록 |
| `MOLIT 목표` | 이 프로젝트가 채택할 설계 또는 시험 기준 | 운영기관 승인 전까지 후보 기준으로 관리 |

마케팅 페이지의 `compliant`, `secure`, `highly available` 표기는 그 자체로 규격 적합성, 보안통제 또는 SLA 이행을 입증하지 않는다. 이 문서는 수치, 인증 수준, 시험 출력 또는 명시한 기능 범위까지만 인용한다.

## 3. 상용 제품 비교

### 3.1 제품 위치

| 공급사 | 공개 제품 범위 | 확인한 운영 단위 | 공개자료의 제한 |
| --- | --- | --- | --- |
| sovity | EDC Connector-as-a-Service, Data Space-as-a-Service, Identity와 Catalog 서비스 | Connector 구독, 참가기관, 데이터 스페이스 Portal | 내부 tenant 격리 방식, 장애조치 절차, 데이터 거래 정산은 공개 근거 미확인 [SOV-01] [SOV-02] |
| T-Systems | Connect & Integrate, Build & Operate, Digital.ID | Connector 구독, 법인, 전용 데이터 스페이스, 애플리케이션 | 수치 SLA·RPO·RTO와 데이터 거래 정산은 공개 근거 미확인 [TS-01] [TS-02] [TS-03] [TS-04] |
| Dawex | Data Exchange Solution, Industry Data Space, Data Marketplace | 참가조직, 사용자·service account, 데이터 상품, 거래 | Connector reconcile·rollback의 내부 동작과 고객별 SLA 조항은 공개 근거 미확인 [DAW-01] [DAW-02] [DAW-03] |

### 3.2 운영 기능

| 운영 기능 | sovity 공식 공개내용 | T-Systems 공식 공개내용 | Dawex 공식 공개내용 | MOLIT 목표 |
| --- | --- | --- | --- | --- |
| tenant | 조직 등록, 사용자·역할·권한, participant의 CaaS 주문 또는 운영자 quota, 구성요소 상태 [SOV-02] | 법인·법적 식별자·과금주소, Company Admin, 사용자 초대, 구독, 전용 사용자 그룹 [TS-03] [TS-04] | 조직 계층, 사용자·service account, 역할·권한, participant 유형별 access plan, private group, multi-tenant architecture [DAW-01] | 법인→데이터 스페이스→환경→Connector·구독 계층, tenant별 quota·감사·거주지·중지·삭제 |
| Connector 수명주기 | 즉시 provisioning, Portal, Control Plane·Data Plane·DB, 관리 API·SDK, 자동 release, backup과 상태 확인. Hybrid 분리는 제품표에서 `soon`으로 표시 [SOV-01] [SOV-02] | cloud 또는 on-premise 자동 설정, Connector·외부 Connector·asset 관리, backend integration, 참가자 onboarding 때 Connector 배포 [TS-01] [TS-02] [TS-06] | managed·decentralized Connector, EDC·DSP, 저장소 Connector, file·API push·pull [DAW-01] [DAW-02] | 실제 Kubernetes provisioner, desired·observed state 수렴, upgrade·rollback, 인증서 회전, 중지·삭제와 orphan 회수 |
| 신원·신뢰 | DAPS 또는 Managed Identity Wallet, SSI·DID, 중앙·분산·연합 identity, OAuth, SSO·MFA, BPN [SOV-01] [SOV-02] | Digital.ID 법인 검증, W3C DID·VC, eIDAS·Gaia-X 정렬, HSM 서명 credential, 수신자·credential 수명주기 [TS-03] [TS-05] | 조직 vetting, SSO, 중앙·연합 identity, DID wallet, Gaia-X Digital Clearing House(GXDCH), 2FA와 역할·권한 [DAW-01] [DAW-02] [DAW-05] | 사람 OIDC·SAML·MFA, workload mTLS·OAuth2, 법인 credential, revocation, trust anchor 서명·회전과 KMS·HSM |
| 정책·계약 | Offering wizard, access·usage policy, Catalog 탐색, negotiation, 계약조건과 전송이력 [SOV-01] | governance·policy·asset 관리, 화면 기반 policy 관리, custom governance 집행 [TS-01] [TS-02] [TS-03] | 계약·license, ODRL, access·usage rights, 가격·배포조건과 거래 추적 [DAW-01] [DAW-02] | versioned ODRL template, 법률문서 binding, 협상·Agreement·Transfer·종료 상태, obligation 집행과 판정 log |
| Catalog | EDC 호환 Catalog-as-a-Service, scheduled crawl, Connector Offering 자동 등록, 검색·filter·cluster, vocabulary hub [SOV-02] | asset 관리와 application Catalog 공개. 데이터 상품 Catalog의 crawl·dedup·version 세부는 공개 근거 미확인 [TS-01] [TS-03] [TS-06] | 다국어·공간 검색, taxonomy, semantic hub, metadata import API, 게시·검색과 private visibility [DAW-01] [DAW-02] | MOLIT DCAT-AP 검증·승인·게시, federated crawl, provenance·version·dedup, private group과 공간·의미 검색 |
| 관측성 | KPI dashboard, 계약·전송 상태와 이력, monitoring·log·alert, Grafana [SOV-01] | Connector monitoring, Grafana·Loki·Prometheus, system health·participant activity·application performance dashboard [TS-01] [TS-03] [TS-06] | real-time metric·report·dashboard, infrastructure monitoring, network·system·application audit log, SRE observability와 alert [DAW-01] [DAW-05] | tenant별 OpenTelemetry metric·log·trace, SLO alert, 불변 감사 원장, transfer receipt, usage metering과 status page |
| 고가용성·SLA | Basic·Pro·Enterprise 95%·99%·99.5%, point-in-time backup 3일·14일·30일, 가용영역 1개·3개·3개, Enterprise 24x7 지원 [SOV-01] | 관리형 cloud, public·sovereign cloud·hybrid, monitoring 공개. 수치 SLA·RPO·RTO는 공개 근거 미확인 [TS-01] [TS-02] [TS-03] | SLA에 따라 99.9% 초과, multi-zone, replication, load balancing, Kubernetes, 자동 scale, load·stress·failover 시험 [DAW-03] | 월 99.9% 후보 SLO, multi-zone, DB 고가용성·PITR, durable queue, RPO 5분·RTO 60분 후보와 정기 복구시험 |
| 관리형 서비스 | cloud hosting·maintenance, EU hosting, update, onboarding·integration 지원, 지원등급 [SOV-01] | 관리형 CaaS·DSaaS, cloud·on-premise, release·support period, package·subscription과 premium support [TS-01] [TS-02] [TS-03] [TS-04] | public cloud·on-premise·air gap·hybrid, managed distribution, customer support와 advisory [DAW-01] [DAW-03] | 주문·배포·변경·해지, 유지보수창, release·deprecation, incident·problem·change, export·exit와 SLA credit |
| 과금·Marketplace | Connector 구독 package와 Connector quota. 데이터 거래 결제·정산은 공개 근거 미확인 [SOV-01] [SOV-02] | 월 고정·종량 선택, subscription checkout와 setup charge. 데이터 상품 결제·정산은 공개 근거 미확인 [TS-02] [TS-04] | 세분 가격, integrated payment, transaction commission, access subscription, contract·license와 Marketplace 수익화 [DAW-04] | 플랫폼 구독·metering 원장과 데이터 거래·세금·결제·환불·수수료 원장을 분리 |
| compliance | Catena-X 인증과 IDS·Gaia-X 정합성에 관한 공급사 설명. 제품 수준 SOC·ISO 운영감사는 공개 근거 미확인 [SOV-01] | Catena-X·IDSA 인증과 Gaia-X 정합성에 관한 공급사 설명 [TS-01] [TS-02] | SOC 2 Type II·SOC 3, 연례 PASSI 외부감사와 침투시험, GDPR·DGA·Data Act 및 PIPA 대응기능 설명 [DAW-05] [DAW-06] | 적용대상 인증 확정, SBOM·provenance·image signature, 취약점 SLA, 외부 침투시험, 개인정보·감사·BCP 증거 |

표의 `MOLIT 목표` 수치 가운데 월 99.9%, RPO 5분과 RTO 60분은 비교 결과로 자동 도출되는 표준 요구사항이 아니다. 근거: 2026-07-14 프로젝트 결정 후보.

운영기관, 인프라 운영자와 예산 책임자가 수치와 비용을 함께 승인해야 한다.

### 3.3 인증과 상호운용 증거

IDSA의 Data Space Connector Report는 DSP TCK를 DSP 구현의 공식 시험군으로 설명한다. 같은 문서에서 Eclipse Dataspace Components는 DSP 2025-1과 TCK 1.0.0 결과를 제시한다.

근거는 [IDSA-01]이며 문서 최종 수정일은 2026-06-30, 확인일은 2026-07-14다.

Telekom DIH Connector by T-Systems는 같은 보고서의 TCK 통과 Connector 본문에 없다. `Appendix B: Certified connectors`에는 `Level 2 – Concept Review`, 2023년 12월로 기재돼 있다. 근거: [IDSA-01], 확인일 2026-07-14.

T-Systems의 IDS 인증을 DSP 2025-1 TCK 통과, 제3자 보안감사 또는 운영 SLA 증거로 사용하지 않는다.

EDC framework의 TCK 결과도 국토교통 배포판의 결과로 자동 승계하지 않는다. 국토교통 CaaS가 추가한 extension, 신원 구성, policy function과 HTTP endpoint를 포함한 최종 container digest로 TCK를 다시 실행한다.

## 4. 국토교통 제품 경계

### 4.1 제품별 책임

| 제품 | 구매·운영 주체 | 책임 | 포함하지 않는 책임 |
| --- | --- | --- | --- |
| CaaS | 데이터 스페이스 참가기관 | 참가자별 Connector 배포, upgrade, 상태수렴, secret·인증서, backup, 관측과 지원 | 참가 승인, 공동 rulebook, 중앙 Catalog 운영, 데이터 상품 결제 |
| DSaaS | 데이터 스페이스 운영기관 | 법인·membership Registry, trust, 승인, 공동 Catalog·vocabulary·policy template, CaaS 조정, 운영 dashboard | 참가자 원천 데이터 열람, 개별 Connector credential 공유, 유상거래 정산 |
| Marketplace | 운영기관 또는 분리된 중개사업자 | 상품 가격, 주문, payment, tax, commission, refund, reconciliation과 거래명세 | DSP 제어면 대체, 원천 데이터 보관, CaaS 배포 |

초기 CaaS는 참가자마다 Kubernetes namespace, EDC Control Plane, Data Plane, Connector DB와 secret 경계를 분리한다.

공유 CaaS controller는 tenant identity와 namespace binding을 검사하고 실제 배포 자원을 수렴한다. 전용 cluster·network·database는 상위 격리등급으로 제공한다.

DSaaS는 데이터 스페이스별 namespace, governance digest, trust anchor와 서비스 Registry를 보관한다. 참가 신청 승인과 CaaS 배포 승인은 별도 상태다.

DSaaS가 참가자를 승인해도 Connector와 필수 공유서비스의 관측 상태가 준비되지 않으면 데이터 스페이스를 `ACTIVE`로 바꾸지 않는다.

Marketplace는 선택 모듈로 둔다. 무료·공공 데이터 Offering의 이용조건과 플랫폼 구독료는 데이터 상품 결제와 다른 원장에 기록한다. 유상거래 범위가 승인되기 전에는 payment provider와 commission 로직을 CaaS 또는 DSP Agreement에 넣지 않는다.

### 4.2 공통 플랫폼

공통 플랫폼은 다음 구성요소를 CaaS와 DSaaS에 제공한다.

- Identity service는 조직·사용자를 OIDC·SAML과 MFA로 인증하고 role을 판정한다.
- Workload identity service는 mTLS credential을 발급하고 Vault 또는 KMS에서 secret을 회전한다.
- Persistence service는 PostgreSQL 고가용성, transaction outbox, durable queue와 object storage를 제공한다.
- CaaS controller는 Kubernetes provisioner를 호출하고 desired state를 실제 자원과 수렴한다.
- Observability pipeline은 OpenTelemetry metric·log·trace, 감사와 usage meter를 같은 correlation ID로 묶는다.
- Subscription service는 quota, service plan, maintenance와 support workflow를 실행한다.
- Artifact registry는 SBOM, signature, provenance와 취약점 Gate 결과를 image digest에 연결한다.

공통 플랫폼은 tenant 식별자가 없는 요청을 처리하지 않는다. 데이터베이스, queue message, object key, metric label과 audit event에 같은 tenant binding을 기록한다. 운영자는 break-glass 권한 사용 사유와 종료시각을 남긴다.

### 4.3 현재 구현과 확장 한계

production 제어 저장소는 `src/control-store/postgres-scoped-control-store.mjs`다. CaaS tenant와 DSaaS dataspace마다 `scoped_control_state` row를 하나씩 두고 revision과 payload digest를 관리한다. 멱등성 record, 감사와 outbox도 tenant ID를 기본 경계로 사용한다.

상태 transaction과 advisory lock은 서로 다른 pool을 쓴다. 장시간 reconcile이 lease connection을 점유해도 state transaction용 connection을 남기기 위한 분리다.

advisory lock을 얻을 때 fencing token을 증가시킨다. lease를 잃은 작업은 scoped state를 commit하지 못한다.

CaaS의 운영 provisioner 계약은 외부 부작용이 fencing token을 받아들였다는 receipt를 요구한다. 이후 관찰값의 `lastAppliedFencingToken`도 같은 값을 반환해야 한다.

Kubernetes Adapter는 중앙 fence ConfigMap의 token과 명령 digest를 CAS로 갱신한다.

fail-closed admission policy와 target-side webhook은 관리 resource와 namespace 삭제를 다시 검사한다. 요청은 현재 fence와 정확히 일치해야 한다.

로컬 kind 시험은 N+1 명령 뒤 도착한 N 삭제를 거부한다.

이 시험은 운영 cluster의 admission 설정, 최종 EDC image와 장애 상황을 사용한 서명 결과를 대신하지 않는다. 운영 증거는 `COM-HA-001`의 차단 항목이다.

`control_scope_registry`는 scope ID, current revision·digest와 기술 식별자 unique index를 보관한다. DSaaS의 participant 식별자는 별도 전역 registry에서 dataspace 사이 중복을 막는다.

scope transaction은 payload, 멱등성, domain audit, state-commit audit와 `audit.appended` outbox를 한 번에 기록한다. 일부만 성공하는 commit은 허용하지 않는다. component audit head와 current state root도 같은 transaction에서 바뀐다.

각 table에는 `FORCE ROW LEVEL SECURITY`, database login role의 component binding과 tenant binding을 적용한다. 같은 tenant ID가 CaaS와 DSaaS에 모두 있어도 서로의 row를 읽을 수 없다.

runtime은 scope registry에서 ID만 페이지 단위로 읽고 각 scope를 별도 transaction으로 처리한다. WORM dispatcher도 같은 registry를 사용하며 다른 tenant context의 acknowledge와 reject를 거부한다.

전환은 승인된 DB snapshot, 승인 증거가 있는 legacy file 또는 잔여 상태가 없는 fresh install만 허용한다.

전환 시점 root는 `cutover_state_root_sha256`에 고정하고 runtime은 별도 current root만 갱신한다. Production runtime role은 legacy snapshot table을 읽거나 쓸 수 없다.

용량시험에서는 scope registry lock 대기, tenant row 크기, audit head 경합과 vacuum 지연을 측정한다.

Registry 갱신은 component 단위로 직렬화된다. Tenant 수와 쓰기율이 승인된 capacity profile을 넘으면 registry partitioning 또는 identity reservation service가 필요하다.

PostgreSQL 동기 standby 강제 승격 시험은 RPO 0과 split-brain commit 0을 검사한다. outbox 보존과 PITR digest 일치도 검사 대상이다.

CloudNativePG 3-instance manifest는 별도다. 로컬 Docker 결과를 운영 multi-zone RPO·RTO 증거로 사용하지 않는다.

## 5. 구현 순서

### 5.1 P0 운영 제어면

P0는 외부 pilot에 Connector를 제공하기 전에 끝내는 운영 제어면 범위다. 저장소 소스의 구현 완료와 운영기관 환경의 승인 완료를 따로 판정한다.

1. **영속 상태와 배포 controller**
   - 구현된 PostgreSQL scoped-authoritative state, scope registry, audit·idempotency table과 outbox를 운영 migration으로 고정
   - Kubernetes API를 호출하는 실제 provisioner와 외부 fencing receipt 구현
   - create, upgrade, rollback, suspend, delete와 orphan 회수 상태 구현
2. **tenant와 운영 신원**
   - 법인 식별자, 사람·service principal, role, tenant와 실행환경 binding을 CaaS·DSaaS 계약과 identity claim으로 고정
   - 개발·상호운용 OIDC JWKS와 production RFC 7662 결과를 분리하고 사람 MFA claim, workload mTLS binding, secret reference와 certificate rotation을 runtime에서 강제
   - SAML federation은 운영 IdP에서 OIDC claim으로 끝내며, private CA·KMS·Vault와 함께 운영기관 승인시험 대상으로 관리
   - tenant별 namespace, DB row와 queue·object·secret reference를 격리하고 운영 bucket policy·Vault ACL·NetworkPolicy는 별도 침투시험으로 확인
   - 주문·plan·quota·해지까지 포함한 관리형 subscription 수명주기는 `COM-OPS-001`의 P1 범위로 유지
3. **가용성과 운영 관측**
   - CaaS controller, DSaaS API와 PostgreSQL의 3개 zone 배치, 동기 quorum·WAL archive·PITR 구성
   - OpenTelemetry, SLO dashboard, alert, 불변 audit와 usage meter 구현
   - 로컬 장애주입으로 backup·restore, failover, rolling upgrade와 rollback 시험을 자동화하고 운영 multi-zone 훈련은 별도 수행
4. **공급망과 배포 증거**
   - production namespace에 배포되는 모든 image를 runtime class와 source-build 또는 external-adoption provenance로 등록
   - SBOM, scan, signature, source commit, runtime class와 production eligibility를 image digest에 결합
   - `UNKNOWN`, `HIGH`, `CRITICAL` 취약점은 P0에서 예외 없이 거부하고 production admission에서 같은 정책을 재검증

P0 소스 구현은 `npm run verify:p0:local`이 생략 없이 통과하고 원시 log digest 검증이 끝났을 때 완료로 판정한다. 외부 pilot 승인은 별도다. 운영기관 환경에서 만든 결과 증거가 등록돼 `COM-TEN-001`, `COM-LCM-001`, `COM-ID-001`, `COM-OBS-001`, `COM-HA-001`과 `COM-SUP-001`이 모두 통과해야 한다.

### 5.2 P1 데이터 스페이스 운영

P1은 여러 기관을 하나의 데이터 스페이스로 운영하는 범위다.

1. **참가자 신뢰**
   - 법인 증거 검토, membership 승인·정지·철회, credential 발급·폐기 구현
   - 서명된 trust anchor·Registry 갱신과 실행 중 회전 구현
2. **Catalog와 의미 검증**
   - MOLIT DCAT-AP validate·approve·publish workflow 구현
   - federated crawl, provenance, version, dedup, tombstone과 private group 구현
3. **정책·계약 수명주기**
   - 승인된 ODRL template와 법률문서 version binding 구현
   - Catalog, negotiation, Agreement, Transfer, terminate와 접근권한 회수 연결
4. **관리형 서비스 운영**
   - 주문, plan, quota, 변경, 해지, data export와 tenant 삭제 구현
   - release·deprecation, maintenance, incident와 support escalation 운영

P1 종료 시 `COM-TRUST-001`, `COM-CAT-001`, `COM-POL-001`, `COM-OPS-001`과 `COM-DSP-001`이 통과해야 한다.

### 5.3 P2 거래와 확장

P2는 유상 데이터 거래와 대규모 서비스 계약을 위한 범위다.

1. **Marketplace 원장**
   - product price, order, payment, tax, commission, refund와 reconciliation 구현
   - DSP Agreement ID와 상거래 주문 ID를 별도 객체로 보관하고 mapping 구현
2. **서비스 등급**
   - Standard·Enterprise 격리, availability, backup retention과 support hour 확정
   - 월별 SLA report, service credit와 고객별 data residency 증거 발행
3. **외부 검증**
   - 승인된 capacity profile의 load·stress·soak·failover 시험 수행
   - tenant isolation 침투시험과 적용대상 보안·개인정보 인증 증거 등록

유상거래를 사업범위에서 제외하면 `COM-BIL-001`은 `not-applicable` 승인과 근거 digest를 가져야 한다. Gate 항목 자체를 삭제하지 않는다. 다른 Gate에는 `not-applicable`을 허용하지 않는다.

P2 종료에는 `COM-CMP-001`, `COM-SLA-001` 통과가 필요하다. `COM-BIL-001`은 통과하거나 범위·근거·유효기간을 고정한 `not-applicable` 승인을 받아야 한다.

## 6. Machine Gate 완료조건

상용 판정의 정본은 `governance/commercial-readiness-register.v1.json`이다. 다음 명령은 이 원장을 읽어 미해결 Gate와 차단 항목을 출력한다.

```powershell
npm run commercial:status
```

2026-07-14 실행 결과는 `commercialReady=false`, `decision=blocked`, 미해결 Gate 14개와 차단 항목 16개다. 명령은 exit code 2를 반환했다. 문서의 완료 표현이나 개별 시험 성공으로 이 판정을 덮어쓰지 않는다.

### 6.1 증거 계약

상용 readiness 판정기는 Registry와 다음 field를 가진 Gate 결과만 읽는다. 실행 증거 경로는 `evidence/commercial-readiness/` 아래에 고정한다. Registry의 `resultEvidence`에는 결과 파일 경로와 그 파일의 SHA-256 digest를 함께 기록한다.

```json
{
  "schemaVersion": "molit.commercial-readiness-result/1",
  "gateId": "COM-LCM-001",
  "status": "pass",
  "sourceCommit": "<git-sha>",
  "artifactDigests": ["sha256:<digest>"],
  "environmentDigest": "sha256:<digest>",
  "startedAt": "<RFC3339>",
  "finishedAt": "<RFC3339>",
  "validUntil": "<RFC3339>",
  "testProfileId": "<approved-profile>",
  "evidencePath": "<repository-relative-path>",
  "evidenceSha256": "<sha256>"
}
```

판정기는 필수 Gate 집합, 결과 파일과 원시 증거의 digest, Gate ID 결합, 실행시간 순서와 결과 만료일을 검사한다. `not-applicable`에는 결정 ID, 승인자, 승인시각, 사유, 범위, 만료일과 digest가 고정된 승인 문서가 필요하다.

종료 코드는 판정 결과와 판정 실패를 구분한다. Schema와 증거 계약을 만족하는 원장에서 미해결 Gate가 남으면 exit code 2를 반환한다.

원장·Schema가 유효하지 않거나 증거 누락·digest 불일치·만료로 평가를 끝내지 못하면 exit code 1을 반환한다. 모든 Gate가 `pass` 또는 승인된 `not-applicable`이면 exit code 0이다.

`sourceCommit`은 증거 생성 시점의 source 식별자를 기록하며 판정기는 형식만 검사한다. commit 존재 여부, 승인 branch 포함 여부와 이후 source 변경 검사는 아직 자동화하지 않았다. 최종 상용 판정 전에는 서명된 build provenance와 source 검증을 추가해야 한다.

### 6.2 Gate 목록

| Gate ID | 단계 | 시험 | 통과 기준 | 필수 증거 |
| --- | --- | --- | --- | --- |
| `COM-TEN-001` | P0 | 두 tenant의 API, DB, queue, object, secret와 metric 교차 접근 | 비인가 교차 접근 0건, 모든 거부 event에 actor·tenant·resource·decision 기록 | 격리시험 report, audit chain, 침투시험 결과 |
| `COM-LCM-001` | P0 | 승인 template으로 Connector 30회 create, upgrade, rollback, suspend와 delete | create p95 15분 이하 후보 기준, 실패 후 이전 version 복귀, 삭제 뒤 orphan 0개 | Kubernetes event, inventory diff, operation journal |
| `COM-ID-001` | P0 | 사용자·service·participant credential 발급, 회전, 폐기와 재사용 | 폐기 credential 전건 거부, 회전 중 승인 요청 중단 없음, secret 원문 log 0건 | identity test report, KMS·Vault audit, redaction scan |
| `COM-OBS-001` | P0 | 관리 API부터 EDC 계약·전송까지 correlation 추적 | 각 privileged operation에 metric·log·trace·audit 연결, audit hash chain 검증 성공 | OpenTelemetry trace, dashboard snapshot, chain verification |
| `COM-HA-001` | P0 | zone, controller, DB primary와 queue node 장애, backup 복구 | 후보 기준 RPO 5분·RTO 60분 이내, 복구 object digest 일치, split-brain commit 0건 | chaos report, failover timeline, restore digest |
| `COM-SUP-001` | P0 | 최종 배포 artifact의 build와 취약점 검사 | 모든 image digest에 SBOM·signature·provenance 존재, 미승인 critical vulnerability 0건 | artifact lock, SBOM, signature verification, scan report |
| `COM-TRUST-001` | P1 | 법인 가입, 승인 분리, trust anchor 회전, membership 철회 | 신청자와 승인자 분리, 미승인·철회 participant 전건 거부, Registry digest 수렴 | approval record, credential status, signed Registry report |
| `COM-CAT-001` | P1 | 유효·무효 MOLIT DCAT-AP record, 중복, version과 tombstone 수집 | 유효 record만 게시, 무효 record 격리, 중복 단일 식별, tombstone 뒤 검색 제거 | SHACL report, crawl log, Catalog reconciliation |
| `COM-POL-001` | P1 | policy 게시, 협상, Agreement, Transfer, 종료와 원천 권한 회수 | 승인 template만 협상, 종료 뒤 token 접근 전건 거부, 계약·권한 mapping 잔여 0건 | DSP event, policy decision log, revoke receipt |
| `COM-OPS-001` | P1 | 구독 주문, plan 변경, quota 초과, 해지, export와 삭제 | 상태별 멱등 처리, quota 초과 거부, export digest 검증, 보존정책 종료 뒤 tenant 자원 0개 | subscription journal, quota report, deletion inventory |
| `COM-DSP-001` | P1 | 최종 image digest의 DSP TCK와 외부 구현 간 전체 수명주기 | 적용 TCK 전건 통과, 서로 다른 외부 구현 2종과 Catalog→협상→전송→종료 성공 | TCK output, 상호운용 transcript, payload·termination receipt |
| `COM-CMP-001` | P2 | 적용 법령·인증 범위, 개인정보 처리·거주지·보존·삭제, 외부 침투시험과 업무 연속성 훈련 | 적용성 결정 승인, 개인정보 처리·삭제 증거 확보, 미해결 critical 외부 보안 발견 0건, 승인 RTO·RPO 안에서 복구 | 적용성 결정서, 개인정보·보안 평가서, 침투시험 보고서, 업무 연속성 훈련 기록 |
| `COM-BIL-001` | P2 | 사용량, 주문, payment, refund, tax와 commission 재처리 | idempotency 재실행 뒤 중복 분개 0건, 원장·결제대행·invoice 차이 0건 | double-entry ledger report, provider reconciliation, invoice fixture |
| `COM-SLA-001` | P2 | 승인 capacity profile에서 30일 canary와 failover | Standard 월 99.9% 후보 SLO 충족, 제외시간과 오류예산 계산 재현 | signed monthly SLO report, capacity profile, incident list |

수치 후보는 제품 등급과 인프라 비용을 결정하기 위한 초기 기준이다. 운영기관이 다른 값을 승인하면 Gate ID는 유지하고 versioned test profile과 승인 digest를 바꾼다. 과거 결과는 새 profile의 통과 증거로 재사용하지 않는다.

## 7. 조달·실사 확인사항

공개자료만으로 다음 항목을 판정할 수 없다. 자체 구축과 외부 제품 도입을 비교할 때 공급사는 동일한 증거 형식으로 답해야 한다.

| ID | 확인사항 | 필요한 증거 | 제품 결정 영향 |
| --- | --- | --- | --- |
| `DD-01` | tenant별 compute·network·DB·secret 격리 | architecture, 침투시험, 장애범위 | shared·isolated plan |
| `DD-02` | upgrade 실패와 rollback | 상태도, 최근 실행기록, RTO | Connector 수명주기 |
| `DD-03` | SLA 제외조건, credit, RPO·RTO | service description, 계약 조항, 월 report | plan과 가격 |
| `DD-04` | audit export, 보존, 위변조 검증 | event Schema, 서명·hash 검증, sample export | 공공 감사 대응 |
| `DD-05` | 계약 종료 뒤 credential·복제본 삭제 | revoke·deletion receipt, 하위처리자 범위 | 데이터 주권 |
| `DD-06` | 보안감사 범위와 subservice organization | 최신 SOC·ISO report, scope, exception | compliance 판정 |
| `DD-07` | DSP version과 TCK 결과 | 최종 artifact digest에 결합한 raw output | 이기종 상호운용 |
| `DD-08` | 사용량 계측과 invoice 정합 | meter definition, ledger, 조정 절차 | 구독·Marketplace |

## 8. 공식 출처

모든 URL의 확인일은 2026-07-14다.

- `[SOV-01]` sovity, “Connect to Data Space: Secure usage of data with partners”, 현재 제품 페이지, <https://sovity.de/en/connect-to-data-space-en/>
- `[SOV-02]` sovity, “Data Space: Software to realize sovereign data exchange”, 현재 제품 페이지, <https://sovity.de/en/build-entire-data-space-en/>
- `[TS-01]` Telekom Data Intelligence Hub Knowledge Base, “Connect & Integrate”, v5.2 안내, <https://docs.dih.telekom.com/connect-integrate>
- `[TS-02]` Telekom Data Intelligence Hub, “Connect & Integrate”, 현재 제품 페이지, <https://dih.telekom.com/en/connect-integrate>
- `[TS-03]` Telekom Data Intelligence Hub, “Build & Operate”, 현재 제품 페이지, <https://dih.telekom.com/en/build-operate>
- `[TS-04]` Telekom Data Intelligence Hub Knowledge Base, “User Guide: Connecting to Catena-X”, 최종 수정일 2025-08-04, <https://docs.dih.telekom.com/en/connect-catena-x/step-by-step-user-guide>
- `[TS-05]` Telekom Data Intelligence Hub, “Digital.ID: Redefining trust with verifiable credentials for lasting business partnerships”, 발행일 2024-02-22, <https://dih.telekom.com/en/digital-id-redefining-trust-with-verifiable-credentials-for-lasting-business-partnerships>
- `[TS-06]` Telekom Data Intelligence Hub Knowledge Base, “Release notes Build & Operate”, 최종 수정일 2025-07-31, <https://docs.dih.telekom.com/en/daas/build-and-operate/release-notes-build-and-operate>
- `[DAW-01]` Dawex, “Dawex Data Exchange Solution, engage with your data ecosystem”, 현재 제품 페이지, <https://www.dawex.com/en/data-exchange-solution/>
- `[DAW-02]` Dawex, “Data Exchange technology interoperability”, 현재 기술 페이지, <https://www.dawex.com/en/data-exchange-technology/interoperability/>
- `[DAW-03]` Dawex, “Open and performant Data Exchange technology”, 현재 기술 페이지, <https://www.dawex.com/en/data-exchange-technology/performant-open-architecture/>
- `[DAW-04]` Dawex, “Data Marketplace”, 현재 제품 페이지, <https://www.dawex.com/en/solutions/data-marketplace/>
- `[DAW-05]` Dawex, “Data Exchange technology security”, 현재 기술 페이지, <https://www.dawex.com/en/data-exchange-technology/security/>
- `[DAW-06]` Dawex, “Data Exchange technology compliance”, 현재 기술 페이지, <https://www.dawex.com/en/data-exchange-technology/compliance/>
- `[IDSA-01]` International Data Spaces Association, “IDSA Data Space Connector Report”, 최종 수정일 2026-06-30, <https://internationaldataspaces.org/idsa-data-space-connector-report/>

[SOV-01]: https://sovity.de/en/connect-to-data-space-en/
[SOV-02]: https://sovity.de/en/build-entire-data-space-en/
[TS-01]: https://docs.dih.telekom.com/connect-integrate
[TS-02]: https://dih.telekom.com/en/connect-integrate
[TS-03]: https://dih.telekom.com/en/build-operate
[TS-04]: https://docs.dih.telekom.com/en/connect-catena-x/step-by-step-user-guide
[TS-05]: https://dih.telekom.com/en/digital-id-redefining-trust-with-verifiable-credentials-for-lasting-business-partnerships
[TS-06]: https://docs.dih.telekom.com/en/daas/build-and-operate/release-notes-build-and-operate
[DAW-01]: https://www.dawex.com/en/data-exchange-solution/
[DAW-02]: https://www.dawex.com/en/data-exchange-technology/interoperability/
[DAW-03]: https://www.dawex.com/en/data-exchange-technology/performant-open-architecture/
[DAW-04]: https://www.dawex.com/en/solutions/data-marketplace/
[DAW-05]: https://www.dawex.com/en/data-exchange-technology/security/
[DAW-06]: https://www.dawex.com/en/data-exchange-technology/compliance/
[IDSA-01]: https://internationaldataspaces.org/idsa-data-space-connector-report/
