import type { TFile, Vault } from "obsidian";
import {
  DRAFT_STATE_LABELS,
  KNOWN_STATUS_KEYS,
  PLATFORMS,
  STATUS_KEY_LABELS,
  initialStatus,
  type DraftState,
  type Platform,
  type StatusJson,
} from "./outbox";
import { dropImageLines, PLATFORM_LABEL, publishArticle } from "./publish-body";
import type { FillReport, PushItem } from "./bridge-server";
import { attachImages } from "./images";

export const PLATFORM_CHOICES: { id: Platform; label: string }[] = PLATFORMS.map((id) => ({
  id,
  label: PLATFORM_LABEL[id],
}));

export type BridgeEndpoint = { port: number; token: string };

export type DraftPush = {
  platform: Platform;
  title: string;
  markdown: string;
  imagePaths?: string[];
  slug?: string;
};

const STATES = new Set<DraftState>(["generated", "queued", "filled", "published", "failed"]);

export function listOutboxSlugs(paths: readonly string[]): string[] {
  const slugs = new Set<string>();
  for (const path of paths) {
    const match = /^raw\/outbox\/([^/]+)\/status\.json$/.exec(path);
    const slug = match?.[1];
    if (slug) slugs.add(slug);
  }
  return [...slugs].sort((a, b) => a.localeCompare(b));
}

export function suggestSlugs(slugs: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return slugs.filter((slug) => !q || slug.toLowerCase().includes(q));
}

export function suggestPlatforms(query: string): Platform[] {
  const q = query.trim().toLowerCase();
  return PLATFORM_CHOICES.filter((choice) => {
    if (!q) return true;
    return choice.id.toLowerCase().includes(q) || choice.label.toLowerCase().includes(q);
  }).map((choice) => choice.id);
}

export function draftToPush(platform: Platform, text: string, slug?: string): DraftPush {
  const published = publishArticle(platform, text);
  const title = published.title;
  const markdown = published.markdown;
  const imagePaths = [...published.article.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g)]
    .map((found) => found[1])
    .filter((image): image is string => typeof image === "string" && image.length > 0);
  const item: DraftPush = { platform, title, markdown };
  if (imagePaths.length > 0) item.imagePaths = imagePaths;
  if (slug !== undefined) item.slug = slug;
  return item;
}

function assertSlug(slug: string): void {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug === "." || slug === "..") {
    throw new Error(`无效的 slug：${slug}`);
  }
}

function assertPlatform(platform: string): asserts platform is Platform {
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(`未知平台：${platform}`);
  }
}

/**
 * Status is a loose map of known status keys to states. Unknown keys (source)
 * and invalid values are ignored so a missing/extra key never breaks the read.
 */
export function parseStatus(text: string): StatusJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("分发状态无法读取");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("分发状态无法读取");
  const record = parsed as Record<string, unknown>;
  const status: StatusJson = {};
  for (const [key, value] of Object.entries(record)) {
    if (!(KNOWN_STATUS_KEYS as readonly string[]).includes(key)) continue;
    status[key] = typeof value === "string" && STATES.has(value as DraftState) ? (value as DraftState) : "generated";
  }
  return status;
}

async function readStatusFile(vault: Vault, slug: string): Promise<{ file: TFile; status: StatusJson }> {
  assertSlug(slug);
  const path = `raw/outbox/${slug}/status.json`;
  const file = vault.getAbstractFileByPath(path);
  if (!file) throw new Error(`未找到分发任务：${slug}`);
  const text = await vault.read(file as TFile);
  return { file: file as TFile, status: parseStatus(text) };
}

/** Current per-platform states for one task. Throws when the task is missing or unreadable. */
export async function readStatus(vault: Vault, slug: string): Promise<StatusJson> {
  const { status } = await readStatusFile(vault, slug);
  return status;
}

export async function markQueued(vault: Vault, slug: string, platform: Platform): Promise<StatusJson> {
  return writeState(vault, slug, platform, "queued");
}

export async function markFilled(vault: Vault, slug: string, platform: Platform): Promise<StatusJson> {
  return writeState(vault, slug, platform, "filled");
}

export async function markPublished(vault: Vault, slug: string, platform: Platform): Promise<StatusJson> {
  return writeState(vault, slug, platform, "published");
}

async function writeState(vault: Vault, slug: string, platform: Platform, state: DraftState): Promise<StatusJson> {
  assertPlatform(platform);
  const { file, status } = await readStatusFile(vault, slug);
  // Rewrite the raw record so keys for platforms this build does not know survive.
  let raw: unknown;
  try {
    raw = JSON.parse(await vault.read(file));
  } catch {
    raw = {};
  }
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...record, [platform]: state };
  await vault.modify(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ...status, [platform]: state };
}

/**
 * Apply a fill/publish report from the browser extension.
 * fill ok → filled; fill fail → failed; publish ok → published; publish fail → filled (still in the editor).
 */
export async function applyFillReport(vault: Vault, report: FillReport): Promise<StatusJson> {
  assertSlug(report.slug);
  assertPlatform(report.platform);
  if (report.stage !== "fill" && report.stage !== "publish") throw new Error("未知的回报阶段");
  if (typeof report.ok !== "boolean") throw new Error("回报结果无效");
  let state: DraftState;
  if (!report.ok) state = report.stage === "publish" ? "filled" : "failed";
  else state = report.stage === "publish" ? "published" : "filled";
  return writeState(vault, report.slug, report.platform, state);
}

/** One line per key actually present in the status, e.g. "小红书：已填入". */
export function statusLines(status: StatusJson): string[] {
  return Object.keys(status).map((key) => {
    const label = STATUS_KEY_LABELS[key] ?? PLATFORM_LABEL[key as Platform] ?? key;
    const state = status[key];
    return `${label}：${state ? DRAFT_STATE_LABELS[state] : state}`;
  });
}

/**
 * Candidate directories for resolving image paths in a draft. The task folder comes
 * first, then the source folder the note came from.
 */
async function sourceDirsOf(vault: Vault, slug: string): Promise<string[]> {
  const dirs: string[] = [`raw/outbox/${slug}`];
  try {
    const file = vault.getAbstractFileByPath(`raw/outbox/${slug}/status.json`);
    if (file) {
      const parsed: unknown = JSON.parse(await vault.read(file as TFile));
      const source = parsed && typeof parsed === "object" ? (parsed as { source?: unknown }).source : undefined;
      if (typeof source === "string" && source.trim()) {
        const parts = source.split("/");
        parts.pop();
        const sourceDir = parts.join("/");
        if (sourceDir) dirs.push(sourceDir);
      }
    }
  } catch {
    // resolution still works with just the task folder
  }
  return dirs;
}

/** Platforms where the extension can drive a real file input. Others keep the markdown image lines. */
const IMAGE_PLATFORMS: readonly Platform[] = ["x", "xiaohongshu"];

/** POST /push on the plugin's 127.0.0.1 bridge, then mark that platform filled or queued. */
export async function pushDraft(
  vault: Vault,
  slug: string,
  platform: Platform,
  endpoint: BridgeEndpoint,
  next: "filled" | "queued" = "filled",
  autoPublish = false,
  onNotes?: (notes: string[]) => void,
): Promise<StatusJson> {
  assertSlug(slug);
  assertPlatform(platform);
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new Error("推送失败：桥端口无效");
  }
  const draftPath = `raw/outbox/${slug}/${platform}.md`;
  const draft = vault.getAbstractFileByPath(draftPath);
  if (!draft) throw new Error(`未找到草稿：${draftPath}`);
  const item = draftToPush(platform, await vault.read(draft as TFile), slug);
  let markdown = item.markdown;
  let images: PushItem["images"];
  if (item.imagePaths && item.imagePaths.length > 0) {
    if (IMAGE_PLATFORMS.includes(platform)) {
      const attached = await attachImages(vault, item.imagePaths, await sourceDirsOf(vault, slug));
      if (attached.notes.length > 0) onNotes?.(attached.notes);
      if (attached.images.length > 0) {
        images = attached.images;
        markdown = dropImageLines(markdown);
      }
    } else {
      onNotes?.([`${PLATFORM_LABEL[platform]}：暂不支持自动传图，请在编辑器手动上传`]);
    }
  }
  const wire: PushItem = { platform: item.platform, title: item.title, markdown, slug };
  if (images) wire.images = images;
  if (autoPublish) wire.autoPublish = true;
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${endpoint.port}/push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-luo-token": endpoint.token,
      },
      body: JSON.stringify(wire),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "无法连接桥";
    throw new Error(`推送失败：${message}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const record = body && typeof body === "object" ? (body as { ok?: unknown; error?: unknown }) : {};
  if (!res.ok || record.ok !== true) {
    const error = typeof record.error === "string" ? record.error : `HTTP ${res.status}`;
    throw new Error(`推送失败：${error}`);
  }
  if (next === "queued") return markQueued(vault, slug, platform);
  return markFilled(vault, slug, platform);
}
