# Release 차단 Gate 현황

작성일: 2026-07-12  
기준일: 2026-07-12  
상태: Active / release blocked

## 1. 목적과 판정

이 문서는 win32-x64 release lane의 기술 검증과 실제 release 가능 판정을 구분한다. 판정 정본은 세 machine register다.

- `standards/korean-interoperability-register.json`
- `standards/provider-authority-registry.json`
- `standards/iso19115-1-tech-gate/manifest.json`

현재 판정은 `releaseEligible=false`다. 직전 release Gate 작업에서 blind spot 7개를 추가 해소해 machine register의 `fixed`는 10개다. release 차단항목은 14개가 남아 있다.

Provider authority entry와 ISO official bytes 사용 근거도 확보되지 않았다.

```powershell
npm run release:status
```

명령은 차단항목을 JSON으로 출력하고 exit code 2를 반환한다. 차단항목을 숨긴 채 기술시험 성공만으로 release 가능 상태를 만들지 않는다.

## 2. 이번 변경으로 해소한 항목

| 대상 machine register 항목 | 기존 문장·판정 | 수정 내용 | 검증 범위 |
| --- | --- | --- | --- |
| `BS-SHACL-ENGINE` | Jena 결과 정규화 비교 없음 | Apache Jena 6.1.0과 production engine의 13개 Core·Geo 사례 비교 | focus·path·severity·constraint·shape·value 비교, message·blank label 제외 |
| `BS-RDF-SERIALIZATION` | Turtle 전용 production loader | RDF/XML·JSON-LD·N-Triples·N-Quads ingest와 RDFC-1.0 digest | Jena parser와 5개 직렬화 비교, named graph 보존 |
| `BS-VALIDATOR-DEPENDENCIES` | 실제 설치 module byte 미고정 | 격리 `npm ci`, 149개 package tree·SBOM, Jena·JRE archive와 설치 tree 고정 | win32-x64 release lane |
| `BS-CROSSWALK-INVENTORY` | 수기 inventory와 mapping의 동시 누락 가능 | 안전 RDF/XML parser가 생성한 source path와 mapping 완전 대조 | 공공데이터포털 고정본 17개 path |
| `BS-XSD-DATATYPE-COVERAGE` | 일부 datatype만 검사 | 승인 datatype 15개의 lexical·value 검사와 unknown XSD datatype 거부 | 공개 RDF preflight |
| `BS-NETWORK-REGISTRY-DRIFT` | 수기 IANA 주소표 | official CSV 3종 snapshot과 생성 network policy | 고정본 검증 구현, scheduled refetch는 별도 운영과제 |
| `BS-CRS-REGISTRY-EVIDENCE` | 가변 OGC resolver 관찰만 기록 | CRS 7종과 EPSG coordinate system 2종의 byte·digest·semantic field 고정 | offline snapshot Gate |

해소 판정은 `fixed`와 `currentlyBlocksRelease=false`로 기록했다. 회귀 방지 시험은 `releaseGateRequired=true`를 유지한다.

## 3. 잔여 release 차단항목

| ID | 현재 상태 | 차단 사유 | 해소 조건 |
| --- | --- | --- | --- |
| `BS-ISO19115-XML-TECH` | 외부 증거 대기 | 125개 artifact manifest와 offline smoke는 있으나 official bytes 사용 근거가 없음 | ISO 허가 또는 기관 승인 private cache와 재현 결과 |
| `BS-ISO19115-KS-CLAUSE` | 외부 증거 대기 | 국내 KS 원문 조항과 기관 XML fixture 미확보 | 합법 원문 digest·조항표·정상·오류 fixture |
| `BS-TTA-CROSSWALK` | 외부 증거 대기 | TTA 원문 기준 cardinality·코드표 대조 미완료 | 합법 원문과 항목별 mapping·fixture |
| `BS-DCAT-KR-VERSION` | 외부 증거 대기 | 국내 DCAT profile과 DCAT-AP 3.0.1 migration 미검증 | version diff와 이중 validator |
| `BS-DB-CATALOG-CATEGORY` | 구현 대기 | 내부 DB 운영 metadata의 공개 DCAT 자동 승격 차단 Gate 없음 | 금지 mapping corpus와 `MAP-CATERR-001` |
| `BS-CRS-AXIS` | 부분 검증 | 2차원 Point lexical tuple만 시험 | 지원 geometry 전체 parser와 기준점 좌표변환 정확도 시험 |
| `BS-QUALITY-LOSS` | 구현 대기 | ISO 19157 result·method·scope 축약의 reverse rule 부족 | loss ledger와 `ISO-DQV-001` |
| `BS-AUTHORITY-REGISTRY` | 외부 증거 대기 | resolver는 있으나 승인 기관 entry·위임 증거·trust anchor가 없음 | 운영 registry·철회 확인·서명 verifier 승인 |
| `BS-STANDARD-STATUS-EVIDENCE` | 외부 증거 대기 | 공식 표준 status 응답의 content-addressed 고정본이 없음 | 항목별 official HTML·PDF·WARC digest와 독립 승인 |
| `BS-CLAIM-SEMANTIC-VARIANTS` | governance 대기 | 문자열 Gate 밖 동의어·문맥을 자동으로 완전 판정할 수 없음 | 정형 declaration과 사람 승인·범위·만료 workflow |
| `BS-REAL-DATA-COVERAGE` | 구현·기관 증거 대기 | 운영 모집단·층화표본 mapping coverage와 유실 분포 미측정 | `REL-MAP-001` 실물 검증보고서·fixture·digest |
| `BS-CRS-COVERAGE` | 구현·기관 증거 대기 | 실사용 CRS 폭과 지원 geometry의 변환 정확도 미검증 | `CRS-COVERAGE-001` corpus·snapshot·geometry 시험 |
| `BS-DOMESTIC-VOCABULARY` | 외부 증거 대기 | 코드표는 확인했으나 기관·공간·법령·license의 공통 IRI·변경정책 미승인 | `REL-VOC-001` 운영 registry 승인 |
| `BS-TRANSPORT-UNIT-SEMANTICS` | 구현 대기 | 교통 관측속도 의미·집계·단위 projection과 ITS fixture 없음 | `TRANSPORT-UNIT-001` 관측모델·crosswalk·fixture |

`standards/provider-authority-registry.json`은 `blocked-no-approved-authority`다. `standards/iso19115-1-tech-gate/manifest.json`은 `blocked-pending-permission-or-approved-private-cache`다. 두 상태는 관련 blind spot과 별도로 실제 정본의 준비 여부를 확인한다.

## 4. 명령과 exit code

| 명령 | 확인 범위 | 성공 의미 | 현재 예상 |
| --- | --- | --- | --- |
| `npm run verify` | 문서·registry·Node 시험·pySHACL | 운영체제 중립 기술시험 통과 | exit 0 |
| `npm run verify:release:win32-x64` | 기본 검증·installed tree·Jena toolchain·Jena SHACL | 검토된 win32-x64 기술 증거 일치 | exit 0 |
| `npm run release:status` | 세 machine register의 현재 판정 | 차단항목 0건일 때만 release 가능 | exit 2 |
| `npm run release:gate:win32-x64` | 기술 lane 뒤 release 판정 | 기술시험과 승인조건 모두 충족 | exit 2 |

`verify:release:win32-x64`의 이름은 release 대상 기술 lane을 뜻한다. 해당 명령의 성공만으로 운영 배포를 승인하지 않는다.

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

다음 조건을 모두 만족할 때만 `releaseEligible=true`로 전환한다.

1. `npm run verify:release:win32-x64` exit 0
2. machine register의 `currentlyBlocksRelease=true` 항목 0건
3. Provider authority registry의 승인 entry와 운영 trust anchor 존재
4. ISO technical Gate의 승인 cache와 offline smoke 통과
5. `npm run release:gate:win32-x64` exit 0

잔여 위험을 수용하는 경우에도 machine register의 기술 결함을 임의로 `fixed`로 바꾸지 않는다. 별도 승인 근거와 적용 범위·만료일을 기록한다.
