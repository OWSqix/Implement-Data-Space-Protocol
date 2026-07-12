# 권한 관찰 매트릭스

## 1. 목적과 판정 원칙

- **(목적)** 한 개의 로그인 회원 세션에서 route별로 직접 확인한 접근 상태와 미확인 권한의 분리
- **(Verified)** HTTP 200과 `logout` 표시는 로그인 세션에서 route가 렌더링된 사실만 증명
- **(Unverified)** 비회원, 다른 일반회원, 기관회원 또는 관리자와 비교하지 않아 role 간 권한 차이는 판정하지 않음
- **(해석 제한)** Route 렌더링 결과를 해당 route의 모든 기능과 데이터에 대한 접근권한으로 확대하지 않음

권한 판정은 아래 표의 `로그인 세션 관찰`과 `수행하지 않은 행위`를 함께 사용한다.

## 2. 관찰 결과

| 대상 | 로그인 세션 관찰 | 수행하지 않은 행위 | 권한 판정 |
| --- | --- | --- | --- |
| 시작 화면 | HTTP 200, `logout` 표시 | 비회원 비교 | 로그인 shell 렌더링만 확인 |
| 마이페이지 | HTTP 200, `logout` 표시 | 개인정보 수정·탈퇴 | 본인 마이페이지 route 렌더링만 확인 |
| 데이터셋 검색 | HTTP 200, `logout` 표시 | 다운로드·제공 신청 | 검색 route 렌더링만 확인 |
| 대표 공개 Dataset 상세 | HTTP 200, metadata field 구조 확인 | 다운로드·외부 원천 이동 | 상세 metadata 조회만 확인 |
| 분석센터 안내 | HTTP 200, `logout` 표시 | 분석과제 생성·실행 | 안내 route 렌더링만 확인 |
| Open API 안내·인증·목록 | HTTP 200, `logout` 표시 | 이용 신청·key 발급 | 문서 열람만 확인 |
| Open API 상세 1·2·3 | 각 HTTP 200, `logout` 표시 | API 호출·분석과제 등록 | 정의 열람만 확인 |
| `/pubstorge/openapi` | HTTP 200, `logout` 표시 | 저장소 데이터 열람·등록·공유 | 판정 보류. public shell·route fallback 가능 |
| API key 상태 | 계정당 한 개 안내, 현재 0 | 발급·재발급·폐기 | 발급 권한과 절차 성공 여부 미확인 |
| Open API log 상태 | 현재 항목 0 | 호출·로그 생성 | 기록 생성과 조회범위 미확인 |

## 3. 확인하지 않은 권한

- 비회원 Catalog와 회원 Catalog의 차이
- 일반회원과 기관회원의 신청·저장소·분석 권한 차이
- Dataset별 다운로드·API·재제공 권한
- `/pubstorge/openapi`의 실제 route guard와 backend authorization
- API key 발급, 자동승인과 심의승인의 실제 상태 흐름
