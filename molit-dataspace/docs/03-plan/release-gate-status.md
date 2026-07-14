# Release 차단 Gate 현황

작성일: 2026-07-13
기준일: 2026-07-13
상태: Active / release blocked

## 1. 목적과 판정

이 문서는 win32-x64 release lane의 기술 검증과 발행 판정을 구분한다. RC.1 Gate는 다음 입력을 함께 읽는다.

- `profiles/molit-dcat-ap/releases/1.0.0-rc.1/release-acceptance.json`
- 독립 검토 digest로 고정한 `standards/korean-interoperability-register.json`
- `profiles/molit-dcat-ap/releases/1.0.0-rc.1/artifact-lock.json`
- Gate 시작과 종료 시점의 release 경로 Git 상태

어느 하나라도 누락되거나 schema·digest·Git 상태가 맞지 않으면 판정을 진행하지 않는다. Korean register 파일의 `fixed` 문자열만 바꿔서는 Gate를 통과할 수 없다.

Korean register에는 `fixed` 12건과 미해소 14건이 있다. 이 중 13건은 `releaseGateRequired=true`다. 미해소 항목은 다음 세 범위로 나눈다.

- `standard-core`: Profile 공통 표준과 발행정책
- `module-conditional`: Geo·Quality·Observation처럼 해당 Module에 한정된 표준
- `bridge-runtime`: 기존 플랫폼 adapter, 운영기관 권한과 실데이터 검증

로컬에서 끝내야 하는 `standard-core`·`module-conditional` 결함은 Candidate와 Recommendation을 모두 차단한다. 합법 원문이나 기관 fixture가 필요한 외부 증거 결함은 Recommendation만 차단한다. `bridge-runtime`은 Profile RC Gate에 섞지 않고 connector 배포 Gate에서 다룬다.

Provider authority entry와 ISO official bytes 사용 근거도 확보되지 않았다.

```powershell
npm run release:status
```

이 명령은 기존 세 운영 register를 읽는 legacy 판정이다. RC.1 판정 명령과 범위는 4절에 따로 적었다.

## 2. 이번 변경으로 해소한 항목

| 대상 machine register 항목 | 기존 문장·판정 | 수정 내용 | 검증 범위 |
| --- | --- | --- | --- |
| `BS-SHACL-ENGINE` | Jena 결과 정규화 비교 없음 | Apache Jena 6.1.0과 production engine의 13개 Core·Geo 사례 비교 | focus·path·severity·constraint·shape·value 비교, message·blank label 제외 |
| `BS-RDF-SERIALIZATION` | Turtle 전용 production loader | RDF/XML·JSON-LD·N-Triples·N-Quads ingest와 RDFC-1.0 digest | Jena parser와 5개 직렬화 비교, named graph 보존 |
| `BS-VALIDATOR-DEPENDENCIES` | 실제 설치 module byte 미고정 | 격리 `npm ci`, 152개 설치 package tree·153개 SPDX package SBOM, Jena·JRE archive와 설치 tree 고정 | win32-x64 release lane |
| `BS-CROSSWALK-INVENTORY` | 수기 inventory와 mapping의 동시 누락 가능 | 안전 RDF/XML parser가 생성한 source path와 mapping 완전 대조 | 공공데이터포털 고정본 17개 path |
| `BS-XSD-DATATYPE-COVERAGE` | 일부 datatype만 검사 | 승인 datatype 15개의 lexical·value 검사와 unknown XSD datatype 거부 | 공개 RDF preflight |
| `BS-NETWORK-REGISTRY-DRIFT` | 수기 IANA 주소표 | official CSV 3종 snapshot과 생성 network policy | 고정본 검증 구현, scheduled refetch는 별도 운영과제 |
| `BS-CRS-REGISTRY-EVIDENCE` | 가변 OGC resolver 관찰만 기록 | CRS 7종과 EPSG coordinate system 2종의 byte·digest·semantic field 고정 | offline snapshot Gate |
| `BS-CRS-AXIS` | 모든 좌표 tuple을 같은 축 순서로 해석 | CRS84·EPSG:4326·3857·5179·5186의 authority axis와 bounded geometry 왕복시험 | Profile이 선언한 geometry subset. 기관 CRS 모집단은 별도 항목으로 유지 |

해소 판정은 `fixed`와 `currentlyBlocksRelease=false`로 기록했다. 회귀 방지 시험은 `releaseGateRequired=true`를 유지한다.

## 3. 잔여 release 차단항목

| ID | 범위 | 현재 상태 | 차단 사유 | 해소 조건 |
| --- | --- | --- | --- | --- |
| `BS-ISO19115-XML-TECH` | `bridge-runtime` | 외부 증거 대기 | Offline 검증기는 있으나 운영 XML 수집환경에서 쓸 official bytes 근거가 없음 | ISO 허가 또는 기관 승인 private cache와 재현 결과 |
| `BS-ISO19115-KS-CLAUSE` | `standard-core` | 외부 증거 대기 | 국내 KS 원문 조항과 기관 XML fixture 미확보 | 합법 원문 digest·조항표·정상·오류 fixture |
| `BS-TTA-CROSSWALK` | `standard-core` | 외부 증거 대기 | TTA 원문 기준 cardinality·코드표 대조 미완료 | 합법 원문과 항목별 mapping·fixture |
| `BS-DCAT-KR-VERSION` | `standard-core` | 외부 증거 대기 | 국내 DCAT profile과 DCAT-AP 3.0.1 migration 미검증 | version diff와 이중 validator |
| `BS-DB-CATALOG-CATEGORY` | `bridge-runtime` | 구현 대기 | 내부 DB 운영 metadata의 공개 DCAT 자동 승격 차단 Gate 없음 | 금지 mapping corpus와 `MAP-CATERR-001` |
| `BS-QUALITY-LOSS` | `module-conditional: quality` | 외부 증거 대기 | RC.1 loss ledger는 구현했으나 KS 조항과 기관 XML 왕복 fixture가 없음 | 합법 원문과 기관 fixture로 `ISO-DQV-001`·`MAP-LOSS-001` 검증 |
| `BS-AUTHORITY-REGISTRY` | `bridge-runtime` | 외부 증거 대기 | Resolver는 있으나 승인 기관 entry·위임 증거·trust anchor가 없음 | 운영 registry·철회 확인·서명 verifier 승인 |
| `BS-STANDARD-STATUS-EVIDENCE` | `standard-core` | 외부 증거 대기 | 공식 표준 status 응답의 content-addressed 고정본이 없음 | 항목별 official HTML·PDF·WARC digest와 독립 승인 |
| `BS-CLAIM-SEMANTIC-VARIANTS` | `standard-core` | 외부 증거 대기 | 문자열 Gate 밖 동의어·문맥은 사람의 승인판정이 필요함 | 정형 declaration과 승인자·범위·만료 workflow |
| `BS-REAL-DATA-COVERAGE` | `bridge-runtime` | 구현·기관 증거 대기 | 운영 모집단·층화표본 mapping coverage와 유실 분포 미측정 | `REL-MAP-001` 실물 검증보고서·fixture·digest |
| `BS-CRS-COVERAGE` | `module-conditional: geo` | 외부 증거 대기 | Bounded CRS 시험은 통과했으나 기관 CRS 분포와 승인 허용오차가 없음 | 기관 corpus·snapshot·변환 정확도 시험 |
| `BS-DOMESTIC-VOCABULARY` | `module-conditional` | 외부 증거 대기 | 기관·공간·법령·license의 공통 IRI·변경정책 미승인 | `REL-VOC-001` 운영 registry 승인 |
| `BS-TRANSPORT-UNIT-SEMANTICS` | `module-conditional: observation` | 외부 증거 대기 | RC.1 관측모델은 구현했으나 기관 승인 ITS payload crosswalk fixture가 없음 | `TRANSPORT-UNIT-001` 기관 crosswalk·fixture |

`standards/provider-authority-registry.json`은 `blocked-no-approved-authority`다. `standards/iso19115-1-tech-gate/manifest.json`은 `blocked-pending-permission-or-approved-private-cache`다. 두 상태는 관련 blind spot과 별도로 실제 정본의 준비 여부를 확인한다.

## 4. 명령과 exit code

| 명령 | 확인 범위 | exit 0의 의미 |
| --- | --- | --- |
| `npm run verify` | 문서·registry·Node 시험·pySHACL | 운영체제 중립 기술시험 통과 |
| `npm run verify:release:win32-x64` | 기본 검증·installed tree·Jena toolchain·Jena SHACL | 검토된 win32-x64 기술 증거 일치 |
| `npm run release:status` | Provider·ISO를 포함한 legacy 운영 register | Legacy 운영 차단항목 없음 |
| `npm run release:status:rc:candidate` | RC 입력 4종과 Candidate 차단범위 | 로컬 표준·Module 결함, lock·Git 결함 없음 |
| `npm run release:status:rc` | RC 입력 4종과 Recommendation 차단범위 | Candidate 조건과 외부 표준·기관 증거를 모두 충족 |
| `npm run release:gate:win32-x64:candidate` | 전체 기술시험 뒤 Candidate 판정 | 기술시험과 Candidate 조건 충족 |
| `npm run release:gate:win32-x64` | 전체 기술시험 뒤 Recommendation 판정 | 기술시험과 Recommendation 조건 충족 |

`verify:release:win32-x64`의 이름은 release 대상 기술 lane을 뜻한다. 해당 명령의 성공만으로 운영 배포를 승인하지 않는다.

`release:status:rc`와 `release:gate:win32-x64`의 기본 대상은 Recommendation이다. Candidate만 확인하려면 이름 끝에 `:candidate`가 붙은 명령을 명시한다. `bridge-runtime` 항목은 두 Profile 판정에서 제외하며 connector 배포 승인과 legacy 운영 판정에서 별도로 닫는다.

## 5. 증거 변경 승인 절차

Node 설치 증거는 검토한 lock digest와 candidate digest를 두 단계로 승인한다.

```powershell
node tools/dependencies/node-install-evidence.mjs candidate --review-lock=<LOCK_SHA256> --clean-install
node tools/dependencies/node-install-evidence.mjs capture --review-lock=<LOCK_SHA256> --approve-evidence=<CANDIDATE_SHA256>
node tools/dependencies/node-install-evidence.mjs verify
```

Jena SHACL 증거도 toolchain manifest와 candidate evidence를 따로 승인한다.

```powershell
node tools/profile/run-jena-shacl-gate.mjs candidate --review-toolchain=<MANIFEST_SHA256>
node tools/profile/run-jena-shacl-gate.mjs capture --review-toolchain=<MANIFEST_SHA256> --approve-evidence=<CANDIDATE_SHA256>
node tools/profile/run-jena-shacl-gate.mjs verify
```

candidate 생성은 승인과 다르다. 검토자는 변경된 fixture·shape·normalization·dependency 범위와 digest를 확인한 뒤 capture 명령에 해당 digest를 명시한다.

## 6. 외부 조치와 담당

| 담당 | 제출물 | machine register 반영 조건 |
| --- | --- | --- |
| 사업·법무 | ISO·KS·TTA 합법 접근 근거와 보관정책 | artifact digest·검토자·검토 조항 등록 |
| 표준 담당 | 국내 DCAT version diff와 표준 status 고정본 | migration 시험과 independent review 통과 |
| 데이터 보유기관 | 대표 XML·RDF·DB export 정상·오류·삭제 fixture | 비식별 fixture digest와 interface 승인 |
| 공간정보 담당 | geometry corpus·기준점·허용 변환오차 | parser·왕복·정확도 시험 통과 |
| 운영 governance | Provider entry·위임·철회·trust anchor | production verifier와 registry 승인 |
| 발간 책임자 | 정형 conformance declaration 절차 | 승인자·범위·판·근거 digest·만료일 기록 |

## 7. 완료 판정

Candidate 판정은 다음 조건을 모두 만족해야 한다.

1. `npm run verify:release:win32-x64` exit 0
2. `release-acceptance.json`과 Korean register의 schema·profile version·reviewed digest 일치
3. Artifact lock 검증과 시작·종료 Git snapshot 일치
4. 로컬 `standard-core`·`module-conditional` 차단항목 0건
5. `npm run release:gate:win32-x64:candidate` exit 0

Recommendation은 Candidate 조건에 더해 외부 표준 원문, 기관 fixture, namespace, 라이선스와 governance 증거를 갖추고 `npm run release:gate:win32-x64`가 exit 0이어야 한다.

기존 데이터 플랫폼 connector를 운영하려면 `bridge-runtime` 항목도 별도 배포 Gate에서 닫아야 한다. Provider authority registry의 승인 entry·trust anchor, ISO XML cache 사용권한, 운영 데이터 mapping 결과는 Profile Candidate 판정으로 대체하지 않는다.

잔여 위험을 수용하는 경우에도 machine register의 기술 결함을 임의로 `fixed`로 바꾸지 않는다. 별도 승인 근거와 적용 범위·만료일을 기록한다.
