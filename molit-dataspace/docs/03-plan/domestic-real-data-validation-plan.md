# 국내 실물 데이터 상호운용 검증계획

작성일: 2026-07-12  
기준일: 2026-07-12  
상태: Active / 외부 fixture 대기

## 1. 목적

이 계획은 `REL-MAP-001`을 실행 가능한 시험으로 바꾼다. 국토교통 데이터 통합채널, 공공데이터포털, 통계누리와 ITS의 실제 record를 수집해 source mapping, 국내 표준 version migration과 MOLIT-DCAT-AP 게시 Gate를 측정한다.

현재 공개 RDF/XML 고정본 1건과 합성 fixture만으로 전체 플랫폼 상호운용성을 추정하지 않는다. 검증 결과는 플랫폼 전체가 아니라 source contract·Dataset 유형·수집판별로 보고한다.

## 2. 모집단과 층

| source 층 | 하위 층 | 필수 관찰값 | 목적 |
| --- | --- | --- | --- |
| 통합채널 | hosted·brokered·index-only·unknown 후보 | record ID, publisher, landing·delivery, 권리, 갱신·삭제 | 역할과 Offering 승격 가능성 판정 |
| 공공데이터포털 | file·Open API·linked data | DCAT·상세 metadata, 실제 제공형태 | 국내 포털 dialect와 3.0.1 차이 측정 |
| 통계누리 | 표·시계열·지역 범위 | 표 ID, 단위, 주기, 차원, API schema | 통계 Dataset·Distribution mapping |
| ITS node·link | 지역·망 판·배포형식 | authority, network ID·version, checksum, 변경이력 | NetworkReference 실물 검증 |
| ITS 소통정보 | 지점·구간·집계주기 | link ID, 시각, 속도·통행시간, 단위, 결측 | 교통 관측모델과 단위 검증 |
| 공간정보 | vector·raster·service | CRS, geometry, extent, 축, format·service | CRS coverage와 Geo profile 검증 |

동일 record의 화면, API, RDF와 실제 payload를 별도 관찰로 중복 집계하지 않는다. 하나의 source record에 연결된 표현으로 묶고 각 표현의 digest를 남긴다.

## 3. 표본 설계

### 3.1 전수 우선

공식 export로 모집단 전체를 안전하게 받을 수 있고 처리량이 허용되면 전수 검증한다. 화면 자동화로 목록을 무제한 수집하지 않는다.

### 3.2 층화 표본

전수가 불가능하면 다음 순서로 표본 수를 결정한다.

1. 운영기관 export에서 모집단 수와 층별 크기를 확정한다.
2. 주요 Dataset 유형·제공형태·기관·갱신주기·CRS·권리상태를 층으로 정한다.
3. 희소하지만 위험한 blocked·legacy·폐지 유형은 목적표본으로 추가한다.
4. 비율을 외삽할 경우 목표 오차·신뢰수준·유한모집단 보정을 표본계획서에 기록한다.
5. 난수 seed와 record ID digest 목록을 고정한다.

`수백 건`은 고정 합격기준이 아니다. 모집단과 오류 목표 없이 정한 숫자는 대표성을 입증하지 못한다.

### 3.3 필수 경계 사례

다음 사례는 무작위 표본과 별도로 포함한다.

- Distribution이 없는 index-only record
- 하나의 Dataset에 여러 제공형태가 있는 record
- publisher와 원 보유기관이 다른 record
- license·accessRights가 비어 있거나 서로 충돌하는 record
- 폐지·대체·삭제된 record
- 다국어·결합 keyword·잘못된 날짜 datatype record
- source-reference CRS와 공개 geometry CRS가 다른 record
- EPSG:4326·3857·legacy Bessel 등 현재 미승인 CRS record
- node·link version이 없거나 혼재한 record
- 속도 단위·집계주기·결측 의미가 불분명한 record

## 4. 수집과 보존

각 표본은 다음 manifest를 가져야 한다.

```json
{
  "sourceContract": "identifier and version",
  "sourceRecordId": "source scoped identifier",
  "retrievedAt": "RFC 3339 timestamp",
  "contentType": "registered media type",
  "bytes": 0,
  "sha256": "64 lowercase hex characters",
  "collectionAuthority": "approval or public basis reference",
  "confidentiality": "public or private-fixture",
  "stratum": ["source", "asset-type", "delivery-type"],
  "expectedDisposition": "publish-candidate or quarantine or reject"
}
```

운영 credential, 개인정보, 비공개 계약과 원본 payload를 공개 저장소에 넣지 않는다. 공개 가능한 비식별 fixture만 repository에 고정하고 나머지는 승인 private evidence store의 digest로 참조한다.

브라우저 자동화는 화면 계약을 확인하는 보강수단이다. 운영 API를 추정하거나 화면 내부 endpoint를 server-to-server 계약으로 승격하지 않는다.

## 5. 실행 순서

```text
fixed source bytes
  -> safe parser and source inventory
  -> source-contract validator
  -> crosswalk decision for every source path
  -> canonical record + loss ledger
  -> private compliance/public projection split
  -> MOLIT profile validation
  -> source-profile and target-profile differential
  -> publish candidate or quarantine or reject
```

각 거부는 source pointer, requirement ID, 분류와 remediation을 기록한다.

parser error, mapping gap, authority gap, datatype error와 profile violation을 구분한다. rights block와 security block도 별도 범주로 보고한다.

## 6. 측정지표

| 지표 | 분자 | 분모 | 해석 |
| --- | --- | --- | --- |
| parse success | 안전 parser 성공 record | 수집 record | source syntax 처리범위 |
| inventory decision coverage | mapping·exclude·quarantine 결정 path | 관찰 source path | source field 결정 완전성 |
| automatic publish eligibility | 자동 게시조건 충족 record | 유효 parse record | 운영 가능 후보 비율 |
| authority resolution | 승인 식별자로 해소된 값 | 기관·공간·법령·license 후보 | 국내 통제어 준비도 |
| profile pass | blocking·Warning 0건 record | 게시 승인 후보 | target graph 기술 적합성 |
| silent loss | loss ledger 없이 사라진 값 | source value | 허용하지 않음 |
| category error | private DB metadata를 public DCAT으로 잘못 승격한 값 | 검토 mapping | 허용하지 않음 |
| rejection distribution | requirement별 거부 record | 전체 거부 record | 우선 개선대상 |

비율을 모집단에 외삽할 때는 층별 가중치와 신뢰구간을 함께 보고한다. 목적표본 결과를 모집단 비율로 바꾸지 않는다.

## 7. 합격조건

### 7.1 record 수준

게시 승인 record는 다음 조건을 모두 만족해야 한다.

- source syntax와 datatype lexical 검사 통과
- 관찰한 모든 source path에 mapping·제외·격리 결정 존재
- 권위가 필요한 기관·주제·공간·license 값 해소
- 손실값의 loss class와 reverse rule 존재
- 선택한 Core 또는 Geo publication profile의 Violation·Warning 0건
- Offering 후보인 경우 실제 Distribution·DataService·권리·Provider authority 확인

### 7.2 release 수준

| control | 합격조건 |
| --- | --- |
| `REL-MAP-001` | 승인 모집단·표본에서 inventory coverage, silent loss, category error Gate 통과 |
| `CRS-COVERAGE-001` | 관찰 CRS가 승인·격리 중 하나로 전부 분류되고 지원 CRS의 축·geometry·변환 시험 통과 |
| `REL-VOC-001` | 기관·행정구역·법령·license 후보가 승인 registry 또는 명시적 quarantine으로 전부 분류 |
| `TRANSPORT-UNIT-001` | 교통 관측속도 property·집계·단위·결측 규칙과 ITS fixture 시험 통과 |

미분류 source path, silent loss와 category error는 1건이라도 release를 차단한다. 지원한다고 선언한 층의 게시 승인 subset은 blocking·Warning 0건이어야 한다.

## 8. 결과 보고서

결과 보고서는 다음 표를 포함한다.

1. 모집단·표본틀·제외·층·seed
2. source contract와 수집판
3. fixture ID·digest·보관등급
4. field inventory와 mapping 상태
5. requirement별 거부 분포
6. source-profile·target-profile validator 결과
7. 손실·reverse rule·미해소 authority
8. CRS·node/link·교통 단위 coverage
9. 알려진 편향과 외삽 제한
10. 재시험 대상과 담당·기한

플랫폼 이름만으로 결과를 일반화하지 않는다. 예를 들어 ITS node·link 파일시험을 통합채널 broker 상호운용시험으로 기록하지 않는다.

## 9. 실행 책임

| 담당 | 책임 |
| --- | --- |
| 운영기관 | 공식 export·schema·모집단·권리·삭제정보 제공 |
| data steward | 층·표본·mapping·예외 승인 |
| metadata engineer | parser·crosswalk·loss ledger·projection 실행 |
| 공간정보 담당 | CRS·축·geometry·변환오차 판정 |
| 교통 담당 | node/link 판과 관측 의미·단위 판정 |
| 보안·법무 | fixture 보관등급·credential·license·재제공 검토 |
| 검증 담당 | 독립 engine, 결과 digest와 회귀시험 |
| release manager | machine register 상태와 차단결정 갱신 |

## 10. 착수 입력

다음 입력이 확보되는 순서대로 실행한다.

- 통합채널 공식 metadata export 또는 승인 sandbox
- 통계누리 대상 표 ID와 API schema
- ITS `[2026-07-01]NODELINKDATA.zip`의 승인 private fixture 또는 비식별 추출본
- ITS 소통정보 정상·결측·오류 payload
- 공간 Dataset의 실제 CRS 분포와 기준점
- NIA 원-윈도우 가이드 적용 fixture
- 기관·행정구역·법령·공공누리 식별자 운영답변

자료가 없으면 합성 fixture로 Gate 동작만 시험하고 실물 상호운용 성공으로 보고하지 않는다.
