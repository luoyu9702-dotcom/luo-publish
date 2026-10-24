import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startBridge, type BridgeHandle } from "../src/bridge-server";
import { drain, enqueue, loadQueue, queueFilePath, saveQueue, type QueueItem } from "../src/queue-store";

const dirs: string[] = [];
const handles: BridgeHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempQueueFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "luo-queue-"));
  dirs.push(dir);
  return path.join(dir, "data", "push-queue.json");
}

const first: QueueItem = {
  platform: "csdn",
  title: "标题",
  markdown: "hello",
  images: [{ name: "a.png", mime: "image/png", data: "AAAA" }],
  enqueuedAt: "2026-10-23T00:00:00.000Z",
};
const second: QueueItem = {
  platform: "x",
  title: "t",
  markdown: "m",
  enqueuedAt: "2026-10-23T00:01:00.000Z",
};

describe("disk queue", () => {
  it("places the file under the plugin data directory", () => {
    expect(queueFilePath("/vault/.obsidian/plugins/luo-publish")).toBe(
      path.join("/vault/.obsidian/plugins/luo-publish", "data", "push-queue.json"),
    );
  });

  it("enqueues and reloads the same items from the file", () => {
    const file = tempQueueFile();
    expect(loadQueue(file)).toEqual([]);
    enqueue(file, first);
    enqueue(file, second);
    expect(loadQueue(file)).toEqual([first, second]);
    saveQueue(file, [second]);
    expect(loadQueue(file)).toEqual([second]);
  });

  it("drains every item and leaves the file empty", () => {
    const file = tempQueueFile();
    enqueue(file, first);
    enqueue(file, second);
    expect(drain(file)).toEqual([first, second]);
    expect(loadQueue(file)).toEqual([]);
    expect(drain(file)).toEqual([]);
  });

  it("keeps slug and autoPublish and drops an item with a bad slug", () => {
    const file = tempQueueFile();
    enqueue(file, { ...first, slug: "demo", autoPublish: true });
    enqueue(file, { ...second, slug: "demo" });
    expect(loadQueue(file)).toEqual([
      { ...first, slug: "demo", autoPublish: true },
      { ...second, slug: "demo" },
    ]);

    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify([{ ...second, slug: "../escape" }])}\n`, "utf8");
    expect(loadQueue(file)).toEqual([]);
  });

  it("backs up a corrupt file and starts an empty queue", () => {
    const file = tempQueueFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{not json", "utf8");
    expect(loadQueue(file)).toEqual([]);
    expect(readFileSync(`${file}.bak`, "utf8")).toBe("{not json");
    expect(loadQueue(file)).toEqual([]);
    enqueue(file, first);
    expect(loadQueue(file)).toEqual([first]);
  });
});

describe("bridge queue file", () => {
  it("keeps a push after the server stops and a new process loads the same file", async () => {
    const file = tempQueueFile();
    const firstServer = await startBridge("secret-token", file);
    handles.push(firstServer);
    const pushed = await fetch(`http://127.0.0.1:${firstServer.port}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-luo-token": "secret-token" },
      body: JSON.stringify({ platform: "bilibili", title: "标题", markdown: "hello" }),
    });
    expect(await pushed.json()).toEqual({ ok: true });
    await firstServer.stop();
    handles.pop();

    const stored = loadQueue(file);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ platform: "bilibili", title: "标题", markdown: "hello" });
    expect(stored[0]?.enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const secondServer = await startBridge("secret-token", file);
    handles.push(secondServer);
    const pending = await fetch(`http://127.0.0.1:${secondServer.port}/pending`, {
      headers: { "x-luo-token": "secret-token" },
    });
    const body = (await pending.json()) as { ok: boolean; items: QueueItem[] };
    expect(body.ok).toBe(true);
    expect(body.items).toEqual(stored);
    expect(loadQueue(file)).toEqual([]);
  });
});
