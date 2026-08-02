# 운영 이미지 공급망과 외부 이미지 채택

## 1. 적용 범위

운영 Kubernetes 경로에서 실행하는 이미지는 `deploy/supply-chain/runtime-image-inventory.v1.json`에 등록한다. 목록에 없는 이미지는 배포 후보가 아니다. 목록은 이미지 이름을 나열하는 문서가 아니라 다음 세 항목을 연결하는 원장이다.

1. release attestation의 `runtimeClass`와 `productionEligible`
2. 이미지를 만드는 방식 또는 외부 이미지를 채택하는 방식
3. Kubernetes manifest와 CaaS provisioner에서 해당 이미지를 넣는 위치

현재 원장은 8개 runtime class를 관리한다.

| runtime class | 생성 방식 | P0 운영 적격 | 배포 용도 |
| --- | --- | --- | --- |
| `caas-control-plane` | source build | 예 | CaaS API, cutover, recovery |
| `dsaas-control-plane` | source build | 예 | DSaaS API와 scheduler |
| `fencing-webhook` | source build | 예 | Kubernetes fencing webhook |
| `edc-control-plane` | source build | 아니요 | tenant EDC Control Plane |
| `edc-data-plane` | source build | 아니요 | tenant EDC Data Plane |
| `schema-migration` | source build | 예 | tenant EDC schema, control-store migration과 bootstrap |
| `postgres-operand` | external adoption | 예 | CloudNativePG operand |
| `otel-collector` | external adoption | 예 | in-cluster OpenTelemetry Collector |

release 명령의 `service`와 서명 대상인 `runtimeClass`는 별도 필드다. 예를 들어 `service=caas`의 canonical runtime class는 `caas-control-plane`이다. Docker label, release attestation, 원장의 값이 모두 같아야 한다.

`DATABASE_TOOL_IMAGE`는 별도 runtime class가 아니다. `service=edc-schema-migration`, `runtimeClass=schema-migration` 이미지에 들어 있는 `psql`을 control-store migration과 runtime role bootstrap에서도 사용한다. 이 관계는 원장의 `deploymentUses`로 고정한다.

## 2. 운영 적격 판정

서명만 있으면 배포할 수 있는 구조가 아니다. release attestation에는 `runtimeClass`, `productionEligible`, `provenanceMode`가 서명 대상에 포함되어야 한다. 운영 admission은 stable API인 `policies.kyverno.io/v1 ImageValidatingPolicy`를 사용한다. Kyverno는 다음 조건을 모두 확인한다.

- 승인 registry의 digest reference인가
- 승인 키의 image signature가 있는가
- release attestation의 취약점 판정이 `pass`인가
- `productionEligible`이 `true`인가
- attestation 생성 시각과 취약점 DB 시각이 허용 범위 안인가

EDC Control Plane과 Data Plane은 빌드와 검사를 수행하되 `productionEligible=false`로 발행한다.

DSP TCK, 운영 identity, 실제 전송, 외부 connector 상호운용 증거가 없기 때문이다. 이 이미지를 managed tenant namespace에 넣으면 admission이 거부해야 한다. `smoke-control-plane`과 `smoke-data-plane` target은 운영 원장에 넣지 않는다.

## 3. 외부 이미지 채택

PostgreSQL과 OpenTelemetry Collector는 이 저장소에서 다시 빌드하지 않는다. `deploy/images/adopt-sign-verify.ps1`은 승인한 upstream digest를 내부 mirror에 byte-identical digest로 복제하고 다음 증거를 새로 만든다.

1. mirror digest를 대상으로 만든 SPDX와 CycloneDX SBOM
2. 최신 DB로 실행한 vulnerability, secret, misconfiguration 검사
3. upstream bytes와 adoption policy tree를 묶은 `external-adoption` provenance
4. `runtimeClass`와 `productionEligible=true`를 포함한 release attestation
5. 내부 release key로 만든 OCI signature와 attestation 검증 결과

upstream과 mirror digest가 다르면 중단한다. image subject 자체가 양쪽 registry에서 같은 bytes를 가리킨다.

`sourceDigest`에는 clean Git adoption-policy tree digest를 기록한다. resolved dependency URI는 `git+adoption-policy`, build type은 `external-image-adoption`이다.

외부 제작자의 provenance를 국토교통 데이터 스페이스가 직접 빌드한 provenance로 바꾸어 적지 않는다. 이 절차는 해당 upstream bytes를 특정 정책 버전으로 검토하여 내부 registry에 채택했다는 사실을 증명한다.

```powershell
./deploy/images/adopt-sign-verify.ps1 `
  -Service postgres-operand `
  -UpstreamImage "postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193" `
  -MirrorTag "registry.example/molit/postgres-operand:17.10-alpine3.24" `
  -RegistryPrefix "registry.example/molit" `
  -PrivateKeyPath <release-bundle-private-key> `
  -PublicKeyPath <release-bundle-public-key> `
  -CosignPrivateKeyPath <cosign-private-key> `
  -CosignPublicKeyPath <cosign-public-key> `
  -RegistryConfigPath <docker-config.json>
```

`MirrorTag`는 복제 명령이 쓸 대상 태그다. 스크립트는 복제 직후 원본과 이 태그의 manifest digest가 같은지 확인하고, 이후 SBOM·검사·서명 작업에는 `registry.example/molit/postgres-operand@sha256:<검증한 digest>`만 사용한다. `RegistryPrefix`와 서비스 이름이 만든 canonical repository 밖의 태그는 입력 단계에서 거부한다.

로컬 계약시험은 스크립트, 원장, attestation 검증 규칙을 검사한다. 운영 registry에 실제로 게시한 digest, KMS 또는 HSM key 서명, scan 시점, admission 결과는 운영 증거다. 로컬 시험 결과로 이를 대체하지 않는다.

## 4. 취약점 예외

P0 release 경로에는 취약점 waiver가 없다. `UNKNOWN`, `HIGH`, `CRITICAL` finding이 하나라도 있으면 release bundle을 만들지 않는다. 승인자와 만료시각만 추가하여 차단을 우회하는 기능도 두지 않는다.

이 정책은 예외 처리 미구현을 묵인한 것이 아니다. 원장의 `vulnerabilityExceptionPolicy=no-waiver`와 계약시험으로 예외 금지를 고정한다. 이후 운영상 예외 제도가 필요하면 별도 변경안에서 다음 항목을 모두 설계하고 보안 심의를 거쳐야 한다.

- 정확한 image digest와 finding ID
- 적용 범위와 보완통제
- 승인자와 변경기록
- 짧은 만료시각과 자동 차단 복귀
- 재검사 결과와 감사기록

그 변경이 승인되기 전에는 취약점 Gate를 우회할 수 없다.

## 5. 검증

```powershell
npm run test:supply-chain
npm run test:runtime-images
```

`test:runtime-images`는 source build 대상의 non-root, read-only, healthcheck, OCI label을 실제 이미지로 검사한다. `test:supply-chain`은 8개 runtime class의 배포 위치가 원장에 정확히 한 번 등록됐는지와 external adoption release bundle의 fail-closed 조건을 검사한다.
