import { afterEach, describe, expect, it } from "vitest";
import {
  ensureBridgeToken,
  regenerateBridgeToken,
  startBridge,
  validatePush,
  validateReport,
  type BridgeHandle,
  type FillReport,
} from "../src/bridge-server";

const handles: BridgeHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

async function post(port: number, path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["x-luo-token"] = token;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; port?: number } };
}

async function pending(port: number, token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers["x-luo-token"] = token;
  const res = await fetch(`http://127.0.0.1:${port}/pending`, { headers });
  return {
    status: res.status,
    json: (await res.json()) as { ok: boolean; error?: string; items?: unknown[] },
  };
}

describe("push validation", () => {
  it("rejects a missing token and an unknown platform", () => {
    expect(
      validatePush({
        tokenHeader: undefined,
        expectedToken: "secret-token",
        body: { platform: "x", title: "t", markdown: "m" },
      }),
    ).toEqual({ ok: false, error: "missing token" });

    expect(
      validatePush({
        tokenHeader: "secret-token",
        expectedToken: "secret-token",
        body: { platform: "weibo", title: "t", markdown: "m" },
      }),
    ).toEqual({ ok: false, error: "unknown platform" });
  });

  it("keeps a slug and an autoPublish flag on a valid push", () => {
    expect(
      validatePush({
        tokenHeader: "secret-token",
        expectedToken: "secret-token",
        body: { platform: "x", title: "t", markdown: "m", slug: "demo", autoPublish: true },
      }),
    ).toEqual({ ok: true, item: { platform: "x", title: "t", markdown: "m", slug: "demo", autoPublish: true } });

    expect(
      validatePush({
        tokenHeader: "secret-token",
        expectedToken: "secret-token",
        body: { platform: "x", title: "t", markdown: "m", slug: "../escape" },
      }),
    ).toEqual({ ok: false, error: "invalid slug" });

    // Images travel as base64 objects, not paths.
    expect(
      validatePush({
        tokenHeader: "secret-token",
        expectedToken: "secret-token",
        body: {
          platform: "x",
          title: "t",
          markdown: "m",
          images: [{ name: "a.png", mime: "image/png", data: "AAAA" }],
        },
      }),
    ).toEqual({
      ok: true,
      item: { platform: "x", title: "t", markdown: "m", images: [{ name: "a.png", mime: "image/png", data: "AAAA" }] },
    });
    expect(
      validatePush({
        tokenHeader: "secret-token",
        expectedToken: "secret-token",
        body: { platform: "x", title: "t", markdown: "m", images: ["a.png"] },
      }),
    ).toEqual({ ok: false, error: "invalid body" });
  });
});

describe("report validation", () => {
  it("rejects a missing token, a bad slug, an unknown platform, and a bad stage", () => {
    const base = { slug: "demo", platform: "x", stage: "fill", ok: true };
    expect(validateReport({ tokenHeader: undefined, expectedToken: "secret-token", body: base })).toEqual({
      ok: false,
      error: "missing token",
    });
    expect(
      validateReport({ tokenHeader: "secret-token", expectedToken: "secret-token", body: { ...base, slug: "" } }),
    ).toEqual({ ok: false, error: "invalid slug" });
    expect(
      validateReport({ tokenHeader: "secret-token", expectedToken: "secret-token", body: { ...base, slug: "a/b" } }),
    ).toEqual({ ok: false, error: "invalid slug" });
    expect(
      validateReport({ tokenHeader: "secret-token", expectedToken: "secret-token", body: { ...base, platform: "weibo" } }),
    ).toEqual({ ok: false, error: "unknown platform" });
    expect(
      validateReport({ tokenHeader: "secret-token", expectedToken: "secret-token", body: { ...base, stage: "nope" } }),
    ).toEqual({ ok: false, error: "invalid body" });
    expect(
      validateReport({ tokenHeader: "secret-token", expectedToken: "secret-token", body: { ...base, ok: "yes" } }),
    ).toEqual({ ok: false, error: "invalid body" });
    expect(
      validateReport({
        tokenHeader: "secret-token",
        expectedToken: "secret-token",
        body: { slug: "demo", platform: "csdn", stage: "publish", ok: false, reason: "未找到发布按钮" },
      }),
    ).toEqual({
      ok: true,
      report: { slug: "demo", platform: "csdn", stage: "publish", ok: false, reason: "未找到发布按钮" },
    });
  });
});

describe("bridge http", () => {
  it("binds 127.0.0.1 and rejects missing token, unknown platform, then enqueues a valid push", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    expect(handle.address).toBe("127.0.0.1");

    const missing = await post(handle.port, "/push", { platform: "x", title: "t", markdown: "m" });
    expect(missing.status).toBe(401);
    expect(missing.json).toEqual({ ok: false, error: "missing token" });

    const unknown = await post(
      handle.port,
      "/push",
      { platform: "weibo", title: "t", markdown: "m" },
      "secret-token",
    );
    expect(unknown.status).toBe(400);
    expect(unknown.json).toEqual({ ok: false, error: "unknown platform" });

    const paired = await post(handle.port, "/pair", {});
    expect(paired.json).toEqual({ ok: false, error: "missing token" });

    const okPair = await post(handle.port, "/pair", { token: "secret-token" });
    expect(okPair.json).toEqual({ ok: true, port: handle.port });

    const pushed = await post(
      handle.port,
      "/push",
      {
        platform: "csdn",
        title: "标题",
        markdown: "hello",
        images: [{ name: "a.png", mime: "image/png", data: "AAAA" }],
      },
      "secret-token",
    );
    expect(pushed.json).toEqual({ ok: true });

    const first = await pending(handle.port, "secret-token");
    expect(first.json.ok).toBe(true);
    expect(first.json.items).toHaveLength(1);
    expect(first.json.items?.[0]).toMatchObject({
      platform: "csdn",
      title: "标题",
      markdown: "hello",
      images: [{ name: "a.png", mime: "image/png", data: "AAAA" }],
    });
    expect(first.json.items?.[0]).toHaveProperty("enqueuedAt");
    const second = await pending(handle.port, "secret-token");
    expect(second.json).toEqual({ ok: true, items: [] });
  });

  it("does not clear the queue when /pending has no token", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    await post(handle.port, "/push", { platform: "x", title: "t", markdown: "m" }, "secret-token");
    const denied = await pending(handle.port);
    expect(denied.json).toEqual({ ok: false, error: "missing token" });
    const kept = await pending(handle.port, "secret-token");
    expect(kept.json.items).toHaveLength(1);
  });

  it("takes a fill report over HTTP and hands it to onReport", async () => {
    const reports: FillReport[] = [];
    const handle = await startBridge("secret-token", undefined, {
      onReport: (report) => reports.push(report),
    });
    handles.push(handle);

    const denied = await post(handle.port, "/report", { slug: "demo", platform: "x", stage: "fill", ok: true });
    expect(denied.status).toBe(401);
    expect(denied.json).toEqual({ ok: false, error: "missing token" });

    const badSlug = await post(
      handle.port,
      "/report",
      { slug: "", platform: "x", stage: "fill", ok: true },
      "secret-token",
    );
    expect(badSlug.status).toBe(400);
    expect(badSlug.json).toEqual({ ok: false, error: "invalid slug" });

    const ok = await post(
      handle.port,
      "/report",
      { slug: "demo", platform: "x", stage: "fill", ok: false, reason: "未找到 X 发帖输入框" },
      "secret-token",
    );
    expect(ok.json).toEqual({ ok: true });
    expect(reports).toEqual([
      { slug: "demo", platform: "x", stage: "fill", ok: false, reason: "未找到 X 发帖输入框" },
    ]);
  });
});

describe("plugin token", () => {
  it("stores the token on data.json and can regenerate it", async () => {
    let saved: unknown = { kept: true };
    const store = {
      async loadData() {
        return saved;
      },
      async saveData(data: unknown) {
        saved = data;
      },
    };
    const token = await ensureBridgeToken(store);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(saved).toEqual({ kept: true, bridgeToken: token });
    expect(await ensureBridgeToken(store)).toBe(token);

    const next = await regenerateBridgeToken(store);
    expect(next).not.toBe(token);
    expect(saved).toEqual({ kept: true, bridgeToken: next });
  });
});
