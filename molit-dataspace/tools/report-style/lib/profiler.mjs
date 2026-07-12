import { visibleText } from "./scanner.mjs";

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, index)];
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function countLiteral(value, needle) {
  if (!needle) {
    return 0;
  }
  return value.split(needle).length - 1;
}

export function profileScans(scannedFiles, config) {
  const headingLevels = {};
  const listMarkers = {};
  const endings = {
    reportStyle: 0,
    declarative: 0,
    polite: 0,
    other: 0
  };
  const terminology = {};
  const bulletLengths = [];
  let lineCount = 0;
  let contentLineCount = 0;
  let leadLabelCount = 0;
  let bilingualDefinitionCount = 0;
  const observedTerms = new Map(Object.entries(config.terminology));
  for (const canonical of Object.values(config.terminology)) {
    if (!observedTerms.has(canonical)) {
      observedTerms.set(canonical, canonical);
    }
  }

  for (const { scan } of scannedFiles) {
    lineCount += scan.lines.length;

    for (const line of scan.lines) {
      if (line.skip || line.type === "blank" || line.type === "fence" || line.type === "code") {
        continue;
      }
      if (line.heading) {
        increment(headingLevels, String(line.heading.level));
      }
      if (line.list) {
        const marker = /^\d+\.$/u.test(line.list.marker) ? "n." : line.list.marker;
        increment(listMarkers, marker);
        bulletLengths.push(line.list.content.length);
      }
      const text = visibleText(line);
      if (!text) {
        continue;
      }
      contentLineCount += 1;

      if (/^(?:\*\*)?\([^)]+\)(?:\*\*)?\s*/u.test(text)) {
        leadLabelCount += 1;
      }
      if (
        /(?:[A-Za-z][A-Za-z0-9\s-]{2,}\s*\([A-Z][A-Z0-9-]{1,9}\)|\([^()]{2,},\s*[A-Z][A-Z0-9-]{1,9}\))/u.test(text)
      ) {
        bilingualDefinitionCount += 1;
      }

      if (/(?:습니다|습니까|입니다|합니다|해요|세요|까요)[.!?]?$/u.test(text)) {
        endings.polite += 1;
      } else if (/(?:함|임|음|됨|필요|판단|수립|구축|개발|검증|확인|운영|관리)[.!]?$/u.test(text)) {
        endings.reportStyle += 1;
      } else if (/다[.!]?$/u.test(text)) {
        endings.declarative += 1;
      } else {
        endings.other += 1;
      }

      for (const [variant, canonical] of observedTerms) {
        const count = countLiteral(text, variant);
        if (count > 0) {
          const key = variant === canonical ? canonical : variant + " -> " + canonical;
          increment(terminology, key, count);
        }
      }
    }
  }

  return {
    files: scannedFiles.length,
    lines: lineCount,
    contentLines: contentLineCount,
    headings: Object.fromEntries(Object.entries(headingLevels).sort(([left], [right]) => Number(left) - Number(right))),
    listMarkers: Object.fromEntries(Object.entries(listMarkers).sort(([left], [right]) => left.localeCompare(right))),
    bulletLength: {
      count: bulletLengths.length,
      median: percentile(bulletLengths, 0.5),
      p90: percentile(bulletLengths, 0.9),
      max: bulletLengths.length === 0 ? 0 : Math.max(...bulletLengths)
    },
    endings,
    leadLabels: leadLabelCount,
    bilingualDefinitions: bilingualDefinitionCount,
    terminology: Object.fromEntries(Object.entries(terminology).sort(([left], [right]) => left.localeCompare(right)))
  };
}
