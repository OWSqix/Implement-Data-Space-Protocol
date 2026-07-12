# ADR-0002: 원천 유지와 Adapter 기반 전달

작성일: 2026-07-11  
상태: Accepted  
결정 범위: 연구 기준선과 PoC 방향  
결정권자: 프로젝트 의뢰자

## 1. 목적과 결정 요약

원천 플랫폼을 system of record로 유지하고 승인된 Adapter로 payload를 전달하는 방식을 채택한다. 결정 범위는 연구 기준선과 PoC이며, 자산별 권리·보안·SLA가 다른 결정을 요구하면 6절의 조건에 따라 재검토한다.

국토교통 데이터는 여러 접근 방식으로 제공된다.

- REST와 파일
- 웹 맵 서비스(Web Map Service, WMS)와 웹 피처 서비스(Web Feature Service, WFS)
- stream과 기관 데이터베이스(Database, DB)

모든 데이터를 새 중앙 저장소에 복제하면 중복과 최신성 문제가 생긴다. license, 보유기간, 개인정보·공간정보 반출과 source 품질 책임도 중앙으로 이동한다.

DSP는 실제 payload 전송 프로토콜을 규정하지 않으며 Control Plane과 Data Plane을 논리적으로 구분한다. 기존 source interface를 유지하면서 DSP 계약과 transfer control을 추가할 수 있다. 근거: `SRC-TECH-001`, `SRC-TECH-005`.

## 2. 결정 상세

1. 원천 플랫폼을 system of record로 유지한다.
2. Bridge와 Connector는 공식 API, versioned export, 승인된 read replica를 통해서만 접근한다.
3. 실제 전달에는 자산별로 승인한 방식을 사용한다.
   - 플랫폼 direct access 또는 검증된 gateway
   - file snapshot 또는 OGC 서비스
   - stream, provider push 또는 secure analysis
4. source endpoint와 credential은 implementation-specific private source binding과 Secret Store에 둔다. DSP message의 `dataAddress`와 혼동하지 않는다.
5. cache와 snapshot은 자산별 license·보유·freshness가 허용한 경우에만 사용한다.
6. 운영 DB 직접 ad hoc query는 기본안에서 제외한다.
7. 플랫폼이 subscription·entitlement를 관리하면 DSP Agreement·Transfer 수명주기와 연결하고 종료 후 외부 자원을 reconciliation한다.

## 3. 선택지

### 3.1 중앙 Data Lake로 전량 복제

query와 성능을 통일할 수 있지만 권리·보안·freshness·운영 책임이 중앙으로 이동한다. 초기안으로 채택하지 않는다.

### 3.2 원천 direct URL만 Catalog에 제공

공개 데이터에는 적합할 수 있으나 제한 데이터의 계약별 filter, token, quota, revoke와 audit를 제공하기 어렵다.

### 3.3 Adapter 기반 연합 전달

원천을 유지하면서 필요한 자산에만 통제된 Data Plane 또는 platform gateway를 추가한다. 공개 데이터는 direct access를 유지할 수 있다.

## 4. 결과

### 4.1 긍정적 결과

- source freshness와 품질 책임을 보존한다.
- 데이터 전체 이관 없이 단계적으로 연계한다.
- source 종류별 보안·quota·변환을 분리한다.
- 고위험 데이터는 원격 분석으로 전환할 수 있다.

### 4.2 비용과 제약

- 원천별 adapter와 source 계약을 관리해야 한다.
- 원천 장애·quota·schema 변경이 소비자 경험에 영향을 준다.
- 대량 데이터는 versioned snapshot pipeline이 추가로 필요하다.
- source 시스템이 안정적인 integration interface를 제공해야 한다.

## 5. 검증

- source URL·key가 Catalog·Agreement·log에 노출되지 않는다.
- REST·file·WFS adapter가 Agreement scope를 집행한다.
- source modified·deleted 상태가 Catalog에 반영된다.
- snapshot checksum·version·expiry가 재현 가능하다.
- cache·임시 복제본이 계약 종료 후 정책대로 삭제된다.
- platform subscription·token·접근제어목록(Access Control List, ACL)이 종료·철회 뒤 제거되고 orphan resource가 남지 않는다.

## 6. 재검토 조건

- 원천이 필요한 SLA·bulk access를 제공하지 못함
- 반복 query가 원천 안정성을 훼손함
- 법정·업무상 중앙 보관이 명시적으로 요구됨
- 안전한 snapshot 없이는 일관된 데이터 제품을 만들 수 없음

재검토하더라도 전량 이관이 아니라 자산별 materialization을 우선 평가한다.

## 7. 근거

- `SRC-TECH-001`, `SRC-TECH-002`, `SRC-TECH-005`
- `SRC-MOLIT-005`, `SRC-MOLIT-006`, `SRC-MOLIT-007`
- `SRC-LAW-004`, `SRC-LAW-007`, `SRC-LAW-008`
