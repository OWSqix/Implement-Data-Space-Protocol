# 국토교통 기존 플랫폼의 데이터 스페이스 연계 연구

작성일: 2026-07-11  
작성 기준: 2026-07-14
상태: Active  
단계: MOLIT DCAT-AP 1.0.0-rc.1 Candidate / EDC 0.18.0 로컬 토폴로지 / PostgreSQL 기반 CaaS·DSaaS 구현 후보

## 1. 연구 질문

이 프로젝트가 답하려는 질문은 다음과 같다.

> 국토교통 분야의 Data Lake, Data Hub, 통합 검색 플랫폼을 교체하지 않고, 그 안의 데이터셋을 DSP Data Offering으로 게시하며 기존 플랫폼의 접근·구독·전송 기능을 데이터 스페이스 계약에 연결하려면 무엇이 필요한가.

Mobility Data Space와 Mobilithek의 연결이 기준 사례다. 데이터 스페이스는 인증과 메타데이터 게시·검색을 담당한다.

Mobilithek은 조건에 맞는 hosted·brokered 데이터의 구독과 전달을 수행한다. 데이터는 데이터 스페이스 중앙 저장소로 이관되지 않는다.

자세한 근거와 미확인 사항은 [MDS–Mobilithek 참조 사례](docs/01-research/mds-mobilithek-reference-case.md)에 정리한다.

이 저장소는 국토교통부의 공식 사업 또는 운영 시스템이 아니다. 개발 기준선은 EDC 0.18.0으로 고정했지만, 운영기관의 제품 채택과 배포 승인은 아직 없다.

기존 `src/discovery/` 구현은 `synthetic-test-only` approval과 `.invalid` URL만 허용한다. 이 경로의 outbox command는 `automaticDispatchAllowed=false`이며 실제 플랫폼·Catalog·Connector에 보내면 안 된다.

운영 연계용 코드는 별도 경로에 두었다. `src/bridge-runtime/`은 검증된 RDF와 분리 승인 원장을 거쳐 Provider Connector 관리 API에 게시한다.

`src/transfer-runtime/`은 Connector가 승인한 pull 전송을 플랫폼의 token·signed URL·snapshot·export job과 연결한다. 기관 API, Connector 관리 계약, 자격증명과 배포 증거가 없으므로 현재 저장소만으로 live 운영이 끝난 것은 아니다.

문서는 [작성 규칙](docs/writing-style.md)과 [기획보고서 문체 프로파일](docs/report-writing-style-profile.md)에 따라 작성한다. 보고서의 위계와 압축된 문어체는 유지하고 근거 없는 강조, 반복 요약, 상투적 대비와 기술적 단정은 제거한다.

## 2. 설계 기준

1. 기존 플랫폼을 system of record로 유지한다.
2. 플랫폼 metadata를 DSP Catalog로 복사하는 일과 실제 접근 가능한 Offering을 만드는 일을 구분한다.
3. Dataset과 delivery path의 역할은 `hosted`, `brokered`, `index-only`, `unknown` 중 하나로 판정한 뒤 연결 수준을 결정한다. 같은 Dataset과 delivery path에서는 네 값이 상호 배타적이며, 플랫폼 전체는 경로마다 역할이 다른 혼합형일 수 있다.
4. 원 보유기관, 플랫폼 운영자, Offering Provider, Connector 운영자, 계약 당사자와 전달 운영자를 별도 역할로 기록한다.
5. DSP는 Catalog, Contract Negotiation, Transfer Process를 담당한다. 실제 payload 전송 protocol과 플랫폼 내부 API는 별도 계약으로 다룬다.
6. DSP Agreement를 기존 플랫폼의 subscription, entitlement, token, export job 또는 stream 접근 제어 목록(Access Control List, ACL)과 연결한다.
7. 계약 종료와 Dataset 철회는 실제 접근권한 삭제까지 확인해야 끝난다.
8. 공개 데이터의 기존 이용허락을 DSP 계약으로 줄이지 않는다.
9. 개인정보, 교통카드 데이터, 공개제한 공간정보는 공개 데이터와 같은 PoC 경로에 넣지 않는다.
10. 화면에서 관찰한 내부 API를 공식 server-to-server 연계 계약으로 간주하지 않는다.

## 3. 현재 확인된 결론

| 항목 | 현재 판단 | 남은 확인 |
| --- | --- | --- |
| MDS–Mobilithek | MDS 계약과 Mobilithek 구독·전달 수명주기가 연결된 공개 사례 | Connector 내부 topology, 실제 DSP ID mapping, 실패 보상, data-plane profile |
| 국토교통 통합채널 | 검색·metadata·원천 링크 기능은 확인 | Dataset과 delivery path별 `hosted`·`brokered` 여부와 구독·전달 API |
| 분석센터 Open API | 회원 화면의 정의와 신청 절차 확인 | 지원 hostname·DNS·HTTPS, server-to-server 범위, SLA |
| DSP | Catalog·계약·전송 제어의 기준 | 실제 transfer profile과 Connector 제품 선택 |
| Provider 모델 | 역할을 데이터셋별 증거로 결정 | 계약·재제공·credential 위임 문서 |
| Metadata profile | DCAT-AP 3.0.1 기반 1.0.0-rc.1 Candidate, 모듈별 SHACL·요구사항 원장·고정 증거 구현 | Recommendation 차단항목과 기관 승인 |
| Profile·ontology namespace | `/def`·`/profile` 서버, content negotiation, artifact lock·원격 attestation 구현 | DNS·공인 TLS·운영 승인과 어휘 namespace |
| Provider 게시 Bridge | 원천 poll, staged RDF Gate, 분리 승인, durable queue, 관리 API 게시 구현 | 기관별 crosswalk·Connector 관리 API·멱등 계약 |
| 전송 provisioning | 승인 상태 재조회, private binding, pull DataAddress 발급·철회 journal 구현 | Connector webhook inbox, push·suspend·complete adapter, 실제 Data Plane 시험 |
| EDC 로컬 토폴로지 | EDC 0.18.0 Provider·Consumer의 Control Plane과 Data Plane 배포판 구성, 이전 clean-volume smoke 결과 보존 | 현재 source의 recorder 결합 재실행, 운영 DPS 전송 worker, 외부 DSP 구현 시험 |
| CaaS | Scoped PostgreSQL 정본·RLS, Kubernetes EDC 수명주기·fencing, 운영 신원·관측 runtime 구현 | 운영 cluster의 외부 fencing·HA 실증과 P1 DSP Gate |
| DSaaS | 데이터 스페이스별 정본·RLS, 참가 승인·CaaS generation 수렴, 운영 신원·관측 runtime 구현 | 기관 승인 Registry, 운영 multi-zone·PITR 실증과 P1 Catalog·정책 Gate |
| PoC | 공개 데이터로 lifecycle을 먼저 검증 | 실제 플랫폼 후보와 sandbox 승인 |

## 4. 문서 읽는 순서

처음 읽는 경우에는 다음 순서를 권한다.

경로 범례: `docs/02-architecture/`는 시스템·프로토콜·보안 정본, `docs/02-design/`은 분야 규약·거버넌스·상용 경계 설계다.

1. [기본 개념](docs/00-concepts-primer.md)
2. [프로젝트 헌장](docs/00-project-charter.md)
3. [기획보고서 기술 검토 및 수정안](docs/01-research/planning-report-technical-review.md)
4. [MDS–Mobilithek 참조 사례](docs/01-research/mds-mobilithek-reference-case.md)
5. [기존 플랫폼 연계 패턴](docs/01-research/existing-platform-integration-patterns.md)
6. [국토교통 통합채널 역량 프로필](docs/01-research/molit-platform-capability-profile.md)
7. [현행 플랫폼 조사](docs/01-research/current-state-and-evidence.md)
8. [표준·법제 기준선](docs/01-research/standards-and-legal-baseline.md)
9. [국내 표준 상호운용성 및 blind spot 검증](docs/01-research/korean-standards-interoperability.md)
10. [원천·권리 인벤토리](docs/01-research/source-and-rights-inventory.md)
11. [운영기관 확인 질문](docs/01-research/operator-questionnaire.md)
12. [운영기관 문의 패키지](docs/01-research/operator-inquiry-package.md)
13. [갭 분석](docs/01-research/gap-analysis.md)
14. [요구사항](docs/02-architecture/requirements.md)
15. [목표 아키텍처](docs/02-architecture/target-architecture.md)
16. [EDC 기반 CaaS·DSaaS 구성 설계](docs/02-architecture/edc-caas-dsaas-architecture.md)
17. [Platform-to-Dataspace Bridge](docs/02-architecture/platform-connector-bridge.md)
18. [Offering 온보딩과 접근 수명주기](docs/02-architecture/offering-onboarding-lifecycle.md)
19. [기존 플랫폼 인터페이스 계약](docs/02-architecture/platform-interface-contract.md)
20. [메타데이터·정책 프로필](docs/02-architecture/metadata-and-policy-profile.md)
21. [응용 프로파일 0.1.0 명세](profiles/molit-dcat-ap/releases/0.1.0/index.md)
22. [전송 어댑터](docs/02-architecture/integration-adapters.md)
23. [보안·신뢰·운영](docs/02-architecture/security-trust-and-operations.md)
24. [PoC 후보 목록](docs/03-plan/poc-candidate-shortlist.md)
25. [실증·로드맵](docs/03-plan/pilot-and-roadmap.md)
26. [검증 계획](docs/03-plan/verification-plan.md)
27. [release 차단 Gate 현황](docs/03-plan/release-gate-status.md)
28. [위험 대장](docs/03-plan/risk-register.md)
29. [Discovery Bridge 구현](docs/04-implementation/discovery-bridge.md)
30. [MOLIT DCAT-AP 1.0.0-rc.1 구현 해설](docs/04-implementation/molit-dcat-ap-implementation-guide.md)
31. [Provider 게시 Bridge 운영 구현](docs/04-implementation/production-bridge-runtime.md)
32. [공급자 전송 provisioning Worker](docs/04-implementation/provider-transfer-worker.md)
33. [EDC 로컬 상호운용 토폴로지](docs/04-implementation/edc-local-interoperability.md)
34. [EDC v4 게시 Adapter](docs/04-implementation/edc-v4-publication-adapter.md)
35. [CaaS Connector 제어 평면](docs/04-implementation/caas-control-plane.md)
36. [DSaaS 제어 평면](docs/04-implementation/dsaas-control-plane.md)
37. [Profile·ontology namespace 배포](docs/04-implementation/stable-namespace-operations.md)
38. [운영 신원 계층](docs/04-implementation/operational-identity.md)
39. [tenant 격리](docs/04-implementation/tenant-isolation.md)
40. [관측성·감사·공급망](docs/04-implementation/observability-and-supply-chain.md)
41. [P0 운영 제어면 구현과 검증](docs/04-implementation/p0-control-plane-verification.md)
42. [결정 기록](docs/adr/README.md)
43. [상용 CaaS·DSaaS 제품 기준선](docs/02-design/commercial-caas-dsaas-baseline.md)
44. [EDC·CaaS·DSaaS 작업 인계 기록](docs/03-plan/edc-caas-dsaas-handoff-2026-07-14.md)
45. [상용 readiness machine register](governance/commercial-readiness-register.v1.json)
46. [데이터 스페이스 실태 조사](docs/01-research/dataspace-landscape-survey.md)
47. [분야 참여 유인 분석](docs/01-research/sector-adoption-levers.md)
48. [단일형·분야형 구성 연구](docs/01-research/dataspace-topology-single-vs-sectoral.md)
49. [데이터 스페이스 개념·용어 감사](docs/01-research/dataspace-concept-audit.md)
50. [DSSC 빌딩블록 갭 등록부](docs/01-research/dssc-gap-register.md)
51. [참가자 온보딩·보증 설계](docs/02-architecture/participant-onboarding-and-assurance.md)
52. [교통모빌리티 분야 규약 골격](docs/02-design/sector-rulebook-framework.md)
53. [거버넌스·운영 원칙](docs/02-design/governance-and-operating-principles.md)
54. [초기 유즈케이스·KPI](docs/03-plan/initial-usecases-and-kpi.md)

조사의 근거는 다음 파일에서 추적한다.

- [로그인 후 탐색 근거](evidence/authenticated-exploration/README.md)
- [출처 레지스터](evidence/source-register.yaml)
- [주장-근거 매트릭스](evidence/claim-evidence-matrix.md)

## 5. 이 프로젝트가 만드는 것

```text
molit-dataspace/
  package.json          구현·시험·문서 검사 명령
  report-style.config.json
  contracts/           metadata batch·Connector 등록 후보·SHACL report schema
  fixtures/discovery/  운영 데이터가 아닌 합성 계약시험 자료
  src/discovery/       분류·Gate·증분 동기화·상태·outbox
  src/bridge-runtime/  운영 플랫폼 poll·RDF Gate·Connector 게시 queue
  src/transfer-runtime/ Connector 승인 전송과 플랫폼 자원 provisioning
  src/caas/            Connector tenant·desired state·provisioner 제어면
  src/dsaas/           데이터 스페이스·membership·CaaS 조정 제어면
  src/publication/     Profile·ontology namespace HTTP 서버와 attestation
  src/profile/         RDF loading·artifact lock·SHACL validation
  src/cli.mjs          baseline·delta 실행 명령
  tests/               단위·통합 시험
  profiles/            DCAT-AP 기반 응용 프로파일·ontology·SHACL·vocabulary
  deploy/edc/          EDC 0.18.0 Control Plane·Data Plane 로컬 토폴로지
  governance/          후보 데이터 스페이스 거버넌스 묶음
  standards/           국내 표준 상태·증거 수준·blind spot machine register
  docs/
    01-research/       공식 사례·현행 역량·법·권리 조사
    02-architecture/   Bridge·Offering·DSP·Data Plane 설계
    03-plan/           후보·검증·운영 전환 계획
    04-implementation/ 구현 범위·실행·검증 기록
    adr/               선택지와 결정 근거
  evidence/            출처와 관찰·주장 추적
  templates/           Dataset 승인·운영 양식
  tools/report-style/  문체 prompt·template·CLI·test
```

- **(착수)** 2026-07-11 개발 착수 지시에 따라 `src/`와 `tests/` 추가
- **(격리 유지)** 합성 fixture만 처리하는 Discovery Bridge S1
- **(현재 구현)** DCAT-AP 3.0.1 기반 국토교통 응용 프로파일 1.0.0-rc.1 Candidate와 검증 CLI
- **(현재 구현)** staged RDF Gate와 분리 승인을 적용한 Provider 게시 Bridge
- **(현재 구현)** Connector 승인 pull 전송의 platform provisioning·revoke Worker
- **(현재 구현)** Profile·ontology namespace 서버와 배포·원격 attestation 도구
- **(현재 구현)** EDC v4 게시 Adapter와 동일 구현 간 로컬 상호운용 smoke
- **(현재 구현)** CaaS·DSaaS scoped PostgreSQL 정본·RLS, Kubernetes 수명주기·fencing, 운영 신원·관측·공급망과 graceful shutdown
- **(미연결)** 기관별 원천 crosswalk, 운영 DPS worker, push·suspend·complete Data Plane과 P1 Catalog·정책 집행
- **(상용 차단)** 운영기관 신원 ceremony, OTLP·WORM backend, multi-zone 장애훈련, registry·KMS release와 최종 image DSP TCK·이기종 Connector 시험
- **(후속 승인)** DNS·TLS·namespace·어휘·Connector 제품·기관 운영 배포

상위 저장소의 `docs/blog/code/dsp-python`은 DSP version endpoint 학습용 scaffold이며 운영 Connector나 이 프로젝트의 구현체로 보지 않는다.

### 5.1 구현 실행

Node.js 24 이상에서 상태 파일을 비운 뒤 합성 baseline과 delta를 순서대로 실행한다.

```powershell
Remove-Item -LiteralPath .local/discovery-state.json -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .local/baseline-report.json -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .local/delta-report.json -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .local/review-assessment.json -Force -ErrorAction SilentlyContinue
npm run bridge:sync:baseline
npm run bridge:sync:delta
npm run bridge:review
npm run bridge:inspect
```

`.local/discovery-state.json`은 source mapping, 판정, Connector 등록 후보와 미처리 outbox를 보존한다. `.local/*-report.json`은 batch별 적용·중복·역순·격리 결과를 기록한다. 두 경로는 Git에 반영하지 않는다.

`bridge:review`는 현재 approval registry, projection config와 trusted clock으로 pending command를 다시 검증한다. stdout에는 식별자와 digest summary만 쓴다.

private binding reference가 포함된 전체 assessment는 필수 `--report` target에 기록한다. POSIX에서는 mode `0600`을 요청한다.

Windows에서는 상위 directory의 접근제어목록을 상속하므로 별도 보안 경계로 간주하지 않는다. 이 명령도 Connector나 운영 플랫폼을 호출하지 않는다.

세부 계약과 판정 규칙은 [Discovery Bridge 구현](docs/04-implementation/discovery-bridge.md)에 정리한다.

### 5.2 운영 연계 런타임

다음 명령은 소스 실행 진입점이다. 예제 도메인과 `.local` 경로를 기관 설정으로 교체하고, 환경 변수에 자격증명을 주입한 뒤 사용한다.

```powershell
npm run namespace:serve
npm run bridge:runtime:dry-run
npm run bridge:runtime:once
npm run transfer:worker -- `
  --config fixtures/transfer-runtime/config.example.json `
  --bindings fixtures/transfer-runtime/bindings.example.json `
  --event fixtures/transfer-runtime/start-event.example.json
```

`bridge:runtime`은 Provider 게시용이다. DSP Consumer 참조 시험과 Provider 전송 provisioning은 서로 다른 프로세스다. 설정·승인 원장·상태 복구와 Connector별 완료조건은 [Provider 게시 Bridge 운영 구현](docs/04-implementation/production-bridge-runtime.md)과 [공급자 전송 provisioning Worker](docs/04-implementation/provider-transfer-worker.md)를 따른다.

EDC 로컬 토폴로지와 두 제어면은 다음 명령으로 확인한다.

```powershell
./tools/edc/run-smoke.ps1
npm run caas:serve
npm run dsaas:serve
npm run test:caas
npm run test:dsaas
npm run commercial:status
```

`run-smoke.ps1`은 동일한 EDC 0.18.0 구현 두 개 사이의 시험이다. 성공해도 외부 DSP 구현과의 이기종 상호운용을 입증하지 않는다. CaaS 예제는 Connector process를 배포하지 않는 `dry-run-manifest` Adapter다. DSaaS 예제 Registry는 운영 승인 증거가 아니므로 그대로 개통에 쓰지 않는다.

`commercial:status`는 `governance/commercial-readiness-register.v1.json`을 읽는다. 미해결 상용 Gate가 있으면 `commercialReady=false`와 차단 항목을 출력하고 exit code 2를 반환한다. 2026-07-14 현재 이 판정은 `blocked`다.

### 5.3 검증

Node.js 24 이상과 Python 3.12를 사용한다. 독립 SHACL lane의 Python 패키지는 전이 의존성을 포함한 wheel hash로 고정했다.

```powershell
py -3.12 -m pip install -r requirements-profile-validation.txt
```

Linux CI에서는 승인된 Python 3.12 환경에서 다음과 같이 설치한다.

```bash
python3 -m pip install -r requirements-profile-validation.txt
```

설치 뒤 다음 명령을 실행한다.

```powershell
npm run verify
npm run profile:verify
npm run profile:verify:independent
npm run profile:validate:example
```

기본 `verify`는 운영체제 중립 검사다. win32-x64 release 기술 lane은 별도 명령으로 실행한다.

```powershell
npm run verify:release:win32-x64
npm run release:status
npm run release:gate:win32-x64
```

`verify:release:win32-x64`는 Node 설치 tree·SBOM과 Apache Jena 6.1.0·Temurin JRE 21 설치 증거를 검사한다. 이 명령의 성공은 기술 증거의 일치를 뜻하며 release 승인과 같지 않다.

P0 운영 제어면의 전체 로컬 검증과 aggregate 증거 재검증은 다음 명령을 사용한다.

```powershell
npm run verify:p0:local
npm run verify:p0:evidence
```

첫 명령은 고정한 실행 원장의 전 단계를 순서대로 실행한다. 두 번째 명령은 현재 checkout, 실행 profile, 원시 log와 중첩 JSON 증거의 SHA-256을 다시 확인한다. 세부 완료조건은 [P0 운영 제어면 구현과 검증](docs/04-implementation/p0-control-plane-verification.md)을 따른다.

같은 release lane은 `edc:verify:runtime`도 실행한다. 이 Gate는 EDC 세 실행 JAR의 컴파일, Java 17 class, base Data Plane의 smoke class 부재와 Compose 모델을 검사한다. 실제 두 Connector의 Docker 전송 시험은 `tools/edc/run-smoke.ps1`에서 별도로 실행한다.

Jena lane은 다음 경로에 사전 배치된 검토본을 사용한다.

```text
.local/toolchains/cache/
.local/toolchains/install/
standards/toolchains/jena-parser-lane.win32-x64.json
standards/vendor/toolchain-checksums/2026-07-12/
```

verifier는 archive의 publisher checksum snapshot, archive digest와 설치 tree digest를 확인한다.

배포 signature 검증은 수행하지 않는다. 해당 제한은 manifest의 `signatureVerification=not-performed`에 기록된다.

저장소에는 network download·압축 해제 명령을 두지 않는다. clean clone에서는 기관이 승인한 artifact 전달·안전한 압축 해제 절차로 위 경로를 먼저 배치해야 한다.

Discovery 상태를 초기화할 때 `.local` 전체를 삭제하지 않는다. `.local/toolchains`를 삭제하면 release lane의 검토된 archive와 설치 tree도 함께 사라진다.

`release:status`는 machine register, Provider authority registry와 ISO 19115 technical Gate를 읽는다. 미해결 항목이 있으면 JSON에 `releaseEligible=false`를 기록하고 exit code 2를 반환한다. 현재 판정과 해소 책임은 [release 차단 Gate 현황](docs/03-plan/release-gate-status.md)에 정리한다.

`release:status`는 응용 프로파일 release 판정이고 `commercial:status`는 CaaS·DSaaS 상용 운영 판정이다. 한 명령의 통과가 다른 판정을 대신하지 않는다.

파일 단위 검사는 다음 명령을 사용한다.

```powershell
node tools/report-style/cli.mjs lint docs/path/to/report.md --fail-on warning
```

명령, rule과 suppression 기준은 [보고서 문체 하네스](tools/report-style/README.md)에 정리한다.

## 6. 문서에서 쓰는 상태

- `Verified`: 1차 출처 또는 재현 가능한 관찰에서 직접 확인
- `Inferred`: 확인 사실로부터 도출했지만 운영기관 확인이 필요한 판단
- `Unverified`: 문서·담당기관·시험으로 확인하지 못함
- `Decision`: 프로젝트가 제안한 선택이며 승인 전에는 확정 사실이 아님

일반 문서의 상태는 `Draft`·`Review`·`Accepted`·`Active`·`Superseded`로 기록한다.

ADR은 `Proposed`·`Accepted`·`Rejected`·`Superseded`·`Deprecated`를 사용한다. `Proposed` ADR을 승인된 기본 구조처럼 사용하지 않는다.

## 7. 지금 하지 않는 결정

- 통합채널이 중앙 DSP Catalog Broker를 운영한다고 미리 정하지 않는다.
- 원천기관마다 Connector를 설치한다고 미리 정하지 않는다.
- EDC 0.18.0 개발 기준선을 운영기관의 최종 제품 채택이나 Virtual Connector 승인으로 확대 해석하지 않는다.
- 통합채널의 모든 검색 record를 DSP Dataset으로 변환하지 않는다.
- 인증 화면에서 보인 API key, cookie, 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 방어값과 원시 응답을 저장하지 않는다.
- 운영기관의 승인 없이 활용신청, API key 발급, 외부 문의 또는 데이터 변경을 수행하지 않는다.
