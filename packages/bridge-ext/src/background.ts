import { fill as fillBilibili, openBilibiliEditorTab, waitForTabComplete as waitBilibili } from "./fillers/bilibili";
import { fill as fillCsdn, openCsdnEditorTab, waitForTabComplete as waitCsdn } from "./fillers/csdn";
import { fill as fillX, openXEditorTab, waitForTabComplete as waitX } from "./fillers/x";
import { fill as fillXiaohongshu, openXiaohongshuEditorTab, waitForTabComplete as waitXiaohongshu } from "./fillers/xiaohongshu";
import { publishTab } from "./fillers/publish";
import type { FillResult } from "./fillers/types";
import { LAST_FILLS_KEY, isLastFills, mergeLastFills, type LastFillRecord } from "./last-fills";
import {
  PAIRING_KEY,
  isPairingState,
  normalizeBridgeBase,
  requestPair,
  requestPending,
  requestReport,
  type PairingState,
  type PendingItem,
} from "./pairing";

/** Chrome's alarm floor is 1 minute. Stay inside the 1–2 minute poll. */
export const AUTO_PULL_PERIOD_MINUTES = 1;
export const AUTO_PULL_ALARM = "luo-auto-pull";

type PairMessage = { type: "pair"; baseUrl?: string; token?: string };
type PendingMessage = { type: "pending" };
type StateMessage = { type: "state" };

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void route(message).then(
    (result) => sendResponse(result),
    (err: unknown) => {
      const error = err instanceof Error ? err.message : "扩展消息失败";
      sendResponse({ ok: false, error });
    },
  );
  return true;
});

async function route(message: unknown): Promise<unknown> {
  if (!message || typeof message !== "object") return { ok: false, error: "无效消息" };
  const msg = message as PairMessage | PendingMessage | StateMessage;
  if (msg.type === "pair") return pair(msg);
  if (msg.type === "pending") return pending();
  if (msg.type === "state") return state();
  return { ok: false, error: "无效消息" };
}

async function pair(msg: PairMessage): Promise<unknown> {
  const baseUrl = normalizeBridgeBase(msg.baseUrl ?? "");
  if (!baseUrl) return { ok: false, error: "桥地址必须是 http://127.0.0.1:端口" };
  const token = (msg.token ?? "").trim();
  const result = await requestPair(baseUrl, token);
  if (!result.ok) return result;
  const pairing: PairingState = { baseUrl, token, paired: true, port: result.port };
  await chrome.storage.local.set({ [PAIRING_KEY]: pairing });
  await ensureAutoPullAlarm();
  return result;
}

let pendingFlight: Promise<unknown> | null = null;

async function pending(): Promise<unknown> {
  if (!pendingFlight) {
    pendingFlight = fillFromPending().finally(() => {
      pendingFlight = null;
    });
  }
  return pendingFlight;
}

async function fillFromPending(): Promise<unknown> {
  const pairing = await loadPairing();
  if (!pairing) return { ok: false, error: "尚未配对" };
  const result = await requestPending(pairing.baseUrl, pairing.token);
  console.log("luo-publish pending", result);
  if (!result.ok) return result;
  const fills: Array<{ platform: string } & FillResult & { stage: "fill" | "publish" }> = [];
  const reports: Array<{ platform: string; ok: boolean; error?: string }> = [];
  const opened = new Set<string>();
  for (const item of result.items) {
    const outcome = await fillPendingItem(item, !opened.has(item.platform));
    opened.add(item.platform);
    const { tabId, ...fill } = outcome;
    fills.push({ ...fill, stage: "fill" });
    if (!item.slug) continue;
    let stage: "fill" | "publish" = "fill";
    let ok = fill.ok;
    let reason: string | undefined;
    if (!fill.ok) reason = fill.reason;
    if (fill.ok && tabId !== undefined && item.autoPublish) {
      stage = "publish";
      const published = await publishTab(tabId, item.platform);
      fills.push({ platform: item.platform, ...published, stage: "publish" });
      ok = published.ok;
      reason = published.ok ? undefined : published.reason;
    }
    const reported = await requestReport(pairing.baseUrl, pairing.token, {
      slug: item.slug,
      platform: item.platform,
      stage,
      ok,
      ...(ok ? {} : { reason: reason ?? "处理失败" }),
    });
    reports.push(
      reported.ok ? { platform: item.platform, ok: true } : { platform: item.platform, ok: false, error: reported.error },
    );
  }
  const lastFills = mergeLastFills(await loadLastFills(), fills, new Date().toISOString());
  await chrome.storage.local.set({ [LAST_FILLS_KEY]: lastFills });
  return { ...result, fills, lastFills, reports };
}

type FillOutcome = { platform: string } & FillResult & { tabId?: number };

async function fillPendingItem(item: PendingItem, reuseEditor: boolean): Promise<FillOutcome> {
  const payload = { title: item.title, markdown: item.markdown, images: item.images };
  try {
    if (item.platform === "xiaohongshu") {
      const tabs = chrome.tabs as unknown as Parameters<typeof openXiaohongshuEditorTab>[0];
      const tabId = await openXiaohongshuEditorTab(tabs, reuseEditor);
      await waitXiaohongshu(tabId, tabs);
      return { platform: "xiaohongshu", ...(await fillXiaohongshu(tabId, payload)), tabId };
    }
    if (item.platform === "bilibili") {
      const tabs = chrome.tabs as unknown as Parameters<typeof openBilibiliEditorTab>[0];
      const tabId = await openBilibiliEditorTab(tabs, reuseEditor);
      await waitBilibili(tabId, tabs);
      return { platform: "bilibili", ...(await fillBilibili(tabId, payload)), tabId };
    }
    if (item.platform === "x") {
      const tabs = chrome.tabs as unknown as Parameters<typeof openXEditorTab>[0];
      const tabId = await openXEditorTab(tabs, reuseEditor);
      await waitX(tabId, tabs);
      return { platform: "x", ...(await fillX(tabId, payload)), tabId };
    }
    if (item.platform === "csdn") {
      const tabs = chrome.tabs as unknown as Parameters<typeof openCsdnEditorTab>[0];
      const tabId = await openCsdnEditorTab(tabs, reuseEditor);
      await waitCsdn(tabId, tabs);
      return { platform: "csdn", ...(await fillCsdn(tabId, payload)), tabId };
    }
    return { platform: item.platform, ok: false, reason: "尚未支持该平台填表" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "打开编辑器失败";
    return { platform: item.platform, ok: false, reason };
  }
}

async function state(): Promise<unknown> {
  return { ok: true, pairing: await loadPairing(), lastFills: await loadLastFills() };
}

async function loadPairing(): Promise<PairingState | null> {
  const stored = await chrome.storage.local.get(PAIRING_KEY);
  const value = stored[PAIRING_KEY];
  return isPairingState(value) ? value : null;
}

async function loadLastFills(): Promise<Record<string, LastFillRecord>> {
  const stored = await chrome.storage.local.get(LAST_FILLS_KEY);
  const value = stored[LAST_FILLS_KEY];
  return isLastFills(value) ? value : {};
}

export async function ensureAutoPullAlarm(): Promise<void> {
  const pairing = await loadPairing();
  if (!pairing) {
    await chrome.alarms.clear(AUTO_PULL_ALARM);
    return;
  }
  const existing = await chrome.alarms.get(AUTO_PULL_ALARM);
  if (existing?.periodInMinutes === AUTO_PULL_PERIOD_MINUTES) return;
  await chrome.alarms.create(AUTO_PULL_ALARM, { periodInMinutes: AUTO_PULL_PERIOD_MINUTES });
}

/** Pull once. Used on service-worker wake and on the paired alarm. */
export async function runAutoPull(): Promise<unknown> {
  await ensureAutoPullAlarm();
  return pending();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_PULL_ALARM) return;
  void runAutoPull();
});

/** Settles the pull that runs when this service worker starts. */
export const backgroundReady: Promise<void> = runAutoPull().then(() => undefined);
