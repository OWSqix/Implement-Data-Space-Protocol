# 제3자 산출물과 로컬 변경 고지

작성일: 2026-07-13  
적용판: 1.0.0-rc.1  
상태: Candidate notice

## 1. 목적과 범위

이 문서는 RC.1에 고정한 제3자 SHACL·ontology·controlled vocabulary의 출처, 판, 로컬 변경과 라이선스를 기록한다. Artifact별 URL과 SHA-256의 machine 정본은 `artifact-lock.json`이다.

로컬 artifact의 이용허락 상태는 `LICENSE.md`를 따른다. 이 고지는 로컬 공개 라이선스를 부여하지 않는다.

## 2. DCAT-AP 3.0.1

`shacl/upstream/dcat-ap-3.0.1/`은 SEMIC DCAT-AP 3.0.1 artifact를 byte 단위로 고정한다.

- 출처: <https://semiceu.github.io/DCAT-AP/releases/3.0.1/>
- 저작자·발행자: DCAT-AP Working Group, SEMIC
- License: <https://creativecommons.org/licenses/by/4.0/>

포함 파일은 blocking SHACL, range, recommended shape, deprecated IRI와 EU controlled-vocabulary diagnostic shape다. 한국 publication Gate는 EU diagnostic shape를 자동 적용하지 않는다.

### 2.1 Local compatibility closure

`shacl/compatibility/dcat-ap-3.0.1-closure.ttl`은 같은 release의 `ranges.ttl`에서 DataService의 `endpointURL`과 `endpointDescription` PropertyShape를 가져온 로컬 closure다.

- 원 source와 CC BY 4.0 attribution을 유지한다.
- 누락된 `sh:path`와 range를 보충한다.
- DCAT-AP 의미를 바꾸는 신규 국내 constraint는 이 파일에 넣지 않는다.
- Closure와 원본 차이는 test와 artifact lock으로 고정한다.

## 3. GeoDCAT-AP 3.1.0

`shacl/upstream/geodcat-ap-3.1.0/geodcat-ap-SHACL.ttl`은 SEMIC GeoDCAT-AP 3.1.0 원본이다.

- 출처: <https://semiceu.github.io/GeoDCAT-AP/releases/3.1.0/>
- 저작자·발행자: GeoDCAT-AP Working Group, SEMIC
- License: <https://creativecommons.org/licenses/by/4.0/>

로컬 CRS, geometry subset과 공간 공개수준 constraint는 `shacl/molit-spatial.ttl`에 분리한다.

## 4. mobilityDCAT-AP Transport Mode 1.0.0

`vocabulary/mobilitydcat-transport-mode-1.0.0.ttl`은 NAPCORE가 발행한 controlled vocabulary 원본이다.

- 출처: <https://w3id.org/mobilitydcat-ap/transport-mode/1.0.0>
- 저작자: Mario Scrocca, Peter Lubrich
- 발행자: NAPCORE SubWG4.4
- License: <https://creativecommons.org/licenses/by/4.0/>

RC.1은 Transport Mode IRI를 재사용한다. DCAT-AP 2.0.1 기반 mobilityDCAT-AP 1.1.0 SHACL을 RC.1 bundle에 병합하지 않는다.

## 5. W3C SHACL-SHACL

`shacl/upstream/w3c-shacl-2017/shacl-shacl.ttl`은 W3C Data Shapes 저장소의 다음 commit을 고정한다.

- Commit: <https://github.com/w3c/data-shapes/commit/d4da3e48bb52c51d81667c054a65981cdaa1bd0b>
- 저작자·발행자: W3C Data Shapes Working Group, World Wide Web Consortium
- License: <https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document>

이 파일은 local shape와 bundle의 SHACL-SHACL 검사에 사용한다. Runtime remote import에는 사용하지 않는다.

## 6. OGC GeoSPARQL 1.1

`vocabulary/upstream/geosparql-1.1/geo.ttl`은 OGC GeoSPARQL 1.1.0 ontology 고정본이다.

- Source tag: `1.1.0-ghpages`
- Commit: `cd53678be2e9775066d63791c84c3fa010fc29ff`
- 저작자·발행자: GeoSPARQL Standards Working Group, Open Geospatial Consortium
- License: <https://www.apache.org/licenses/LICENSE-2.0>

이 고정본은 Core·Geo routing term inventory를 검사할 때 사용한다. Candidate instance graph에 병합하지 않는다.

## 7. 국가교통정보센터 표준노드링크 표본

국가교통정보센터 [노드링크 자료실](https://www.its.go.kr/nodelink/nodelinkRef)의 `[2026-07-01]NODELINKDATA.zip`을 기술검증 표본으로 관찰했다.

- 자료실 record: `DF_217/0`
- 관찰 SHA-256: `219020fac55f2faab1029ec9306563a00968f9b27f3910b80c534583b750b9ab`
- 검토 범위: source PRJ와 EPSG:5186 매개변수 대조, 최소 node–link 참조관계 fixture
- 권리정책: 국가교통정보센터 [저작권보호](https://www.its.go.kr/common/infoPolicyPage?service=copyrightPolicy)

센터 정책은 국토교통부 발간자료의 무단 복제·배포를 원칙적으로 금지하고 출처표시와 사전 협의·허락 조건을 둔다. 따라서 이 release는 원 ZIP이나 원본 전체를 CC BY, 공공누리 또는 자유이용 자료로 표시하지 않는다.

Repository의 [최소 인용 fixture와 관찰 digest](examples/source-evidence/standard-node-link-2026-07-01.json)는 구조시험의 provenance다. 원 자료의 재배포 허가를 대신하지 않는다. 원본 byte를 release에 포함하거나 표본 범위를 넓히기 전에는 권리자 승인과 허용범위를 evidence로 고정한다.

## 8. 외부 식별자와 로컬 Allowlist

다음 파일은 외부 registry 전체 복제본이 아니라 RC.1이 허용하는 IRI를 고정한 로컬 support artifact다.

- `vocabulary/eu-authority-allowlist.ttl`
- `vocabulary/iana-media-type-allowlist.ttl`
- `vocabulary/ogc-crs-allowlist.ttl`
- `vocabulary/qudt-unit-allowlist.ttl`

IRI authority와 개별 개념의 권리는 원 발급자에게 있다. Allowlist 편집, 후보 범위와 검증용 추가 triple은 로컬 artifact이며 공개 라이선스 승인을 기다린다.

Live registry의 최신값을 Runtime에서 자동 추가하지 않는다. Source snapshot과 검토를 거쳐 release를 올린다.

## 9. 로컬 Ontology와 Vocabulary

다음은 RC.1에서 직접 작성한 후보 artifact다.

- `ontology/molit-dcat-ap.ttl`
- `vocabulary/molit-domain.ttl`
- `vocabulary/network-element-type.ttl`
- `vocabulary/network-lifecycle-status.ttl`
- `vocabulary/observation-semantics.ttl`
- `vocabulary/offering-readiness-status.ttl`
- `vocabulary/quality.ttl`
- `vocabulary/quality-semantics.ttl`
- `vocabulary/spatial-disclosure-level.ttl`
- `vocabulary/term-status.ttl`
- `vocabulary/transport-unit.ttl`
- `vocabulary/domestic-candidate-registries.ttl`

이 artifact의 `candidate` 상태는 기관 표준 승인이나 공개 라이선스를 뜻하지 않는다.

`transport-unit.ttl`의 `vehicle-per-hour`·`vehicle-per-day`는 QUDT 3.4의 Unit·DerivedUnit·FactorUnit·CountRate IRI와 모델을 참조해 로컬에서 작성했다. QUDT가 발행한 공식 Unit이라고 표시하지 않으며 로컬 정의의 공개 라이선스는 `LICENSE.md`의 승인 전 상태를 따른다.

## 10. 국내 후보 Registry 고지

`domestic-candidate-registries.ttl`은 기관·행정구역·법령·공공누리 식별정책을 검토하기 위한 파일이다.

- 모든 후보 IRI는 `/candidate/` namespace를 사용한다.
- 국가 권위식별자라고 주장하지 않는다.
- 공공누리 후보 Concept는 공식 license deed가 아니다.
- 공식 정의와 같다는 `skos:exactMatch`를 제공하지 않는다.
- 운영기관 승인 전에는 Dataset의 Publisher·spatial·license 값으로 사용하지 않는다.

공공누리 유형안내 페이지를 source로 참조하더라도 그 페이지의 이용조건이 RC.1 로컬 ontology에 자동 적용되지 않는다.

## 11. 결합 Bundle

`bundles/core.ttl`, `geo.ttl`, `network.ttl`, `observation.ttl`, `quality.ttl`, `dataspace-offering.ttl`과 `publication-policy.ttl`은 upstream과 local shape를 결정적으로 결합한다.

Bundle에는 서로 다른 license 범위가 함께 있을 수 있다.

- Upstream triple은 원 license를 유지한다.
- Local triple은 `LICENSE.md`의 승인 전 상태를 따른다.
- Generated bundle이라는 이유로 upstream attribution을 제거하지 않는다.
- Bundle 전체를 임의로 단일 CC BY 또는 Apache license로 표시하지 않는다.

## 12. Support Graph 사용 고지

`bundles/support.ttl`은 검증기에 제공하는 trusted background다. Candidate graph에는 instance metadata만 둔다.

```text
candidate instance graph
+ exact locked support.ttl
+ selected shapes bundle
with entailment none
```

W3C `dcat.ttl`, GeoSPARQL ontology, MOLIT ontology 또는 SHACL shape graph를 candidate graph에 병합하지 않는다. Support graph는 제출 metadata나 운영 권위 registry가 아니다.

## 13. 변경과 재배포 점검

Release manager는 배포 전에 다음 항목을 확인한다.

1. Artifact lock과 실제 byte 일치
2. Upstream source·판·license·attribution 일치
3. Local closure의 변경범위
4. Local artifact license 승인상태
5. Generated bundle의 복합 license 경계
6. Candidate registry의 비권위 표기
7. Notice와 license 문서의 동시 갱신

확인되지 않은 artifact를 “공식 원본” 또는 “승인된 국내 표준 어휘”로 표시하지 않는다.
