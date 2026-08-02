# 관측·감사·소프트웨어 공급망 구현

## 1. 판정 범위

이 구현은 CaaS와 DSaaS의 요청을 EDC 호출까지 추적한다. 운영 trace·metric·log는 OpenTelemetry Protocol(OTLP)로 보낸다.

감사 event와 사용량 event는 PostgreSQL outbox에서 외부 저장 경계로 반출한다. 8개 runtime class의 image 공급망과 admission 정책도 같은 범위에 둔다.

구현 파일은 다음과 같다.

| 경로 | 역할 |
| --- | --- |
| `src/observability/trace-context.mjs` | W3C Trace Context version 00 검증과 전파 |
| `src/observability/tracer.mjs` | CaaS·DSaaS·EDC span 생성과 상하위 관계 고정 |
| `src/observability/otlp-http-exporter.mjs` | OTLP/HTTP JSON trace 반출 |
| `src/observability/otlp-signals.mjs` | OTLP/HTTP JSON metric·log 반출 |
| `src/observability/operational-telemetry.mjs` | 요청 SLI, 사용량 commit·delivery log, outbox health metric 생성 |
| `src/observability/operational-runtime.mjs` | mTLS·secret reference를 적용한 운영 runtime 조립 |
| `src/observability/rotating-mtls-dispatcher.mjs` | trace·metric·log·WORM client 인증서 무중단 교체 |
| `src/observability/redaction.mjs` | 비밀값 제거와 tenant label bucket 처리 |
| `src/observability/worm-audit.mjs` | 감사 record, append receipt, retention, read-back 검증 |
| `src/observability/worm-outbox-dispatcher.mjs` | PostgreSQL audit outbox claim·반출·ack·재시도 |
| `src/observability/usage-meter.mjs` | tenant별 사용량 원장, 시간 rollup, 재처리 |
| `src/observability/management-usage.mjs` | CaaS·DSaaS 관리 API 완료 사실을 비과금 meter로 기록 |
| `src/observability/usage-outbox-dispatcher.mjs` | 사용량 outbox의 OTLP log 반출·ack·dead letter 처리 |
| `deploy/observability` | mTLS·bearer 수신과 durable queue를 사용하는 Collector 설정, WORM API 계약 |
| `deploy/images` | Source image build, 외부 image 채택, 서명·검증 script |
| `deploy/supply-chain/runtime-image-inventory.v1.json` | 8개 runtime class, 배포 위치와 production 적격성 원장 |
| `deploy/supply-chain/verify-images.template.yaml` | Kyverno CEL 기반 digest·서명·attestation admission 정책 |
| `tools/supply-chain` | SBOM·scan·provenance·DSSE 생성 및 검증 |

소스가 있다는 사실과 운영 배치가 완료됐다는 사실은 구분한다. 현재 repository에는 외부 OTLP endpoint, WORM 제품, image registry, 운영 서명키가 없다. 따라서 운영 배치 증거가 생기기 전에는 `COM-OBS-001`과 `COM-SUP-001` 완료를 선언하지 않는다.

## 2. 분산 추적

### 2.1 요청 경로

한 요청은 다음 span 관계를 갖는다.

```text
external request
  -> CaaS server span
       -> DSaaS client/server span
            -> EDC management or DSP client span
```

각 hop은 수신 `traceparent`를 검증하고 새 `span-id`를 만든다. `trace-id`는 그대로 유지한다. `tracestate`는 vendor key 중복, 32개 초과, 512자 초과, 잘못된 문자를 거부한다. 중복 `traceparent` header도 거부한다.

구현은 W3C Trace Context의 `00` wire format만 수용한다. 알 수 없는 후속 version을 추정해 처리하지 않는다. 후속 version을 지원할 때는 parser 시험과 전파 시험을 먼저 추가해야 한다.

서비스 통합 코드는 다음 경계를 사용한다.

```js
const span = tracer.startIncomingSpan("caas.ensure", request.headers, {
  tenantId,
  attributes: { "molit.operation": "ensure" },
});

const response = await callDsaas({
  headers: span.outboundHeaders(existingHeaders),
});

await span.end({ status: "OK" });
```

`MolitTracer`가 만든 span은 종료 시 sink로 보낸다. 운영 sink는 `OtlpHttpJsonExporter`, 시험 sink는 `createLocalTestSpanSink`다. 시험 sink는 `environment=test` 선언 없이는 생성되지 않는다.

### 2.2 OTLP 반출

운영 exporter는 다음 조건을 강제한다.

- endpoint는 credential을 포함하지 않은 `https://.../v1/traces`다.
- authorization 값은 callback에서 실행 시점에 받는다.
- redirect를 따르지 않는다.
- 요청 제한시간과 응답 크기 제한을 적용한다.
- 2xx가 아닌 응답은 성공으로 처리하지 않는다.

`createOperationalObservability`와 `createOperationalTelemetryFromConfig`는 trace, metric, log, WORM 연결마다 별도 mTLS dispatcher를 만든다. CA, client certificate, private key, bearer token, tenant salt는 모두 `env://` 또는 `file://` reference로 받는다.

Runtime 생성은 연결 설정만 읽고 끝나지 않는다. Trace exporter는 인증한 합성 span을 시작 시 전송한다. Metric과 log exporter도 서로 다른 합성 signal을 보낸다.

WORM exporter는 backend capability와 backend ID를 시작 시 조회한다. 이 중 하나라도 실패하면 production runtime 시작을 중단한다.

각 exporter는 마지막 성공 시각과 `readinessMaxAgeMs`를 비교한다. 허용 시간을 넘거나 마지막 요청이 실패하면 readiness를 닫고, readiness probe에서 인증한 signal을 다시 전송해 복구 여부를 판정한다. Metric 성공으로 log 실패를 덮지 않도록 signal별 상태를 따로 유지한다.

bearer token은 매 요청에 다시 해석한다. mTLS dispatcher는 `reloadIntervalMs`마다 CA·certificate·private key를 다시 읽는다.

후보 certificate의 유효기간, CA 여부, private key 일치, TLS context 생성을 확인한 뒤 active agent를 원자적으로 교체한다. 기존 agent는 진행 중인 요청이 끝난 뒤 닫는다.

후보 material이 잘못됐으면 기존 agent를 유지하고 readiness를 `NOT_READY`로 바꾼다. 잘못된 후보는 통신에 사용하지 않는다.

다음 polling에서 유효한 material을 확인하면 readiness를 복구하고 generation을 올린다. 이 상태는 trace, metric, log, WORM readiness에 각각 나타난다.

`deploy/observability/otel-collector.production.yaml`의 OTLP/HTTP receiver는 client certificate와 file 기반 ingress bearer token을 함께 확인한다. Collector queue는 `file_storage`와 `fsync`를 사용한다.

upstream 전송에는 CA와 file 기반 bearer token을 사용한다. 운영자는 uid `10001`이 queue 경로를 쓸 수 있게 만들고, 영속 volume의 용량·복제·backup 정책을 정해야 한다.

exporter 재시도는 `max_elapsed_time: 0s`로 만료시키지 않는다. queue가 차면 `block_on_overflow: true`가 수신 경로에 backpressure를 건다.

logs pipeline은 메모리 batch를 거치지 않고 redaction 뒤 persistent queue에 바로 넣는다. usage dispatcher가 받은 Collector 2xx는 log가 fsync queue에 들어갔다는 경계다.

Collector가 외부 sink로 보낸 뒤 queue 삭제 전에 장애가 나면 같은 `eventId`가 다시 전달될 수 있다. 외부 sink는 이 ID로 중복을 제거해야 한다.

`health_check.check_collector_pipeline`은 exporter 연속 실패를 readiness 실패로 바꾼다. Collector 내부 Prometheus endpoint는 queue 크기·용량과 signal별 enqueue 실패 수를 노출한다.

queue 사용률 90% 초과와 enqueue 실패는 각각 `MolitOtelCollectorQueueSaturation`, `MolitOtelCollectorQueueEnqueueFailure` 경보다. 근거: `COM-OBS-001`, 확인일 2026-07-14.

dispatcher는 처리할 event가 없는 동안에도 `molit.outbox.health` log를 보낸다. 이 heartbeat는 usage log와 같은 무배치 logs pipeline과 persistent queue를 통과한다.

queue 포화나 저장소 오류가 있으면 heartbeat export가 실패하고 애플리케이션 readiness도 실패한다.

Collector queue는 전송 장애를 흡수하기 위한 장치다. 영속 volume 자체의 손실까지 막는 저장소는 아니고, trace의 법적 보존 장치도 아니며 WORM 감사를 대신하지 않는다.

### 2.3 metric과 운영 log

`OperationalTelemetry`는 관리 API 요청 수와 처리시간 histogram을 만든다. 가용성 SLI는 5xx 응답, 지연 SLI는 500 ms 이하 응답을 기준으로 계산한다. 원문 tenant ID는 보내지 않고 salt가 적용된 고정 개수 bucket만 label로 사용한다.

Metric과 log는 서로 다른 mTLS dispatcher와 bearer reference를 사용한다. 시작 probe, 마지막 성공 시각, 마지막 실패와 TTL도 signal별로 관리한다. 한 경로의 credential이나 endpoint 장애를 다른 경로의 성공으로 감추지 않는다.

`deploy/observability/prometheus-rules.yaml`은 30일 가용성·지연 SLI와 5분/1시간, 30분/6시간 burn rate 경보를 정의한다. `grafana-molit-slo-dashboard.json`은 같은 recording rule을 조회한다. 사용량 outbox dead letter 경보의 목적은 과금이 아니라 `usage-integrity`다.

## 3. label과 비밀값

원문 tenant ID를 metric·span label로 보내지 않는다. `tenantBucket`은 운영 salt와 tenant ID를 SHA-256으로 결합한 뒤 2~256개 bucket 중 하나로 줄인다. 같은 salt에서는 같은 tenant가 같은 bucket에 들어가지만, bucket 값으로 tenant ID를 복원할 수는 없다.

span attribute는 allowlist에 있는 key만 남긴다. authorization, cookie, password, token, API key 계열 key는 삭제하거나 `[REDACTED]`로 바꾼다.

private key, client secret, credential 계열 key도 같은 규칙을 적용한다. Collector에서는 이 목록을 한 번 더 삭제한다.

운영 salt와 authorization token은 설정 JSON에 직접 넣지 않는다. `contracts/observability-config.v1.schema.json`은 `env://` 또는 `file://` reference만 허용한다.

## 4. 감사 record와 WORM 저장소

### 4.1 append 절차

`WormAuditExporter`는 다음 순서로 event를 반출한다.

1. backend capability에서 append-only, conditional append, retention 강제, read-after-write를 확인한다.
2. actor·subject·data의 비밀값을 제거한다.
3. canonical JSON의 SHA-256을 `contentDigest`로 기록한다.
4. 현재 sequence와 이전 receipt digest를 읽는다.
5. 현재 head가 바뀌지 않았다는 조건으로 record를 append한다.
6. sequence, retention, content digest, 이전 receipt를 묶은 receipt를 검증한다.
7. 저장한 record를 다시 읽어 원문과 digest가 같은지 확인한다.

같은 `eventId`와 같은 내용의 재시도는 기존 receipt를 다시 확인하고 성공으로 회수한다. 같은 ID에 다른 내용을 넣는 시도는 실패한다.

head 경쟁, retention 변경, read-back 불일치, receipt 변조도 실패한다. 보존 기간 중 record가 사라지면 `OBS_WORM_RECORD_DELETED`를 반환한다.

`createLocalTestWormBackend`는 unit test 전용이다. `environment=test` 없이 생성할 수 없고 운영 backend로 선택할 수도 없다.

### 4.2 운영 backend 경계

`HttpWormBackend`는 `deploy/observability/worm-api.openapi.yaml`의 HTTPS API를 호출한다. 이 client만으로 저장 장치의 물리적 불변성을 증명하지는 못한다. backend가 반환하는 capability와 실제 object lock·retention 설정, 관리자 우회 통제, 복제 정책을 별도 운영 증거로 확인해야 한다.

`WormAuditExporter`는 처리할 event가 없어도 시작 시 capability를 조회한다. Append-only, conditional append, retention 강제와 read-after-write가 모두 참이어야 한다.

Backend ID가 바뀌거나 마지막 성공이 TTL을 넘으면 readiness를 닫는다. 다음 capability probe가 성공한 경우에만 복구한다.

상태 변경과 감사 반출 사이의 유실을 막기 위해 상태 transaction 안에서 audit outbox를 함께 기록한다. payload 계약은 다음과 같다.

```json
{
  "schemaVersion": "molit.audit-outbox/1",
  "sourceComponent": "caas",
  "sourceSequence": 14,
  "sourceEventDigest": "64-hex",
  "auditEventPayloadSha256": "64-hex",
  "auditEvent": {}
}
```

기존 CaaS·DSaaS audit chain은 서로 다른 unsigned payload 정의를 사용한다. dispatcher는 chain을 새로 계산하지 않는다. full event의 별도 digest와 `eventDigest` 또는 `hash` binding을 확인한다.

`WormOutboxDispatcher`가 claim하는 유형은 `audit.appended`와 `tenant.security.access`다. 첫 유형은 CaaS·DSaaS 상태 감사이고, 둘째 유형은 허용·거부 접근감사다.

보안 접근감사는 payload와 source event digest, sequence, tenant binding, event ID를 다시 검증한다. 검증 뒤 `molit.security-audit-publish-receipt/1` receipt로 acknowledge한다.

break-glass 접근감사를 처리하기 위해 tenant 순회에는 `molit-platform`을 항상 포함한다. resource 변경 event는 claim하지 않는다.

각 event는 WORM append와 read-back을 통과한 receipt로만 acknowledge한다. append 뒤 acknowledge 전에 process가 종료되면 다음 실행에서 기존 record와 receipt를 회수한다. 다른 내용이 같은 ID에 묶였으면 충돌로 처리한다.

payload·chain·tenant binding 검증에 실패한 event는 WORM에 쓰지 않고 reject한다. 일시 오류도 지수 backoff로 reject한다. `PostgresOutbox.maxAttempts`에 도달하면 dead letter가 되고 readiness가 실패한다.

`start`, `runOnce`, `readiness`, `stop` API를 제공한다. `stop`은 새 claim을 중단하고 진행 중인 append·ack를 제한시간까지 기다린다. 제한시간이 끝나면 현재 operation을 취소하고 실패를 반환한다.

### 4.3 사용량 원장과 반출

현재 관리 API meter의 목적은 `operational-non-billable`이다. meter 이름은 `management.api.request`, 단위는 `{request}`, dimension은 `operation`과 `outcome`으로 고정한다. 이 자료를 청구 근거로 사용하지 않는다.

CaaS tenant 등록은 body의 `tenantId`, DSaaS dataspace 생성은 body의 `dataspaceId`를 사용한다. 다른 관리 요청은 URL 또는 검증된 body에서 tenant를 정한다.

인증 실패, health·readiness, 등록하지 않은 route는 원장에 넣지 않는다.

실제 tenant·dataspace 귀속은 2xx로 끝난 관리 작업에만 적용한다. 이 응답은 등록과 database binding을 통과했다는 운영 경계다.

인증 뒤 작업이 실패하면 임의의 URL 식별자로 RLS write를 시도하지 않는다. 403·404를 포함한 실패는 승인된 운영 계정 `molit-platform`에 귀속한다.

따라서 존재하지 않는 대상이나 권한 밖 대상에 대한 요청은 usage readiness를 떨어뜨리지 않는다.

HTTP 응답 뒤에도 trace, metric과 usage 기록은 남아 있을 수 있다. 두 서버는 요청 finalizer를 별도 원장에 등록하고, socket drain 뒤 이 원장을 비운 다음 관측·저장소를 닫는다.

종료 기한을 넘기면 요청 `AbortSignal`과 socket을 취소한다. 같은 절대 기한을 다시 늘리지 않는다.

`UsageMeter.record`는 완료 사실 digest와 source event ID를 tenant 범위 idempotency key로 사용한다. 원본 event, 시간 단위 rollup과 `usage.meter.recorded`를 한 transaction에서 기록한다.

원본 event는 update·delete를 막는다. rollup 재생성도 별도 idempotency key와 `usage.meter.reprocessed` outbox event를 남긴다.

세 table과 outbox에는 강제 RLS를 적용한다.

동기 `molit.usage.meter.committed` log는 PostgreSQL 원장 commit을 뜻한다. 외부 sink 전달을 뜻하지 않는다. `UsageOutboxDispatcher`가 outbox payload digest와 원본 binding을 확인하고 OTLP log를 받은 뒤에야 outbox를 acknowledge한다. receipt의 `idempotencyKey`는 outbox `eventId`와 같다.

OTLP 수신 뒤 PostgreSQL acknowledge 전에 장애가 나면 같은 event가 다시 전송될 수 있다. sink는 `eventId`로 중복을 제거해야 한다.

receipt는 `sink=otlp-log`, `deliveryPurpose=usage-integrity`, `idempotencyKey`를 고정한다. 재시도를 소진하면 dead letter로 바꾸고 readiness를 실패시킨다.

pending 수, dead letter 수, 가장 오래된 pending age는 metric으로 보낸다.

## 5. Runtime image 원장

`deploy/supply-chain/runtime-image-inventory.v1.json`은 배포에 들어가는 8개 runtime class의 정본이다.

| Service | Runtime class | 공급 방식 | Production 적격성 |
| --- | --- | --- | --- |
| `caas` | `caas-control-plane` | Source build | `true` |
| `dsaas` | `dsaas-control-plane` | Source build | `true` |
| `fencing-webhook` | `fencing-webhook` | Source build | `true` |
| `edc-control-plane` | `edc-control-plane` | Source build | `false` |
| `edc-data-plane` | `edc-data-plane` | Source build | `false` |
| `edc-schema-migration` | `schema-migration` | Source build | `true` |
| `postgres-operand` | `postgres-operand` | 외부 image 채택 | `true` |
| `otel-collector` | `otel-collector` | 외부 image 채택 | `true` |

EDC 두 plane은 P1의 DSP TCK, 운영 신원·전송과 외부 Connector 상호운용을 마치기 전까지 `productionEligible=false`다. Build가 성공했다는 이유로 이 값을 바꾸지 않는다.

Source image 6종은 OCI base digest와 runtime class label을 고정한다. CaaS·DSaaS·fencing webhook은 Node `24.18.0-bookworm-slim`을 사용한다.

EDC 두 plane은 Eclipse Temurin 17 JRE를 사용한다. Schema migration은 PostgreSQL 17.10을 사용한다. 기준일 2026-07-14에 각 manifest와 container runtime version을 확인했다.

로컬 harness는 source image 6종을 실제로 build한다. 선언한 non-root user, healthcheck 정책, runtime class, production 적격성 label과 read-only root filesystem 실행을 확인한다.

Fencing webhook은 unrelated healthcheck가 없어야 한다. One-shot schema migration image는 healthcheck를 비활성화해야 한다.

PostgreSQL operand와 OpenTelemetry Collector는 재빌드하지 않는다. 검토한 upstream digest를 내부 registry의 canonical service repository로 복사하고 같은 digest인지 확인한다.

로컬 증거는 두 경로의 inventory·release 계약만 확인한다. `operatingRegistryEvidence=false`는 그대로 유지한다.

읽기 전용 root filesystem은 Dockerfile 속성이 아니다. Kubernetes manifest가 `readOnlyRootFilesystem`, capability 제거, `no-new-privileges`와 제한된 쓰기 volume을 강제한다. `compose.hardening.reference.yaml`은 이 조건을 설명하는 참조이고 production topology가 아니다.

재현 절차는 [로컬 runtime image harness](../../deploy/images/verify-local-runtime-images.ps1)에 고정했다. Report는 source image 6종의 검사 결과와 외부 채택 2종의 선언을 나눠 기록한다.

## 6. 공급망 Gate

### 6.1 release 산출물

`build-sign-verify.ps1`은 source build 6종을 처리한다. 허용 대상은 CaaS, DSaaS, fencing webhook, EDC Control Plane, EDC Data Plane과 EDC schema migration이다.

깨끗한 project worktree에서 고정한 commit tree를 별도 build context로 만든다. 실행 중 source 변경은 거부한다.

`adopt-sign-verify.ps1`은 외부 채택 2종을 처리한다. 허용 대상은 PostgreSQL operand와 OpenTelemetry Collector다.

Inventory에 고정한 upstream digest를 canonical service repository로 복사한다. 전후 manifest digest가 같은지 확인하고 Registry credential은 repository 밖의 독립 Docker config로만 전달한다.

두 경로는 다음 산출물 계약을 공유한다.

1. Registry의 OCI manifest digest를 immutable subject로 고정함
2. Digest로 고정한 Syft로 SPDX 2.3과 CycloneDX SBOM을 생성함
3. Digest로 고정한 Trivy로 vulnerability·secret·misconfiguration scan을 실행함
4. Vulnerability database가 24시간 이내인지 확인함
5. `UNKNOWN`, `HIGH`, `CRITICAL` finding이 하나라도 있으면 release를 중단함
6. Runtime class, production 적격성, image·source·toolchain과 산출물 digest를 SLSA provenance v1에 기록함
7. Repository 밖의 Ed25519 private key로 in-toto statement를 DSSE 서명함
8. 별도 public key로 signature와 모든 artifact digest를 다시 검증함
9. Cosign image signature와 release-bundle attestation을 registry에 게시하고 다시 검증함

Schema migration은 `deploy/edc/Dockerfile`의 `schema-migration` target과 PostgreSQL 17.10 base digest를 사용한다. 로컬 반복시험만으로는 배포할 수 없다. 운영 registry digest, signature, release attestation과 admission 통과가 모두 필요하다.

기준일 2026년 7월 14일에 고정했다. version 출처는 [Syft v1.46.0](https://github.com/anchore/syft/releases/tag/v1.46.0), [Trivy v0.72.0](https://github.com/aquasecurity/trivy/releases/tag/v0.72.0), [Collector v0.156.0](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.156.0) release다.

| 도구 | version | OCI index digest |
| --- | --- | --- |
| Node | 24.18.0 | `6f7b03f7...951452d` |
| Syft | 1.46.0 | `473a60e3...7320bb` |
| Trivy | 0.72.0 | `cffe3f51...ccdd6f` |
| OpenTelemetry Collector Contrib | 0.156.0 | `125bdbeb...ed8108` |

표의 생략 digest는 설명용이다. 실행 파일에는 64자리 digest 전체를 기록했다. release bundle에도 실제 사용한 base·SBOM generator·scanner image reference가 들어간다.

Trivy는 Docker socket을 받지 않는다. Registry에 push한 immutable digest를 remote source로 읽는다. Registry credential은 repository 밖의 독립 Docker config file을 read-only로 mount한다.

Trivy evidence JSON과 정규화한 Gate 결과를 모두 bundle에 넣는다. evidence에는 finding ID·severity·대상은 남기되 secret match와 원문 code는 제거한다.

정규화 결과는 정제한 report의 canonical digest와 database metadata digest를 포함한다. 정제 전 scanner 임시 파일은 제한된 임시 경로에서 삭제한다.

Source digest는 깨끗한 worktree의 project subtree를 `git archive`로 직렬화한 SHA-256이다. File mode와 symbolic link를 포함한 commit tree를 image subject와 함께 묶는다.

Private key와 public key를 같은 값이나 같은 파일로 취급하지 않는다. Release bundle에는 key ID와 signature만 들어가며 private key material은 기록하지 않는다.

### 6.2 Admission 정책

`verify-images.template.yaml`은 `policies.kyverno.io/v1` API만 사용한다. Canonical repository·digest를 검사하는 `ValidatingPolicy` 1개와 서명·release attestation을 검사하는 `ImageValidatingPolicy` 1개로 구성한다.

단일 image policy는 repository별 service·runtime class 대응표를 한 판정식에 둔다. 이 방식으로 8개 runtime identity를 검증하고 같은 image의 서명·attestation을 여러 policy가 반복 조회하지 않는다.

정책은 `containers`, `initContainers`, `ephemeralContainers`를 한 집합으로 검사한다. `pods`의 CREATE·UPDATE와 `pods/ephemeralcontainers`의 CREATE·UPDATE를 모두 범위에 둔다. 관리 namespace의 image는 다음 조건을 만족해야 한다.

- 승인한 canonical service repository와 `sha256` digest 사용
- 고정한 public key의 Cosign signature 확인
- `molit.supply-chain-release/1` attestation과 SLSA provenance 결속 확인
- `productionEligible=true` 확인
- Runtime repository, service와 runtime class의 정확한 결합 확인
- 24시간 이내의 취약점 database·평가·provenance 시각 확인
- `UNKNOWN`, `HIGH`, `CRITICAL` finding 0건 확인

Public key는 PEM byte를 canonical LF로 정규화한 SHA-256을 policy annotation에 기록한다. 운영 적용은 insecure registry를 허용하지 않는다.

Signature 누락, init container의 미서명 image와 repository·runtime class 불일치는 fail-closed 거부 대상이다. `productionEligible=false`도 거부한다.

기준일 2026-07-14의 [Kyverno policy type 표](https://kyverno.io/docs/policy-types/overview/)는 `ValidatingPolicy`와 `ImageValidatingPolicy`의 `policies.kyverno.io/v1`을 v1.18 stable로 분류한다. 이전 정책 API는 같은 release에서 deprecated 상태이므로 사용하지 않는다. Image 검증 field는 [ImageValidatingPolicy 문서](https://kyverno.io/docs/policy-types/image-validating-policy/)를 기준으로 고정했다.

`verify-admission-policy.ps1`은 임시 registry와 key를 만들고 Kyverno CLI에서 양성·음성 fixture를 실행한다. Timeout, registry 종료와 서명 조회 실패는 통과로 처리하지 않는다. 운영 cluster 적용 결과는 별도 `COM-SUP-001` 증거다.

### 6.3 검증 실패 조건

다음 조건에서는 bundle 검증이 실패한다.

- 기대한 image name·digest와 bundle subject가 다르다.
- provenance의 source digest가 배포 대상 commit과 다르다.
- SBOM·scan 파일의 byte digest가 달라졌다.
- SPDX·CycloneDX·scan이 서로 다른 image를 가리킨다.
- scan에 기록한 Trivy image와 signed toolchain이 다르다.
- vulnerability database가 오래됐거나 미래 시각이다.
- DSSE signature나 trusted key ID가 다르다.
- attestation이 24시간보다 오래됐다.

BuildKit의 native provenance와 SBOM도 registry에 함께 push한다. repository의 DSSE bundle은 조직 release key와 로컬 정책을 적용하기 위한 추가 증거다.

## 7. 확인한 것과 남은 증거

다음 항목은 자동 시험으로 확인했다.

- CaaS·DSaaS·EDC 세 span의 trace ID와 parent 관계
- tenant bucket 상한과 비밀값 제거
- 실제 loopback OTLP/HTTP collector로 보낸 JSON batch
- 인증한 trace·metric·log 시작 probe, signal별 TTL과 실패·복구 판정
- 신뢰한 client certificate와 bearer token을 함께 요구하는 trace·metric·log OTLP 전송
- mTLS 후보 검증, 진행 중 요청 drain, 잘못된 후보 거부, readiness 복구 generation
- WORM capability·backend ID 시작 probe, TTL 만료와 복구 판정
- 두 tenant 사용량 원장의 RLS 격리·idempotency·rollup 재처리
- 인증된 403·404 관리 요청의 `molit-platform` 귀속과 사용량 outbox 반출
- tenant-aware 사용량 outbox claim, OTLP log 전달, receipt ack, dead letter 판정
- 실제 PostgreSQL의 상태·접근감사 WORM 반출, receipt ack, invalid 접근감사 dead letter·readiness 차단
- scoped state·idempotency·domain audit·state-commit audit·`audit.appended` outbox의 PostgreSQL 원자 commit과 잘못된 tenant ack 거부
- 30일 SLI, 다중 구간 burn rate Prometheus rule, Grafana dashboard 계약
- Collector 무기한 재시도, queue backpressure, logs의 fsync queue 선행, pipeline readiness 설정
- queue 포화·enqueue 실패 Prometheus 경보와 pinned Collector·promtool 설정 검증
- 감사 중복·변조·삭제·retention 변경 거부
- SPDX·CycloneDX·scan·provenance·DSSE의 image subject 일치
- 서명과 산출물 변조 거부
- Source image 6종의 실제 build, non-root·read-only runtime probe와 runtime class label
- EDC schema migration의 TLS `verify-full`, 2회 멱등 실행, Control Plane 12개·Data Plane 2개 table과 잘못된 hostname·CA 거부
- 외부 채택 2종의 inventory Schema, 고정 upstream digest와 release 경로 계약
- Kyverno stable API 정책 2개의 8개 runtime class·container 유형·subresource 적용 계약
- P0 local harness의 exact profile, log·중첩 artifact digest와 운영 증거 분리 계약

다음 항목은 로컬 source image 실행 증거와 별개로 운영 환경에서 받아야 한다.

- 외부 OTLP backend의 가용성·보존 기간·tenant별 조회 권한
- 외부 OTLP log sink의 `eventId` 중복 제거와 보존 정책
- Collector queue 영속 volume의 용량 산정, 복제, backup·restore, 고갈 훈련 결과
- WORM 제품의 object lock, 관리자 우회 통제, retention 만료 시험
- Source build 6종과 외부 채택 2종을 운영 registry에 게시한 최종 digest와 서명 bundle
- 운영 release key의 HSM·KMS 보관, rotation, 폐기 기록
- 실제 image에 대한 최신 scanner database 결과
- 운영 Kyverno admission controller의 signature·digest·runtime identity 거부 결과

## 8. 기준 규격

- W3C Trace Context Recommendation: <https://www.w3.org/TR/trace-context/>
- OpenTelemetry Protocol Specification: <https://opentelemetry.io/docs/specs/otlp/>
- in-toto Attestation Framework: <https://github.com/in-toto/attestation>
- DSSE protocol: <https://github.com/secure-systems-lab/dsse/blob/master/protocol.md>
- SLSA Provenance v1: <https://slsa.dev/spec/v1.0/provenance>
- SPDX 2.3: <https://spdx.github.io/spdx-spec/v2.3/>
- CycloneDX 1.6 JSON: <https://cyclonedx.org/docs/1.6/json/>
