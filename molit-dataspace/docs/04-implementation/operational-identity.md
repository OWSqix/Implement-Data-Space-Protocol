# 운영 신원 계층 구현

## 1. 판정

신원 계층은 OIDC 서명 토큰과 RFC 7662 introspection을 같은 principal 계약으로 변환한다.

Production CaaS·DSaaS는 durable JWT revocation Registry가 연결될 때까지 RFC 7662 introspection만 허용한다.

사람 계정에는 `acr`와 `amr` 정책을 적용한다. Service account에는 `cnf.x5t#S256` 인증서 바인딩을 의무화한다.

시험 근거: [Keycloak container 지침](https://www.keycloak.org/server/containers), `IDENTITY-KEYCLOAK-IT-2026-07-14`, `tests/integration/identity-keycloak.test.mjs`

2026년 7월 14일 실행 결과는 Keycloak 26.7.0의 discovery, JWKS 검증, introspection, token 폐기를 확인했다. 근거는 [Keycloak container 지침](https://www.keycloak.org/server/containers)과 `IDENTITY-KEYCLOAK-IT-2026-07-14`다.

이 시험은 비밀번호 인증 흐름을 사용했다. 운영 MFA 등록과 인증 ceremony를 입증하는 시험은 아니다.

| 구분 | 구현 상태 | 판정 근거 |
| --- | --- | --- |
| OIDC discovery와 JWKS | 개발·상호운용 경로 구현·시험 완료 | Issuer 일치, origin 고정, 서명 검증, production 설정 거부 |
| RFC 7662 introspection | Production 경로 구현·시험 완료 | 시작 probe, `active=true`만 허용, 폐기 뒤 거부, TTL readiness |
| 사람 계정 MFA 정책 | 구현·단위시험 완료 | 허용 `acr`, 요구 `amr`가 없으면 거부 |
| service account mTLS | 구현·실제 TLS 시험 완료 | Node TLS socket의 peer 인증서와 token `cnf` 비교 |
| JWT 폐기 조회 | 어댑터 구현 완료 | 신선한 durable record가 없으면 거부 |
| DCP presentation | 검증기 경계 구현 완료 | 실제 발급·상태·trust anchor는 미배치 |
| CaaS·DSaaS 연결 | 구현·실제 TLS 시험 완료 | production 요청 경로에서 운영 authenticator 사용 |
| 인증서 무중단 회전 | 구현·실제 TLS 시험 완료 | 실패 시 기존 context 유지, readiness 차단, 복구 뒤 교체 |

## 2. 신원 계약

인증 결과는 `molit.identity-principal/1` 객체다. 원문 token과 client secret은 결과와 감사 레코드에 들어가지 않는다.

| 필드 | 판정에 사용한 값 |
| --- | --- |
| `issuer` | 운영 설정과 `iss`의 완전 일치 |
| `subject`·`principalId` | `sub` |
| `clientId` | 설정한 `azp` 또는 `client_id` 경로 |
| `tokenId` | 설정한 `jti` 경로 |
| `signingKeyId` | JWT header의 검증된 `kid` |
| `actorType` | `human` 또는 `service`로 매핑한 claim |
| `roles` | 허용 목록에 들어 있는 역할만 수용 |
| `tenantIds` | 요청 tenant가 claim 목록에 있을 때만 수용 |
| `certificateThumbprint` | service account가 제시한 mTLS 인증서 hash |
| `issuedAt`·`expiresAt` | 검증을 마친 `iat`·`exp` |

`exp`, `iat`, `nbf`는 정수 NumericDate여야 한다. 최대 token 수명과 clock skew는 운영 설정으로 제한한다. 사람 계정은 허용한 `acr` 하나와 요구한 `amr` 중 하나를 모두 가져야 한다. service account는 인증된 TLS socket에서 읽은 DER 인증서와 `cnf.x5t#S256`이 일치해야 한다.

이 바인딩은 OAuth 2.0 mTLS certificate-bound access token의 protected resource 검증 절차를 따른다. 근거는 [RFC 8705 3.1절과 3.2절](https://www.rfc-editor.org/rfc/rfc8705.html#section-3.1)이다.

## 3. 인증 경로

### 3.1 OIDC 서명 token

`OidcJwtAuthenticator`는 다음 순서로 판정한다.

1. 원시 HTTP header에서 `Authorization`이 정확히 하나인지 확인한다.
2. compact JWT 세 부분을 canonical base64url로 해석한다.
3. 중복 member를 허용하지 않는 JSON parser로 header와 claim을 읽는다.
4. 운영 설정, JWT `alg`, JWK `alg`가 같은지 확인한다.
5. OIDC metadata의 `issuer`가 설정값과 완전히 같은지 확인한다.
6. `jwks_uri` origin이 사전 허용 목록에 있는지 확인한다.
7. 서명, token type, issuer, audience, client, tenant, role, 시간을 검증한다.
8. 사람 MFA 또는 service account 인증서 바인딩을 검증한다.
9. durable revocation 조회가 최신 `VALID`을 반환한 경우에만 principal을 만든다.

Discovery가 돌려준 issuer를 설정값과 동일하게 비교하는 규칙은 [OpenID Connect Discovery 1.0 4.3절](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation)에 근거한다. 알고리즘 허용 목록, `kid` 입력 제한, `jku`·`x5u` 차단과 명시적 `typ` 검사는 [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)의 3.1절, 3.10절, 3.11절을 적용했다.

### 3.2 JWKS 회전

JWKS 응답은 전체 검증이 끝난 뒤 한 번에 교체한다. 서명용이 아닌 키는 신뢰 후보에서 제외하되 전체 key set의 `kid` 중복은 거부한다.

새 JWKS에서 빠진 이전 키는 `rotationOverlapMs` 동안만 남긴다. 같은 `kid`에 다른 key material이 들어오면 정상 회전으로 보지 않고 `IDENTITY_JWKS_KID_COLLISION`으로 거부한다. 새 키는 새 `kid`를 사용해야 한다.

동시에 시작한 refresh는 시작 순번이 더 늦은 결과만 최종 cache를 갱신한다. 한 요청의 취소가 다른 요청의 refresh promise를 취소하지 않도록 refresh 작업을 공유하지 않는다.

### 3.3 RFC 7662 introspection

`IntrospectionAuthenticator`는 bearer token을 매 요청마다 인증 서버에 전송한다. 응답의 `active`가 `true`인 경우에도 동일한 issuer, audience, 시간, client, tenant, role, MFA·mTLS 정책을 다시 적용한다.

client secret은 설정 파일의 값이 아니라 `clientSecretRef`로 조회한다. HTTP Basic을 만들 때 client ID와 secret을 각각 form encoding한다. Introspection 요청과 `active` 의미는 [RFC 7662 2.1절과 2.2절](https://www.rfc-editor.org/rfc/rfc7662.html#section-2.1)을 따른다.

운영 설정은 `file://` reference만 허용한다. `BoundedFileSecretProvider`는 매 요청마다 파일을 다시 열고 크기, 파일 형식, 읽는 도중의 변경 여부를 확인한다. Kubernetes Secret과 Vault CSI가 symlink 대상을 교체하면 다음 introspection 요청부터 새 secret을 사용한다.

Runtime 시작 시 client credential로 발급된 적 없는 probe token을 조회한다. 응답이 인증됐고 `active=false`인 경우에만 초기화를 통과한다.

마지막 성공 시각이 `readinessMaxAgeMs`를 넘거나 secret·endpoint 검사가 실패하면 readiness를 닫는다. Readiness probe가 같은 검사를 다시 통과한 경우에만 복구한다.

### 3.4 JWT 폐기 Registry

서명과 만료 검증만으로는 발급 뒤 폐기된 JWT를 찾을 수 없다. `DurableRevocationRegistryChecker`는 issuer와 token ID로 durable registry를 조회한다.

레코드는 `VALID` 또는 `REVOKED`여야 하고, issuer와 token ID가 요청값과 같아야 한다. `observedAt`이 `maxRecordAgeMs`보다 오래됐거나 조회가 실패하면 인증을 거부한다. 운영 배포에서는 IdP event 또는 introspection 결과를 registry에 반영하는 consumer와 저장소 가용성 지표가 필요하다.

## 4. 네트워크 방어

`PinnedJsonClient`는 identity endpoint를 다음과 같이 제한한다.

- HTTPS origin 사전 등록
- redirect 거부
- URL userinfo와 fragment 거부
- cookie 전송 금지
- 응답 크기와 UTF-8 강제
- JSON media type 강제
- 중복 JSON member 거부
- 요청 timeout과 상위 `AbortSignal` 전달

HTTP loopback은 Keycloak 통합시험에서만 `allowInsecureLoopback=true`로 연다. 이 설정으로 만든 authenticator는 `productionEligible=false`다.

CaaS와 DSaaS production listener는 Node가 TLS를 직접 종단한다. 서버 인증서, private key, client CA는 별도 파일로 읽는다.

`requestCert=true`와 `rejectUnauthorized=false`를 함께 사용한다. 사람 계정의 무인증서 MFA 요청과 service account의 mTLS 요청을 한 listener에서 구분하기 위해서다. 인증서가 제시됐는데 신뢰 체인을 통과하지 못한 요청은 handler 진입 직후 거부한다. service account는 token의 `cnf.x5t#S256`과 peer 인증서가 같아야 한다.

파일 감시기는 유효기간, server 인증서의 비 CA 속성, client CA 속성, private key 일치를 확인한다. 검증을 마친 뒤에만 `server.setSecureContext()`를 호출한다.

검증에 실패하면 기존 context를 유지하고 `/readyz`만 503으로 내린다. 정상 세트가 들어오면 같은 port에서 context를 교체한다. session ticket key도 바꿔 이전 client CA로 만든 재개 세션을 폐기한다.

## 5. DCP 경계

`DcpCredentialVerifierAdapter`는 presentation verifier가 반환한 다음 증거를 다시 확인한다.

- 요청 audience와 검증 결과 audience의 일치
- 사전 등록한 credential issuer
- credential status 확인 완료
- 필수 credential type
- participant ID와 proof key ID
- credential ID와 만료 시각

Eclipse DCP v1.0은 participant identity, credential 발급과 presentation protocol을 정의한다. credential type과 trust semantic model은 DCP 범위 밖이다. 근거는 [Eclipse DCP v1.0](https://eclipse-dataspace-dcp.github.io/decentralized-claims-protocol/)과 [Eclipse 프로젝트 범위](https://projects.eclipse.org/projects/technology.dataspace-dcp/governance)다.

저장소에는 DCP 발급기관, credential status service, trust anchor가 없다. `UnavailableDcpCredentialVerifier`는 이 상태에서 `IDENTITY_DCP_ISSUANCE_TRUST_CHAIN_NOT_DEPLOYED`를 반환한다. 고정 fixture로 성공을 가장하지 않는다.

## 6. 코드와 계약

| 경로 | 역할 |
| --- | --- |
| `src/identity/runtime.mjs` | 인증 방식별 runtime factory |
| `src/identity/oidc-jwt.mjs` | discovery, JWKS cache, JWT 서명 검증 |
| `src/identity/introspection.mjs` | RFC 7662 인증 |
| `src/identity/claims.mjs` | principal, tenant·role·MFA 정책 |
| `src/identity/certificate.mjs` | mTLS certificate-bound token 검증 |
| `src/identity/revocation-registry.mjs` | durable token 폐기 판정 |
| `src/identity/dcp-adapter.mjs` | DCP 검증기 경계와 미배치 오류 |
| `src/identity/operational-config.mjs` | 운영 설정 검증과 회전 가능한 file secret 조회 |
| `src/identity/tls-runtime.mjs` | TLS 종단, client 인증서 신뢰, 인증서 무중단 회전 |
| `contracts/identity-runtime-config.v1.schema.json` | 인증 runtime 설정 계약 |
| `contracts/identity-principal.v1.schema.json` | 감사 가능한 principal 계약 |

## 7. CaaS·DSaaS 연결

CaaS와 DSaaS의 production 설정은 `identityConfigPath`와 `tls`가 없으면 계약 검증에서 거부된다. Identity mode는 `rfc7662-introspection`이어야 하고 `readinessMaxAgeMs`를 가져야 한다.

`oidc-jwt`와 static bearer는 production 계약에 넣을 수 없다. Development와 test 환경에서만 OIDC JWT와 static 인증을 사용할 수 있다.

DSaaS의 `OperationalDsaasAuthenticatorAdapter`는 검증된 principal의 `roles`를 그대로 유지하고 `tenantIds`를 기존 서비스 계약의 `dataspaceIds`로 바꾼다. 원문 token과 introspection secret은 actor 객체에 넣지 않는다. 기존 `DsaasControlPlane`의 operator, dataspace-admin, dataspace-reader 검사는 이 actor를 사용한다.

CaaS의 `CaaSAuthorizer`는 production에서 비동기 운영 authenticator만 호출한다. `caas.admin`, `caas.controller`, `caas.tenant`를 기존 감사 role로 바꾼다.

controller 요청은 token의 tenant claim과 설정에 고정한 dataspace, tenant, connector plan 범위를 모두 통과해야 한다. tenant 요청도 URL tenant가 token claim에 없으면 거부한다.

두 runtime은 production 시작 전에 `authenticator.productionEligible === true`를 확인한다. 인증한 introspection 시작 probe와 초기 TLS material 검증도 끝내야 한다.

이후 `/readyz`는 introspection 성공 TTL과 TLS 회전 상태를 함께 판정한다. 이전 `apiAccessSecretRef` 필드는 상태 호환용이며 인증에 사용하지 않는다.

SAML assertion은 CaaS와 DSaaS가 직접 파싱하지 않는다. 운영 IdP가 SAML identity provider를 broker한다. API에는 이 문서의 issuer, audience, MFA, role, tenant 정책을 만족하는 OIDC 또는 OAuth access token을 발급한다.

SAML federation 적합성은 broker의 서명 검증, attribute mapping, 세션 폐기 시험으로 입증한다.

## 8. 시험

단위시험은 다음 명령으로 실행한다.

```powershell
node --test tests/unit/identity-*.test.mjs
```

production 요청 경로와 TLS 회전 시험은 다음 파일에 있다.

```powershell
node --test tests/integration/identity-production-tls.test.mjs
```

이 시험은 신뢰 CA와 비신뢰 CA를 분리하고 실제 HTTPS 요청을 보낸다. 인증한 introspection 시작 probe, 잘못된 client secret에 대한 시작 거부, TTL readiness와 복구를 확인한다.

MFA 사람 token의 무인증서 접근과 service token의 mTLS `cnf` 바인딩도 확인한다. 비신뢰 client 인증서 거부, client CA 교체와 key 복구도 같은 경로에서 검사한다.

실제 Keycloak 시험은 다음 명령으로 실행한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/identity/keycloak/run-integration.ps1
```

실행기는 사용하지 않는 loopback port를 선택한다. 관리자, 사용자, resource-server secret은 메모리에서 생성한다.

Admin API로 시험 realm을 만든 뒤 JWKS와 introspection 검증을 실행한다. access token을 폐기한 다음 introspection이 해당 token을 거부하는지도 확인한다.

컨테이너는 [Keycloak container 실행 지침](https://www.keycloak.org/server/containers)에 나온 bootstrap 환경 변수 방식을 사용한다. compose는 `quay.io/keycloak/keycloak:26.7.0`의 OCI index digest를 고정한다. 시험 종료 시 컨테이너, network, volume과 process 환경 변수를 제거한다.

## 9. 운영 전 남은 증거

코드가 있어도 다음 증거가 없으면 운영 신원 Gate를 닫을 수 없다.

1. 운영 IdP의 MFA 등록·복구·인증 ceremony 시험
2. workload 인증서를 발급·갱신·폐기하는 private CA 또는 service mesh 시험
3. OIDC JWT를 production mode로 승인할 경우 IdP 폐기 event와 durable revocation Registry의 지연·장애 시험
4. 운영 IdP의 SAML broker 서명·attribute mapping·single logout 시험
5. DCP issuer, status service, trust anchor와 실제 credential profile
6. 키 회전 중 양쪽 키로 서명한 운영 token과 overlap 종료 시험

이 항목은 코드 fixture가 아니라 운영기관 설정과 외부 trust service가 필요한 검증 범위다.
