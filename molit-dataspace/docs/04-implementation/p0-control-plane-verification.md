# P0 운영 제어면 구현과 검증

- 기준일: 2026-07-14
- 대상: CaaS·DSaaS 운영 제어면의 저장소 구현
- 실행 원장: `deploy/p0/verification-steps.v1.json`
- 로컬 판정 정본: `.local/p0/local-verification.json`

## 1. 판정 범위

P0 저장소 범위는 tenant 격리, Connector 수명주기, 운영 신원, 관측·감사·계량, 고가용성과 소프트웨어 공급망이다.

구현 완료는 코드가 존재한다는 뜻이 아니다. 고정한 실행 원장의 전 단계를 같은 source에서 통과해야 한다. 단계별 원시 log와 하위 증거의 digest도 다시 검증할 수 있어야 한다.

상용 운영 판정은 별도다. 운영기관의 cluster, IdP·CA·KMS, object storage·Vault, OTLP·WORM backend와 image registry에서 만든 증거가 없으면 `commercial:status`는 exit code 2를 유지한다. 로컬 P0 검증은 이 판정을 `pass`로 바꾸지 않는다.

참가자 신뢰 Registry, 연합 Catalog, ODRL 집행, DSP TCK와 외부 Connector 상호운용은 P1이다. EDC Control Plane과 Data Plane image는 P0의 빌드·경화 대상이지만 P1 Gate가 끝나기 전에는 `productionEligible=false`다.

## 2. 상태 정본

`scoped_control_state`는 CaaS tenant와 DSaaS 데이터 스페이스별 상태 정본이다. Production runtime은 `PostgresScopedControlStore`만 사용한다. `json_snapshot`은 전환 입력으로만 남고 CaaS·DSaaS runtime role의 조회·변경 권한은 회수한다.

상태 변경, idempotency record, domain 감사 event와 outbox는 하나의 PostgreSQL transaction에서 확정한다.

`control_scope_registry`는 payload 없이 scope 존재 여부만 보관한다. DSaaS의 CaaS tenant ID, Connector participant ID와 namespace 전역 중복은 `control_participant_registry`가 막는다.

기존 snapshot을 전환할 때 scope를 추정하지 않는다. 둘 이상의 대상이 가능한 idempotency record에는 승인자, 승인시각, 근거 digest와 원본 snapshot digest를 고정한 scope map이 필요하다. 미해결 record가 하나라도 있으면 전환을 중단한다.

Component와 tenant는 database context에 함께 묶인다. 같은 tenant ID를 사용해도 CaaS role은 DSaaS row를 볼 수 없고 DSaaS role은 CaaS row를 볼 수 없다.

기존 전역 enrollment 함수는 runtime role에서 회수한다. Component를 확인하는 scoped enrollment 함수만 허용한다.

## 3. P0 구현 원장

| Gate | 저장소 구현 | 로컬 검증 기준 | 운영기관 증거 |
| --- | --- | --- | --- |
| `COM-TEN-001` | Component·tenant별 정본, FORCE RLS, database principal, tenant queue·object·secret reference, metric·감사 binding | 실제 PostgreSQL의 교차 조회·쓰기·claim·ack 거부, 전환·rollback·동시성 시험 | 운영 bucket policy, Vault ACL, NetworkPolicy 침투시험 |
| `COM-LCM-001` | Kubernetes EDC provisioner, create·upgrade·rollback·suspend·delete, orphan 회수, target-side fencing | kind 30회 수명주기와 N+1 적용 뒤 지연된 N 명령 거부 | 승인된 운영 cluster·Gateway·DNS·비밀 backend의 서명 결과 |
| `COM-ID-001` | Production RFC 7662 introspection, MFA claim, service mTLS certificate binding, TLS·credential 회전 | 인증한 inactive-token 시작 probe, TTL readiness, 폐기·오류·복구와 실제 Keycloak 시험 | 운영 MFA·SAML ceremony, private CA·KMS, DCP trust chain |
| `COM-OBS-001` | OTLP trace·metric·log, WORM 감사 outbox, 비과금 usage 원장, SLO rule·dashboard | 네 signal의 시작 probe·TTL readiness, mTLS, tamper·dead letter·재처리와 tenant 귀속 | 운영 OTLP·WORM 보존·가용성·권한과 DSP 전송 상관관계 |
| `COM-HA-001` | 3개 zone 배치, PostgreSQL synchronous quorum·WAL archive·PITR, fencing receipt | Primary 중단, 승격, split-brain 방지, queue 보존과 PITR digest | 운영 multi-zone의 DB·queue·object 동시 장애훈련 |
| `COM-SUP-001` | 8개 runtime class, source build 6종, 외부 채택 2종, SBOM·취약점·provenance·서명·admission 계약 | Source image build·non-root·read-only probe, 외부 채택 계약, Kyverno 양성·음성 정책 시험 | 운영 registry와 KMS·HSM release key의 digest·서명·scan·admission 결과 |

Production 신원 mode는 `rfc7662-introspection`으로 제한한다. 시작할 때 client credential로 발급된 적 없는 probe token을 조회하고 `active=false`를 확인한다.

마지막 성공 시각이 `readinessMaxAgeMs`를 넘거나 secret·endpoint 검사가 실패하면 readiness를 닫는다. 다음 인증 probe가 성공하면 readiness를 복구한다.

`oidc-jwt`는 durable revocation Registry가 연결되기 전까지 개발·상호운용 시험에만 사용한다.

관측 runtime도 시작 실패를 숨기지 않는다. Trace exporter, metric exporter와 log exporter는 인증한 합성 signal을 시작 시 전송한다.

WORM exporter는 append-only, conditional append, retention 강제, read-after-write와 backend ID를 시작 시 확인한다. 각 signal은 마지막 성공 시각과 최대 허용 나이를 따로 계산한다.

Metric 성공으로 log 실패를 덮지 않는다. 처리할 감사 event가 없다는 이유로 WORM 장애를 숨기지도 않는다.

HA 배포 진입점은 offline cutover 전에 orphan-recovery CronJob을 suspend하고 활성 Job이 끝날 때까지 기다린다. CaaS·DSaaS Deployment를 0개로 줄인 뒤 CloudNativePG managed role을 `login=false`로 바꾼다.

Database fence Job은 두 runtime role에 `NOLOGIN`을 적용하고 database `CONNECT`를 회수한다. 남은 session도 종료한다.

Migration·cutover와 runtime 권한 bootstrap이 끝난 뒤에만 managed role을 `login=true`로 되돌린다. 이어 로그인을 검증한다. 중간 실패는 workload를 정지 상태로 유지하고 recovery receipt를 남긴다.

HA/PITR harness는 중단한 former primary를 그대로 두고 split-brain 0건을 선언하지 않는다. 같은 data volume에서 former primary를 격리 network의 standby로 다시 시작한다.

`pg_is_in_recovery()=true`와 stale write 거부를 확인한다. Promoted primary에 해당 row가 생기지 않았는지도 검사한다.

이 re-fence 시험은 로컬 PostgreSQL process의 결과다. 운영 CloudNativePG cluster에서 같은 결과를 승인하는 장애훈련은 `COM-HA-001` 증거로 따로 받는다.

`edc-schema-postgres` 단계는 `schema-migration` image를 빌드해 TLS `verify-full` PostgreSQL 17.10에 연결한다. EDC 0.18.0 Control Plane 12개 table과 Data Plane 2개 table을 두 차례 적용한다. Version marker의 유일성과 반복 실행의 멱등성도 확인한다.

잘못된 server hostname과 비신뢰 CA는 음성 fixture로 거부한다. 2026-07-14 단독 실행은 두 음성 fixture와 JSON Schema 검증을 포함해 통과했다.

하위 증거는 Dockerfile, migration runner·manifest·검증 script와 EDC source tree digest를 묶는다. 로컬 image 검증 결과는 운영 release authorization이 아니라는 값도 고정한다.

## 4. 배포 순서

운영 배포 순서는 다음과 같다.

1. 고정한 Git tree에서 source image 6종을 빌드함
2. PostgreSQL operand와 OpenTelemetry Collector를 검토한 upstream digest 그대로 내부 registry에 채택함
3. 8개 image의 registry digest, SBOM, scan, provenance와 서명을 확정함
4. Kyverno 서명·attestation policy와 fencing webhook을 설치함
5. CloudNativePG cluster와 CNPG 관리 runtime role을 생성함
6. `001`부터 `004`까지 schema migration을 적용함
7. CaaS·DSaaS offline scoped cutover와 상태 root·권한 회수 receipt를 확정함
8. Receipt 검증 뒤 runtime 최소 권한과 platform service binding을 설치함
9. CaaS·DSaaS workload를 시작함
10. Tenant별 EDC schema migration Job이 별도 database의 schema를 적용한 뒤 EDC workload를 시작함

`deploy/kubernetes/apply.ps1`은 database migration 이후 단계를 실행하지 않는다. Database migration이 필요한 운영 배포에는 receipt 검증을 포함한 `deploy/kubernetes/ha/apply.ps1`을 사용한다.

## 5. 검증 원장과 증거 결속

전체 실행 명령은 다음과 같다.

```powershell
npm run verify:p0:local
```

실행 단계의 정본은 `deploy/p0/verification-steps.v1.json`이다. 2026-07-14 현재 파일 SHA-256은 `2f437544460f45d68b157f2b8b627e382064a733807055edc9bf6928697c5f2b`이다. Aggregate report의 `verificationProfile.path`와 `verificationProfile.sha256`은 이 경로와 byte digest를 기록한다.

단계 순서, 인자와 기대 종료 코드는 다음과 같다.

| 순서 | 단계 ID | 실행 | 기대 종료 코드 |
| --- | --- | --- | --- |
| 1 | `repository-verify` | `npm run verify` | 0 |
| 2 | `tenant-control-store-postgres` | `npm run test:control-store:postgres` | 0 |
| 3 | `operational-identity` | `npm run test:identity` | 0 |
| 4 | `keycloak-integration` | `npm run test:identity:keycloak` | 0 |
| 5 | `observability-runtime` | `npm run test:observability` | 0 |
| 6 | `otel-collector-config` | `npm run test:observability:collector` | 0 |
| 7 | `prometheus-rules` | `npm run test:observability:rules` | 0 |
| 8 | `kubernetes-contracts` | `npm run test:kubernetes` | 0 |
| 9 | `kubernetes-kind-30` | `npm run test:kubernetes:kind -- -Cycles 30 ...` | 0 |
| 10 | `postgres-ha-pitr` | `npm run test:ha:pitr -- -ReportPath ...` | 0 |
| 11 | `runtime-images` | `npm run test:runtime-images -- -EvidencePath ...` | 0 |
| 12 | `edc-runtime-build` | `npm run edc:verify:runtime` | 0 |
| 13 | `edc-schema-postgres` | `npm run test:edc:schema:postgres -- -EvidencePath ...` | 0 |
| 14 | `software-supply-chain` | `npm run test:supply-chain` | 0 |
| 15 | `commercial-gate-fail-closed` | `npm run commercial:status` | 2 |

마지막 단계의 종료 코드 2는 상용 준비 완료가 아니다. 유효한 상용 원장에서 미해결 Gate를 숨기지 않았다는 P0 검증 결과다. 원장·Schema·증거 평가 오류의 종료 코드 1은 통과로 처리하지 않는다.

`keycloak-integration`, `kubernetes-kind-30`, `postgres-ha-pitr`에는 환경 점검용 skip switch가 있다. 하나라도 건너뛰면 aggregate의 `skipped`에 기록되고 `complete=false`다.

### 5.1 중첩 증거

장시간 실행 단계의 JSON 결과는 원시 log만으로 대신하지 않는다.

| 단계 | 하위 증거 | 검증 Schema |
| --- | --- | --- |
| `kubernetes-kind-30` | `kubernetes-lifecycle-repeat.json` | `contracts/kubernetes-lifecycle-evidence.v1.schema.json` |
| `postgres-ha-pitr` | `postgres-ha-pitr-run.json` | `contracts/postgres-ha-pitr-run.v1.schema.json` |
| `runtime-images` | `runtime-images.json` | `contracts/runtime-image-local-verification.v1.schema.json` |
| `edc-schema-postgres` | `edc-schema-postgres.json` | `contracts/edc-schema-postgres-verification.v1.schema.json` |

Harness는 실행 전 기존 하위 증거를 삭제한다. 단계가 기대 종료 코드로 끝나도 새 파일이 없거나 Schema 검증에 실패하면 단계를 실패로 바꾼다. Aggregate의 `artifacts`는 단계 ID, 상대경로, Schema 경로, byte 수와 SHA-256을 기록한다.

### 5.2 Source 결속

Harness는 시작과 종료에 Git commit, project worktree 상태, 추적·미추적 파일 내용을 포함한 `git-ls-files-content-sha256-v1` digest와 파일 수를 계산한다. 실행 중 하나라도 바뀌면 `source.stableDuringRun=false`와 `complete=false`다.

다음 명령은 aggregate를 현재 checkout에 다시 결속한다.

```powershell
npm run verify:p0:evidence
```

검증기는 현재 checkout의 commit, worktree 상태 digest, source digest와 파일 수를 다시 계산한다.

이어 실행 원장의 정확한 단계 집합·순서·인자·기대 종료 코드를 확인한다. Log와 중첩 증거의 Schema, byte 수와 digest도 대조한다.

다른 checkout에서 복사하거나 일부 단계만 바꾼 report는 통과하지 않는다.

`complete=true`의 조건은 전 단계 통과, `skipped=[]`, `source.stableDuringRun=true`다. Dirty worktree도 실행 중 내용이 안정적이면 기능 검증 결과를 만들 수 있다. 이 경우 `worktreeClean=false`와 `immutableReleaseEvidence=false`이므로 불변 release 증거로 사용하지 않는다.

## 6. 외부 운영 Gate

`governance/commercial-readiness-register.v1.json`은 P0 Gate를 `partial`로 유지한다. 이는 저장소 구현이 없다는 뜻이 아니라 운영기관의 외부 증거가 없다는 뜻이다.

운영 증거에는 source commit, artifact digest, 환경 digest, 시험 profile, 시작·종료·만료시각과 원시 증거 SHA-256이 필요하다. 운영자 설명, 화면 캡처 또는 로컬 시험 결과만으로 Gate를 `pass`로 바꾸지 않는다.

`commercial:status`는 유효한 원장의 미해결 Gate에 exit code 2를 반환한다. 원장·Schema 또는 증거 평가 오류에는 exit code 1을 반환하고, 모든 Gate가 해소된 경우에만 exit code 0을 반환한다.
