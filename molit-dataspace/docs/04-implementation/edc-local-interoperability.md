# EDC 로컬 상호운용 토폴로지

작성일: 2026-07-13
대상 버전: Eclipse Dataspace Components Connector 0.18.0
상태: 이전 로컬 Docker 실행 결과 보존, 현재 source의 recorder 결합 재실행 전, 운영 Data Plane Signaling worker 구현 전

## 1. 목적과 검증 범위

`deploy/edc/`는 Provider와 Consumer를 서로 다른 프로세스로 띄운다. 각 참여자는 Control Plane과 Data Plane을 따로 가진다. 네 프로세스가 같은 JVM을 공유하지 않는다.

| 참여자 | 프로세스 | 데이터베이스 | 맡는 일 |
| --- | --- | --- | --- |
| Provider | `provider-control-plane` | `provider_cp` | Catalog, 계약 협상, 전송 상태 |
| Provider | `provider-data-plane` | `provider_dp` | Data Plane self-registration, HTTP 데이터 처리 |
| Consumer | `consumer-control-plane` | `consumer_cp` | Catalog 조회, 계약 요청, 전송 요청 |
| Consumer | `consumer-data-plane` | `consumer_dp` | Consumer 측 Data Plane 독립 배치 확인 |

PostgreSQL 서버는 하나지만 데이터베이스를 네 개로 나눴다. EDC SQL 확장이 시작할 때 필요한 표를 만든다. 이 구성은 단일 노드 개발·CI용이다.

네 데이터베이스가 같은 PostgreSQL superuser와 password를 쓰므로 데이터베이스 이름은 보안 경계가 아니다. 운영 배포에서는 데이터베이스별 non-superuser role과 credential을 발급하고 최소 `GRANT`를 적용한다. 다른 참여자 데이터베이스 접속이 거부되는 음성시험도 통과해야 한다.

Smoke 시험은 다음 순서로 진행한다.

1. Provider의 버전 미지정 DSP root에서 `/.well-known/dspace-version`을 읽는다.
2. 응답이 광고한 `/2025-1` 경로를 DSP root에 한 번만 붙인다.
3. Provider Management API v4로 Asset, Policy Definition, Contract Definition을 만든다.
4. Consumer가 Provider DSP Catalog를 조회한다.
5. Catalog Dataset의 `hasPolicy` 조건을 보존한다. EDC 0.18.0이 생략한 `assigner`와 `target`만 Catalog 참여자와 Dataset ID로 채운다.
6. 협상이 `FINALIZED`가 될 때까지 v4 state API를 조회한다.
7. 협상 결과의 Contract Agreement ID를 전송 요청의 `contractId`로 사용한다.
8. `HttpData-PULL` 전송이 `STARTED`가 되었는지 확인한다.
9. `transfer.process.started` callback의 transfer·agreement·asset ID가 요청과 같은지 확인한 뒤 DataAddress로 실제 bytes를 읽는다.
10. Content-Type과 SHA-256을 고정 fixture와 비교한다.
11. 전송 종료를 요청하고 `TERMINATED` 또는 `DEPROVISIONED`를 확인한다.
12. 같은 DataAddress token으로 다시 요청해 401 또는 403이 반환되는지 확인한다.

`STARTED`만 보고 성공으로 처리하지 않는다. 전송 상태, 실제 payload, 종료 상태를 따로 검사한다.

## 2. 고정한 upstream

Connector는 공식 태그 [`v0.18.0`](https://github.com/eclipse-edc/Connector/releases/tag/v0.18.0), commit [`911a22b`](https://github.com/eclipse-edc/Connector/commit/911a22ba6b90688ffeb35bb92bf5cc040ffdf37f)에 고정했다. EDC는 이 용도의 완성 Docker 이미지를 배포하지 않으므로, 공식 Maven Central artifact로 두 실행 JAR을 만든다.

- `controlplane-base-bom:0.18.0`
- `controlplane-feature-sql-bom:0.18.0`
- `dataplane-base-bom:0.18.0`
- `dataplane-feature-sql-bom:0.18.0`
- 로컬 신원 시험용 `iam-mock:0.18.0`
- 로컬 legacy Data Plane 호환용 `transfer-data-plane-signaling:0.18.0`

Management API는 안정 경로인 `/management/v4`를 사용한다. `/v5beta/participants/{participantContextId}`는 Virtual Connector API이므로 이 토폴로지의 호환성 근거로 쓰지 않는다. DSP는 `dataspace-protocol-http:2025-1`을 사용한다.

JDK와 JRE container image는 17로 고정했다. Gradle root는 모든 `JavaCompile` task에 `--release 17`을 강제한다.

최종 빌드에서 이 저장소가 추가한 로컬 class 5개가 class-file major version 61인지 검사했다.

Gradle wrapper, EDC commit, Samples 원본, container image digest는 `deploy/edc/upstream-lock.json`에 기록했다.

Samples에서 고친 smoke class와 Gradle wrapper의 고지문은 `deploy/edc/THIRD_PARTY_NOTICES.md`에, Apache-2.0 원문은 `deploy/edc/licenses/Apache-2.0.txt`에 넣었다. 검증기는 라이선스 파일 digest도 upstream lock과 비교한다.

구현 판단에는 다음 upstream 파일을 사용했다.

- [Control Plane base BOM](https://github.com/eclipse-edc/Connector/blob/v0.18.0/dist/bom/controlplane-base-bom/build.gradle.kts)
- [Data Plane base BOM](https://github.com/eclipse-edc/Connector/blob/v0.18.0/dist/bom/dataplane-base-bom/build.gradle.kts)
- [Management API v4 transfer interface](https://github.com/eclipse-edc/Connector/blob/v0.18.0/extensions/control-plane/api/management-api/transfer-process-api/src/main/java/org/eclipse/edc/connector/controlplane/api/management/transferprocess/v4/TransferProcessApiV4.java)
- [DSP version discovery controller](https://github.com/eclipse-edc/Connector/blob/v0.18.0/data-protocols/dsp/dsp-version/dsp-version-http-api/src/main/java/org/eclipse/edc/protocol/dsp/version/http/api/DspVersionApiController.java)
- [Provider·Consumer 분리 E2E runtime 구성](https://github.com/eclipse-edc/Connector/blob/v0.18.0/system-tests/e2e-transfer-test/runner/src/test/java/org/eclipse/edc/test/e2e/Runtimes.java)

## 3. legacy Data Plane과 PULL smoke artifact

두 Data Plane artifact를 섞지 않는다.

| Docker target | 내용 | 사용처 |
| --- | --- | --- |
| `data-plane` | 공식 legacy EDC Data Plane BOM과 SQL BOM, smoke proxy 없음 | 로컬 호환용 기본 `compose.yaml` |
| `smoke-data-plane` | 위 BOM + GET 전용 시험 proxy + ephemeral key loader | `compose.smoke.yaml` |

EDC 0.18.0은 이 Data Plane을 deprecated로 표시한다. 로컬 시험에서는 `transfer-data-plane-signaling`을 사용하고 새 DPS controller를 제외했다. 두 controller를 함께 두면 새 메시지가 legacy API로 전달되어 전송이 실패한다.

이 조합은 EDC 0.18.0끼리의 회귀 시험에만 쓴다. 운영 배포에는 Data Plane Signaling 규격을 구현한 별도 worker가 필요하며, 현재 release blocker다.

Eclipse EDC Connector 본체는 Consumer PULL용 공개 HTTP proxy를 제공하지 않는다. 공식 Samples도 이 proxy를 예제용이며 운영에 쓰지 말라고 명시한다. 이 저장소의 proxy는 [EDC Samples의 Consumer Pull 예제](https://github.com/eclipse-edc/Samples/tree/main/transfer/transfer-03-consumer-pull)를 바탕으로 다음 범위에만 넣었다.

- 별도 Gradle module과 별도 Docker target
- `edc.molit.smoke.enabled=true`가 없으면 시작 거부
- Compose 내부망에서만 접근, host port 미공개
- `/public/data.json` GET만 허용
- 권한 정보의 원천 주소가 고정된 `http://provider-backend:8080`인지 검사
- 요청 path, query, header를 upstream 요청에 전달하지 않고 고정된 `/data.json`만 조회
- redirect 금지, connect/request timeout 적용
- 일회성 PKCS#12 key를 시작할 때 생성
- 소스·설정에 sample private key 미포함

기본 `compose.yaml`의 base Data Plane JAR에는 이 코드가 들어가지 않는다.

`verify-topology.mjs`는 base source tree, Gradle dependency, Docker build stage, Compose target, base 설정을 함께 검사한다.

실제 PULL 서비스를 배포할 때는 별도 공개 데이터 전달 계층을 EDC `PublicEndpointGeneratorService`와 연결한다. 이 계층에는 다음 기능이 필요하다.

- destination·scheme·port allowlist와 DNS rebinding 방어
- tenant와 agreement binding
- 요청·응답 byte 제한, 시간 제한, 동시성 제한
- redirect 정책
- token 폐기와 key rotation
- 감사 로그와 payload 비기록 원칙
- rate limit, WAF, egress proxy
- TLS와 외부 secret manager

Smoke proxy가 통과했다는 사실은 운영 DPS worker와 공개 전달 계층이 구현됐다는 뜻이 아니다.

## 4. 실행

Docker daemon이 실행 중인 환경에서 다음 명령을 사용한다.

```powershell
./tools/edc/run-smoke.ps1
```

현재 source와 실행 결과를 한 증거로 묶을 때는 출력 경로를 명시한다.

```powershell
./tools/edc/run-smoke.ps1 `
  -RecordEvidence evidence/edc/runs/20260714T120000+0900-local.json
```

Linux CI에서는 다음 명령을 사용한다.

```bash
bash tools/edc/run-smoke.sh
```

```bash
bash tools/edc/run-smoke.sh \
  --record-evidence evidence/edc/runs/20260714T120000+0900-local.json
```

증거 옵션은 실행 전 `prepare`, cleanup 뒤 `complete` 단계를 호출한다. 두 단계의 source digest가 다르면 파일을 만들지 않는다.

raw run에는 다음 값을 기록한다.

- Git HEAD와 EDC 범위의 worktree 상태
- 시작·종료 시각과 smoke exit code
- Docker server와 실행 image ID
- clean-start와 cleanup 결과
- stdout 원문, SHA-256과 파싱 결과

worktree가 깨끗한지는 기록 항목이지 현재 recorder의 성공 조건은 아니다. release 증거로 채택할 때는 `git.cleanAtStart=true`, `git.cleanAtEnd=true`와 source commit을 별도 Gate에서 요구해야 한다.

Java artifact와 Compose 모델만 release Gate에서 다시 검사하려면 다음 명령을 사용한다.

```powershell
npm run edc:verify:runtime
```

이 명령은 static topology, 세 Shadow JAR, Java 17 bytecode, base Data Plane의 smoke class 부재와 Compose 병합 모델을 검사한다. Docker 상호운용 smoke는 별도 명령으로 유지한다.

스크립트가 PostgreSQL password와 두 Management API key를 매번 새로 만든다. 완료 후 컨테이너와 volume을 지운다. 실패 원인을 조사할 때만 `-Keep`을 붙인다.

Smoke container는 one-shot key를 다시 만들지 않도록 `--no-deps`로 실행한다. `--use-aliases`를 함께 사용해 Control Plane이 callback 주소 `smoke`를 찾을 수 있게 한다.

```powershell
./tools/edc/run-smoke.ps1 -Keep
```

수동 실행에서는 `.env.example`을 복사하되 실제 값을 저장소에 commit하지 않는다.

```powershell
docker compose \
  -f deploy/edc/compose.yaml \
  -f deploy/edc/compose.smoke.yaml \
  up --build
```

Control Plane Management API와 DSP port는 loopback에만 연다.

| endpoint | host 주소 |
| --- | --- |
| Provider Management | `http://127.0.0.1:19191/management` |
| Provider DSP root | `http://127.0.0.1:19292/protocol` |
| Consumer Management | `http://127.0.0.1:29191/management` |
| Consumer DSP root | `http://127.0.0.1:29292/protocol` |

EDC readiness는 각 컨테이너의 `/api/check/readiness`로 확인한다. Data Plane readiness에는 Control Plane 등록 성공도 포함된다.

## 5. 기존 Bridge·전송 Worker와의 경계

EDC Management API는 DSP가 아니다.

게시 Bridge의 EDC v4 publication adapter는 구현됐다. `src/bridge-runtime/edc-v4-management-client.mjs`를 선택하면 Bridge runtime이 다음 순서로 자원을 게시한다.

1. 접근 Policy Definition
2. 계약 Policy Definition
3. Asset와 DataAddress
4. 해당 Asset만 고르는 Contract Definition

Adapter는 결정적 ID와 소유권 digest를 사용한다. 재실행할 때는 각 객체를 GET으로 읽고 같은 게시가 만든 객체인지 확인한다. 같은 ID를 다른 게시가 사용했으면 덮어쓰거나 삭제하지 않고 중단한다.

입력 계약, DataAddress 제한, 부분 실패 처리, 시험 범위는 [EDC v4 publication adapter 해설](edc-v4-publication-adapter.md)에 적었다.

격리 HTTP fixture 시험은 완료했다. Smoke script는 같은 API를 직접 호출한다. 따라서 이번 Docker 통과 결과는 publication adapter 자체의 EDC 게시 실증이 아니다.

기존 Provider Transfer Worker는 generic Connector event feed와 ack API를 전제로 한다.

EDC는 DSP 상태 전이를 내부에서 실행하고 callback을 제공한다. 둘을 연결하려면 EDC callback·Management API를 현재 worker event schema로 바꾸는 adapter가 필요하다.

이 adapter 없이 두 runtime을 직접 연결하면 상태 정본이 둘로 갈라진다.

권장 경계는 다음과 같다.

```text
metadata Bridge
  -> EDC publication adapter
  -> EDC Management API v4
  -> EDC DSP 2025-1

EDC transfer callback
  -> EDC transfer adapter
  -> existing platform provisioner
```

## 6. 운영 배포 전에 바꿀 항목

이 토폴로지는 `iam-mock`과 token-based Management API key를 사용한다. 외부 참여자와 연결하기 전에는 그대로 배포하면 안 된다.

| 로컬·CI 구성 | 운영 교체 항목 |
| --- | --- |
| `iam-mock` | 참여자 신원 체계와 trust anchor |
| API key | OIDC/mTLS 기반 관리망 인증과 권한 분리 |
| in-memory key vault | HashiCorp Vault·HSM 등 외부 secret manager |
| 단일 PostgreSQL·공유 superuser | DB별 non-superuser role·credential·최소 `GRANT`, 교차접근 거부, HA·backup·PITR |
| 내부 HTTP | TLS, 인증서 rotation, network policy |
| smoke GET proxy | 보안 검토를 마친 공개 데이터 전달 계층 |
| legacy EDC Data Plane과 `transfer-data-plane-signaling` | 독립 DPS worker와 표준 signaling 인증·상태 처리 |
| Docker Compose | Kubernetes 등 운영 scheduler와 resource limit |

## 7. 이 환경에서 수행한 시험

**(정본 선택 근거: B-01)** recorder-bound raw run과 명령별 결과를 결합한 `evidence/edc/local-interoperability-status.v1.json`을 현재 실행 상태의 기계 정본으로 삼는다.

```text
Gradle :control-plane:shadowJar      PASS
Gradle :data-plane:shadowJar         PASS
Gradle :smoke-data-plane:shadowJar   PASS
node --test tests/edc/*.test.mjs     PASS (30 passed, 0 failed)
node tools/edc/verify-topology.mjs   PASS (31 topology files, source binding matched)
docker compose ... config --quiet    PASS
Docker recorder-bound smoke          PASS
```

상태 정본은 `2026-07-14T13:40:19.887Z`에 기록됐다. recorder-bound smoke는 checkout `b20c5f591a8fb5d0c7e50bc6309251af46b94323`에서 실행됐고, source binding은 SHA-256 `2cf510c3fd326a2fb5320f596c5c176face0e1da66b6a12cdd4ff3fde39a916b`와 범위 내 52개 파일을 기록한다. 이 52개 source binding 파일과 정적 검증기가 확인한 31개 topology 파일은 서로 다른 집계 범위다.

Provider·Consumer Control Plane과 Data Plane이 readiness를 통과했다. 같은 EDC 0.18.0 구현 사이에서 Catalog 조회, 계약 `FINALIZED`, PULL, 종료와 token 폐기를 확인했다.

실행 ID는 `2cb9b59d-ba9e-4219-87cf-0bf5c8e53c24`이고 exit code는 0이다. Git HEAD와 source digest는 시작과 종료 시점에 같았다.

범위 내 변경 파일이 있어 `git.cleanAtStart=false`, `git.cleanAtEnd=false`였다. 따라서 이 raw run을 clean worktree 실행으로 주장하지 않는다.

별개의 Docker clean-start와 cleanup은 모두 통과했고 5개 서비스의 image ID를 기록했다.

원시 증거는 `evidence/edc/runs/20260714T2240+0900-p0-schema-admission.json`이다. 파일 SHA-256은 `dcc4dc589c7f4830cc3eaec8398ded5c582f35bc03ad89e79a0eb86a2ac17f8d`, stdout SHA-256은 `2b841da69c70842b87cd8bcf6dffc3a10a8143d18fc6222b674554249c153152`다.

```text
ok=true
managementApi=v4
dsp=dataspace-protocol-http:2025-1
assetId=molit-edc-smoke-asset-316a9ac0-8e8f-4186-88e1-4020dce5c3dd
agreementId=fad5203c-b69c-4248-8990-bbce6a1244a0
transferId=5e878ccb-1dc9-4d8c-8666-91777975665a
startState=STARTED
finalState=TERMINATED
revokedStatus=403
bytes=96
contentType=application/json
sha256=2f013648aa3071d46c9e29b2e938c5fb36336cc53f27d1f5e507da3683da41a7
```

Consumer Control Plane은 legacy prepare 단계에서 `No dataplane found` 경고를 한 번 기록했다.

Legacy controller는 PULL destination을 준비할 Data Plane이 없으면 경고 후 성공으로 진행하도록 구현돼 있다. 실제 전송은 Provider Data Plane에서 시작됐고 위 결과까지 끝났다.

상태 정본의 판정은 `production-readiness-blocked`다. 이 결과는 서로 다른 Connector 구현 간 상호운용 증거가 아니며 공식 DSP TCK 결과도 아니다. 운영 DPS worker, 외부 신원 체계, 공개 전달 계층과 production readiness도 검증하지 않았다.

명령별 결과와 미검증 항목은 [EDC 로컬 상호운용 실행 상태](../../evidence/edc/local-interoperability-status.v1.json)에 기록했다.
