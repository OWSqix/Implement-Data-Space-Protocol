# 국토교통 응용 프로파일 거버넌스와 릴리스 기준

작성일: 2026-07-12  
작성 기준: 2026-07-12  
상태: Working Draft

## 1. 책임 분리

| 역할 | 책임 | 승인 대상 |
| --- | --- | --- |
| Profile owner | 전체 응용 프로파일 일관성·릴리스 | major·minor release |
| Metadata steward | class·property·cardinality·예시 | SHACL과 명세 |
| Vocabulary steward | Concept 제안·정의·mapping·폐기 | SKOS release |
| Spatial steward | CRS·geometry·정밀도·공개제한 | 공간 모듈 |
| Quality steward | metric·측정방법·상태 | 품질 모듈 |
| Platform mapping owner | 통합채널·원천별 변환 규칙 | crosswalk·mapper |
| Security·privacy reviewer | 공개 projection·remote resource·민감 위치 | 보안 Gate |
| Release manager | artifact lock·시험·서명·배포 | release bundle |

같은 담당자가 용어를 제안하고 최종 승인하지 않는다. 보안·개인정보·권리 관련 Warning은 자동 예외 처리하지 않는다.

## 2. 버전 정책

| 변경 | 버전 | 처리 |
| --- | --- | --- |
| 기존 적합 graph를 부적합하게 만드는 cardinality·의미 변경 | major | migration과 병행 게시 |
| optional term·Concept·새 모듈 추가 | minor | 하위호환 시험 |
| 오탈자·label·비규범 문서 수정 | patch | RDF semantic diff 확인 |
| 긴급 보안 차단 constraint | patch 또는 minor | 적용일·영향 Dataset·복구 절차 명시 |

제품 데이터 버전, profile 버전, ontology 버전과 vocabulary snapshot 버전을 한 값으로 합치지 않는다.

## 3. URI 수명

- stable term IRI는 의미를 바꾸거나 다른 term에 재사용하지 않는다.
- 삭제 term은 `owl:deprecated true`와 대체 term·변경 사유·적용일을 남긴다.
- version IRI의 응답 내용은 release 뒤 바꾸지 않는다.
- stable IRI는 최신 유효 release로 안내하되 기존 version IRI를 보존한다.
- DNS·TLS·redirect 운영권 인계 절차 없이 Recommendation을 발행하지 않는다.
- 삭제된 instance와 term에는 tombstone 응답을 제공한다.

## 4. 용어 제안 절차

제안서는 다음 내용을 포함한다.

1. 한국어·영어 label과 정의
2. 적용 class와 사용사례
3. 기존 DCAT·DCT·PROV·DQV·GeoSPARQL·QUDT·mobilityDCAT term 검토
4. 새 term이 필요한 이유
5. cardinality와 datatype 또는 range
6. 정상·오류 RDF 예시
7. 개인정보·보안·권리 영향
8. 외부 Concept mapping 근거
9. migration과 폐기 조건

기존 term이 의미를 충족하면 새 property를 만들지 않는다. 외부 발급기관의 자원을 `owl:sameAs`로 합치지 않는다. `skos:exactMatch`는 양쪽 정의와 범위를 비교한 검토 기록이 있을 때만 승인한다.

## 5. 릴리스 Gate

| Gate | 완료조건 |
| --- | --- |
| RDF syntax | 모든 Turtle과 JSON-LD artifact parse 성공 |
| SHACL | local shape와 게시 bundle의 SHACL-SHACL 통과, 정상 fixture 0건, 오류 fixture가 지정 requirement ID로 거부 |
| Upstream integrity | URL·version·license·SHA-256 일치 |
| Namespace | stable·version IRI dereference와 content negotiation 성공 |
| Compatibility | semantic diff, breaking change와 migration 문서 승인 |
| Public projection | private binding·credential·내부 host·원문 evidence 누출 0건 |
| Security | remote import 금지, 크기·quad·literal limit와 악성 입력 시험 통과 |
| Provenance | source·mapper·profile·shape·vocabulary·report digest 연결 |
| Independent validation | 서로 다른 SHACL engine 결과 일치 또는 차이 승인 |
| Operations | 변경·폐기·tombstone·rollback·민원 runbook 승인 |

Working Draft에서는 Warning waiver를 받지 않는다. 향후 waiver를 도입하려면 승인자 역할, 사유, 적용 shape, 만료일, 증거 digest와 서명 검증을 구현해야 한다.

## 6. 외부 규격 갱신

DCAT-AP, GeoDCAT-AP와 mobilityDCAT-AP 새 release가 나오면 다음 순서로 검토한다.

1. release와 changelog 고정
2. upstream SHACL과 import closure 저장
3. SHA-256과 license 갱신
4. 기존 정상·오류 fixture 재실행
5. cardinality·range·통제어 semantic diff
6. 실제 레코드 표본 재검증
7. migration 기간과 수신자 영향 승인

Draft 규격을 blocking dependency로 승격하지 않는다.
