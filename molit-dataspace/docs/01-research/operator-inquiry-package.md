# 운영기관 문의 패키지

작성일: 2026-07-11  
상태: Draft  
진행: 발송 전 승인 필요

## 1. 목적과 발송 범위

- **(목적)** 기존 기능을 유지하면서 Data Offering·계약·전송을 데이터 스페이스에 연결할 수 있는 범위 확인
- **(요청 범위)** 담당부서, 공식 명세와 운영정책 안내
- **(제외)** 시스템 구축 요청, API 사용 신청과 credential 발급
- **(완료 조건)** 소관 부서와 질문별 회신 경로를 식별하고 공식 자료의 version·시행일 확보

문의 분야별 수신 대상은 다음과 같다.

| 분야 | 요청할 담당 |
| --- | --- |
| 데이터·권리 | 데이터 정책, 공공데이터제공책임관, 데이터 관리부서 |
| 통합채널 기능 | 서비스 운영기관, metadata·분석센터 담당 |
| API·망 | API 운영, 인프라·네트워크·정보보호 담당 |
| 기관 identity | IAM·회원·기관계정 담당 |
| 구독·전달 | 원천 연계, 이용신청·승인, 데이터 제공 담당 |

1차 회신의 범위는 질문별 소관부서와 공식 접수 경로 식별까지로 제한한다.

## 2. 문의 제목

```text
[기술·정책 문의] 국토교통 데이터 통합채널의 기관 간 데이터 스페이스 연계 가능 범위 확인
```

## 3. 1차 문의 본문

```text
안녕하세요.

국토교통 분야의 기존 데이터 플랫폼을 그대로 유지하면서, 플랫폼의 공개 데이터셋을
Data Offering으로 게시하고 기관 간 계약·전송 절차와 연결하는 방안을 조사하고 있습니다.

이번 문의는 통합채널의 화면용 내부 API를 사용하거나 데이터를 수집하려는 요청이 아닙니다.
운영기관이 공식적으로 지원하는 server-to-server 연계 범위와 담당부서를 확인하려는 것입니다.

다음 사항을 확인할 수 있는 최신 문서 또는 담당부서를 안내해 주시면 감사하겠습니다.

1. 통합채널이 직접 저장·호스팅하는 데이터셋, 외부 데이터를 중개하는 데이터셋,
   원천 위치만 안내하는 데이터셋을 구분하는 기준과 대상 목록
2. 기관 시스템이 사용할 수 있는 metadata baseline·증분·삭제 API 또는 export
3. 현재 지원되는 운영·시험 hostname, 접근망, HTTPS·TLS와 인증방식
4. 기관용 service account 또는 기관별 API credential·quota 정책
5. 데이터셋별 실제 제공기관과 통합채널의 계약·재제공·대행 권한 범위
6. 이용신청·승인·구독·해지와 token·접근권한 회수를 위한 API 또는 운영절차
7. 데이터셋 수정·비활성화·삭제와 구독 상태 변경을 외부 연계처에 통지하는 방법
8. API version, schema, SLA, 변경통지와 sandbox 제공 여부

비밀번호, API key, cookie, 개인정보나 운영 secret의 값은 요청하지 않습니다.
문서가 공개돼 있다면 URL과 적용 version·시행일을 알려주시고, 비공개 문서라면
제공 가능한 범위와 열람 절차를 안내해 주시기 바랍니다.

질문별 소관부서가 다르면 담당부서 또는 공식 접수 경로를 연결해 주셔도 됩니다.

감사합니다.
```

- **(발송 전 확인)** 조사 주체, 담당자, 회신 주소와 사용 목적 기재
- **(표현 제한)** 국토교통부 공식 사업으로 오인할 수 있는 명칭과 직함 사용 금지

## 4. 첨부 질문 범위

[운영기관 확인 질문](operator-questionnaire.md)의 1차 발송 범위는 다음 ID로 제한한다.

- Endpoint·보안: `OP-Q-001~006`
- Metadata API: `OP-Q-010~017`
- 플랫폼 역할: `OP-Q-050~055`
- 구독·회수: `OP-Q-060`, `OP-Q-064~065`
- 기관 identity: `OP-Q-070~072`

담당부서가 확인되면 나머지 질문을 소관별 후속 문의로 분리한다.

## 5. 요청할 자료

| 자료 | 최소 확인 내용 |
| --- | --- |
| API 명세 | 발행기관, version, base URL, 인증, schema, error, quota |
| Network 안내 | 운영·시험 hostname, DNS view, HTTPS, TLS, allowlist |
| 데이터 관리대장 | Dataset ID, 원 보유기관, Dataset과 delivery path별 `hosted`·`brokered`·`index-only`·`unknown` 역할, 담당부서 |
| 권리·책임 문서 | 제공·계약·재제공·credential 대행 권한, 사고 책임 |
| Lifecycle 명세 | 신청·승인·subscription·token·철회·삭제 상태와 API |
| Identity 정책 | 기관계정, service account, federation, revoke·offboarding |
| 변경관리 | schema·endpoint·Dataset 수정·삭제 통지기간과 방식 |
| 운영 기준 | SLA·지원시간·장애·보안사고 연락과 audit export |

## 6. 받지 않을 정보

- 개인 비밀번호와 인증 답변
- API key, access token, refresh token
- session cookie, 사이트 간 요청 위조(Cross-Site Request Forgery, CSRF) 방지 token
- 운영 secret과 private key
- 실제 개인정보·제한 데이터 payload
- 내부 인터넷 프로토콜(Internet Protocol, IP) 주소·방화벽 정보의 불필요한 원문

시험 credential이 필요해지면 승인된 sandbox에서 별도 secret 전달 절차를 사용한다. 회신 메일과 프로젝트 문서에 값을 붙이지 않는다.

## 7. 회신 판정

| 회신 | 처리 |
| --- | --- |
| 공식 공개 문서 URL | source register에 version·확인일 등록 |
| 비공개 명세 | 접근등급과 저장위치 승인 후 reference만 문서화 |
| 구두 설명 | `Unverified` 유지, 문서 또는 재현시험 요청 |
| 담당부서 안내 | 질문을 소관별로 분리해 후속 발송 |
| 기능 없음 | capability를 `none·manual`로 기록하고 PoC 범위 조정 |
| sandbox 제공 | 권리·보안 승인 뒤 contract test 계획 제출 |

HTTP 200 또는 화면 기능만으로 Gate를 닫지 않는다. 적용 Dataset, 운영책임, 권리와 생성·회수 시험을 함께 확인한다.

## 8. 문의 이력

| 날짜 | 수신기관·부서 | 질문 ID | 회신 상태 | 증거 ID | 후속 조치 |
| --- | --- | --- | --- | --- | --- |
| 미발송 | 미정 | 1차 묶음 | Draft | 없음 | 발송 주체·목적 승인 |

외부 발송은 프로젝트 의뢰자의 명시적 승인 후 수행한다.
