# 로그인 후 읽기 전용 탐색 근거

## 1. 목적과 판정 범위

- **(관찰일)** 2026-07-11 한국 표준시(Korea Standard Time, KST)
- **(목적)** 회원 로그인 상태에서 관찰한 메뉴, 문서상 Open API와 단일 페이지 애플리케이션(Single-Page Application, SPA) 구현 endpoint의 정제 증거 보존
- **(Verified)** 정상 route, 화면에 게시된 API 정의, 정상 화면 로딩 중의 network 구조와 조사 환경의 DNS 결과를 지정한 증거 등급으로 기록
- **(Unverified)** 공식 연계 승인, endpoint SLA, 제공 권한, 보안 적합성과 role별 권한 차이는 이번 탐색으로 확인하지 않음
- **(적용 제한)** 브라우저가 호출한 내부 `/api/*`는 화면 구현 endpoint이며 운영기관이 보장하는 공식 연계 API로 분류하지 않음

후속 설계는 이 묶음의 직접 관찰과 [국토교통 통합채널 역량 프로필](../../docs/01-research/molit-platform-capability-profile.md)의 해석을 구분해 사용한다.

## 2. 증거 등급

| 등급 | 의미 | 이 묶음의 예 |
| --- | --- | --- |
| `OBS-UI` | 로그인한 브라우저 화면과 응답에서 직접 관찰 | 11개 페이지의 HTTP 200·`logout`, 대표 상세 1개의 HTTP 200 |
| `DOC-UI` | 서비스 화면에 게시된 API 정의를 전사 | API 이름, method, URL, 형식, 신청·승인 방식 |
| `OBS-NET` | 정상 화면 탐색 중 브라우저 network에서 endpoint 구조를 관찰 | SPA 내부 GET·POST 요청 |
| `OBS-DNS` | 조사 환경과 공개 DNS resolver에서 이름해석 결과를 확인 | 문서상 Open API host의 A record 조회 실패 |
| `UNKNOWN` | 이번 탐색으로 확인하지 않음 | 운영용 HTTPS host, SLA, 비회원 비교, 저장소 기능 권한 |

`OBS-NET`의 POST는 실제 화면에서 조회 용도로 관찰된 경우에만 그렇게 표기한다. HTTP method만으로 데이터 변경 여부를 추정하지 않았고, 변경 요청은 실행하지 않았다.

## 3. 탐색 방법과 범위

- **(담당)** 자동화 도구는 route와 network 구조를 읽고 사용자는 일반 Chrome에서 직접 로그인
- **(입력)** 로그인된 정상 메뉴와 서비스 화면에 게시된 Open API 정의
- **(산출물-문서)** 아래 파일 목록의 정제 Markdown 문서
- **(산출물-설정)** 데이터 직렬화 형식(`YAML Ain't Markup Language`, `YAML`)의 session manifest
- **(산출물-목록)** 쉼표 구분 값(Comma-Separated Values, CSV)의 network endpoint 목록
- **(완료조건)** secret·개인정보·원시 응답을 저장하지 않고 각 관찰에 등급과 한계를 기록

- 일반 Chrome을 크롬 개발자 도구 프로토콜(Chrome DevTools Protocol, CDP)로 연결하고 Playwright 1.61.1로 관찰했다.
- 사용자가 브라우저에서 직접 로그인했다.
- 로그인된 화면의 정상 메뉴와 route만 읽기 전용으로 탐색했다.
- 최초 11개 확인 페이지는 HTTP 200과 `logout` 표시를 함께 확인했다. 같은 로그인 세션에서 추가한 대표 공개 Dataset 상세 1개는 HTTP 200과 field 구조를 확인했지만 `logout` 표시를 별도 재기록하지 않았다.
- 문서상 Open API 세 건의 정의와 현재 키·로그 상태를 확인했다.
- 정상 화면 로딩 중 발생한 SPA endpoint의 method와 route만 정리했다.
- 인증키 없이 문서상 Open API host의 DNS와 HTTP·HTTPS 도달성을 확인했다. 이름해석 단계에서 중단됐으며 API request는 서버에 도달하지 않았다.

세부 세션 조건은 `session-manifest.yaml`, 페이지는 `menu-and-route-matrix.md`, endpoint는 `network-endpoints.csv`에 기록한다.

## 4. 제외한 행위와 자료

다음 행위는 수행하지 않았다.

- API 이용 신청, 키 발급·재발급·폐기
- 분석과제 등록을 포함한 POST mutation
- 데이터 등록·수정·삭제·다운로드·업로드·공유
- URL 식별자 변경, 권한 우회, 숨은 route 열거
- 부하, 취약점, rate-limit 또는 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 능동 시험

다음 자료는 이 증거 묶음에 포함하지 않는다.

- 계정명, 회원 식별자와 마이페이지의 개인정보 값
- cookie, CSRF token, API key 또는 기타 secret의 값
- 원시 JSON response, request body, HTTP 아카이브(HTTP Archive, HAR), Playwright trace
- 원본 screenshot, 문서 객체 모델(Document Object Model, DOM) snapshot, browser storage 값

## 5. 파일 목록

| 파일 | 내용 |
| --- | --- |
| `session-manifest.yaml` | 관찰일, 도구, 로그인·탐색 방식과 제외 범위 |
| `menu-and-route-matrix.md` | 12개 확인 페이지와 해석 한계 |
| `network-endpoints.csv` | 정상 탐색 중 관찰한 SPA 내부 endpoint 구조 |
| `open-api-definition-matrix.md` | 화면에 게시된 세 개 Open API 정의 |
| `metadata-field-matrix.md` | 대표 공개 Dataset 상세와 read API의 field mapping 후보 |
| `permission-matrix.md` | 확인된 화면 접근 상태와 확인하지 않은 권한 |
| `security-and-privacy-observations.md` | 인증·CSRF·HTTP·개인정보 관찰과 한계 |
| `public-endpoint-reachability.md` | 문서상 Open API host의 DNS·도달성 확인 결과 |

## 6. 사용 제한

- `/pubstorge/openapi`의 HTTP 200은 public shell이나 SPA route fallback일 수 있다. 저장소 기능 또는 데이터에 접근할 권한이 확인됐다는 근거로 사용하지 않는다.
- `http://openapi.molit.go.kr/...`은 화면에 게시된 문자열이다. 조사 시점에는 IPv4 주소 레코드(Address record, A record)를 정상적으로 얻지 못해 HTTP response까지 도달하지 못했다. 이 결과만으로 서비스 폐지나 영구 장애를 단정하지 않는다.
- 이 묶음에 없는 기능, role, 비회원 상태와 기관회원 상태는 `UNKNOWN`으로 유지한다.
- 검색 record와 Open API 안내가 있다는 사실은 통합채널의 payload hosting, 계약·subscription broker 또는 Offering Provider 권한을 증명하지 않는다.

이 관찰을 `hosted·brokered·index-only` 기준으로 해석한 결과는 [국토교통 통합채널 역량 프로필](../../docs/01-research/molit-platform-capability-profile.md)에 기록한다.
