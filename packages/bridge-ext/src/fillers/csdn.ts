import { injectFill } from "./inject";
import type { FillPayload, FillResult } from "./types";

/** CSDN 创作中心写文章页（2026-10 仍是这个入口）。 */
export const CSDN_EDITOR_URL = "https://mp.csdn.net/mp_blog/creation/editor";

export function isCsdnEditorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "mp.csdn.net" && parsed.pathname.startsWith("/mp_blog/creation/editor")) return true;
    if (parsed.hostname === "editor.csdn.net" && (parsed.pathname === "/md" || parsed.pathname.startsWith("/md/"))) {
      return true;
    }
    return false;
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
 * Assumptions for the current creator editor and the older markdown editor:
 * - mp.csdn.net title is `#title-input` or `.input__title textarea`. Body is `.editor-content`,
 *   CodeMirror (`.cm-content` / `.CodeMirror`), or a same-origin CKEditor iframe.
 * - editor.csdn.net markdown mode still uses `input.article-bar__title--input` and `pre.editor__inner`.
 *   The visible title is sometimes a display node; clicking it reveals the input and is not 发布.
 */
export function applyCsdnDraft(payload: FillPayload, root: ParentNode = document): FillResult {
  const display = root.querySelector(".article-bar__title-display");
  if (display && typeof (display as HTMLElement).click === "function") {
    (display as HTMLElement).click();
  }

  const titleSelectors = [
    "#title-input",
    ".input__title textarea",
    ".input__title input",
    "input.article-bar__title--input",
    "input.article-bar__title",
    ".article-bar__title input",
    "textarea[placeholder*='请输入文章标题']",
    "input[placeholder*='请输入文章标题']",
    "textarea[placeholder*='标题']",
    "input[placeholder*='标题']",
  ];
  const bodySelectors = [
    ".cm-content",
    ".CodeMirror",
    "pre.editor__inner",
    "textarea.editor__inner",
    ".editor__inner textarea",
    ".cledit-section",
    "div.editor__inner[contenteditable='true']",
    ".editor-content[contenteditable='true']",
    ".editor-content",
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
  const first = (selectors: string[]): Element | null => {
    for (const scope of roots) {
      for (const selector of selectors) {
        let found: Element | null = null;
        try {
          found = scope.querySelector(selector);
        } catch {
          found = null;
        }
        if (found && found.tagName !== "IFRAME" && !(found as HTMLIFrameElement).contentDocument) return found;
      }
    }
    return null;
  };

  const titleEl = first(titleSelectors);
  const bodyEl = first(bodySelectors);
  if (!titleEl || !bodyEl) {
    return { ok: false, reason: "未找到 CSDN 标题或正文编辑区" };
  }

  const paragraphHtml = (text: string): string => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    const blocks = normalized ? normalized.split(/\n{2,}/) : [""];
    const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return blocks.map((block) => `<p>${esc(block).replace(/\n/g, "<br>") || "<br>"}</p>`).join("");
  };
  const write = (el: Element, text: string, rich: boolean) => {
    const node = el as HTMLInputElement &
      HTMLElement & {
        CodeMirror?: { setValue(value: string): void };
        cmView?: { view?: { dispatch(spec: unknown): void; state?: { doc: { length: number } } } };
      };
    const parent = node.parentElement as { cmView?: typeof node.cmView } | null;
    if (node.CodeMirror?.setValue) node.CodeMirror.setValue(text);
    const view = node.cmView?.view ?? parent?.cmView?.view;
    if (view?.dispatch && view.state?.doc) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }
    const sourceEditor = node.tagName === "PRE" || !!node.CodeMirror;
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
      const inputCtor = typeof HTMLInputElement === "undefined" ? undefined : HTMLInputElement;
      const areaCtor = typeof HTMLTextAreaElement === "undefined" ? undefined : HTMLTextAreaElement;
      const Proto = node.tagName === "TEXTAREA" ? areaCtor : inputCtor;
      const setter = Proto ? Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set : undefined;
      if (setter) setter.call(node, text);
      else node.value = text;
    }
    if (view) {
      // cmView.dispatch already inserted the text with its newlines.
    } else if (!rich || sourceEditor) {
      if (node.tagName !== "INPUT" && "textContent" in node) node.textContent = text;
    } else {
      const html = paragraphHtml(text);
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
    if (typeof node.dispatchEvent === "function") {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  write(titleEl, payload.title, false);
  write(bodyEl, payload.markdown, true);
  return { ok: true };
}

export async function openCsdnEditorTab(tabs: EditorTabs, reuse = true): Promise<number> {
  if (reuse) {
    const existing = await tabs.query({
      url: ["https://mp.csdn.net/mp_blog/creation/editor*", "https://editor.csdn.net/md/*"],
    });
    const found = existing.find((tab) => tab.id !== undefined && !!tab.url && isCsdnEditorUrl(tab.url));
    if (found?.id !== undefined) {
      await tabs.update(found.id, { active: true });
      return found.id;
    }
  }
  const created = await tabs.create({ url: CSDN_EDITOR_URL, active: true });
  if (created.id === undefined) throw new Error("未能打开 CSDN 编辑器");
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
  return injectFill(tabId, applyCsdnDraft, payload, "未找到 CSDN 标题或正文编辑区");
}
