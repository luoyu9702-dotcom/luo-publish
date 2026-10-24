import type { Platform } from "./outbox";

const META_KEY = /^(source|author|author_name|post_id|url|created_at|quoted_id|ingested|note)\s*:/i;

export const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  xiaohongshu: "小红书",
  bilibili: "B站专栏",
  csdn: "CSDN",
};

/**
 * Hard limits per platform, from each platform's own publish rules:
 * X counts weighted characters (CJK = 2) against 280; 小红书 title 20 / body 1000;
 * B站专栏 title 40 / body 200-40000; CSDN title 100 characters.
 */
export const PLATFORM_LIMITS: Record<
  Platform,
  { title?: number; body?: number; weightedBody?: boolean; minBody?: number }
> = {
  x: { body: 280, weightedBody: true },
  xiaohongshu: { title: 20, body: 1000 },
  bilibili: { title: 40, minBody: 200 },
  csdn: { title: 100 },
};

export type ShapedDraft = { title: string; markdown: string; notes: string[] };

/** A filename slug such as 2026-10-23-goan999999-codex-ecc, not a sentence. */
export function isSlugLike(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  if (/\s/.test(text)) return false;
  return text.includes("-") || /^\d{4}[-_]/.test(text);
}

function unescapeYaml(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    try {
      const parsed: unknown = JSON.parse(trimmed.startsWith("'") ? JSON.stringify(inner) : trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return inner;
    }
  }
  return trimmed;
}

/** Drop one leading `---` YAML block. The body after it is kept, including blank lines. */
export function stripFrontmatter(markdown: string): string {
  const text = markdown.replace(/^\uFEFF/, "");
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\r?\n/, "");
}

function firstFrontmatter(markdown: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown.replace(/^\uFEFF/, ""));
  return match?.[1] ?? "";
}

function yamlScalar(yaml: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(yaml);
  if (!match?.[1]) return "";
  return unescapeYaml(match[1]);
}

function hasMetaKey(yaml: string): boolean {
  return /^(source|author|author_name|post_id|url|created_at|quoted_id|ingested|note|platform|slug|title)\s*:/m.test(
    yaml,
  );
}

/** Remove the opening YAML block, then a following properties block (even under a heading). */
function stripLeadingMetaBlocks(markdown: string): string {
  let body = stripFrontmatter(markdown).replace(/^\n+/, "");
  for (let i = 0; i < 4; i += 1) {
    const match = /^(?:#{1,6}[^\n]*\n+)?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(body);
    if (!match || !hasMetaKey(match[1] ?? "")) break;
    body = body.slice(match[0].length).replace(/^\n+/, "");
  }
  return body;
}

function dropMetaLines(markdown: string): string {
  let fence = false;
  const kept: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      fence = !fence;
      kept.push(line);
      continue;
    }
    if (!fence && META_KEY.test(line.trim())) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function stripLeadingSlugHeading(body: string): string {
  const match = /^#{1,6}\s+(\S[^\n]*)\n+/.exec(body);
  if (!match?.[1] || !isSlugLike(match[1].trim())) return body;
  return body.slice(match[0].length);
}

function stripLeadingTitle(body: string, title: string): string {
  const chosen = title.trim();
  if (!chosen) return body;
  const escaped = chosen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^#{1,6}\\s+${escaped}\\s*\\n+`), "").replace(new RegExp(`^${escaped}\\s*\\n+`), "");
}

/**
 * Publishable article text. Frontmatter and ingest properties are gone.
 * A title that is already sent in its own field is not repeated as the first line.
 * Blank lines between paragraphs stay.
 */
export function sanitizePublishBody(markdown: string, title = ""): string {
  let body = stripLeadingSlugHeading(dropMetaLines(stripLeadingMetaBlocks(markdown)));
  body = stripLeadingTitle(body, title);
  body = body.replace(/^\n+/, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "");
  return body.length ? `${body}\n` : "";
}

/** Human title: YAML title, else an H1, else the first sentence when the fallback is only a slug. */
export function humanTitle(markdown: string, fallback: string): string {
  const yamlTitle = yamlScalar(firstFrontmatter(markdown), "title");
  if (yamlTitle && !isSlugLike(yamlTitle)) return yamlTitle;
  const body = sanitizePublishBody(markdown, "");
  const heading = /^#{1,6}\s+(.+)$/m.exec(body);
  if (heading?.[1] && !isSlugLike(heading[1].trim())) return heading[1].trim();
  const hint = fallback.trim();
  if (!hint || isSlugLike(hint)) {
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim().replace(/^#{1,6}\s+/, "");
      if (!trimmed || trimmed === "#话题") continue;
      if (isSlugLike(trimmed) || /^https?:\/\//.test(trimmed) || trimmed.startsWith("![")) continue;
      if (trimmed.length > 120) break;
      return trimmed;
    }
  }
  return hint || yamlTitle || "未命名";
}

/** Drop image markdown once the same files travel as real uploads. */
export function dropImageLines(markdown: string): string {
  const kept: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*!\[[^\]]*]\([^)]*\)\s*$/.test(line)) continue;
    kept.push(line.replace(/!\[([^\]]*)]\([^)]*\)/g, "$1"));
  }
  const body = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  return body ? `${body}\n` : "";
}

/** Wide characters (CJK, kana, Hangul, fullwidth) count as 2 units, like X's counter. */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function weightedLength(text: string): number {
  let units = 0;
  for (const char of text) units += WIDE_CHAR.test(char) ? 2 : 1;
  return units;
}

const TRAILING_PUNCT = /[\s,.;:!?，。；：！？、…—)\]}]+$/;

function trimTrailing(text: string): string {
  return text.replace(TRAILING_PUNCT, "");
}

/** Cut at a weighted-character budget, e.g. X's 280. */
export function truncateWeighted(text: string, limit: number): { text: string; truncated: boolean } {
  if (limit <= 0) return { text: "", truncated: text.length > 0 };
  let units = 0;
  const chars = [...text];
  for (const [index, char] of chars.entries()) {
    units += WIDE_CHAR.test(char) ? 2 : 1;
    if (units > limit) return { text: trimTrailing(chars.slice(0, index).join("")), truncated: true };
  }
  return { text, truncated: false };
}

/** Cut at a plain-character budget, e.g. 小红书's 20-character title. */
export function truncatePlain(text: string, limit: number): { text: string; truncated: boolean } {
  const chars = [...text];
  if (chars.length <= limit) return { text, truncated: false };
  return { text: trimTrailing(chars.slice(0, limit).join("")), truncated: true };
}

export function clampTitle(title: string, limit: number): { title: string; clamped: boolean } {
  const cut = truncatePlain(title.trim(), limit);
  return { title: cut.text, clamped: cut.truncated };
}

/** X has one plain-text box: drop markdown syntax that would show up literally. */
function flattenForX(markdown: string): string {
  const lines: string[] = [];
  let fence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) {
      lines.push(raw);
      continue;
    }
    if (/^\s*!\[[^\]]*]\([^)]*\)\s*$/.test(line)) continue;
    if (/^\s*(\*\*\*|---|___)\s*$/.test(line)) continue;
    let text = line;
    text = text.replace(/^\s{0,3}#{1,6}\s+/, "");
    text = text.replace(/^\s{0,3}>\s?/, "");
    text = text.replace(/^\s*[-*+]\s+/, "");
    text = text.replace(/^\s*\d+\.\s+/, "");
    text = text.replace(/!\[([^\]]*)]\([^)]*\)/g, "$1");
    text = text.replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
      const clean = label.trim();
      return clean && clean !== url ? `${clean} ${url}` : url;
    });
    text = text.replace(/`([^`]+)`/g, "$1");
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
    text = text.replace(/~~([^~]+)~~/g, "$1");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2").replace(/(^|[^_])_([^_\n]+)_/g, "$1$2");
    lines.push(text);
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}

/**
 * One platform's final title and body, kept inside that platform's hard limits.
 * Notes explain every clamp/truncation so the caller can show them in a Notice.
 */
export function shapeDraft(platform: Platform, title: string, article: string): ShapedDraft {
  const label = PLATFORM_LABEL[platform];
  const limits = PLATFORM_LIMITS[platform];
  const notes: string[] = [];
  let nextTitle = title.trim();
  if (limits.title) {
    const clamped = clampTitle(nextTitle, limits.title);
    nextTitle = clamped.title;
    if (clamped.clamped) notes.push(`${label}：标题超过 ${limits.title} 字，已截断`);
  }
  let body = article;
  if (platform === "x") {
    body = flattenForX(body);
    // The post the composer sees is title + blank line + body + trailing newline; keep it all inside the limit.
    const overhead = (nextTitle ? weightedLength(nextTitle) + 2 : 0) + 1;
    const cut = truncateWeighted(body, Math.max(0, (limits.body ?? 280) - overhead));
    body = cut.text;
    if (cut.truncated || overhead > (limits.body ?? 280)) {
      notes.push(`${label}：标题加正文超过 ${limits.body} 字（中文按 2 字计），已截断`);
    }
  } else {
    if (platform === "xiaohongshu") body = body.replace(/^#{1,6}\s+/gm, "");
    if (limits.body) {
      const cut = truncatePlain(body, limits.body);
      body = cut.text;
      if (cut.truncated) notes.push(`${label}：正文超过 ${limits.body} 字，已截断`);
    }
    if (limits.minBody && body.trim().length < limits.minBody) {
      notes.push(`${label}：正文不足 ${limits.minBody} 字，平台可能拒收（需满 ${limits.minBody} 字或 3 张图），请补充后再发`);
    }
    if (platform === "xiaohongshu" && !body.includes("#话题")) {
      body = `${body.replace(/\s*$/, "")}\n\n#话题`;
    }
  }
  body = body
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
  if (body && !body.endsWith("\n")) body += "\n";
  return { title: nextTitle, markdown: body, notes };
}

/** Title, body, and the sanitized article (before platform shaping) for one platform. */
export function publishArticle(
  platform: Platform,
  text: string,
): { title: string; markdown: string; article: string } {
  const title = humanTitle(text, yamlScalar(firstFrontmatter(text), "title"));
  const article = sanitizePublishBody(text, title);
  const shaped = shapeDraft(platform, title, article);
  return { title: shaped.title, markdown: shaped.markdown, article };
}

/** Title plus body for one platform. Safe to run on a raw note or an existing outbox draft. */
export function publishDraft(platform: Platform, text: string): { title: string; markdown: string } {
  const { title, markdown } = publishArticle(platform, text);
  return { title, markdown };
}
