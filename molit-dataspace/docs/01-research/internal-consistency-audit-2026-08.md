# 저장소 내부 일관성 감사

작성일: 2026-08-03  
작성 기준: 2026-08-02 감사 스냅샷  
상태: Draft  
작성자: 조사 보고서 작성자  
관련 결정: 2026-08-02 감사 스냅샷 174개 파일 유지 — 별도 ADR 없음

## 1. 목적과 범위

- **(목적)** 저장소 내부의 미등록 미결, 문서 간 모순, 정본 충돌·공백, 빈 참조와 요구사항·시험 추적 공백의 기록
- **(질문)** 감사 기준일에 어떤 불일치가 있었고, 무엇이 발간·실증 판정을 차단하며, 어떤 외부 조치가 있어야 닫히는가
- **(포함 범위)** 2026-08-02 시점 `docs/` Markdown 66개와 `governance/`·`standards/`·`profiles/`·`evidence/`의 `JSON`·`YAML` 108개, 합계 174개 파일
- **(제외 범위)** 웹 자료, 기존 미결 등록부에 이미 포함된 항목, 2026-08-03 생성 조사 보고서 6개, 감사 지적의 실제 시정
- **(판정 기준)** 차단·중요·관찰의 심각도, 주장 간 일치, 정본의 단일성, 참조 유효성, 기능·비기능 요구사항과 시험의 양방향 추적

작업 지시가 지정한 2026-08-03 생성 조사 보고서 4개와 작성 중 추가된 2개는 다음과 같다. 6개 문서는 모두 차기 감사 대상이다.

| 파일 | 구분 | 감사 제외 근거 |
| --- | --- | --- |
| `docs/01-research/transport-participant-map.md` | 작업 지시 지정 | 2026-08-03 생성, 감사 기준일 뒤 추가 |
| `docs/01-research/low-tech-onboarding-precedents.md` | 작업 지시 지정 | 2026-08-03 생성, 감사 기준일 뒤 추가 |
| `docs/01-research/mandate-and-deeming-precedents.md` | 작업 지시 지정 | 2026-08-03 생성, 감사 기준일 뒤 추가 |
| `docs/01-research/legal-basis-precedents.md` | 작업 지시 지정 | 2026-08-03 생성, 감사 기준일 뒤 추가 |
| `docs/01-research/hub-capability-assessment.md` | 작성 중 추가 확인 | 2026-08-03 생성, 감사 기준일 뒤 추가 — `SRC-AUD-030` |
| `docs/01-research/hub-recruitment-feasibility.md` | 작성 중 추가 확인 | 2026-08-03 생성, 감사 기준일 뒤 추가 — `SRC-AUD-031` |

- **(Decision)** 66개 Markdown을 감사 당시 스냅샷으로 유지하고, 2026-08-03 추가 문서를 집계에 소급 반영하지 않음
- **(제한)** 이 문서의 집계 수치를 2026-08-03 현재 저장소의 전수 상태로 읽어서는 안 됨

## 2. 감사 방법과 상태

### 2.1 감사 방법

- **(Verified)** 감사 입력은 174개 파일을 대조했고 웹을 사용하지 않았다고 기록 — `SRC-AUD-001`, `.local/research-input/codex-internal-audit.md:3-4`
- **(Verified)** 감사 입력은 제시된 기존 미결 등록부의 항목을 신규 결과에서 제외했다고 기록 — `SRC-AUD-001`, 같은 파일 `:4`
- **(Unverified)** 입력에는 제외에 사용한 기존 미결 등록부의 파일·ID 목록과 감사 commit이 없음
- **(Decision)** 이 보고서는 지적을 기록하고 지정 항목을 `OPEN-AUD`로 등록하며, 원문과 구현의 실제 시정은 다음 배치에서 처리

### 2.2 상태 구분

| 상태 | 이 문서의 적용 기준 | 적용 대상 |
| --- | --- | --- |
| `Verified` | 감사 입력 또는 재현 가능한 저장소 파일·행에서 직접 확인 | 범위, 집계, A~C 인용, D축, E축 추적 결과 |
| `Inferred` | 확인된 충돌에서 도출했지만 감사 입력이 직접 제시하지 않은 해소 방향 | B·C축의 닫는 방법, 우선순위의 해석 |
| `Unverified` | 필요한 승인·배포·운영 데이터·시험·감사 식별자를 확보하지 못함 | `OPEN-AUD` 항목과 원문 재현성 공백 |
| `Decision` | 보고서 범위와 기록 방식을 정한 선택 | 2026-08-02 스냅샷 유지, 이번 배치에서 시정 제외 |

### 2.3 현재 판정

- **(판정)** A축부터 E축까지의 중복 제거 집계는 차단 35건, 중요 14건, 관찰 34건임 — `SRC-AUD-001`, `.local/research-input/codex-internal-audit.md:5-11`
  - **(근거)** A 9건, B 8건, C 7건, D 0건, E 중복 제거 59건
  - **(제한)** 축 간 중복은 E축의 `SHACL-DIFF-001A/B` 2개에 대해서만 제거됨
- **(판정)** 감사자가 가장 먼저 닫을 대상으로 지정한 항목은 `C3-01`, `A-05`, `A-06`, `A-08`, E축 `MUST` 부분 검증 28건임 — 8절
- **(판정)** 이번 배치는 결함을 고치지 않고 지정된 미등록 항목을 `OPEN-AUD`로 등록 — 10절

## 3. 축별 집계

### 3.1 A축부터 E축까지의 집계

| 축 | 신규 발견 | 차단 | 중요 | 관찰 | 근거 |
| --- | ---: | ---: | ---: | ---: | --- |
| A. 미등록 미결 | 9 | 6 | 0 | 3 | `SRC-AUD-001`, `.local/research-input/codex-internal-audit.md:7` |
| B. 문서 간 모순 | 8 | 0 | 7 | 1 | `SRC-AUD-001`, 같은 파일 `:8` |
| C. 정본 충돌·공백 | 7 | 1 | 4 | 2 | `SRC-AUD-001`, 같은 파일 `:9` |
| D. 빈 참조 | 0 | 0 | 0 | 0 | `SRC-AUD-001`, 같은 파일 `:10,74-76` |
| E. 추적 공백 | 중복 제거 59 | 28 | 3 | 28 | `SRC-AUD-001`, 같은 파일 `:11,78-175` |

- **(Verified)** E축 원시 분류는 미등록 부분 검증 기능 요구사항 31건과 기능·비기능 요구사항 비연결 시험 30개임
- **(Verified)** `SHACL-DIFF-001A/B` 2개가 `FR-SEM-011` 공백과 겹치므로 중복 제거 수는 `31 + 30 - 2 = 59`임
- **(Decision)** 작업 지시의 4축 표현과 달리 입력 표가 A축부터 E축까지의 다섯 축을 제시하므로 다섯 행을 모두 유지

### 3.2 A축 지정 표현 검출

- **(Verified)** 감사 입력의 총계는 918개 행에서 1,004회 검출임 — `SRC-AUD-001`, `.local/research-input/codex-internal-audit.md:15`

| 표현 | 검출 횟수 | 표현 | 검출 횟수 |
| --- | ---: | --- | ---: |
| `미정` | 72 | `미확인` | 123 |
| `미검증` | 22 | `미구현` | 42 |
| `TBD` | 0 | `후속` | 53 |
| `이월` | 17 | `별도 결정` | 3 |
| `추후` | 0 | `확인 필요` | 15 |
| `Unverified` | 117 | `pending` | 408 |
| `open` | 225 | `선택하지 않` | 6 |
| `판정하지 않` | 25 | `결정하지 않` | 5 |

- **(Verified)** 표현별 수치를 다시 더하면 1,133회임
- **(Unverified)** 세부합 1,133회와 원문 총계 1,004회의 차이 129회에 대한 중복 제거 또는 산식이 없어 정확한 총회수는 판정 불가

### 3.3 E축 중복 제거 계산

| 원시 분류 | 건수 | 심각도 구성 | 중복 처리 |
| --- | ---: | --- | --- |
| 신규 부분 검증 기능 요구사항 | 31 | 차단 28, 중요 3 | `FR-SEM-011` 1건이 아래 시험 2개와 겹침 |
| 기능·비기능 요구사항 비연결 시험 | 30 | 차단 중복 2, 관찰 28 | `SHACL-DIFF-001A/B` 2개 제외 |
| 중복 제거 결과 | 59 | 차단 28, 중요 3, 관찰 28 | `31 + 30 - 2` |

## 4. A축 미등록 미결

| ID | 파일:행 | 인용 | 심각도 | 닫는 방법 |
| --- | --- | --- | --- | --- |
| A-01 | `SRC-AUD-002` — `docs/01-research/dataspace-landscape-survey.md:87` | “펀딩 2025-08 종료, 후속 운영 미확정, 공식 도메인 접속 불가 상태” | 관찰 | 후속 운영자·공식 종료 공지를 확인해 신규 `OPEN-SUR`로 등록하거나 역사 사례로 범위를 낮춤 |
| A-02 | `SRC-AUD-002` — `docs/01-research/dataspace-landscape-survey.md:156`; `SRC-AUD-003` — `docs/01-research/sector-adoption-levers.md:52` | “교환 시맨틱 폭이 좁아 분석·AI형 유즈케이스 확장은 미검증”; “분석형 유즈케이스 확장 미검증” | 관찰 | 실제 분석 교환 schema·유즈케이스·거래 증거를 확보하거나 주장을 업무문서 자동화로 한정 |
| A-03 | `SRC-AUD-002` — `docs/01-research/dataspace-landscape-survey.md:164` | “공공 재정 지속이 전제이고 자립 전환은 미검증” | 관찰 | 운영비·민간수입·보조금 종료 후 지속성 근거를 신규 `OPEN-SUR` 항목으로 등록 |
| A-04 | `SRC-AUD-004` — `docs/03-plan/poc-candidate-shortlist.md:351,364` | “Candidate ID \| `미정`”; “결정자·결정일 \| `미정`” | 차단 | G0~G6을 통과한 후보 하나를 선택하고 Candidate ID·결정자·결정일을 중앙 결정 또는 gap ID와 연결 |
| A-05 | `SRC-AUD-005` — `profiles/molit-dcat-ap/releases/1.0.0-rc.1/artifact-lock.json:8` | `license: PENDING-OWNER-APPROVAL` | 차단 | 소유자·법무 승인을 받아 `LICENSE.md`·`NOTICE.md`·artifact lock을 재생성하고 기관 서명 증거를 남김 |
| A-06 | `SRC-AUD-006` — `profiles/molit-dcat-ap/releases/1.0.0-rc.1/vocabulary/registry-metadata.json:4` | `registryStatus: candidate-pending-authority-approval` | 차단 | 권위원, 판 관리, 폐지·대체·변경·철회 절차를 승인하고 candidate registry를 운영 정본으로 승격 |
| A-07 | `SRC-AUD-007` — `docs/04-implementation/stable-namespace-operations.md:19,25` | “어휘·식별자 namespace \| 미구현”; “현재 서버는 이 경로에 404를 반환한다.” | 차단 | `/id/concept`, `/id/metric`, `/scheme`을 배포하고 DNS·TLS·협상·tombstone 원격 검증을 통과 |
| A-08 | `SRC-AUD-008` — `standards/korean-interoperability-register.json:1697-1698,1718-1719` | “운영 모집단 또는 승인 층화표본을 대상으로 mapping coverage, 묵시적 유실과 거부사유 분포를 측정하지 않았다”; `currentlyBlocksRelease: true` | 차단 | `REL-MAP-001`을 운영 모집단 또는 승인 층화표본에 실행하고 coverage·유실·거부사유 분포를 증거로 고정 |
| A-09 | `SRC-AUD-009` — `governance/commercial-readiness-register.v1.json:155-160` | `status: open`; “승인 capacity profile, 30일 canary와 월별 SLA 산출물을 만들지 않았다”; “가용성·제외시간·오류예산·service credit을 재현하는 운영 증거가 없다.” | 차단 | capacity profile 승인, 30일 canary·failover, 월별 SLO·service-credit 산출물을 실행 증거로 등록 |

## 5. B축 문서 간 모순

- **(Unverified)** 감사 입력은 B축의 닫는 방법을 제시하지 않음
- **(Inferred)** 아래 닫는 방법은 충돌한 두 상태를 동시에 참으로 두지 않기 위한 해소 방향이며, 실제 판정은 승인·실행 증거가 필요

| ID | 파일:행 | 인용 | 심각도 | 닫는 방법 |
| --- | --- | --- | --- | --- |
| B-01 | `SRC-AUD-010` — `docs/04-implementation/edc-local-interoperability.md:241-242,255`; `SRC-AUD-011` — `evidence/edc/local-interoperability-status.v1.json:17,23,41,45` | 문서는 현재 정본을 `87b5870` 실행, `29/29`, `26 files`로 서술하나 상태 JSON은 checkout `b20c5f591a8fb5d0c7e50bc6309251af46b94323`, `31 topology files`, `30 passed`, `20260714T2240+0900-p0-schema-admission.json`을 기록 | 중요 | `Inferred` — 하나의 재실행 증거를 현재 정본으로 승인하고 commit·실행 경로·시험 수·파일 수를 문서와 JSON에서 동기화 |
| B-02 | `SRC-AUD-012` — `docs/02-architecture/edc-caas-dsaas-architecture.md:80`; `SRC-AUD-013` — `docs/04-implementation/dsaas-control-plane.md:192` | 아키텍처는 `SUSPENDED` → `DEPROVISIONED`, 구현 문서는 CaaS에 `desiredState=SUSPENDED` 전송 | 중요 | `Inferred` — 승인된 상태 전이 하나를 정하고 아키텍처 매핑·제어면 동작·시험을 같은 값으로 정렬 |
| B-03 | `SRC-AUD-014` — `docs/03-plan/verification-plan.md:179`; `SRC-AUD-008` — `standards/korean-interoperability-register.json:1390-1392` | `RT-SPATIAL-ACCURACY-001`이 검증 계획에서는 “미구현”, register에서는 `status: implemented` | 중요 | `Inferred` — 실제 시험 실행 증거로 상태를 판정한 뒤 검증 계획과 register를 동기화 |
| B-04 | `SRC-AUD-014` — `docs/03-plan/verification-plan.md:181`; `SRC-AUD-008` — `standards/korean-interoperability-register.json:1399-1402` | `GEO-LIT-COVERAGE-001`이 검증 계획에서는 “미구현”, register에서는 `status: implemented` | 중요 | `Inferred` — 실제 시험 실행 증거로 상태를 판정한 뒤 검증 계획과 register를 동기화 |
| B-05 | `SRC-AUD-015` — `docs/03-plan/risk-register.md:10,16-18,50,108` | 상위 위험 열거는 `R-040~052`에서 끝나나 `R-053`은 착수 전 승인 대상, `H/H`, `Open`으로 기록 | 중요 | `Inferred` — `R-053`을 상위 위험 열거에 포함하거나 승인된 재분류 근거로 상세 행을 바꿔 요약과 상세를 일치 |
| B-06 | `SRC-AUD-016` — `docs/02-architecture/metadata-and-policy-profile.md:72,181` | RC.1 cardinality·datatype의 정본을 선언한 뒤 실행 범위와 cardinality는 0.1.0 명세로 판정한다고 서술 | 중요 | `Inferred` — 적용 release와 정본 우선순위를 승인하고 두 문장을 단일 판정으로 정렬 |
| B-07 | `SRC-AUD-017` — `docs/03-plan/release-gate-status.md:18`; `SRC-AUD-008` — `standards/korean-interoperability-register.json:1115,1138,1161,1183,1210,1373,1505,1535,1562,1589,1624,1854,1889` | 상태 문서는 `fixed` 12건, register의 `fixed` 항목은 13개 | 관찰 | `Inferred` — 정본 register에서 수를 재산출하고 상태 문서의 수치와 산출 기준을 갱신 |
| B-08 | `SRC-AUD-018` — `docs/01-research/korean-standards-interoperability.md:317`; `SRC-AUD-005` — `profiles/molit-dcat-ap/releases/1.0.0-rc.1/artifact-lock.json:6-2169`; `SRC-AUD-019` — `profiles/molit-dcat-ap/releases/1.0.0-rc.1/manifest.json:44` | 문서는 “기존 52개 machine artifact”, lock 배열은 307개, manifest는 `artifactInventoryPolicy: all-release-files` | 중요 | `Inferred` — machine artifact와 all-release-files의 산정 범위를 승인하고 정본 lock 기준으로 수치와 서술을 일치 |

## 6. C축 정본 충돌과 공백

- **(Decision)** 입력이 C축 표에 ID를 부여하지 않아 절 번호와 표 순서로 `C1-01`~`C3-02`를 부여
- **(Verified)** 입력은 우선순위 절에서 P0 로컬 판정 항목만 `C3-01`로 명시
- **(Inferred)** `C3-01`을 제외한 닫는 방법은 감사 입력에 없으며 정본을 하나로 확정하기 위한 해소 방향임

### 6.1 같은 대상의 복수 정본

| ID | 파일:행 | 인용 | 심각도 | 닫는 방법 |
| --- | --- | --- | --- | --- |
| C1-01 | `SRC-AUD-020` — `docs/02-design/governance-and-operating-principles.md:59`; `SRC-AUD-021` — `docs/02-architecture/provider-authority-registry.md:17` | 전자는 Provider 권한의 2단 정본을 문서와 JSON 경로로, 후자는 `standards/provider-authority-registry.json`만 정본으로 선언 | 중요 | `Inferred` — JSON과 설명 문서의 권위 관계를 승인하고 두 문서에 같은 정본 계층을 선언 |
| C1-02 | `SRC-AUD-016` — `docs/02-architecture/metadata-and-policy-profile.md:72`; `SRC-AUD-022` — `docs/04-implementation/molit-dcat-ap-implementation-guide.md:395` | 전자는 requirement ledger와 SHACL을 모두 정본으로, 후자는 JSON 정본·SHACL·fixture·생성 절차의 동시 갱신을 규정 | 중요 | `Inferred` — JSON·ledger와 SHACL 중 규범 정본과 파생 산출물의 관계를 승인하고 생성 절차에 고정 |
| C1-03 | `SRC-AUD-023` — `docs/04-implementation/tenant-isolation.md:7`; `SRC-AUD-024` — `docs/04-implementation/p0-control-plane-verification.md:20` | 전자는 상태 정본을 `PostgresScopedControlStore`, 후자는 `scoped_control_state`로 선언 | 관찰 | `Inferred` — 저장 component와 DB table의 관계를 명시하고 데이터 정본 표현을 단일 계층으로 통일 |

### 6.2 참조 대상의 자기선언 부재

| ID | 파일:행 | 인용 | 심각도 | 닫는 방법 |
| --- | --- | --- | --- | --- |
| C2-01 | `SRC-AUD-025` — `docs/03-plan/initial-usecases-and-kpi.md:121`; `SRC-AUD-004` — `docs/03-plan/poc-candidate-shortlist.md:5,9-10` | 참조 문서는 후보 목록을 기술 준비도 판정 정본으로 선언하나 대상은 `Draft`이며 정본 자기선언이 없음 | 중요 | `Inferred` — 대상의 승인 상태와 정본 자기선언을 확정하거나 참조 문서의 정본 선언을 철회·대체 |
| C2-02 | `SRC-AUD-026` — `docs/01-research/dataspace-concept-audit.md:23`; `SRC-AUD-027` — `docs/01-research/planning-report-technical-review.md:5,395` | 참조 문서는 `T-24`를 명명 정본으로 선언하나 대상은 `Review` 상태의 검토 항목이며 정본 자기선언이 없음 | 관찰 | `Inferred` — 승인된 명명 정본으로 승격해 자기선언을 두거나 참조를 승인 정본으로 교체 |

### 6.3 위임 대상 부재와 미배치

| ID | 파일:행 | 인용 | 심각도 | 닫는 방법 |
| --- | --- | --- | --- | --- |
| C3-01 | `SRC-AUD-024` — `docs/04-implementation/p0-control-plane-verification.md:6` | “로컬 판정 정본: `.local/p0/local-verification.json`”; 해당 파일이 저장소에 없음 | 차단 | 실제 P0 검증을 실행해 판정 파일을 생성·검증하고 승인 증거를 남김. 이번 작업에서는 생성하지 않음 |
| C3-02 | `SRC-AUD-028` — `docs/04-implementation/edc-v4-publication-adapter.md:51,58`; `SRC-AUD-019` — `profiles/molit-dcat-ap/releases/1.0.0-rc.1/manifest.json:9`; `SRC-AUD-007` — `docs/04-implementation/stable-namespace-operations.md:23,25` | 게시 Adapter는 `metadataIri`가 가리키는 표현을 정본으로 두고 HTTPS IRI만 허용하나 manifest는 `proposed-not-yet-dereferenceable`, `/id/...`는 404 | 중요 | `Inferred` — namespace를 실제 배포·원격 검증한 뒤 dereference 정본을 활성화하거나 배포 전 정본 위임을 철회·대체 |

### 6.4 빈 참조

- **(Verified)** D축 신규 발견은 0건임 — `SRC-AUD-001`, `.local/research-input/codex-internal-audit.md:74-76`
- **(Verified)** 내부 anchor 62개를 대조했고 heading 불일치나 약속한 내용이 없는 절은 없었음

## 7. E축 추적 공백

### 7.1 기능 요구사항 집계

기능 요구사항(Functional Requirement, FR)과 비기능 요구사항(Non-Functional Requirement, NFR)의 추적 상태는 다음과 같다.

| 강도 | FR | 완전 검증 | 부분 검증 | 기존 등록 부분 공백 | 신규 부분 공백 | 시험 없음 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `MUST` | 56 | 26 | 30 | 2 | 28 | 0 |
| `SHOULD` | 3 | 0 | 3 | 0 | 3 | 0 |
| 합계 | 59 | 26 | 33 | 2 | 31 | 0 |

- **(Verified)** 기존 2건은 `GAP-POL-001`·`GAP-TRN-001`이며 신규 목록에서 제외 — `SRC-AUD-014`, `docs/03-plan/verification-plan.md:202-203`
- **(Verified)** `MUST` 공백 28건은 모든 `MUST`에 정상·실패 시험 연결과 연결 시험 전부 통과를 요구한 자체 종료조건을 충족하지 못함 — `SRC-AUD-014`, 같은 파일 `:34,349-350`
- **(Verified)** 완전 검증 26건은 아래와 같음

| 구분 | FR ID |
| --- | --- |
| Catalog | `FR-CAT-002`, `FR-CAT-005`, `FR-CAT-007` |
| Metadata | `FR-META-001`, `FR-META-005` |
| Policy | `FR-POL-001`, `FR-POL-002`, `FR-POL-003` |
| Contract | `FR-CON-001`, `FR-CON-002`, `FR-CON-003` |
| Transfer | `FR-TRN-001`, `FR-TRN-002`, `FR-TRN-003`, `FR-TRN-005`, `FR-TRN-006`, `FR-TRN-007`, `FR-TRN-008` |
| DSP | `FR-DSP-002` |
| Platform | `FR-PLT-001`, `FR-PLT-003`, `FR-PLT-007`, `FR-PLT-008`, `FR-PLT-010` |
| Identity | `FR-ID-003` |
| Operations | `FR-OPS-001` |

### 7.2 신규 부분 검증 공백

요구 문언은 `SRC-AUD-029`, 현재 시험 문언은 `SRC-AUD-014`의 저장소 행을 따른다.

| FR·강도 | 요구 문언 | 현재 시험 문언 | 빠진 검증 축 | 심각도 |
| --- | --- | --- | --- | --- |
| `FR-CAT-001` `MUST` | `docs/02-architecture/requirements.md:49` — “공식 export·API·change feed” | `docs/03-plan/verification-plan.md:51` — “공식 metadata export 수집” | API, change feed | 차단 |
| `FR-CAT-003` `MUST` | `requirements.md:51` — “원 보유기관, Offering Provider, source system과 원천 식별자를 구분” | `verification-plan.md:53` — “Provider 없는 record → quarantine” | 네 주체·식별자의 상호 분리 | 차단 |
| `FR-CAT-004` `MUST` | `requirements.md:52` — “visibility·proof·Offer·DataService endpoint와 provenance” | `verification-plan.md:54` — visibility·proof·Offer·DataService만 열거 | provenance | 차단 |
| `FR-CAT-006` `MUST` | `requirements.md:54` — “수정·삭제·중복·pagination” | `verification-plan.md:55` — update·delete·duplicate·out-of-order | 증분 동기화 pagination | 차단 |
| `FR-CAT-008` `SHOULD` | `requirements.md:56` — Broker 채택 시 “upstream Catalog의 pagination을 소비” | `verification-plan.md:57` — 일반 Catalog pagination 순회 | upstream Broker pagination | 중요 |
| `FR-META-002` `MUST` | `requirements.md:58` — “format, media type, schema, version, temporal·spatial extent” | `verification-plan.md:60` — media type·schema·extent·version | `format` | 차단 |
| `FR-META-003` `MUST` | `requirements.md:59` — “CRS, 축 순서, 단위, 시간대, node/link version” | `verification-plan.md:61,129-131` — CRS·axis·unit·node version 중심 | 시간대, link version | 차단 |
| `FR-META-004` `MUST` | `requirements.md:60` — “권리·품질·계보·승인 정보를 Passport로 추적” | `verification-plan.md:62` — 승인된 Passport reference 존재 | Passport 내부 권리·품질·계보 | 차단 |
| `FR-SEM-001` `MUST` | `requirements.md:62` — profile·ontology·shape·concept scheme·instance별 stable/version IRI | `verification-plan.md:114,125,133` — profile version·계보·일반 dereference | 자원 종류별 IRI와 판 불변성 | 차단 |
| `FR-SEM-002` `MUST` | `requirements.md:63` — 실제 준수 표준만 선언 | `verification-plan.md:123,126-128` — routing·marker·coverage | 허위·부적절 `conformsTo` 거부 | 차단 |
| `FR-SEM-003` `MUST` | `requirements.md:64` — “source URL·version·license·SHA-256” | `verification-plan.md:115,135` — SHA-256·source·license·remote import | 외부 artifact version | 차단 |
| `FR-SEM-004` `MUST` | `requirements.md:65` — “기존 표준 term을 우선 재사용” | `verification-plan.md:118,122` — `sameAs`·label·scheme membership | 기존 term 우선 원칙 | 차단 |
| `FR-SEM-005` `MUST` | `requirements.md:66` — “source binding·credential·승인 증거를 분리” | `verification-plan.md:132,136-137` — binding·credential·host·연락처 | 승인 증거의 공개 RDF 분리 | 차단 |
| `FR-SEM-006` `MUST` | `requirements.md:67` — “DCAT RDF를 DSP wire message와 합치지 않아야” | `verification-plan.md:141-143` — candidate 경계·digest·재투영 | RDF와 wire 혼합 거부 | 차단 |
| `FR-SEM-007` `MUST` | `requirements.md:68` — UTF-8→preflight→routing→SHACL 순서, 세 digest, `CT-SEM-REPORT-001` | `verification-plan.md:121,138-139` — bundle·UTF-8·diagnostic | 전체 순서·세 digest, 약속한 시험 ID 부재 | 차단 |
| `FR-SEM-008` `MUST` | `requirements.md:69` — 상태와 metadata 확인·구현시험·조항 crosswalk 증거 분리 | `verification-plan.md:159-160` — schema·source evidence·금지 claim | 상태와 세 증거 종류의 분리 | 차단 |
| `FR-SEM-009` `MUST` | `requirements.md:70` — target path 또는 명시적 `unmapped`·`not-published` | `verification-plan.md:172,174` — 누락 0건·loss class·reverse rule | 정확히 하나의 mapping 결정 | 차단 |
| `FR-SEM-010` `MUST` | `requirements.md:71` — 개인정보 포함 compliance record와 public projection 분리 | `verification-plan.md:149,175` — 개인정보 scan·DB 자동승격 금지 | compliance record 유형 | 차단 |
| `FR-SEM-011` `MUST` | `requirements.md:72` — 시험 ID `SHACL-DIFF-001` | `verification-plan.md:167-168,192` — `SHACL-DIFF-001A/B`만 존재 | parent ID와 A/B lane의 exact 추적 | 차단 |
| `FR-DSP-001` `MUST` | `requirements.md:88` — `.well-known` 경로와 지원 version·binding 선택 | `verification-plan.md:82` — endpoint 조회·미지원 version 거부 | 정확한 경로, binding 선택 | 차단 |
| `FR-PLT-002` `MUST` | `requirements.md:91` — Provider 권한·license·Distribution·DataService·source binding·회수 | `verification-plan.md:85` — DataService 제외 | DataService | 차단 |
| `FR-PLT-004` `MUST` | `requirements.md:93` — entitlement·token·job·ACL 및 Offering·Agreement·Transfer·Request scope | `verification-plan.md:87` — Agreement subscription·Transfer token·snapshot | entitlement·job·ACL, Offering·Request scope | 차단 |
| `FR-PLT-005` `MUST` | `requirements.md:94` — 세 provisioning trigger 승인·기록 | `verification-plan.md:88` — Agreement trigger만 검사 | Request ACK·첫 payload/TTL trigger와 기록 | 차단 |
| `FR-PLT-006` `MUST` | `requirements.md:95` — command scope·대상 external ID·응답 ID 저장 | `verification-plan.md:89` — create 응답 유실·중복·restart | scope·수정/삭제 대상 ID·응답 ID 저장 | 차단 |
| `FR-PLT-009` `SHOULD` | `requirements.md:98` — organization·tenant·service identity | `verification-plan.md:92` — 가입·조직변경·revoke·탈퇴 | tenant·service identity별 수명주기 | 중요 |
| `FR-PLT-011` `MUST` | `requirements.md:100` — Agreement “만료·철회·해지” | `verification-plan.md:94` — 만료만 검사 | 철회·해지 | 차단 |
| `FR-ID-001` `MUST` | `requirements.md:101` — 참가자 식별과 Connector 요청 인증 | `verification-plan.md:95` — invalid issuer·signature·audience·replay | 유효 인증 성공과 identity binding | 차단 |
| `FR-ID-002` `SHOULD` | `requirements.md:102` — 기관 자격 credential을 정책 입력으로 검증 | `verification-plan.md:96` — revoked credential 거부 | 유효 credential의 정책 입력·allow | 중요 |
| `FR-AUD-001` `MUST` | `requirements.md:104` — 상관관계에 platform external resource 포함 | `verification-plan.md:98` — participant→negotiation→Agreement→transfer→source request | platform external resource | 차단 |
| `FR-AUD-002` `MUST` | `requirements.md:105` — “승인·정책판정·접근·철회·파기” | `verification-plan.md:99` — 승인·철회·파기 workflow | 정책판정, 접근 증거 | 차단 |
| `FR-OPS-002` `MUST` | `requirements.md:107` — asset·adapter별 연락처 runbook | `verification-plan.md:101` — source outage drill·중단·복구 | asset×adapter coverage, 연락처 | 차단 |

### 7.3 전 시험 ID 대조

- **(Verified)** 활성 시험표는 기능 추적 51행, 혼합 추적 45행, 국내 Gate 32행으로 합계 128행임 — `SRC-AUD-014`, `docs/03-plan/verification-plan.md:51-101,109-153,159-190`
- **(Verified)** 범위형 ID 전개 결과는 143회 출현, 고유 designator 142개임
- **(Verified)** `CT-KR-CRS-001`은 두 번 출현하고 `CT-TRN-001`은 결번으로 선언되어 제외됨
- **(Unverified)** wildcard family `CT-SHACL-INVALID-*`는 개수 산정 불가
- **(Verified)** 시험 없는 FR과 존재하지 않는 FR을 가리키는 시험은 각각 0건임
- **(Verified)** FR 비연결 시험 43개는 NFR에 정상 연결된 13개와 FR·NFR 모두 비연결인 30개로 분리됨

| 구분 | 시험 ID | 판정 |
| --- | --- | --- |
| NFR 전용 13개 | `ST-TLS-001`, `ST-ZONE-001`, `ST-SECRET-001`, `CT-PROFILE-001`, `FT-IDEMP-001`, `FT-BULKHEAD-001`, `FT-CONSIST-001`, `OP-TRACE-001`, `DQ-FRESH-001`, `OP-CHANGE-001`, `CT-PORT-001`, `OP-KEY-001`, `ST-DOS-001` | 공백 아님 |
| FR·NFR 비연결 30개 중 1~10 | `CT-KR-STD-005`, `CT-KR-CLAIM-001`, `CT-KR-BLINDSPOT-003`, `PDP-REAL-001`, `PDP-SOURCE-001`, `SHACL-DIFF-001A`, `SHACL-DIFF-001B`, `ISO19115-TECH-001`, `KS-XML-001`, `KS-XML-002` | 요구사항 연결 없음 |
| FR·NFR 비연결 30개 중 11~20 | `MAP-INVENTORY-001`, `RDF-SEC-001`, `RT-SPATIAL-AXIS-001`, `RT-SPATIAL-ACCURACY-001`, `GEO-LIT-001`, `GEO-LIT-COVERAGE-001`, `ISO-DQV-001`, `XSD-COVERAGE-001`, `DEP-INTEGRITY-001`, `NET-REGISTRY-001` | 요구사항 연결 없음 |
| FR·NFR 비연결 30개 중 21~30 | `CRS-REGISTRY-001`, `AUTH-REG-001`, `AUTH-REG-002`, `AUTH-REG-003`, `AUTH-REG-004`, `AUTH-REG-005`, `AUTH-REG-006`, `RELEASE-GATE-001`, `STD-STATUS-SNAPSHOT-001`, `CLAIM-AUTH-001` | 요구사항 연결 없음 |

- **(판정)** `SHACL-DIFF-001A/B`는 `FR-SEM-011`의 parent ID 불일치와 겹치는 차단 공백임
- **(판정)** 나머지 28개는 시험 목적은 있으나 요구사항 근거가 없어 관찰이며, 대응 FR 또는 NFR의 승인·연결과 실행 증거가 필요

## 8. 감사자가 가장 먼저 닫아야 한다고 본 5건

감사자의 우선순위 판단을 원문 순서와 심각도로 유지한다. 상태: `Inferred`.

1. **`C3-01` P0 로컬 판정 정본 부재**
   - `p0-control-plane-verification.md:6`이 지목한 판정 파일이 없어 현재 P0 판정을 재현하거나 승인할 기준점이 없음
   - 실제 P0 검증 실행과 판정 파일 검증이 선행되어야 하며, 이번 작업에서는 파일을 만들지 않음
2. **`A-05` 릴리스 후보(Release Candidate, RC) 1 공개 라이선스 미승인**
   - `PENDING-OWNER-APPROVAL`은 기술 적합성과 무관하게 발간·재사용을 차단
   - 소유자·법무 승인과 lock 재생성이 선행되어야 함
3. **`A-06` 통제어휘 권위원 미승인**
   - registry가 식별자를 candidate 상태로 둠
   - 권위원·변경·폐지 절차가 확정되지 않으면 `A-07`의 `/id`·`/scheme` namespace도 안정적으로 열 수 없음
4. **`A-08` 운영 실데이터 mapping coverage 미측정**
   - register가 `P0`와 `currentlyBlocksRelease=true`를 명시
   - 합성 fixture 통과만으로 실제 통합채널·원천 플랫폼의 묵시적 유실을 배제할 수 없음
5. **E축 `MUST` 요구사항 부분 검증 28건**
   - 검증 계획의 자체 종료조건과 직접 충돌
   - `FR-SEM-007`의 누락 시험 ID·실행 순서·digest와 `FR-PLT-004~006`의 권한·trigger·멱등 범위부터 정상·실패 시험 보강 필요

## 9. 감사 입력의 모순과 공백

### 9.1 수치와 명칭

- **(모순)** A축 지정 표현의 세부합은 1,133회이나 원문 총계는 1,004회이며 조정 산식이 없음 — 정확한 총회수 판정 불가
- **(공백)** 작업 지시는 4축이라고 부르지만 입력과 요구 수치는 A축부터 E축까지의 다섯 축임 — 이 문서는 다섯 축을 모두 유지
- **(공백)** `CT-SHACL-INVALID-*`의 wildcard 개수가 정해지지 않아 고유 시험 총수의 완전 산정 불가

### 9.2 재현성과 식별자

- **(공백)** 감사 입력은 제외에 사용한 기존 미결 등록부의 파일·ID 목록을 제공하지 않아 제외 절차 재현 불가
- **(공백)** 감사 입력에는 기준 commit이나 스냅샷 식별자가 없음. 감사일 2026-08-02와 66개 Markdown 범위는 작업 지시로 보완됐으나 commit 재현은 불가
- **(공백)** C축 표에는 개별 ID가 없고, `C3-01`만 우선순위 절에서 확인됨
- **(공백)** B·C축 표에는 닫는 방법이 없음. 이 문서의 해당 열은 `Inferred`로 분리함
- **(공백)** 입력의 일부 경로는 `profiles/...`, 같은 문서 `:행`과 같이 축약됨. 이 문서는 문맥으로 복원한 전체 저장소 경로를 사용

## 10. 미확인 사항과 결정 요청

아래 항목은 문서 편집만으로 닫을 수 없다. 외부 승인, 실제 배포, 운영 데이터 확보 또는 시험 실행과 승인 증거가 필요하다. 이번 작업은 해소가 아니라 미등록 상태를 등록 상태로 바꾸는 범위다.

| ID | 미확인 사항 | 영향 | 확인 담당 | 기한 | 결정 또는 종료 조건 |
| --- | --- | --- | --- | --- | --- |
| `OPEN-AUD-01` | A-05 RC.1 공개 라이선스가 `PENDING-OWNER-APPROVAL` | RC.1 발간·재사용 차단 | 미정 | 미정 | [차단] 소유자·법무 승인, `LICENSE.md`·`NOTICE.md`·artifact lock 재생성, 기관 서명 증거 확보 |
| `OPEN-AUD-02` | A-06 통제어휘 권위원과 운영 절차 미승인 | registry와 식별자 운영 정본 승격 차단 | 미정 | 미정 | [차단] 권위원·판 관리·폐지·대체·변경·철회 절차 승인과 candidate registry 승격 |
| `OPEN-AUD-03` | A-07 `/id`·`/scheme` namespace 미배포와 404 | 식별자·어휘 IRI 원격 검증 차단 | 미정 | 미정 | [차단] `/id/concept`, `/id/metric`, `/scheme` 실제 배포와 DNS·TLS·협상·tombstone 원격 검증 통과 |
| `OPEN-AUD-04` | A-08 운영 실데이터 mapping coverage 미측정 | release 차단, 묵시적 유실 판정 불가 | 미정 | 미정 | [차단] 운영 모집단 또는 승인 층화표본에 `REL-MAP-001` 실행 후 coverage·유실·거부사유 분포 증거 승인 |
| `OPEN-AUD-05` | A-09 상용 SLA 운영 증거 부재 | 상용 가용성·오류예산·service credit 재현 불가 | 미정 | 미정 | [차단] capacity profile 승인, 30일 canary·failover 실행, 월별 SLO·service-credit 산출물 등록 |
| `OPEN-AUD-06` | C3-01 `.local/p0/local-verification.json` 부재 | P0 판정 재현·승인 차단 | 미정 | 미정 | [차단] 같은 source에서 P0 검증 원장 전 단계를 실행하고 로컬 판정 파일·digest·승인 증거 검증 |
| `OPEN-AUD-07` | E축 `MUST` 부분 검증 28건 | 발간·실증 완료 판정 차단 | 미정 | 미정 | [차단] 각 요구의 빠진 정상·실패 축을 구현·실행하고 연결 시험 전부 통과 증거 승인 |
| `OPEN-AUD-08` | E축 FR·NFR 비연결 시험 30개 | 요구 근거 없는 시험 28개와 차단 공백 중복 2개의 추적 불완전 | 미정 | 미정 | [차단] `SHACL-DIFF-001A/B`의 parent 추적을 복구하고, 나머지 28개 대응 FR·NFR을 승인·연결한 뒤 시험 실행 증거 등록 |
| `OPEN-AUD-09` | 2026-08-03 생성 조사 보고서 6개의 내부 일관성 미검증 | 이 문서의 집계를 현재 저장소 전수 상태로 확장 불가 | 미정 | 미정 | 차기 감사에서 1절의 6개 문서를 포함해 A축부터 E축까지 검사하고 결과·감사 스냅샷을 등록 |

## 11. 출처

웹 자료는 사용하지 않았다. URL 열은 저장소 내부 상대 경로이며, 페이지 개념은 모두 `해당 없음`으로 표기한다. 감사 출처 확인일은 2026-08-02이고, 작성 중 추가된 2개 문서의 확인일은 2026-08-03이다.

| SRC-ID | 발행기관 | 문서명 | version 또는 상태 | 발행일 | URL | 확인일 | 페이지 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SRC-AUD-001` | 발행기관 미표기 | codex-internal-audit.md | 감사 입력, 상태 미표기 | 2026-08-02 | [저장소 경로](../../.local/research-input/codex-internal-audit.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-002` | 국토교통 데이터 스페이스 저장소 | 데이터 스페이스 활성화 실태 국제 조사 | Draft | 2026-07-30 | [저장소 경로](dataspace-landscape-survey.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-003` | 국토교통 데이터 스페이스 저장소 | 국토교통 7대 분야 참여 유인과 강제 장치 분석 | Draft | 2026-07-30 | [저장소 경로](sector-adoption-levers.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-004` | 국토교통 데이터 스페이스 저장소 | Platform Bridge PoC 후보 목록 | Draft | 2026-07-11 | [저장소 경로](../03-plan/poc-candidate-shortlist.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-005` | 국토교통 데이터 스페이스 저장소 | artifact-lock.json | profile 1.0.0-rc.1 | 2026-07-12 | [저장소 경로](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/artifact-lock.json) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-006` | 국토교통 데이터 스페이스 저장소 | registry-metadata.json | 1.0.0-rc.1, candidate-pending-authority-approval | 2026-07-13 | [저장소 경로](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/vocabulary/registry-metadata.json) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-007` | 국토교통 데이터 스페이스 저장소 | MOLIT DCAT-AP namespace 배포와 검증 | 배포 가능한 소스코드, 기관 배포 전 | 2026-07-13 | [저장소 경로](../04-implementation/stable-namespace-operations.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-008` | 국토교통 데이터 스페이스 저장소 | korean-interoperability-register.json | profile 1.0.0-rc.1, asOf 2026-07-12 | 2026-07-12 | [저장소 경로](../../standards/korean-interoperability-register.json) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-009` | 국토교통 데이터 스페이스 저장소 | commercial-readiness-register.v1.json | schema molit.commercial-readiness-register/1 | 2026-07-14 | [저장소 경로](../../governance/commercial-readiness-register.v1.json) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-010` | 국토교통 데이터 스페이스 저장소 | EDC 로컬 상호운용 토폴로지 | 이전 실행 결과 보존, 현재 source 재실행 전 | 2026-07-13 | [저장소 경로](../04-implementation/edc-local-interoperability.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-011` | 국토교통 데이터 스페이스 저장소 | local-interoperability-status.v1.json | production-readiness-blocked | 2026-07-14 | [저장소 경로](../../evidence/edc/local-interoperability-status.v1.json) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-012` | 국토교통 데이터 스페이스 저장소 | EDC 기반 CaaS·DSaaS 구성 설계 | 구현 기준선 확정, 실운영 인프라·기관 승인 미확정 | 2026-07-13 | [저장소 경로](../02-architecture/edc-caas-dsaas-architecture.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-013` | 국토교통 데이터 스페이스 저장소 | DSaaS 제어 평면 | 상태 미표기 | 발행일 미표기 | [저장소 경로](../04-implementation/dsaas-control-plane.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-014` | 국토교통 데이터 스페이스 저장소 | 검증 계획 | Draft | 2026-07-11 | [저장소 경로](../03-plan/verification-plan.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-015` | 국토교통 데이터 스페이스 저장소 | 위험 대장 | Draft | 2026-07-11 | [저장소 경로](../03-plan/risk-register.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-016` | 국토교통 데이터 스페이스 저장소 | 메타데이터·정책 프로필 | Metadata Working Draft 구현·Policy Draft | 2026-07-11 | [저장소 경로](../02-architecture/metadata-and-policy-profile.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-017` | 국토교통 데이터 스페이스 저장소 | Release 차단 Gate 현황 | Active / release blocked | 2026-07-13 | [저장소 경로](../03-plan/release-gate-status.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-018` | 국토교통 데이터 스페이스 저장소 | 국내 표준 상호운용성 및 blind spot 검증 | Working Draft 검증기준 | 2026-07-12 | [저장소 경로](korean-standards-interoperability.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-019` | 국토교통 데이터 스페이스 저장소 | manifest.json | 1.0.0-rc.1 candidate | 발행일 미표기 | [저장소 경로](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/manifest.json) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-020` | 국토교통 데이터 스페이스 저장소 | 거버넌스·운영 원칙 | Draft | 2026-08-01 | [저장소 경로](../02-design/governance-and-operating-principles.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-021` | 국토교통 데이터 스페이스 저장소 | Provider 권한 레지스트리 | Working Draft / 외부 권한증거 대기 | 2026-07-12 | [저장소 경로](../02-architecture/provider-authority-registry.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-022` | 국토교통 데이터 스페이스 저장소 | MOLIT DCAT-AP 1.0.0-rc.1 구현 해설 | 구현자용 비규범 해설 | 2026-07-13 | [저장소 경로](../04-implementation/molit-dcat-ap-implementation-guide.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-023` | 국토교통 데이터 스페이스 저장소 | tenant 격리 구현 | 상태 미표기 | 발행일 미표기 | [저장소 경로](../04-implementation/tenant-isolation.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-024` | 국토교통 데이터 스페이스 저장소 | P0 운영 제어면 구현과 검증 | 기준일 2026-07-14 | 발행일 미표기 | [저장소 경로](../04-implementation/p0-control-plane-verification.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-025` | 국토교통 데이터 스페이스 저장소 | 초기 유즈케이스·KPI | Draft | 2026-08-01 | [저장소 경로](../03-plan/initial-usecases-and-kpi.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-026` | 국토교통 데이터 스페이스 저장소 | 데이터 스페이스 개념·용어 감사 | Draft | 2026-07-30 | [저장소 경로](dataspace-concept-audit.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-027` | 국토교통 데이터 스페이스 저장소 | 국토교통 통합 데이터 스페이스 기획보고서 기술 검토 | Review | 2026-07-11 | [저장소 경로](planning-report-technical-review.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-028` | 국토교통 데이터 스페이스 저장소 | MOLIT 메타데이터를 EDC Offering으로 게시하는 경계 | Adapter 구현 완료, 기관 운영 Connector 실증 전 | 2026-07-13 | [저장소 경로](../04-implementation/edc-v4-publication-adapter.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-029` | 국토교통 데이터 스페이스 저장소 | 요구사항 기준선 | Draft | 2026-07-11 | [저장소 경로](../02-architecture/requirements.md) | 2026-08-02 | 해당 없음 |
| `SRC-AUD-030` | 국토교통 데이터 스페이스 저장소 | 기존 허브의 데이터 스페이스 연계 역량 조사 | Draft | 2026-08-03 | [저장소 경로](hub-capability-assessment.md) | 2026-08-03 | 해당 없음 |
| `SRC-AUD-031` | 국토교통 데이터 스페이스 저장소 | 기존 플랫폼 섭외 가능성 조사 | Draft | 2026-08-03 | [저장소 경로](hub-recruitment-feasibility.md) | 2026-08-03 | 해당 없음 |
