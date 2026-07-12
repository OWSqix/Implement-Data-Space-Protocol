# 국토교통 기존 플랫폼의 데이터 스페이스 연계 연구

작성일: 2026-07-11  
작성 기준: 2026-07-12  
상태: Active  
단계: Implementation / Discovery Bridge S1 + Metadata Profile 0.1.0

## 1. 연구 질문

이 프로젝트가 답하려는 질문은 다음과 같다.

> 국토교통 분야의 Data Lake, Data Hub, 통합 검색 플랫폼을 교체하지 않고, 그 안의 데이터셋을 DSP Data Offering으로 게시하며 기존 플랫폼의 접근·구독·전송 기능을 데이터 스페이스 계약에 연결하려면 무엇이 필요한가.

Mobility Data Space와 Mobilithek의 연결이 기준 사례다. 데이터 스페이스는 인증과 메타데이터 게시·검색을 담당한다.

Mobilithek은 조건에 맞는 hosted·brokered 데이터의 구독과 전달을 수행한다. 데이터는 데이터 스페이스 중앙 저장소로 이관되지 않는다.

자세한 근거와 미확인 사항은 [MDS–Mobilithek 참조 사례](docs/01-research/mds-mobilithek-reference-case.md)에 정리한다.

이 저장소는 국토교통부의 공식 사업 또는 운영 시스템이 아니다. 특정 Connector 제품, 배포 환경, 운영기관도 아직 채택하지 않았다.

현재 코드는 `synthetic-test-only` approval과 `.invalid` URL만 허용한다. 모든 outbox command는 `automaticDispatchAllowed=false`이며 실제 플랫폼·Catalog·Connector에 보내면 안 된다.

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
| Metadata profile | DCAT-AP 3.0.1 기반 0.1.0 Working Draft, Core·Geo SHACL과 고정 preflight 구현 | 운영 URI, 실제 레코드 mapping과 기관 승인 |
| PoC | 공개 데이터로 lifecycle을 먼저 검증 | 실제 플랫폼 후보와 sandbox 승인 |

## 4. 문서 읽는 순서

처음 읽는 경우에는 다음 순서를 권한다.

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
16. [Platform-to-Dataspace Bridge](docs/02-architecture/platform-connector-bridge.md)
17. [Offering 온보딩과 접근 수명주기](docs/02-architecture/offering-onboarding-lifecycle.md)
18. [기존 플랫폼 인터페이스 계약](docs/02-architecture/platform-interface-contract.md)
19. [메타데이터·정책 프로필](docs/02-architecture/metadata-and-policy-profile.md)
20. [응용 프로파일 0.1.0 명세](profiles/molit-dcat-ap/releases/0.1.0/index.md)
21. [전송 어댑터](docs/02-architecture/integration-adapters.md)
22. [보안·신뢰·운영](docs/02-architecture/security-trust-and-operations.md)
23. [PoC 후보 목록](docs/03-plan/poc-candidate-shortlist.md)
24. [실증·로드맵](docs/03-plan/pilot-and-roadmap.md)
25. [검증 계획](docs/03-plan/verification-plan.md)
26. [release 차단 Gate 현황](docs/03-plan/release-gate-status.md)
27. [위험 대장](docs/03-plan/risk-register.md)
28. [Discovery Bridge 구현](docs/04-implementation/discovery-bridge.md)
29. [결정 기록](docs/adr/README.md)

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
  src/profile/         RDF loading·artifact lock·SHACL validation
  src/cli.mjs          baseline·delta 실행 명령
  tests/               단위·통합 시험
  profiles/            DCAT-AP 기반 응용 프로파일·ontology·SHACL·vocabulary
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
- **(현재 구현)** 합성 fixture를 처리하는 Connector 중립 Discovery Bridge
- **(현재 구현)** DCAT-AP 3.0.1 기반 국토교통 응용 프로파일 0.1.0과 로컬 검증 CLI
- **(미연결)** 운영 플랫폼 API, DSP Connector, Data Plane과 entitlement
- **(미연결)** Bridge v1 candidate와 응용 프로파일 RDF projection
- **(후속 승인)** 제품 Spike와 ADR 승인 뒤 `deploy/` 추가 및 EDC·CaaS 채택

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

### 5.2 검증

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
- EDC 또는 CaaS를 선결 채택하지 않는다.
- 통합채널의 모든 검색 record를 DSP Dataset으로 변환하지 않는다.
- 인증 화면에서 보인 API key, cookie, 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 방어값과 원시 응답을 저장하지 않는다.
- 운영기관의 승인 없이 활용신청, API key 발급, 외부 문의 또는 데이터 변경을 수행하지 않는다.
