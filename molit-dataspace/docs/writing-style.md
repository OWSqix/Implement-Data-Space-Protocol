# 문서 작성 규칙

작성일: 2026-07-11  
상태: Active

## 1. 적용 기준

이 저장소의 문서는 기술·정책 결정을 검토하는 사람이 읽는다. 문장을 매끄럽게 보이게 만드는 것보다 누가 무엇을 확인했고, 무엇을 아직 모르는지 드러내는 일이 우선이다.

적용 문체는 [기획보고서 문체 프로파일과 적용 규칙](report-writing-style-profile.md)에 정의한다. 보고서의 개조식 위계와 결론 우선 배열은 채택하고, 홍보성 수사·근거 누락·주체 없는 계획과 기술적 단정은 제외한다.

작성과 검사의 정본은 다음과 같다.

- 작성 제약: [`report-writer-system.md`](../tools/report-style/prompts/report-writer-system.md)
- 문서 골격: [`report-document.md`](../tools/report-style/templates/report-document.md)
- 자동 검사: [`tools/report-style/README.md`](../tools/report-style/README.md)
- 설정: [`report-style.config.json`](../report-style.config.json)

다음 요소를 `AI slop`으로 보고 제거한다.

- 독자가 이미 아는 목적을 길게 반복하는 도입
- 같은 결론을 서론, 본문, 표, 맺음말에서 되풀이하는 구성
- 근거 없는 `혁신적`·`강력한`·`원활한`·`효율적인`·`최적의`·`미래지향적`
- `단순히 A가 아니라 B`, `A를 넘어 B`, `핵심은`, `궁극적으로` 같은 상투적 대비·강조
- `살펴보자`, `알아보자`, `여정을 시작한다`처럼 내용보다 진행을 설명하는 문장
- 모든 절 끝에 붙는 요약이나 교훈
- 주체가 없는 `요구된다`, `기대된다`, `고려되어야 한다`
- 확인하지 않은 기능을 자연스러운 구현처럼 이어 쓰는 문장
- 영어 용어를 연속해서 붙인 뒤 한국어 정의를 생략하는 문장
- 항목 수를 맞추기 위한 중복 bullet과 의미 없는 표

## 2. 문장 작성

### 2.1 주체와 동작

주체를 적는다.

```text
나쁨: 계약 종료 시 접근권한 회수가 필요하다.
좋음: Lifecycle Adapter는 계약 종료 event를 받으면 platform token과 subscription을 삭제한다.
```

### 2.2 사실과 판단

한 문장에서 섞지 않는다.

```text
Verified: MDS는 Mobilithek subscription의 활성화·삭제가 계약과 연동된다고 설명한다.
Inferred: 이 동작에는 Agreement와 subscription ID의 mapping store가 필요하다.
Unverified: 공개 자료에는 실제 ID cardinality와 실패 보상방식이 없다.
```

### 2.3 형용사 대신 조건

```text
나쁨: 안정적이고 안전한 연계를 제공한다.
좋음: 같은 멱등키의 활성 subscription은 하나만 남고, 종료 뒤 token 접근시험은 거부돼야 한다.
```

### 2.4 동작 가능한 표현

`지원한다`, `연결한다`, `관리한다`만 쓰지 않는다. 입력, 출력, 실패와 증거를 적는다.

```text
나쁨: metadata lifecycle을 지원한다.
좋음: baseline 뒤 delta와 tombstone을 받아 Dataset을 갱신·삭제하고 reconciliation report를 남긴다.
```

## 3. 문서 구조

- 첫 절에서 문서가 답하는 질문과 범위를 바로 쓴다.
- 표는 역할, 상태, 선택지처럼 비교축이 있을 때만 사용한다.
- 규격 요구, 사례에서 확인한 사실, 프로젝트 결정을 다른 절에 둔다.
- 동일한 세부 흐름은 한 문서에 정의하고 다른 문서에서는 링크한다.
- 결론을 다시 쓰는 별도 맺음말은 새 정보가 없으면 만들지 않는다.
- `MUST`는 검증 방법이 있을 때만 사용한다.
- 미정 수치에 `빠르게`, `실시간`, `즉시`를 쓰지 않는다. 측정 기준을 정하거나 미정이라고 쓴다.

## 4. 용어

처음 나오는 용어는 한국어 설명을 붙인다. 표준 객체명과 API 이름은 원문을 유지한다.

| 용어 | 이 저장소의 의미 |
| --- | --- |
| Offering | Dataset, 제공조건, Distribution과 접근서비스를 묶어 거래 대상으로 제시한 것 |
| Platform Bridge | 기존 플랫폼 기능을 Offering·Agreement·Transfer에 연결하는 계층 |
| Provider | 문맥이 모호하면 쓰지 않고 `Offering Provider Participant`라고 적음 |
| Broker | `Catalog Broker`와 데이터 전달 `platform broker`를 구분 |
| source binding | Connector 내부에서 원천 endpoint·credential·허용동작을 찾는 비공개 mapping |
| entitlement | 플랫폼이 특정 기관·계약에 부여한 접근권한 객체 |
| subscription | 플랫폼의 지속 전달·수신 등록 객체. DSP Agreement와 같은 객체가 아님 |

## 5. 검토 질문

문서를 수정한 사람은 다음을 확인한다.

1. 문장의 주체와 실행 동작이 보이는가
2. 외부 사실에 1차 출처 또는 evidence ID가 있는가
3. 사실, 추론, 미확인, 결정을 구분했는가
4. 같은 결론을 세 번 이상 반복하지 않았는가
5. 형용사를 시험 가능한 조건으로 바꿨는가
6. Connector 제품의 구현 세부를 DSP 규범으로 설명하지 않았는가
7. 표가 비교에 필요한가, 문장보다 읽기 어려운가
8. 독자가 다음 확인·결정·시험을 바로 찾을 수 있는가

## 6. 실행 하네스

기본 검사는 error와 warning에서 실패한다. 정규식으로 확정하기 어려운 warning도 발행 전 사람이 판정해야 한다.

```powershell
npm run docs:style
```

특정 파일만 검사할 때도 같은 warning gate를 적용한다.

```powershell
node tools/report-style/cli.mjs lint docs/path/to/report.md --fail-on warning
```

규칙의 이유와 교정 예는 다음 명령으로 확인한다.

```powershell
node tools/report-style/cli.mjs explain REG101
```

검사 결과가 없다는 사실은 기술적 정확성을 보장하지 않는다. 표준 범위, source와 acceptance criterion은 별도 검토한다.

## 7. 예외

대외 문의문, 설문 안내와 사용자 화면 문구는 기능상 존대형이 필요할 수 있다. 예외는 `report-style.config.json`의 구체적 파일 경로에 등록한다.

원문 제목이나 법령명을 그대로 인용해 한 줄 오탐이 발생하면 규칙 ID와 사유를 기록한다.

```markdown
<!-- report-style-disable-next-line PRE102: 발간 문서 제목을 원문 그대로 인용 -->
```

여러 행을 숨기는 suppression과 legacy baseline은 사용하지 않는다.
