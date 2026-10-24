import type { TFile, Vault } from "obsidian";
import { humanTitle, sanitizePublishBody, shapeDraft } from "./publish-body";

export type Platform = "x" | "xiaohongshu" | "bilibili" | "csdn";

export const PLATFORMS: readonly Platform[] = ["x", "xiaohongshu", "bilibili", "csdn"];

/** Platforms the bridge/extension can actually fill. */
export const FILLABLE_PLATFORMS: readonly Platform[] = PLATFORMS;

/** Status keys that may appear in status.json. */
export type StatusKey = Platform;

export const STANDARD_STATUS_KEYS: readonly StatusKey[] = [...PLATFORMS];

export const KNOWN_STATUS_KEYS: readonly string[] = [...PLATFORMS];

export type DraftState = "generated" | "queued" | "filled" | "published" | "failed";

export const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  generated: "已生成",
  queued: "已入队",
  filled: "已填入",
  published: "已发布",
  failed: "失败",
};

export const STATUS_KEY_LABELS: Record<string, string> = {
  x: "X",
  xiaohongshu: "小红书",
  bilibili: "B站专栏",
  csdn: "CSDN",
};

export type StatusJson = Record<string, DraftState>;

export function initialStatus(keys: readonly StatusKey[] = STANDARD_STATUS_KEYS): StatusJson {
  const status: StatusJson = {};
  for (const key of keys) status[key] = "generated";
  return status;
}

function header(platform: string, slug: string, title: string): string {
  return `---
platform: ${platform}
slug: ${JSON.stringify(slug)}
title: ${JSON.stringify(title)}
---

`;
}

/**
 * Build the draft files and collect the per-platform clamp/limit notes. Notes come
 * from shapeDraft (title truncation, body too short for B站, etc.) so the caller can
 * surface them in a Notice after writing the task folder.
 */
export function buildOutboxWithNotes(
  slug: string,
  body: string,
  titleHint: string,
): { files: Record<string, string>; notes: string[] } {
  const title = humanTitle(body, titleHint);
  const article = sanitizePublishBody(body, title);
  const files: Record<string, string> = {};
  const notes: string[] = [];
  for (const platform of PLATFORMS) {
    const item = shapeDraft(platform, title, article);
    files[platform] = `${header(platform, slug, item.title)}${item.markdown}`;
    notes.push(...item.notes);
  }
  return { files, notes };
}

export function buildOutbox(slug: string, body: string, titleHint: string): Record<string, string> {
  return buildOutboxWithNotes(slug, body, titleHint).files;
}

export function slugFromBasename(basename: string): string {
  const slug = basename.trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "");
  if (!slug || slug === "." || slug === "..") {
    throw new Error("无法从笔记名得到 slug");
  }
  return slug;
}

export function titleFromNote(markdown: string, fallback: string): string {
  return humanTitle(markdown, fallback);
}

async function ensureParentFolders(vault: Vault, filePath: string): Promise<void> {
  const parts = filePath.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (vault.getAbstractFileByPath(current)) continue;
    await vault.createFolder(current);
  }
}

export type OutboxWriteResult = { dir: string; notes: string[] };

export async function writeOutbox(
  vault: Vault,
  slug: string,
  body: string,
  title: string,
  sourcePath = "",
): Promise<OutboxWriteResult> {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug === "." || slug === "..") {
    throw new Error(`无效的 slug：${slug}`);
  }
  const dir = `raw/outbox/${slug}`;
  const statusPath = `${dir}/status.json`;
  if (vault.getAbstractFileByPath(statusPath)) {
    throw new Error(`分发任务已存在，未覆盖：${dir}`);
  }
  const { files: drafts, notes } = buildOutboxWithNotes(slug, body, title);
  for (const key of Object.keys(drafts)) {
    const path = `${dir}/${key}.md`;
    await ensureParentFolders(vault, path);
    await vault.create(path, drafts[key] ?? "");
  }
  await ensureParentFolders(vault, statusPath);
  const meta: Record<string, unknown> = { ...initialStatus(STANDARD_STATUS_KEYS) };
  if (sourcePath) meta.source = sourcePath;
  await vault.create(statusPath, `${JSON.stringify(meta, null, 2)}\n`);
  return { dir, notes };
}

export async function createOutboxFromNote(
  vault: Vault,
  file: TFile,
): Promise<OutboxWriteResult> {
  const body = await vault.read(file);
  const title = titleFromNote(body, file.basename);
  const slug = slugFromBasename(file.basename);
  return writeOutbox(vault, slug, body, title, file.path);
}
