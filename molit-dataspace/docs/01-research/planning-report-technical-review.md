# 국토교통 통합 데이터 스페이스 기획보고서 기술 검토

작성일: 2026-07-11  
검토 기준일: 2026-07-11  
상태: Review  
검토 대상: [국토교통 AI전환 및 산업혁신 통합 데이터 스페이스 기획보고서](<../../../국토교통 AI전환 및 산업혁신 통합 데이터 스페이스 기획보고서.pdf>)

## 1. 판정과 범위

- **(검토 범위)** 기술동향, 현행 플랫폼 분석, 목표 아키텍처와 기술개발 목표
- **(과제 범위)** 과제카드의 기술 요구사항과 검증 기준
- **(제외)** 정책 필요성·예산·시장규모와 개별 유즈케이스의 사업성

쪽수는 보고서 아래쪽에 인쇄된 본문 쪽수를 먼저 쓰고 휴대용 문서 형식(Portable Document Format, PDF) 파일의 실제 쪽수를 괄호에 병기한다. 예를 들어 본문 p.39는 PDF p.51이다.

표지와 목차 때문에 두 번호는 12쪽 차이가 난다.

판정은 **대폭 수정 후 사용**이다. 기존 Data Lake·Data Hub·통합채널을 유지하면서 데이터 스페이스를 추가 연결 계층으로 둔 방향은 맞다. 그러나 상세 설계에는 다음 문제가 남아 있다.

반복 사용하는 표준 약어는 다음과 같다.

- 국제전기기술위원회(International Electrotechnical Commission, IEC)
- 국제 데이터 스페이스 참조 아키텍처 모델(International Data Spaces Reference Architecture Model, IDS-RAM)
- 독일표준화협회(German Institute for Standardization, DIN)
- 유럽표준(European Standard, EN)
- RDF 그래프 제약 언어(Shapes Constraint Language, SHACL)
- 국제화 자원 식별자(Internationalized Resource Identifier, IRI)

- DSP 제어 프로토콜과 실제 payload 전송을 혼동한다.
- DCAT, 데이터 카탈로그 어휘 응용 프로파일(Data Catalogue Vocabulary Application Profile, DCAT-AP), Catalog Broker와 EDC 구현 구조를 같은 개념으로 묶는다.
- 기존 플랫폼의 Offering 자격, source binding, Agreement-to-entitlement 수명주기가 없다.
- DCP와 동적 속성 제공 서비스(Dynamic Attribute Provisioning Service, DAPS)를 하나의 필수 stack으로 고정한다.
- 분산 식별자(Decentralized Identifier, DID)·검증가능 자격증명(Verifiable Credential, VC)과 암호기술을 일괄 고정한다.
- ODRL과 출처 이력 온톨로지(Provenance Ontology, PROV-O)의 보장 범위를 실제보다 넓게 기술한다.
- 원천 근접 연산(Compute-to-Data, C2D)과 안전한 처리 환경(Secure Processing Environment, SPE)의 법적·보안 효과를 과대 기술한다.
- AI Agent에게 계약·전송 권한을 주면서 위임, 승인, 비용과 공격 경계를 두지 않는다.
- TCK 통과, 시스템 수, 문서 작성 여부를 운영 상호운용성의 증거로 사용한다.

### 1.1 우선순위

| 등급 | 의미 | 조치 |
| --- | --- | --- |
| P0 | RFP와 구현 범위를 잘못 고정하거나 무단 제공·보안사고로 이어질 수 있음 | 발주 기준 확정 전 수정 |
| P1 | 표준 상태, 역할 또는 검증 기준이 부정확함 | 보고서 배포 전 수정 |
| P2 | 용어와 과장 표현 때문에 설계 해석이 달라질 수 있음 | 최종 교정 시 수정 |

### 1.2 발주 전 P0 수정 항목

| ID | 핵심 문제 | 대상 |
| --- | --- | --- |
| T-01 | ISO 표준화 완료라는 사실 오류 | 본문 p.91·162, PDF p.103·174 |
| T-05 | DSP가 실제 데이터를 전송한다는 범위 오류 | 본문 p.210, PDF p.222 |
| T-10 | 기존 플랫폼 Bridge와 접근권한 수명주기 누락 | 본문 p.158~160, PDF p.170~172 |
| T-12 | 선형 성숙도와 탈중앙화 최종단계 가정 | 본문 p.154~157, PDF p.166~169 |
| T-15 | ODRL로 완전한 사후 통제를 보장한다는 표현 | 본문 p.42·135·213, PDF p.54·147·225 |
| T-18 | C2D만으로 개인정보·민감정보 활용이 가능하다는 표현 | 본문 p.111, PDF p.123 |
| T-20 | Docker·VDI 정상실행으로 비유출을 검증하는 계획 | 본문 p.159·291, PDF p.171·303 |
| T-21 | AI Agent의 자율 계약·전송에 권한 경계 부재 | 본문 p.159·289~293, PDF p.171·301~305 |
| T-22 | 법률 조항 자동판정 엔진 | 본문 p.155~159, PDF p.167~171 |
| T-25 | TCK 통과를 인증·전체 상호운용성으로 간주 | 본문 p.160·291~294, PDF p.172·303~306 |
| T-27 | 시스템 수와 문서 산출물 중심의 완료 기준 | 본문 p.109·281·290~297, PDF p.121·293·302~309 |

## 2. 표준과 프로토콜 수정안

### T-01. ISO/IEC 20151과 DSP·DCP ISO 초안의 상태

- **우선순위:** P0
- **대상:** 본문 p.91 표 2, p.162 국제표준화 단락, p.294 기대효과. PDF p.103, p.174, p.306
- **대상 문장:** “DSP/DCP 프로토콜 ISO 표준화 완료(ISO/IEC 20151)”, “ISO/IEC 20151은 2024년 제정”
- **문제:** 2026-07-11 현재 ISO/IEC 최종 국제표준안(Final Draft International Standard, FDIS) 20151-1은 데이터 스페이스 개념·특성을 다루는 승인 단계 문서
- **개발 상태:** DSP와 DCP의 ISO 문서는 각각 ISO/IEC 국제표준안(Draft International Standard, DIS) 26450과 26451이며 개발 중
- **교체 문안:**

> 구현 기준선은 Eclipse Dataspace Protocol 2025-1 errata 1과 Eclipse Decentralized Claims Protocol 1.0으로 한다. ISO/IEC FDIS 20151-1은 데이터 스페이스의 개념과 특성을 다루는 승인 단계 문서다. DSP와 DCP의 ISO 초안인 ISO/IEC DIS 26450과 ISO/IEC DIS 26451도 개발 중이므로 ISO 표준화 완료라고 쓰지 않는다. 각 문서는 발주와 구현 기준선 확정 시 상태를 다시 확인한다.

- **검증:** 표준 기준표에 명칭, 문서 상태, version, URL, 확인일과 적용 목적을 각각 기록한다.
- **근거:** SRC-TECH-018, SRC-TECH-020, SRC-TECH-021

### T-01A. IDS-RAM 5와 DIN EN 18235의 문서 상태

- **우선순위:** P1
- **대상:** 본문 p.42, p.135·156·162·294. PDF p.54, p.147·168·174·306
- **대상 문장:** “IDS-RAM 5.0에서 분산 모니터링·감사·분쟁해결 메커니즘을 표준화”, “IDS-RAM 5.0 및 DIN EN 18235 정합”
- **문제:** IDS-RAM 5 공식 문서는 Working Draft이며 하나의 blueprint가 아니라 design space라고 설명한다. DIN EN 18235-1과 18235-2도 각각 draft standard다. 안정된 국제표준과 같은 수준의 적합성 기준으로 쓸 수 없다.
- **교체 문안:**

> IDS-RAM 5 Working Draft는 centralized, federated, decentralized pattern을 선택하는 비규범 설계 참고자료로 사용한다. DIN EN 18235-1과 18235-2는 draft이므로 연구동향과 향후 정합성 추적 대상으로 둔다. 구현 acceptance 기준은 안정된 DSP·DCP version, 국토교통 profile과 승인된 운영·보안 요구사항에 둔다. Working Draft와 draft standard를 준수·인증 대상으로 표현하지 않는다.

- **검증:** draft 문서를 인용한 모든 요구사항에는 확인일과 version·commit을 붙이고, draft 변경 시 영향분석을 수행한다.
- **근거:** SRC-TECH-019, SRC-TECH-027, SRC-TECH-028

### T-02. DCAT 3, 응용 프로파일(Application Profile, AP)과 GeoDCAT-AP 구분

- **우선순위:** P1
- **대상:** 본문 p.22·91·112·135·147~160·280~293. PDF p.34·103·124·147·159~172·292~305
- **대상 문장:** “DCAT 3.0”, “DCAT-AP 3.0 기반”, “DCAT-AP 3.1”
- **문제:** W3C 규격명은 DCAT 3이다. DCAT-AP 3.0.1은 유럽 카탈로그용 Application Profile이며, 3.1.0은 GeoDCAT-AP의 버전이다. 세 이름을 섞으면 어떤 cardinality, controlled vocabulary와 SHACL을 검증하는지 알 수 없다.
- **교체 문안:**

> 카탈로그 공통 어휘는 W3C DCAT 3을 사용한다. 국토교통 Application Profile은 DCAT 3에 필수 필드, cardinality, controlled vocabulary와 SHACL을 추가한 별도 version 규격으로 관리한다. 유럽 공공 카탈로그 교환에는 DCAT-AP 3.0.1, 공간정보 교환에는 GeoDCAT-AP 3.1.0과의 명시적 mapping을 적용한다. DSP Catalog에는 국토교통 canonical metadata를 DSP 2025-1의 Dataset·Distribution·DataService·Offer 구조로 투영한다.

- **검증:** 세 profile별 namespace, 필수 필드, SHACL 파일, version IRI와 crosswalk를 산출물로 제출한다.
- **근거:** SRC-TECH-002, SRC-TECH-016, SRC-TECH-017

### T-03. DCAT를 연합 카탈로그 protocol로 설명한 부분

- **우선순위:** P1
- **대상:** 본문 p.41, p.112, p.155·158, p.289~290. PDF p.53, p.124, p.167·170, p.301~302
- **대상 문장:** “DCAT-AP 3.0 기반 연합 카탈로그 기술”, “Federated Catalog는 DCAT-AP 3.0 분산 크롤링 및 통합 검색”
- **문제:** DCAT와 DCAT-AP는 metadata 어휘와 profile이다. 분산 크롤링, cache 갱신, 접근제어와 Catalog Broker 동작을 규정하지 않는다.
- **교체 문안:**

> Legacy catalogue metadata는 국토교통 DCAT 3 Application Profile로 정규화한다. 전송 가능한 Offering은 Offering Provider Connector가 DSP Catalog의 Dataset·Offer·Distribution·DataService로 게시한다. DSP Catalog Service 직접 조회를 기본 경로로 두고, Catalog Broker 또는 local cache는 운영상 필요한 경우 선택 배치한다. DCAT metadata만 확보된 record는 discovery-only로 유지한다.

- **검증:** direct Catalog와 선택 Broker 경로에서 upstream Offer·Policy·Provider provenance 보존 여부를 시험한다.
- **근거:** C-004, C-026, C-035, SRC-TECH-001, SRC-TECH-016

### T-04. Gaia-X Self-Description과 EDC crawler의 위치

- **우선순위:** P1
- **대상:** 본문 p.41, p.158, p.290. PDF p.53, p.170, p.302
- **대상 문장:** “연합 카탈로그는 Gaia-X 준수 Self-Description으로 기술”, “FederatedCatalogNode와 FederatedCatalogCrawler로 이루어짐”
- **문제:** Gaia-X Self-Description은 선택 trust profile이고 Node·Crawler는 EDC 계열 구현 구조다. DSP Catalog의 필수 구성은 아니다.
- **교체 문안:**

> DSP Catalog Service와 Catalog Broker의 규범 요구를 먼저 정의한다. EDC Federated Catalog Node·Crawler는 후보 구현으로, Gaia-X Self-Description은 특정 federation이 요구할 때 적용하는 선택 profile로 분리한다. Gaia-X profile을 적용하지 않는 국내 Participant도 승인된 국토교통 profile과 DSP로 상호작용할 수 있어야 한다.

- **검증:** 규범 요구, 제품 구현과 federation별 선택 profile을 별도 요구사항 ID로 추적한다.
- **근거:** C-004, C-017, SRC-TECH-001

### T-05. DSP와 실제 payload 전송의 경계

- **우선순위:** P0
- **대상:** 본문 p.210 L3 설명과 관련 아키텍처 그림. PDF p.222
- **대상 문장:** “표준화된 Dataspace Protocol을 통해 실제 데이터를 전송하는 게이트웨이”
- **문제:** DSP는 Catalog·Contract Negotiation·Transfer Process의 제어 메시지와 상태를 정의
- **전송 경계:** HTTP, 객체 저장소(Amazon Simple Storage Service, S3), file, OGC API와 stream은 DSP 범위 밖
- **교체 문안:**

> L3 Control Gateway는 DSP Catalog·Contract Negotiation·Transfer Process 메시지와 상태 전이를 처리한다. 실제 payload는 Agreement와 Transfer Process가 선택한 별도 Data Transfer Profile에 따라 Data Plane, API gateway, object store 또는 stream broker가 전달한다. source readiness를 확인하기 전에는 Transfer Start를 보내지 않는다.

- **그림 수정:** DSP/DCP scope 경계를 Data Plane 내부 전송 adapter까지 덮지 않도록 다시 그리고, Control Plane과 Data Transfer Profile 사이에 format·endpoint·credential binding을 표시한다.
- **검증:** Catalog와 협상 성공 뒤에도 source provisioning 실패 시 payload를 호출하지 않고 Transfer Start를 보내지 않는 시험을 추가한다.
- **근거:** C-003, C-028, C-042, SRC-TECH-001

### T-06. EDC 기능을 protocol 규범처럼 쓴 부분

- **우선순위:** P1
- **대상:** 본문 p.39~40, p.158, p.214, p.289. PDF p.51~52, p.170, p.226, p.301
- **대상 문장:** “Data Plane Framework는 커넥터의 가장 근본적인 설계방식”, “HTTP·S3·Kafka 등 멀티프로토콜 지원”
- **문제:** Control Plane/Data Plane 분리와 특정 EDC Data Plane Framework의 지원 범위를 같은 규범으로 기술
- **구현 경계:** adapter 지원 범위는 EDC release와 extension의 구현 세부
- **확인 범위:** EDC v0.18.0 core Data Plane은 finite transfer와 작은 event payload 대상
- **위임 범위:** 고용량 저지연 stream과 데이터 추출·변환·적재(Extract Transform Load, ETL)는 전문 인프라가 담당
- **교체 문안:**

> Control Plane과 Data Plane의 책임을 분리한다. EDC를 후보로 평가할 경우 release와 extension을 고정하고 지원 source·sink 조합을 실증한다. 고용량 stream은 Kafka 등 전문 broker, API 노출은 검증된 gateway, 변환·마스킹·CRS 변환은 별도 pipeline이 맡는다. EDC 제품 기능을 DSP 규범 요구로 설명하지 않는다.

- **검증:** 구현 version, extension 목록, 전송별 최대 payload·throughput·retry·backpressure와 실패 모드를 시험한다.
- **근거:** C-017, C-036~C-040, SRC-TECH-012~SRC-TECH-015

### T-07. 모든 참여자의 자체 Connector 설치 의무

- **우선순위:** P2
- **대상:** 본문 p.39, p.213. PDF p.51, p.225
- **대상 문장:** “모든 참여자는 커넥터를 자신의 환경에 배포”, “모든 참여자가 자신의 환경에 설치하는 관문 소프트웨어”
- **문제:** Participant Agent는 논리 역할이다. self-hosted, managed Connector와 tenant가 격리된 CaaS를 모두 허용할 수 있다.
- **교체 문안:**

> 각 Participant는 자기 책임 아래 Participant Agent를 사용한다. 배치는 self-hosted Connector, managed Connector 또는 tenant가 격리된 CaaS 중에서 선택할 수 있다. 운영 주체가 달라도 Participant ID, key, credential, policy, audit와 source binding은 tenant별로 분리한다.

- **검증:** CaaS 후보는 tenant 간 key·metadata·policy·log·network isolation과 운영자 권한을 시험한다.
- **근거:** C-030~C-034, SRC-CASE-001, SRC-CASE-004

### T-08. DCP, 자체 발급(Self-Issued, SI) ID Token과 Identity Hub 설명

- **우선순위:** P1
- **대상:** 본문 p.41~42, p.290~292. PDF p.53~54, p.302~304
- **대상 문장:** “각 DSP 메시지에는 Self-Issued Identity Token이 첨부”, “Identity Hub가 새로운 Credential의 발급·재발급을 관리”
- **문제:** 선택 identity·claims profile인 DCP를 DSP message의 필수 body field처럼 기술
- **전송 위치:** DCP 선택 시 SI ID Token은 DSP JSON body가 아닌 HTTPS Authorization Bearer header로 제출
- **역할 경계:** Participant Credential Service와 trust anchor Issuer Service를 별도 운영 역할로 구분
- **교체 문안:**

> DCP 1.0 trust profile을 선택한 경우 Participant Agent는 DSP HTTPS 요청의 Authorization Bearer header에 Self-Issued ID Token을 제출한다. Participant는 STS·Credential Service·DID Service를 운영하고, trust anchor의 Issuer Service는 자격증명의 발급·철회 수명주기를 맡는다. VC Data Model, proof format, status method와 알고리즘은 federation별 호환성 profile로 고정한다. DSP 자체는 DCP 사용을 강제하지 않는다.

- **검증:** 두 독립 구현체로 token audience·expiry·replay, Presentation Query, credential issuance·status·revoke를 시험한다.
- **근거:** C-007, SRC-TECH-004, SRC-TECH-023

### T-09. DAPS와 DCP를 동시에 기본모델로 둔 내부 모순

- **우선순위:** P1
- **대상:** 본문 p.41과 p.210~211. PDF p.53과 p.222~223
- **대상 문장:** 앞부분의 “DAPS에서 DCP로 전환”과 뒤의 “1단계 DAPS·DAT·CA”
- **문제:** token·Participant ID·issuer·claim mapping과 전환 조건 없이 두 trust model을 함께 제시
- **책임 혼용:** 동적 속성 토큰(Dynamic Attribute Token, DAT)이 통신 무결성을 보장한다는 문장은 TLS와 token 검증 책임을 혼합
- **교체 문안:**

> 각 deployment는 하나의 승인된 identity profile을 사용한다. 신규 기본 profile은 federation 요구와 PoC 결과로 결정한다. 기존 IDS/DAPS 상호운용 요구가 확인되면 DAPS는 별도 legacy gateway로 격리하고 claim mapping, dual-run, cutover, rollback과 종료조건을 정의한다. 통신 무결성은 TLS와 token signature·audience·expiry·replay 검증으로 확보한다.

- **검증:** 한 요청이 두 trust validator를 우회 경로로 사용하지 못하도록 endpoint와 policy를 분리한다.
- **근거:** C-007, SRC-TECH-004

## 3. 기존 플랫폼 연계와 아키텍처 수정안

### T-10. Platform-to-Dataspace Bridge와 DSP 상태기계 누락

- **우선순위:** P0
- **대상:** 본문 p.158~160, p.289~293. PDF p.170~172, p.301~305
- **대상 문장:** “DSP 2025-1 및 DCP를 준수하는 커넥터 개발”, “Control Plane은 카탈로그·계약협상·전송프로세스 관리”
- **문제:** Connector와 legacy adapter 사이의 Offering 자격 판정·Agreement-to-entitlement 변환 주체가 없음
- **누락 항목:** 수신 확인(Acknowledgement, ACK), 양측 PID, 재시도와 cleanup 규칙
- **교체 문안:**

> Platform-to-Dataspace Bridge를 별도 구성기술로 개발한다. Bridge는 Metadata Harvester, Offering Eligibility, Offering Mapper, private Source Binding Registry, Agreement·Subscription Orchestrator와 Reconciler로 구성한다. Contract Negotiation은 양측 PID와 REQUESTED·OFFERED·ACCEPTED·AGREED·VERIFIED·FINALIZED·TERMINATED 상태를 저장하고, 각 메시지의 ACK 뒤에만 상태를 전이한다. Agreement는 협상과 별도 자원으로 보관한다. Transfer Request는 consumerPid·agreementId·format·callbackAddress와 push dataAddress를, Transfer Start는 providerPid·consumerPid와 pull dataAddress를 검증한다. ERROR는 상태를 바꾸지 않으며 재요청은 멱등 처리한다.

- **검증 순서:** FINALIZED ACK, Transfer Request ACK, source provisioning과 Transfer Start 시험
- **복구 검증:** completion·termination, callback 유실, process restart와 reconciliation 시험
- **근거:** C-027, C-028, C-041, C-042, C-055

### T-11. 통합채널을 중앙 Data Center 또는 Provider로 단정한 부분

- **우선순위:** P1
- **대상:** 본문 p.101, p.145·163. PDF p.113, p.157·175
- **대상 문장:** “국토교통부의 중심 데이터 센터 역할”, “소재 파악과 중개 수준에 그쳐”
- **문제:** 로그인 후 확인된 범위는 metadata 검색·index 기능이다. Dataset별 payload hosting, subscription broker와 재제공 권한은 확인되지 않았다. Catalog Broker, platform broker와 Offering Provider도 구분되지 않는다.
- **교체 문안:**

> 현재 확인된 범위에서 통합채널은 metadata 검색·index 기능을 제공한다. Dataset과 delivery path별 역할은 hosted, brokered, index-only, unknown 중 하나로 증거와 함께 판정한다. unknown과 index-only record에는 DSP Offer를 만들지 않는다. 원 보유기관, metadata publisher, platform operator, Offering Provider Participant, Agreement 당사자, Connector operator와 delivery operator를 각각 기록한다.

- **검증:** Dataset Passport에 역할, 권리 증거, source endpoint, subscription API와 담당기관 승인 결과를 연결한다.
- **근거:** C-001, C-002, C-039, SRC-MOLIT-001, SRC-MOLIT-009

### T-12. 중앙형에서 탈중앙형으로 가는 선형 성숙도

- **우선순위:** P0
- **대상:** 본문 p.154~157과 성숙도 그림, p.162, p.289~293. PDF p.166~169, p.174, p.301~305
- **대상 문장:** “Stage 1에서 Stage 4 탈중앙화에 이르는 단계적 전환”, “4단계는 P2P 직접 Catalog 조회”
- **문제:** centralized, federated, decentralized는 배치 pattern이지 자동적인 성숙도 순서가 아니다. 같은 보고서 p.162는 IDS-RAM 5에 단일 정답 아키텍처가 없다고 적어 앞 문장과 충돌한다. p.156과 과제카드의 종료 목표도 다르다.
- **교체 문안:**

> 성숙도는 topology가 아니라 검증된 capability와 Gate로 정의한다. Gate 0은 source·권리·Provider·interface 증거 확보, Gate 1은 Discovery Bridge, Gate 2는 공개 Dataset의 Offering·Agreement·Transfer·revoke 수명주기, Gate 3은 기관 제한 데이터의 identity·policy·secure analysis 승인, Gate 4는 다기관 상호운용·복구·운영 SLO 검증이다. centralized, federated, decentralized 배치는 각 Gate에서 요구사항에 따라 ADR로 선택하며 함께 사용할 수 있다.

- **그림 수정:** Stage별 중앙·분산 아이콘 대신 capability Gate와 검증 증거를 표시한다.
- **근거:** C-034, C-056, SRC-TECH-019

### T-13. “Data Lake 방식 자체의 근본적 모순” 표현

- **우선순위:** P2
- **대상:** 본문 p.9·111·154. PDF p.21·123·166
- **대상 문장:** “데이터를 물리적으로 한곳에 모으는 데이터레이크 방식 자체의 근본적 모순”, “중앙집중형 구조는 성숙도 0단계”
- **문제:** 기관 내부 Data Lake는 데이터 스페이스와 공존할 수 있다. 문제는 기관 간 공유를 위해 모든 원본을 중앙 복제하거나 단일 운영자가 권한과 계약을 대행하도록 강제하는 구조다.
- **교체 문안:**

> 기존 Data Lake·Data Hub는 기관 내부의 system of record로 유지할 수 있다. 구조적 문제는 기관 간 공유를 위해 원본 전체를 중앙 저장소로 복제하거나 단일 운영자가 모든 제공계약과 접근권한을 대행하도록 강제할 때 발생한다. 조직 경계에는 Connector·Bridge, 명시적 권리와 접근 수명주기를 둔다.

- **근거:** C-015, C-034

### T-14. “Connector와 adapter를 부착하면 자연스럽게 온보딩”

- **우선순위:** P1
- **대상:** 본문 p.22·112·210, p.281. PDF p.34·124·222·293
- **대상 문장:** “프로토콜 어댑터를 기존 플랫폼에 부착하여 자연스럽게 온보딩”, “API와 데이터를 데이터 스페이스 규격으로 변환”
- **문제:** 형식 변환은 Provider 권한, Offer, source credential, subscription과 철회 처리를 만들지 않는다.
- **교체 문안:**

> 기존 DB와 API는 system of record로 유지하고 Platform Bridge를 배치한다. Bridge는 승인된 metadata export를 수집하고 Dataset·delivery path의 역할과 Offering Provider 권한을 판정한다. 원천 endpoint·credential·query 제한은 public Catalog가 아닌 private source binding으로 관리한다. 승인된 hosted 또는 brokered record만 Offering으로 게시하고 Agreement·Transfer를 platform subscription·entitlement·token·job·ACL에 연결한 뒤 변경·삭제·회수를 reconciliation한다.

- **검증:** index-only record가 negotiation 대상이 되지 않는지, source binding이 Catalog와 log에 노출되지 않는지 시험한다.
- **근거:** C-034, C-035, C-039, C-055

## 4. 정책·보안·AI 수정안

### T-15. ODRL과 “완벽한 데이터 주권”

- **우선순위:** P0
- **대상:** 본문 p.42, p.96, p.135, p.157~158, p.213, p.293. PDF p.54, p.108, p.147, p.169~170, p.225, p.305
- **대상 문장:** “정책엔진으로 완벽한 데이터 주권을 보장”, “공유 후에도 지속적으로 통제”, “ODRL 기반 정책 자동 집행”
- **문제:** ODRL은 policy expression model이다. 실제 통제는 policy decision과 각 집행점의 동작에 달려 있다. 파일이 소비자 환경으로 반출된 뒤 Provider Connector만으로 목적 제한을 계속 강제할 수 없다.
- **교체 문안:**

> ODRL은 이용조건을 기계판독 가능하게 표현한다. 국토교통 ODRL/DSP Policy Profile은 허용 action, operand, operator, datatype, duty·prohibition, credential mapping, 평가시점과 미지원 표현의 fail-closed 규칙을 version 관리한다. 각 조건은 Catalog visibility, negotiation, Transfer provisioning, Data Plane filter·quota·token, secure analysis, 만료·회수 중 실제 집행점에 연결한다. 반출 후 조건은 소비자측 통제환경, 감사와 법적 약정에 의존하므로 잔여위험을 명시한다.

- **검증:** 정책 결정 지점(Policy Decision Point, PDP)의 결정과 정책 집행 지점(Policy Enforcement Point, PEP)의 위치를 기록한다. 실패 시 차단, revoke latency와 반출 후 비집행 조건도 제출한다.
- **근거:** C-006, SRC-TECH-003

### T-16. PROV-O와 객관적 감사·분쟁해결

- **우선순위:** P1
- **대상:** 본문 p.42, p.155·158, p.213. PDF p.54, p.167·170, p.225
- **대상 문장:** “PROV-O 기반 Observability로 객관 감사와 분쟁 해결”
- **문제:** PROV-O는 provenance 정보를 표현·교환하는 ontology다. log의 완전성, 무결성, 부인방지와 신뢰할 수 있는 시각을 제공하지 않는다.
- **교체 문안:**

> PROV-O는 감사 event의 의미모델 후보로 사용한다. 실제 감사 증거는 append-only 또는 tamper-evident 저장, 서명된 receipt, 동기화된 시각, consumerPid·providerPid·agreementId·platform external ID correlation, 보존·접근·redaction 정책과 양측 reconciliation으로 보호한다. 분쟁 절차와 증거 인정 기준은 별도 운영규칙으로 둔다.

- **검증:** event 누락·변조·clock skew·상대방 log 불일치와 독립 export 검증을 시험한다.
- **근거:** C-054, SRC-TECH-026

### T-17. JSON-LD가 용어를 자동으로 mapping한다는 설명

- **우선순위:** P1
- **대상:** 본문 p.43, p.155·160. PDF p.55, p.167·172
- **대상 문장:** “JSON-LD 의미 해석 규칙을 통해 자동으로 용어 간 매핑”
- **문제:** JSON-LD context는 선언된 term을 IRI로 확장한다. 서로 다른 IRI의 동치, 범위, 단위와 값 변환을 자동 추론하지 않는다.
- **교체 문안:**

> JSON-LD context는 term을 안정된 IRI로 확장한다. 서로 다른 model의 의미 정렬은 명시적 SKOS mapping, OWL axiom, SHACL rule과 사람이 승인한 mapping registry로 수행한다. 자동 추천 결과에는 confidence, 근거, reviewer와 version을 기록하고 승인 전에는 production 변환에 적용하지 않는다.

- **검증:** 동음이의어, 단위·CRS 불일치, one-to-many mapping을 포함한 gold set에서 precision·recall을 측정한다.
- **근거:** C-049, SRC-TECH-029

### T-18. C2D면 개인정보·민감정보를 활용할 수 있다는 문장

- **우선순위:** P0
- **대상:** 본문 p.111, p.135·154~159, p.213, p.289. PDF p.123, p.147·166~171, p.225, p.301
- **대상 문장:** “개인정보·민감정보 포함 데이터도 원본을 이동시키지 않고 연계 활용 가능”
- **문제:** C2D와 SPE는 원본 반출을 줄일 뿐 처리·제3자 제공·위탁·목적 제한의 법적 근거나 보안승인을 만들지 않는다. 결과, model, gradient와 소규모 집계에서도 정보가 유출될 수 있다.
- **교체 문안:**

> C2D와 SPE는 원본 반출을 줄이는 기술적 처리 방식이며 데이터 이용의 법적 근거와 보안승인을 대체하지 않는다. 실행 전 Dataset별로 개인정보·가명정보·위치정보·공개제한 공간정보 해당성, 목적, 수신자, 보유기간, 재식별 위험과 승인 환경을 판정한다. Catalog metadata도 공개제한 정보를 최소화한다. 초기 PoC에는 공개·합성·집계 데이터를 사용한다.

- **검증:** Dataset Passport의 법무·개인정보·공간정보·보안 Gate가 모두 승인되기 전 Offering 게시와 실행을 차단한다.
- **근거:** C-008~C-011, SRC-LAW-001~SRC-LAW-009

### T-19. C2D를 DSP 기본기능처럼 설명한 부분

- **우선순위:** P1
- **대상:** 본문 p.135·155~160·213, p.290~293. PDF p.147·167~172·225, p.302~305
- **대상 문장:** “데이터 스페이스는 C2D를 지원”, “C2D 모델은 Docker 이미지 기반 분석알고리즘 전송”
- **문제:** DSP는 compute job, image attestation, sandbox, result review를 규정하지 않는다.
- **교체 문안:**

> C2D는 별도 국토교통 Application Profile로 정의한다. DSP Offer와 Agreement에는 Dataset, algorithm, 목적, 실행조건과 output policy를 담고 Transfer Process는 승인된 image artifact 또는 execution endpoint 교환을 조정한다. job lifecycle, attestation, sandbox, quota, egress, output review와 cleanup은 별도 API·상태·시험으로 정의한다.

- **검증:** DSP TCK와 C2D 보안·운영 시험을 별도 결과로 제출한다.
- **근거:** C-003, C-053, SRC-TECH-025

### T-20. Docker·가상 데스크톱 인프라(Virtual Desktop Infrastructure, VDI)·비무장지대(Demilitarized Zone, DMZ) 검증

- **우선순위:** P0
- **대상:** 본문 p.159, p.290~291. PDF p.171, p.302~303
- **대상 문장:** “Docker 이미지 전송·실행·결과반환 정상동작 및 원본데이터 비유출 검증”, “VDI 기반 SPE”
- **문제:** 정상실행 1회는 악성 image·container escape·host mount 공격을 검증하지 않음
- **유출 경로:** DNS·network egress, secret 탈취, output과 model artifact 유출도 별도 시험 필요
- **교체 문안:**

> C2D/SPE는 자산등급별 threat model과 security profile로 설계한다. 서명된 image와 SBOM, 승인 runtime, rootless·non-privileged 실행, read-only filesystem, host mount 금지, network default-deny, DNS·egress allowlist, resource quota, 단기 workload identity, 암호화된 임시저장소와 job 종료 후 cleanup을 적용한다. 결과 반출은 크기, schema, 소수집단, 정밀도, model artifact와 민감정보 검사를 거쳐 승인한다.

- **공격 검증:** 악성 image·network exfiltration·DNS tunnel·secret access와 container escape negative test
- **결과 검증:** 과도한 output, 중단 후 잔존 데이터와 cleanup 실패 negative test
- **근거:** C-053, SRC-TECH-025

### T-21. MCP·에이전트 간 프로토콜(Agent-to-Agent Protocol, A2A)과 AI Agent의 자율 계약·전송

- **우선순위:** P0
- **대상:** 본문 p.94·97~98, p.155·157·159, p.289~293. PDF p.106·109~110, p.167·169·171, p.301~305
- **대상 문장:** “MCP/A2A 기반 자율 탐색·협상·전송·검증”, “AI Agent가 공급자·수요자로 자율 참여”
- **문제:** MCP는 agent와 tool·resource의 연결, A2A는 agent 간 통신을 다룬다. 둘 다 DSP Agreement 체결 권한, Participant의 법적 책임, DCP claims나 payment를 부여하지 않는다.
- **교체 문안:**

> MCP와 A2A는 Participant Agent 뒤의 application integration layer로 둔다. AI Agent는 신뢰하지 않는 planner로 취급하고 Connector signing key와 source credential을 주지 않는다. Participant가 발급한 단기 delegation token에는 허용 Dataset·action·기간·sink·비용한도를 넣는다. DSP 상태전이, policy 평가, Agreement 승인, Transfer와 platform provisioning은 결정론적 Control Plane과 승인 workflow가 집행한다. 유료 Offering, 제한 데이터, 외부 sink와 조건 변경에는 명시적 위임과 사람 승인 Gate를 둔다.

- **검증:** prompt injection, tool output poisoning, approval bypass, unauthorized Agreement·Transfer·payment·external sink와 secret log 노출이 각각 0건이어야 한다.
- **근거:** C-052, SRC-TECH-024, SRC-TECH-030

### T-22. 국내 법률 조항 자동식별·Legal Trigger

- **우선순위:** P0
- **대상:** 본문 p.155~159. PDF p.167~171
- **대상 문장:** “국내 6법 조항별 Legal Trigger 자동 매핑·자동 식별”
- **문제:** metadata만으로 처리 근거, 제3자 제공, 위탁, 목적 적합성과 공개제한 여부를 확정할 수 없다. false negative는 무단 제공으로 이어진다.
- **교체 문안:**

> Legal Trigger 기능은 법률 판정 엔진이 아니라 검토 대상과 필요한 증거를 제시하는 decision-support rule로 제한한다. 각 rule에는 조문, 시행일, 적용 전제, 입력필드, version, owner와 검토일을 기록한다. 정보가 없거나 rule이 충돌하면 fail-closed로 처리한다. 법무·개인정보·공간정보·보안 승인자가 Dataset Passport에 서명한 뒤 Offering을 게시한다.

- **검증:** 법령 version 변경, 누락 metadata, 상충 rule과 승인 철회 시 게시·협상·전송이 차단되는지 시험한다.
- **근거:** C-008~C-011, C-024, C-025

### T-23. DID·VC·선택적 공개·하드웨어 보안 모듈(Hardware Security Module, HSM)의 일괄 고정

- **우선순위:** P1
- **대상:** 본문 p.158, p.290. PDF p.170, p.302
- **대상 문장:** “did:web, JWT, SD-JWT, BBS 서명, Bitstring Status List, FIPS 140-3 Level 3 HSM”
- **문제:** DID method·VC Data Model·proof·presentation은 별도 선택축
- **추가 선택축:** selective disclosure·status와 key protection
- **적용 한계:** 구성요소 나열은 상호운용성을 보장하지 않으며 특정 HSM 등급의 전 자산 적용 근거도 없음
- **교체 문안:**

> federation별 credential security profile은 DID method, VC Data Model, proof·algorithm suite, presentation format, status method, key lifecycle와 recovery를 하나의 호환성 표로 고정한다. 키 보호와 HSM 요구는 threat tier와 국내 공공 보안기준으로 결정한다. crypto agility, key rotation과 profile migration 절차를 포함한다.

- **검증:** 두 독립 구현체 간 issuance·presentation·status·revocation·key rotation과 algorithm rejection을 시험한다.
- **근거:** C-007, SRC-TECH-004, SRC-TECH-023

### T-24. 출처 이력 모델(Provenance, PROV), Clearing House와 Gaia-X Digital Clearing House(GXDCH) 혼용

- **우선순위:** P1
- **대상:** 본문 p.42, p.158, p.213, 과제카드의 clearing house 문장. PDF p.54, p.170, p.225
- **대상 문장:** “Clearing House가 거래 이력과 분쟁을 처리”, “Clearing House가 Self-Description을 자동 검증”
- **문제:** 국제 데이터 스페이스(International Data Spaces, IDS) Clearing House·Observability, Gaia-X Digital Clearing House와 국토교통 Compliance Validator는 목적과 운영자가 다른 서비스
- **교체 문안:**

> IDS Clearing House 또는 Observability는 교환 증거와 감사 역할, GXDCH는 선택한 Gaia-X Trust Framework profile의 validation·notarization 역할, 국토교통 Compliance Validator는 국내 profile의 schema·rule 검증 역할로 각각 명명한다. 각 서비스의 input, output, API, trust boundary, 보존정책과 운영주체를 분리한다.

- **검증:** 한 서비스의 검증 성공을 다른 서비스의 보안·법률 승인으로 재사용하지 않는다.
- **근거:** C-054, SRC-TECH-019, SRC-TECH-026

## 5. 과제카드·성과지표 수정안

### T-25. TCK 릴리스 후보 6(Release Candidate 6, RC6), “TCK 인증”과 전체 상호운용성

- **우선순위:** P0
- **대상:** 본문 p.160·291~294·302. PDF p.172·303~306·314
- **대상 문장:** “DSP-TCK-RC6 및 DCP-TCK-RC6 100% 통과”, “DSP TCK 인증 커넥터”, “인증 커넥터 3종”
- **문제:** 2026-07-11 공식 repository 공개 release는 DSP TCK 1.0.1과 DCP TCK 1.0.2이며 RC6 고정은 현행 기준선과 불일치. 근거: SRC-TECH-022, SRC-TECH-023
- **검증 범위:** TCK는 포함된 protocol test의 compatibility·compliance 시험이며 공식 인증서나 adapter·보안·운영 전체의 검증이 아님
- **교체 문안:**

> DSP 2025-1 errata 1과 대응 DSP TCK 1.0.1, 선택한 DCP 1.0 profile과 DCP TCK 1.0.2를 기준선으로 고정한다. 시험 시 SUT commit, 설정, generated test plan, 적용·제외 case와 원시 결과를 보존한다. 결과는 TCK 적합성 시험 통과로 표기하며 인증이라는 표현은 독립 인증제도와 인증서가 확인된 경우에만 사용한다. 두 개 이상의 독립 Connector 간 wire 상호운용, 실제 transfer profile, 보안과 복구시험을 별도로 수행한다.

- **검증:** Provider·Consumer 양 역할, ACK loss, retry, out-of-order, termination과 restart를 포함한다.
- **근거:** C-050, SRC-TECH-022, SRC-TECH-023

### T-26. RDF 저장과 metadata Connector의 혼용

- **우선순위:** P1
- **대상:** 본문 p.160, p.281. PDF p.172, p.293
- **대상 문장:** “RDF 형태의 데이터 저장구조 설계 및 데이터 변환”, “메타데이터 자동연계를 위한 표준 커넥터”
- **문제:** DCAT 적합성을 위해 영상·시계열·Parquet·GeoPackage와 원천 관계형 데이터베이스(Relational Database, RDB) payload 전체를 RDF로 이관할 필요가 없음
- **역할 구분:** Metadata Harvester와 DSP Connector는 별도 책임을 가짐
- **교체 문안:**

> 레거시 payload는 원래 형식 또는 승인된 delivery format으로 유지한다. DCAT catalog description과 선정된 의미 관계만 RDF로 표현한다. Triple Store는 명시한 competency question과 성능시험에서 효용이 확인된 범위에만 사용한다. Metadata Harvester는 legacy export·delta·delete를 canonical metadata로 변환하고, DSP Connector는 Offering·Agreement·Transfer를 처리한다.

- **검증:** 원본 payload, canonical metadata, semantic view와 변환 provenance를 분리하고 source deletion이 Catalog tombstone으로 반영되는지 시험한다.
- **근거:** C-005, C-013, C-034, SRC-TECH-002, SRC-TECH-016

### T-27. 시스템 수·문서 작성 여부 중심의 완료 기준

- **우선순위:** P0
- **대상:** 본문 p.109, p.281·284·286~297. PDF p.121, p.293·296·298~309
- **대상 문장:** “643개 중 30% 수준 190여개 시스템 연계”, “5개 이상 레거시 시스템”, “Adapter 기능정의서 작성”, “구축 여부”
- **문제:** discovery metadata 연결과 full Offering lifecycle을 같은 연계 건수로 집계할 수 있으며 문서·회의를 동작 증거로 사용
- **성과지표(Key Performance Indicator, KPI) 경계:** 검토 대상 보고서의 17건·30%·5건·50개 catalog entry 사이에 분모와 포함관계가 없음. 대상: 본문 p.109·281·284·286~297
- **교체 문안:**

> 사업 착수 시 후보 시스템과 Dataset 목록을 동결하고 catalog-source-verified, offering-eligible, poc-ready와 operations-ready를 별도 집계한다. Full lifecycle 연계는 Provider 권한과 source binding 확인, Catalog 조회, Agreement 교환·검증과 FINALIZED ACK, Transfer provisioning, payload 전달, 종료 후 revoke, callback 유실·restart 후 reconciliation, SLO와 감사 correlation을 모두 통과한 경우에만 1건으로 인정한다. 시스템 수 KPI와 Dataset·Offering KPI의 crosswalk를 제출한다.

- **검증:** 각 집계값에 Dataset Passport, wire trace, platform resource query, cleanup evidence와 test run ID가 있어야 한다.
- **근거:** C-034, C-041, C-042, C-055

### T-28. 시맨틱·AI Ready 비율의 분모와 판정기준

- **우선순위:** P1
- **대상:** 본문 p.161과 관련 성과지표 표. PDF p.173
- **대상 문장:** “메타데이터 프로파일 정합률 95%”, “국제 어휘 매핑률 80%”, “온톨로지 정합률 90%”, “AI 학습 적합성 90%”, “metadata 부착률 100%”
- **문제:** 검토 대상 지표에 분모, gold set, 오류 등급, reviewer와 재현절차가 없음. 대상: 본문 p.161, PDF p.173
- **측정 한계:** metadata 부착률은 필드값의 완전성·정확성을 측정하지 않으며 SHACL 통과는 의미 정확성과 AI fitness의 증거가 아님
- **교체 문안:**

> 필수 SHACL 위반은 평가대상 record 대비 0건으로 관리하고 권고 위반은 별도 보고한다. 어휘 mapping은 동결한 source concept 집합을 분모로 mapped·partial·unmapped·excluded를 기록한다. 자동 의미연계는 독립 reviewer가 확정한 gold set의 precision·recall·F1으로 평가한다. AI Ready 여부는 과업별 Dataset Passport, train·validation·test leakage 검사, label 품질, bias·대표성, 고정 test set의 baseline model 결과와 알려진 한계로 판정한다.

- **검증 기준:** metric 정의서에 numerator·denominator·exclusion·severity와 sampling 기준 기록
- **재현 정보:** owner, tool version과 재현 command 기록
- **근거:** C-049, C-057

### T-29. 운영 즉시 이관과 고정 3-Tier 용량

- **우선순위:** P1
- **대상:** 본문 p.156·161·211, 운영 성과표. PDF p.168·173·223
- **대상 문장:** “R&D 종료 후 즉시 운영 가능”, “WAS 8 vCPU·32GB, DB 16 vCPU·64GB, Storage 10TB+”
- **문제:** workload와 보존정책 없이 용량을 고정
- **운영 누락:** availability·load와 key rotation 기준 없음
- **복구 목표:** 복구시간목표(Recovery Time Objective, RTO)와 복구시점목표(Recovery Point Objective, RPO) 미정의
- **변경 누락:** upgrade·rollback과 운영조직 인수기준 없음
- **교체 문안:**

> 용량은 Catalog QPS, 동시 negotiation·Transfer, payload size·throughput, stream partition·retention, C2D 동시 job, log 보존량과 장애 headroom을 기준으로 산정한다. 운영 준비는 clean-environment 배포, backup·restore, RTO·RPO, failover, 승인된 downtime, upgrade·rollback, key rotation, patch SLA, incident drill, runbook와 담당조직 인수시험을 통과한 capability Gate로 판정한다.

- **검증:** production-like load, failover, restore와 operator handover 결과를 성과물로 제출한다.
- **근거:** C-057

### T-30. 실제 공유데이터를 데이터 스페이스 공용 storage에 보관

- **우선순위:** P1
- **대상:** 본문 p.211 서버·스토리지 표. PDF p.223
- **대상 문장:** “Storage 10TB+: 실제 공유데이터 및 대용량 로그 보관 공간”
- **문제:** 데이터 스페이스 node가 원본 저장소로 바뀌어 기존 플랫폼을 system of record로 유지한다는 원칙과 충돌한다. payload와 audit log를 같은 storage class에 두는 것도 부적절하다.
- **교체 문안:**

> 기존 Data Lake·Data Hub·API를 system of record로 유지한다. Connector·Bridge에는 canonical metadata, Offer·Policy, DSP PID, source binding reference와 audit correlation만 저장한다. Materialized snapshot은 승인된 delivery mode에서만 암호화, version, TTL과 deletion evidence를 갖춘 임시자원으로 만든다. payload와 감사 log는 저장소, key, retention과 접근권한을 분리한다.

- **검증:** Agreement·Transfer 종료 뒤 temporary object 0건과 audit retention 보존을 동시에 확인한다.
- **근거:** C-015, C-034, C-055

### T-31. 고위험 유즈케이스의 개인정보·보안 Gate

- **우선순위:** P0
- **대상:** 본문 p.167~170. PDF p.179~182
- **대상 문장:** CCTV, 110·119·민원24 text, 작업자 생체·위치, 시민 행동 모니터링과 시설물 정밀 위치를 통합 Dataset으로 구축하는 단락
- **문제:** 학습 Dataset 명칭과 model만 있고 수집 근거·목적 제한·data subject·최소화 기준이 없음
- **보호 누락:** retention·재식별·공개제한 공간정보와 secure zone 기준이 없음
- **결과 누락:** output review와 삭제책임 미정의
- **교체 문안:**

> 유즈케이스마다 public, restricted, personal·pseudonymized, restricted-geospatial security zone을 분리한다. Dataset Passport에는 처리 근거, 목적, data subject·population, 수집·제공기관, 최소필드, 시간·공간 정밀도, retention·deletion, 재식별·편향 위험, 학습·평가 split, 허용환경, output review와 승인자를 기록한다. 공개·합성·집계 데이터로 architecture를 먼저 검증하고 개인정보·위치정보·공개제한 공간정보는 별도 Gate 승인 후 secure analysis에서만 실증한다.

- **검증:** zone 간 egress, small-cell·trajectory reconstruction, face·vehicle identifier leakage, model memorization, output disclosure와 deletion test를 수행한다.
- **근거:** C-009~C-011, C-025

### T-32. 근거 없는 기술격차 연수와 Lighthouse 수

- **우선순위:** P1
- **대상:** 본문 p.91 표 2와 p.98 국내 기술수준. PDF p.103, p.110
- **대상 문장:** “DSP/DCP 5~7년”, “Connector 4~5년”, “DCAT-AP 6년”, “200개 이상의 Lighthouse Project”, “운영정착 8년”
- **문제:** 비교대상, 측정도구, 표본, 기준일과 산식이 없다. 표준 version 차이를 개발역량의 연수로 바꾸거나 project 수를 운영성숙도의 근거로 쓸 수 없다.
- **교체 문안:**

> 연도 단위 기술격차와 확인되지 않은 project 수는 삭제한다. 국내 capability는 DSP Provider·Consumer TCK, 이기종 Connector wire 시험, Offering·Agreement·Transfer·revoke 수명주기, identity profile, policy enforcement, metadata·domain schema, security, operations 항목별로 평가한다. 각 항목은 demonstrated, partially demonstrated, not demonstrated, not assessed 중 하나와 증거 artifact를 기록한다.

- **검증:** capability score마다 시험 ID, 대상 version, 수행기관, 날짜와 원시결과가 있어야 한다.
- **근거:** C-050, C-055

### T-33. 상세수준(Level of Detail, LOD)을 서비스 성숙도 의미로 사용

- **우선순위:** P2
- **대상:** 본문 p.135와 유즈케이스 단계 설명. PDF p.147
- **대상 문장:** “LOD(Level of Detail) 기반 맞춤형 유즈케이스”
- **문제:** 국토·공간·건설정보모델링(Building Information Modeling, BIM) 분야에서 LOD는 공간 객체나 model의 상세수준을 의미
- **혼동:** 현황 파악·예측·운영대응·정책지원 단계에 같은 약어를 사용하면 metadata의 spatial level과 충돌
- **교체 문안:**

> 유즈케이스 서비스 단계는 Use-case Capability Level 또는 UCL로 명명한다. UCL 1은 현황 조회, UCL 2는 데이터 연계·예측, UCL 3은 운영자 승인 기반 대응, UCL 4는 광역 정책지원으로 정의한다. LOD는 BIM·3D·공간정보의 상세수준에만 사용한다.

- **검증:** glossary와 Dataset Passport에서 UCL과 spatial·BIM LOD를 별도 필드로 관리한다.

### T-34. “국내 최초 완전한 구현”과 기술 불확실성 과소평가

- **우선순위:** P1
- **대상:** 본문 p.163·214. PDF p.175·226
- **대상 문장:** “국내 최초의 완전한 데이터 스페이스 구현 사례”, “기술적 불확실성이 낮고 단기간 내 prototype 구축 가능”
- **문제:** 국내 전체 구현사례를 배제했다는 조사 근거가 없고 완전함의 정의도 없다. 표준 구현체가 존재해도 legacy 권리·source binding, 고용량 stream, restricted data, C2D와 운영이관의 불확실성은 남는다.
- **교체 문안:**

> 국내 최초·완전한 구현이라는 표현은 사례조사와 판정기준이 확정되기 전에는 사용하지 않는다. 본 사업은 기존 공개 구현체와 표준을 활용하되 Platform Bridge, 국토교통 domain profile, restricted-data Gate, C2D/SPE와 운영이관에서 별도 연구·실증 위험을 가진다. prototype 범위와 production acceptance를 분리한다.

- **검증:** 국내 사례 search protocol, 포함·제외 기준과 capability 비교표를 공개한다.

### T-35. 자동정산·수익배분과 반출 후 이동 추적

- **우선순위:** P1
- **대상:** 본문 p.111. PDF p.123
- **대상 문장:** “AI 모델·서비스의 수익을 자동 정산·배분”, “데이터의 이동흐름을 추적하여 지속적인 수익 발생 시 보상”
- **문제:** DSP는 price calculation, payment, invoice, tax와 revenue sharing을 규정하지 않는다. 소비자 환경으로 전달된 파일의 이동과 파생 수익도 Connector가 완전하게 관찰할 수 없다.
- **교체 문안:**

> DSP Agreement와 Transfer evidence를 marketplace의 order·billing identifier에 연결할 수 있다. 가격계산, 세금계산서, 결제, 환불과 수익배분은 별도 marketplace·billing·회계 서비스가 수행한다. 측정 가능한 API call·stream usage·compute job만 기술적으로 계량하고, 반출 파일의 파생이용과 수익보고는 계약·감사 의무와 수신자 통제환경에 의존한다.

- **검증:** Agreement, order, invoice, payment와 usage event의 ID mapping, 중복 event와 환불·분쟁 시나리오를 시험한다.
- **근거:** C-003, C-006

### T-36. DSP 또는 DCAT 연결만으로 실시간·대용량 공유 가능

- **우선순위:** P1
- **대상:** 본문 p.98·109·112. PDF p.110·121·124
- **대상 문장:** “분산형 데이터 연계체계를 통해 실시간 대용량 데이터 직접 연계”, “DCAT-AP와 NGSI-LD를 결합하면 자동 등록하고 API 수준 주권형 공유”
- **문제:** DSP와 DCAT는 source throughput, latency, retention, backpressure, schema evolution과 source SLA를 만들지 않는다. NGSI-LD entity 등록도 Offering Provider 권한과 DSP Agreement를 대신하지 않는다.
- **교체 문안:**

> 실시간·대용량 전달은 Dataset별 Data Transfer Profile과 source SLA로 정의한다. Profile에는 protocol, format, partition·ordering, schema registry, throughput, latency percentile, retention, replay, backpressure, quota, integrity와 장애복구를 포함한다. NGSI-LD와 DCAT mapping은 discovery metadata를 만들 뿐이며, Offering Provider 권한, Offer·Distribution·source binding, Agreement와 Transfer lifecycle을 별도로 구성한다.

- **검증:** workload별 sustained throughput, p95·p99 latency, consumer lag, replay, schema change와 source outage를 시험한다.
- **근거:** C-003, C-013, C-037

## 6. 보고서에 추가할 기준 아키텍처

본문 p.158의 Connector 아키텍처와 과제카드 p.289 뒤에 다음 흐름을 추가한다.

1. Metadata Harvester가 공식 export·API에서 baseline, delta와 tombstone을 수집한다.
2. Offering Eligibility가 Dataset과 delivery path별 hosted·brokered·index-only·unknown 역할, Provider 권한과 이용허락을 판정한다.
3. Offering Mapper가 승인된 record를 Dataset·Offer·Distribution·DataService로 만든다.
4. Source Binding Registry가 원천 endpoint, credential reference, 허용 query, quota와 schema version을 public Catalog와 분리해 저장한다.
5. Provider Connector가 Catalog를 게시하고 Contract Negotiation을 수행한다.
6. FINALIZED Event가 ACK된 뒤 Dataset policy에 따라 Agreement scope subscription·entitlement를 준비한다.
7. Transfer Request가 ACK되면 Transfer scope token, signed URL, export job, 임시 접근제어목록(Access Control List, ACL) 또는 stream subscription을 만든다.
8. source readiness가 확인된 뒤 Transfer Start를 보낸다. payload는 별도 Data Transfer Profile로 이동한다.
9. Transfer completion·termination은 해당 Transfer scope 자원만 회수한다.
10. Agreement 만료·철회·해지와 Dataset withdrawal은 관련 active Transfer를 중지하고 Agreement·Transfer scope 자원을 모두 회수한다.
11. Reconciler가 callback 유실, process crash, orphan·missing·duplicate external resource를 desired state로 수렴시킨다.

세부 설계는 [Platform-to-Dataspace Bridge](../02-architecture/platform-connector-bridge.md), [Offering 수명주기](../02-architecture/offering-onboarding-lifecycle.md), [기존 플랫폼 인터페이스 계약](../02-architecture/platform-interface-contract.md)에 정의돼 있다.

## 7. 과제카드에 넣을 검증 계층

| 계층 | 최소 시험 | 완료 증거 |
| --- | --- | --- |
| Metadata | baseline·delta·delete·duplicate·out-of-order, SHACL | mapping report, tombstone trace |
| DSP conformance | version-pinned TCK, Provider·Consumer 역할 | test plan, raw result, SUT commit |
| DSP interoperability | 서로 다른 Connector 간 Catalog·Agreement·Transfer·ACK | wire trace, 양측 state history |
| Platform Bridge | Provider 권한, source binding, provisioning·revoke | platform resource query, reconciliation |
| Data Transfer | HTTP·file·OGC·stream별 payload, quota·resume·integrity | transfer receipt, checksum, throughput |
| Security | SSRF·DNS rebinding·auth bypass·secret leakage·tenant isolation | negative-test report |
| C2D/SPE | 악성 image, egress, output disclosure, cleanup | security evidence, deletion proof |
| AI Agent | prompt injection, delegation, approval·budget bypass | attack suite result, audit correlation |
| Operations | load, restart, backup·restore, failover, key rotation, RTO/RPO | drill report, runbook acceptance |

상세 test case는 [검증 계획](../03-plan/verification-plan.md)을 사용한다.

## 8. 유지할 내용

다음 방향은 삭제하지 않고 구체화한다.

- 기존 플랫폼과 데이터베이스(Database, DB)를 폐기하지 않고 system of record로 유지한다.
- Control Plane과 Data Plane의 책임을 분리한다.
- Dataset의 위치, 계약, 실제 delivery path를 분리한다.
- C2D와 SPE는 제한 데이터의 선택적 처리 pattern으로 연구한다.
- 국토교통 domain profile, 단위·CRS·시간·공간 해상도와 provenance를 관리한다.
- 유즈케이스에서 필요한 Dataset을 역산하되 권리·보안 Gate를 먼저 통과한다.
- 중앙, 연합, 분산 deployment를 하나의 환경에서 요구사항에 따라 조합한다.

## 9. 용어 일괄 교체

| 보고서 표현 | 교체 표현 |
| --- | --- |
| IDSA Dataspace Protocol | Eclipse Dataspace Protocol 2025-1 errata 1 |
| ISO/IEC 20151 표준화 완료 | ISO/IEC FDIS 20151-1 승인 단계, ISO/IEC DIS 26450·26451 개발 중 |
| DSP가 실제 데이터를 전송 | DSP가 Transfer Process를 조정하고 별도 Data Transfer Profile이 payload를 전달 |
| DCAT-AP 기반 연합 카탈로그 기술 | DCAT 3 metadata profile + DSP direct Catalog + 선택 Catalog Broker |
| FederatedCatalogNode·Crawler | EDC 후보 구현 |
| Gaia-X Self-Description | 선택 federation profile |
| DCP 준수 Connector | DSP Connector + 선택 DCP trust profile |
| TCK 인증 | version-pinned TCK 적합성 시험 통과 |
| 완벽한 데이터 주권 | 통제 가능한 지점의 정책 집행과 잔여위험 관리 |
| Legal Trigger 자동 판정 | versioned legal decision-support rule과 사람 승인 |
| AI Agent 계약 당사자 | Participant가 제한적으로 위임한 application agent |
| 개인정보도 원본 미이동으로 활용 가능 | 법적 근거·보안승인을 받은 경우 secure analysis에서 제한적으로 처리 |
| RDF 형태로 데이터 저장 | Catalog metadata와 선정한 semantic view만 RDF로 표현 |

## 10. 공식 근거

- [DSP 2025-1 errata 1](https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/)
- [DCP 1.0](https://eclipse-dataspace-dcp.github.io/decentralized-claims-protocol/)
- [DSP TCK](https://github.com/eclipse-dataspacetck/dsp-tck)
- [DCP TCK](https://github.com/eclipse-dataspacetck/dcp-tck)
- [W3C DCAT 3](https://www.w3.org/TR/vocab-dcat-3/)
- [DCAT-AP 3.0.1](https://semiceu.github.io/DCAT-AP/releases/3.0.1/)
- [GeoDCAT-AP releases](https://semiceu.github.io/GeoDCAT-AP/releases/)
- [W3C JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)
- [W3C ODRL 2.2](https://www.w3.org/TR/odrl-model/)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [ISO/IEC FDIS 20151-1](https://www.iso.org/standard/86589.html)
- [ISO/IEC DIS 26450](https://www.iso.org/standard/93502.html)
- [ISO/IEC DIS 26451](https://www.iso.org/standard/93503.html)
- [IDS-RAM 5 Working Draft](https://docs.internationaldataspaces.org/ids-knowledgebase/ids-ram-5-working-draft/introduction)
- [DIN EN 18235-1 draft](https://www.dinmedia.de/en/draft-standard/din-en-18235-1/393627662)
- [DIN EN 18235-2 draft](https://www.dinmedia.de/en/draft-standard/din-en-18235-2/398257912)
- [EDC v0.18.0 Data Plane Framework](https://github.com/eclipse-edc/Connector/blob/v0.18.0/core/data-plane/README.md)
- [MCP specification](https://modelcontextprotocol.io/specification/latest)
- [A2A Protocol](https://a2a-protocol.org/latest/)
- [미국 국립표준기술연구소(National Institute of Standards and Technology, NIST) 특별 간행물(Special Publication, SP) 800-190](https://csrc.nist.gov/pubs/sp/800/190/final)
- [MDS Mobilithek Data Offering](https://mobility-dataspace.eu/data-catalogue)

근거의 version과 확인일은 [출처 레지스터](../../evidence/source-register.yaml), 검토 판단은 [주장-근거 매트릭스](../../evidence/claim-evidence-matrix.md)에서 추적한다.
