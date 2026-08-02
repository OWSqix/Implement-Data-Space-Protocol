# EDC·CaaS·DSaaS 작업 인계 기록

작성일: 2026-07-14 KST
상태: PostgreSQL 제어 저장소 구현 후보, 상용 운영 판정 차단

> 이 문서는 작성 시점의 작업 인계 기록이다. 이후 구현 결과와 현재 판정은
> [P0 운영 제어면 구현과 검증](../04-implementation/p0-control-plane-verification.md) 및
> `governance/commercial-readiness-register.v1.json`을 기준으로 확인한다.

## 1. 인계 기준

- **(기준선)** 작업 시작 commit은 `044dfda`
- **(구현 commit)** 본 구현은 `3c30128`, EDC recorder 보강은 `cae2063`, 증거 참조 시험 보강은 `87b5870`
- **(기존 구현 상태)** EDC 로컬 구성, CaaS·DSaaS 제어면, Bridge HTTP 방어, Provider transfer worker 구현
- **(현재 작업 상태)** CaaS·DSaaS PostgreSQL JSONB·CAS, 별도 lease pool, advisory lock·fencing과 graceful shutdown 보강
- **(이전 시험 상태)** 단위·통합·focused 시험과 EDC runtime 검증 통과
- **(증거 상태)** commit `87b5870`의 detached worktree에서 EDC source-binding 범위와 clean volume을 확인한 recorder-bound raw run 통과
- **(현재 증거 경계)** PostgreSQL·상용 Gate 변경은 작업 디렉터리 기준이며 아직 source commit과 release 증거에 결합되지 않음
- **(금지 사항)** 상위 경로의 기획보고서 PDF는 이 저장소의 commit 대상에서 제외

이 문서의 시험 수는 2026-07-14에 실행한 결과다. focused suite는 전체 unit·integration suite와 중복되므로 합산하지 않는다.

## 2. 구현 범위

### 2.1 EDC 로컬 구성과 증거 기록

- Eclipse EDC 0.18.0 Provider·Consumer Control Plane과 Data Plane 분리 구성
- Management API v4와 DSP 2025-1 Catalog·계약 협상·PULL·종료 흐름 구현
- Java 17 bytecode, production JAR과 smoke 전용 class 분리, Compose model 검증
- Git HEAD, EDC 범위 worktree 상태, source digest, Docker image ID, raw stdout hash 기록
- clean-start·cleanup 결과와 source digest 전후 일치 여부 기록
- 기존 raw run 파일 덮어쓰기 거부

로컬 전송은 EDC 0.18.0의 legacy Data Plane signaling 호환 경로를 사용한다. production Data Plane Signaling(DPS) worker 구현으로 간주하지 않는다.

### 2.2 CaaS 제어면

- 관리자·tenant·DSaaS controller 권한 분리
- tenant와 Connector 목표 상태 수렴 API
- `desiredGeneration`과 request digest를 이용한 세대 fencing
- 같은 세대의 다른 요청과 이전 세대 요청을 `409`로 거부
- 과거 idempotency key의 정확한 재생 시 원응답 반환, side effect 재실행 금지
- dry-run manifest provisioner 제공, production 설정에서 해당 provisioner 사용 거부
- PostgreSQL JSONB snapshot과 revision compare-and-swap
- state transaction과 session advisory lease의 connection pool 분리
- tenant별 단조 증가 fencing token과 lease 상실 뒤 commit 거부
- 외부 관찰과 명령을 state transaction 밖에서 실행하고 전후 snapshot fence 확인
- 운영 Adapter의 외부 fencing receipt와 `lastAppliedFencingToken` 재관찰 계약
- write timeout, readiness drain, 진행 요청 취소와 종료 기한 적용

CaaS는 Connector 배포 의도를 계산하고 검증한다. Kubernetes나 Compose에서 EDC를 실제 생성·갱신·삭제하는 provisioner는 아직 없다.

### 2.3 DSaaS 제어면

- dataspace·membership 상태와 4-eyes 승인 절차
- 승인 Registry와 필수 서비스 Registry의 schema·URI·digest·freshness 검증
- Registry 읽기·JSON·schema 오류의 `503` 매핑과 `Retry-After: 60` 반환
- 승인 산출물의 IRI·version·SHA 결합
- CaaS에 `desiredGeneration`을 전달하는 수렴 scheduler
- PostgreSQL 데이터 스페이스별 advisory lease와 fencing token
- 필수 서비스 Gate의 generation 2→3→4 전이와 CaaS suspend·reactivate 수렴
- 종료 즉시 readiness 해제, 신규 관리 요청 거부, listener와 scheduler의 단일 종료 기한 적용
- 종료 중 CaaS 호출 취소 전파와 늦게 도착한 결과의 상태 commit 차단
- drain deadline 이후 진행 중이던 관리 요청의 state commit 차단
- start·close 경합 시 listener와 scheduler 재기동 차단

Registry 신뢰 기준은 실행 설정에 고정한 SHA다. 승인 Registry 파일이나 digest가 바뀌면 설정을 함께 배포하고 process를 다시 시작해야 한다.

### 2.4 Bridge와 Provider transfer worker

- DNS 조회 결과 분류 후 검증된 IP를 Undici dispatcher에 고정
- 원래 hostname을 Host header와 TLS SNI에 유지
- DNS·요청·응답 읽기·retry 대기를 하나의 전체 deadline으로 제한
- 재시도 전 DNS 재검증과 private·loopback rebinding 차단
- provision·revoke 응답의 transfer identity, agreement, dataset, provisioning ID, resource digest 검증
- revoke receipt의 닫힌 schema와 `ABSENT` 상태를 요구하는 `404` 처리
- journal 본문과 metadata에 대한 HMAC 검증
- 종료·revoke 재생 시 제거된 provisioner를 불필요하게 조회하지 않는 복구 경로

Journal HMAC은 변조를 검출하지만 과거의 유효한 journal 전체를 되돌리는 rollback은 검출하지 못한다.

## 3. 검증 결과

### 3.1 이전 commit 결합 검증

| 검증 명령 | 결과 | 확인 범위 |
| --- | ---: | --- |
| `npm run test:unit` | `188/188` 통과 | 전체 단위 시험 |
| `npm run test:integration` | `57/57` 통과 | 전체 통합 시험 |
| `npm run test:dsaas` | `62/62` 통과 | 승인·Registry·수렴·종료 경합 |
| `npm run test:caas` | `23/23` 통과 | 권한·세대 fencing·idempotency |
| `npm run test:runtime` | `21/21` 통과 | HTTP deadline·DNS pinning·abort |
| `npm run test:transfer-runtime` | `29/29` 통과 | receipt·journal·복구 |
| `npm run test:edc` | `29/29` 통과 | topology·runner·evidence schema |
| `npm run edc:verify:runtime` | 통과 | Gradle build·Java 17·JAR 분리·Compose |
| `npm run verify` | 통과 | 문서·Registry·profile·ontology·전체 Node 시험 |
| `npm run dependencies:verify` | 통과 | 설치 package 152개·SPDX package 153개 결합 |
| `npm audit --omit=dev` | 취약점 `0`건 | npm production dependency |

전체 `npm run verify`는 945.8초 걸렸다. RC 기술후보 Gate는 clean 구현 commit `3c30128`에서 `candidateEligible=true`를 반환했다. 기관 Recommendation은 외부 승인·표준 원문·운영 Registry 등 16개 항목이 남아 있어 승인되지 않았다.

Node 시험과 별도로 Docker 기반 Catalog·계약·전송 수명주기는 다음 절의 raw run으로 확인했다.

### 3.2 현재 상용 판정

상용 readiness의 정본은 `governance/commercial-readiness-register.v1.json`이다. 2026-07-14에 `npm run commercial:status`를 실행한 결과는 `commercialReady=false`, `decision=blocked`, 미해결 Gate 14개와 차단 항목 16개다. 명령은 exit code 2를 반환했다. 추가된 `COM-CMP-001`은 적용 법령·인증 범위, 개인정보 통제, 외부 보안 검증과 업무 연속성 증거를 요구한다.

현재 PostgreSQL 구현에는 일반 `verify`가 실행하는 비-Docker unit fixture가 있다. `test:integration`은 Docker 시험 파일을 읽지만 전용 환경변수가 없으면 건너뛴다.

실제 container 시험은 `npm run test:control-store:postgres`로 별도 실행한다. 이 결과를 clean source commit, 다중 가용영역 또는 운영 database 증거로 승격하지 않는다.

## 4. EDC 실행 증거 상태

### 4.1 현재 판정

- **(상태)** `pass`
- **(source commit)** `87b587039d08cc902a349aad90535a0b72ccf7e6`
- **(run ID)** `9e293e00-946c-44eb-9d6e-9b6135a97b3f`
- **(raw run)** `evidence/edc/runs/20260714T140859+0900-implementation-87b5870.json`
- **(raw SHA-256)** `ee2dd17cc2f786e59d103005f18cf3d59d0ba659aeabbee32c19d86b7093fffc`
- **(source SHA-256)** `a926a4a8da1670569186ae5a4bcf27a0d810883ceedd5a3460e9fa0edb45f839`

Git HEAD와 source digest는 시작부터 종료까지 바뀌지 않았다. EDC 범위 worktree도 시작과 종료 시점에 clean이었다. 실행기는 5개 서비스의 Docker image ID와 stdout SHA-256을 기록했다. clean-start와 cleanup은 모두 통과했다.

`20260714T140041+0900-implementation-cae2063.json`도 해당 commit의 유효한 recorder 실행으로 남긴다. 현재 상태 원장은 증거 참조 시험까지 보강한 `87b5870` 실행을 정본으로 사용한다.

### 4.2 실행 결과

```text
assetId=molit-edc-smoke-asset-dadab320-f13c-4505-a9d0-92d508a20a35
agreementId=752e4733-49e1-4cf7-b110-653e22d69a6f
transferId=89d2ca95-214f-47be-b856-906601b15ed5
startState=STARTED
finalState=TERMINATED
revokedStatus=403
bytes=96
contentType=application/json
payloadSha256=2f013648aa3071d46c9e29b2e938c5fb36336cc53f27d1f5e507da3683da41a7
```

통과 범위는 동일한 Eclipse EDC 0.18.0 구성 두 참여자 사이의 Catalog, 계약 협상, PULL, 종료, 종료 후 token 거부다. 서로 다른 DSP 구현 사이의 상호운용이나 DSP TCK 적합성은 별도 시험 대상이다.

## 5. 운영 차단 항목

### 5.1 배포와 상태 일관성

- **(실제 provisioner 부재)** CaaS production 설정에서 사용할 Kubernetes·Compose·EDC provisioner와 배포 후 상태 확인 절차 미구현
- **(단일 JSONB row)** CaaS와 DSaaS가 구성요소별 row 하나를 사용하므로 무관한 자원 쓰기도 직렬화되고 감사·멱등성 원장이 같은 row를 계속 키움
- **(외부 fencing 미실증)** advisory lock과 fencing token은 구현했지만 실제 Kubernetes 자원에서 늦은 낮은 token을 거부한 증거 없음
- **(고가용성 미실증)** scheduler leader election, database primary·zone 장애, PITR 복구와 split-brain 시험 미실행
- **(idempotency 보존 정책 부재)** key TTL, tenant별 quota, ledger 압축·폐기·감사 보존 기준 미정

### 5.2 인증과 승인

- **(CaaS 인증 시제품)** static bearer token을 사용하며 발급·rotation·폐기·tenant별 credential 운영 절차 미구현
- **(외부 승인 연계 부재)** 기관 승인 시스템 adapter, 전자서명, 서명자 권한과 시각 검증 미구현
- **(Registry 갱신 제약)** config에 고정한 digest만 신뢰하며 동적 서명 검증·trust-anchor rotation 미구현, 변경 시 재시작 필요
- **(stable namespace 미승인)** 운영기관이 승인한 DNS, TLS 인증서, namespace 책임자와 폐기 정책 미확정

### 5.3 EDC와 DSP

- **(production DPS 부재)** legacy local Data Plane signaling만 검증했으며 운영용 DPS worker와 공개 전송 endpoint 미구현
- **(publication 수명주기 미검증)** EDC publication adapter를 live container의 생성·갱신·삭제 흐름에 연결한 시험 미실행
- **(이기종 증거 부재)** 다른 EDC 배포판·다른 DSP 구현과의 시험 및 공식 DSP TCK 결과 없음
- **(운영 경계 미구현)** 참여자별 DB 최소 권한, TLS, network policy, secret manager, backup·복구 시험 미완료

### 5.4 공급망과 감사 증거

- **(공급망 통제 미완료)** Node 설치 tree와 SPDX SBOM은 고정했으나 Maven transitive checksum lock, Maven·container SBOM, image 서명, 전체 dependency license inventory는 미작성
- **(journal rollback 방어 부재)** 유효한 과거 journal 재생을 막을 외부 monotonic counter, CAS 저장소 또는 append-only anchor 미구현
- **(운영 관측 부재)** 관리 API부터 DSP 전송까지의 OpenTelemetry trace와 WORM 감사 반출 증거 없음

`npm audit --omit=dev`의 취약점 0건은 npm advisory 기준 결과다. Maven artifact, container base image, 배포 manifest와 운영 secret의 공급망 검증을 포함하지 않는다.

## 6. 다음 작업 순서

1. 실제 Kubernetes EDC provisioner에 fencing token 비교·저장과 관찰 receipt를 구현한다.
2. 단일 JSONB row를 정규 table, outbox와 partitioned audit로 분리하고 migration·부하 시험을 추가한다.
3. PostgreSQL 고가용성·PITR과 database primary·zone 장애 복구시험을 실행한다.
4. production DPS worker와 EDC publication adapter의 live 수명주기 시험을 추가한다.
5. OIDC·DCP 운영 신원, 외부 승인 서명과 Registry trust-anchor 갱신 절차를 정한다.
6. OpenTelemetry 전 구간 추적, WORM 감사와 최종 image 공급망 증거를 결합한다.
7. 운영기관의 stable namespace 승인을 받고 이기종 DSP 시험과 공식 TCK를 등록한다.

## 7. 인계 판정

현재 상태는 `recorder-bound EDC 로컬 수명주기와 PostgreSQL 기반 CaaS·DSaaS 제어면을 가진 구현 후보`다. 동일 EDC 구현 두 참여자 사이의 로컬 수명주기는 commit과 source digest에 결합된 raw run으로 확인했다.

PostgreSQL lease와 fencing은 구현했다. 실제 provisioner, 외부 fencing 강제, 운영 인증·승인, OpenTelemetry·WORM, 고가용성·PITR, production DPS, stable namespace와 최종 image 공급망 통제는 없다.

따라서 실운영 완료로 표기할 수 없다. 이기종 구현이나 DSP TCK를 실행하지 않았으므로 DSP 상호운용 완료로도 표기할 수 없다.

상용 완료 여부는 이 문장의 표현이 아니라 `npm run commercial:status`의 exit code와 `governance/commercial-readiness-register.v1.json`으로 판정한다.
