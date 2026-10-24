import { describe, expect, it } from "vitest";
import { WECHAT_EDITOR_URL, applyWechatDraft, isWechatEditorUrl, openWechatEditorTab } from "../src/fillers/wechat";
import type { FillPayload } from "../src/fillers/types";

const payload: FillPayload = { title: "标题", markdown: "hello", images: ["a.png"] };

function fakeRoot(
  found: Record<string, Record<string, unknown>>,
  publishClicks: { n: number },
  lists: Record<string, Array<Record<string, unknown>>> = {},
) {
  return {
    querySelector(selector: string) {
      if (selector.includes("publish") || selector.includes("发布") || selector.includes("js_send") || selector.includes("js_submit")) {
        publishClicks.n += 1;
        return {
          textContent: "发表",
          click() {
            publishClicks.n += 1;
          },
        };
      }
      return found[selector] ?? null;
    },
    querySelectorAll(selector: string) {
      if (selector.includes("publish") || selector.includes("发布") || selector.includes("js_send") || selector.includes("js_submit")) {
        publishClicks.n += 1;
        return [];
      }
      return lists[selector] ?? [];
    },
  } as unknown as ParentNode;
}

describe("WeChat editor", () => {
  it("uses the current article editor URL", () => {
    expect(WECHAT_EDITOR_URL).toBe(
      "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=100&lang=zh_CN",
    );
    expect(isWechatEditorUrl(WECHAT_EDITOR_URL)).toBe(true);
    expect(
      isWechatEditorUrl(
        "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&token=1&lang=zh_CN",
      ),
    ).toBe(true);
    expect(isWechatEditorUrl("https://mp.weixin.qq.com/")).toBe(false);
  });

  it("fills the title and markdown body and does not click publish", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "DIV", textContent: "", isContentEditable: true };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        "textarea#title": title,
        "div.ProseMirror[contenteditable='true']": body,
      },
      clicks,
    );
    expect(applyWechatDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.textContent).toBe("hello");
    expect(clicks.n).toBe(0);
  });

  it("uses the first ProseMirror as the title when #title is absent", () => {
    const title = { tagName: "DIV", textContent: "" };
    const body = { tagName: "DIV", textContent: "" };
    const clicks = { n: 0 };
    const root = fakeRoot({}, clicks, { ".ProseMirror": [title, body] });
    expect(applyWechatDraft(payload, root)).toEqual({ ok: true });
    expect(title.textContent).toBe("标题");
    expect(body.textContent).toBe("hello");
    expect(clicks.n).toBe(0);
  });

  it("fills the 2026 title ProseMirror and the rich-text body", () => {
    const title = { tagName: "DIV", textContent: "" };
    const body = { tagName: "DIV", textContent: "" };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        ".title-editor__input .ProseMirror": title,
        ".rich_media_content .ProseMirror": body,
      },
      clicks,
    );
    expect(applyWechatDraft(payload, root)).toEqual({ ok: true });
    expect(title.textContent).toBe("标题");
    expect(body.textContent).toBe("hello");
    expect(clicks.n).toBe(0);
  });

  it("reads a legacy UEditor body from the same-origin iframe", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "BODY", textContent: "" };
    const frame = {
      tagName: "IFRAME",
      contentDocument: {
        querySelector(selector: string) {
          if (selector === "body" || selector === ".rich_media_content .ProseMirror") return body;
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
    };
    const clicks = { n: 0 };
    const root = fakeRoot({ "textarea#title": title }, clicks, { iframe: [frame] });
    expect(applyWechatDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.textContent).toBe("hello");
    expect(clicks.n).toBe(0);
  });

  it("returns a reason when the editor DOM is missing", () => {
    const clicks = { n: 0 };
    const result = applyWechatDraft(payload, fakeRoot({}, clicks));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到/);
    expect(clicks.n).toBe(0);
  });

  it("reuses an open editor tab and otherwise creates one", async () => {
    const created: string[] = [];
    const reused = await openWechatEditorTab({
      async query() {
        return [{ id: 7, url: `${WECHAT_EDITOR_URL}&token=abc` }];
      },
      async update(tabId) {
        return { id: tabId };
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 8 };
      },
    });
    expect(reused).toBe(7);
    expect(created).toEqual([]);

    const opened = await openWechatEditorTab({
      async query() {
        return [];
      },
      async update() {
        return {};
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 9 };
      },
    });
    expect(opened).toBe(9);
    expect(created).toEqual([WECHAT_EDITOR_URL]);
  });
});
