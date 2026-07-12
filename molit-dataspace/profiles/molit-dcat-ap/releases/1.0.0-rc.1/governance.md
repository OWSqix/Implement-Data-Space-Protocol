# 1.0.0-rc.1 거버넌스와 승인 경계

작성일: 2026-07-13  
적용판: 1.0.0-rc.1  
상태: Candidate governance / 역할 승인 전

## 1. 목적과 범위

이 문서는 RC.1 artifact의 변경책임, 검토순서, 용어 생명주기와 release-acceptance 경계를 정한다. 역할 이름을 정의하는 문서이며 실제 담당자 지정이나 운영기관 승인을 대신하지 않는다.

상위 기준은 `profiles/molit-dcat-ap/governance.md`다. 이 문서는 manifest v2와 독립 module 구조에 필요한 RC.1 세부 규칙을 추가한다.

## 2. 책임 분리

| 역할 | RC.1 책임 | 단독으로 승인할 수 없는 항목 |
| --- | --- | --- |
| Profile owner | 전체 module 의미와 release 범위 | 자신이 제안한 breaking change |
| Core steward | DCAT-AP 기반·Catalog 관계·국내 주제 | Geo·domain 확장 |
| Geo steward | CRS·geometry·공개수준 | 공간정보 보안 예외 |
| Network steward | 망 식별자·판·checksum·lifecycle | 발급기관 authority |
| Observation steward | 항목·대상·집계·결측·단위 | ITS payload 표준 적합성 |
| Quality steward | DQV·method·scope·result·loss | 제품별 합격기준 |
| Offering steward | Offering metadata와 readiness | 운영 Provider qualification |
| Vocabulary steward | SKOS 정의·판·mapping·폐기 | 권위 국내 IRI 승격 |
| Security·privacy reviewer | 공개 graph·민감위치·credential | Dataset 제공 권한 |
| Legal reviewer | 로컬 license·제3자 고지·법적 제공근거 | 기술 적합성 결과 |
| Release manager | Lock·시험·서명·배포 증거 | 의미 변경과 위험수용 |

같은 사람이 변경을 제안하고 의미검토와 최종 release 승인을 모두 수행하지 않는다.

## 3. Module 변경책임

| Module | 1차 steward | 필수 공동검토 |
| --- | --- | --- |
| `core` | Core steward | Profile owner·Vocabulary steward |
| `geo` | Geo steward | Security·privacy reviewer |
| `network` | Network steward | Geo steward·기관 authority reviewer |
| `observation` | Observation steward | Vocabulary steward·원천 interface owner |
| `quality` | Quality steward | 제품사양 owner·mapping reviewer |
| `dataspace-offering` | Offering steward | Provider authority·Legal reviewer |
| `publication-policy` | Release manager | Security·privacy·Legal reviewer |

Module bundle에 공통 constraint가 포함돼도 해당 domain steward의 책임을 Core steward에게 넘기지 않는다.

## 4. 변경 제안

변경 제안에는 다음 항목이 필요하다.

1. 변경할 class·property·Concept·constraint
2. 해결할 competency question
3. 기존 표준 term 재사용 검토
4. Domain·range·datatype·cardinality
5. 적용 module과 marker 영향
6. 양성·격리 음성 fixture
7. 0.1.0·RC.1 graph에 대한 semantic diff
8. Mapping loss와 역변환 가능 여부
9. 보안·개인정보·권리 영향
10. Migration·rollback·deprecation 계획
11. 출처, 판, license와 evidence digest

Label 수정만으로 의미 변경을 숨기지 않는다. Definition, shape, requirement와 fixture가 함께 바뀌면 의미 변경으로 검토한다.

## 5. Version 정책

| 변경 | 최소 version 영향 | 필요한 조치 |
| --- | --- | --- |
| 기존 적합 graph를 부적합하게 만듦 | Major | Migration, 수신자 영향과 유예기간 |
| Class·property 의미 변경 | Major | 새 term 검토 또는 명시적 deprecation |
| 선택 module·optional term 추가 | Minor | 하위호환·조합시험 |
| Candidate vocabulary 값 추가 | Minor | Source·정의·충돌·mapping 검토 |
| Constraint 오류 수정 | Patch 또는 Minor | 영향 graph·오판정·재검증 범위 기록 |
| Label·오탈자만 수정 | Patch | RDF semantic diff 확인 |
| 긴급 공개차단 | Patch 또는 Minor | 적용일·rollback·사후승인 |

Profile, ontology, vocabulary snapshot, source Dataset와 Network 판을 하나의 version 값으로 합치지 않는다.

## 6. 용어 생명주기

### 6.1 Candidate

RC.1 로컬 신규 term은 `term-status:candidate`다. Candidate는 기술검토에 사용할 수 있지만 기관 표준이나 권위식별자가 아니다.

### 6.2 Approved

Approved로 바꾸려면 다음 evidence가 필요하다.

- 승인기관과 승인자 역할
- 적용범위와 유효일
- Stable IRI 운영책임
- 한·영 정의와 competency question
- Shape·requirement·fixture 연결
- 변경·철회·민원 절차

`approved` 문자열만 추가해 상태를 바꾸지 않는다.

### 6.3 Deprecated

Deprecated term에는 다음 값을 유지한다.

- `owl:deprecated true`
- `adms:status term-status:deprecated`
- `rdfs:isDefinedBy`
- 원 version과 change note
- Replacement 또는 migration 경로
- Stable IRI tombstone

RC.1의 `TransferableDataset`과 `TransferDistribution`은 deprecated다. 신규 graph는 DCAT 기본 class와 별도 `DataspaceOfferingMetadata`를 사용한다.

`vocabulary/registry-metadata.json`은 Turtle term의 생명주기 metadata를 결정적으로 투영한다. `npm run profile:vocabulary:verify`가 scheme·notation·label·상태·유효기간·출처·대체관계의 누락과 drift를 막는다. JSON registry를 직접 고쳐 Turtle 정본을 우회하지 않는다.

## 7. 국내 후보 Registry

기관·행정구역·법령·공공누리 후보는 `/candidate/` namespace에 둔다. 다음 조건 전에는 운영값으로 승격하지 않는다.

| Registry | 승인 evidence |
| --- | --- |
| 기관 | 발급원·조직개편·위임·폐지·Provider authority 연결 |
| 행정구역 | Code scheme·기준일·경계판·폐지·대체관계 |
| 법령 | 공식 식별자·공포·개정·시행·폐지판 |
| 공공누리 | 공식 증서 URI·판·지속성·유형 변경정책 |

후보와 외부 Concept 사이에 정의·범위 검토 없이 `owl:sameAs` 또는 `skos:exactMatch`를 만들지 않는다.

## 8. Requirement와 시험 변경

Constraint 변경은 다음 artifact를 같은 review 단위로 갱신한다.

```text
human specification
requirements/profile-requirements.json
SHACL or preflight implementation
positive fixture
isolated negative fixture
requirements/conformance-cases.json
migration/semantic-diff.json
artifact lock
changelog and migration note
```

Requirement registry와 conformance case의 digest만 일치한다고 의미검토가 끝난 것은 아니다. Reviewer는 source clause, local rationale와 fixture가 실제 constraint를 설명하는지 확인한다.

`TODO`, 빈 fixture 목록과 실행하지 않은 case를 coverage 완료로 바꾸지 않는다.

판 사이의 module, requirement, ontology와 통제어 차이는 `npm run profile:semantic-diff:verify`로 재계산한다. `migration/semantic-diff.json`의 `reviewedBreakingChanges`는 검토대상을 고정하며 승인기록을 대신하지 않는다.

## 9. Upstream 변경

DCAT-AP·GeoDCAT-AP·GeoSPARQL·mobilityDCAT-AP 또는 QUDT 판이 바뀌면 다음 순서로 처리한다.

1. Release·changelog·license 고정
2. Artifact byte와 digest 검증
3. Class·property·cardinality·통제어 diff
4. Local closure와 routing 재검토
5. 모든 module fixture 재실행
6. 외부 SHACL engine differential
7. Migration과 적용일 승인

Editor's Draft 또는 live URL을 blocking dependency로 조용히 교체하지 않는다.

## 10. Validation Dataset 변경

Candidate instance graph, support graph와 shape graph를 분리한다. W3C DCAT, GeoSPARQL 또는 MOLIT ontology 전체를 candidate에 병합하지 않는다.

`bundles/support.ttl` 내용을 바꾸려면 다음을 검토한다.

- 추가·삭제 triple의 source와 license
- SHACL target과 class inference 영향
- 기존 fixture 판정 변화
- External validator 입력 방법
- Bundle·support·lock 동시 갱신

Entailment 설정을 `none`에서 바꾸는 일은 breaking change다.

## 11. Release Acceptance

### 11.1 기술 Gate

- RDF·JSON parse와 fatal lexical 검사
- Public graph·complexity preflight
- Shape meta-validation
- Module별 양성·음성 case
- 여섯 module의 competency query와 OWL-RL 일관성
- 다중 engine differential
- RDF serialization canonical comparison
- HTML·Turtle·JSON-LD 공개 표현과 content negotiation 계약
- Artifact·dependency·toolchain integrity

Ontology Gate는 `npm run profile:ontology:verify`, 공개 표현 Gate는 `npm run profile:publication:verify`로 실행한다. 후자는 `index.html`, `ontology.html`, 두 Turtle과 `serializations/*.jsonld`, `publication/content-negotiation.json`을 검사한다. 세 Accept 형식, `Vary: Accept`, 406 응답과 Turtle–JSON-LD graph 동등성은 기술 Gate다. 실제 namespace 배포는 `RA-NAMESPACE` 외부 Gate다.

### 11.2 외부 Gate

- 운영기관 owner·steward 승인
- Namespace dereference와 content negotiation
- 로컬 artifact license
- Detached signature와 signer trust
- 합법 KS·TTA 원문과 조항 mapping
- 기관 실물 fixture와 국내 authority registry
- 공간변환·교통관측·품질손실 실증
- 운영·복구·rollback·민원 runbook

기술 Gate가 성공해도 외부 Gate를 `fixed`로 바꾸지 않는다. `release-acceptance.json`의 미해결 항목이 0건일 때만 발행심의 대상으로 올린다.

### 11.3 위험수용

위험수용은 결함을 수정한 것으로 기록하지 않는다. 다음 정보를 별도 approval record에 둔다.

- 승인자 역할과 서명
- 수용 사유
- 적용 module·Dataset·기관 범위
- 시작일·만료일
- 보완통제
- 철회·재검토 조건

P0 의미 결함, 제공 권한과 local license 부재는 문서상의 위험수용만으로 발행하지 않는다.

## 12. Release 무결성

RC.1의 `artifactInventoryPolicy`는 `all-release-files`다. `artifact-lock.json` 자체를 제외한 모든 일반 파일을 lock inventory에 넣는다. 명세 Markdown, 라이선스·거버넌스 문서, 공개 HTML·JSON-LD와 배포계약도 같은 검토대상이다.

Git commit은 변경이력을 연결하지만 독립적인 시각증명은 아니다. 발행판에는 다음 신뢰사슬이 필요하다.

```text
all release file digests
-> artifact-lock digest + manifest digest
-> reviewed commit
-> signed release tag or detached signature
-> immutable CI evidence or external timestamp
-> published version IRI
```

Detached signature payload는 artifact-lock digest와 manifest digest를 함께 고정한다. Lock에 든 문서 하나만 바꿔도 기존 서명은 사용할 수 없다. 변경검토, lock 재생성과 재서명을 거친다.

`RA-INSTITUTIONAL-SIGNATURE`의 기관 키·승인 provenance가 확보되기 전에는 `signed`, `trusted timestamp` 또는 `공식 발행본`으로 표시하지 않는다.

## 13. One-window와 Adapter 거버넌스

원-윈도우와 기존 플랫폼 adapter는 profile 밖의 비규범 패키지다. Adapter owner는 source API·Excel·Database 판, mapping, loss ledger와 fixture를 관리한다.

Adapter가 다음 artifact를 수정하지 못한다.

- RC.1 ontology 의미
- Module cardinality와 marker
- Candidate·support graph 경계
- 국내 표준 적합성 상태
- Provider authority 판정

Adapter 요구 때문에 profile 변경이 필요하면 일반 변경 제안 절차를 거친다.

## 14. RC.1 승인기록

현재 문서는 역할과 절차의 후보안이다. 다음 값은 아직 비어 있다.

- Profile owner 실명 또는 승인된 역할계정
- Module steward 지정서
- 법무·보안·개인정보 검토서
- Namespace 운영기관 인수확인
- Local license 승인서
- Release signer와 trust anchor

이 항목을 채우기 전에는 `상태: 승인`으로 바꾸지 않는다.
