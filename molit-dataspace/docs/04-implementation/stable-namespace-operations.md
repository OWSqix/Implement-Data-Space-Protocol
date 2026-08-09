# MOLIT DCAT-AP namespace 배포와 검증

작성일: 2026-07-13
대상: MOLIT DCAT-AP 1.0.0-rc.1
상태: 배포 가능한 소스코드, 기관 배포 전

이 문서는 `https://data.molit.go.kr` 아래에서 프로파일과 온톨로지를 발행하는 절차를 다룬다. 서버 소스코드는 저장소에 들어 있다. DNS 위임, 공인 TLS 인증서, 운영기관의 namespace 승인은 저장소 밖에서 처리해야 한다. 이 서버의 발행 범위는 RC.1 계약에 등록된 `/def/molit-dcat-ap`와 `/profile/molit-dcat-ap` 계열이다. `data.molit.go.kr` 전체 namespace를 발행하지 않는다.

## 1. 현재 판정

| 항목 | 현재 상태 | 판정 근거 |
| --- | --- | --- |
| HTTP namespace 서버 | 구현 | `src/publication/` |
| HTML·Turtle·JSON-LD 협상 | 구현 | `publication/content-negotiation.json`을 기동 시 검사 |
| 고정 바이트와 ETag | 구현 | release 파일을 메모리에 적재하고 SHA-256 ETag 산출 |
| 컨테이너 배포 | 구현 예시 | `deploy/namespace/` |
| 원격 배포 검증 | 구현 | `namespace:attest` |
| 프로파일·온톨로지 namespace | 소스 구현 | `/def/molit-dcat-ap`, `/profile/molit-dcat-ap` |
| 어휘·식별자 namespace | 미구현 | `/id/concept`, `/id/metric`, `/scheme`의 기관 registry 승인 대기 |
| `data.molit.go.kr` DNS와 TLS | 미배포 | 운영기관의 DNS·인증서 작업 필요 |
| RA-NAMESPACE | 열림 | 실제 주소에 대한 원격 검증 증거 없음 |

`namespaceStatus=proposed-not-yet-dereferenceable`은 아직 유효하다. 소스코드가 있다는 사실만으로 공개 주소가 열렸다고 판정하지 않는다.

RC.1 graph는 `https://data.molit.go.kr/id/concept/...`, `/id/metric/...`, `/scheme/...` IRI도 사용한다. 국내 통제어휘와 식별자 registry는 후보 상태이며 운영기관 승인을 받지 않았다. 현재 서버는 이 경로에 404를 반환한다. 후보값을 live namespace로 발행하지 않는다.

## 2. 발행 주소

서버는 RC.1의 content-negotiation 계약에 적힌 IRI만 처리한다.

| 자원 | stable IRI | version IRI |
| --- | --- | --- |
| 온톨로지 | `https://data.molit.go.kr/def/molit-dcat-ap` | `https://data.molit.go.kr/def/molit-dcat-ap/1.0.0-rc.1` |
| 프로파일 | `https://data.molit.go.kr/profile/molit-dcat-ap` | `https://data.molit.go.kr/profile/molit-dcat-ap/1.0.0-rc.1` |
| 모듈 | `/profile/molit-dcat-ap/{module}` | `/profile/molit-dcat-ap/1.0.0-rc.1/{module}` |

모듈 이름은 `geo`, `network`, `observation`, `quality`, `dataspace-offering`, `publication-policy`다. stable IRI는 현재 승인된 release로 이동할 수 있다. version IRI의 바이트는 바꾸지 않는다.

요청의 `Accept` 값에 따른 응답은 다음과 같다.

| Accept | 응답 파일 |
| --- | --- |
| `text/html` | 사람이 읽는 해설 또는 온톨로지 문서 |
| `text/turtle` | RDF Turtle |
| `application/ld+json` | JSON-LD |
| 없음 | `text/html` |
| 지원하지 않는 형식만 지정 | HTTP 406 |

끝에 `/`가 붙은 등록 IRI는 query를 보존한 채 slash가 없는 IRI로 HTTP 308 응답을 낸다. 등록하지 않은 경로는 404다.

## 3. 서버 동작

`src/publication/cli.mjs`는 다음 순서로 기동한다.

1. JSON Schema로 설정을 검사한다.
2. `publicOrigin`과 계약의 모든 IRI origin이 같은지 확인한다.
3. 계약이 가리키는 파일의 실제 경로가 release 디렉터리 안에 있는지 확인한다.
4. symlink와 `..`를 이용한 release 경계 이탈을 거부한다.
5. 계약과 모든 representation의 SHA-256을 `artifact-lock.json`과 비교한다.
6. 발행 파일을 메모리에 읽고 strong ETag를 계산한다.
7. 계약의 모든 IRI와 media type 조합을 공용 협상 함수로 검사한다.
8. 검사가 끝난 뒤 listen socket을 연다.

서버는 요청 경로를 파일 경로로 바꾸지 않는다. 요청은 계약 IRI allowlist에서 찾고, artifact는 기동 시 만든 메모리 snapshot에서 읽는다.

### 3.1 HTTP 처리

- `GET`과 `HEAD`만 허용한다.
- `If-None-Match`가 현재 representation ETag와 맞으면 304를 반환한다.
- version IRI에는 `immutable` cache 정책을 적용한다.
- stable IRI에는 5분 cache와 재검증을 적용한다.
- `/healthz`는 프로세스 생존 상태를 반환한다.
- `/readyz`는 snapshot 적재가 끝난 프로세스만 200을 반환한다.
- SIGTERM과 SIGINT를 받으면 readiness를 내리고 connection 종료를 기다린다.

### 3.2 요청 경계

서버는 `Host` 값을 설정의 `allowedHosts`와 정확히 비교한다. redirect와 canonical header는 `Host`나 `X-Forwarded-Host`로 만들지 않고 `publicOrigin`으로 만든다. 다음 요청은 처리하지 않는다.

- Host가 없거나 allowlist와 다른 요청
- Host가 둘 이상인 요청
- `..`, encoded slash, backslash, NUL이 들어간 경로
- scheme-relative request target
- 설정한 길이를 넘는 request target

응답에는 CSP, `nosniff`, frame 차단, referrer 차단, 기능 권한 차단 header가 붙는다. RDF를 브라우저 애플리케이션에서 읽을 수 있도록 `Access-Control-Allow-Origin: *`와 `Cross-Origin-Resource-Policy: cross-origin`을 사용한다. 서버가 처리하는 자원은 공개 규격 artifact로 한정한다.

## 4. 로컬 기동

저장소 루트에서 다음 명령을 실행한다.

```powershell
$env:MOLIT_NAMESPACE_PORT = "8080"
$env:MOLIT_NAMESPACE_ALLOWED_HOSTS = "data.molit.go.kr"
npm run namespace:serve
```

listen socket은 HTTP다. 운영 배포에서는 reverse proxy가 TLS를 종료한다. 로컬 확인 요청에도 계약 Host를 넣는다.

```powershell
curl.exe -H "Host: data.molit.go.kr" `
  -H "Accept: text/turtle" `
  http://127.0.0.1:8080/def/molit-dcat-ap

curl.exe -I -H "Host: data.molit.go.kr" `
  -H "Accept: application/ld+json" `
  http://127.0.0.1:8080/profile/molit-dcat-ap/1.0.0-rc.1
```

## 5. 설정

전체 설정 예시는 [`namespace.config.json`](../../deploy/namespace/namespace.config.json)에 있다. 파일을 쓸 때는 `MOLIT_NAMESPACE_CONFIG`에 경로를 넣는다. 환경변수가 파일 값을 덮어쓴다.

| 환경변수 | 기본값 | 용도 |
| --- | --- | --- |
| `MOLIT_NAMESPACE_CONFIG` | 없음 | JSON 설정 파일 경로 |
| `MOLIT_NAMESPACE_RELEASE_ROOT` | RC.1 release 경로 | 발행할 잠금 release |
| `MOLIT_NAMESPACE_CONTRACT_FILE` | `publication/content-negotiation.json` | release 안의 협상 계약 |
| `MOLIT_NAMESPACE_PUBLIC_ORIGIN` | `https://data.molit.go.kr` | canonical origin |
| `MOLIT_NAMESPACE_ALLOWED_HOSTS` | `data.molit.go.kr` | comma로 구분한 Host authority |
| `MOLIT_NAMESPACE_LISTEN_HOST` | `127.0.0.1` | listen 주소 |
| `MOLIT_NAMESPACE_PORT` | `8080` | listen port |
| `MOLIT_NAMESPACE_GRACEFUL_SHUTDOWN_MS` | `10000` | 종료 대기 상한 |
| `MOLIT_NAMESPACE_HEADER_TIMEOUT_MS` | `10000` | header 수신 상한 |
| `MOLIT_NAMESPACE_REQUEST_TIMEOUT_MS` | `30000` | 요청 처리 상한 |
| `MOLIT_NAMESPACE_KEEP_ALIVE_TIMEOUT_MS` | `5000` | idle keep-alive 상한 |
| `MOLIT_NAMESPACE_MAX_ARTIFACT_BYTES` | `33554432` | 파일 하나의 byte 상한 |
| `MOLIT_NAMESPACE_MAX_SNAPSHOT_BYTES` | `134217728` | 메모리 snapshot의 byte 상한 |
| `MOLIT_NAMESPACE_MAX_URL_LENGTH` | `4096` | request target 길이 상한 |

`allowedHosts`에 `*`를 넣을 수 없다. port가 붙은 Host를 받으려면 `data.molit.go.kr:8443`처럼 port까지 적는다.

## 6. 컨테이너와 TLS proxy

컨테이너는 root가 아닌 `node` 사용자로 실행한다. Compose 예시는 filesystem을 read-only로 만들고 Linux capability를 전부 제거한다.

```powershell
docker compose -f deploy/namespace/compose.yaml build
docker compose -f deploy/namespace/compose.yaml up -d
```

Compose는 `127.0.0.1:8080`에만 port를 연다. 같은 host의 TLS proxy가 이 port로 요청을 넘긴다.

[`nginx.conf.example`](../../deploy/namespace/nginx.conf.example)은 다른 Host를 421로 거부한다. upstream Host는 `data.molit.go.kr`로 고정하고 proxy 압축은 끈다. HTTPS 응답에는 1년 HSTS를 붙인다. 운영자는 HSTS를 켜기 전에 인증서 갱신과 HTTPS 상시 운영 절차를 승인해야 한다.

Dockerfile의 기본 Node tag는 개발용 기준선이다. 운영 build에서는 검토한 registry manifest digest를 포함한 `NODE_IMAGE` argument를 사용한다. 최종 image digest는 배포 승인 기록에 남긴다.

운영자는 다음 값을 배포 전에 교체하거나 확인한다.

1. 기관 DNS에서 `data.molit.go.kr`을 운영 endpoint로 연결한다.
2. SAN에 `data.molit.go.kr`이 들어간 공인 인증서를 설치한다.
3. TLS 1.2와 1.3만 허용한다.
4. proxy가 response body를 압축하거나 다시 쓰지 않는지 확인한다.
5. 외부 망에서 80의 HTTPS redirect와 443 응답을 검사한다.

새 release를 배포할 때 기존 version IRI를 제거하지 않는다. 기존 컨테이너는 해당 version 경로에 남기고, stable 경로만 승인된 새 컨테이너로 전환한다. 전환 전에 새 release의 content-negotiation 계약과 artifact lock을 검토한다.

## 7. 원격 attestation

원격 검증기는 명령에 `--execute-network`가 없으면 network socket을 열지 않는다. 실제 배포가 끝난 다음 운영자가 다음 명령을 실행한다.

```powershell
npm run namespace:attest -- `
  --execute-network `
  --expected-origin=https://data.molit.go.kr `
  --release-root=profiles/molit-dcat-ap/releases/1.0.0-rc.1 `
  --output=.local/namespace-attestation-1.0.0-rc.1.json
```

사설 기관 CA를 사용해야 할 때만 `--ca-file=<검토한 CA PEM>`을 추가한다. 인증서 검증을 끄는 option은 없다. output 파일이 이미 있으면 덮어쓰지 않고 실패한다.

검증기는 다음 값을 기계적으로 비교한다.

- 기대 origin과 계약 IRI의 HTTPS origin
- 모든 stable·version·module IRI의 세 media type
- 원격 body SHA-256과 `artifact-lock.json`의 SHA-256
- Content-Type과 HTTP 200
- strong ETag, HEAD의 ETag·Content-Length, conditional GET의 304
- trailing slash의 308과 query 보존
- 미등록 경로의 404와 허용하지 않은 Accept의 406
- 인증된 TLS 1.2 또는 TLS 1.3과 인증서 정보

JSON의 `passed`가 `true`이고 실패한 check가 없어야 한다. 이 파일에는 원격 상태와 검사 시각이 들어가므로 release artifact lock과 별도로 보관한다. 실제 `data.molit.go.kr`을 호출하지 않은 local test report는 RA-NAMESPACE 근거로 쓰지 않는다.

## 8. RA-NAMESPACE 종료 절차

운영 책임자는 다음 증거를 한 묶음으로 검토한다.

1. DNS 변경 승인 기록
2. TLS 인증서 chain과 만료 관리 책임자
3. 배포한 image digest와 Git commit
4. 배포한 release의 `artifact-lock.json` SHA-256
5. 원격 attestation JSON
6. stable IRI 변경 승인자와 rollback 대상 version

이 검토가 끝난 뒤에만 프로파일·온톨로지 namespace 배포 증거를 승인한다. 서버 source test, Docker build 성공, 내부 IP의 응답은 공개 namespace 배포 증거를 대신하지 않는다.

전체 RA-NAMESPACE를 닫으려면 다음 작업도 끝내야 한다.

1. 운영기관이 국내 통제어휘와 식별자 registry를 승인한다.
2. `/id/concept`, `/id/metric`, `/scheme`의 representation 계약을 작성한다.
3. 어휘별 HTML·Turtle·JSON-LD와 stable·version IRI를 발행한다.
4. 폐기 코드의 tombstone과 `replacedBy` 응답 정책을 고정한다.
5. artifact lock과 원격 attestation 범위에 어휘·식별자 IRI를 추가한다.

## 9. 시험

namespace 시험은 외부 network를 호출하지 않는다. remote attestation 시험은 test 전용 self-signed 인증서가 붙은 loopback HTTPS proxy를 만든다.

```powershell
npm run test:namespace
```

test 인증서와 private key는 `tests/namespace/fixtures/generate.mjs`가 시험 프로세스 메모리에서 생성하며 파일로 저장하지 않는다.
이 키는 시험 실행 중에만 존재하며 어떤 신뢰 저장소·운영 CA에도 등록하지 않는다.
