# 국토교통 데이터 카탈로그 응용 프로파일

- 작성일: 2026-07-13
- 적용판: 1.0.0-rc.1
- 상태: Candidate / 발행 승인 전

## 1. 현재 판

현재 개발·검증 대상은 [`releases/1.0.0-rc.1`](releases/1.0.0-rc.1/index.md)이다. DCAT 3와 DCAT-AP 3.0.1을 공통 기반으로 사용하고 공간 module에는 GeoDCAT-AP 3.1.0을 적용한다.

RC.1은 다음 여섯 conformance module과 publication policy를 분리한다.

- `core`
- `geo`
- `network`
- `observation`
- `quality`
- `dataspace-offering`
- `publication-policy`

`eu-controlled-audit`는 국내 게시 Gate가 아닌 별도 diagnostic이다.

## 2. 구현 범위

RC.1에는 다음 artifact가 있다.

- 국토교통 로컬 OWL ontology와 SKOS 후보 어휘
- DCAT-AP 3.0.1·GeoDCAT-AP 3.1.0 고정 SHACL과 로컬 constraint
- Module별 결정적 bundle과 exact support graph
- Protected JSON-LD context와 W3C PROF profile description
- Property constraint 단위 requirement와 conformance case register
- Module별 양성·격리 음성 fixture
- Artifact lock, release acceptance와 machine-readable Gate
- 0.1.0 migration, conformance, governance, license와 third-party notice
- 국내 표준 후보 crosswalk와 아직 닫히지 않은 증거조건

기술시험 성공과 발행 가능 판정은 별개다. `manifest.json`의 상태는 `candidate`이고 namespace는 `proposed-not-yet-dereferenceable`이다. 기관 owner 승인, 로컬 라이선스, namespace 운영, 서명과 국내 조항·기관 fixture가 끝나기 전에는 Recommendation 또는 기관 표준으로 표시하지 않는다.

## 3. Module 선언과 검증

Catalog와 관련 CatalogRecord는 주장하는 module version IRI를 `dct:conformsTo`로 선언한다. 한 graph가 여러 분야 의미를 가지면 module IRI를 여러 개 선언할 수 있다.

예를 들어 교통망 관측 Dataset에 품질 측정값이 있으면 `network`, `observation`, `quality`를 함께 선언할 수 있다. 각 선언은 독립된 적합성 주장이므로 같은 입력 byte를 module마다 검증한다.

```powershell
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input data.ttl --profile network
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input data.ttl --profile observation
node src/profile/cli.mjs validate --version 1.0.0-rc.1 --input data.ttl --profile quality
```

세 report의 input digest가 같아야 한다. 일부 module만 통과한 graph에 전체 module 적합을 표시하지 않는다.

## 4. 검증 Dataset 경계

Candidate 입력에는 instance metadata만 둔다. W3C DCAT ontology, GeoSPARQL ontology, MOLIT ontology 또는 SHACL shape graph를 candidate에 병합하지 않는다.

```text
validation data graph = candidate instance graph + exact locked bundles/support.ttl
entailment = none
```

외부 ontology 병합으로 SHACL target이 늘어나 판정이 뒤집히는 결과는 RC.1 적합성 결과가 아니다.

## 5. 문서 순서

1. [RC.1 명세](releases/1.0.0-rc.1/index.md)
2. [적합성 선언과 검증 절차](releases/1.0.0-rc.1/CONFORMANCE.md)
3. [0.1.0 이관 지침](releases/1.0.0-rc.1/MIGRATION.md)
4. [RC.1 거버넌스](releases/1.0.0-rc.1/governance.md)
5. [라이선스 상태](releases/1.0.0-rc.1/LICENSE.md)
6. [제3자 산출물 고지](releases/1.0.0-rc.1/NOTICE.md)
7. [국내 표준 정렬](releases/1.0.0-rc.1/mappings/domestic-standards-alignment.md)
8. [변경 이력](CHANGELOG.md)

## 6. 실행

Artifact와 lock을 확인한다.

```powershell
node src/profile/cli.mjs verify --version 1.0.0-rc.1
```

Module 하나를 검증한다.

```powershell
node src/profile/cli.mjs validate `
  --version 1.0.0-rc.1 `
  --input profiles/molit-dcat-ap/releases/1.0.0-rc.1/examples/valid/network-catalog.ttl `
  --profile network `
  --report .local/network-validation.json
```

Publication policy까지 적용한다.

```powershell
node src/profile/cli.mjs publish-check `
  --version 1.0.0-rc.1 `
  --input data.ttl `
  --profile network
```

`publish-check`의 기술 Gate가 성공해도 release acceptance의 외부 차단항목이 열려 있으면 발행승인이 아니다. 전체 저장소 시험과 release 상태는 다음 명령으로 분리해 확인한다.

```powershell
npm run verify
npm run release:status
```

`release:status`의 non-zero exit를 문서 설명으로 덮어쓰지 않는다.

## 7. 0.1.0 상태

[`releases/0.1.0`](releases/0.1.0/index.md)은 migration과 회귀비교를 위한 legacy 판이다. 신규 graph의 기준으로 사용하지 않는다.

0.1.0의 Core·Geo 상호배타 marker, `core-publication`·`geo-publication` 이름과 `Transferable*` 유형을 RC.1에 그대로 복사하지 않는다. 변환 순서와 rollback 기준은 RC.1 `MIGRATION.md`를 따른다.
