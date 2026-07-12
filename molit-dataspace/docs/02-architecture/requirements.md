# 요구사항 기준선

작성일: 2026-07-11  
작성 기준: 2026-07-11  
상태: Draft

## 1. 목적

이 문서는 국토교통 데이터 통합 채널과 원천 플랫폼을 DSP 데이터 스페이스에 연결하기 위한 검증 가능한 요구사항을 정의한다. `MUST`, `SHOULD`, `MAY`는 각각 필수, 권고, 선택 요구사항을 뜻한다.

## 2. 참여자

| 참여자 | 목표 |
| --- | --- |
| Catalog 이용자 | 분야·기관·공간·시간·형태·이용조건으로 데이터를 찾음 |
| 데이터 소비기관 | 자격과 목적을 제시하고 계약 후 데이터를 이용함 |
| 원 데이터 보유기관 | 데이터의 법적 제공 판단과 원천 품질을 통제함 |
| 기존 플랫폼 운영자 | 데이터 host·broker·index, metadata·source·subscription API를 운영함 |
| Offering Provider Participant | DSP Offer와 Agreement의 제공자·계약 당사자가 됨 |
| Connector 운영자 | DSP endpoint, 상태, policy, secret과 upgrade를 운영함 |
| Data Delivery Operator | source binding, token·ACL·snapshot과 실제 전달을 운영함 |
| 통합 채널 운영자 | 검색, metadata 품질과 확인된 플랫폼 기능을 운영함 |
| Catalog Broker 운영자 | 선택적으로 여러 Provider Offering을 연합함 |
| 거버넌스 운영자 | 참가자·issuer·policy profile과 제재절차를 관리함 |
| 법무·보안 승인자 | 데이터 등급, 제공 근거, 배포환경과 통제를 승인함 |
| 운영자 | Connector, adapter, secret, audit와 장애를 관리함 |

## 3. 주요 사용사례

| ID | 사용사례 | 성공 결과 |
| --- | --- | --- |
| UC-001 | 공개 통계를 검색하고 이용 | 기존 공개 license를 유지한 REST 접근 |
| UC-002 | ITS 실시간 데이터를 계약 후 조회 | 계약별 endpoint·quota로 원천 API proxy 이용 |
| UC-003 | 표준 노드·링크 snapshot을 취득 | 고정 version·checksum·변경이력과 함께 다운로드 |
| UC-004 | VWorld·기관 WFS feature를 조회 | 허용 layer·BBOX·feature limit 안에서 접근 |
| UC-005 | 기관 제한 데이터 이용을 신청 | 기관 자격·목적·기간 검증 후 필터된 데이터 이용 |
| UC-006 | 고위험 데이터를 원격 분석 | 원시 반출 없이 분석하고 승인된 결과만 반출 |
| UC-007 | 계약을 정지·종료 | token·ACL·임시 자원 회수와 감사 증거 생성 |
| UC-008 | 원천 metadata 변경·삭제 | 연합 Catalog에 변경·삭제와 provenance 반영 |
| UC-009 | 기존 플랫폼 Dataset을 Offering으로 온보딩 | 권리·source·회수 Gate를 통과한 record만 DSP Catalog에 게시 |
| UC-010 | DSP 계약으로 플랫폼 접근권한 생성 | Agreement·Transfer에 맞는 subscription·entitlement·token을 멱등 생성 |
| UC-011 | Dataset·계약을 철회하고 외부 자원 정리 | Catalog, subscription·token·ACL·snapshot을 제거하고 reconciliation 증거 생성 |
| UC-012 | 데이터 스페이스 identity를 플랫폼 identity에 연결 | 별도 사람 계정·비밀번호 공유 없이 기관별 권한과 quota 적용 |

## 4. 기능 요구사항

| ID | 요구사항 | 우선순위 | 검증 |
| --- | --- | --- | --- |
| FR-CAT-001 | 시스템은 공식 export·API·change feed에서 metadata를 수집해야 한다. | MUST | IT-CAT-001 |
| FR-CAT-002 | 시스템은 검색 레코드와 DSP Catalog Dataset을 구분하고, catalog-only 레코드를 DSP Dataset으로 직렬화하지 않아야 한다. | MUST | IT-CAT-002 |
| FR-CAT-003 | 모든 Dataset은 원 보유기관, Offering Provider Participant, source system과 원천 식별자를 구분해 가져야 한다. | MUST | IT-CAT-003 |
| FR-CAT-004 | Catalog Broker는 upstream visibility·proof 요구, Offer 의미, Provider DataService endpoint와 provenance를 약화하거나 바꾸지 않아야 한다. | MUST | IT-CAT-004 |
| FR-CAT-005 | 자격에 따라 Dataset visibility를 필터링할 수 있어야 한다. | MUST | ST-POL-001 |
| FR-CAT-006 | 수정·삭제·중복·pagination을 처리하는 증분 동기화를 지원해야 한다. | MUST | IT-CAT-005 |
| FR-CAT-007 | Dataset과 delivery path별 플랫폼 역할을 `hosted·brokered·index-only·unknown`으로 판정하고 근거를 보존해야 한다. | MUST | IT-CAT-006 |
| FR-CAT-008 | 제공하는 DSP Catalog 응답은 응답 크기 한도와 pagination을 지원해야 하며, Catalog Broker를 채택한 경우 upstream Catalog의 pagination을 소비할 수 있어야 한다. | SHOULD | IT-CAT-007 |
| FR-META-001 | Dataset, Distribution, DataService를 구분하고 DSP Catalog의 최소 cardinality, Distribution당 단일 `accessService`, `endpointURL`과 DSP version 일치를 만족해야 한다. | MUST | CT-META-001 |
| FR-META-002 | format, media type, schema, version, temporal·spatial extent를 제공해야 한다. | MUST | CT-META-002 |
| FR-META-003 | 공간·교통 자산은 CRS, 축 순서, 단위, 시간대, node/link version을 제공해야 한다. | MUST | DQ-META-001 |
| FR-META-004 | 데이터 제품의 권리·품질·계보·승인 정보를 Passport로 추적해야 한다. | MUST | DOC-META-001 |
| FR-META-005 | 원 보유기관, Publisher, platform host·broker, Offering Provider, Connector 운영자, 계약 당사자와 전달 운영자를 별도 필드로 기록해야 한다. | MUST | CT-META-003 |
| FR-SEM-001 | Profile, ontology, shape, concept scheme과 instance에 stable IRI와 불변 version IRI를 구분해 사용해야 한다. | MUST | CT-SEM-001·CT-URI-001 |
| FR-SEM-002 | 게시 Catalogue와 CatalogueRecord는 같은 Core 또는 Geo metadata profile canonical version IRI를 `dct:conformsTo`로 정확히 하나 기록해야 한다. GeoDCAT·GeoSPARQL·국토교통 공간 확장 graph는 Geo를 선택하되 DCAT bbox·centroid coverage 예외를 적용한다. Dataset·Distribution·DataService에는 데이터 내용 또는 서비스가 실제로 따르는 기술 표준만 기록한다. | MUST | CT-PROFILE-SELECTION-001·002·CT-PROFILE-ROUTING-001·002 |
| FR-SEM-003 | 외부 SHACL·ontology·controlled vocabulary는 source URL·version·license·SHA-256을 고정하고 runtime 원격 import를 금지해야 한다. | MUST | CT-SEM-002·ST-RDF-001 |
| FR-SEM-004 | 국토교통 ontology는 기존 표준 term을 우선 재사용하고 근거 없는 `owl:sameAs`·equivalent class·property를 만들지 않아야 한다. | MUST | CT-SEM-005 |
| FR-SEM-005 | 공개 RDF와 source binding·credential·승인 증거를 분리하고 공개 graph를 predicate·role mailbox·public host allowlist 방식으로 생성해야 한다. 0.1.0 공개 graph에는 전화번호를 게시하지 않아야 한다. | MUST | ST-SEM-001·ST-RDF-MAILBOX-001·ST-RDF-TELEPHONE-001·ST-RDF-HOST-001 |
| FR-SEM-006 | Connector 등록 후보는 검증된 RDF graph, profile bundle과 validation report의 digest를 참조하고 DCAT RDF를 DSP wire message와 합치지 않아야 한다. | MUST | CT-SEM-BRIDGE-001 |
| FR-SEM-007 | 전체 metadata Gate는 fatal UTF-8 parse, 공개 graph preflight, Core·Geo routing과 SHACL을 순서대로 실행하고 profile bundle·validator source·report schema digest를 보고해야 한다. | MUST | ST-RDF-UTF8-001·ST-PROFILE-UTF8-001·CT-SEM-REPORT-001 |
| FR-SEM-008 | 시스템은 표준의 현행·폐지·확인필요 상태와 metadata 확인·구현시험·조항 crosswalk 증거를 분리하고, 미검증 표준의 적합성 claim을 거부해야 한다. | MUST | CT-KR-STD-001·002 |
| FR-SEM-009 | 모든 source metadata field는 target path 또는 명시적 `unmapped`·`not-published` 결정, 손실 등급, reverse rule과 publication Gate를 가져야 한다. | MUST | MAP-COV-001·MAP-LOSS-001 |
| FR-SEM-010 | 기관 DB 운영·물리 metadata와 개인정보 포함 compliance record는 public DCAT projection과 분리해야 한다. | MUST | MAP-CATERR-001·ST-PRIV-001 |
| FR-SEM-011 | 지원 RDF 직렬화와 SHACL engine은 고정 fixture의 canonical graph·정규화 결과를 비교하고, 불일치 시 release를 차단해야 한다. | MUST | RDF-DIFF-001·SHACL-DIFF-001 |
| FR-POL-001 | license와 ODRL Offer를 별도 개념으로 관리해야 한다. | MUST | CT-POL-001 |
| FR-POL-002 | Catalog, negotiation, transfer, Data Plane 집행지점을 구분해야 한다. | MUST | IT-POL-001 |
| FR-POL-003 | 공개 데이터에 기존 license보다 좁은 이용제약을 부과하지 않아야 한다. | MUST | LG-POL-001 |
| FR-POL-004 | 기관유형, 목적, 기간, 관할과 재제공 조건을 표현할 수 있어야 한다. | MUST | IT-POL-002 |
| FR-CON-001 | DSP Contract Negotiation의 consumer/provider PID, `REQUESTED·OFFERED·ACCEPTED·AGREED·VERIFIED·FINALIZED·TERMINATED` 상태와 결과 Agreement를 분리해 영속 관리해야 한다. | MUST | CT-DSP-001, IT-CON-001 |
| FR-CON-002 | 동일 callback·요청 재시도에 멱등적으로 동작해야 한다. | MUST | FT-CON-001 |
| FR-CON-003 | Agreement Message·Agreement Verification·`FINALIZED` Event를 각각 ACK한 뒤 `AGREED·VERIFIED·FINALIZED`를 확정하고, ERROR에는 상태를 전이하지 않아야 한다. | MUST | FT-CON-002 |
| FR-TRN-001 | Contract Negotiation이 `FINALIZED`이고 `agreementId`가 그 결과 Agreement를 참조할 때만 Transfer Process를 시작해야 한다. | MUST | IT-TRN-001 |
| FR-TRN-002 | REST, file snapshot, OGC access를 서로 다른 adapter로 지원해야 한다. | MUST | IT-ADP-001~003 |
| FR-TRN-003 | source endpoint와 credential을 외부 Catalog에 노출하지 않아야 한다. | MUST | ST-SEC-001 |
| FR-TRN-004 | 계약별 method·path·query·row·column·BBOX·quota를 제한할 수 있어야 한다. | MUST | ST-ADP-001 |
| FR-TRN-005 | Transfer 완료·종료 시 Transfer scope token·job·ACL·임시 자원을 회수하고, 정지 시 해당 접근을 중지해야 한다. | MUST | ST-LCM-001 |
| FR-TRN-006 | public DSP DataService endpoint와 private source binding을 분리하고 Consumer 입력으로 source binding을 변경할 수 없게 해야 한다. | MUST | ST-BIND-001 |
| FR-TRN-007 | Transfer Request의 `consumerPid·agreementId·format·callbackAddress`와 Transfer Start의 `providerPid·consumerPid`를 검증하고, push Request와 pull Start에서만 각각 필요한 `dataAddress`를 허용해야 한다. | MUST | CT-TRN-002 |
| FR-TRN-008 | Transfer 상태를 DSP 메시지의 ACK 뒤에 확정하고 ERROR에는 전이하지 않으며, ACK 유실 시 같은 PID로 멱등 재시도해야 한다. | MUST | FT-TRN-002 |
| FR-DSP-001 | Connector는 인증 없이 접근 가능한 공통 version metadata endpoint(`.well-known` 경로 규칙)를 제공하고, 상대 Connector의 version metadata를 조회해 지원 version·binding을 선택해야 한다. | MUST | CT-DSP-002 |
| FR-DSP-002 | DSP 메시지의 JSON-LD 처리는 배포에 고정된 context만 사용하고 원격 context 조회를 비활성화하며, 알 수 없는 context·term은 fail-closed로 거부해야 한다. | MUST | CT-DSP-003 |
| FR-PLT-001 | 시스템은 공식 platform baseline·delta·delete를 수집하고 source record와 Connector object mapping을 보존해야 한다. | MUST | IT-PLT-001 |
| FR-PLT-002 | Offering 등록 전에 Provider 권한, license, Distribution, DataService, source binding과 회수방법을 검증해야 한다. | MUST | IT-PLT-002 |
| FR-PLT-003 | Offering 등록·수정·철회는 같은 source ID와 version에 대해 멱등이어야 한다. | MUST | FT-PLT-001 |
| FR-PLT-004 | Agreement·Transfer를 platform subscription·entitlement·token·job·ACL 중 필요한 외부 자원으로 mapping하고 각 자원의 scope를 `Offering·Agreement·Transfer·Request` 중 하나로 기록해야 한다. | MUST | IT-PLT-003 |
| FR-PLT-005 | Contract Negotiation의 `FINALIZED` Event가 ACK되기 전에는 platform 접근자원을 provision하지 않아야 하며, Dataset별 provisioning trigger를 `FINALIZED` Event ACK 직후(Agreement scope), `Transfer Request Message` ACK 직후(Transfer scope), 첫 payload request 시(짧은 TTL 자원) 중에서 승인·기록해야 한다. | MUST | ST-PLT-001 |
| FR-PLT-006 | 외부 자원에 대한 모든 command는 멱등키와 자원 scope를 가져야 하며, 정지·재개·삭제 command는 대상 external resource ID를 포함하고 생성 command는 응답으로 받은 external resource ID를 확정 저장해야 한다. | MUST | FT-PLT-002 |
| FR-PLT-007 | DSP desired state와 platform actual state를 비교해 orphan·missing·duplicate resource를 탐지·복구해야 한다. | MUST | FT-PLT-003 |
| FR-PLT-008 | Dataset withdrawal은 신규 계약 차단, 기존 Agreement 영향판정, 외부 자원 회수와 Catalog 제거 순서로 처리해야 한다. | MUST | IT-PLT-004 |
| FR-PLT-009 | dataspace participant와 platform organization·tenant·service identity의 binding을 수명주기와 함께 관리해야 한다. | SHOULD | ST-PLT-002 |
| FR-PLT-010 | 사람 비밀번호, browser session cookie, CSRF token과 개인용 API key를 Bridge credential로 사용하지 않아야 한다. | MUST | ST-PLT-003 |
| FR-PLT-011 | Transfer 완료를 Agreement 해지로 간주하지 않아야 하며 local Agreement 만료·철회·해지 때 관련 active Transfer와 Agreement scope 자원을 종료해야 한다. | MUST | ST-PLT-004 |
| FR-ID-001 | 참가자 식별과 Connector 요청 인증을 지원해야 한다. | MUST | ST-ID-001 |
| FR-ID-002 | 제한 단계에서 기관 자격 credential을 정책 입력으로 검증할 수 있어야 한다. | SHOULD | ST-ID-002 |
| FR-AUD-001 | participant, Contract Negotiation PID, Agreement, Transfer PID, platform external resource와 source request를 상관관계로 연결해야 한다. | MUST | OP-AUD-001 |
| FR-AUD-002 | 승인·정책판정·접근·철회·파기 증거를 보존해야 한다. | MUST | OP-AUD-002 |
| FR-OPS-001 | source 장애·quota 초과·schema 변경을 탐지하고 안전하게 실패해야 한다. | MUST | FT-OPS-001 |
| FR-OPS-002 | asset와 adapter별 제공중단·복구·연락처 runbook을 제공해야 한다. | MUST | DOC-OPS-001 |

## 5. 비기능 요구사항

| ID | 요구사항 | 초기 목표 | 검증 |
| --- | --- | --- | --- |
| NFR-SEC-001 | 전송 중·저장 시 암호화 | 외부 TLS, secret·sensitive store 암호화 | ST-TLS-001 |
| NFR-SEC-002 | 최소권한과 영역분리 | public DSP API, private management API, source zone 분리 | ST-ZONE-001 |
| NFR-SEC-003 | secret 관리 | Catalog·config·log에 평문 secret 0건 | ST-SECRET-001 |
| NFR-SEC-004 | Connector identity·signing key 수명주기 | Secret Store·HSM 후보 보관, rotation 주기와 유출 대응 runbook 정의 | OP-KEY-001 |
| NFR-SEC-005 | Control Plane 남용 통제 | public DSP endpoint의 rate limit, 요청 크기 한도와 동시 negotiation 상한 | ST-DOS-001 |
| NFR-INT-001 | DSP 상호운용 | 선택한 DSP version의 schema·상태흐름·TCK 대상 통과 | CT-DSP-001 |
| NFR-INT-002 | metadata 상호운용 | 선언한 DCAT·국내 profile 판별시험 통과, 미시험 국내 표준은 적합성 claim 차단 | CT-PROFILE-001·CT-KR-STD-002 |
| NFR-REL-001 | 멱등성 | 동일 요청·callback 재처리 시 논리 자원 1개 유지 | FT-IDEMP-001 |
| NFR-REL-002 | 장애격리 | 원천 하나의 장애가 다른 Provider·asset transfer를 중단시키지 않음 | FT-BULKHEAD-001 |
| NFR-REL-003 | 최종 일관성 | callback 유실·restart 뒤 reconciliation으로 Connector·platform 상태 수렴 | FT-CONSIST-001 |
| NFR-OBS-001 | 관측성 | 구조화 log, metric, trace와 공통 correlation ID | OP-TRACE-001 |
| NFR-DQ-001 | 최신성 | 자산별 승인된 freshness 목표와 stale 표시 | DQ-FRESH-001 |
| NFR-PRV-001 | 개인정보 최소화 | Catalog·log·test fixture에 실제 개인 원시정보 미사용 | ST-PRIV-001 |
| NFR-OPS-001 | 변경관리 | schema·policy·source endpoint 변경 전 호환성 검증과 통지 | OP-CHANGE-001 |
| NFR-PORT-001 | 구현 종속 완화 | DSP·DCAT·ODRL model과 제품 내부 model 사이 adapter 경계 유지 | CT-PORT-001 |

정량 SLO는 원천 SLA와 대상 배포환경을 확인한 후 별도 운영 기준선에서 확정한다.

## 6. 제약사항

- 공식 지원이 확인되지 않은 단일 페이지 애플리케이션(Single-Page Application, SPA) 내부 API에 운영 기능을 의존하지 않는다.
- 운영 데이터베이스(Database, DB)에 Connector가 직접 ad hoc query를 실행하지 않는다.
- 원천 API key를 소비자에게 공유하지 않는다. 원천 약관이 요구하면 소비자별 credential provisioning을 사용한다.
- 공개제한 공간정보를 보안심사 전 public cloud·public network에 적재하지 않는다.
- 원시 교통카드, 번호판, 폐쇄회로 텔레비전(Closed-Circuit Television, CCTV), 개인 이동경로를 초기 실증에서 사용하지 않는다.
- EDC, DCP, Kubernetes, cloud는 아직 채택 결정이 아니다.
- 법적 계약과 기관 승인 기록을 ODRL로 대체하지 않는다.
- Catalog Broker crawl을 legacy-platform Offering onboarding으로 간주하지 않는다.
- HTTP 200, 화면 메뉴 또는 metadata field 존재만으로 host·broker 권한을 판정하지 않는다.

## 7. 요구사항 변경

요구사항 책임자는 MUST 요구사항 변경을 ADR 또는 승인된 change record에 기록한다.
검증: 변경 검토자는 source ID와 시험 ID의 연결을 evidence로 확인한다.

검증 기준은 ADR 또는 change record, 변경 근거와 시험 ID의 상호 연결이다. 법령·원천약관·DSP version 변경 시 다음 산출물을 함께 갱신한다.

- [출처 레지스터](../../evidence/source-register.yaml)
- [주장-근거 매트릭스](../../evidence/claim-evidence-matrix.md)
- 변경된 요구사항에 연결된 검증 항목

변경 검토자는 검증 기준을 충족한 경우에만 변경을 완료로 승인한다.
