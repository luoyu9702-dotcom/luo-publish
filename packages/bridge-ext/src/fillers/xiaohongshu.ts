import { injectFill } from "./inject";
import { uploadImages } from "./images";
import type { FillPayload, FillResult } from "./types";

/**
 * 小红书图文页。标题和正文在选图之前通常不存在。
 * 纯文字草稿会改点「写长文」「新的创作」进入长文编辑器，不点发布。
 */
export const XHS_EDITOR_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";

export function isXiaohongshuEditorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "creator.xiaohongshu.com" && parsed.pathname.startsWith("/publish/publish");
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
 * Write the title and markdown body. This function is injected into the page,
 * so it must not call other module functions and must not click 发布.
 *
 * Assumptions:
 * - Image mode, after a picture is chosen: `input[placeholder*='填写标题']` and `.tiptap.ProseMirror`.
 * - Long-form mode: `textarea[placeholder*='输入标题']` and a contenteditable whose placeholder contains 正文.
 * - Before either editor exists, the page is only a tab strip. Clicking the exact labels 写长文 and 新的创作
 *   opens the long-form editor. Those clicks are not 发布 and not 下一步.
 */
export function applyXiaohongshuDraft(payload: FillPayload, root: ParentNode = document): FillResult {
  const titleSelectors = [
    "textarea[placeholder*='输入标题']",
    "textarea[placeholder*='标题']",
    "input[placeholder*='填写标题']",
    "input[placeholder*='标题']",
    "input.d-text",
    "[contenteditable='true'][data-placeholder*='标题']",
  ];
  const bodySelectors = [
    "[data-placeholder*='输入正文']",
    "[data-placeholder*='正文']",
    ".tiptap.ProseMirror",
    "div.ProseMirror[contenteditable='true']",
    "div[role='textbox']",
    "#post-textarea",
  ];

  const queryAll = (scope: ParentNode, selector: string): Element[] => {
    const fn = (scope as { querySelectorAll?: (value: string) => ArrayLike<Element> }).querySelectorAll;
    if (typeof fn !== "function") return [];
    try {
      return Array.from(fn.call(scope, selector));
    } catch {
      return [];
    }
  };
  const first = (selectors: string[], skip?: Element | null): Element | null => {
    for (const selector of selectors) {
      let found: Element | null = null;
      try {
        found = root.querySelector(selector);
      } catch {
        found = null;
      }
      if (found && found !== skip) return found;
    }
    return null;
  };
  const openLongform = () => {
    const marked = root as { __luoXhs?: Record<string, boolean> };
    marked.__luoXhs ??= {};
    for (const label of ["写长文", "新的创作"]) {
      if (marked.__luoXhs[label]) continue;
      for (const el of queryAll(root, "button, a, span, [role='tab']")) {
        const text = (el.textContent ?? "").trim();
        if (text !== label) continue;
        if (text.includes("发布") || text.includes("提交") || text.includes("发表") || text.includes("下一步")) continue;
        marked.__luoXhs[label] = true;
        if (typeof (el as HTMLElement).click === "function") (el as HTMLElement).click();
        break;
      }
    }
  };

  let titleEl = first(titleSelectors);
  let bodyEl = first(bodySelectors, titleEl);
  if (!titleEl || !bodyEl) {
    openLongform();
    titleEl = first(titleSelectors);
    bodyEl = first(bodySelectors, titleEl);
  }
  if (!titleEl || !bodyEl) {
    return { ok: false, reason: "未找到小红书标题或正文编辑区" };
  }

  const paragraphHtml = (text: string): string => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    const blocks = normalized ? normalized.split(/\n{2,}/) : [""];
    const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return blocks.map((block) => `<p>${esc(block).replace(/\n/g, "<br>") || "<br>"}</p>`).join("");
  };
  const write = (el: Element, text: string, rich: boolean) => {
    const node = el as HTMLInputElement & HTMLElement;
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
      const inputCtor = typeof HTMLInputElement === "undefined" ? undefined : HTMLInputElement;
      const areaCtor = typeof HTMLTextAreaElement === "undefined" ? undefined : HTMLTextAreaElement;
      const Proto = node.tagName === "TEXTAREA" ? areaCtor : inputCtor;
      const setter = Proto ? Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set : undefined;
      if (setter) setter.call(node, text);
      else node.value = text;
    }
    if (!rich || node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
      if (node.tagName !== "INPUT" && "textContent" in node) node.textContent = text;
    } else {
      node.innerHTML = paragraphHtml(text);
    }
    if (typeof node.dispatchEvent === "function") {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  write(titleEl, payload.title, false);
  write(bodyEl, payload.markdown, true);
  return { ok: true };
}

export async function openXiaohongshuEditorTab(tabs: EditorTabs, reuse = true): Promise<number> {
  if (reuse) {
    const existing = await tabs.query({ url: ["https://creator.xiaohongshu.com/publish/publish*"] });
    const found = existing.find((tab) => tab.id !== undefined && !!tab.url && isXiaohongshuEditorUrl(tab.url));
    if (found?.id !== undefined) {
      await tabs.update(found.id, { active: true });
      return found.id;
    }
  }
  const created = await tabs.create({ url: XHS_EDITOR_URL, active: true });
  if (created.id === undefined) throw new Error("未能打开小红书编辑器");
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

/** Images first: in image mode the title and body editors only exist after a picture is chosen. */
export async function fill(tabId: number, payload: FillPayload): Promise<FillResult> {
  if (payload.images && payload.images.length > 0) {
    const uploaded = await uploadImages(tabId, payload.images, "未找到小红书图片上传入口");
    if (!uploaded.ok) return uploaded;
  }
  return injectFill(tabId, applyXiaohongshuDraft, payload, "未找到小红书标题或正文编辑区");
}
