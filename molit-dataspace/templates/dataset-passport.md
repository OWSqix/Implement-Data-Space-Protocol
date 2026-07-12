# 데이터셋 패스포트: 데이터셋명

작성일: YYYY-MM-DD  
마지막 확인일: YYYY-MM-DD  
상태: Unverified  
작성 담당: 미지정  
승인 담당: 미지정  
작성 기한·단계: 미정  
검토자: 미지정  
다음 재검토일: 미정

## 1. 목적과 식별 기준

- **(목적)** Dataset의 정체성, 책임, 권리, 원천 접근, Offering 판정과 검증 증거를 한 문서에서 추적
- **(입력)** Source record, Provider 권한, 이용조건, Distribution, source binding과 운영 승인
- **(산출물)** Gate별 증거와 `catalog-only`, `transferable-*`, `secure-analysis`, `excluded`, `unverified` 판정
- **(완료조건)** 8절 승인 Gate와 9절 검증 결과가 채워지고 미결정·잔여위험의 담당과 재검토일이 기록된 상태

| 필드 | 값 |
| --- | --- |
| 통합 채널 record ID | |
| 원천 dataset ID | |
| PoC Dataset URI | |
| production Dataset URI | 미정 |
| 제목 | |
| 설명 | |
| theme·keyword | |

## 2. 책임

| 필드 | 값·증거 |
| --- | --- |
| 원 데이터 보유기관 | |
| source publisher·steward | |
| 기존 플랫폼 운영자 | |
| `platformRecordRole` | Dataset·delivery path별 hosted / brokered / index-only / unknown + 판정증거 |
| Offering Provider Participant | |
| 법적 계약 당사자 | |
| Provider 권한 | owner / delegate / agent + 제공·계약·재제공 증거 |
| Connector 운영자 | 자체 / CaaS + 운영조직 |
| Data Delivery Operator | |
| 업무부서·steward | |
| 법무·개인정보·보안 담당 | |
| 대행·중개 위임 | No / Yes + 범위·기간·재위임·credential·사고책임 문서 |
| incident 연락처 | |

## 3. 권리·법적 근거

| 필드 | 값·증거 |
| --- | --- |
| 제공 근거 | |
| 정보공개 등급 | 공개 / 부분공개 / 비공개 |
| access 등급 | open / registered / restricted / secure / excluded |
| license·공공누리 | |
| 제3자 권리 | |
| 재제공 | 허용 / 조건부 / 금지 / 미확인 |
| 파생데이터 | |
| AI 학습 | |
| 국외 저장·처리·접근 | |
| 실행·저장·백업·원격접근 국가 | |
| 재이전·재위탁 | 허용 / 조건부 / 금지 / 미확인 |
| 허용 수신자 | |
| 허용 목적·지역·기간 | |

## 4. 보호 등급

- [ ] 개인정보
- [ ] 가명정보
- [ ] 개인위치정보
- [ ] 교통카드 데이터
- [ ] 공개제한 공간정보
- [ ] 기반시설·보안정보
- [ ] 영업비밀·제3자 권리
- [ ] 해당 없음

판정 근거와 필드별 등급:

## 5. 원천 접근

| 필드 | 값 |
| --- | --- |
| source system | |
| 공식 base URL·landing page | |
| 접근방식 | REST / file / WMS / WFS / WMTS / stream / DB export |
| 인증방식 | |
| credential owner·secret reference | 값 자체를 기록하지 않음 |
| network scope | public 또는 승인된 private DNS view·hostname·port·CIDR·egress zone |
| 승인유형·quota | |
| timeout·pagination·최대크기 | |
| schema·API version | |
| 변경통지 방식 | |
| source SLA·지원시간 | |

### 5.1 플랫폼 수명주기

| 필드 | 값 |
| --- | --- |
| metadata baseline·delta·delete | |
| platform organization·service identity | |
| subscription·entitlement 방식 | none / manual / API / event-driven |
| provision trigger | Contract Negotiation `FINALIZED` ACK / valid Transfer Request |
| 생성 API·멱등키 | endpoint가 아닌 명세·reference 기록 |
| 외부 자원 scope | Agreement / Transfer + 자원별 정리 trigger |
| 상태 조회·event | |
| suspend·resume | |
| revoke·delete와 완료 확인 | |
| external resource ID 보관 | |
| reconciliation 주기·owner | |

## 6. 데이터 제품 사양

| 필드 | 값 |
| --- | --- |
| Distribution | |
| DCAT media type | IANA media type URI |
| DSP transfer format | |
| schema·코드표 | |
| update frequency | |
| temporal extent·resolution | |
| time zone·timestamp 의미 | |
| spatial extent·CRS·axis | |
| spatial resolution·geometry | |
| 단위·산식 | |
| node/link·sensor version | |
| 품질·결측·오류 기준 | |
| lineage·transformation | |

## 7. 제공 모델

| 항목 | 결정 |
| --- | --- |
| 판정 | catalog-only / transferable-open / transferable-controlled / secure-analysis / excluded / unverified |
| Catalog visibility | public / qualified / internal / hidden |
| DSP Catalog 적격 | Yes / No + 차단사유 |
| Transfer decision | approved / conditional / pending / denied + 판정일 |
| contract 조건 | |
| transfer profile | |
| platform lifecycle mode | none / token / entitlement / subscription / export-job / stream-ACL |
| Data Plane adapter | |
| row·column·BBOX·quota filter | |
| cache·snapshot | |
| 보유·만료·삭제 | |
| 파기·backup 처리 증거 | |
| 전달 후 의무·증적 | |

## 8. 승인

| Gate | 결과 | 문서·일자·유효기간 |
| --- | --- | --- |
| Provider·위임 | | |
| 데이터 steward·품질 | | |
| 공공데이터·license | | |
| 법무·제3자 권리 | | |
| 개인정보·위치정보 | | |
| 공간정보 보안 | | |
| 정보보호·배포환경 | | |
| 운영·SLO | | |

## 9. 검증

| Test ID | 결과·증거 |
| --- | --- |
| metadata profile | |
| license-policy conflict | |
| source connectivity | |
| adapter contract | |
| expiry·revoke·delete | |
| Offering update·withdrawal | |
| Agreement→platform resource mapping | |
| DSP required fields·ACK·ERROR | |
| duplicate·callback loss·reconciliation | |
| audit trace | |
| failure·recovery | |

## 10. 미결정·잔여위험

-
