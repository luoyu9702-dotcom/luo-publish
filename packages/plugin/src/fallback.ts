import type { TFile, Vault } from "obsidian";
import { draftToPush } from "./status";
import type { Platform } from "./outbox";

/** Same editor pages as the extension fillers. Opening one does not publish. */
export const COMPOSE_URLS: Record<Platform, string> = {
  x: "https://x.com/compose/post",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image",
  bilibili: "https://member.bilibili.com/york/read-editor",
  csdn: "https://mp.csdn.net/mp_blog/creation/editor",
};

export function composeUrl(platform: Platform): string {
  return COMPOSE_URLS[platform];
}

/** Markdown for the clipboard. A missing title line is added so a single paste still has it. */
export function clipboardText(title: string, markdown: string): string {
  const heading = title.trim();
  if (!heading) return markdown;
  const trimmed = markdown.trimStart();
  if (trimmed.startsWith(heading) || trimmed.startsWith(`# ${heading}`)) return markdown;
  return `${heading}\n\n${markdown}`;
}

export type ClipboardIO = {
  copy(text: string): Promise<void>;
  open(url: string): void;
};

export async function copyAndOpenDraft(
  vault: Vault,
  slug: string,
  platform: Platform,
  io: ClipboardIO,
): Promise<{ url: string; text: string }> {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug === "." || slug === "..") {
    throw new Error(`无效的 slug：${slug}`);
  }
  const draftPath = `raw/outbox/${slug}/${platform}.md`;
  const draft = vault.getAbstractFileByPath(draftPath);
  if (!draft) throw new Error(`未找到草稿：${draftPath}`);
  const item = draftToPush(platform, await vault.read(draft as TFile));
  const text = clipboardText(item.title, item.markdown);
  const url = composeUrl(platform);
  await io.copy(text);
  io.open(url);
  return { url, text };
}

/** Try the bridge first. If that fails, copy the draft and open the editor. */
export async function recoverPush(options: {
  push(): Promise<void>;
  fallback(): Promise<void>;
}): Promise<{ ok: true; via: "push" } | { ok: true; via: "fallback"; error: string } | { ok: false; error: string }> {
  try {
    await options.push();
    return { ok: true, via: "push" };
  } catch (err) {
    const error = err instanceof Error ? err.message : "推送失败";
    try {
      await options.fallback();
      return { ok: true, via: "fallback", error };
    } catch (fallbackErr) {
      const extra = fallbackErr instanceof Error ? fallbackErr.message : "复制并打开失败";
      return { ok: false, error: `${error}。${extra}` };
    }
  }
}
