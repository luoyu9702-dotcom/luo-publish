import { afterEach, describe, expect, it } from "vitest";
import type { Plugin, Vault } from "obsidian";
import { startBridge, type BridgeHandle } from "../src/bridge-server";
import { registerStatusCommands } from "../src/commands";
import { buildOutbox, initialStatus, writeOutbox } from "../src/outbox";
import {
  applyFillReport,
  draftToPush,
  listOutboxSlugs,
  markPublished,
  markQueued,
  parseStatus,
  pushDraft,
  readStatus,
  statusLines,
  suggestPlatforms,
  suggestSlugs,
} from "../src/status";

const handles: BridgeHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

type Stored = { kind: "file"; text?: string } | { kind: "folder" };

function fakeVault(initial: Record<string, Stored> = {}) {
  const files = new Map<string, Stored>(Object.entries(initial));
  const vault = {
    getAbstractFileByPath(path: string) {
      const hit = files.get(path);
      return hit ? { path, kind: hit.kind } : null;
    },
    async createFolder(path: string) {
      if (files.has(path)) throw new Error(`exists ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(path, { kind: "folder" });
      return { path };
    },
    async create(path: string, data: string) {
      if (files.has(path)) throw new Error(`exists ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(path, { kind: "file", text: data });
      return { path };
    },
    async read(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || hit.text === undefined) throw new Error(`no text ${file.path}`);
      return hit.text;
    },
    async modify(file: { path: string }, data: string) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file") throw new Error(`no text ${file.path}`);
      files.set(file.path, { kind: "file", text: data });
    },
  };
  return { files, vault: vault as unknown as Vault };
}

describe("outbox status", () => {
  it("reads a draft title and body for the bridge payload", () => {
    const drafts = buildOutbox("demo", "hello", "标题");
    expect(draftToPush("csdn", drafts.csdn)).toEqual({
      platform: "csdn",
      title: "标题",
      markdown: "hello\n",
    });
    expect(draftToPush("x", drafts.x)).toEqual({
      platform: "x",
      title: "标题",
      markdown: "hello\n",
    });
    expect(draftToPush("x", drafts.x, "demo")).toMatchObject({ platform: "x", slug: "demo" });
    expect(draftToPush("x", `${drafts.x}\n![图](a.png)\n`)).toMatchObject({
      imagePaths: ["a.png"],
    });
  });

  it("lists outbox slugs and filters slug or platform labels", () => {
    expect(
      listOutboxSlugs([
        "raw/outbox/zeta/status.json",
        "raw/outbox/zeta/x.md",
        "raw/outbox/alpha/status.json",
        "wiki/status.json",
      ]),
    ).toEqual(["alpha", "zeta"]);
    expect(suggestSlugs(["alpha", "zeta"], "ze")).toEqual(["zeta"]);
    expect(suggestPlatforms("公众")).toEqual([]);
    expect(suggestPlatforms("小红")).toEqual(["xiaohongshu"]);
    expect(suggestPlatforms("csdn")).toEqual(["csdn"]);
    expect(suggestPlatforms("")).toEqual(["x", "xiaohongshu", "bilibili", "csdn"]);
  });

  it("marks one platform published and leaves the others generated", async () => {
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");
    const next = await markPublished(vault, "demo", "bilibili");
    expect(next.bilibili).toBe("published");
    expect(next.x).toBe("generated");
    const stored = files.get("raw/outbox/demo/status.json");
    expect(stored?.kind).toBe("file");
    if (stored?.kind === "file") {
      expect(JSON.parse(stored.text ?? "")).toEqual({ ...initialStatus(), bilibili: "published" });
    }
  });

  it("refuses a missing outbox", async () => {
    const { vault } = fakeVault();
    await expect(markPublished(vault, "missing", "x")).rejects.toThrow(/未找到/);
  });

  it("enqueues on the localhost bridge and marks that platform filled", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");

    await expect(pushDraft(vault, "demo", "csdn", { port: handle.port, token: "wrong" })).rejects.toThrow(/推送失败/);
    const unchanged = files.get("raw/outbox/demo/status.json");
    if (unchanged?.kind === "file") expect(JSON.parse(unchanged.text ?? "")).toEqual(initialStatus());

    await pushDraft(vault, "demo", "csdn", { port: handle.port, token: "secret-token" });
    const filled = files.get("raw/outbox/demo/status.json");
    if (filled?.kind !== "file") throw new Error("missing status");
    expect(JSON.parse(filled.text ?? "")).toEqual({ ...initialStatus(), csdn: "filled" });

    const res = await fetch(`http://127.0.0.1:${handle.port}/pending`, {
      headers: { "x-luo-token": "secret-token" },
    });
    const body = (await res.json()) as { ok: boolean; items: Array<{ platform: string; title: string; markdown: string }> };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ platform: "csdn", title: "标题", markdown: "hello\n" });

    const again = await fetch(`http://127.0.0.1:${handle.port}/pending`, {
      headers: { "x-luo-token": "secret-token" },
    });
    const cleared = (await again.json()) as { items: unknown[] };
    expect(cleared.items).toEqual([]);
  });
});

describe("draft status enum", () => {
  it("accepts generated, queued, filled, published, and failed", () => {
    expect(
      parseStatus(
        JSON.stringify({
          x: "failed",
          xiaohongshu: "queued",
          bilibili: "published",
          csdn: "filled",
        }),
      ),
    ).toEqual({
      x: "failed",
      xiaohongshu: "queued",
      bilibili: "published",
      csdn: "filled",
    });
  });

  it("ignores unknown keys and invalid state values instead of throwing", () => {
    const status = parseStatus(JSON.stringify({ ...initialStatus(), x: "sent", weird: "queued" }));
    expect(status.x).toBe("generated"); // invalid value ignored, default state kept
    expect((status as Record<string, string>).weird).toBeUndefined(); // unknown key ignored
  });

  it("markQueued writes queued and leaves the other platforms generated", async () => {
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");
    const next = await markQueued(vault, "demo", "x");
    expect(next).toEqual({ ...initialStatus(), x: "queued" });
    const stored = files.get("raw/outbox/demo/status.json");
    if (stored?.kind !== "file") throw new Error("missing status");
    expect(parseStatus(stored.text ?? "")).toEqual(next);
  });

  it("pushDraft writes queued for the one-click path and filled by default", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");
    const endpoint = { port: handle.port, token: "secret-token" };

    const queued = await pushDraft(vault, "demo", "xiaohongshu", endpoint, "queued");
    expect(queued.xiaohongshu).toBe("queued");
    expect(queued.x).toBe("generated");

    const filled = await pushDraft(vault, "demo", "csdn", endpoint);
    expect(filled.csdn).toBe("filled");
    expect(filled.xiaohongshu).toBe("queued");

    const stored = files.get("raw/outbox/demo/status.json");
    if (stored?.kind !== "file") throw new Error("missing status");
    expect(parseStatus(stored.text ?? "")).toEqual(filled);
  });
});

describe("status commands", () => {
  it("registers 推送到浏览器草稿 and 标记已发布", () => {
    const commands: { id: string; name: string }[] = [];
    const plugin = {
      addCommand(command: { id: string; name: string }) {
        commands.push(command);
      },
    };
    registerStatusCommands(plugin as unknown as Plugin, async () => null);
    expect(commands.map((command) => command.name)).toEqual(["推送到浏览器草稿", "标记已发布"]);
    expect(commands.map((command) => command.id)).toEqual(["push-draft", "mark-published"]);
  });
});

describe("fill reports", () => {
  it("writes filled, failed, and published from extension reports", async () => {
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");

    const filled = await applyFillReport(vault, { slug: "demo", platform: "csdn", stage: "fill", ok: true });
    expect(filled.csdn).toBe("filled");
    expect(filled.x).toBe("generated");

    const failed = await applyFillReport(vault, {
      slug: "demo",
      platform: "x",
      stage: "fill",
      ok: false,
      reason: "未找到 X 发帖输入框",
    });
    expect(failed.x).toBe("failed");

    const published = await applyFillReport(vault, { slug: "demo", platform: "csdn", stage: "publish", ok: true });
    expect(published.csdn).toBe("published");

    // A failed publish keeps the draft filled, because it is still in the editor.
    const publishFailed = await applyFillReport(vault, { slug: "demo", platform: "bilibili", stage: "fill", ok: true });
    expect(publishFailed.bilibili).toBe("filled");
    await applyFillReport(vault, { slug: "demo", platform: "bilibili", stage: "publish", ok: false });
    expect((await readStatus(vault, "demo")).bilibili).toBe("filled");

    const stored = files.get("raw/outbox/demo/status.json");
    if (stored?.kind !== "file") throw new Error("missing status");
    expect(parseStatus(stored.text ?? "")).toEqual({
      x: "failed",
      xiaohongshu: "generated",
      bilibili: "filled",
      csdn: "published",
    });
  });

  it("keeps unknown platform keys when rewriting the status", async () => {
    const { files, vault } = fakeVault({
      raw: { kind: "folder" },
      "raw/outbox": { kind: "folder" },
      "raw/outbox/demo": { kind: "folder" },
      "raw/outbox/demo/status.json": {
        kind: "file",
        text: `${JSON.stringify({ ...initialStatus(), mastodon: "queued" }, null, 2)}\n`,
      },
    });
    const next = await markPublished(vault, "demo", "x");
    expect(next.x).toBe("published");
    const stored = files.get("raw/outbox/demo/status.json");
    if (stored?.kind !== "file") throw new Error("missing status");
    expect(JSON.parse(stored.text ?? "")).toEqual({ ...initialStatus(), x: "published", mastodon: "queued" });
  });

  it("renders one status line per platform", async () => {
    const { vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");
    await applyFillReport(vault, { slug: "demo", platform: "x", stage: "fill", ok: true });
    expect(statusLines(await readStatus(vault, "demo"))).toEqual([
      "X：已填入",
      "小红书：已生成",
      "B站专栏：已生成",
      "CSDN：已生成",
    ]);
  });
});
