import { injectAction } from "./inject";
import type { FillResult } from "./types";

/**
 * Auto-publish step. This is the only module allowed to click a publish
 * control, and it only runs when the user turned auto-publish on for that
 * platform. Filler modules must never target these controls.
 */

export type PublishPlan = {
  testId?: string;
  labels: string[];
  confirmLabels?: string[];
  confirmDelayMs?: number;
};

const PUBLISH_PLANS: Record<string, PublishPlan> = {
  // X posts the moment the button is clicked; no confirm dialog.
  x: { testId: "tweetButton", labels: [] },
  // 小红书 asks once more in a dialog; the confirm shows up after a beat.
  xiaohongshu: { labels: ["发布"], confirmLabels: ["发布"], confirmDelayMs: 1500 },
  bilibili: { labels: ["发布文章", "发布"], confirmLabels: ["确定", "确认发布", "发布"] },
  csdn: { labels: ["发布博客", "发布"], confirmLabels: ["确定", "确认发布", "发布"] },
};

/** Draft-class controls. A publish click must never land on one of these. */
const BLOCKED_WORDS = ["草稿", "预览", "保存", "取消", "下一步", "定时", "返回"];

function queryAll(root: ParentNode, selector: string): Element[] {
  const fn = (root as { querySelectorAll?: (value: string) => ArrayLike<Element> }).querySelectorAll;
  if (typeof fn !== "function") return [];
  try {
    return Array.from(fn.call(root, selector));
  } catch {
    return [];
  }
}

function buttonText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, "");
}

function isVisible(el: Element): boolean {
  const node = el as HTMLElement;
  if (typeof node.getClientRects === "function") return node.getClientRects().length > 0;
  return true;
}

function isDisabled(el: Element): boolean {
  const node = el as HTMLElement & { disabled?: boolean };
  if (node.disabled === true) return true;
  if (typeof node.getAttribute === "function" && node.getAttribute("aria-disabled") === "true") return true;
  const cls = typeof node.className === "string" ? node.className : "";
  return /\bdisabled\b/.test(cls);
}

function findPublishButton(plan: PublishPlan, root: ParentNode): Element | null {
  if (plan.testId) {
    const byId = root.querySelector(`[data-testid="${plan.testId}"]`);
    if (byId) return byId;
  }
  // Real buttons first, then links, then styled divs.
  for (const selector of ["button, [role='button']", "a", "div"]) {
    for (const label of plan.labels) {
      for (const el of queryAll(root, selector)) {
        const text = buttonText(el);
        if (text !== label) continue;
        if (BLOCKED_WORDS.some((word) => text.includes(word))) continue;
        if (!isVisible(el)) continue;
        return el;
      }
    }
  }
  return null;
}

/**
 * Click the platform's publish control. Injected into the page, so it must not
 * call other module functions. A page-level guard keeps retries from
 * double-clicking, and a delayed second click covers confirm dialogs.
 */
export function applyPublishClick(plan: PublishPlan, root: ParentNode = document): FillResult {
  const marked = root as { __luoPublishClicked?: boolean };
  if (marked.__luoPublishClicked) return { ok: true };
  const button = findPublishButton(plan, root);
  if (!button) return { ok: false, reason: "未找到发布按钮" };
  if (isDisabled(button)) return { ok: false, reason: "发布按钮当前不可点（内容可能不符合平台要求）" };
  (button as HTMLElement).click();
  marked.__luoPublishClicked = true;
  const confirmLabels = plan.confirmLabels ?? [];
  const delay = plan.confirmDelayMs ?? 0;
  if (confirmLabels.length > 0 && delay > 0) {
    setTimeout(() => {
      const confirm = findPublishButton({ ...plan, labels: confirmLabels, testId: undefined }, root);
      if (confirm && !isDisabled(confirm)) (confirm as HTMLElement).click();
    }, delay);
  }
  return { ok: true };
}

/** Click publish on an editor tab the extension just filled. */
export async function publishTab(tabId: number, platform: string): Promise<FillResult> {
  const plan = PUBLISH_PLANS[platform];
  if (!plan) return { ok: false, reason: "该平台暂不支持自动发布" };
  return injectAction(tabId, applyPublishClick, plan, "未找到发布按钮");
}
