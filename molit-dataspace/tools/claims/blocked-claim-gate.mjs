import { decodeHTML } from "entities";
import MarkdownIt from "markdown-it";
import { parseFragment } from "parse5";

const markdown = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
});

const textAttributes = new Set(["alt", "aria-label", "title"]);
const nonRenderedElements = new Set(["script", "style", "template"]);

function isCommentOnlyHtml(content) {
  const fragment = parseFragment(content);
  return fragment.childNodes.length > 0 && fragment.childNodes.every((node) => (
    node.nodeName === "#comment"
      || (node.nodeName === "#text" && node.value.trim() === "")
  ));
}

function collectRawHtml(tokens, findings) {
  for (const token of tokens) {
    if (token.children) collectRawHtml(token.children, findings);
    if (token.type !== "html_inline" && token.type !== "html_block") continue;
    const content = token.content.trim();
    if (isCommentOnlyHtml(content)) continue;
    findings.push(content.slice(0, 160));
  }
}

export function rawHtmlFindings(source) {
  if (typeof source !== "string") throw new TypeError("claim source must be a string");
  const findings = [];
  collectRawHtml(markdown.parse(source, {}), findings);
  return findings;
}

function collectRenderedText(node, chunks) {
  if (node.nodeName === "#text") {
    chunks.push(node.value);
    return;
  }
  if (node.tagName && nonRenderedElements.has(node.tagName)) return;
  for (const attribute of node.attrs ?? []) {
    if (textAttributes.has(attribute.name)) chunks.push(attribute.value);
  }
  for (const child of node.childNodes ?? []) collectRenderedText(child, chunks);
  chunks.push(" ");
}

export function renderedMarkdownText(source) {
  if (typeof source !== "string") throw new TypeError("claim source must be a string");
  const document = parseFragment(markdown.render(source));
  const chunks = [];
  collectRenderedText(document, chunks);
  return decodeHTML(chunks.join(" "));
}

const koreanParticles = [
  "으로서는",
  "에게서는",
  "에서는",
  "으로는",
  "로서는",
  "에게서",
  "께서는",
  "에게는",
  "까지는",
  "부터는",
  "이라는",
  "라고는",
  "에는",
  "에도",
  "로는",
  "으로",
  "에서",
  "에게",
  "께서",
  "까지",
  "부터",
  "처럼",
  "보다",
  "라고",
  "이라",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "에",
  "의",
  "와",
  "과",
  "로",
  "도",
  "만",
].join("|");

const koreanParticlePattern = new RegExp(
  `([A-Za-z0-9])\\s*(?:${koreanParticles})\\s*(?=적합|준수|부합|호환)`,
  "giu",
);

export function normalizeRenderedClaim(source) {
  let normalized = renderedMarkdownText(source).normalize("NFKD");
  normalized = normalized.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  normalized = normalized.replace(/[\p{M}\p{C}]/gu, "").normalize("NFKC");
  normalized = normalized.replace(/[\p{P}\p{S}]/gu, "");
  normalized = normalized.replace(koreanParticlePattern, "$1");
  return normalized.replace(/\s+/gu, "").toLowerCase();
}

export function blockedClaimsInMarkdown(source, blockedPatterns) {
  if (!Array.isArray(blockedPatterns)) {
    throw new TypeError("blocked claim patterns must be an array");
  }
  const normalized = normalizeRenderedClaim(source);
  return blockedPatterns.filter((pattern) => (
    normalized.includes(normalizeRenderedClaim(pattern))
  ));
}
