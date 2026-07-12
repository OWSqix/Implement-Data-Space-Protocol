import { ruleForFile } from "./config.mjs";
import { visibleText } from "./scanner.mjs";

export const RULE_CATALOG = {
  STR001: {
    category: "structure",
    title: "문서 제목과 heading 위계",
    reason: "문서에는 H1 하나가 있어야 하며 heading level을 건너뛰지 않아야 함",
    bad: "H1 없이 H3부터 시작",
    good: "# 제목 다음에 ## 1. 범위 사용"
  },
  STR002: {
    category: "structure",
    title: "H2 십진 번호",
    reason: "장 단위 제목은 1부터 연속된 십진 번호를 사용해야 함",
    bad: "## 배경",
    good: "## 1. 배경"
  },
  STR003: {
    category: "structure",
    title: "하위 제목 scheme",
    reason: "하위 제목은 decimal, finding ID 또는 승인된 한글 항목 scheme을 사용해야 함",
    bad: "### 추가 내용",
    good: "### 1.1 추가 내용"
  },
  STR004: {
    category: "structure",
    title: "첫 절의 목적과 범위",
    reason: "독자는 첫 30행 안에서 문서의 목적·범위·질문·판정을 확인할 수 있어야 함",
    bad: "긴 배경 설명으로 시작",
    good: "## 1. 검토 범위"
  },
  REG101: {
    category: "register",
    title: "진행 설명 금지",
    reason: "보고서는 작성 과정을 말하지 않고 판단과 근거를 바로 제시해야 함",
    bad: "오늘은 구조를 알아보자",
    good: "검토 범위와 판단 기준을 제시함"
  },
  REG102: {
    category: "register",
    title: "존대·대화형 종결 금지",
    reason: "기획보고서 본문은 비인칭 개조식 또는 평서형 문어체를 사용해야 함",
    bad: "확인했습니다",
    good: "확인함 또는 확인됐다"
  },
  REG103: {
    category: "register",
    title: "목록 종결형",
    reason: "목록은 문장부호 없는 개조식 또는 완전한 평서형 문어체를 사용해야 함",
    bad: "검증할 예정이에요.",
    good: "검증 수행"
  },
  REG104: {
    category: "register",
    title: "작성자·독자 호명 금지",
    reason: "공공 기획보고서는 작성자와 독자를 직접 호명하지 않음",
    bad: "제가 확인한 결과",
    good: "확인 결과"
  },
  REG105: {
    category: "register",
    title: "상투적 전환 구문",
    reason: "강조 구문 대신 대상·조건·결과를 직접 기술해야 함",
    bad: "단순한 연결을 넘어 혁신을 만든다",
    good: "Agreement를 platform entitlement에 연결함"
  },
  REG106: {
    category: "register",
    title: "홍보성 수사",
    reason: "평가 근거가 없는 형용사는 기술 판단을 흐림",
    bad: "혁신적이고 강력한 환경",
    good: "p95 응답시간과 오류율로 환경을 평가함"
  },
  REG107: {
    category: "register",
    title: "긴 문장·항목",
    reason: "보고서의 한 항목에는 하나의 판단만 배치해야 함",
    bad: "여러 조건과 결론을 한 문장에 연결",
    good: "판단과 근거를 두 항목으로 분리"
  },
  REG108: {
    category: "register",
    title: "과도한 병렬 나열",
    reason: "및·쉼표·괄호가 반복되면 행위와 책임 범위가 불명확해짐",
    bad: "A 및 B 및 C 및 D를 구축",
    good: "대상별 항목으로 분리"
  },
  REG109: {
    category: "register",
    title: "중복 문장",
    reason: "같은 결론을 여러 절에서 반복하지 않아야 함",
    bad: "동일 문단 재사용",
    good: "정의 문서로 연결"
  },
  PRE101: {
    category: "precision",
    title: "행위만 있는 계획",
    reason: "지원·연계·관리·고도화만으로는 입력·산출물·완료조건을 검증할 수 없음",
    bad: "메타데이터 연계 고도화",
    good: "운영기관은 delta와 tombstone을 수집하고 reconciliation report를 제출해야 함"
  },
  PRE102: {
    category: "precision",
    title: "절대적 기술 단정",
    reason: "보장·100%·비유출·즉시 같은 표현에는 범위와 시험 근거가 필요함",
    bad: "완벽한 데이터 주권을 보장",
    good: "통제 지점과 잔여위험을 기록하고 revoke 시험을 수행함"
  },
  PRE103: {
    category: "precision",
    title: "의무와 검증 기준",
    reason: "필수·반드시·MUST에는 확인 가능한 acceptance criterion이 필요함",
    bad: "Connector는 반드시 안전해야 함",
    good: "secret leakage 0건을 확인해야 함"
  },
  PRE104: {
    category: "precision",
    title: "수치·최신성 주장 근거",
    reason: "연도·비율·시장규모·최초·표준 상태에는 출처와 기준일이 필요함",
    bad: "시장규모는 30% 성장함",
    good: "발행기관·기준연도·URL 또는 source ID를 병기함"
  },
  TRM101: {
    category: "terminology",
    title: "판정된 기술 오용",
    reason: "DSP·DCP·DCAT·TCK의 이미 확인된 범위 오류를 다시 쓰지 않아야 함",
    bad: "DSP가 실제 데이터를 전송함",
    good: "DSP가 Transfer Process를 조정하고 별도 profile이 payload를 전달함"
  },
  TRM102: {
    category: "terminology",
    title: "약어 첫 정의",
    reason: "등록되지 않은 약어는 첫 등장에 국문명·공식 영문명과 함께 정의해야 함",
    bad: "FCN을 구축함",
    good: "연합 카탈로그 노드(Federated Catalog Node, FCN)를 구축함"
  },
  TRM103: {
    category: "terminology",
    title: "대표 표기",
    reason: "같은 개념의 대소문자와 띄어쓰기를 문서 전체에서 통일해야 함",
    bad: "GAIA-X, To-be, 데이터스페이스 혼용",
    good: "Gaia-X, TO-BE, 데이터 스페이스 사용"
  }
};

const CONVERSATIONAL_PATTERNS = [
  /오늘은/u,
  /이번 글에서는/u,
  /살펴보자/u,
  /알아보자/u,
  /해보겠습니다/u,
  /여정을 시작/u
];

const POLITE_ENDING_PATTERN = /(?:[가-힣]+(?:니다|니까)|해요|나요|하죠|까요|세요|십시오)[.!?]?$/u;
const DIRECT_ADDRESS = /(?:^|\s)(?:저|제가|저희|여러분|당신|독자 여러분)(?:은|는|이|가|의|에게|께서|\s)/u;
const CLICHE_PATTERNS = [
  /핵심은/u,
  /궁극적으로/u,
  /단순히.{0,50}(?:아니라|넘어)/u,
  /를 넘어/u,
  /새로운 패러다임/u,
  /선순환(?:적)? (?:구조|생태계)/u,
  /새로운 가치를 창출/u,
  /이를 통해.{0,30}활성화/u
];
const PROMOTIONAL_PATTERNS = [
  /혁신적/u,
  /강력한/u,
  /원활한/u,
  /효율적인/u,
  /최적의/u,
  /미래지향적/u,
  /획기적/u,
  /폭발적/u,
  /비약적/u,
  /막대한/u,
  /매끄러운/u,
  /핵심 연료/u,
  /혁신.*토양/u
];
const ABSOLUTE_PATTERNS = [
  /완벽한/u,
  /세계 최초/u,
  /국내 최초/u,
  /(?<!\d)100%(?:[가-힣]+)?[^.!?\n]{0,25}(?:보장|달성|통과|정확|준수|성공|완료)/u,
  /즉시 (?:운영|연동|적용|활용)/u,
  /글로벌 호환(?:성)?(?:을)? 보장/u,
  /원본(?: 데이터)? 비유출/u,
  /모든.{0,30}보장/u
];
const TECHNICAL_MISUSE = [
  /IDSA\s+Dataspace Protocol/iu,
  /TCK(?:가|는)?\s*인증(?:을)?\s*(?:발급|제공|보장|한다)/iu,
  /DSP(?:가|는)?\s*.{0,12}(?:실제|물리적).{0,10}(?:데이터|payload)(?:를|을)?\s*(?:직접\s*)?전송(?:한다|함|하는 역할|을 담당)/iu,
  /DCP(?:가|는)?\s*.{0,20}DSP.{0,10}(?:필수|반드시).{0,10}(?:구성|요소|포함|따름)/iu,
  /ODRL(?:이|은|로)?\s*.{0,30}(?:완벽하게|사후에도|지속적으로).{0,15}(?:보장|통제)(?:한다|함|됨)/iu,
  /JSON-LD(?:가|는|로)?\s*.{0,30}자동.{0,20}(?:매핑|mapping)(?:한다|함|됨|보장)/iu,
  /DCAT-AP(?:가|는|로)?\s*.{0,30}(?:연합 카탈로그|분산 크롤링).{0,15}(?:규정한다|제공한다|수행한다)/iu,
  /C2D(?:가|는|로)?\s*.{0,40}(?:개인정보|민감정보).{0,25}(?:교환 가능을 보장|교환을 보장|처리를 보장)/iu
];

const ACTION_ONLY_ENDING = /(?:지원|연계|관리|고도화|활성화|추진|구축|기반 마련)$/u;
const ACTION_EVIDENCE = /(?:담당|운영기관|입력|출력|산출물|기한|까지|검증|시험|기준|증거|상태|실패|오류|삭제|차단|저장|반환|측정|분모|SLO|RTO|RPO)/iu;
const OBLIGATION = /(?:\bMUST\b|반드시|하여야 함|해야 함|필수(?:로|임|이다| 요구| 적용| 검토| 준수| 포함| 구현| 제공))/u;
const QUANTIFIED_CLAIM =
  /(?:\d{4}년|\d+(?:\.\d+)?\s*%|(?:연평균|시장\s*규모|기술\s*격차)[^.!?\n]{0,20}\d|세계\s*최초|국내\s*최초|최신(?:판|\s+(?:버전|release|표준|현황|자료|API|schema|명세))|표준화\s*완료)/iu;
const EVIDENCE_MARKER =
  /(?:https?:\/\/|SRC-[A-Z0-9-]+|C-\d{3}|(?:근거|출처|evidence|검증 결과|시험 결과|산식|분모|기준일)\s*:\s*\S|(?:PDF\s*)?p\.\s*\d+)/iu;
const EVIDENCE_LABEL = /^(?:근거|출처|evidence|검증 결과|시험 결과|산식|분모|기준일)\s*:/iu;
const ACCEPTANCE_MARKER =
  /(?:(?:검증|시험|통과 기준|완료조건|acceptance criterion|예상 결과)\s*:\s*\S|(?:오류|누락|유출|실패|위반|leakage)\s*0건|HTTP\s*[45]\d\d)/iu;
const ACCEPTANCE_LABEL = /^(?:검증|시험|통과 기준|완료조건|acceptance criterion|예상 결과)\s*:/iu;

function countOccurrences(value, pattern) {
  return (value.match(pattern) ?? []).length;
}

function normalizeDuplicate(value) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function headingMatchesScheme(text, schemes) {
  return schemes.some((scheme) => {
    if (scheme === "decimal") {
      return /^\d+(?:\.\d+)+\.?\s/u.test(text);
    }
    if (scheme === "finding") {
      return /^[A-Z]{1,8}-\d+[A-Z]?(?:-\d+)?\.\s/u.test(text);
    }
    if (scheme === "korean-alpha") {
      return /^[가-힣]\.\s/u.test(text);
    }
    if (scheme === "parenthesized") {
      return /^\(\d+\)\s/u.test(text);
    }
    return false;
  });
}

function markerNearby(lines, index, windowSize, markerPattern, labelPattern) {
  const start = Math.max(0, index - windowSize);
  const end = Math.min(lines.length - 1, index + windowSize);
  const claim = lines[index];

  for (let cursor = start; cursor <= end; cursor += 1) {
    const candidate = lines[cursor];
    if (candidate.skip || !markerPattern.test(candidate.raw)) {
      continue;
    }
    if (cursor === index) {
      return true;
    }

    const lower = Math.min(index, cursor) + 1;
    const upper = Math.max(index, cursor);
    if (lines.slice(lower, upper).some((line) => line.type === "blank" || line.heading)) {
      continue;
    }

    if (claim.list) {
      if (!candidate.list) {
        continue;
      }
      if (candidate.list.indent > claim.list.indent) {
        return true;
      }
      if (
        candidate.list.indent === claim.list.indent &&
        labelPattern.test(visibleText(candidate))
      ) {
        return true;
      }
      continue;
    }

    if (candidate.type === "prose" || labelPattern.test(visibleText(candidate))) {
      return true;
    }
  }
  return false;
}

function evidenceNearby(lines, index, windowSize) {
  return markerNearby(lines, index, windowSize, EVIDENCE_MARKER, EVIDENCE_LABEL);
}

function acceptanceNearby(lines, index, windowSize) {
  return markerNearby(lines, index, windowSize, ACCEPTANCE_MARKER, ACCEPTANCE_LABEL);
}

function findColumn(raw, pattern) {
  const match = raw.match(pattern);
  return match ? match.index + 1 : 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasPoliteEnding(value) {
  const normalized = value.replace(/[.!?]+$/u, "");
  if (/(?:해요|나요|하죠|까요|세요|십시오)$/u.test(normalized)) {
    return true;
  }
  const suffix = normalized.endsWith("니까") ? "니까" : normalized.endsWith("니다") ? "니다" : null;
  if (!suffix) {
    return false;
  }
  const stem = normalized.slice(0, -suffix.length);
  const lastCodePoint = stem.codePointAt(stem.length - 1);
  return lastCodePoint !== undefined && lastCodePoint >= 0xac00 && lastCodePoint <= 0xd7a3 && (lastCodePoint - 0xac00) % 28 === 17;
}

export function analyzeMarkdown(scan, relativePath, config) {
  const diagnostics = [];
  const lines = scan.lines;

  function add(ruleId, line, message, suggestion, pattern) {
    const rule = ruleForFile(config, relativePath, ruleId);
    if (rule.severity === "off") {
      return;
    }

    const suppression = scan.suppressions.get(line.number);
    if (suppression && (suppression.rules.includes(ruleId) || suppression.rules.includes("ALL"))) {
      return;
    }

    diagnostics.push({
      path: relativePath,
      line: line.number,
      column: pattern ? findColumn(line.raw, pattern) : 1,
      severity: rule.severity,
      ruleId,
      message,
      suggestion,
      excerpt: visibleText(line).slice(0, 180)
    });
  }

  const headings = lines.filter((line) => line.heading);
  const h1 = headings.filter((line) => line.heading.level === 1);
  const fallbackLine = lines.find((line) => line.type !== "blank") ?? {
    number: 1,
    raw: "",
    masked: ""
  };

  if (h1.length !== 1) {
    add(
      "STR001",
      h1[1] ?? h1[0] ?? fallbackLine,
      "H1은 정확히 하나여야 함. 현재 " + h1.length + "개",
      "문서 제목 하나만 # heading으로 유지"
    );
  }

  if (h1.length === 1 && headings[0].heading.level !== 1) {
    add(
      "STR001",
      headings[0],
      "첫 heading이 H1이 아님",
      "문서 제목을 첫 heading의 H1으로 배치"
    );
  }

  let previousLevel = 0;
  for (const heading of headings) {
    const level = heading.heading.level;
    if (previousLevel > 0 && level > previousLevel + 1) {
      add(
        "STR001",
        heading,
        "Heading level을 " + previousLevel + "에서 " + level + "로 건너뜀",
        "중간 heading level 추가"
      );
    }
    previousLevel = level;
  }

  let expectedH2 = 1;
  for (const heading of headings.filter((line) => line.heading.level === 2)) {
    const match = heading.heading.text.match(/^(\d+)\.\s/u);
    if (!match) {
      add("STR002", heading, "H2에 십진 번호가 없음", "## " + expectedH2 + ". 제목 형식 사용");
      continue;
    }
    const actual = Number(match[1]);
    if (actual !== expectedH2) {
      add(
        "STR002",
        heading,
        "H2 번호가 연속되지 않음. 예상 " + expectedH2 + ", 실제 " + actual,
        "H2 번호를 문서 순서에 맞게 수정"
      );
      expectedH2 = actual + 1;
    } else {
      expectedH2 += 1;
    }
  }

  for (const heading of headings.filter((line) => line.heading.level >= 3)) {
    if (!headingMatchesScheme(heading.heading.text, config.allowedHeadingSchemes)) {
      add(
        "STR003",
        heading,
        "승인된 하위 제목 scheme에 해당하지 않음",
        "decimal, finding ID 또는 한글 항목 번호 사용"
      );
    }
  }

  const firstThirty = headings
    .filter((line) => line.number <= 30)
    .map((line) => line.heading.text)
    .join(" ");
  if (!/(?:목적|범위|질문|판정|개요|기준)/u.test(firstThirty)) {
    add(
      "STR004",
      headings.find((line) => line.heading.level === 2) ?? fallbackLine,
      "첫 30행의 heading에서 목적·범위·질문·판정·개요·기준을 찾지 못함",
      "첫 절에서 문서의 목적과 범위를 명시"
    );
  }

  const duplicateMap = new Map();
  const definedAcronyms = new Set(config.knownAcronyms);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.skip || line.type === "blank" || line.type === "fence" || line.type === "code") {
      continue;
    }

    const text = visibleText(line);
    if (!text) {
      continue;
    }

    for (const pattern of CONVERSATIONAL_PATTERNS) {
      if (pattern.test(text)) {
        add("REG101", line, "진행 설명 또는 대화형 도입을 사용함", "판단·범위·근거를 직접 기술", pattern);
        break;
      }
    }

    if (hasPoliteEnding(text)) {
      add(
        "REG102",
        line,
        "존대 또는 대화형 종결을 사용함",
        "개조식 명사형 또는 평서형 문어체로 수정",
        POLITE_ENDING_PATTERN
      );
    }

    if (
      line.list &&
      /[.!]$/u.test(text) &&
      !/(?:다|함|임|음|됨)\.$/u.test(text) &&
      !/(?:근거|출처)\s*:/u.test(text)
    ) {
      add("REG103", line, "목록 항목의 종결형이 보고서 문체와 다름", "마침표를 제거한 개조식 또는 ~다 종결 사용");
    }

    if (DIRECT_ADDRESS.test(" " + text)) {
      add("REG104", line, "작성자 또는 독자를 직접 호명함", "비인칭 표현으로 수정", DIRECT_ADDRESS);
    }

    for (const pattern of CLICHE_PATTERNS) {
      if (pattern.test(text)) {
        add("REG105", line, "상투적 강조·전환 구문을 사용함", "대상·조건·결과를 직접 기술", pattern);
        break;
      }
    }

    for (const pattern of PROMOTIONAL_PATTERNS) {
      if (pattern.test(text)) {
        add("REG106", line, "근거 없는 홍보성 수사를 사용함", "측정 가능한 조건이나 수치로 교체", pattern);
        break;
      }
    }

    const maxVisibleChars = ruleForFile(config, relativePath, "REG107").options.maxVisibleChars ?? 180;
    if (text.length > maxVisibleChars) {
      add(
        "REG107",
        line,
        "가시문자 " + text.length + "자로 기준 " + maxVisibleChars + "자를 초과함",
        "판단·근거·조건을 별도 항목으로 분리"
      );
    }

    const andCount = countOccurrences(text, /및/gu);
    const commaCount = countOccurrences(text, /,/gu);
    const parenthesisCount = countOccurrences(text, /\(/gu);
    if (andCount >= 3 || commaCount >= 5 || parenthesisCount >= 3) {
      add(
        "REG108",
        line,
        "병렬 나열이 많음: 및 " + andCount + "회, 쉼표 " + commaCount + "회, 괄호 " + parenthesisCount + "쌍",
        "역할이나 조건별 항목으로 분리"
      );
    }

    if (
      (line.type === "prose" || line.type === "list") &&
      text.length >= 40 &&
      !/^근거\s*:/u.test(text)
    ) {
      const normalized = normalizeDuplicate(text);
      const previous = duplicateMap.get(normalized);
      if (previous) {
        add(
          "REG109",
          line,
          "line " + previous.number + "과 동일한 문장을 반복함",
          "한 곳에 정의하고 다른 절에서는 link로 참조"
        );
      } else {
        duplicateMap.set(normalized, line);
      }
    }

    if (line.type === "list" && ACTION_ONLY_ENDING.test(text) && !ACTION_EVIDENCE.test(text)) {
      add(
        "PRE101",
        line,
        "행위명사만 있고 담당·입력·산출물·완료조건이 없음",
        "담당 주체, 입력, 산출물, 기한과 검증기준 추가",
        ACTION_ONLY_ENDING
      );
    }

    if (line.type !== "heading") {
      const absoluteRule = ruleForFile(config, relativePath, "PRE102");
      for (const pattern of ABSOLUTE_PATTERNS) {
        if (
          pattern.test(text) &&
          !evidenceNearby(lines, index, absoluteRule.options.evidenceWindowLines ?? 3)
        ) {
          add(
            "PRE102",
            line,
            "절대적 기술 단정에 범위·시험·근거가 없음",
            "보장 범위, 실패조건, 측정법과 evidence ID 추가",
            pattern
          );
          break;
        }
      }
    }

    const obligationRule = ruleForFile(config, relativePath, "PRE103");
    if (
      line.type !== "heading" &&
      OBLIGATION.test(text) &&
      !acceptanceNearby(lines, index, obligationRule.options.evidenceWindowLines ?? 3)
    ) {
      add(
        "PRE103",
        line,
        "의무 표현에 검증·시험·증거가 연결되지 않음",
        "같은 항목 또는 다음 3행에 acceptance criterion 추가",
        OBLIGATION
      );
    }

    const quantifiedRule = ruleForFile(config, relativePath, "PRE104");
    if (
      line.type !== "heading" &&
      QUANTIFIED_CLAIM.test(text) &&
      !evidenceNearby(lines, index, quantifiedRule.options.evidenceWindowLines ?? 3)
    ) {
      add(
        "PRE104",
        line,
        "수치·최신성·표준 상태 주장에 출처와 기준일이 없음",
        "URL, source ID, page 또는 기준일 추가",
        QUANTIFIED_CLAIM
      );
    }

    if (line.type !== "heading") {
      for (const pattern of TECHNICAL_MISUSE) {
        if (pattern.test(text)) {
          add("TRM101", line, "판정된 기술 범위 오류를 사용함", "표준 범위와 구현 책임을 분리", pattern);
          break;
        }
      }
    }

    const definitionMatches = text.matchAll(
      /(?:[A-Za-z][A-Za-z0-9\s-]{2,}\s*\(([A-Z][A-Z0-9-]{1,9})\)|\([^()]{2,},\s*([A-Z][A-Z0-9-]{1,9})\))/gu
    );
    for (const match of definitionMatches) {
      definedAcronyms.add(match[1] ?? match[2]);
    }

    const acronymMatches = text.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\b/gu);
    for (const match of acronymMatches) {
      const acronym = match[0];
      const identifier = /^(?:(?:SRC|ADR|REQ|OPEN|C|T)-[A-Z0-9-]+|[PGL]\d+|H[1-6]|[A-Z]|I{1,3}|IV|V|VI{0,3}|IX|X|AGREED|VERIFIED|FINALIZED|ERROR|MUST|GET|POST|PUT|PATCH|DELETE|AS-IS|TO-BE)$/u.test(acronym);
      if (!definedAcronyms.has(acronym) && !identifier) {
        add(
          "TRM102",
          line,
          "약어 " + acronym + "의 첫 정의가 없음",
          "첫 등장에 국문 용어(Official English Term, " + acronym + ") 형식으로 정의",
          new RegExp("\\b" + escapeRegExp(acronym) + "\\b", "u")
        );
        definedAcronyms.add(acronym);
      }
    }

    for (const [variant, canonical] of Object.entries(config.terminology)) {
      if (variant !== canonical && text.includes(variant)) {
        add(
          "TRM103",
          line,
          "대표 표기와 다름: " + variant,
          canonical + "로 통일",
          new RegExp(escapeRegExp(variant), "u")
        );
      }
    }
  }

  return diagnostics.sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId)
  );
}
