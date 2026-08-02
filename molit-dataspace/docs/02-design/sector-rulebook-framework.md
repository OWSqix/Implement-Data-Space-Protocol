# 교통모빌리티 분야 규약 골격

작성일: 2026-08-01  
작성 기준: 설계 인터뷰 D-08·11·14·DEF-05  
상태: Draft

## 1. 목적과 판정

이 문서는 교통모빌리티 분야 데이터 스페이스 규약의 네 요소를 회원, payload, 유즈케이스, 요금·정산으로 고정한다. payload 표준과 운영 주체는 미결정 상태로 남기고 분야 DSGA가 승인할 절차만 정의한다.

- 판정: 교통모빌리티를 첫 분야 규약 골격으로 채택
- 공통 기반: 참가자 신뢰, Connector·프로토콜 profile, 연합 Catalog, 공간 참조, 공통 정책 어휘
- 분야 책임: 회원 세부규칙, payload 표준, 유즈케이스 backlog, 요금·정산 규칙
- 제외: 기관 지명, 정산 payload 필드 발명, 수치 요금 확정

[국가 프레임 아래 2계층 구성](../01-research/dataspace-topology-single-vs-sectoral.md#51-국가-프레임-아래의-2계층-구성)의 네 구성요소를 재정의하지 않고 이 규약의 참조 경계로 사용한다. 규칙 제정과 운영의 분리는 [ADR-0007 §1](../adr/0007-governance-function-separation.md#1-목적과-결정-요약)을 따른다.

## 2. 규약 권한과 역할

IDSA Rulebook Release 2026-1에서 기술 역할은 Participant와 데이터 스페이스 거버넌스 기관(Data Space Governance Authority, DSGA)이다.

Provider와 Consumer는 계약별 기능으로 취급한다. 근거: [IDSA Rulebook 역할](https://kb.internationaldataspaces.org/external/rulebook/005_Roles/), 확인일 2026-07-30

| 역할 | 규약상 책임 | 비책임 | 상태 |
| --- | --- | --- | --- |
| 공통 기반 DSGA | 공통 참가·신뢰·프로토콜·공간 참조 제약 승인 | 분야 payload와 요금 수치 승인 | 후보 — ADR-0007 Proposed |
| 교통모빌리티 DSGA | 분야 회원 세부규칙, payload, 유즈케이스, 요금·정산 규칙 승인 | 공통 profile 개정과 서비스 운영 | 주체 미정 |
| Participant | 승인된 경로와 계약에 따라 Provider·Consumer 기능 수행 | 규칙 제정과 다른 Participant의 적법성 보증 | 주체별 가입 전 미확정 |
| 운영 주체 | 승인 규칙을 시스템 상태·계약·감사 기록으로 집행 | DSGA 규칙 제정 | 주체 미정 |

## 3. 네 요소 골격

| 요소 | 규약 입력 | 승인 산출물 | 현재 판정 |
| --- | --- | --- | --- |
| 회원 | 기관 증거, 경로, 참가 등급, 허용 역할 | 분야 membership rule과 경로 binding | [참가자 온보딩·보증 설계](../02-architecture/participant-onboarding-and-assurance.md) 참조 |
| payload | 정산 명세·BIS/BMS·표준 노드링크의 실물 필드와 version | 채택·재사용·확장 결정, schema와 migration rule | D-11 미결정·DEF-05 |
| 유즈케이스 | 수혜자, 가치교환, 자산 경계, 권리 판정, KPI·중단조건 | 승인 backlog와 release Gate | [주요 사용사례](../02-architecture/requirements.md#3-주요-사용사례)에서 후보를 가져옴 |
| 요금·정산 | 재원 단계, 비용 원가, 계약, 세금·환불·대사 책임 | 요금표, 정산주기, 원장 책임과 분쟁절차 | [단계 자립 재원 원칙](governance-and-operating-principles.md#3-단계-자립-재원-원칙) 참조 |

## 4. 회원 규칙 경계

회원 판정은 조직 이름만으로 완료하지 않는다. 분야 DSGA는 공통 기반의 참가 판정 ID를 입력으로 받아 교통모빌리티 유즈케이스의 역할과 경로를 추가로 승인한다.

1. 공통 기반은 기관 등록, 비즈니스 적격성, 경로 기반 등급과 credential 상태를 판정한다.
2. 분야 DSGA는 유즈케이스별 Provider·Consumer 기능, 제출 의무와 허용 자산 범위를 판정한다.
3. 운영 주체는 두 판정이 모두 유효한 경우에만 분야 Catalog·협상 경로를 연다.
4. 어느 판정이든 만료·철회되면 새 Agreement와 Transfer를 차단하고 재평가 상태를 기록한다.

## 5. Payload 표준 결정 Gate

D-11의 **원칙 후보**는 payload 표준을 기존 표준 조사 뒤 채택하고, 규약 골격 단계에서 필드나 code를 새로 만들지 않는다는 것이다. 분야 DSGA 승인 전에는 확정 규칙이나 구현 기준선으로 사용하지 않는다.

| Gate | 필요한 입력 | 통과 증거 | 실패 처리 |
| --- | --- | --- | --- |
| 실물 조사 | 교통카드 정산 명세, BIS/BMS 교환항목, 표준 노드링크 자료 | 출처·version·필드·관계 inventory | DEF-05 유지 |
| 기존 표준 대조 | 유즈케이스 필수 필드와 기존 표준 mapping | 일치·변환·손실 항목 표 | 손실 항목 미승인 시 제외 |
| 권리·민감도 판정 | 필드별 Provider 권한과 데이터 등급 | 자산 판정 ID와 허용 경로 | 미확정 필드 제외 |
| 분야 승인 | schema, identifier, version, migration, validation rule | 분야 DSGA 결정 기록 | 승인 전 구현 기준선 사용 금지 |

DEF-05의 선행 조건은 정산 필드 실물 조사 완료다. 이월 항목의 단일 조회 지점은 [DSSC 갭 등록 §3.2](../01-research/dssc-gap-register.md#32-이월-색인-정본)다.

## 6. 유즈케이스 등재

분야 backlog의 각 행은 다음 값을 가진다.

| 항목 | 기록 기준 |
| --- | --- |
| 식별자·상태 | 후보, 승인, 실증, 중단, 종료를 구분 |
| 참여 기능 | 계약별 Provider·Consumer와 운영 주체를 분리 |
| 가치·업무 경계 | 수혜자, 제출·조회·정산 동작과 제외 자산을 명시 |
| 데이터·경로 | 자산 판정 ID, payload version, 참가 등급을 연결 |
| 정책·계약 | 목적·수신자·기간, 법적 근거, Agreement 관계를 연결 |
| 결과 판정 | KPI, 중단조건, 검증 증거와 결정권자를 기록 |

첫 등재 후보와 KPI는 [초기 유즈케이스·KPI](../03-plan/initial-usecases-and-kpi.md)에서 관리한다. 후보 문서의 존재만으로 분야 DSGA 승인을 대신하지 않는다.

## 7. 요금·정산 자리

요금은 데이터 이용조건, 플랫폼 구독료와 유상 데이터 상품 결제를 분리해 기록한다. Marketplace와 결제 범위의 정본은 [상용 CaaS·DSaaS 기준선 §4.1](commercial-caas-dsaas-baseline.md#41-제품별-책임)과 상용 준비 register다.

| 구분 | 원장·계약 경계 | 규약이 확정할 항목 |
| --- | --- | --- |
| 공개 데이터 이용조건 | 기존 license와 DSP Offer | 출처표시·접근절차·quota |
| 관리형 서비스 구독 | CaaS·DSaaS 운영 계약 | 과금 단위, SLA, 변경·해지 |
| 유상 데이터 상품 | Marketplace 주문·결제 원장 | 가격, 세금, commission, refund, reconciliation |
| 정산 증적 | 데이터 계약·감사 ID·승인된 notary 범위 | 제출 주기, 대사 규칙, 이의·분쟁 절차 |

## 8. 준공영제 정산 예시

다음 예시는 골격 검증용이며 payload 표준이나 법적 의무의 승인 문안이 아니다.

| 순서 | 주체 | 입력·동작 | 산출물·실패 처리 |
| --- | --- | --- | --- |
| 1 | 운수사 Participant | 승인된 명세 version으로 운행·수입 정산 자료 제출 | 제출 receipt와 공통 감사 ID; schema 실패 시 접수 거부 |
| 2 | 정산 운영 주체 | 감사 ID로 제출 존재와 계약 범위 대조 | 대사 결과; 당사자·자산 식별정보는 notary record에 넣지 않음 |
| 3 | 지자체 Consumer 기능 | 승인 권한으로 정산 결과와 근거 열람 | 열람 사건; 범위 밖 감사·분쟁은 건별 법적 근거 확인 |
| 4 | 분야 DSGA | 반복 불일치와 규칙 공백 검토 | 규약 개정 후보; 개별 지급 판정은 수행하지 않음 |

## 9. 검증과 변경 기록

규약 개정은 요소별 승인자, 입력 version, 변경 사유, 적용일과 rollback 조건을 기록한다. 자동 검증은 schema·참조·상태 전이를 확인하고, 사람 검수는 다음 경계를 대조한다.

- 공통 기반과 분야 DSGA의 규칙 제정 범위가 겹치지 않음
- payload 미결정 상태를 구현 완료로 표기하지 않음
- Provider·Consumer 기능을 고정 기관 역할로 바꾸지 않음
- 요금 원장과 notary 증적을 하나의 중앙 거래 원장으로 합치지 않음
