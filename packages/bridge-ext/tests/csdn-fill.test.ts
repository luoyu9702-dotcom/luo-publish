import { describe, expect, it } from "vitest";
import { CSDN_EDITOR_URL, applyCsdnDraft, isCsdnEditorUrl, openCsdnEditorTab } from "../src/fillers/csdn";
import type { FillPayload } from "../src/fillers/types";

const payload: FillPayload = { title: "标题", markdown: "hello", images: ["a.png"] };

function fakeRoot(found: Record<string, Record<string, unknown>>, publishClicks: { n: number }) {
  return {
    querySelector(selector: string) {
      if (selector.includes("publish") || selector.includes("发布")) {
        publishClicks.n += 1;
        return {
          textContent: "发布文章",
          click() {
            publishClicks.n += 1;
          },
        };
      }
      return found[selector] ?? null;
    },
  } as unknown as ParentNode;
}

describe("CSDN editor", () => {
  it("uses the current creator editor URL", () => {
    expect(CSDN_EDITOR_URL).toBe("https://mp.csdn.net/mp_blog/creation/editor");
    expect(isCsdnEditorUrl(CSDN_EDITOR_URL)).toBe(true);
    expect(isCsdnEditorUrl("https://editor.csdn.net/md/")).toBe(true);
    expect(isCsdnEditorUrl("https://example.com/")).toBe(false);
  });

  it("fills the title and markdown body and does not click publish", () => {
    const title = { tagName: "INPUT", value: "" };
    const body = { tagName: "PRE", textContent: "", isContentEditable: true };
    const clicks = { n: 0 };
    const root = fakeRoot(
      {
        "input.article-bar__title--input": title,
        "pre.editor__inner": body,
      },
      clicks,
    );
    expect(applyCsdnDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.textContent).toBe("hello");
    expect(clicks.n).toBe(0);
  });

  it("fills the creator title input and CodeMirror body", () => {
    const title = { tagName: "INPUT", value: "" };
    const written: string[] = [];
    const body = {
      tagName: "DIV",
      textContent: "",
      CodeMirror: {
        setValue(value: string) {
          written.push(value);
        },
      },
    };
    const clicks = { n: 0 };
    const root = fakeRoot({ "#title-input": title, ".CodeMirror": body }, clicks);
    expect(applyCsdnDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(written).toEqual(["hello"]);
    expect(body.textContent).toBe("hello");
    expect(clicks.n).toBe(0);
  });

  it("fills a CKEditor body inside the editor iframe", () => {
    const title = { tagName: "TEXTAREA", value: "" };
    const body = { tagName: "DIV", textContent: "" };
    const frame = {
      tagName: "IFRAME",
      contentDocument: {
        querySelector(selector: string) {
          if (selector === ".cke_editable" || selector === ".editor-content") return body;
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
    };
    const clicks = { n: 0 };
    const root = {
      querySelector(selector: string) {
        if (selector.includes("发布")) {
          clicks.n += 1;
          return null;
        }
        if (selector === ".input__title textarea") return title;
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === "iframe") return [frame];
        return [];
      },
    } as unknown as ParentNode;
    expect(applyCsdnDraft(payload, root)).toEqual({ ok: true });
    expect(title.value).toBe("标题");
    expect(body.innerHTML).toBe("<p>hello</p>");
    expect(clicks.n).toBe(0);
  });

  it("splits a blank line into paragraphs in the rich editor", () => {
    const title = { tagName: "INPUT", value: "" };
    const body = { tagName: "DIV" };
    const clicks = { n: 0 };
    const root = fakeRoot({ "#title-input": title, ".editor-content": body }, clicks);
    expect(applyCsdnDraft({ title: "标题", markdown: "第一段\n\n第二段" }, root)).toEqual({ ok: true });
    expect(body.innerHTML).toBe("<p>第一段</p><p>第二段</p>");
    expect(clicks.n).toBe(0);
  });

  it("returns a reason when the editor DOM is missing", () => {
    const clicks = { n: 0 };
    const result = applyCsdnDraft(payload, fakeRoot({}, clicks));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到/);
    expect(clicks.n).toBe(0);
  });

  it("reuses an open editor tab and otherwise creates one", async () => {
    const created: string[] = [];
    const reused = await openCsdnEditorTab({
      async query() {
        return [{ id: 7, url: "https://mp.csdn.net/mp_blog/creation/editor" }];
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

    const opened = await openCsdnEditorTab({
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
    expect(created).toEqual([CSDN_EDITOR_URL]);
  });
});
