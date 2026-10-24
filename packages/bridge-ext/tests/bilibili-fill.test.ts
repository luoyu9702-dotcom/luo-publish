import { describe, expect, it } from "vitest";
import { BILIBILI_EDITOR_URL, applyBilibiliDraft, isBilibiliEditorUrl, openBilibiliEditorTab } from "../src/fillers/bilibili";
import type { FillPayload } from "../src/fillers/types";

const payload: FillPayload = { title: "标题", markdown: "hello", images: ["a.png"] };

function fakeRoot(
  found: Record<string, Record<string, unknown>>,
  publishClicks: { n: number },
  lists: Record<string, Array<Record<string, unknown>>> = {},
) {
  return {
    querySelector(selector: string) {
      if (selector.includes("publish") || selector.includes("发布")) {
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
    querySelectorAll(selector: string) {
      if (selector.includes("publish") || selector.includes("发布")) {
        publishClicks.n += 1;
        return [];
      }
      return lists[selector] ?? [];
    },
  } as unknown as ParentNode;
}

describe("Bilibili column editor", () => {
  it("uses the current column editor URL", () => {
    expect(BILIBILI_EDITOR_URL).toBe("https://member.bilibili.com/york/read-editor");
    expect(isBilibiliEditorUrl(BILIBILI_EDITOR_URL)).toBe(true);
    expect(isBilibiliEditorUrl("https://member.bilibili.com/platform/upload/text/edit")).toBe(true);
    expect(isBilibiliEditorUrl("https://member.bilibili.com/")).toBe(false);
  });

  it("fills the title and markdown body and does not click publish", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "DIV", textContent: "", isContentEditable: true };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        "textarea[placeholder*='请输入标题']": title,
        ".ql-editor": body,
      },
      clicks,
    );
    expect(applyBilibiliDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.innerHTML).toBe("<p>hello</p>");
    expect(clicks.n).toBe(0);
  });

  it("splits a blank line into paragraphs and does not click publish", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "DIV", isContentEditable: true };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        "textarea[placeholder*='请输入标题']": title,
        ".ql-editor": body,
      },
      clicks,
    );
    expect(applyBilibiliDraft({ title: "标题", markdown: "第一段\n\n第二段" }, root)).toEqual({ ok: true });
    expect(body.innerHTML).toBe("<p>第一段</p><p>第二段</p>");
    expect(clicks.n).toBe(0);
  });

  it("returns a reason when the editor DOM is missing", () => {
    const clicks = { n: 0 };
    const result = applyBilibiliDraft(payload, fakeRoot({}, clicks));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到/);
    expect(clicks.n).toBe(0);
  });

  it("reuses an open editor tab and otherwise creates one", async () => {
    const created: string[] = [];
    const reused = await openBilibiliEditorTab({
      async query() {
        return [{ id: 11, url: "https://member.bilibili.com/york/read-editor" }];
      },
      async update(tabId) {
        return { id: tabId };
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 12 };
      },
    });
    expect(reused).toBe(11);
    expect(created).toEqual([]);

    const opened = await openBilibiliEditorTab({
      async query() {
        return [];
      },
      async update() {
        return {};
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 13 };
      },
    });
    expect(opened).toBe(13);
    expect(created).toEqual([BILIBILI_EDITOR_URL]);
  });
});
