# DSSC 빌딩블록 갭 등록부

작성일: 2026-08-01  
작성 기준: DSSC Blueprint v3.0·저장소 대조 2026-07-30  
상태: Draft

## 1. 목적과 스냅샷 판정

이 문서는 DSSC Blueprint v3.0의 조직 8개·기술 9개 빌딩블록을 저장소 설계와 대조한 시점 스냅샷이다. 블록의 상세·부분 판정은 기관 승인이나 운영 준비 완료를 뜻하지 않는다.

| 구분 | 상세 설계 있음 | 부분 | 공백 | 합계 |
| --- | --- | --- | --- | --- |
| 조직 | 1 | 7 | 0 | 8 |
| 기술 | 4 | 5 | 0 | 9 |
| 전체 | 5 | 12 | 0 | 17 |

- 블록 개수와 범위의 근거: [개념 감사 §3.4](dataspace-concept-audit.md#34-dssc-blueprint)
- 조직 블록명 근거: [DSSC Business pane](https://blueprint.dssc.eu/?pane=business), 확인일 2026-07-30
- 기술 블록명 근거: [DSSC Technical pane](https://blueprint.dssc.eu/?pane=technical), 확인일 2026-07-30
- 증거 규율: 개별 블록명은 위 확인일의 공식 pane을 기준으로 기록했고, 기관·법적 권한·실자산 운영 상태는 근거가 없으면 `Unverified`로 유지

## 2. 17개 블록 대조

| 번호·블록 | 상태 | 저장소 근거 | 남은 공백 | 결정 매핑 | 확인 상태 |
| --- | --- | --- | --- | --- | --- |
| ① Business Model | 부분 | [실태 조사 §§5~6](dataspace-landscape-survey.md#5-지속-사례의-유지-동력), [상용 기준선 §§4.1·5.3](../02-design/commercial-caas-dsaas-baseline.md#41-제품별-책임) | 승인된 비용 분담·지속 재원·가격정책 통합안 부재, COM-BIL-001·COM-SLA-001 open | D-14·15, DEF-08 | 내부 대조 2026-07-30; 사업모델 승인 `Unverified` |
| ② Use Case Development | 부분 | [요구사항 §3](../02-architecture/requirements.md#3-주요-사용사례), [실증 로드맵](../03-plan/pilot-and-roadmap.md) | 업무 여정·가치교환·결과 KPI가 결합된 승인 backlog 부재 | D-08·13·20, DEF-06 | 내부 대조 2026-07-30; 승인 backlog `Unverified` |
| ③ Data Space Offerings | 상세 설계 있음 | [Offering 온보딩](../02-architecture/offering-onboarding-lifecycle.md), [정책 profile §§7~9](../02-architecture/metadata-and-policy-profile.md#7-data-product-passport) | 실자산 대부분 unverified, 운영 적격성은 외부 authority 판정 | D-09·11 | 내부 대조 2026-07-30; 실자산 적격성 `Unverified` |
| ④ Intermediaries and Operators | 부분 | [프로젝트 헌장 §6](../00-project-charter.md#6-책임-모델), [상용 기준선 §4.1](../02-design/commercial-caas-dsaas-baseline.md#41-제품별-책임) | 실제 운영기관·중립성·조달·SLA·배상·exit 미정 | D-17, DEF-01 | 내부 대조 2026-07-30; 기관 배치 `Unverified` |
| ⑤ Organisational Form and Governance Authority | 부분 | [ADR-0007](../adr/0007-governance-function-separation.md), [구성 연구 §6](dataspace-topology-single-vs-sectoral.md#6-거버넌스-기능과-권한-계층) | Proposed 상태, 법인·법적 형태·권한 주체 미정 | D-18, DEF-01·02 | 내부 대조 2026-07-30; KAIA 위임 성격 `Unverified` |
| ⑥ Participation Management | 부분 | [DSaaS §5~6](../04-implementation/dsaas-control-plane.md#5-참여기관-식별자와-connector-plan), [참가자 설계](../02-architecture/participant-onboarding-and-assurance.md) | 승인기관 Adapter·회비·이의·offboarding 보존 수치 미정 | D-03·04·05·06·07, DEF-04·07 | 내부 대조 2026-07-30; 승인기관 절차 `Unverified` |
| ⑦ Regulatory Compliance | 부분 | [법제 기준선 §3](standards-and-legal-baseline.md#3-국내-법제-기준선), [권리 inventory](source-and-rights-inventory.md) | 법률의견·흐름별 적용성·인증·예외권한과 운영 증거 부재 | D-12·20, DEF-03 | 내부 대조 2026-07-30; 법률 적용 판정 `Unverified` |
| ⑧ Contractual Framework | 부분 | [요구사항 §4](../02-architecture/requirements.md#4-기능-요구사항), [온보딩 §5](../02-architecture/offering-onboarding-lifecycle.md#5-dsp-계약과-플랫폼-권한의-연결) | 회원약정·데이터 계약·SLA·DPA와 책임·분쟁 조항 미정 | D-02·09·19, DEF-03 | 내부 대조 2026-07-30; 법문 `Unverified` |
| ⑨ Identity & Attestation Management | 부분 | [운영 신원 §§1~5](../04-implementation/operational-identity.md), [플랫폼 계약 §6](../02-architecture/platform-interface-contract.md#6-identity-binding-계약) | DCP issuer·status·trust anchor·credential profile 미배치 | D-07, DEF-04 | 내부 대조 2026-07-30; 운영 trust service `Unverified` |
| ⑩ Trust Framework | 부분 | [보안 설계 §2](../02-architecture/security-trust-and-operations.md#2-신뢰-모델), [Provider 권한 Registry](../02-architecture/provider-authority-registry.md) | 승인 Provider entry·기관 trust anchor·production verifier 부재 | D-03·04·05·16 | 내부 대조 2026-07-30; 운영 trust anchor `Unverified` |
| ⑪ Access & Usage Policies Enforcement | 부분 | [정책 profile §§7.1~9](../02-architecture/metadata-and-policy-profile.md#71-필수-정책-필드), [보안 설계 §7](../02-architecture/security-trust-and-operations.md#7-정책-평가) | operand 승인·통합 PDP/PEP 부재, 전달 후 의무 기계집행 불가 | D-09·12 | 내부 대조 2026-07-30; 운영 evaluator `Unverified` |
| ⑫ Data Models | 부분 | [metadata §2·§4·§6](../02-architecture/metadata-and-policy-profile.md), [구현 해설](../04-implementation/molit-dcat-ap-implementation-guide.md) | 분야 payload entity·field·relation·version 모델 부재 | D-10·11, DEF-05 | 내부 대조 2026-07-30; payload 표준 `Unverified` |
| ⑬ Data Exchange | 상세 설계 있음 | [목표 아키텍처 §§5·7·12](../02-architecture/target-architecture.md), [Adapter §§5~14](../02-architecture/integration-adapters.md) | 운영 구현은 PULL 중심, PUSH·SUSPEND·COMPLETE·외부 상호운용 증거 잔여 | D-12·13 | 내부 대조 2026-07-30; 외부 상호운용 `Unverified` |
| ⑭ Provenance, Traceability & Observability | 상세 설계 있음 | [metadata §4·§7](../02-architecture/metadata-and-policy-profile.md), [보안 설계 §§8·10](../02-architecture/security-trust-and-operations.md#8-감사) | 외부 OTLP·WORM 운영제품과 notary 운영자·열람·보존 미정 | D-01·02 | 내부 대조 2026-07-30; 운영제품·주체 `Unverified` |
| ⑮ Data, Services, and Offerings Descriptions | 상세 설계 있음 | [metadata §§2·4~7](../02-architecture/metadata-and-policy-profile.md), [DCAT-AP 해설](../04-implementation/molit-dcat-ap-implementation-guide.md) | profile은 Candidate, stable namespace·실물 crosswalk 외부 승인 잔여 | D-10 | 내부 대조 2026-07-30; 기관 승인 `Unverified` |
| ⑯ Publication and Discovery | 상세 설계 있음 | [온보딩 §§2~4](../02-architecture/offering-onboarding-lifecycle.md), [Discovery Bridge](../04-implementation/discovery-bridge.md) | 공식 원천 API·stable ID·서명·운영 crawl·delete 증거 잔여 | D-03·04·05 | 내부 대조 2026-07-30; 운영 연합 증거 `Unverified` |
| ⑰ Value Creation Services | 부분 | [개념 입문 §10.1](../00-concepts-primer.md#101-역할-모델의-변화), [상용 기준선 §§4.1·5.3](../02-design/commercial-caas-dsaas-baseline.md#41-제품별-책임) | 승인 portfolio·compute-to-data API·Lookup 계약·billing·SLA 부재 | D-14·15, DEF-08 | 내부 대조 2026-07-30; 서비스 portfolio 승인 `Unverified` |

## 3. 결정과 이월 색인

### 3.1 결정 D-01~20 적용 위치

| 결정 묶음 | 주 적용 문서 | 이 등록부의 관련 블록 |
| --- | --- | --- |
| D-01·D-02 | [ADR-0006](../adr/0006-selective-notary-evidence.md), EDC §5.1, 보안 §8.3 | ⑧·⑭ |
| D-03·D-04·D-05·D-06·D-07 | [참가자 온보딩·보증 설계](../02-architecture/participant-onboarding-and-assurance.md) | ⑥·⑨·⑩·⑯ |
| D-08·D-11 | [분야 규약 골격](../02-design/sector-rulebook-framework.md) | ②·③·⑫ |
| D-09·D-10 | [metadata·정책 profile](../02-architecture/metadata-and-policy-profile.md) | ③·⑪·⑫·⑮ |
| D-12·D-13 | [실증 로드맵](../03-plan/pilot-and-roadmap.md), [초기 유즈케이스·KPI](../03-plan/initial-usecases-and-kpi.md) | ②·⑦·⑪·⑬ |
| D-14·D-15·D-16·D-17·D-18·D-19·D-20 | [거버넌스·운영 원칙](../02-design/governance-and-operating-principles.md) | ①·④·⑤·⑩·⑰ |

### 3.2 이월 색인 정본

이 표가 DEF-01~08의 단일 조회 지점이다. 적용 문서는 정의를 복제하지 않고 이 절을 링크한다.

| ID | 미결정 항목 | 적용 위치 | 선행 조건 | 현재 처리 |
| --- | --- | --- | --- | --- |
| DEF-01 | 운영 법인·기관 지명 | [거버넌스·운영 원칙 §6](../02-design/governance-and-operating-principles.md#6-미결정-주체와-법문화) | 거버넌스 법인 확정·KAIA 위임 확인(OPEN-TOP-06) | 주체 미정 |
| DEF-02 | 거버넌스 법적 형태·정관 | [거버넌스·운영 원칙 §6](../02-design/governance-and-operating-principles.md#6-미결정-주체와-법문화) | KAIA 확인과 법무 참여 | 법적 형태 미정 |
| DEF-03 | 회원약정·계약 법문 | [거버넌스·운영 원칙 §6](../02-design/governance-and-operating-principles.md#6-미결정-주체와-법문화) | 법무 참여 | 원칙만 등록 |
| DEF-04 | issuer·trust anchor·status·credential profile | [참가자 설계 §7](../02-architecture/participant-onboarding-and-assurance.md#7-미결정-등록) | DSGA 체계 확정 후 후속 ADR | DCP 경계 fail-closed |
| DEF-05 | payload 표준 | [분야 규약 §5](../02-design/sector-rulebook-framework.md#5-payload-표준-결정-gate) | 정산 필드 실물 조사 완료 | 구현 기준선 미선택 |
| DEF-06 | KPI 수치 목표 | [초기 유즈케이스·KPI §5](../03-plan/initial-usecases-and-kpi.md#5-kpi-초안과-수치-결정) | 실증 착수 | 지표명·중단조건만 등록 |
| DEF-07 | 재평가 주기·자립 전환 연한 수치 | [참가자 설계 §7](../02-architecture/participant-onboarding-and-assurance.md#7-미결정-등록), [거버넌스 원칙 §3](../02-design/governance-and-operating-principles.md#3-단계-자립-재원-원칙) | 운영 정책 수립 | 수치 미기입 |
| DEF-08 | secure analysis·유상 과금 활성화 | [거버넌스 원칙 §4](../02-design/governance-and-operating-principles.md#4-서비스-portfolio-원칙), [실증 로드맵](../03-plan/pilot-and-roadmap.md) | 2차 출시 결정 | 1차 범위에서 비활성 |

## 4. 용어 대응 메모

| DSSC 관점 | 저장소에서의 경계 |
| --- | --- |
| Data Space Offering | Dataset·Offer·Distribution·DataService·private source binding의 묶음이며 후보 metadata와 구분 |
| Contractual Framework | DSP 협상 상태·Agreement·JSON 계약은 법률 계약문서와 동의어가 아님 |
| Participant | DSaaS membership ID, DSP·DCP ID와 CaaS tenant ID를 구분 |
| Provider | 원 보유기관, Publisher, Offering Provider, Connector 운영자와 Delivery Operator를 합치지 않음 |
| Governance Authority | ADR-0007의 DSGA는 Proposed이며 기관명으로 권한을 추정하지 않음 |
| Data Models | MOLIT DCAT-AP 설명 model과 실제 파일·API payload model을 구분 |
| Data Exchange | DSP는 Control Plane을 조정하고 byte·file·record·stream은 Data Plane과 Adapter가 전달 |
| Observability | 운영 telemetry와 거래 증적용 Observability Services를 구분하고 GXDCH와 동일시하지 않음 |

## 5. 갱신 규칙

블록 상태를 바꾸려면 근거 문서·절, 확인일, 승인 또는 시험 ID와 잔여 공백을 같은 행에서 갱신한다. 외부 사실을 재조회하지 못하면 기존 확인일을 새 확인일로 바꾸지 않고 `Unverified`를 유지한다.

상세 설계 판정은 운영 완료 판정으로 승격하지 않는다. 기관 승인·실자산·법률 적용·외부 상호운용 증거가 없으면 해당 공백을 닫지 않는다.
