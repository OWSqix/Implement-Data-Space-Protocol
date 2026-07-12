# 위험 대장

작성일: 2026-07-11  
작성 기준: 2026-07-12  
상태: Draft

## 1. 목적과 평가 기준

- **(목적)** 실증 착수, architecture review와 production release를 차단할 위험 및 처리 증거 관리
- **(판정)** `R-001`, `R-003~005`, `R-007~010`, `R-021`, `R-027~032`, `R-036`, `R-037`, `R-040~052`는 sponsor 처리방향 승인 전까지 상위 위험으로 유지
- **(가능성)** 낮음(L), 중간(M), 높음(H)
- **(영향)** 낮음(L), 중간(M), 높음(H), 치명적(C)
- **(상태)** Open, Mitigating, Accepted, Closed
- **(담당)** 표의 Owner는 책임 역할이며 프로젝트 착수 시 governance owner가 실명 담당자와 검토 주기를 기록

## 2. 착수 차단 위험

Sponsor는 다음 위험의 처리방향을 실증 착수 전에 승인한다.

1. `R-001` Provider 권한
2. `R-003` 공식 metadata 연계 경로
3. `R-004` Open API HTTPS와 인증키 보호
4. `R-005` 공개 license 보존
5. `R-007` 개인정보·재식별
6. `R-008` 교통카드 재제공
7. `R-009` 공개제한 공간정보
8. `R-010` source credential·quota
9. `R-021` 국외이전·반출
10. `R-027` Open API hostname·DNS 도달성
11. `R-028` 플랫폼 역할 오분류
12. `R-029` DSP와 플랫폼 수명주기 불일치
13. `R-030` Provider 권한과 운영 역할 혼동
14. `R-031` identity·quota 혼선
15. `R-032` 플랫폼 lifecycle API 부재
16. `R-036` 운영기관 무응답·소관 부서 미식별
17. `R-037` 스폰서·수행 근거 부재
18. `R-040` 국내 표준 적합성 오표시
19. `R-041` 국내 DCAT profile 판 불일치
20. `R-042` RDF 직렬화·engine 불일치
21. `R-043` 기관 DB metadata 범주 오류
22. `R-044` 국내 CRS·축·legacy alias 오해석
23. `R-045` 표준 원문·기관 fixture 미확보
24. `R-046` 검증기 의존 패키지 byte 미고정
25. `R-047` 수기 source inventory의 자기참조 coverage
26. `R-048` XSD datatype 검사 범위 누락
27. `R-049` 외부 네트워크 레지스트리 snapshot 노후화
28. `R-050` 국내 CRS 근거 응답의 byte 고정 부재
29. `R-051` 국내 표준 status 근거의 동시 변경 가능성
30. `R-052` 비정형 conformance claim 우회

## 3. 위험 목록

| ID | 위험 | 가능성 | 영향 | Owner | 예방·완화 | 탐지·Trigger | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | 통합 채널이 원천 데이터 계약·재제공 권한을 갖지 않음 | H | C | 데이터 정책 책임자 | Dataset별 Offering Provider 판정, 위임증거 없는 플랫폼 Offer 금지, 필요 시 원 보유기관 Provider | Provider·위임문서 누락 | Open |
| R-002 | 검색 가능한 레코드를 전송 가능한 DSP Dataset으로 오인 | H | H | Catalog·data steward | 6단계 판정상태, Passport·rights gate | catalog-only record가 DSP Catalog Dataset으로 생성 | Mitigating |
| R-003 | session cookie·CSRF 기반 SPA 내부 API를 공식 연계 API로 오인 | H | H | 통합 채널 운영자 | 공식 bulk·delta API/SLA 확보, adapter contract | 내부 endpoint·schema·session 흐름의 무통지 변경 | Open |
| R-004 | 문서화된 HTTP Open API 호출에서 `serviceKey`와 요청 내용이 평문 노출 | H | C | 통합 채널 운영자·Security | HTTPS 지원과 TLS 구성 확인 전 실증 호출 금지, 대체 export 확보 | `http://openapi.molit.go.kr` 요청 또는 평문 key 탐지 | Open |
| R-005 | 공개 데이터가 DSP 계약으로 불필요하게 재제한 | M | H | 법무·policy owner | license-policy 충돌 validator, open direct 경로 | open license+purpose/noncommercial 제약 | Mitigating |
| R-006 | ODRL만으로 전달 후 사용을 통제할 수 있다고 가정 | H | H | Architecture·legal | 집행지점 명시, 고위험 데이터 secure analysis | 완전 파일 전송 후 기술적 회수 요구 | Mitigating |
| R-007 | 개인정보·이동경로 재식별 또는 목적 외 제공 | M | C | 개인정보책임자 | 최소화·위험평가·가명처리·안전분석·반출심사 | 소수집단·반복경로·식별자 결합 | Open |
| R-008 | 교통카드 수신자료를 중간 Provider가 재배포 | M | C | 법무·원 권한기관 | 원 권한기관 직접 Provider, 초기 실증 제외 | 제3자 제공금지 자료 발견 | Mitigating |
| R-009 | 공개제한 공간정보가 Catalog·cloud·log로 유출 | M | C | 공간정보 보안담당 | 등급 Gate, 별도 security zone, 최소 metadata | 정밀 좌표·제한 layer·시설정보 탐지 | Open |
| R-010 | 계정별 공통 API key를 여러 participant와 공유해 약관·quota·책임경계 위반 | H | H | Source owner·Data Plane | 기관 공용·proxy 사용 승인 전 공유 금지, Vault 보관과 계약별 계측·격리 | 여러 participant의 동일 key 사용·quota 간섭 | Open |
| R-011 | source URL·secret이 Catalog·callback·log에 노출 | M | C | Security·Data Plane | private source binding, Vault, masking, secret scan | 정규식·canary secret 탐지 | Mitigating |
| R-012 | CRS·축 순서·시간대·단위 오류로 데이터 오사용 | H | H | Data steward | domain profile·validation·golden fixture | 지도 위치·시간·산식 불일치 | Open |
| R-013 | 표준 node/link·schema 변경으로 join이 깨짐 | H | H | Source owner·data quality | version·change history, compatibility gate | unknown ID·schema drift 증가 | Open |
| R-014 | 중앙 Broker가 단일 장애점·정책 우회점이 됨 | M | H | Platform owner | Provider direct fallback, HA·cache rebuild·policy preservation | Catalog 전면 장애·policy diff | Open |
| R-015 | source 장애·quota 초과가 다른 자산에 전파 | H | H | SRE·adapter owner | bulkhead, 계약별 quota, circuit breaker | latency·5xx·queue saturation | Open |
| R-016 | local Agreement 만료·철회 뒤 token·ACL·snapshot이 남음 | M | C | Control/Data Plane owner | DSP Suspension·Termination, 짧은 TTL, revoke hook, reconciliation | 만료 정책 이후 접근 성공 | Mitigating |
| R-017 | callback 재시도·restart로 중복 transfer 발생 | M | H | Connector owner | idempotency key, lease·state validation | 중복 flow·object·topic | Open |
| R-018 | DSP·DCP·Connector version 또는 상태·Catalog 해석 불일치 | M | H | Protocol owner | DSP/DCP 증거 분리, version pinning, cardinality·Offer target·FINALIZED·dataAddress contract test, TCK·interop | schema·state·auth incompatibility | Open |
| R-019 | 특정 Connector 구현에 종속되어 교체가 어려움 | M | M | Architecture owner | canonical model·adapter interface, ADR, exportable state | product-specific model이 public contract에 누출 | Open |
| R-020 | cache·snapshot이 원천 license·보유기간과 충돌 | M | H | Data steward·legal | 자산별 cache permission·TTL·delete evidence | expired·revoked payload 잔존 | Open |
| R-021 | 해외 cloud·운영접속이 국외이전·반출 조건 위반 | M | C | Legal·security architecture | data residency inventory, egress·support access 검토 | foreign region·support access 발견 | Open |
| R-022 | 법령·행정규칙 개정 후 오래된 기준을 사용 | M | H | Compliance owner | 시행일 기준 baseline·정기 review | source register review overdue | Open |
| R-023 | metadata가 오래되거나 source와 불일치 | H | H | Catalog·source steward | delta+reconciliation, stale 표시, SLO | modified·availability diff | Open |
| R-024 | 운영 주체·비용·지원책임이 불명확 | H | H | Sponsor·governance | RACI, service agreement, capacity·cost model | incident에 owner 없음 | Open |
| R-025 | 보고서·생성문서의 부정확한 2차 설명을 기준으로 사용 | M | H | Research owner | 1차 출처 register와 claim matrix, review | 근거 ID 없는 normative claim | Mitigating |
| R-026 | `applycation/json` 문서 오탈자를 실제 Content-Type으로 구현 | M | M | Adapter owner·Research owner | 운영 응답과 공식 정정 확인, media type contract test | 잘못된 `Content-Type` 또는 parser 실패 | Open |
| R-027 | 문서상 Open API host의 DNS 실패로 metadata 연계가 시작되지 않음 | H | H | 통합 채널 운영자·Network owner | 지원 hostname·접근망·DNS를 공식 확인하고 배포환경에서 사전 시험 | `SERVFAIL`, loopback·private·unknown address, DNS view 불일치 | Open |
| R-028 | index-only record를 hosted·brokered Offering으로 오분류 | H | C | Data steward·Platform owner | record별 역할 증거, Distribution·subscription Gate, HTTP 200만으로 승격 금지 | payload·회수경로 없는 Offer 생성 | Open |
| R-029 | DSP Negotiation·Transfer와 플랫폼 subscription·token 상태가 어긋남 | H | C | Bridge·Platform lifecycle owner | ACK 뒤 DSP 상태 확정, 같은 PID 멱등 재시도, durable mapping·outbox·TTL·reconciliation | 양측 PID 상태 불일치, 종료된 local Agreement의 활성 external resource·orphan 증가 | Open |
| R-030 | 플랫폼 운영자·Connector 운영자를 Offering Provider 권한자로 오인 | M | C | Governance·legal | 원 보유기관·Provider·계약·Connector·전달 역할 분리, authority evidence | 계약주체·위임문서 누락 | Open |
| R-031 | 데이터 스페이스 참가자 identity가 공용 플랫폼 계정으로 합쳐져 confused deputy·quota 혼선 발생 | M | C | IAM·Platform owner | organization·tenant binding, scoped service identity, participant별 audit·quota | 공용 key·계정에서 여러 Agreement 구분 불가 | Open |
| R-032 | subscription 생성·삭제 API가 없거나 수동 절차라 full lifecycle 자동화가 불가능 | H | H | Platform owner·Sponsor | capability profile, manual·API 수준 명시, PoC 범위 하향 또는 source platform 선택 | Agreement 종료 뒤 자동 revoke 불가 | Open |
| R-033 | metadata·Offering과 platform source의 수정·삭제가 동기화되지 않음 | H | H | Offering onboarding owner | delta·tombstone, version, event gap detection, full reconciliation | 삭제 source의 Catalog·Offer 잔존 | Open |
| R-034 | CaaS가 Provider 권한·source secret·network와 tenant를 과도하게 집중 | M | C | Architecture·Security·legal | 대리권한, tenant·key·egress·audit·offboarding 검토, 대체 배치 비교 | cross-tenant 접근·국외 egress·회수 불가 | Open |
| R-035 | 참조 사례(MDS) 운영·재원 변동으로 참조 architecture의 사례 근거가 약화 | M | M | Research owner | 사례 지속성 정기 확인, 설계 원칙과 사례 존속의 분리(C-030~C-034), 국내 PoC 결과를 대체 근거로 축적 | MDS 운영·재원 관련 공지 | Open |
| R-036 | 운영기관 무응답 또는 소관 부서 미식별로 P0 증거 확보가 지연·불가 | H | H | Research owner·Sponsor | 문의 패키지 단계적 발송, 회신 기한과 escalation 경로 지정, 원천 플랫폼(통계누리·ITS 등) 대체 후보 병행 조사 | 1차 회신 기한 초과, 소관 부서 불명 회신 | Open |
| R-037 | 스폰서·수행 근거 부재로 실증 착수 권한과 위험 승인 주체가 없음 | H | C | Sponsor·governance | 착수 전 스폰서와 수행 근거 확보, 승인 전 대외 신청·호출·상태 변경 금지 유지 | 상위 위험 처리방향의 승인 주체 부재 | Open |
| R-038 | CSAP·ISMS-P·망분리·보안성 검토·조달 요건으로 Connector·CaaS 배치가 지연·제약 | M | H | Security·Sponsor | 배치 후보별 인증·망 요건 사전 조사, 인증 보유 CaaS 우선 검토, 일정에 심사 기간 반영 | 인증 미보유 후보 선정, 보안성 검토 반려 | Open |
| R-039 | 조사·운영 인력 단일화로 연속성이 끊기고 증거 재현이 불가능 | M | H | Sponsor·governance | 저장소 commit 기준 증거 baseline, 문서화된 재현 절차, 역할 백업 지정 | 담당자 부재 시 진행·재현 불가 | Open |
| R-040 | 공개 초록과 표준번호만으로 국내 표준 적합성을 표시 | H | C | Profile governance·verification owner | 증거 수준별 claim Gate, 원문 조항·fixture·기관 승인 전 `적합` 금지 | `conformanceClaimAllowed=false`인 표준의 적합 표시 | Mitigating |
| R-041 | DCAT-AP 2.1.0 기반 국내 profile을 3.0.1 graph에 그대로 병합 | H | H | Metadata architecture owner | DCAT-AP-KR·국내 GeoDCAT version migration, 이중 validator | class·property·cardinality·통제어 diff | Open |
| R-042 | RDF parser·SHACL engine 변경 뒤 승인 증거를 갱신하지 않아 상호운용성 회귀를 놓침 | H | H | Verification·security owner | 5개 RDF 직렬화 RDFC-1.0·Jena parser 비교와 13개 SHACL 사례 candidate 승인 | parser·engine graph 또는 정규화 result 불일치 | Mitigating |
| R-043 | DB 운영·물리 metadata를 공개 Dataset·Distribution 값으로 자동 승격 | H | C | Data steward·privacy owner | private compliance record 분리, 금지 mapping negative test | DBMS·운영자·DB 용량이 public RDF에 나타남 | Open |
| R-044 | 국내 CRS codeSpace와 축 순서를 잘못 해석해 위치를 이동 | H | C | Geospatial governance owner | EPSG resolver 확인, legacy alias registry, CRS별 geometry parser·왕복시험 | 미등록 EPSG IRI, 축 교환 뒤 위치 오차 | Open |
| R-045 | KS·TTA 원문과 기관 정상·오류 fixture를 확보하지 못해 조항시험 중단 | H | H | Sponsor·standards liaison | 합법 원문 확보, 내부 digest register, 기관 fixture 제공협약 | clause crosswalk·KS-XML·기관 interop Gate 미완료 | Open |
| R-046 | 실제 설치된 Node·Python·Jena 의존 byte가 승인 증거와 달라짐 | M | C | Release manager·security | Python wheel hash, 격리 Node install tree·SBOM, Jena·JRE archive와 설치 tree digest 검증 | 승인 digest·lock과 실제 설치 파일 불일치 | Mitigating |
| R-047 | crosswalk source inventory와 mapping 행을 함께 누락 | H | H | Platform mapping owner | 안전 parser가 포털 fixture의 17개 path를 생성하고 crosswalk와 완전 대조 | 신규 기관 fixture path가 inventory에만 존재 | Mitigating |
| R-048 | 지원 목록 밖 XSD datatype 오류를 open-world triple에서 놓침 | M | H | Profile verification owner | 승인된 15개 datatype lexical·value 검사와 unknown XSD datatype 차단 | registry 밖 datatype 또는 음성 fixture 통과 | Mitigating |
| R-049 | IANA 주소표 snapshot이 오래돼 새 예약·할당을 잘못 판정 | M | H | Security·release manager | official CSV 3종 digest·생성기 검증, scheduled refetch·유효기간 Gate 추가 | 원본과 생성 정책 차이 또는 snapshot 기한 초과 | Mitigating |
| R-050 | CRS resolver snapshot 변경·누락으로 축 정책 근거를 재현하지 못함 | M | H | Geospatial governance owner·release manager | CRS 7종·coordinate system 2종의 byte·SHA-256·semantic field와 정책 생성 검증 | resolver 변경, snapshot 누락·digest 불일치·검토기한 초과 | Mitigating |
| R-051 | 국내 표준 lifecycle record와 source register를 같은 변경에서 함께 고치면 가변 정본끼리의 equality Gate를 우회할 수 있음 | M | C | Standards liaison·release manager | 검토 baseline digest를 코드에 고정하고 공식 status HTML·PDF·WARC의 URL·수집시각·byte 수·SHA-256과 독립 승인자를 기록 | baseline digest 변경, 공식 고정본 누락, source·register 동시 status 변경 | Open |
| R-052 | 등록한 금지 문자열 밖의 동의어·문맥으로 검증하지 않은 conformance를 대외 표시 | M | C | Publication owner·standards liaison | 정형 declaration만 허용하고 승인자·범위·표준판·근거 digest·만료일 기록, 발간 전 사람 검토 | 미등록 동의어, 승인 record 없는 준수·부합·호환 표현 | Open |

## 4. 위험 처리 절차

1. Trigger 또는 새로운 증거가 발견되면 risk owner가 가능성·영향을 재평가한다.
2. 요구사항, architecture, policy, test에 필요한 변경을 연결한다.
3. 위험을 Accepted로 전환하려면 잔여위험, 승인자, 유효기간을 기록한다.
4. 법령·source 약관·보안등급 변경으로 생긴 위험은 자동으로 재검토한다.
5. Closed는 예방책 문서화만으로 인정하지 않고 검증 증거를 요구한다.

## 5. 다음 검토

| 담당 | 입력 | 산출물 | 수행 시점 | 완료조건 |
| --- | --- | --- | --- | --- |
| Governance owner | 위험 대장과 착수 조직표 | Owner 실명 mapping과 review cadence | 단계 0 종료 전 | 모든 Open·Mitigating 위험에 실명 담당자와 다음 검토일 존재 |
| Data steward·architecture owner | Dataset Passport와 설계 변경 | 위험 재평가와 연결 requirement·test ID | 자산 onboarding·architecture review 전 | Trigger 반영과 상위 위험 승인 완료 |
| Release authority | 시험 증거와 잔여위험 승인안 | release risk decision | production release 전 | Critical 미완화 위험 0건, Accepted 위험에 승인자·유효기간 존재 |
