# ADR-0005: DCAT-AP 3.0.1을 metadata profile 기준으로 고정

작성일: 2026-07-12  
상태: Accepted

## 1. 목적과 맥락

Discovery Bridge의 `catalogProjection`은 DCAT 용어를 일부 사용하지만 DCAT-AP 적합 graph가 아니다. Catalog·CatalogRecord, language tag, range class, 통제어 IRI, 공개 accessURL, 공간·망·품질 metadata와 SHACL 검증이 없다.

사업 요구사항은 국토교통 Application Profile과 ontology를 DCAT-AP 3.0 기반으로 구현하는 것이다. 같은 3.0 계열에는 3.0.0과 오류를 보정한 3.0.1이 있다. 공간자료에는 별도 GeoDCAT-AP release가 필요하다.

## 2. 결정

국토교통 metadata profile의 규범 기반을 다음과 같이 정한다.

- 공통 의미: W3C DCAT 3
- 공통 Application Profile: DCAT-AP 3.0.1
- 공간 모듈: GeoDCAT-AP 3.1.0
- 제약 언어: W3C SHACL 2017 Recommendation
- 국토교통 분류: SKOS
- 국토교통 확장 의미: 최소 RDF/OWL ontology
- 프로파일 artifact 기술: W3C Profiles Vocabulary

mobilityDCAT-AP 1.1.0은 DCAT-AP 2.0.1 기반이므로 규범 SHACL을 합치지 않는다.

Transport Mode 1.0.0 controlled vocabulary만 원 IRI로 재사용한다. mobilityDCAT-AP 3.0.0 Editor's Draft은 blocking dependency로 사용하지 않는다.

0.1.0은 Working Draft로 발행한다. 제안한 `data.molit.go.kr` namespace는 운영기관 승인과 dereference 환경이 갖춰질 때까지 기관 표준 URI로 주장하지 않는다.

## 3. 검증 구조

검증은 다음 단계를 분리한다.

1. DCAT-AP 3.0.1
2. 공간 Dataset의 GeoDCAT-AP 3.1.0
3. 국토교통 공통·공간·망·품질 SHACL
4. Core·Geo marker 정확성 및 공간 graph 하향 선택 방지
5. publication 권고와 deprecated URI
6. 공개 graph의 private binding·secret·내부 host 검사
7. W3C SHACL-SHACL을 이용한 local shape·게시 bundle 문법 검사

DCAT-AP 3.0.1 원본에서 참조만 하고 정의를 생략한 DataService PropertyShape 두 개는 같은 release의 `ranges.ttl` 정의로 closure를 구성한다. 원본 파일은 수정하지 않는다.

EU corporate body와 place vocabulary 검사는 국내 게시 Gate가 아니라 `eu-controlled-audit`로 분리한다. 국내 기관과 행정구역을 EU 코드로 허위 mapping하지 않는다.

## 4. 대안

### 4.1 DCAT 3만 사용

DCAT은 공통 의미를 제공하지만 국토교통 필수 cardinality와 통제어를 정하지 않는다. 실행 가능한 적합성 기준이 없어 제외한다.

### 4.2 DCAT-AP 3.0.0 고정

3.0.1이 같은 계열의 range·cardinality·SHACL 오류를 보정했으므로 제외한다.

### 4.3 mobilityDCAT-AP 1.1.0을 함께 검증

DCAT-AP 2.0.1 기반 constraint와 3.0.1 constraint가 한 graph에 섞이므로 제외한다.

### 4.4 자체 JSON Schema만 사용

RDF class·range·통제어 membership과 외부 DCAT-AP 적합성을 검증할 수 없어 제외한다. JSON Schema는 validation report와 Bridge 입력 envelope에만 사용한다.

## 5. 결과

### 5.1 이점

- upstream Recommendation과 local constraint를 분리해 추적할 수 있다.
- 공간·망·관측 Dataset에만 필요한 조건을 선택 적용할 수 있다.
- source binding과 DSP wire model을 public DCAT graph와 분리한다.
- profile bundle과 validation report를 SHA-256으로 재현할 수 있다.

### 5.2 비용과 제한

- 운영 URI와 content negotiation server가 필요하다.
- 실제 통합채널 record에는 Bridge v2 mapper가 필요하다.
- 국내 organization·행정구역·법령 vocabulary를 별도 확정해야 한다.
- 독립 SHACL engine, RDFC-1.0 digest와 detached signature가 남아 있다.

## 6. 재검토 조건

- DCAT-AP 3.1 또는 4.0 Recommendation 발행
- mobilityDCAT-AP 3.0 Recommendation 발행
- 국가 차원의 공공 metadata profile 확정
- 운영기관이 다른 namespace 체계를 승인
- 실제 Dataset 표본에서 0.1.0 cardinality가 법적·운영 요구와 충돌

## 7. 관련 문서

- [응용 프로파일 0.1.0](../../profiles/molit-dcat-ap/releases/0.1.0/index.md)
- [거버넌스와 릴리스 기준](../../profiles/molit-dcat-ap/governance.md)
- [Platform Bridge 교차표](../../profiles/molit-dcat-ap/releases/0.1.0/mappings/platform-to-profile.md)
- [메타데이터·정책 프로필](../02-architecture/metadata-and-policy-profile.md)
