import type { FillPayload, FillResult } from "./types";

/** B站专栏编辑器（2026-10 创作中心入口）。旧的专栏编辑页也可复用。 */
export const BILIBILI_EDITOR_URL = "https://member.bilibili.com/york/read-editor";

export function isBilibiliEditorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "member.bilibili.com") return false;
    return parsed.pathname.startsWith("/york/read-editor") || parsed.pathname.startsWith("/platform/upload/text/edit");
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
 */
export function applyBilibiliDraft(payload: FillPayload, root: ParentNode = document): FillResult {
  const titleSelectors = [
    "textarea[placeholder*='请输入标题']",
    "input[placeholder*='请输入标题']",
    "[data-placeholder*='请输入标题']",
  ];
  const bodySelectors = [".ql-editor", "div.ProseMirror[contenteditable='true']", "div.editor-content[contenteditable='true']"];

  let titleEl: Element | null = null;
  for (const selector of titleSelectors) {
    titleEl = root.querySelector(selector);
    if (titleEl) break;
  }

  let bodyEl: Element | null = null;
  for (const selector of bodySelectors) {
    const found = root.querySelector(selector);
    if (found && found !== titleEl) {
      bodyEl = found;
      break;
    }
  }
  if (!bodyEl) {
    const editable = Array.from(root.querySelectorAll("[contenteditable='true']"));
    bodyEl = editable.find((node) => node !== titleEl) ?? null;
  }
  if (!titleEl || !bodyEl) {
    return { ok: false, reason: "未找到 B站专栏标题或正文编辑区" };
  }

  const paragraphHtml = (text: string): string => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    const blocks = normalized ? normalized.split(/\n{2,}/) : [""];
    const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return blocks.map((block) => `<p>${esc(block).replace(/\n/g, "<br>") || "<br>"}</p>`).join("");
  };
  const write = (el: Element, text: string, rich: boolean) => {
    const node = el as HTMLInputElement & HTMLElement & {
      __quill?: { setText?(value: string): void; clipboard?: { dangerouslyPasteHTML(html: string): void } };
    };
    const parent = node.parentElement as { __quill?: typeof node.__quill } | null;
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
      const inputCtor = typeof HTMLInputElement === "undefined" ? undefined : HTMLInputElement;
      const areaCtor = typeof HTMLTextAreaElement === "undefined" ? undefined : HTMLTextAreaElement;
      const Proto = node.tagName === "TEXTAREA" ? areaCtor : inputCtor;
      const setter = Proto ? Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set : undefined;
      if (setter) setter.call(node, text);
      else node.value = text;
    }
    const quill =
      node.__quill ??
      parent?.__quill ??
      (typeof node.closest === "function" ? (node.closest(".ql-container") as { __quill?: typeof node.__quill } | null)?.__quill : undefined);
    if (rich && node.tagName !== "INPUT" && node.tagName !== "TEXTAREA" && node.tagName !== "PRE") {
      const html = paragraphHtml(text);
      if (quill?.clipboard?.dangerouslyPasteHTML) {
        quill.setText?.("");
        quill.clipboard.dangerouslyPasteHTML(html);
      } else {
        let written = false;
        const Transfer = typeof DataTransfer === "undefined" ? undefined : DataTransfer;
        const Paste = typeof ClipboardEvent === "undefined" ? undefined : ClipboardEvent;
        if (Transfer && Paste && typeof node.dispatchEvent === "function") {
          const data = new Transfer();
          data.setData("text/plain", text);
          data.setData("text/html", html);
          const event = new Paste("paste", { bubbles: true, cancelable: true, clipboardData: data });
          node.dispatchEvent(event);
          written = event.defaultPrevented;
        }
        if (!written) node.innerHTML = html;
      }
    } else if (node.tagName !== "INPUT" && "textContent" in node) {
      node.textContent = text;
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

export async function openBilibiliEditorTab(tabs: EditorTabs, reuse = true): Promise<number> {
  if (reuse) {
    const existing = await tabs.query({
      url: ["https://member.bilibili.com/york/read-editor*", "https://member.bilibili.com/platform/upload/text/edit*"],
    });
    const found = existing.find((tab) => tab.id !== undefined && !!tab.url && isBilibiliEditorUrl(tab.url));
    if (found?.id !== undefined) {
      await tabs.update(found.id, { active: true });
      return found.id;
    }
  }
  const created = await tabs.create({ url: BILIBILI_EDITOR_URL, active: true });
  if (created.id === undefined) throw new Error("未能打开 B站专栏编辑器");
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
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: applyBilibiliDraft,
      args: [payload],
    });
    const result = injected[0]?.result;
    if (result && typeof result === "object" && "ok" in result) return result;
    return { ok: false, reason: "B站专栏页面没有返回填表结果" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "无法在 B站专栏页面执行填表" };
  }
}
