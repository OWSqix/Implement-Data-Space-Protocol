# 보고서 문체 하네스

## 1. 목적과 구성

이 하네스는 `molit-government-rd-report-v1` 문체 규칙을 사람이 읽는 지침, 작성 prompt, 문서 template과 실행 검사기로 고정한다.

| 구성 | 경로 | 역할 |
| --- | --- | --- |
| 문체 분석 | `docs/report-writing-style-profile.md` | 보고서 계수, 채택 규칙과 제외할 결함 |
| 저장소 작성 규칙 | `docs/writing-style.md` | 모든 문서에 적용할 간결한 규범 |
| system prompt | `tools/report-style/prompts/report-writer-system.md` | 초안 작성과 개정 시 입력할 제약 |
| 문서 template | `tools/report-style/templates/report-document.md` | 목적·판정·근거·검증 골격 |
| CLI | `tools/report-style/cli.mjs` | `lint`, `profile`, `explain` 실행 |
| configuration | `report-style.config.json` | 대상 경로, severity, 용어와 예외 |
| JSON Schema | `tools/report-style/config.schema.json` | 편집기 검증 |
| test | `tools/report-style/test` | scanner, rule과 exit code 회귀검증 |

프로젝트 실행 기준과 같은 Node.js 24 이상이 필요하다. 문체 하네스 자체에는 별도 runtime package가 없다.

## 2. 명령

프로젝트 root에서 실행한다.

```powershell
npm run docs:style
npm run docs:style:strict
npm run --silent docs:style:json
npm run docs:profile
npm run docs:rules
npm test
```

명령행 인터페이스(Command-Line Interface, CLI)를 직접 호출하면 대상 경로와 gate를 좁힐 수 있다.

```powershell
node tools/report-style/cli.mjs lint
node tools/report-style/cli.mjs lint docs/02-architecture/target-architecture.md
node tools/report-style/cli.mjs lint docs/new-report.md --fail-on warning
node tools/report-style/cli.mjs lint --format json --fail-on none
node tools/report-style/cli.mjs profile docs
node tools/report-style/cli.mjs explain REG101
node tools/report-style/cli.mjs explain --format json
```

### 2.1 Command

| Command | 동작 |
| --- | --- |
| `lint` | 파일 위치, severity, rule ID, 대상 문장과 수정 방향 출력 |
| `profile` | 제목, 목록, 길이, 종결형, 선행 라벨과 용어 출현 집계 |
| `explain` | 규칙의 이유, 나쁜 예와 교정 예 출력 |

### 2.2 Option

| Option | 의미 |
| --- | --- |
| `--config <path>` | 기본 configuration 대신 지정 파일 사용 |
| `--format text` | 사람이 읽는 기본 출력 |
| `--format json` | CI와 후속 처리용 결정적 JSON 출력 |
| `--fail-on error` | error가 하나 이상이면 gate 실패 |
| `--fail-on warning` | warning 이상이면 gate 실패 |
| `--fail-on info` | 모든 diagnostic에서 gate 실패 |
| `--fail-on none` | 진단만 출력하고 gate를 통과 처리 |
| `--max-warnings <n>` | warning 허용 개수 상한 |

JSON에는 timestamp를 넣지 않는다. 같은 입력과 configuration에서는 정렬 순서와 결과가 같다.

### 2.3 종료 코드

| Code | 의미 |
| ---: | --- |
| `0` | gate 통과 |
| `1` | 문체 diagnostic이 gate 기준을 충족 |
| `2` | configuration, 경로, option 또는 입출력 오류 |

## 3. Gate 정책

기본 configuration은 `warning`에서 실패한다. 대화형 도입, 존대형 보고서 종결, 직접 호명, 근거 없는 절대 단정과 판정된 기술 범위 오류는 `error`다.

warning은 한국어 의미를 정규식만으로 확정하기 어려운 항목이다. H3 번호, 목록 종결, 긴 행, 계획 구체성, 의무의 검증 기준과 source 누락을 사람이 판정한 뒤 발행한다.

파일 단위 검사는 다음과 같이 같은 warning gate를 적용한다.

```powershell
node tools/report-style/cli.mjs lint docs/path/to/report.md --fail-on warning
```

`docs:style`과 `docs:style:strict`는 모두 warning 이상에서 실패한다. `--fail-on error`는 warning 목록을 별도로 검토할 때만 명시적으로 사용한다.

## 4. 출력 형식

Text diagnostic은 다음 형식으로 고정된다.

```text
docs/sample.md:5:1 오류 REG101 진행 설명 또는 대화형 도입을 사용함
  대상: 오늘은 연계 구조를 알아보자.
  수정: 판단·범위·근거를 직접 기술
```

Text는 현재 `fail-on` 수준 이상의 diagnostic만 상세 표시하고 severity별 전체 건수는 마지막에 남긴다. `--fail-on none`은 모든 상세를 표시하며 gate를 실패시키지 않는다. JSON은 severity와 관계없이 전체 diagnostic을 포함한다.

JSON root는 다음 field를 갖는다.

| Field | 의미 |
| --- | --- |
| `profile` | 적용한 문체 프로파일 ID |
| `gate` | `failOn`, `maxWarnings`, 통과 여부 |
| `summary` | 파일과 severity별 diagnostic 수 |
| `diagnostics` | 경로, 행, 열, rule, 대상 문장과 수정 방향 |

종합 점수는 출력하지 않는다. 높은 평균 점수가 하나의 blocking 오류를 감출 수 있기 때문에 gate와 diagnostic을 직접 사용한다.

## 5. 규칙 범주

### 5.1 구조

- `STR001`: H1 하나와 heading level 연속성
- `STR002`: H2 십진 번호의 존재와 순서
- `STR003`: H3 이하의 승인된 번호 scheme
- `STR004`: 첫 30행 안의 목적·범위·질문·판정·개요·기준

### 5.2 문체

- `REG101`: 대화형 진행 설명
- `REG102`: 존대형과 대화형 종결
- `REG103`: 목록 종결형
- `REG104`: 작성자와 독자 직접 호명
- `REG105`: 상투적 강조와 전환
- `REG106`: 홍보성 수사
- `REG107`: 가시문자 길이
- `REG108`: 과도한 병렬 나열
- `REG109`: 같은 파일 안의 긴 문장 반복

### 5.3 구체성과 근거

- `PRE101`: 입력·산출물·완료조건이 없는 행위명사 계획
- `PRE102`: 근거 없는 절대적 기술 단정
- `PRE103`: 검증 기준이 없는 의무 표현
- `PRE104`: 출처가 없는 수치·최신성·표준 상태 주장

### 5.4 용어와 기술 범위

- `TRM101`: 이미 판정된 DSP·DCP·TCK·ODRL·DCAT 범위 오류
- `TRM102`: 첫 정의가 없는 약어
- `TRM103`: 대표 표기와 다른 용어

전체 설명은 `npm run docs:rules` 또는 `explain <RULE-ID>`로 확인한다.

## 6. Configuration

`report-style.config.json`은 다음 항목을 관리한다.

- 검사 root와 ignore glob
- 기본 gate와 warning 상한
- rule별 severity와 option
- 허용 heading scheme
- 정의를 생략할 수 있는 보편 약어
- 비대표 표기와 대표 표기의 mapping
- 문서 기능에 따른 파일별 override

알 수 없는 top-level key, 잘못된 severity와 정의되지 않은 rule ID는 exit code 2를 반환한다.

### 6.1 Rule 값

Severity만 지정하거나 option과 함께 지정한다.

```json
{
  "REG101": "error",
  "REG107": [
    "warning",
    {
      "maxVisibleChars": 180
    }
  ]
}
```

### 6.2 Override

기능상 다른 문체가 필요한 파일만 예외로 등록한다. 현재 운영기관 대외 문의문은 존대형 종결을 허용한다. ADR과 template은 구조 특성에 맞는 일부 warning을 끈다.

예외는 문서 종류가 아니라 구체적 경로로 좁힌다. 일반 연구문서 전체에 `REG102`를 끄지 않는다.

## 7. Scanner 범위

### 7.1 지원 영역

- 8비트 유니코드 변환 형식(Unicode Transformation Format 8-bit, UTF-8), 바이트 순서 표지(Byte Order Mark, BOM)와 줄바꿈 조합(Carriage Return and Line Feed, CRLF) 정규화
- 0~3칸 들여쓴 ATX heading `#`부터 `######`
- Setext H1과 H2
- unordered list와 ordered list
- 보고서 표지 `□`, `○`, `ㅇ`, `•`, `⦁`
- fenced code와 들여쓴 code 제외
- 외곽 pipe 유무와 관계없는 GitHub 확장 Markdown(GitHub Flavored Markdown, GFM) 표, blockquote와 여러 행 하이퍼텍스트 마크업 언어(HyperText Markup Language, HTML) comment 제외
- inline code, Markdown link와 URL masking
- front matter 제외
- 한 줄 suppression
- `금지할 설명`, `나쁜 예`, `교체 전`, `원문 인용` heading 범위 제외

### 7.2 제한 영역

- 중첩되거나 tag가 섞인 복잡한 HTML block을 완전하게 해석하지 않음
- Markdown 표 안의 문체를 검사하지 않음
- 중첩 blockquote와 비표준 list의 CommonMark 적합성을 보장하지 않음
- 한국어 형태소, 주체와 의미상 중복을 판정하지 않음
- source가 주장을 실제로 지지하는지 검증하지 않음

복잡한 Markdown 구조가 늘어나고 실제 오탐 사례가 확보되면 parser dependency 도입을 별도 ADR로 결정한다.

## 8. Suppression

자동 판정이 원문 제목, 법령명 또는 의도적 예시를 오탐할 때 다음 한 줄만 제외한다.

```markdown
<!-- report-style-disable-next-line PRE102: 발간 문서 제목을 원문 그대로 인용 -->
```

조건은 다음과 같다.

- 대상 바로 앞 행에 배치
- rule ID 또는 쉼표로 구분한 rule ID 사용
- colon 뒤에 구체적 사유 기록
- `ALL`은 불가피한 한 줄에만 사용
- 여러 행을 끄는 disable/enable block은 사용하지 않음

인용이 반복되면 `금지할 설명` 또는 `원문 인용` 절로 분리한다. legacy baseline은 제공하지 않는다.

## 9. 작성 절차

1. `templates/report-document.md`로 골격 생성
2. `prompts/report-writer-system.md`를 작성 제약으로 적용
3. 첫 절에 목적, 범위와 판정 기준 기록
4. 외부 사실에 source ID와 기준일 연결
5. `npm run docs:style` 실행
6. 발행 대상 파일에 warning gate 실행
7. diagnostic의 대상 행과 수정 방향을 사람이 검토
8. 기술 검토와 source 검토를 별도로 완료

자동 수정 option은 두지 않는다. `~해야 함`을 `~필요`로 바꾸거나 주체를 지우는 기계적 수정은 규범 강도와 책임 범위를 바꿀 수 있다.

## 10. 유지관리와 시험

rule을 추가하거나 정규식을 넓힐 때 다음 fixture를 함께 추가한다.

- 검출해야 하는 최소 문장
- 허용해야 하는 부정문 또는 인용문
- code, table과 blockquote 제외 사례
- source가 있는 주장과 없는 주장
- Windows CRLF와 BOM
- 예상 CLI exit code

검증 명령은 다음과 같다.

```powershell
npm test
node --check tools/report-style/cli.mjs
npm run docs:style
```

정규식에 새 단어를 추가하기 전에 실제 문서의 오탐 문장을 확인한다. 기술 오류 규칙은 잘못된 긍정 주장만 잡고, 오류를 설명하는 부정문과 검토 heading은 허용해야 한다.
