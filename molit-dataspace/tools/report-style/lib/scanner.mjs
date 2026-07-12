function blankLike(value) {
  return value.length > 0 ? " " : "";
}

export function maskInlineMarkdown(value) {
  let masked = value;

  masked = masked.replace(/<!--.*?-->/gu, (match) => blankLike(match));
  masked = masked.replace(/(`+).*?\1/gu, (match) => blankLike(match));
  masked = masked.replace(/!\[[^\]]*\]\([^\)]*\)/gu, (match) => blankLike(match));
  masked = masked.replace(/\[([^\]]+)\]\(([^\)]*)\)/gu, (_match, label) => label);
  masked = masked.replace(/https?:\/\/[^\s)>]+/gu, (match) => blankLike(match));
  masked = masked.replace(/[*_~]/gu, "");

  return masked;
}

function parseSuppression(line) {
  const match = line.match(
    /<!--\s*report-style-disable-next-line\s+([A-Z0-9,-]+)\s*:\s*(.+?)\s*-->/u
  );
  if (!match) {
    return null;
  }
  return {
    rules: match[1].split(",").map((value) => value.trim()),
    reason: match[2].trim()
  };
}

function collectGfmTableLines(rawLines) {
  const tableLines = new Set();
  const delimiter = /^\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;

  for (let index = 1; index < rawLines.length; index += 1) {
    if (!delimiter.test(rawLines[index]) || !rawLines[index - 1].includes("|")) {
      continue;
    }
    tableLines.add(index - 1);
    tableLines.add(index);
    for (let cursor = index + 1; cursor < rawLines.length; cursor += 1) {
      if (!rawLines[cursor].trim() || !rawLines[cursor].includes("|")) {
        break;
      }
      tableLines.add(cursor);
    }
  }
  return tableLines;
}

export function scanMarkdown(text) {
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const rawLines = normalized.split("\n");
  const lines = [];
  const suppressions = new Map();
  const gfmTableLines = collectGfmTableLines(rawLines);
  let fence = null;
  let frontMatter = rawLines[0]?.trim() === "---";
  let htmlComment = false;
  let quotedSectionLevel = null;
  let setextUnderlineIndex = -1;

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    const trimmed = raw.trim();
    const number = index + 1;
    const suppression = parseSuppression(raw);

    if (suppression) {
      suppressions.set(number + 1, suppression);
    }

    if (frontMatter) {
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: "front-matter"
      });
      if (index > 0 && trimmed === "---") {
        frontMatter = false;
      }
      continue;
    }

    if (htmlComment) {
      if (raw.includes("-->")) {
        htmlComment = false;
      }
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: "comment"
      });
      continue;
    }

    if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
      htmlComment = true;
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: "comment"
      });
      continue;
    }

    const fenceMatch = raw.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/u);
    if (fence !== null) {
      const closesFence =
        fenceMatch !== null &&
        fenceMatch[1][0] === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === "";
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: closesFence ? "fence" : "code"
      });
      if (closesFence) {
        fence = null;
      }
      continue;
    }

    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: "fence"
      });
      continue;
    }

    if (index === setextUnderlineIndex) {
      setextUnderlineIndex = -1;
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: "heading-underline"
      });
      continue;
    }

    if (trimmed.length === 0) {
      lines.push({
        number,
        raw,
        trimmed,
        masked: "",
        skip: true,
        type: "blank"
      });
      continue;
    }

    const atxHeadingMatch = raw.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u);
    const listMatch = raw.match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/u);
    const reportMarkerMatch = raw.match(/^\s*(□|○|ㅇ|•|⦁)\s*(.+)$/u);
    const isTable = gfmTableLines.has(index) || /^\s*\|.*\|\s*$/u.test(raw);
    const isBlockquote = /^\s*>/u.test(raw);
    const isIndentedCode = !listMatch && /^(?: {4}|\t)/u.test(raw);
    const isHtmlComment = /^<!--[\s\S]*-->$/u.test(trimmed);
    const isMetadata =
      number <= 15 &&
      /^(?:작성일|작성 기준|기준일|상태|단계|작성자|프로파일|분석 대상|분석 범위|관련 결정|문서 ID|버전|Date|Status|Version):\s+\S/iu.test(trimmed);
    const isLinkDefinition = /^\s*\[[^\]]+\]:\s+\S/u.test(raw);
    const isQuotedArtifact =
      /(?:대상 문장|금지 주장|원문 인용|나쁨|교체 전)\s*:/u.test(maskInlineMarkdown(trimmed));

    const nextSetext = rawLines[index + 1]?.match(/^ {0,3}(=+|-+)\s*$/u);
    const isSetextHeading =
      !atxHeadingMatch &&
      nextSetext !== undefined &&
      nextSetext !== null &&
      !listMatch &&
      !reportMarkerMatch &&
      !isTable &&
      !isBlockquote &&
      !isIndentedCode &&
      !isHtmlComment &&
      !isMetadata &&
      !isLinkDefinition &&
      /^ {0,3}\S/u.test(raw);
    const heading = atxHeadingMatch
      ? {
          level: atxHeadingMatch[1].length,
          text: maskInlineMarkdown(
            (atxHeadingMatch[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "")
          ).trim()
        }
      : isSetextHeading
        ? {
            level: nextSetext[1][0] === "=" ? 1 : 2,
            text: maskInlineMarkdown(trimmed).trim()
          }
        : null;

    if (isSetextHeading) {
      setextUnderlineIndex = index + 1;
    }

    if (heading) {
      const headingLevel = heading.level;
      const headingText = heading.text;
      if (quotedSectionLevel !== null && headingLevel <= quotedSectionLevel) {
        quotedSectionLevel = null;
      }
      if (/(?:금지(?:할)?(?: 기술)? (?:설명|문장|주장|표현)|나쁜 예|교체 전|원문 인용)/u.test(headingText)) {
        quotedSectionLevel = headingLevel;
      }
    }

    let type = "prose";
    if (heading) {
      type = "heading";
    } else if (isIndentedCode) {
      type = "code";
    } else if (isTable) {
      type = "table";
    } else if (isBlockquote) {
      type = "blockquote";
    } else if (isHtmlComment) {
      type = "comment";
    } else if (isLinkDefinition) {
      type = "link-definition";
    } else if (isMetadata) {
      type = "metadata";
    } else if (listMatch || reportMarkerMatch) {
      type = "list";
    }

    const masked = maskInlineMarkdown(raw).trim();
    lines.push({
      number,
      raw,
      trimmed,
      masked,
      type,
      skip:
        ["table", "blockquote", "comment", "metadata", "link-definition", "code"].includes(type) ||
        isQuotedArtifact ||
        (quotedSectionLevel !== null && !heading),
      heading,
      list: listMatch
        ? {
            indent: listMatch[1].length,
            marker: listMatch[2],
            content: maskInlineMarkdown(listMatch[3]).trim()
          }
        : reportMarkerMatch
          ? {
              indent: 0,
              marker: reportMarkerMatch[1],
              content: maskInlineMarkdown(reportMarkerMatch[2]).trim()
            }
          : null
    });
  }

  return { text: normalized, lines, suppressions };
}

export function visibleText(line) {
  if (line.heading) {
    return line.heading.text;
  }
  if (line.list) {
    return line.list.content;
  }
  return line.masked;
}
