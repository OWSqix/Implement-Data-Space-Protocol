# Kubernetes EDC Provisioner 배포 절차

이 경로에는 CaaS가 테넌트별 EDC Connector를 독립 namespace에 배포하기 위한 제어 장치와 시험 도구가 있다. `src/caas/kubernetes-provisioner.mjs`는 Kubernetes API를 직접 호출한다. 운영 경로에서 `kubectl` 하위 프로세스나 shell 스크립트로 테넌트 자원을 조작하지 않는다.

## 배포 범위

테넌트 하나에는 다음 자원이 생성된다.

- Namespace, ServiceAccount, ResourceQuota, LimitRange
- 기본 차단 NetworkPolicy와 허용 범위 NetworkPolicy
- 외부 비밀 관리 장치가 먼저 만든 Secret에 대한 참조
- EDC SQL schema migration Job과 완료 증거 ConfigMap
- EDC Control Plane과 Data Plane Deployment, Service, PodDisruptionBudget
- 운영 환경에서는 DSP와 데이터 전송용 Gateway API `HTTPRoute` 두 개

EDC Pod에는 Kubernetes API 토큰을 마운트하지 않는다. 컨테이너는 restricted security context와 digest로 고정한 이미지를 사용한다. 운영 설정은 각 plane의 replica를 2개 미만으로 줄일 수 없다.

## 선행 조건

운영 배포에는 다음 항목이 필요하다.

1. Kubernetes 1.30 이상과 `admissionregistration.k8s.io/v1` `ValidatingAdmissionPolicy`
2. Gateway API `v1`의 Gateway와 HTTPRoute CRD
3. CloudNativePG Cluster와 ScheduledBackup CRD, Barman Cloud ObjectStore CRD
4. 최소 3개 zone과 3개 node에 배치할 수 있는 클러스터
5. digest로 고정한 CaaS, DSaaS, PostgreSQL, EDC, OpenTelemetry Collector 이미지
6. 운영기관이 발급한 서버 인증서, 클라이언트 CA, 서비스 간 mTLS 인증서
7. Gateway의 HTTPS listener, DNS, 인증서, 허용 namespace selector

배포 스크립트는 현재 kubeconfig context가 `-Context` 값과 정확히 같은지 확인한다. 다른 context를 암묵적으로 선택하지 않는다.

## fencing과 admission

테넌트 명령은 `molit-caas-system`의 `tenant-fence-*` ConfigMap을 먼저 compare-and-set으로 갱신한다. 토큰만 같아서는 재사용할 수 없다. token, holder, operation key, generation, intent digest, desired state가 모두 같아야 같은 명령이다.

`ValidatingAdmissionPolicy`와 TLS admission webhook은 관리 자원의 annotation을 중앙 fence와 대조한다. webhook이 중앙 ConfigMap을 읽지 못하면 요청을 거부한다. Namespace 삭제 전에는 현재 fence를 다시 읽고 Namespace annotation을 compare-and-set으로 갱신한 뒤 UID와 `resourceVersion` precondition을 붙여 삭제한다. 이전 토큰을 가진 CaaS 인스턴스의 생성, 변경, 삭제는 admission에서 거부된다.

Kubernetes admission 승인과 Namespace 삭제 저장은 중앙 ConfigMap과 한 트랜잭션이 아니다. 승인 직후 저장 전에 다른 인스턴스가 중앙 fence를 갱신하는 짧은 구간은 남는다. UID와 `resourceVersion`은 Namespace 변경 경합을 막지만 외부 ConfigMap 변경까지 원자화하지 않는다. 이 경계까지 제거하려면 fence를 Namespace 자체의 versioned field로 옮기거나 별도 집합 API를 운영해야 한다.

설치 순서는 다음과 같다.

```powershell
./deploy/kubernetes/new-test-webhook-certificate.ps1 -Context <context>
./deploy/kubernetes/install-fencing-webhook.ps1 `
  -Context <context> `
  -Image "registry.example/molit/fencing-webhook@sha256:<64-hex>" `
  -CertificateDirectory <certificate-directory>
```

시험용 인증서 생성기는 운영 인증서 발급 절차를 대신하지 않는다.

## Gateway API 경로

운영 `kubernetes-edc` provisioner는 `routing.mode`를 `gateway-api`로 선언해야 한다. `deploy/kubernetes/caas-config.production.example.json`에는 parent Gateway, DSP listener, 데이터 listener, namespace 접근 label, 두 hostname template의 예가 있다.

CaaS는 다음 조건이 모두 참일 때만 준비 상태가 된다.

- parent Gateway의 `Accepted`와 `Programmed` 조건이 현재 generation에서 `True`
- 두 listener가 HTTPS이고 이름이 설정과 정확히 일치
- `allowedRoutes.namespaces.from`이 `Selector`
- selector가 CaaS가 테넌트 Namespace에 붙이는 접근 label과 정확히 일치
- 생성한 HTTPRoute의 `Accepted`와 `ResolvedRefs`가 지정한 parent와 section에서 `True`
- tenant endpoint hostname이 DSP route hostname template과 일치

`allowedRoutes.namespaces.from: All`은 거부한다. `internal-test` 모드는 kind와 비운영 통합시험에서만 허용한다. Gateway controller, DNS, 인증서가 준비되지 않은 상태를 외부 DSP 접속 가능으로 판정하지 않는다.

Gateway API 모드의 `EDC_DSP_CALLBACK_ADDRESS`는 `https://{tenant-host}/protocol`이다. ClusterIP HTTP 주소는 `internal-test`에서만 사용한다. 외부 callback hostname은 connector endpoint 정책 및 HTTPRoute hostname과 같아야 한다.

## 테넌트 EDC 데이터베이스

운영 connector plan은 `databaseSchema`에 다음 값을 고정한다.

- EDC SQL schema 요구 버전
- 원본 EDC SQL resource 목록을 기록한 migration artifact와 SHA-256
- digest로 고정한 migration image
- migration 제한 시간과 확인 주기
- Control Plane과 Data Plane의 JDBC URL key, 계정 key, CA key, 선택 client certificate/key

CaaS는 테넌트 Namespace와 Secret 동기화용 참조를 먼저 만든다. 실제 database Secret은 immutable이어야 한다. 두 JDBC URL에는 userinfo와 fragment를 넣을 수 없고 `sslmode=verify-full`, `sslrootcert` 및 선택한 `sslcert`·`sslkey`만 정확히 한 번 쓸 수 있다. 평문, `verify-ca`, 중복 parameter, 추가 query parameter, 누락 CA는 migration Job 생성 전에 거부한다.

기존 CP/DP가 있으면 먼저 replica를 0으로 줄인다. 이어서 fencing token이 붙은 migration Job이 EDC 0.18.0 SQL을 적용하고 필수 table과 `molit_edc_schema_version` marker를 확인한다. Job 완료와 database Secret UID·`resourceVersion`·digest가 유지된 사실을 `edc-schema-ready` ConfigMap에 기록한 뒤에만 CP/DP를 배포한다. 빈 database, 구버전 marker, migration 실패를 `PROVISIONED`로 보고하지 않는다.

## 운영 Secret과 ConfigMap

`molit-caas-system`에는 다음 Secret이 먼저 있어야 한다.

| Secret | 필수 key |
| --- | --- |
| `molit-control-plane-runtime` | `MOLIT_CAAS_DATABASE_URL`, `MOLIT_CAAS_DATABASE_CA`, `MOLIT_DSAAS_POSTGRES_URL`, `MOLIT_DSAAS_POSTGRES_CA_PEM` |
| `molit-caas-runtime-config` | `caas.json` |
| `molit-dsaas-runtime-config` | `dsaas.json`, `service-registry.json`, `approval-decision-registry.json` |
| `molit-caas-tls`, `molit-dsaas-tls` | `tls.crt`, `tls.key`, `client-ca.crt` |
| `molit-identity` | `introspection-client-secret` |
| `molit-observability` | `otlp-token`, `worm-token`, `tenant-salt`, `ca.crt`, `tls.crt`, `tls.key` |
| `molit-caas-client` | `client-secret`, `ca.crt`, `tls.crt`, `tls.key` |
| `molit-control-store-app` | `username`, `password` |
| `molit-caas-database-role` | `username`, `password`; type `kubernetes.io/basic-auth`; label `cnpg.io/reload=true` |
| `molit-dsaas-database-role` | `username`, `password`; type `kubernetes.io/basic-auth`; label `cnpg.io/reload=true` |
| `molit-control-store-database` | `url` |
| `molit-control-store-database-ca` | `ca.crt` |
| `molit-backup-credentials` | `access-key-id`, `secret-access-key` |

`ha/apply.ps1`은 identity와 observability JSON을 각각 `molit-identity-config`, `molit-observability-config` ConfigMap으로 만든다. 런타임 JSON의 경로는 템플릿의 mount 경로와 정확히 일치해야 한다. DSaaS의 레지스트리 두 파일은 런타임 Secret 전체를 `/run/molit/dsaas`에 마운트하며 배포 configuration digest에도 포함된다.

예제 파일은 다음 위치에 있다.

- CaaS: `deploy/kubernetes/caas-config.production.example.json`
- DSaaS: `deploy/kubernetes/dsaas-config.production.example.json`
- identity: `deploy/identity/*.identity.production.example.json`
- observability: `deploy/observability/*.production.example.json`

DSaaS 예제의 레지스트리 문서, 유효기간, canonical digest는 운영기관이 승인한 최신 값으로 교체해야 한다. 예제의 `NOT_READY` 레지스트리를 운영에 그대로 쓰면 런타임이 fail closed로 종료된다.

## 관측성

`-ObservabilityBackendMode InCluster`는 3개 replica의 OpenTelemetry Collector StatefulSet을 배포한다. replica마다 별도 PVC의 `file_storage` queue를 사용하고 PDB `minAvailable: 2`와 3-zone 강제 분산을 적용한다. 다음 선행 자원이 필요하다.

- `observability` namespace
- `molit-otel-collector` Secret의 `server-cert`, `server-key`, `client-ca`, `upstream-token`, `upstream-ca`, `upstream-endpoint`
- `worm-audit` Service와 그 뒤의 WORM 보관 시스템

`-ObservabilityBackendMode External`은 `.svc` endpoint를 거부한다. 두 모드 모두 Pod init preflight가 DNS, 서버 인증서, 클라이언트 인증서, CA, authorization secret을 검사하고 실제 mTLS handshake를 수행한다. 각 signal의 `mutualTls.reloadIntervalMs`와 `usageMeter.outbox` 운용값은 필수다. 제공 예제의 회전 확인 주기는 30초다.

Collector Service는 mTLS OTLP/HTTP `4318`, Prometheus self-metrics `8888`, health `13133`을 구분한다. NetworkPolicy는 OTLP를 제어 plane과 관리 tenant Namespace에만 허용한다. `8888` scraper는 namespace에 `observability.data.molit.go.kr/metrics-access=allowed`, Pod에 `observability.data.molit.go.kr/metrics-reader=true`가 있어야 한다. health port는 `observability` namespace 안에서만 접근할 수 있다.

`observability` namespace에는 `supply-chain.data.molit.go.kr/enforcement=required` label을 붙인다. Collector도 CaaS, DSaaS, PostgreSQL, migration/bootstrap Job과 같은 정책으로 승인 registry, digest, signature, release attestation을 통과해야 한다.

관리 tenant Namespace에도 같은 label을 붙인다. production CaaS 설정의 `supplyChainAdmission`은 `molit-verify-release-images`와 release attestation predicate를 고정한다. provisioner는 Kyverno `ClusterPolicy`에 registry/digest, signature, attestation 규칙이 모두 `Enforce`와 `required`로 설치됐는지 확인한다. 이 확인이 실패하면 EDC schema migration Job도 만들지 않는다. 로컬 PostgreSQL 반복시험 통과는 이미지 빌드 대상의 자격 근거일 뿐이다. 운영 registry digest는 별도로 서명과 release attestation을 통과해야 한다.

## HA 배포

CloudNativePG는 3개 인스턴스, 동기 quorum, zone anti-affinity, WAL archive, 정기 backup을 사용한다. `ha/apply.ps1`은 기존 CaaS와 DSaaS Deployment를 0으로 줄이고 orphan-recovery CronJob을 중지한 뒤 다음 순서를 실행한다.

1. `001_control_store.sql`부터 `004_authoritative_scoped_state.sql`까지 적용
2. migration authority로 CaaS와 DSaaS를 `scoped-authoritative`로 전환
3. migration version 4, source 종류, snapshot digest, state root를 `molit-control-store-schema-receipt`에 기록
4. runtime role의 component·platform binding과 최소 권한을 bootstrap
5. 각 Pod init preflight에서 ConfigMap 영수증과 PostgreSQL mode·root·runtime 권한을 대조
6. 세 replica를 배포하고 CronJob을 다시 시작

fresh database는 공식 빈 CaaS·DSaaS 상태를 source로 사용한다. snapshot 없이 legacy projection row가 남아 있으면 fresh install로 간주하지 않고 중단한다. 기존 snapshot의 멱등성 원장 범위를 증명할 수 없으면 승인된 scope map이 필요하다. runtime role에는 `json_snapshot`의 네 가지 table 권한이 없고 legacy enrollment 함수도 허용하지 않는다. mode가 `projection`이거나 영수증 root가 DB와 다르면 init container와 scoped store 초기화가 모두 실패한다.

`molit-control-store-database`의 URL은 superuser 또는 `BYPASSRLS` 권한을 가진 migration authority를 가리켜야 한다. Job 안에서 권한을 다시 검사한다. CaaS와 DSaaS runtime role은 이 계정과 달라야 하며 `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, superuser 권한을 가질 수 없다.

```powershell
./deploy/kubernetes/ha/apply.ps1 `
  -Context <production-context> `
  -CaasImage "registry.example/molit/caas@sha256:<64-hex>" `
  -DsaasImage "registry.example/molit/dsaas@sha256:<64-hex>" `
  -PostgresImage "registry.example/postgres@sha256:<64-hex>" `
  -DatabaseToolImage "registry.example/molit/postgres-tools@sha256:<64-hex>" `
  -RegistryPrefix "registry.example/molit" `
  -StorageClass <database-storage-class> `
  -BackupDestination "s3://<bucket>/<prefix>" `
  -BackupEndpoint "https://<object-store-origin>/" `
  -CaasIdentityConfigFile deploy/identity/caas.identity.production.example.json `
  -DsaasIdentityConfigFile deploy/identity/dsaas.identity.production.example.json `
  -CaasObservabilityConfigFile deploy/observability/caas.production.example.json `
  -DsaasObservabilityConfigFile deploy/observability/dsaas.production.example.json `
  -ObservabilityBackendMode InCluster `
  -OtelCollectorImage "registry.example/otel-collector@sha256:<64-hex>" `
  -ObservabilityStorageClass <queue-storage-class> `
  -DatabaseBootstrapApprovedBy <approver-id> `
  -DatabaseBootstrapApprovalReference <change-record-id>
```

CaaS와 DSaaS는 각각 3개 replica와 PDB `minAvailable: 2`를 사용한다. TLS proxy sidecar는 없다. 애플리케이션이 직접 HTTPS와 client CA 검증을 처리한다. DSaaS probe에는 `publicOrigin` hostname을 `Host` header로 넣으며, 그 값이 `allowedHosts`에 없으면 배포 전에 거부한다.

`RegistryPrefix`는 미리 설치한 Kyverno image 검증 정책의 승인 prefix와 같아야 한다. `PostgresImage`와 별도로 `DatabaseToolImage`를 받는 이유는 CNPG operand와 일회성 psql Job의 release artifact를 구분하기 위해서다. migration Job은 이 도구 이미지로 SQL을 적용한 뒤 CaaS 이미지의 `scoped-cutover-cli.mjs`를 실행한다. 두 이미지 모두 승인 mirror의 digest, 서명, SLSA provenance와 vulnerability attestation이 없으면 admission에서 거부된다.

기존 file control store를 전환할 때는 운영자가 승인 자료를 넣은 PVC를 먼저 만든다. `-ControlStoreCutoverInputClaim`에는 `Bound` 상태인 기존 PVC 이름만 지정할 수 있으며 Job은 이를 read-only로 mount한다. 파일 이름은 다음 네 개로 고정한다.

- `caas-legacy-source.json`, `dsaas-legacy-source.json`: `molit.control-store-legacy-source/1` 승인 snapshot
- `caas-scope-map.json`, `dsaas-scope-map.json`: 필요한 경우에만 두는 `molit.control-store-scope-map/1` 승인 mapping

빈 파일과 없는 파일은 입력으로 사용하지 않는다. legacy source의 `sourceArtifactSha256`은 state의 canonical digest와 같아야 하며 approval evidence hash가 없으면 cutover가 실패한다. scope map도 source snapshot hash와 approval evidence에 묶인다. 입력 PVC를 지정하지 않으면 1 MiB의 빈 임시 volume을 사용하며 DB snapshot 또는 residue가 없는 신규 설치만 처리한다.

`deploy/kubernetes/apply.ps1`은 RBAC와 fencing admission을 설치하는 기초 진입점이다. 이 파일의 `-RunDatabaseMigration`은 의도적으로 실패한다. 운영 DB 변경은 cutover와 receipt를 생략할 수 없는 `deploy/kubernetes/ha/apply.ps1`만 사용한다.

## kind 수명주기 시험

다음 명령은 kind와 kubectl binary checksum, kind node image digest를 고정한다. webhook과 시험 workload를 빌드해 클러스터에 적재한 뒤 실제 API server에서 수명주기를 실행한다.

```powershell
./deploy/kubernetes/run-kind-integration.ps1 `
  -ClusterName molit-p0 `
  -Cycles 30 `
  -EvidencePath .local/kubernetes-lifecycle-repeat.json
```

시험 순서는 `PROVISIONED -> SUSPENDED -> PROVISIONED(UPGRADE) -> PROVISIONED(ROLLBACK) -> DELETED`다. 서로 다른 테넌트 다섯 개를 병렬 처리하고 30회 반복한다. 같은 실행에서 이전 fencing token의 DELETE가 admission에서 거부되는지, workload Ready, Secret 참조, default-deny NetworkPolicy, Namespace 정리, orphan 0건을 확인한다.

보고서에는 Kubernetes와 도구 버전, 고정 image digest, 150개 operation journal, p50/p95/max 시간, 남은 Namespace 수, 보존한 fence 수, orphan 수가 기록된다. kind 시험은 `internal-test` route 모드를 쓰므로 운영 Gateway controller의 DNS·인증서·라우팅 시험을 대신하지 않는다. 운영 승격 전에는 실제 Gateway와 외부 DSP client를 사용한 별도 상호운용 시험이 필요하다.
