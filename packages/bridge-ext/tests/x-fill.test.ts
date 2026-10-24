import { describe, expect, it } from "vitest";
import { X_COMPOSE_URL, applyXDraft, isXComposeUrl, openXEditorTab } from "../src/fillers/x";
import type { FillPayload } from "../src/fillers/types";

const payload: FillPayload = {
  title: "标题",
  markdown: "hello",
  images: [{ name: "a.png", mime: "image/png", data: "AAAA" }],
};

function fakeRoot(found: Record<string, Record<string, unknown>>, publishClicks: { n: number }) {
  return {
    querySelector(selector: string) {
      if (selector.includes("tweetButton") || selector.includes("publish") || selector.includes("发布")) {
        publishClicks.n += 1;
        return {
          textContent: "Post",
          click() {
            publishClicks.n += 1;
          },
        };
      }
      return found[selector] ?? null;
    },
  } as unknown as ParentNode;
}

describe("X composer", () => {
  it("uses the current compose URL", () => {
    expect(X_COMPOSE_URL).toBe("https://x.com/compose/post");
    expect(isXComposeUrl(X_COMPOSE_URL)).toBe(true);
    expect(isXComposeUrl("https://twitter.com/compose/post")).toBe(true);
    expect(isXComposeUrl("https://x.com/home")).toBe(false);
  });

  it("writes the title and markdown into the textbox and does not click Post", () => {
    const box = { tagName: "DIV", textContent: "", isContentEditable: true };
    const clicks = { n: 0 };
    const root = fakeRoot({ '[data-testid="tweetTextarea_0"]': box }, clicks);
    expect(applyXDraft(payload, root)).toEqual({ ok: true });
    expect(box.innerHTML).toBe("<p>标题</p><p>hello</p>");
    expect(clicks.n).toBe(0);
  });

  it("does not repeat a title that is already the first line", () => {
    const box = { tagName: "DIV", textContent: "" };
    const clicks = { n: 0 };
    const root = fakeRoot({ 'div[role="textbox"]': box }, clicks);
    expect(applyXDraft({ title: "标题", markdown: "标题\nhello" }, root)).toEqual({ ok: true });
    expect(box.innerHTML).toBe("<p>标题<br>hello</p>");
    expect(clicks.n).toBe(0);
  });

  it("returns a reason when the composer is missing", () => {
    const clicks = { n: 0 };
    const result = applyXDraft(payload, fakeRoot({}, clicks));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到/);
    expect(clicks.n).toBe(0);
  });

  it("reuses an open compose tab and otherwise creates one", async () => {
    const created: string[] = [];
    const reused = await openXEditorTab({
      async query() {
        return [{ id: 3, url: "https://twitter.com/compose/post" }];
      },
      async update(tabId) {
        return { id: tabId };
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 4 };
      },
    });
    expect(reused).toBe(3);
    expect(created).toEqual([]);

    const opened = await openXEditorTab({
      async query() {
        return [];
      },
      async update() {
        return {};
      },
      async create(props) {
        created.push(props.url ?? "");
        return { id: 5 };
      },
    });
    expect(opened).toBe(5);
    expect(created).toEqual([X_COMPOSE_URL]);
  });
});
