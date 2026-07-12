# 라이선스 상태

작성일: 2026-07-13  
적용판: 1.0.0-rc.1  
상태: 로컬 라이선스 승인 전

## 1. 목적과 범위

이 파일은 RC.1에 포함된 로컬 artifact와 제3자 artifact의 라이선스 경계를 기록한다. 이 파일 자체는 로컬 artifact에 대한 이용허락을 부여하지 않는다.

## 2. 로컬 Artifact

다음 artifact의 공개 라이선스는 운영기관이 승인하지 않았다.

- 이 release의 한국어·영어 명세와 지침
- `ontology/molit-dcat-ap.ttl`
- 국토교통 로컬 SKOS vocabulary와 후보 registry
- `shacl/molit-*.ttl`
- 로컬 JSON-LD context, policy, requirements와 fixture
- 국내·외부 profile alignment와 crosswalk
- 로컬 validator source와 report contract

RC.1 manifest의 `artifactInventoryPolicy`는 `all-release-files`다. `artifact-lock.json` 자체를 제외한 모든 일반 파일을 lock inventory에 넣으므로 이 파일과 `index.md`, `governance.md`, `MIGRATION.md`, `CONFORMANCE.md`, `NOTICE.md`도 digest 대상이다. Lock 포함은 이용허락을 뜻하지 않는다.

`artifact-lock.json`에서 로컬 artifact의 license가 `PENDING-OWNER-APPROVAL`이면 배포·수정·재사용 조건이 확정되지 않은 것이다. 이를 Creative Commons, 공공누리 또는 Open Source license가 부여된 것으로 해석하지 않는다.

로컬 라이선스 승인 전에는 다음 표시를 사용할 수 없다.

- “오픈 라이선스”
- “공공누리 적용”
- “CC BY 적용”
- “자유로운 상업적·비상업적 이용 허용”

`REL-LIC-001` 또는 동등한 release-acceptance 항목은 승인된 라이선스 전문, 권리자, 적용 artifact, 판과 시행일이 고정된 뒤에만 닫는다.

## 3. 제3자 Artifact

제3자 artifact는 각 권리자가 정한 라이선스를 유지한다. 주요 범위는 다음과 같다.

| Artifact | 권리자·발행자 | 적용 license |
| --- | --- | --- |
| DCAT-AP 3.0.1 SHACL | SEMIC·DCAT-AP Working Group | CC BY 4.0 |
| GeoDCAT-AP 3.1.0 SHACL | SEMIC·GeoDCAT-AP Working Group | CC BY 4.0 |
| mobilityDCAT-AP Transport Mode 1.0.0 | NAPCORE | CC BY 4.0 |
| W3C SHACL-SHACL | W3C | W3C Software and Document License |
| OGC GeoSPARQL 1.1 ontology snapshot | OGC | Apache License 2.0 |

출처 URL, 판, 수정 여부와 고지는 `NOTICE.md`와 `artifact-lock.json`에 둔다.

## 4. 결합 Bundle

`bundles/*.ttl`은 제3자 constraint와 로컬 constraint를 결정적으로 결합한 파일이다. 결합 bundle 전체에 하나의 제3자 라이선스가 자동으로 적용된다고 보지 않는다.

- Upstream 부분은 원 라이선스와 attribution을 유지한다.
- 로컬 부분은 운영기관의 공개 라이선스 승인을 기다린다.
- Bundle을 재배포할 수 있는 최종 조건은 두 범위를 함께 충족해야 한다.

`bundles/support.ttl`도 외부 어휘, 로컬 ontology와 로컬 후보 vocabulary를 포함한다. 단일 라이선스 파일로 덮어쓰지 않는다.

## 5. 국내 후보 Registry

`vocabulary/domestic-candidate-registries.ttl`의 공공누리 후보 Concept는 공공누리 license 문서가 아니다. 후보 Concept의 존재, label 또는 공식 안내페이지 참조만으로 Dataset에 공공누리 이용허락이 부여되지 않는다.

기관·행정구역·법령 후보 IRI도 국가 권위식별자 승인을 뜻하지 않는다.

## 6. 발행 전 조치

Release manager는 다음 항목을 함께 제출한다.

1. 로컬 artifact 권리자와 승인권자 확인
2. 승인된 license 전문과 canonical URL
3. Artifact별 적용범위와 예외
4. 제3자 attribution 재검토
5. Bundle 재배포 조건 검토
6. `artifact-lock.json`, `NOTICE.md`와 이 파일의 동시 갱신
7. 법무·운영기관 승인 evidence와 유효일

승인 뒤에는 전체 release lock을 다시 만들고 기관 키로 lock·manifest digest를 서명한다. 문서나 license 범위를 바꾸면 기존 detached signature를 재사용하지 않는다. `RA-INSTITUTIONAL-SIGNATURE`가 닫히기 전에는 서명된 발행본이라고 표시하지 않는다.

승인되지 않은 상태에서 placeholder를 실제 license identifier로 바꾸지 않는다.
