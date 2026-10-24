import { injectFill } from "./inject";
import type { FillPayload, FillResult } from "./types";

/** 公众号图文（文章）新建页。token 由登录态补上；未登录会落到登录页。 */
export const WECHAT_EDITOR_URL =
  "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=100&lang=zh_CN";

export function isWechatEditorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "mp.weixin.qq.com") return false;
    if (!parsed.pathname.startsWith("/cgi-bin/appmsg")) return false;
    return (parsed.searchParams.get("t") ?? "").includes("appmsg_edit");
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
 * so it must not call other module functions and must not click 发表.
 *
 * 2026 appmsg_edit_v2 assumptions:
 * - Title is `.title-editor__input .ProseMirror`, with `textarea#title` / `#js_title` on older pages.
 * - Body is `.rich_media_content .ProseMirror`. Legacy UEditor keeps the body in iframe `#ueditor_0`.
 * - Same-origin iframe documents are searched here. Cross-origin frames are injected separately.
 */
export function applyWechatDraft(payload: FillPayload, root: ParentNode = document): FillResult {
  const titleSelectors = [
    ".title-editor__input .ProseMirror",
    "textarea#title",
    "textarea[name='title']",
    "#js_title",
    "textarea.js_title",
    "#title",
    "textarea[placeholder*='标题']",
    "input[placeholder*='标题']",
    "[data-placeholder*='标题']",
  ];
  const bodySelectors = [
    ".rich_media_content .ProseMirror",
    ".rich_media_content [contenteditable='true']",
    "div.rich_media_content[contenteditable='true']",
    ".edui-body-container",
    "div.ProseMirror[contenteditable='true']",
    "#ueditor_0",
    ".cke_editable",
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
  const roots: ParentNode[] = [root];
  for (const frame of queryAll(root, "iframe")) {
    try {
      const doc = (frame as HTMLIFrameElement).contentDocument;
      if (doc && doc !== root) roots.push(doc);
    } catch {
      // Cross-origin frame. A separate injection covers it.
    }
  }
  const first = (selectors: string[], skip?: Element | null): Element | null => {
    for (const scope of roots) {
      for (const selector of selectors) {
        let found: Element | null = null;
        try {
          found = scope.querySelector(selector);
        } catch {
          found = null;
        }
        if (found && found !== skip && found.tagName !== "IFRAME" && !(found as HTMLIFrameElement).contentDocument) return found;
      }
    }
    return null;
  };

  let titleEl = first(titleSelectors);
  const prose = roots.flatMap((scope) => queryAll(scope, ".ProseMirror"));
  if (!titleEl && prose.length >= 1) titleEl = prose[0] ?? null;

  let bodyEl = first(bodySelectors, titleEl);
  if (bodyEl === titleEl) bodyEl = null;
  if (!bodyEl) {
    for (const scope of roots.slice(1)) {
      try {
        const found = scope.querySelector("body");
        if (found && found !== titleEl) {
          bodyEl = found;
          break;
        }
      } catch {
        // Ignore a frame we cannot read.
      }
    }
  }
  if (!bodyEl && prose.length >= 2) {
    const last = prose[prose.length - 1];
    if (last && last !== titleEl) bodyEl = last;
  }
  if (!bodyEl && prose.length === 1 && prose[0] !== titleEl) bodyEl = prose[0] ?? null;
  if (!titleEl || !bodyEl) {
    return { ok: false, reason: "未找到公众号标题或正文编辑区" };
  }

  const write = (el: Element, text: string) => {
    const node = el as HTMLInputElement & HTMLElement;
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
      const inputCtor = typeof HTMLInputElement === "undefined" ? undefined : HTMLInputElement;
      const areaCtor = typeof HTMLTextAreaElement === "undefined" ? undefined : HTMLTextAreaElement;
      const Proto = node.tagName === "TEXTAREA" ? areaCtor : inputCtor;
      const setter = Proto ? Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set : undefined;
      if (setter) setter.call(node, text);
      else node.value = text;
    } else if (typeof node.value === "string") {
      node.value = text;
    }
    if (node.tagName !== "INPUT" && "textContent" in node) node.textContent = text;
    if (typeof node.dispatchEvent === "function") {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  write(titleEl, payload.title);
  write(bodyEl, payload.markdown);
  return { ok: true };
}

export async function openWechatEditorTab(tabs: EditorTabs, reuse = true): Promise<number> {
  if (reuse) {
    const existing = await tabs.query({ url: ["https://mp.weixin.qq.com/cgi-bin/appmsg*"] });
    const found = existing.find((tab) => tab.id !== undefined && !!tab.url && isWechatEditorUrl(tab.url));
    if (found?.id !== undefined) {
      await tabs.update(found.id, { active: true });
      return found.id;
    }
  }
  const created = await tabs.create({ url: WECHAT_EDITOR_URL, active: true });
  if (created.id === undefined) throw new Error("未能打开公众号编辑器");
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

export async function fill(tabId: number, payload: FillPayload): Promise<FillResult> {
  return injectFill(tabId, applyWechatDraft, payload, "未找到公众号标题或正文编辑区");
}
