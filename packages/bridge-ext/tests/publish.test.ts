import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPublishClick, publishTab, type PublishPlan } from "../src/fillers/publish";

type FakeNode = {
  tagName: string;
  textContent: string;
  className: string;
  disabled: boolean;
  testId?: string;
  visible: boolean;
  clicks: number;
  click(): void;
  getClientRects(): unknown[];
  getAttribute(name: string): string | null;
};

function node(text: string, opts: { tag?: string; disabled?: boolean; visible?: boolean; testId?: string } = {}): FakeNode {
  return {
    tagName: opts.tag ?? "BUTTON",
    textContent: text,
    className: "",
    disabled: opts.disabled ?? false,
    ...(opts.testId ? { testId: opts.testId } : {}),
    visible: opts.visible ?? true,
    clicks: 0,
    click() {
      this.clicks += 1;
    },
    getClientRects() {
      return this.visible ? [{}] : [];
    },
    getAttribute(name: string) {
      return name === "aria-disabled" && this.disabled ? "true" : null;
    },
  };
}

function pageRoot(nodes: FakeNode[]) {
  return {
    querySelector(selector: string) {
      const match = /^\[data-testid="([^"]+)"\]$/.exec(selector);
      if (match) return nodes.find((item) => item.testId === match[1]) ?? null;
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === "button, [role='button']") return nodes;
      return [];
    },
  } as unknown as ParentNode;
}

const X_PLAN: PublishPlan = { testId: "tweetButton", labels: [] };
const XHS_PLAN: PublishPlan = { labels: ["发布"], confirmLabels: ["发布"], confirmDelayMs: 1500 };

afterEach(() => {
  vi.useRealTimers();
});

describe("publish clicker", () => {
  it("clicks X's post button by test id and schedules no confirm", () => {
    vi.useFakeTimers();
    const post = node("Post", { testId: "tweetButton" });
    const root = pageRoot([post]);
    expect(applyPublishClick(X_PLAN, root)).toEqual({ ok: true });
    expect(post.clicks).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(post.clicks).toBe(1);
  });

  it("clicks 小红书 publish, then the dialog's publish after the delay", () => {
    vi.useFakeTimers();
    const primary = node("发布");
    const dialogButton = node("发布");
    let clicked = false;
    const root = {
      querySelector: () => null,
      querySelectorAll(selector: string) {
        if (selector !== "button, [role='button']") return [];
        return clicked ? [dialogButton] : [primary];
      },
    } as unknown as ParentNode;
    primary.click = () => {
      primary.clicks += 1;
      clicked = true;
    };

    expect(applyPublishClick(XHS_PLAN, root)).toEqual({ ok: true });
    expect(primary.clicks).toBe(1);
    expect(dialogButton.clicks).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(primary.clicks).toBe(1);
    expect(dialogButton.clicks).toBe(1);
  });

  it("never clicks a draft-class control", () => {
    const draft = node("保存草稿");
    const preview = node("预览");
    const result = applyPublishClick({ labels: ["发布", "保存草稿"] }, pageRoot([draft, preview]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到发布按钮/);
    expect(draft.clicks).toBe(0);
    expect(preview.clicks).toBe(0);
  });

  it("does not click a disabled publish button", () => {
    const post = node("发布", { disabled: true });
    const result = applyPublishClick({ labels: ["发布"] }, pageRoot([post]));
    expect(result).toEqual({ ok: false, reason: "发布按钮当前不可点（内容可能不符合平台要求）" });
    expect(post.clicks).toBe(0);
  });

  it("skips a publish button that is not visible", () => {
    const hidden = node("发布", { visible: false });
    const result = applyPublishClick({ labels: ["发布"] }, pageRoot([hidden]));
    expect(result.ok).toBe(false);
    expect(hidden.clicks).toBe(0);
  });

  it("clicks only once when the retry injects again", () => {
    const post = node("发布博客");
    const root = pageRoot([post]);
    expect(applyPublishClick({ labels: ["发布博客"] }, root)).toEqual({ ok: true });
    expect(applyPublishClick({ labels: ["发布博客"] }, root)).toEqual({ ok: true });
    expect(post.clicks).toBe(1);
  });

  it("refuses a platform without a publish plan", async () => {
    expect(await publishTab(1, "wechat")).toEqual({ ok: false, reason: "该平台暂不支持自动发布" });
  });
});
