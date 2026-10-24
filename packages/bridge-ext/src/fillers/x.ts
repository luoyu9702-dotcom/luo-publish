import { injectFill } from "./inject";
import { uploadImages } from "./images";
import type { FillPayload, FillResult } from "./types";

/** X 网页发帖框。没有单独的标题栏，标题写在正文前面。 */
export const X_COMPOSE_URL = "https://x.com/compose/post";

export function isXComposeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "x.com" && parsed.hostname !== "twitter.com") return false;
    return parsed.pathname === "/compose/post" || parsed.pathname.startsWith("/compose/");
  } catch {
    return false;
  }
}

type EditorTab = { id?: number; url?: string; status?: string };
type EditorTabs = {
  query(queryInfo: { url: string | string[] }): Promise<EditorTab[]>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<EditorTab>;
  create(createProperties: { url: string; active: boolean }): Promise<EditorTab>;
  get?(tabId: number): Promise<EditorTab>;
  onUpdated: {
    addListener(listener: (tabId: number, info: { status?: string }) => void): void;
    removeListener(listener: (tabId: number, info: { status?: string }) => void): void;
  };
};

/**
 * Write the post text. This function is injected into the page,
 * so it must not call other module functions and must not click Post.
 */
export function applyXDraft(payload: FillPayload, root: ParentNode = document): FillResult {
  const selectors = ['[data-testid="tweetTextarea_0"]', 'div[role="textbox"]'];
  let box: Element | null = null;
  for (const selector of selectors) {
    box = root.querySelector(selector);
    if (box) break;
  }
  if (!box) return { ok: false, reason: "未找到 X 发帖输入框" };

  const heading = payload.title.trim();
  const body = payload.markdown;
  const text = heading.length === 0 || body.trimStart().startsWith(heading) ? body : `${heading}\n\n${body}`;

  const node = box as HTMLElement & { value?: string };
  const paragraphHtml = (value: string): string => {
    const normalized = value.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    const blocks = normalized ? normalized.split(/\n{2,}/) : [""];
    const esc = (part: string) => part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return blocks.map((block) => `<p>${esc(block).replace(/\n/g, "<br>") || "<br>"}</p>`).join("");
  };
  if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
    const inputCtor = typeof HTMLInputElement === "undefined" ? undefined : HTMLInputElement;
    const areaCtor = typeof HTMLTextAreaElement === "undefined" ? undefined : HTMLTextAreaElement;
    const Proto = node.tagName === "TEXTAREA" ? areaCtor : inputCtor;
    const setter = Proto ? Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set : undefined;
    if (setter) setter.call(node, text);
    else node.value = text;
  } else {
    node.innerHTML = paragraphHtml(text);
  }
  if (typeof node.dispatchEvent === "function") {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { ok: true };
}

export async function openXEditorTab(tabs: EditorTabs, reuse = true): Promise<number> {
  if (reuse) {
    const existing = await tabs.query({ url: ["https://x.com/compose/*", "https://twitter.com/compose/*"] });
    const found = existing.find((tab) => tab.id !== undefined && !!tab.url && isXComposeUrl(tab.url));
    if (found?.id !== undefined) {
      await tabs.update(found.id, { active: true });
      return found.id;
    }
  }
  const created = await tabs.create({ url: X_COMPOSE_URL, active: true });
  if (created.id === undefined) throw new Error("未能打开 X 发帖框");
  return created.id;
}

export function waitForTabComplete(tabId: number, tabs: EditorTabs, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") finish();
    };
    tabs.onUpdated.addListener(listener);
    void tabs.get?.(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    });
    setTimeout(finish, timeoutMs);
  });
}

/** Text first: the composer must exist before X lets images attach to the post. */
export async function fill(tabId: number, payload: FillPayload): Promise<FillResult> {
  try {
    const text = await injectFill(tabId, applyXDraft, payload, "未找到 X 发帖输入框");
    if (!text.ok) return text;
    if (payload.images && payload.images.length > 0) {
      return uploadImages(tabId, payload.images, "未找到 X 图片上传入口");
    }
    return text;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "无法在 X 页面执行填表" };
  }
}
