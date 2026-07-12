# 메뉴·Route 관찰 매트릭스

## 1. 관찰 범위와 판정 기준

- **(목적)** 로그인된 동일 세션에서 확인한 route 응답과 화면 용도 및 판정 한계 기록
- **(관찰일)** 2026-07-11 한국 표준시(Korea Standard Time, KST)
- **(Verified)** 1~11번 페이지에서 HTTP 200과 `logout` 표시를 함께 확인
- **(Verified)** 12번 대표 상세에서 HTTP 200과 field 구조를 확인했으며 `logout` 표시는 별도 재기록하지 않음
- **(해석 제한)** HTTP 200은 route 응답과 인증된 shell 렌더링만 나타내며 기능 실행 권한, 데이터 접근 권한과 비회원 차단을 증명하지 않음

## 2. 확인 페이지

| No. | Route | 화면·용도 | 상태 | 증거 등급 | 판정 한계 |
| ---: | --- | --- | ---: | --- | --- |
| 1 | `/` | 서비스 시작 화면 | 200 | `OBS-UI` | 공개·회원별 콘텐츠 차이 미확인 |
| 2 | `/mypage/main` | 마이페이지 시작 화면 | 200 | `OBS-UI` | 본인정보 값은 수집하지 않음 |
| 3 | `/data-set/search` | 데이터셋 검색 | 200 | `OBS-UI` | 검색 결과별 제공 권한 미확인 |
| 4 | `/anals/guidance/anals-center` | 분석센터 안내 | 200 | `OBS-UI` | 분석과제 생성·실행 미수행 |
| 5 | `/anals/open-api/guide` | 분석센터 Open API 안내 | 200 | `OBS-UI` | 실제 API 호출과 운영 SLA 미확인 |
| 6 | `/anals/open-api/authentication` | Open API 인증 안내 | 200 | `OBS-UI` | 키 신청·발급 미수행 |
| 7 | `/anals/open-api/apiList` | Open API 목록 | 200 | `OBS-UI` | 세 API 정의만 화면에서 확인 |
| 8 | `/anals/open-api/apiView/1` | 통합검색 API 상세 | 200 | `OBS-UI`, `DOC-UI` | 문서 정의만 확인, API 미호출 |
| 9 | `/anals/open-api/apiView/2` | 분석 데이터셋 API 상세 | 200 | `OBS-UI`, `DOC-UI` | 문서 정의만 확인, API 미호출 |
| 10 | `/anals/open-api/apiView/3` | 분석과제 등록 API 상세 | 200 | `OBS-UI`, `DOC-UI` | 등록 mutation 미실행 |
| 11 | `/pubstorge/openapi` | 공개·공유 저장소 관련 route로 추정되는 화면 | 200 | `OBS-UI` | public shell 또는 route fallback 가능. 기능·데이터 접근 가능 결론 금지 |
| 12 | `/data-set/search/detail/{recordId}` | 대표 공개 Dataset 상세 | 200 | `OBS-UI`, `OBS-NET` | 공개 metadata의 field 구조만 확인; 데이터 다운로드 미수행 |

## 3. 후속 확인이 필요한 항목

- 비회원, 일반회원과 기관회원 사이의 메뉴·필드 차이
- `/pubstorge/openapi`의 공식 메뉴 진입점과 role 요구조건
- Open API endpoint의 HTTPS 지원, 운영상태, 버전과 SLA
- 검색 레코드별 다운로드, 신청, 재제공 조건
