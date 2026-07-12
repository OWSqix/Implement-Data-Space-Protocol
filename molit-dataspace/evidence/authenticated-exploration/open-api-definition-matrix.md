# 문서상 Open API 정의

## 1. 목적과 공통 조건

- **(관찰일)** 2026-07-11 한국 표준시(Korea Standard Time, KST)
- **(목적)** 로그인 화면에 게시된 Open API 정의와 실제 확인하지 않은 운영조건의 분리
- **(Verified)** Open API 안내와 상세 페이지에서 API 이름, method, URL, 형식과 신청·승인 방식을 확인
- **(Unverified-접속)** 지원 hostname, TLS와 인증 parameter는 확인하지 않음
- **(Unverified-운영)** 실제 wire schema, quota, 오류코드, version과 SLA는 확인하지 않음
- **(실행 제한)** API 신청, key 발급과 실제 API 호출은 수행하지 않음

- API를 이용하려면 신청이 필요하다.
- 계정당 API key는 한 개로 안내돼 있다.
- 현재 화면에서 발급된 key와 log 항목은 각각 0으로 관찰됐다.
- API 신청, key 발급 또는 실제 API 호출은 수행하지 않았다.
- 문서 URL은 `http://openapi.molit.go.kr/...` 형식이다.
- 별도 무키 probe에서 문서상 host의 IPv4 주소 레코드(Address record, A record)를 정상적으로 얻지 못해 HTTP·HTTPS response까지 도달하지 못했다. 자세한 결과는 [public-endpoint-reachability.md](public-endpoint-reachability.md)에 기록한다.

## 2. API 매트릭스

| No. | 이름 | Method | 문서상 URL | 형식 | 신청·승인 | 접속망 | 실행 여부 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 통합검색 | GET | `http://openapi.molit.go.kr/api/openapi/search/getOpenApiSearchList` | JSON | 신청 필요·자동승인 | 외부망 | 미실행 |
| 2 | 분석 데이터셋 | GET | `http://openapi.molit.go.kr/api/openapi/dataset/getOpenApiDatasetList` | JSON | 신청 필요·자동승인 | 외부망 | 미실행 |
| 3 | 분석과제 등록 | POST | `http://openapi.molit.go.kr/api/openapi/asmt/add` | FORM-DATA | 신청 필요·심의승인 | 외부망 | 미실행 |

## 3. Field 정의

### 3.1 Read API

실제 wire response가 아니라 상세 화면의 정의를 정제한 것이다.

| API | 필수 request | 선택 request | 문서상 response 구조 |
| --- | --- | --- | --- |
| 통합검색 | `serviceKey`, `page`, `perPage`, `returnType`, `searchQuery` | `categoryNames`, `dataTypes` | pagination, `items`, `title`, `description`, `categoryName`, `agentName`, `keyword`, `detailPage`, `issued`, `modified` |
| 분석 데이터셋 | `serviceKey`, `page`, `perPage`, `returnType` | `title`, `creator` | pagination, `datasetDataList`, `dataNm`, `urlOutr`, `accessRights`, `title`, `conceptName`, `description`, `creatorNm`, `publisherNm`, `language`, `keyword`, `landingPage`, `license`, temporal start·end, `issued`, `modified` |

- **(Inferred)** 통합검색 결과에는 Dataset 이외의 검색 유형이 섞일 수 있으므로 곧바로 DSP Dataset으로 변환하지 않음
- **(Inferred)** 분석 데이터셋 정의는 DCAT mapping 후보로 사용할 수 있음
- **(Unverified)** Identifier, Distribution, schema, spatial extent와 변경·삭제 표시는 문서상 field 목록에서 확인되지 않음

read API 내부 metadata의 `confmNeedAt=N`과 안내 화면의 `신청 필요·자동승인`을 함께 관찰했다. `N`을 활용신청 불필요로 해석하지 않는다. JSON API의 Content-Type 표기에는 `applycation/json` 오탈자가 있었으며 실제 wire 값은 미확인이다.

### 3.2 분석과제 등록

분석과제 등록은 과제, 기관·연락, 파일·Dataset과 결과 관련 form field를 받는 mutation API다. Catalog 수집 endpoint로 사용하지 않으며 이번 조사에서 신청하거나 호출하지 않았다.

## 4. 해석 제한

- 이 표는 서비스 화면에 게시된 정의를 전사한 `DOC-UI` 증거다.
- 문서상 host는 조사 환경에서 도달하지 못했다.
- 운영기관이 지원하는 현재 host, TLS와 인증 parameter는 검증하지 않았다.
- Request·response wire schema, quota, 오류코드, version과 SLA는 검증하지 않았다.
- 분석과제 등록은 상태를 변경하는 POST이므로 읽기 전용 탐색 범위에서 제외했다.
- 단일 페이지 애플리케이션(Single-Page Application, SPA) 내부 `/api/anals/*`와 위 `openapi.molit.go.kr` endpoint는 서로 다른 범주로 유지한다.
