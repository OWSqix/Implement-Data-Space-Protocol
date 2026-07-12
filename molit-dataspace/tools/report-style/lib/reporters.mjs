const SEVERITY_LABEL = {
  error: "오류",
  warning: "경고",
  info: "정보"
};

const SEVERITY_RANK = {
  none: 4,
  error: 3,
  warning: 2,
  info: 1
};

function countBySeverity(diagnostics) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return counts;
}

export function buildLintResult(profile, files, diagnostics, failOn, maxWarnings) {
  const counts = countBySeverity(diagnostics);
  const threshold = SEVERITY_RANK[failOn];
  const thresholdFailed =
    failOn !== "none" && diagnostics.some((diagnostic) => SEVERITY_RANK[diagnostic.severity] >= threshold);
  const warningLimitFailed = maxWarnings !== null && counts.warning > maxWarnings;

  return {
    profile,
    gate: {
      failOn,
      maxWarnings,
      passed: !thresholdFailed && !warningLimitFailed
    },
    summary: {
      files: files.length,
      diagnostics: diagnostics.length,
      errors: counts.error,
      warnings: counts.warning,
      infos: counts.info
    },
    diagnostics
  };
}

export function formatLintText(result) {
  const output = [];
  let displayThreshold = result.gate.failOn === "none" ? SEVERITY_RANK.info : SEVERITY_RANK[result.gate.failOn];
  if (
    result.gate.maxWarnings !== null &&
    result.summary.warnings > result.gate.maxWarnings
  ) {
    displayThreshold = Math.min(displayThreshold, SEVERITY_RANK.warning);
  }
  const displayedDiagnostics = result.diagnostics.filter(
    (diagnostic) => SEVERITY_RANK[diagnostic.severity] >= displayThreshold
  );

  for (const diagnostic of displayedDiagnostics) {
    output.push(
      diagnostic.path +
        ":" +
        diagnostic.line +
        ":" +
        diagnostic.column +
        " " +
        SEVERITY_LABEL[diagnostic.severity] +
        " " +
        diagnostic.ruleId +
        " " +
        diagnostic.message
    );
    if (diagnostic.excerpt) {
      output.push("  대상: " + diagnostic.excerpt);
    }
    output.push("  수정: " + diagnostic.suggestion);
  }

  if (displayedDiagnostics.length > 0) {
    output.push("");
  }
  output.push(
    "report-style: " +
      result.summary.files +
      "개 문서, 오류 " +
      result.summary.errors +
      ", 경고 " +
      result.summary.warnings +
      ", 정보 " +
      result.summary.infos +
      ", gate " +
      (result.gate.passed ? "통과" : "실패") +
      " (fail-on=" +
      result.gate.failOn +
      ")"
  );
  if (displayedDiagnostics.length < result.diagnostics.length) {
    output.push(
      "상세 표시 " +
        displayedDiagnostics.length +
        "/" +
        result.diagnostics.length +
        "건; 전체 진단은 --format json 또는 --fail-on none으로 확인"
    );
  }
  return output.join("\n");
}

export function formatProfileText(profileName, stats) {
  const output = [
    "문체 프로파일: " + profileName,
    "문서 " + stats.files + "개 / 전체 " + stats.lines + "행 / 검사 대상 " + stats.contentLines + "행",
    "Heading: " +
      (Object.entries(stats.headings)
        .map(([level, count]) => "H" + level + " " + count)
        .join(", ") || "없음"),
    "목록 표지: " +
      (Object.entries(stats.listMarkers)
        .map(([marker, count]) => marker + " " + count)
        .join(", ") || "없음"),
    "목록 길이: 중앙값 " + stats.bulletLength.median + "자 / p90 " + stats.bulletLength.p90 + "자 / 최대 " + stats.bulletLength.max + "자",
    "종결: 개조식 " +
      stats.endings.reportStyle +
      " / 평서형 " +
      stats.endings.declarative +
      " / 존대형 " +
      stats.endings.polite +
      " / 기타 " +
      stats.endings.other,
    "괄호형 선행 라벨 " + stats.leadLabels + "회 / 국문·영문 병기 정의 " + stats.bilingualDefinitions + "회"
  ];

  const terms = Object.entries(stats.terminology);
  if (terms.length > 0) {
    output.push("용어 출현:");
    for (const [term, count] of terms) {
      output.push("  " + term + ": " + count);
    }
  }
  return output.join("\n");
}

export function formatExplainText(entries) {
  return entries
    .map(([ruleId, rule]) =>
      [
        ruleId + " [" + rule.category + "] " + rule.title,
        "  이유: " + rule.reason,
        "  나쁨: " + rule.bad,
        "  교정: " + rule.good
      ].join("\n")
    )
    .join("\n\n");
}
