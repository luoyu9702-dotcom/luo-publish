import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AlarmListener = (alarm: { name: string }) => void;

const chromeState = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const alarms = new Map<string, { periodInMinutes?: number }>();
  const alarmListeners: AlarmListener[] = [];
  const messageListeners: unknown[] = [];
  const chrome = {
    storage: {
      local: {
        async get(key: string | string[]) {
          if (typeof key === "string") return { [key]: store.get(key) };
          const out: Record<string, unknown> = {};
          for (const name of key) out[name] = store.get(name);
          return out;
        },
        async set(items: Record<string, unknown>) {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
        },
      },
    },
    alarms: {
      async create(name: string, info: { periodInMinutes?: number }) {
        alarms.set(name, info);
      },
      async get(name: string) {
        const info = alarms.get(name);
        return info ? { name, ...info } : undefined;
      },
      async clear(name: string) {
        return alarms.delete(name);
      },
      onAlarm: {
        addListener(fn: AlarmListener) {
          alarmListeners.push(fn);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(fn: unknown) {
          messageListeners.push(fn);
        },
      },
    },
    tabs: {},
  };
  (globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;
  return { store, alarms, alarmListeners, messageListeners };
});

const fills = vi.hoisted(() => ({
  csdn: vi.fn(async () => ({ ok: true as const })),
  x: vi.fn(async () => ({ ok: true as const })),
  bilibili: vi.fn(async () => ({ ok: true as const })),
  xiaohongshu: vi.fn(async () => ({ ok: true as const })),
  publish: vi.fn(async () => ({ ok: true as const })),
  open: vi.fn(async () => 7),
  wait: vi.fn(async () => undefined),
}));

vi.mock("../src/fillers/csdn", () => ({
  fill: fills.csdn,
  openCsdnEditorTab: fills.open,
  waitForTabComplete: fills.wait,
}));
vi.mock("../src/fillers/x", () => ({
  fill: fills.x,
  openXEditorTab: fills.open,
  waitForTabComplete: fills.wait,
}));
vi.mock("../src/fillers/bilibili", () => ({
  fill: fills.bilibili,
  openBilibiliEditorTab: fills.open,
  waitForTabComplete: fills.wait,
}));
vi.mock("../src/fillers/xiaohongshu", () => ({
  fill: fills.xiaohongshu,
  openXiaohongshuEditorTab: fills.open,
  waitForTabComplete: fills.wait,
}));
vi.mock("../src/fillers/publish", () => ({
  publishTab: fills.publish,
}));

const fetchMock = vi.hoisted(() => vi.fn());

const pairing = {
  baseUrl: "http://127.0.0.1:43123",
  token: "secret-token",
  paired: true,
  port: 43123,
};

function pendingBody(items: Array<{ platform: string; title: string; markdown: string; slug?: string; autoPublish?: boolean }>) {
  return { ok: true, items };
}

async function loadBackground() {
  vi.resetModules();
  return import("../src/background.ts");
}

beforeEach(() => {
  chromeState.store.clear();
  chromeState.alarms.clear();
  chromeState.alarmListeners.splice(0);
  chromeState.messageListeners.splice(0);
  for (const fn of [fills.csdn, fills.x, fills.bilibili, fills.xiaohongshu, fills.publish, fills.open, fills.wait]) {
    fn.mockClear();
  }
  fills.open.mockResolvedValue(7);
  fills.wait.mockResolvedValue(undefined);
  fills.publish.mockResolvedValue({ ok: true });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    json: async () => pendingBody([]),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("background auto-pull", () => {
  it("calls the fill router when a paired wake finds pending drafts", async () => {
    chromeState.store.set("luoPairing", pairing);
    fetchMock.mockImplementation(async () => ({
      json: async () => pendingBody([{ platform: "csdn", title: "标题", markdown: "正文" }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/pending",
      expect.objectContaining({ headers: { "X-Luo-Token": "secret-token" } }),
    );
    expect(fills.csdn).toHaveBeenCalledWith(7, { title: "标题", markdown: "正文", images: undefined });
    expect(fills.x).not.toHaveBeenCalled();
    expect(mod.AUTO_PULL_PERIOD_MINUTES).toBeGreaterThanOrEqual(1);
    expect(mod.AUTO_PULL_PERIOD_MINUTES).toBeLessThanOrEqual(2);
    expect(chromeState.alarms.get(mod.AUTO_PULL_ALARM)?.periodInMinutes).toBe(mod.AUTO_PULL_PERIOD_MINUTES);
  });

  it("does not fetch or fill when port and token are missing", async () => {
    const mod = await loadBackground();
    await mod.backgroundReady;
    await mod.runAutoPull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fills.csdn).not.toHaveBeenCalled();
    expect(chromeState.alarms.has(mod.AUTO_PULL_ALARM)).toBe(false);
  });

  it("fills again when the alarm fires", async () => {
    chromeState.store.set("luoPairing", pairing);
    const mod = await loadBackground();
    await mod.backgroundReady;
    fills.x.mockClear();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ({
      json: async () => pendingBody([{ platform: "x", title: "帖子", markdown: "hello" }]),
    }));

    for (const listener of chromeState.alarmListeners) listener({ name: mod.AUTO_PULL_ALARM });
    await vi.waitFor(() => expect(fills.x).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips an unsupported platform queue item without opening any editor", async () => {
    chromeState.store.set("luoPairing", pairing);
    fetchMock.mockImplementation(async () => ({
      json: async () => pendingBody([{ platform: "mastodon", title: "标题", markdown: "正文" }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fills.open).not.toHaveBeenCalled();
    expect(fills.csdn).not.toHaveBeenCalled();
    expect(fills.x).not.toHaveBeenCalled();
    expect(fills.bilibili).not.toHaveBeenCalled();
    expect(fills.xiaohongshu).not.toHaveBeenCalled();
  });

  it("reports the fill result back to the bridge when the item carries a slug", async () => {
    chromeState.store.set("luoPairing", pairing);
    fetchMock.mockImplementation(async () => ({
      json: async () => pendingBody([{ platform: "csdn", title: "标题", markdown: "正文", slug: "demo" }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/report",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slug: "demo", platform: "csdn", stage: "fill", ok: true }),
      }),
    );
  });

  it("reports a failed fill with its reason", async () => {
    chromeState.store.set("luoPairing", pairing);
    fills.csdn.mockResolvedValueOnce({ ok: false, reason: "未找到 CSDN 标题输入框" });
    fetchMock.mockImplementation(async () => ({
      json: async () => pendingBody([{ platform: "csdn", title: "标题", markdown: "正文", slug: "demo" }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/report",
      expect.objectContaining({
        body: JSON.stringify({
          slug: "demo",
          platform: "csdn",
          stage: "fill",
          ok: false,
          reason: "未找到 CSDN 标题输入框",
        }),
      }),
    );
  });

  it("publishes and reports stage publish when the item carries autoPublish", async () => {
    chromeState.store.set("luoPairing", pairing);
    fetchMock.mockImplementation(async () => ({
      json: async () =>
        pendingBody([{ platform: "x", title: "帖子", markdown: "hello", slug: "demo", autoPublish: true }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fills.x).toHaveBeenCalledTimes(1);
    expect(fills.publish).toHaveBeenCalledWith(7, "x");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/report",
      expect.objectContaining({
        body: JSON.stringify({ slug: "demo", platform: "x", stage: "publish", ok: true }),
      }),
    );
  });

  it("reports a failed publish and keeps the draft filled on the plugin side", async () => {
    chromeState.store.set("luoPairing", pairing);
    fills.publish.mockResolvedValueOnce({ ok: false, reason: "未找到发布按钮" });
    fetchMock.mockImplementation(async () => ({
      json: async () =>
        pendingBody([{ platform: "x", title: "帖子", markdown: "hello", slug: "demo", autoPublish: true }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fills.publish).toHaveBeenCalledWith(7, "x");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/report",
      expect.objectContaining({
        body: JSON.stringify({
          slug: "demo",
          platform: "x",
          stage: "publish",
          ok: false,
          reason: "未找到发布按钮",
        }),
      }),
    );
    const stored = chromeState.store.get("luoLastFills") as Record<string, { ok: boolean; stage?: string }>;
    expect(stored.x).toMatchObject({ ok: false, stage: "publish" });
  });

  it("does not publish when the item has no autoPublish flag", async () => {
    chromeState.store.set("luoPairing", pairing);
    fetchMock.mockImplementation(async () => ({
      json: async () => pendingBody([{ platform: "x", title: "帖子", markdown: "hello", slug: "demo" }]),
    }));

    const mod = await loadBackground();
    await mod.backgroundReady;

    expect(fills.x).toHaveBeenCalledTimes(1);
    expect(fills.publish).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/report",
      expect.objectContaining({
        body: JSON.stringify({ slug: "demo", platform: "x", stage: "fill", ok: true }),
      }),
    );
  });

  it("leaves the popup poll in place while the popup is open", () => {
    const popup = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
    expect(popup).toContain("setInterval");
    expect(popup).toContain("2000");
    expect(popup).toContain('type: "pending"');
  });
});
