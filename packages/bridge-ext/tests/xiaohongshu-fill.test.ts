import { describe, expect, it } from "vitest";
import { XHS_EDITOR_URL, applyXiaohongshuDraft, isXiaohongshuEditorUrl, openXiaohongshuEditorTab } from "../src/fillers/xiaohongshu";
import type { FillPayload } from "../src/fillers/types";

const payload: FillPayload = {
  title: "标题",
  markdown: "hello #话题",
  images: [{ name: "a.png", mime: "image/png", data: "AAAA" }],
};

function fakeRoot(found: Record<string, Record<string, unknown>>, publishClicks: { n: number }) {
  return {
    querySelector(selector: string) {
      if (selector.includes("publish") || selector.includes("发布") || selector.includes("xhs-publish")) {
        publishClicks.n += 1;
        return {
          textContent: "发布",
          click() {
            publishClicks.n += 1;
          },
        };
      }
      return found[selector] ?? null;
    },
  } as unknown as ParentNode;
}

describe("Xiaohongshu editor", () => {
  it("uses the current image-note editor URL", () => {
    expect(XHS_EDITOR_URL).toBe("https://creator.xiaohongshu.com/publish/publish?from=menu&target=image");
    expect(isXiaohongshuEditorUrl(XHS_EDITOR_URL)).toBe(true);
    expect(isXiaohongshuEditorUrl("https://creator.xiaohongshu.com/publish/publish?target=article")).toBe(true);
    expect(isXiaohongshuEditorUrl("https://creator.xiaohongshu.com/")).toBe(false);
  });

  it("fills the title and markdown body and does not click publish", () => {
    const title = { tagName: "INPUT", value: "" };
    const body = { tagName: "DIV", textContent: "", isContentEditable: true };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        "input[placeholder*='标题']": title,
        ".tiptap.ProseMirror": body,
      },
      clicks,
    );
    expect(applyXiaohongshuDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.innerHTML).toBe("<p>hello #话题</p>");
    expect(clicks.n).toBe(0);
  });

  it("fills the long-form title textarea and the body placeholder", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "DIV", textContent: "" };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        "textarea[placeholder*='输入标题']": title,
        "[data-placeholder*='正文']": body,
      },
      clicks,
    );
    expect(applyXiaohongshuDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.innerHTML).toBe("<p>hello #话题</p>");
    expect(clicks.n).toBe(0);
  });

  it("opens 写长文 when the image editor is absent and does not click 发布", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "DIV", textContent: "" };
    const clicks = { n: 0 };
    let opened = false;
    const longform = {
      textContent: "写长文",
      click() {
        opened = true;
      },
    };
    const publish = {
      textContent: "发布",
      click() {
        clicks.n += 1;
      },
    };
    const root = {
      __luoXhs: {} as Record<string, boolean>,
      querySelector(selector: string) {
        if (!opened) return null;
        if (selector === "textarea[placeholder*='输入标题']") return title;
        if (selector === "[data-placeholder*='正文']") return body;
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector.includes("发布") || selector.includes("xhs-publish")) {
          clicks.n += 1;
          return [];
        }
        return [longform, publish];
      },
    } as unknown as ParentNode;
    expect(applyXiaohongshuDraft(payload, root)).toEqual({ ok: true });
    expect(opened).toBe(true);
    expect(title.value).toBe("标题");
    expect(body.innerHTML).toBe("<p>hello #话题</p>");
    expect(clicks.n).toBe(0);
  });

  it("returns a reason when the editor DOM is missing", () => {
    const clicks = { n: 0 };
    const result = applyXiaohongshuDraft(payload, fakeRoot({}, clicks));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到/);
    expect(clicks.n).toBe(0);
  });

  it("reuses an open editor tab and otherwise creates one", async () => {
    const created: string[] = [];
    const reused = await openXiaohongshuEditorTab({
      async query() {
        return [{ id: 21, url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image" }];
      },
      async update(tabId) {
        return { id: tabId };
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 22 };
      },
    });
    expect(reused).toBe(21);
    expect(created).toEqual([]);

    const opened = await openXiaohongshuEditorTab({
      async query() {
        return [];
      },
      async update() {
        return {};
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 23 };
      },
    });
    expect(opened).toBe(23);
    expect(created).toEqual([XHS_EDITOR_URL]);
  });
});
