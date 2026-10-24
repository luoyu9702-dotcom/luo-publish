import { afterEach, describe, expect, it } from "vitest";
import { startBridge, type BridgeHandle } from "../../plugin/src/bridge-server";
import { normalizeBridgeBase, requestPair, requestPending } from "../src/pairing";

const handles: BridgeHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

describe("normalizeBridgeBase", () => {
  it("accepts only http://127.0.0.1 with a port", () => {
    expect(normalizeBridgeBase("http://127.0.0.1:43123")).toBe("http://127.0.0.1:43123");
    expect(normalizeBridgeBase("127.0.0.1:43123")).toBe("http://127.0.0.1:43123");
    expect(normalizeBridgeBase("43123")).toBe("http://127.0.0.1:43123");
    expect(normalizeBridgeBase("http://localhost:43123")).toBeNull();
    expect(normalizeBridgeBase("https://127.0.0.1:43123")).toBeNull();
    expect(normalizeBridgeBase("http://127.0.0.1:43123/pair")).toBeNull();
    expect(normalizeBridgeBase("http://example.com:43123")).toBeNull();
  });
});

describe("bridge client", () => {
  it("pairs and pulls the pending queue", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    const base = `http://127.0.0.1:${handle.port}`;

    expect(await requestPair(base, "")).toEqual({ ok: false, error: "missing token" });
    expect(await requestPair(base, "secret-token")).toEqual({ ok: true, port: handle.port });

    const pushed = await fetch(`${base}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-luo-token": "secret-token" },
      body: JSON.stringify({ platform: "x", title: "标题", markdown: "hello" }),
    });
    expect(await pushed.json()).toEqual({ ok: true });

    const pending = await requestPending(base, "secret-token");
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.items).toHaveLength(1);
      expect(pending.items[0]).toMatchObject({ platform: "x", title: "标题", markdown: "hello" });
      expect(pending.items[0]).toHaveProperty("enqueuedAt");
    }
    expect(await requestPending(base, "secret-token")).toEqual({ ok: true, items: [] });
  });
});
