# 변경 이력

## 1. 문서 목적

이 문서는 국토교통 데이터 카탈로그 응용 프로파일의 release별 변경 내용을 기록한다.

## 2. 0.1.0 - 2026-07-12

- DCAT-AP 3.0.1 공통 SHACL 고정
- GeoDCAT-AP 3.1.0 공간 SHACL 고정
- 국토교통 공통·공간·교통망·관측 품질 SHACL 추가
- 국토교통 ontology와 SKOS scheme 추가
- mobilityDCAT-AP Transport Mode 1.0.0 어휘 재사용
- protected JSON-LD context와 W3C PROF description 추가
- 원격 import를 차단한 검증 CLI와 JSON report contract 추가
- Core·Geo profile marker 정확히 1개와 공간 graph 하향 선택 방지 추가
- DCAT-AP DataService PropertyShape closure와 W3C SHACL-SHACL 검사 추가
- OGC GeoSPARQL 1.1 ontology를 고정하고 6 class·54 property와 GeoDCAT property 15개의 Core·Geo routing 대조 추가
- DCAT bbox·centroid coverage literal의 Core 예외와 임의 Geo datatype 하향 선택 차단 추가
- exact role mailbox JSON 정책과 `vcard:Email` support registry 대조 추가
- 기관 대표번호를 포함한 전화 게시 금지, exact public host 정책과 IPv4·IPv6 literal 전면 거부 추가
- fatal UTF-8, credential-safe 진단값과 validator source·report schema digest 추가
- 정상 2종, 오류 13종 fixture와 conformance·publication·보안 회귀시험 추가
- 운영 namespace와 기관 승인 전 상태를 Working Draft로 제한
