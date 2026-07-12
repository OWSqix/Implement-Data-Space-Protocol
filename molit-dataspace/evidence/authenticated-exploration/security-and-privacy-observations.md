# 보안·개인정보 관찰

## 1. 목적과 관찰 범위

- **(목적)** 로그인 후 읽기 전용 탐색에서 직접 관찰한 보안·개인정보 신호와 미검증 통제의 분리
- **(Verified)** 아래 표의 `SEC-OBS-*`, `PRV-OBS-*` 항목은 지정한 관찰 등급 범위에서 직접 확인
- **(Inferred)** 4절의 보안상 해석은 관찰 결과를 공식 연계 API·권한·보안 적합성으로 확대하지 않기 위한 제한
- **(Unverified)** 5절의 cookie 속성, 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) enforcement, object authorization, 개인정보 처리와 Open API 운영조건은 시험하지 않음

## 2. 직접 관찰한 사실

| ID | 관찰 | 등급 | 해석 제한 |
| --- | --- | --- | --- |
| SEC-OBS-001 | 인증된 UI에 `logout` 표시가 있었다. | `OBS-UI` | 세션 강도나 권한 정확성은 증명하지 않음 |
| SEC-OBS-002 | 로그인 상태에서 session cookie가 사용되는 것이 관찰됐다. | `OBS-NET` | 이름·값·속성은 수집하지 않음 |
| SEC-OBS-003 | CSRF 관련 값이 존재하는 것이 관찰됐다. | `OBS-NET` | 값과 enforcement 동작은 수집·시험하지 않음 |
| SEC-OBS-004 | 정상 UI 조회 중 일부 내부 endpoint가 POST를 사용했다. | `OBS-NET` | method만으로 mutation으로 분류하지 않음 |
| SEC-OBS-005 | 문서상 외부 Open API URL이 HTTP로 게시돼 있었다. | `DOC-UI` | HTTPS 지원 여부와 실제 전송 보안은 미확인 |
| SEC-OBS-006 | 문서상 Open API host의 A record 조회가 공개 resolver에서 `SERVFAIL`이었고 조사 환경 resolver는 `127.0.0.1`을 반환했다. | `OBS-DNS` | 일시 장애·split-horizon·운영종료 여부는 판정하지 않음 |
| PRV-OBS-001 | 로그인은 사용자가 직접 수행했다. | `OBS-UI` | 인증정보를 자동화 코드에 전달하지 않음 |
| PRV-OBS-002 | 현재 API key와 log 항목은 각각 0으로 관찰됐다. | `OBS-UI` | key 값과 log payload는 존재하지도 수집하지도 않음 |

## 3. 데이터 최소화 조치

- 계정 값, 회원 식별자와 마이페이지 개인정보를 기록하지 않았다.
- Cookie, CSRF token, API key와 기타 secret의 이름·값을 저장하지 않았다.
- 원시 request·response body, JSON, HTTP 아카이브(HTTP Archive, HAR), trace와 screenshot을 포함하지 않았다.
- 내부 endpoint는 method와 route 구조, 읽기용 사용자 인터페이스(User Interface, UI) 문맥만 남겼다.
- 정제 문서에는 다른 사용자나 기관의 데이터가 포함되지 않는다.

## 4. 보안상 해석

- session cookie와 CSRF의 존재는 인증·요청 보호 장치의 구현 강도나 적절성을 증명하지 않는다.
- 조회용 POST가 관찰됐다는 사실은 해당 endpoint가 무해하거나 외부 연계에 적합하다는 의미가 아니다.
- 내부 단일 페이지 애플리케이션(Single-Page Application, SPA) endpoint는 비공식·변경 가능 구현 세부사항으로 취급한다.
- 12개 route의 HTTP 200은 backend object-level authorization을 검증하지 않는다.
- `/pubstorge/openapi`는 public shell이나 route fallback 가능성을 배제할 수 없어 접근권한 증거로 사용할 수 없다.
- HTTP로 게시된 Open API URL은 HTTPS 부재를 증명하지 않는다. 다만 조사 시점에는 문서상 host의 이름해석도 정상 완료되지 않았다. 연계 전 운영기관이 지원하는 hostname, DNS 접근범위, HTTPS endpoint와 인증정보 전송방식을 확인해야 한다.

## 5. 이번 탐색에서 검증하지 않은 항목

- Cookie의 `Secure`, `HttpOnly`, `SameSite` 속성
- CSRF token 검증 실패 동작과 logout 후 세션 무효화
- 콘텐츠 보안 정책(Content Security Policy, CSP)의 적절성
- HTTP 엄격 전송 보안(HTTP Strict Transport Security, HSTS)의 적절성
- 교차 출처 리소스 공유(Cross-Origin Resource Sharing, CORS), cache와 referrer 정책의 적절성
- API key 보관·마스킹·rotation과 실제 quota
- 비회원·기관회원·관리자 role의 접근통제
- 객체 단위 권한, rate limit, 취약점과 부하 내성
- 개인정보 수집항목, 보유기간, 제3자 제공과 파기 이행
- Open API의 운영 hostname, DNS 접근범위, HTTPS, 인증 parameter, 오류 응답과 운영 SLA

위 항목은 이 근거 묶음만으로 `통과`, `부적합` 또는 `미구현`으로 판단하지 않는다.
