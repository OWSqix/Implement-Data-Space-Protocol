# 국토교통 데이터 카탈로그 응용 프로파일

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft 구현

## 1. 목적과 현재 구현

`releases/0.1.0`은 DCAT-AP 3.0 계열의 최신 보정판인 3.0.1을 기준으로 한다. 공간정보 검증에는 GeoDCAT-AP 3.1.0을 추가한다. 다음 산출물이 실행 가능한 상태다.

- RDF/OWL 온톨로지
- SKOS 주제·망 요소·품질·공간 공개 정밀도 어휘
- DCAT-AP 3.0.1과 GeoDCAT-AP 3.1.0 원본 SHACL 고정본
- 국토교통 공통·공간·교통망·관측 품질 SHACL
- JSON-LD context와 W3C PROF 기반 profile description
- 정상·오류 Turtle fixture
- 로컬 SHACL 검증 CLI와 JSON 검증 보고서 계약
- Core·Geo marker 하향 선택 방지와 게시 정책 분리
- OGC GeoSPARQL 1.1 term 고정본과 GeoDCAT·GeoSPARQL routing 완전성 검사
- exact role mailbox·DNS host registry, 전화 게시 금지와 IP literal 전면 거부 preflight
- W3C SHACL-SHACL 문법검사, SHA-256 artifact lock·validator build digest와 회귀시험

기술 산출물은 구현됐지만 기관 표준은 아니다. `data.molit.go.kr` 하위 URI 게시 승인, 분야별 검토, 실제 통합채널 표본 검증과 운영기관 의결이 남아 있다.

## 2. 문서 순서

1. [0.1.0 명세](releases/0.1.0/index.md)
2. [거버넌스와 릴리스 기준](governance.md)
3. [현행 Platform Bridge 교차표](releases/0.1.0/mappings/platform-to-profile.md)
4. [변경 이력](CHANGELOG.md)

## 3. 실행

```bash
npm run profile:verify
npm run profile:verify:independent
npm run profile:list
npm run profile:validate:example
npm run test:profile
```

독립 lane은 Python 3.12와 [`requirements-profile-validation.txt`](../../requirements-profile-validation.txt)의 hash 고정 패키지를 사용한다. `npm run verify`는 이 lane까지 실행한다.

검증기는 실행 중 원격 `owl:imports`나 JSON-LD context를 가져오지 않는다. 승인된 원본은 릴리스 디렉터리에 고정하고 `artifact-lock.json`의 SHA-256으로 확인한다.

SHACL bundle만으로는 공개 안전검사와 profile routing이 끝나지 않는다. 전체 Gate는 release lock, fatal UTF-8, 공개 graph preflight, routing과 SHACL 순서로 실행한다.
