# 검증 계획

작성일: 2026-07-11  
작성 기준: 2026-07-12  
상태: Draft

## 1. 목적과 범위

- **(목적)** 요구사항, 설계, 시험과 증거를 Test ID로 연결
- **(범위-근거)** 문서, 권리, 승인과 source evidence 검토
- **(범위-기술)** Contract, unit, integration, 상호운용과 적합성 시험
- **(범위-운영)** 보안, 법적 검토, 복원력과 운영 검증
- **(판정)** TCK 결과는 적용 규격의 test set 범위로 제한하고 policy, adapter, payload, 법적 제공 가능성과 운영 준비는 별도 계층에서 판정
- **(담당)** Verification owner가 시험계획과 evidence bundle을 관리하고 requirement owner와 법무·보안·운영 담당이 해당 결과를 승인
- **(완료조건)** MUST 우선순위 요구사항의 연결 시험 통과, Critical·High 보안 finding 0건, 회수시험 통과와 잔여위험 승인. 검증: 각 조건을 Test ID와 evidence bundle artifact로 확인

## 2. 검증 계층

| 계층 | 대상 | 예시 |
| --- | --- | --- |
| 문서·근거 | 주장, 권리, 승인, source | source register, Passport, 법무·보안 승인 |
| Contract test | DCAT·DSP·ODRL·도메인 schema | JSON Schema, DCAT-AP·GeoDCAT-AP·국토교통 SHACL |
| Unit | mapper, policy function, state transition | allow/deny·invalid input·expiry |
| Integration | stores, secret, adapter, source mock | API key, retry, quota, checksum |
| Interoperability | 서로 다른 Connector | Catalog·negotiation·transfer message exchange |
| Conformance | 선택한 DSP target, 채택한 경우에만 별도 DCP profile | DSP TCK와 분리된 DCP 상호운용 범위 |
| Security | auth, SSRF, secret, isolation, revoke | penetration·abuse·secret scan |
| Privacy·legal | 데이터 등급과 이용경로 | 목적·최소화·결합·반출·삭제 review |
| Resilience | timeout, duplicate, crash, source outage | fault injection·restart·reconciliation |
| Operations | monitoring, backup, DR, runbook | restore·credential rotation·incident drill |

| 작업 | 담당 | 입력 | 산출물 | 수행 시점 | 완료조건 |
| --- | --- | --- | --- | --- | --- |
| 시험 설계 | Verification owner·requirement owner | requirement·architecture·source evidence | Test ID와 fixture 명세 | 구현 시작 전 | 모든 MUST requirement에 정상·실패 test 연결 |
| 시험 실행 | QA·상호운용·보안 담당 | version이 고정된 SUT와 fixture | machine-readable result와 raw artifact | 단계별 종료 Gate 전 | 환경·version·결과·제한 기록 완료 |
| 결과 승인 | 법무·보안·운영·결정권자 | 시험 결과와 잔여위험 | 승인 또는 차단 decision record | 실증 종료 전 | 12절 종료 기준 충족 |

## 3. Test data 원칙

- 실제 개인정보, 원시 교통카드, 번호판, 폐쇄회로 텔레비전(Closed-Circuit Television, CCTV) 자료를 test fixture에 넣지 않는다.
- 공간정보는 공개 layer 또는 합성 geometry를 사용한다.
- 제한 정책 시험은 합성 기관 credential과 합성 이동데이터를 사용한다.
- 원천 API key는 CI secret으로 관리하고 public CI에서는 mock·sandbox를 우선한다.
- fixture는 source·schema·license·생성방법과 checksum을 기록한다.
- 외부 live endpoint는 PR CI에서 호출하지 않는다. 공식 공개응답은 URL·수집시각·media type·byte 수·SHA-256과 기대판정을 고정하고 scheduled drift 작업에서만 갱신한다.

## 4. 요구사항 추적

| Test ID | 요구사항 | 시나리오 | 기대 결과 | 증거 |
| --- | --- | --- | --- | --- |
| IT-CAT-001 | FR-CAT-001 | 공식 export 수집과 API poll, etag·if-modified-since 변경 감지, 오류·비배열 페이지·비정상 item 입력 | 승인 endpoint만 호출, 304에서 기존 checkpoint 유지, 나머지는 fail-closed | trace+config, adapter unit test |
| IT-CAT-002 | FR-CAT-002 | 정보시스템·활용사례·열람전용 입력 | portal·DCAT discovery에만 남고 DSP Catalog Dataset 미생성 | discovery·DSP Catalog diff |
| IT-CAT-003 | FR-CAT-003 | 네 주체 식별자(원 보유기관·Offering Provider·계약 당사자·source system)가 전부 다른 record와 주체별 누락 record, 비정본 식별자 입력 | 분리 보존·비혼동, 주체별 사유(MISSING_DATA_HOLDER·MISSING_PROVIDER_PARTICIPANT·MISSING_OPERATING_ROLE)로 후보 차단, 비정본 식별자는 상태 변경 전 거부 | validation result, eligibility unit test |
| IT-CAT-004 | FR-CAT-004 | upstream에서 자격 없는 참가자에게 숨겨진 Dataset을 Broker에서 요청 | Broker도 비노출하고 proof 요구·Offer 의미·Provider DataService를 약화하지 않음 | negative access matrix+semantic diff |
| IT-CAT-005 | FR-CAT-006 | update·delete·duplicate·out-of-order | 정확한 최종 Catalog | reconciliation report |
| IT-CAT-008 | FR-CAT-006 | 증분 동기화 cursor pagination 순회와 cursor 반복·페이지 한도·페이지 크기·poll 총량 초과 입력 | 전체 페이지를 누락·중복 없이 순서대로 수집, 결함 입력은 fail-closed(PAGINATION_LOOP·PAGE_LIMIT_EXCEEDED 등) | adapter unit test |
| IT-CAT-006 | FR-CAT-007 | hosted·brokered·index-only·unknown fixture와 불충분한 근거 | 역할·근거 저장, 불충분 record는 Offering 금지 | capability decision report |
| IT-CAT-007 | FR-CAT-008 | 대량 Dataset Catalog 요청과 pagination link 순회 | 응답 크기 한도 준수, 전체 Dataset이 누락·중복 없이 조회됨 | catalog response trace |
| ST-POL-001 | FR-CAT-005 | 자격 있는·없는 participant의 Catalog 요청 | Dataset visibility가 자격에 맞게 필터됨 | Catalog diff+policy trace |
| CT-META-001 | FR-META-001 | multi-distribution Dataset과 필수 객체, Distribution당 단일 `accessService`, `endpointURL`·version 오류 fixture | cardinality·참조·Provider endpoint·Catalog DSP version 통과, 복수 `accessService` 배열과 오류 fixture 거부 | JSON-LD+validation |
| CT-META-002 | FR-META-002 | REST·file·WFS metadata와 `dct:format` 리터럴·File Type IRI 입력 | media type·schema·extent·version 존재, format 리터럴은 정확한 경로로 거부(`LITERAL_FORMAT`)되고 IRI 노드는 수용. 승인 목록 대조는 경계 검사 범위 밖 | profile report, bridge-boundary test |
| DQ-META-001 | FR-META-003 | CRS·axis·unit·node version 오류 | quarantine·명확한 error | DQ report |
| DOC-META-001 | FR-META-004 | 신규 Dataset onboarding | 승인된 Passport reference 필수 | signed review |
| CT-META-003 | FR-META-005 | 원 보유기관·Publisher·platform·Offering Provider·Connector·계약·전달 운영자가 다른 fixture | 각 role ID와 authority reference가 분리돼 직렬화·추적됨 | profile report+registry lookup |
| CT-POL-001 | FR-POL-001 | license와 Offer 변환 | 별도 필드·충돌 검사 | policy report |
| LG-POL-001 | FR-POL-003 | open license+noncommercial Offer | 등록 거부 | legal validation |
| IT-POL-001 | FR-POL-002 | 같은 조건을 각 scope에서 평가 | 지정 scope에서만 집행 | policy trace |
| IT-POL-002 | FR-POL-004 | 기관·목적·기간 allow/deny matrix | 예상 allow/deny 일치 | decision matrix |
| IT-CON-001 | FR-CON-001 | 양측 PID로 request·offer·agreement·verification·finalization과 restart 실행 | Contract Negotiation 상태 전이와 결과 Agreement가 분리돼 영속됨 | state history |
| FT-CON-001 | FR-CON-002 | 동일 request/callback 반복 | 논리 negotiation·transfer 1개 | DB assertion |
| FT-CON-002 | FR-CON-003 | Agreement·Verification·FINALIZED 메시지에 ACK 유실과 ERROR를 각각 주입 | ACK된 단계까지만 `AGREED·VERIFIED·FINALIZED`로 확정, ERROR는 무전이, 같은 PID 재시도는 멱등 | 양측 state history+wire trace |
| IT-TRN-001 | FR-TRN-001 | `FINALIZED` 전 negotiation, 다른 결과의 `agreementId`, local expiry 정책으로 transfer 요청 | source 미호출·거부 | audit+mock assertion |
| IT-ADP-001 | FR-TRN-002 | REST pull | proxy access와 정리 성공 | HTTP trace |
| IT-ADP-002 | FR-TRN-002 | file snapshot pull | checksum 일치·만료 삭제 | manifest+object log |
| IT-ADP-003 | FR-TRN-002 | WFS/OGC access | 허용 query만 source 도달 | proxy/source log |
| CT-ADP-004 | FR-TRN-002 | 같은 Dataset·`format`이 서로 다른 source binding 두 개로 mapping | 등록 또는 Transfer Request 거부 | mapping validation |
| ST-SEC-001 | FR-TRN-003 | Catalog·Agreement·log secret scan | URL·key·token 누출 0건 | scan report |
| ST-ADP-001 | FR-TRN-004 | path·query·BBOX·quota 우회 | 모두 차단, source 미호출 | security test |
| ST-LCM-001 | FR-TRN-005 | Transfer complete·suspend·terminate | complete·terminate 후 Transfer scope token·job·ACL·temp object 회수, suspend 중 접근 차단 | reconciliation |
| ST-BIND-001 | FR-TRN-006 | public Catalog source scan과 Consumer의 임의 URL·binding 입력 | public endpoint는 Provider DSP endpoint, source URL·credential 비노출·입력 거부 | Catalog scan+source mock |
| CT-TRN-002 | FR-TRN-007 | Request·Start의 필수 필드를 하나씩 누락하고 push·pull `dataAddress` 위치를 바꿈 | schema·profile 오류로 거부, source 미호출 | DSP schema report+wire trace |
| FT-TRN-002 | FR-TRN-008 | Request·Start·Suspension·Completion·Termination의 ACK 유실과 ERROR 주입 | ACK 전 성공상태 미확정, ERROR 무전이, 같은 PID 재시도 멱등, terminal process 불변 | 양측 state history+wire trace |
| CT-DSP-002 | FR-DSP-001 | version metadata endpoint 조회와 미지원 version 요청 | 인증 없이 version metadata 응답, 미지원 version 요청은 명시적 거부 | version response+wire trace |
| CT-DSP-003 | FR-DSP-002 | 원격 context URL·미지의 context·term을 포함한 DSP 메시지 주입 | 원격 context 조회 0건, 미지의 context·term은 fail-closed 거부 | network trace+validation report |
| IT-PLT-001 | FR-PLT-001 | platform baseline 뒤 update·delete·duplicate·out-of-order delta | source record와 Connector object mapping이 정확한 최종 상태로 수렴 | mapping DB+Catalog diff |
| IT-PLT-002 | FR-PLT-002 | authority·license·Distribution·binding·revoke 증거를 하나씩 제거 | 불완전 bundle은 publish되지 않고 pending·quarantine | eligibility report |
| FT-PLT-001 | FR-PLT-003 | 같은 source ID·version의 publish·update·withdraw 반복 | Connector object와 terminal effect가 각각 하나 | object store assertion |
| IT-PLT-003 | FR-PLT-004 | Agreement subscription과 Transfer token·snapshot 생성 | external ID가 Agreement·Transfer scope로 분리 mapping되고 접근 성공 | platform mock+audit |
| ST-PLT-001 | FR-PLT-005 | FINALIZED Event ACK 전·다른 Agreement·expired Agreement와 미승인 trigger로 provision 요청 | 외부 자원 0건; 승인된 Agreement-trigger는 FINALIZED ACK 뒤 생성하되 payload는 Transfer 전 미호출 | mock assertion+audit |
| FT-PLT-002 | FR-PLT-006 | create 응답 유실·callback 중복·Connector restart | 같은 멱등키의 활성 외부 자원 최대 1개 | platform resource query |
| FT-PLT-003 | FR-PLT-007 | orphan·missing·duplicate resource와 callback 유실 주입 | Reconciler가 desired state로 수렴하고 증거 생성 | reconciliation report |
| IT-PLT-004 | FR-PLT-008 | active Agreement·Transfer 중 Dataset withdrawal | 신규 계약 차단, 영향판정, revoke 뒤 Catalog 제거 | state history+cleanup evidence |
| ST-PLT-002 | FR-PLT-009 | participant 가입·조직변경·credential revoke·탈퇴 | platform binding·권한·quota가 같은 lifecycle로 변경 | identity trace |
| ST-PLT-003 | FR-PLT-010 | config·secret store·runtime request에서 password·cookie·CSRF·개인 key 탐지 | Bridge credential로 사용 0건 | config review+secret scan |
| ST-PLT-004 | FR-PLT-011 | 같은 Agreement의 Transfer 2개 중 하나 완료 후 local Agreement 만료 | 첫 완료 때 Agreement subscription 유지, Agreement 만료 때 active Transfer 중지와 subscription 삭제 | state history+resource query |
| ST-ID-001 | FR-ID-001 | invalid issuer·signature·audience·replay | 요청 거부 | auth log |
| ST-ID-002 | FR-ID-002 | revoked 기관 credential | Catalog/transfer 거부 | credential trace |
| ST-ID-003 | FR-ID-003 | 서명·issuer·audience가 유효한 관리 평면 OIDC·introspection token으로 DSP 참가자 간 Catalog·협상·Transfer 요청 | 세 흐름 모두 참가 자격 검증 전에 거부하고 경계 위반 감사 사건 생성 | auth·policy trace+audit export |
| OP-AUD-001 | FR-AUD-001 | 종단 transfer — ADR-0006 승인 시 참여자 간 범위 개정 필요 | participant→negotiation PID→Agreement→transfer PID→source request 연결 | trace query |
| OP-AUD-002 | FR-AUD-002 | 승인·철회·파기 workflow | 증거 완결·무결성 확인 | audit export |
| FT-OPS-001 | FR-OPS-001 | timeout·5xx·quota·schema drift | 제한 재시도·격리·경보 | fault report |
| DOC-OPS-001 | FR-OPS-002 | source outage drill | runbook으로 중단·복구 | drill record |

`CT-TRN-001`은 결번이다. `IT-CAT-004`는 Catalog Broker 채택 ADR이 승인된 경우에만 적용하며, 미채택 시 `not applicable`로 기록한다.

### 4.1 비기능 요구사항 추적

| Test ID | 요구사항 | 검증 방법 | 증거 |
| --- | --- | --- | --- |
| ST-TLS-001 | NFR-SEC-001 | 승인 hostname의 DNS view·공인 주소·인증서 이름·TLS version과 HTTP downgrade 차단 점검 | DNS/TLS scan+configuration evidence |
| ST-ZONE-001 | NFR-SEC-002 | public·management·source·security zone 접근 matrix 시험 | network policy test |
| ST-SECRET-001 | NFR-SEC-003 | repository·Catalog·log·trace secret scan | scan report |
| CT-DSP-001 | NFR-INT-001 | DSP schema·state·interop와 적용 가능한 TCK | conformance bundle |
| CT-PROFILE-001 | NFR-INT-002 | DCAT·국토교통 profile validator 실행 | validation report |
| CT-SEM-001 | FR-SEM-001 | Profile manifest의 DCAT-AP·GeoDCAT-AP version과 mobilityDCAT 경계 검사 | `tests/profile` result |
| CT-SEM-002 | FR-SEM-003 | vendored artifact SHA-256·source·license lock 검사 | artifact lock report |
| CT-SEM-003 | FR-SEM-003 | 모든 Turtle artifact와 fixture strict parse | parser test result |
| CT-SEM-004 | FR-SEM-003 | protected JSON-LD context와 remote import 부재 검사 | context test result |
| CT-SEM-005 | FR-SEM-004 | local ontology의 `owl:sameAs`·equivalent·remote import 부재 검사 | ontology test result |
| CT-SEM-006 | FR-SEM-001 | 모든 local NodeShape의 requirement ID·control owner 검사 | shape governance test |
| CT-SEM-006A·B | FR-SEM-001·FR-SEM-003 | local shape와 게시 bundle의 W3C SHACL-SHACL 검사 및 음성 대조군 | meta-validation report |
| CT-SEM-BUNDLE-001·002 | FR-SEM-007 | 양성 graph의 bundle·CLI 일치와 secret 주입 graph에서 SHACL-only 한계 고정 | bundle report+preflight report |
| CT-SEM-007 | FR-SEM-004 | local ontology·SKOS term의 bilingual label·scheme membership 검사 | ontology integrity test |
| CT-PROFILE-ROUTING-001·002 | FR-SEM-002 | OGC GeoSPARQL 고정본의 6 class·54 property와 GeoDCAT 15 property 대조, datatype-only 우회와 DCAT coverage 예외 검사 | routing inventory+preflight result |
| CT-SEM-MAILBOX-001 | FR-SEM-005 | JSON exact mailbox policy와 RDF `vcard:Email` support registry 대조 | 양쪽 집합 완전 일치 |
| CT-SEM-PROF-001 | FR-SEM-001 | Core·Geo stable IRI와 version IRI의 `hasVersion`·`isVersionOf` 양방향 계보 | PROF graph assertion |
| CT-SHACL-VALID-OBS-core | FR-SEM-002 | 일반 관측 카탈로그를 Core conformance·publication 정책으로 검증 | SHACL report |
| CT-SHACL-VALID-geo | FR-SEM-002 | 도로망 공간 카탈로그를 Geo conformance·publication 정책으로 검증 | SHACL report |
| CT-PROFILE-SELECTION-001·002 | FR-SEM-002 | Core·Geo marker 중복·불일치와 공간 graph 하향 선택 거부 | requirement ID가 있는 Violation |
| CT-GEO-CRS-001 | FR-META-003 | 복수 원 데이터 CRS와 coverage literal CRS의 독립성 검증 | Geo SHACL report |
| CT-KR-CRS-001 | FR-META-003 | EPSG 공식 resolver에서 확인한 국내 CRS를 source reference로 수용하고 미확인 alias와 parser 미지원 geometry를 거부 | Geo SHACL report |
| CT-SHACL-INVALID-* | FR-META-001·FR-META-002·FR-META-003 | 언어·접근권한·망 버전·QUDT 단위·geometry CRS 오류 fixture | requirement ID가 있는 Violation |
| ST-SEM-001 | FR-SEM-005 | 공개 graph에 private binding·credential·내부 host 주입 | source 미호출·게시 거부 |
| CT-URI-001 | FR-SEM-001 | stable·version IRI dereference, content negotiation과 tombstone | 1.0.0 release 전 수행 |
| CT-COMPAT-001 | FR-SEM-001·FR-SEM-003 | 직전 profile과 semantic diff·migration fixture 실행 | 0.2.0 이후 수행 |
| ST-RDF-001·002·003 | FR-SEM-003·FR-SEM-005 | remote import·과대 RDF·cardinality·credential URI·PII·개인 유형·parser abuse | 공개 safety report |
| ST-RDF-IP-001·ST-RDF-HOST-001 | FR-SEM-005 | IPv4·IPv6 literal 전면 거부, 내부 DNS와 exact host allowlist 우회 | 공개 safety report |
| ST-RDF-MAILBOX-001·ST-RDF-TELEPHONE-001 | FR-SEM-005 | exact role mailbox의 predicate·위치·contact 문맥과 모든 전화 게시 거부 | 공개 safety report |
| ST-RDF-UTF8-001·ST-PROFILE-UTF8-001 | FR-SEM-003·FR-SEM-007 | Turtle·manifest·lock·policy에 잘못된 UTF-8 byte 주입 | `INVALID_UTF8` |
| ST-RDF-DIAGNOSTIC-001·002 | FR-SEM-005·FR-SEM-007 | blank node·predicate·입력 경로에 credential 형식 주입 | report 원문 노출 0건 |
| ST-RDF-PATH-001 | FR-SEM-005 | UNC·Windows device namespace input·report path 거부 | CLI preflight result |
| CT-SEM-BRIDGE-000 | FR-SEM-006 | S1 candidate를 profile graph로 오인하지 않는 gap guard | Bridge boundary unit test |
| CT-SEM-BRIDGE-000A | FR-SEM-002·FR-SEM-006 | Bridge preflight에서 Core·Geo marker 중복·불일치 거부 | Bridge boundary unit test |
| CT-SEM-BRIDGE-001 | FR-SEM-006 | Bridge v2 graph·profile·shape·report digest와 재투영 검사 | Bridge v2 구현 전 |
| FT-IDEMP-001 | NFR-REL-001 | 동일 request·callback·provision 반복 | state·resource assertion |
| FT-BULKHEAD-001 | NFR-REL-002 | 한 source 장애·포화 주입 | 다른 Provider 성공률·latency |
| FT-CONSIST-001 | NFR-REL-003 | callback 유실·process crash·platform timeout 뒤 restart | 운영 기준선에서 정량화한 reconciliation 목표 안에 상태 수렴, orphan 0건 |
| OP-TRACE-001 | NFR-OBS-001 | 구조화 log·metric·trace 상관관계 조회 | dashboard+trace export |
| DQ-FRESH-001 | NFR-DQ-001 | stale source·지연된 delta 주입 | freshness·stale 표시 |
| ST-PRIV-001 | NFR-PRV-001 | Catalog·log·fixture 개인정보 scan | privacy scan report |
| OP-CHANGE-001 | NFR-OPS-001 | schema·policy·endpoint 변경 rehearsal | compatibility+notification evidence |
| CT-PORT-001 | NFR-PORT-001 | canonical export 후 대체 Connector mapping spike | portability report |
| OP-KEY-001 | NFR-SEC-004 | signing·identity key rotation과 유출 대응 runbook rehearsal | rotation record+runbook acceptance |
| ST-DOS-001 | NFR-SEC-005 | public DSP endpoint에 요청 폭주·과대 요청·동시 negotiation 초과 주입 | rate limit·한도 초과 거부와 정상 요청 지속 처리 증거 |

### 4.2 국내 표준 상호운용성 Gate

| Test ID | 요구사항 | 대상 | 합격 조건 | 현재 상태 |
| --- | --- | --- | --- | --- |
| CT-KR-STD-001 | FR-SEM-008 | 국내 표준 machine register | JSON Schema, 식별자 고유성, source evidence 연결 통과 | 구현 |
| CT-KR-STD-002 | FR-SEM-008·NFR-INT-002 | 적합성 claim | 폐지 표준의 규범 사용과 미검증 표준의 적합성 허용 0건 | 구현 |
| CT-KR-STD-005 | FR-SEM-008 | 표준 lifecycle provenance | 34개 표준·행정규칙의 상태·사건·발생일·확인일이 primary source와 일치 | 구현 |
| CT-KR-CLAIM-001 | FR-SEM-008·NFR-INT-002 | 게시 claim | Markdown 표시 text의 named entity·link·Unicode 우회 뒤 금지 claim 0건, 주석 외 raw HTML 0건 | 구현 |
| CT-KR-BLINDSPOT-003 | 연결 없음 — 요구사항 신설 필요 | blind spot evidence | evidence kind 혼용 0건, 저장소 경로 이탈·symlink·reparse 0건, `fixed` 실행 증거 누락 0건 | 구현 |
| PDP-REAL-001 | NFR-INT-002 | 공공데이터포털 RDF/XML 고정본 | digest·10개 결함 유형 일치, pySHACL Core 39건, quarantine | 구현 |
| PDP-SOURCE-001 | 연결 없음 — 요구사항 신설 필요 | 포털 고정본 provenance | source와 snapshot의 path·수집시각·SHA-256·byte·media type·판정 일치 | 구현 |
| CT-KR-CRS-001 | FR-META-003 | 국내 source CRS record | profile IRI·authority·code·HTTPS URL·local English label 일치 | 구현 |
| SHACL-DIFF-001A | FR-SEM-011 | pySHACL 독립 lane | 정상·오류 fixture의 기대판정 일치, network import·inference off | 구현 |
| SHACL-DIFF-001B | FR-SEM-011 | Apache Jena 독립 lane | Core·Geo 13개 사례의 구조 정규화 결과 일치 | Jena 6.1.0 win32-x64 lane 구현 |
| ISO19115-TECH-001 | 연결 없음 — 요구사항 신설 필요 | ISO 19115 Part 1 공개 package | 125개 artifact digest와 offline XSD·Schematron smoke 일치 | lane 구현; 승인 private cache 필요 |
| KS-XML-001 | NFR-INT-002 | KS X ISO 19115-3 현행 XML | version 고정 XSD·Schematron 정상·오류 corpus 통과 | 원문·fixture 필요 |
| KS-XML-002 | NFR-INT-002 | ISO 19139 legacy XML | legacy로만 판정하고 현행 국내표준 검증 결과로 승격하지 않음 | 미구현 |
| MAP-COV-001 | FR-SEM-009 | TTA·KS·기관 export crosswalk | source field 누락 0건 | 포털 고정본 구현; TTA·기관 원문·schema 필요 |
| MAP-INVENTORY-001 | FR-SEM-009 | 원천 fixture inventory | 안전 parser가 생성한 field·predicate inventory와 crosswalk source 경로의 차이 0건 | 포털 RDF/XML 17개 path 구현 |
| MAP-LOSS-001 | FR-SEM-009 | 변환 손실 | 모든 mapping 행에 loss class·reverse rule·publication Gate 존재 | 포털 고정본 구현; 나머지 profile 미구현 |
| MAP-CATERR-001 | FR-SEM-010 | 기관 DB metadata | 운영·물리 DB 값을 공개 DCAT로 자동 승격하는 금지 변환 전부 거부 | 미구현 |
| RDF-DIFF-001 | FR-SEM-011 | RDF 직렬화 | Turtle·N-Triples·N-Quads·RDF/XML·JSON-LD의 RDFC-1.0 digest 일치 | Node·Jena parser lane 구현 |
| RDF-SEC-001 | FR-SEM-003·FR-SEM-007 | RDF parser | DTD·entity·remote context·과대입력·잘못된 UTF-8 거부 | production loader 구현 |
| RT-SPATIAL-AXIS-001 | FR-META-003 | CRS84·EPSG:4737·5179·5185~5188 | authority snapshot의 축 순서와 2차원 Point WKT·GML lexical tuple 왕복 일치 | 구현 |
| RT-SPATIAL-ACCURACY-001 | 연결 없음 — 요구사항 신설 필요 | 좌표변환 정확도 | 승인 library와 기준점 corpus의 변환 결과가 허용 오차 이내 | 구현 — B-03 정본 반영 |
| GEO-LIT-001 | FR-META-003 | WKT·GML Point literal | 2차원 tuple의 authority 순서를 보존하고 active XML·3차원·비유한값 거부 | 구현 |
| GEO-LIT-COVERAGE-001 | 연결 없음 — 요구사항 신설 필요 | 지원 geometry 전체 | geometry별 WKT·GML parser와 적용 XSD 통과 | 구현 — B-04 정본 반영 |
| ISO-DQV-001 | FR-SEM-009 | KS X ISO 19157-1 품질 | 지원 result만 lossless, 미지원 result·method·scope는 `unmapped` | 원문·제품 fixture 필요 |
| XSD-COVERAGE-001 | 연결 없음 — 요구사항 신설 필요 | XSD datatype | 승인 datatype의 lexical·value space 오류 0건, 미승인 XSD datatype 거부 | 15개 datatype registry 구현 |
| DEP-INTEGRITY-001 | 연결 없음 — 요구사항 신설 필요 | 검증기 실행환경 | 격리 clean install, 실제 dependency tree·SBOM·Jena toolchain digest 일치 | win32-x64 lane 구현 |
| NET-REGISTRY-001 | 연결 없음 — 요구사항 신설 필요 | IANA 주소 레지스트리 | official CSV 3종에서 생성한 주소 판정표와 원본 diff 0건 | 2026-07-12 snapshot·생성기 구현; scheduled refetch·유효기간 Gate 미구현 |
| CRS-REGISTRY-001 | FR-SEM-003 | OGC·EPSG CRS 근거 | CRS 7종·coordinate system 2종의 byte·SHA-256과 생성 정책 일치 | 2026-07-12 snapshot·offline Gate 구현 |
| AUTH-REG-001~006 | 연결 없음 — 요구사항 신설 필요 | Provider 권한 | identity·scope·기간·철회·receipt·trusted verifier 판정 통과 | resolver 구현; 기관 entry·trust anchor 미확보 |
| RELEASE-GATE-AUTH-001 | 연결 없음 — 요구사항 신설 필요 | Provider 권한 release ready 값 | `authorityReleaseReadyDecision`이 schema 허용값 `eligible-after-runtime-verification`와 일치 | 구현 |
| RELEASE-GATE-AUTH-002 | 연결 없음 — 요구사항 신설 필요 | 빈 Provider 권한 Registry | `blocked-no-approved-authority`와 빈 `entries`이면 `authorityBlocked=true` | 구현 |
| RELEASE-GATE-AUTH-003 | 연결 없음 — 요구사항 신설 필요 | release 가능 Provider 권한 Registry | ready 값과 하나 이상의 entry가 있으면 `authorityBlocked=false` | 구현 |
| RELEASE-GATE-AUTH-004 | 연결 없음 — 요구사항 신설 필요 | entry 없는 ready Registry | ready 값이어도 `entries`가 비어 있으면 `authorityBlocked=true` | 구현 |
| RELEASE-GATE-AUTH-005 | 연결 없음 — 요구사항 신설 필요 | 잘못된 Provider 권한 release 값 | entry-level `approved`를 `releaseDecision`으로 인정하지 않고 `authorityBlocked=true` | 구현 |
| RELEASE-GATE-AUTH-006 | 연결 없음 — 요구사항 신설 필요 | malformed Provider 권한 Registry | `undefined`·`null`·빈 객체·`entries` 누락 입력은 `authorityBlocked=true` | 구현 |
| RELEASE-GATE-001 | 연결 없음 — 요구사항 신설 필요 | release 판정 | machine register·authority·ISO cache의 미해결 항목이 있으면 exit 2 | 구현; 현재 blocked |
| STD-STATUS-SNAPSHOT-001 | FR-SEM-008 | KS·TTA·행정규칙 lifecycle | 검토 baseline과 source equality를 통과하고 공식 status 응답 원문·수집시각·byte 수·SHA-256이 항목별로 존재 | baseline digest·source equality 구현, 공식 응답 snapshot 미고정 |
| CLAIM-AUTH-001 | 연결 없음 — 요구사항 신설 필요 | 대외 conformance declaration | 정형 claim에 승인자·적용 표준판·시험범위·근거 digest·만료일이 있고 비정형 동의어는 발간 전 사람 검토 | 금지 문자열·표시 text Gate 구현, 승인 workflow 미구현 |

- **(B-03 정본 근거)** `standards/korean-interoperability-register.json`의 `RT-SPATIAL-ACCURACY-001=implemented`가 현행 machine register 판정이므로 적용한다.
- **(B-04 정본 근거)** 같은 register의 `GEO-LIT-COVERAGE-001=implemented`가 현행 machine register 판정이므로 적용한다.

`SHACL-DIFF-001B`는 결과 message와 blank node label을 비교하지 않는다. `focusNode`, canonical result path, constraint component, severity, source shape 종류와 value RDF term을 정규화한다. engine 불일치는 다수결로 처리하지 않고 release를 차단한다.

- **(Verified — 추적 식별자 비고)** `FR-SEM-011`의 검증 열은 parent ID `SHACL-DIFF-001`을 가리키지만 실행 lane은 `SHACL-DIFF-001A/B`다. 두 lane은 요구사항에 연결하되 exact ID 불일치가 남으므로 이 연결만으로 요구사항 완료를 판정하지 않는다. 근거: [내부 일관성 감사](../01-research/internal-consistency-audit-2026-08.md#73-전-시험-id-대조)

국내 표준별 증거 수준과 release 차단사항은 [국내 표준 상호운용성 및 blind spot 검증](../01-research/korean-standards-interoperability.md)의 machine register와 함께 판정한다.

### 4.2 알려진 추적 공백

다음 행은 기존 요구사항 강도를 낮추지 않는다. 현재 시험이 요구 축 전체를 다루지 않는 사실을 등록하며 시험 확장은 이 문서 개정의 범위 밖이다.

| 공백 ID | 요구사항 | 현재 연결 시험 | 시험하지 않는 축 | 현재 판정 |
| --- | --- | --- | --- | --- |
| GAP-POL-001 | FR-POL-004 | IT-POL-002는 기관·목적·기간 allow/deny만 시험 | 관할·재제공 표현과 실패 동작 | 알려진 공백 — 요구사항 완료로 판정 금지 |
| GAP-TRN-001 | FR-TRN-004 | ST-ADP-001은 path·query·BBOX·quota 우회만 시험 | method·row·column 제한 | 알려진 공백 — 요구사항 완료로 판정 금지 |

다음 행은 기존 FR·NFR에 연결할 수 없는 시험을 등록한다. 요구사항 신설 방향은 승인 전 제안이며 요구사항 기준선을 변경하지 않는다.

| 공백 ID | 시험 ID | 실제 검증 | 요구사항 신설 방향 | 담당 | 기한 |
| --- | --- | --- | --- | --- | --- |
| GAP-LNK-01 | CT-KR-BLINDSPOT-003 | **(Verified)** evidence kind, 저장소 경로 confinement와 실행 증거 결속 | **(Decision — 제안)** 검증·감사 evidence reference의 type, 경로 제한, 실재성과 실행 증거 결속 요구 | 미정 | 미정 |
| GAP-LNK-02 | PDP-SOURCE-001 | **(Verified)** 외부 RDF 고정본의 path·수집시각·SHA-256·byte·media type·판정을 source register와 대조 | **(Decision — 제안)** 외부 상호운용 fixture의 content-addressed capture provenance와 기대판정 결속 요구 | 미정 | 미정 |
| GAP-LNK-03 | ISO19115-TECH-001 | **(Verified)** ISO 19115 artifact manifest의 역할·digest·license와 official bytes 미커밋 상태 | **(Decision — 제안)** 외부 XSD·Schematron package의 출처·판·license·digest와 승인 private cache 기반 offline Gate 요구 | 미정 | 미정 |
| GAP-LNK-04 | RT-SPATIAL-ACCURACY-001 | **(Verified)** 권위 기준값과 지원 CRS·geometry 순·역변환의 허용오차 | **(Decision — 제안)** 승인 library·독립 기준점 corpus·허용오차에 따른 좌표변환 정확도 요구 | 미정 | 미정 |
| GAP-LNK-05 | GEO-LIT-COVERAGE-001 | **(Verified)** WKT Point·LineString·단일 ring Polygon의 parser·serializer 왕복 | **(Decision — 제안)** 지원 geometry와 WKT·GML·적용 XSD 조합별 정상·오류 corpus 및 round-trip 요구 | 미정 | 미정 |
| GAP-LNK-06 | XSD-COVERAGE-001 | **(Unverified)** 실행 Test ID 문서 미확인. 계획상 승인 XSD datatype의 lexical·value space와 미승인 datatype 거부 | **(Decision — 제안)** 허용 XSD datatype registry의 판 관리, lexical·value-space 검증과 미승인 datatype fail-closed 요구 | 미정 | 미정 |
| GAP-LNK-07 | DEP-INTEGRITY-001 | **(Unverified)** 실행 Test ID 문서 미확인. 계획상 clean install의 dependency tree·SBOM·Jena toolchain digest 대조 | **(Decision — 제안)** 검증 실행환경·dependency·SBOM·toolchain의 content-addressed 재현성과 격리 설치 요구 | 미정 | 미정 |
| GAP-LNK-08 | NET-REGISTRY-001 | **(Unverified)** 실행 Test ID 문서 미확인. 계획상 IANA CSV 3종과 생성 주소 판정표 대조 | **(Decision — 제안)** SSRF·egress 주소 분류의 공식 IANA snapshot·생성정책·drift·유효기간 Gate 요구 | 미정 | 미정 |
| GAP-LNK-09 | AUTH-REG-001 | **(Verified)** 빈 Registry의 runtime 권한 거부와 entry 없는 적격 상태 위조 차단 | **(Decision — 제안)** 계약 기반 runtime Provider 권한 Registry의 빈 입력·상태 모순 fail-closed 요구 | 미정 | 미정 |
| GAP-LNK-10 | AUTH-REG-002 | **(Verified)** participant·Provider·source·asset·action exact scope, freshness와 검증 receipt 판정 | **(Decision — 제안)** runtime Provider 권한의 exact scope·기간·철회 freshness·검증 receipt 요구 | 미정 | 미정 |
| GAP-LNK-11 | AUTH-REG-003 | **(Verified)** wildcard·미검증·모순·철회·중복·stale·구조 오류 권한의 거부 | **(Decision — 제안)** 모호하거나 미검증된 Provider 권한 증거를 fail-closed로 거부하는 의미 규칙 요구 | 미정 | 미정 |
| GAP-LNK-12 | AUTH-REG-004 | **(Verified)** Registry·요청·receipt 시각의 실제 RFC 3339 calendar instant 여부 | **(Decision — 제안)** Provider 권한 판정 시각 필드의 RFC 3339 lexical·calendar 유효성 요구 | 미정 | 미정 |
| GAP-LNK-13 | AUTH-REG-005 | **(Verified)** trusted verifier envelope의 요청·범위·증거·정책집행점·receipt digest 결속과 변조 거부 | **(Decision — 제안)** 동기 trusted verifier와 서명 receipt envelope의 필드·digest 결속 요구 | 미정 | 미정 |
| GAP-LNK-14 | AUTH-REG-006 | **(Verified)** 권한 요청·receipt identity의 parsed HTTPS·bare DID·local identifier 규칙 | **(Decision — 제안)** Provider 권한 주체·검증자·정책집행점과 local ID의 허용 식별자 문법 요구 | 미정 | 미정 |
| GAP-LNK-15 | RELEASE-GATE-001 | **(Verified)** reviewed 기계 입력의 blocker·digest와 결정론적 blocked report | **(Decision — 제안)** reviewed 입력의 미해결 blocker와 digest를 집계하는 결정론적 release 판정 보고서 요구 | 미정 | 미정 |
| GAP-LNK-16 | CLAIM-AUTH-001 | **(Unverified)** 실행 Test ID 문서 미확인. 계획상 conformance claim의 승인자·표준판·시험범위·근거 digest·만료일과 사람 검토 | **(Decision — 제안)** 대외 conformance declaration의 정형 승인 필드·만료와 비정형 표현 사람 검토 요구 | 미정 | 미정 |
| GAP-LNK-17 | RELEASE-GATE-AUTH-001 | **(Verified)** release ready 상수와 schema 허용값의 일치 | **(Decision — 제안)** Provider 권한 Registry의 canonical release ready 값과 schema enum 일치 요구 | 미정 | 미정 |
| GAP-LNK-18 | RELEASE-GATE-AUTH-002 | **(Verified)** 차단 상태와 빈 entry 조합의 release 차단 | **(Decision — 제안)** 차단 결정 또는 빈 Provider 권한 Registry를 release blocker로 판정하는 요구 | 미정 | 미정 |
| GAP-LNK-19 | RELEASE-GATE-AUTH-003 | **(Verified)** canonical ready 값과 하나 이상의 entry 조합에서 blocker 해제 | **(Decision — 제안)** Provider 권한 Registry release blocker 해제의 상태·최소 entry 조건 요구 | 미정 | 미정 |
| GAP-LNK-20 | RELEASE-GATE-AUTH-004 | **(Verified)** ready 값과 빈 entry 조합의 release 차단 | **(Decision — 제안)** ready 상태라도 Provider 권한 entry가 없으면 fail-closed로 차단하는 요구 | 미정 | 미정 |
| GAP-LNK-21 | RELEASE-GATE-AUTH-005 | **(Verified)** entry-level `approved`의 registry-level `releaseDecision` 오용 거부 | **(Decision — 제안)** entry 결정과 Registry release 결정을 분리하고 schema 밖 상태값을 거부하는 요구 | 미정 | 미정 |
| GAP-LNK-22 | RELEASE-GATE-AUTH-006 | **(Verified)** `undefined`·`null`·빈 객체·`entries` 누락 입력의 release 차단 | **(Decision — 제안)** malformed Provider 권한 release 입력을 fail-closed로 차단하는 요구 | 미정 | 미정 |

추적 연결 작업(2026-08-04) 중 국내 Gate 표의 `합격 조건` 문언과 실제 시험 assertion의 불일치 6건이 보고됐다. 셀 수정 금지 지시에 따라 정정하지 않고 등록한다. 6건 중 `RELEASE-GATE-001` 건만 시험 원문으로 확인했고 나머지 5건은 보고 상태다.

| ID | 보고된 불일치 | 상태 | 담당 | 기한 | 종료 조건 |
| --- | --- | --- | --- | --- | --- |
| GAP-ROW-01 | `RELEASE-GATE-001` 행이 exit `2`를 합격 조건으로 쓰나 exit 검증은 `RELEASE-GATE-002`의 assertion임 | `Verified` | 미정 | 미정 | 두 행의 합격 조건을 실제 assertion 경계로 정정 |
| GAP-ROW-02 | `ISO19115-TECH-001` 행의 offline smoke는 실제로 `002·004`가 검증하고 `001`은 manifest·license·digest 중심 | `Unverified — 보고` | 미정 | 미정 | 시험 원문 대조 후 행 정정 |
| GAP-ROW-03 | `RT-SPATIAL-AXIS-001` 행의 WKT·GML 왕복은 실제로 `GEO-LIT-001`이 검증 | `Unverified — 보고` | 미정 | 미정 | 시험 원문 대조 후 행 정정 |
| GAP-ROW-04 | `GEO-LIT-001` 행의 거부 조건은 실제로 `GEO-LIT-002`가 검증 | `Unverified — 보고` | 미정 | 미정 | 시험 원문 대조 후 행 정정 |
| GAP-ROW-05 | `GEO-LIT-COVERAGE-001`의 실제 assertion은 WKT 3종이며 행의 GML·XSD 범위는 미검증 | `Unverified — 보고` | 미정 | 미정 | 시험 원문 대조 후 행 정정 또는 시험 확장 |
| GAP-ROW-06 | `SHACL-DIFF-001` parent ID와 `001A/B` 실행 lane의 exact 추적 불일치 | `Verified` | 미정 | 미정 | parent ID 정리 또는 A/B lane의 명시적 등재(`FR-SEM-011` 공백과 동일 건) |

`MUST` 부분 검증 보강 1차(CAT·META, 2026-08-04)에서 아래가 확인됐다. 시험 공백이 아니라 **구현 공백 또는 조건 미성립**이므로 시험 작성으로 닫을 수 없고, 해당 축의 todo 시험과 함께 등록한다.

| ID | 요구 | 확인된 사실 | 상태 | 담당 | 기한 | 종료 조건 |
| --- | --- | --- | --- | --- | --- | --- |
| GAP-IMPL-01 | `FR-CAT-004`의 provenance 축 | `toDiscoveryProjection`·`toOfferingCandidate` 어디에도 provenance 방출이 없음. todo 시험 `IT-CAT-004(축 유보)` 등록 | `Verified` | 미정 | 미정 | projection의 provenance 방출 구현과 todo 해제 |
| GAP-IMPL-02 | `FR-META-003`의 시간대·link version 축 | DQ 경로에 두 축의 검사가 없음. `xsd-lexical`의 timezone 검증은 datatype 구문 층위라 자산 수준 제공 요구를 대신하지 않음. todo 시험 `DQ-META-001(축 유보)` 등록 | `Verified` | 미정 | 미정 | DQ 검사 구현과 todo 해제 |
| GAP-IMPL-03 | `FR-META-004`의 Passport 내부 권리·품질·계보 축 | 코드에 Passport 구조가 없음(`src/` 전체에 passport 부재). `DOC-META-001`은 signed review 문서 통제라 todo 시험을 얹을 대상 모듈 자체가 없어 등록만 한다 | `Verified` | 미정 | 미정 | Passport 기계 구조 설계 결정 후 시험 재판정 |
| GAP-COND-01 | `FR-CAT-008`(SHOULD)의 upstream Broker pagination | Broker 구성요소 미채택 — `brokered`는 record 분류값(`src/discovery/model.mjs`)이지 Broker 서비스가 아니며, `IT-CAT-007`은 일반 Catalog pagination을 검증 | `Verified` | 미정 | 미정 | Broker 채택 결정 시 재개. 미채택 유지 시 요구사항의 조건부 표기 확인 |

## 5. DSP 상호운용

선택한 Connector version과 DSP target을 먼저 고정한다. 다음을 검증한다.

- version discovery와 지원 version·binding
- Catalog·Dataset request/response schema와 pagination
- Catalog/Dataset embedded Offer의 target 부재, Contract Request·Offer Message Offer의 Dataset target 존재, contained Rule target 부재, Agreement의 정확히 한 Dataset target
- Catalog DataService와 Distribution `accessService`→Provider DataService `endpointURL`, Catalog DSP version 일치
- Contract Negotiation의 consumer/provider PID와 `REQUESTED·OFFERED·ACCEPTED·AGREED·VERIFIED·FINALIZED·TERMINATED` 전이, 결과 Agreement의 분리, 각 메시지의 수신 확인(Acknowledgement, ACK)·ERROR 처리
- Agreement Message→ACK의 `AGREED`, Agreement Verification→ACK의 `VERIFIED`, Provider FINALIZED Event→ACK의 `FINALIZED` 순서
- `FINALIZED` negotiation 결과 Agreement의 target Dataset이 광고한 Distribution `format`과 Transfer Request 일치
- Transfer Process의 `REQUESTED·STARTED·SUSPENDED·COMPLETED·TERMINATED` 전이와 terminal-state 불변성
- Transfer Request의 `consumerPid·agreementId·format·callbackAddress`, Transfer Start의 `providerPid·consumerPid`, format별 push Request `dataAddress`와 pull Start `dataAddress`
- 모든 Transfer 메시지의 ACK·ERROR, ACK 유실·retry·out-of-order·unknown PID와 양측 상태 불일치 처리
- authorization 실패 시 정보노출이 없는 오류 동작

공식 TCK는 지원 범위를 문서화하고, TCK 밖의 국토교통 profile·security·adapter 시험을 별도로 유지한다. DSP 2025-1-err1 conformance와 DCP 채택 시의 DCP 1.0 profile·상호운용 증거는 별도 결과로 관리한다. DCP 미채택은 DSP 실패가 아니다.

## 6. Catalog 검증 시나리오

1. 공개 Dataset 하나에 REST·쉼표 구분 값(Comma-Separated Values, CSV)·웹 피처 서비스(Web Feature Service, WFS) Distribution 세 개를 등록한다.
2. 정보시스템 소개와 catalog-only record가 DSP Catalog Dataset으로 직렬화되지 않는지 확인한다.
3. 권리 미확인 record가 quarantine되는지 확인한다.
4. upstream에서 자격 없는 participant에게 숨겨진 Dataset이 Broker에서도 숨겨지는지 확인한다.
5. upstream proof 요구, Offer 의미와 Provider DataService endpoint가 Broker에서 약화·재작성되지 않는지 확인한다.
6. source 삭제가 Offer와 검색 index에서 제거되는지 확인한다.
7. stale source 장애 동안 last-known metadata에 상태·확인시각이 표시되는지 확인한다.

## 7. Data Plane 검증 시나리오

### 7.1 REST

- 운영기관이 승인한 hostname과 배포영역의 DNS view 일치
- HTTPS 강제, certificate chain·hostname 검증과 HTTP downgrade 차단
- source host·path·query allowlist
- source key 비노출
- participant별 quota 분리
- 소비자가 제공한 callback·sink와 public source의 private·loopback·link-local·reserved·cloud metadata 주소 차단
- 승인된 private source의 DNS view·hostname·port·클래스 없는 도메인 간 라우팅(Classless Inter-Domain Routing, CIDR)·egress zone 일치
- DNS rebinding, 예상 밖 정규 이름 레코드(Canonical Name record, CNAME)와 범위 이탈 차단
- pagination과 최대 payload
- timeout·retry·circuit breaker

### 7.2 File

- snapshot atomic publish
- checksum·byte·record count
- resume·duplicate·partial failure
- signed endpoint TTL
- expiry·terminate 후 삭제

### 7.3 OGC

- layer·collection allowlist
- 경계상자(Bounding Box, BBOX)·CRS·axis·zoom·feature limit
- complex filter·oversized query 차단
- 좌표정밀도와 제한 feature 제거
- GetCapabilities/OpenAPI 설명과 실제 endpoint 분리

## 8. 정책·수명주기 검증

| 상태 변화 | 검증 |
| --- | --- |
| credential revoke | 신규 Catalog·negotiation·access 모두 거부 |
| local Agreement 만료·철회 정책 event | 신규 접근 거부, 활성 Transfer에 DSP Suspension·Termination, token·자원 회수 |
| transfer suspend | source 접근 중단, 재개 전 policy 재평가 |
| transfer terminate | token·ACL·consumer group·temp object 회수 |
| source license 변경 | 신규 Offer 중지, 기존 Agreement 영향 검토 workflow |
| Dataset delete | 신규 검색·계약 차단, 보유·파기정책 실행 |

### 8.1 플랫폼 접근 수명주기

1. Contract Negotiation의 `FINALIZED` Event가 ACK되기 전에는 platform subscription·token·job을 만들지 않는다.
   - 기본 trigger는 유효한 Transfer Request로 설정한다.
   - `FINALIZED` ACK 직후 Agreement-trigger provisioning을 허용한 Dataset은 trigger, 비용과 회수정책을 Passport에 기록한다.
2. 외부 호출 전에 command, 멱등키와 desired state를 durable outbox에 기록한다. 응답 또는 상태 조회로 external resource ID를 확정 저장한 뒤에만 Transfer Start를 보낸다.
3. create 응답을 버려 같은 command가 재시도되게 하고 외부 자원이 하나만 남는지 확인한다.
4. Connector를 external resource 생성 직후 중단하고 restart·outbox replay 뒤 mapping이 복구되는지 확인한다.
5. Transfer 하나를 완료하고 Transfer scope token·snapshot만 삭제되며 Agreement subscription은 유지되는지 확인한다.
6. Termination callback을 버리고 TTL·gateway deny와 Reconciler가 해당 Transfer 자원을 차단·정리하는지 확인한다.
7. local Agreement 만료 event를 보내 남은 active Transfer와 Agreement scope subscription이 함께 종료되는지 확인한다.
8. platform delete API에 `5xx`를 주입해 retry queue, 경보와 수동 정리 증거를 확인한다.
9. active Transfer 도중 Dataset을 철회해 신규 협상 차단, 영향판정, Agreement·Transfer scope revoke, Catalog 제거 순서를 확인한다.
10. dataspace participant credential을 revoke해 platform organization·service identity binding과 quota가 함께 폐기되는지 확인한다.

### 8.2 Offering 게시 수명주기

- `DISCOVERED→PENDING_EVIDENCE→APPROVED→PUBLISHED` 단계별 필수 증거
- description 수정과 license·Provider·schema 변경의 서로 다른 처리
- source 장애와 source delete의 구분
- `hosted`→`index-only` 변경 시 신규 Agreement 차단과 discovery-only 전환
- Connector 등록 일부 성공 뒤 compensation 또는 quarantine
- `WITHDRAWN` Offering의 Catalog 비노출과 외부 자원 0건

## 9. 보안 검증

- management API public exposure scan
- TLS와 certificate validation
- auth bypass, confused deputy와 token audience
- 서버 측 요청 위조(Server-Side Request Forgery, SSRF), callback URL, redirect와 header injection
- Catalog enumeration과 error side channel
- secret·개인정보 log leakage
- request smuggling·oversized payload·decompression bomb
- policy unknown operand·datatype fail-closed
- tenant·participant quota와 object isolation
- dependency·container·소프트웨어 자재명세서(Software Bill of Materials, SBOM) vulnerability scan

## 10. 운영 검증

- Control Plane·broker restart 중 상태 복구
- 데이터베이스(Database, DB)·Secret Store backup restore
- Data Plane scale-out과 중복 provisioning
- expired resource reconciliation
- certificate·source key rotation without outage
- source outage·quota·schema change incident drill
- Broker cache 재구성
- dashboard·alert가 runbook과 owner로 연결되는지 확인

## 11. 증거 형식

각 시험은 다음을 보존한다.

```yaml
test_id: "IT-ADP-001"
executed_at: "..."
environment: "..."
connector_version: "..."
dsp_version: "2025-1"
dsp_spec_revision: "2025-1-err1"
dsp_spec_source: "https://github.com/eclipse-dataspace-protocol-base/DataspaceProtocol/tree/2025-1-err1"
source_fixture_version: "..."
requirements: ["FR-TRN-002"]
result: "pass|fail|blocked"
artifacts:
  - "..."
limitations:
  - "..."
reviewer: "..."
```

secret·실제 개인정보·제한 payload는 evidence bundle에서 제외한다.

## 12. 실증 종료 기준

- **(MUST 요구사항)** 우선순위 요구사항에 연결된 정상·실패 시험이 모두 `pass`이고 검증 증거가 evidence bundle에 존재
- 검증: 요구사항-시험 추적표의 결과와 evidence bundle artifact 경로 대조
- DSP target 상호운용 시험과 적용 가능한 TCK 통과
- critical·high security finding 0건
- source·license·Provider 미확인 Dataset 0건
- 만료·정지·철회 회수시험 통과
- Catalog·Agreement·log secret leakage 0건
- 법무·개인정보·공간정보·보안 검토에서 실증 범위 승인
- 알려진 제한과 잔여위험을 결정권자가 승인
