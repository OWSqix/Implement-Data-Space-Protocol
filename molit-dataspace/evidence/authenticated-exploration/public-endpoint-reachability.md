# 문서상 Open API Endpoint 도달성

관찰일: 2026-07-11 한국 표준시(Korea Standard Time, KST)  
대상 host: `openapi.molit.go.kr`  
증거 등급: `OBS-DNS`

## 1. 확인 범위

- **(목적)** Open API 화면에 게시된 통합검색 host의 DNS와 HTTP·HTTPS 도달성 확인
- **(입력)** 인증키와 query parameter가 없는 문서상 통합검색 경로
- **(실행)** 조사 단말의 기본 resolver와 두 공개 resolver의 이름해석 및 무키 HTTP·HTTPS 요청
- **(제외)** API key 발급, 활용신청, payload 조회와 반복 호출
- **(판정 범위)** HTTP response 전 이름해석 실패까지만 직접 관찰

## 2. 결과

| 확인 | 결과 | 해석 |
| --- | --- | --- |
| 조사 PC 기본 resolver의 A 조회 | `127.0.0.1` | 공인 서비스 주소로 사용할 수 없음 |
| Windows hosts file | MOLIT 관련 override 없음 | hosts file이 loopback 응답 원인은 아님 |
| Google Public DNS의 A 조회 | DNS status 2 `SERVFAIL` | usable A record를 얻지 못함 |
| Cloudflare DNS의 A 조회 | DNS status 2 `SERVFAIL` | usable A record를 얻지 못함 |
| `data.molit.go.kr` 비교 조회 | 공인 A record 응답 | 조사 환경의 모든 MOLIT 이름해석이 실패한 것은 아님 |
| HTTP·HTTPS 무키 요청 | HTTP response 전 실패 | 인증·application 오류와 TLS 지원 여부는 관찰하지 못함 |

Google DNS 응답은 권한 DNS server가 IPv4 주소 레코드(Address record, A record) 질의에 응답하지 않았다는 진단을 포함했다. 외부 검색에 남은 과거 A record는 현재 권한 응답이 아니므로 직접 접속 대상으로 사용하지 않았다.

## 3. 결론 범위

- **(Verified)** 2026-07-11 조사 환경과 두 공개 resolver에서 문서상 host의 usable A record를 얻지 못함
- **(Unverified)** 다음 원인은 이번 조사로 구분할 수 없음

- 일시적인 DNS 운영 장애
- 특정 기관망에서만 해석되는 split-horizon DNS
- host 또는 API의 이전·종료
- 문서의 hostname 갱신 누락

따라서 `endpoint가 운영 중이다`, `HTTPS를 지원하지 않는다`, `서비스가 폐지됐다` 중 어느 것도 단정하지 않는다.

## 4. 실증 Gate

운영기관에서 다음 증거를 받기 전에는 인증키를 발급하거나 API를 호출하지 않는다.

1. 현재 지원되는 운영·시험 hostname과 network 접근범위
2. 권한 DNS 또는 공식 문서에서 확인되는 A record, IPv6 주소 레코드(IPv6 address record, AAAA)와 정규 이름 레코드(Canonical Name record, CNAME) 구성
3. HTTPS URL, 인증서 chain·hostname과 최소 TLS version
4. HTTP 요청의 차단 또는 HTTPS redirect 정책
5. API key 사용주체, quota, rotation과 사고대응 절차
6. 통합검색·분석 데이터셋 API의 지원 상태와 변경통지·SLA
