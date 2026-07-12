# 제3자 산출물 고지

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: 적용

## 1. 목적과 범위

이 문서는 0.1.0 release에 포함한 제3자 SHACL과 controlled vocabulary의 출처, 저작자와 license를 기록한다.

## 2. DCAT-AP 3.0.1

`shacl/upstream/dcat-ap-3.0.1`의 파일은 SEMIC DCAT-AP 3.0.1 원본이다. 원본 URL과 SHA-256은 `artifact-lock.json`에 기록했다. 적용 license는 Creative Commons Attribution 4.0이다.

`shacl/compatibility/dcat-ap-3.0.1-closure.ttl`은 같은 release의 `ranges.ttl`에서
DataService property shape 두 개를 복사한 closure다. 원본 `dcat-ap-SHACL.ttl`이
참조하면서 생략한 `endpointURL`과 `endpointDescription`의 `sh:path`·range를
보충할 뿐 새 제약을 추가하지 않는다.

- 출처: <https://semiceu.github.io/DCAT-AP/releases/3.0.1/>
- 저작자·발행자: DCAT-AP Working Group, SEMIC
- License: <https://creativecommons.org/licenses/by/4.0/>

## 3. GeoDCAT-AP 3.1.0

`shacl/upstream/geodcat-ap-3.1.0`의 파일은 SEMIC GeoDCAT-AP 3.1.0 원본이다.

- 출처: <https://semiceu.github.io/GeoDCAT-AP/releases/3.1.0/>
- 저작자·발행자: GeoDCAT-AP Working Group, SEMIC
- License: <https://creativecommons.org/licenses/by/4.0/>

## 4. mobilityDCAT-AP Transport Mode 1.0.0

`vocabulary/mobilitydcat-transport-mode-1.0.0.ttl`은 NAPCORE가 발행한 Transport Mode controlled vocabulary 원본이다.

- 출처: <https://w3id.org/mobilitydcat-ap/transport-mode/1.0.0>
- 저작자: Mario Scrocca, Peter Lubrich
- 발행자: NAPCORE SubWG4.4
- License: <https://creativecommons.org/licenses/by/4.0/>

## 5. W3C SHACL-SHACL

`shacl/upstream/w3c-shacl-2017/shacl-shacl.ttl`은 SHACL 1.0 Recommendation 부록 C의
shape graph를 검증할 때 사용한다. [W3C Data Shapes commit
`d4da3e4`](https://github.com/w3c/data-shapes/commit/d4da3e48bb52c51d81667c054a65981cdaa1bd0b)을
고정했으며 runtime network import에는 사용하지 않는다.

- 출처: <https://github.com/w3c/data-shapes/commit/d4da3e48bb52c51d81667c054a65981cdaa1bd0b>
- 저작자·발행자: W3C Data Shapes Working Group, World Wide Web Consortium
- License: <https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document>

## 6. OGC GeoSPARQL 1.1 ontology

`vocabulary/upstream/geosparql-1.1/geo.ttl`은 Core·Geo routing term의 완전성을
검사할 때 쓰는 OGC GeoSPARQL 1.1.0 ontology 고정본이다. runtime 원격 조회나
SHACL background 추론에는 사용하지 않는다. `1.1.0-ghpages` tag의 commit
`cd53678be2e9775066d63791c84c3fa010fc29ff`와 SHA-256
`25e319e0c30c6cf026a5cb1a693ac74a17e7cebc3dcad520b731f77c49719867`을 고정했다.

- 출처: <https://github.com/opengeospatial/ogc-geosparql/tree/1.1.0-ghpages/geosparql11>
- 저작자·발행자: GeoSPARQL Standards Working Group, Open Geospatial Consortium
- License: <https://www.apache.org/licenses/LICENSE-2.0>

## 7. 로컬 수정 원칙

`upstream`과 원본 controlled vocabulary 파일은 수정하지 않는다. 국내 적용 constraint와 compatibility background는 별도 파일로 유지한다.
