import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { PushImage } from "./images";
import { PLATFORMS, type Platform } from "./outbox";

export type QueueItem = {
  platform: Platform;
  title: string;
  markdown: string;
  images?: PushImage[];
  slug?: string;
  autoPublish?: boolean;
  enqueuedAt: string;
};

/** Plugin-private queue. The extension never reads this file. */
export function queueFilePath(pluginDir: string): string {
  return path.join(pluginDir, "data", "push-queue.json");
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

function isSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    value !== "." &&
    value !== ".."
  );
}

function isPushImage(value: unknown): value is PushImage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.mime === "string" && typeof record.data === "string";
}

function parseItem(value: unknown): QueueItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isPlatform(record.platform)) return null;
  if (typeof record.title !== "string" || typeof record.markdown !== "string") return null;
  if (typeof record.enqueuedAt !== "string" || record.enqueuedAt.length === 0) return null;
  const item: QueueItem = {
    platform: record.platform,
    title: record.title,
    markdown: record.markdown,
    enqueuedAt: record.enqueuedAt,
  };
  if (record.images !== undefined) {
    if (!Array.isArray(record.images) || !record.images.every(isPushImage)) return null;
    item.images = record.images as PushImage[];
  }
  if (record.slug !== undefined) {
    if (!isSlug(record.slug)) return null;
    item.slug = record.slug.trim();
  }
  if (record.autoPublish !== undefined) {
    if (typeof record.autoPublish !== "boolean") return null;
    item.autoPublish = record.autoPublish;
  }
  return item;
}

function resetCorrupt(file: string, raw: string): QueueItem[] {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.bak`, raw, "utf8");
  writeFileSync(file, "[]\n", "utf8");
  return [];
}

export function loadQueue(file: string): QueueItem[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (code === "ENOENT") return [];
    throw err;
  }
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return resetCorrupt(file, raw);
  }
  if (!Array.isArray(parsed)) return resetCorrupt(file, raw);
  const items: QueueItem[] = [];
  for (const entry of parsed) {
    const item = parseItem(entry);
    if (!item) return resetCorrupt(file, raw);
    items.push(item);
  }
  return items;
}

export function saveQueue(file: string, items: QueueItem[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

export function enqueue(file: string, item: QueueItem): void {
  const items = loadQueue(file);
  items.push(item);
  saveQueue(file, items);
}

/** Return every queued draft and clear the file. */
export function drain(file: string): QueueItem[] {
  const items = loadQueue(file);
  saveQueue(file, []);
  return items;
}
