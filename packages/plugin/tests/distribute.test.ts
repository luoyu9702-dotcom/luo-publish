import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { Plugin, TFile, Vault } from "obsidian";
import { testNotices } from "obsidian";
import { startBridge, type BridgeHandle } from "../src/bridge-server";
import { DISTRIBUTE_COMMAND_ID, DISTRIBUTE_COMMAND_NAME, registerDistributeCommand } from "../src/commands";
import { PLATFORMS, writeOutbox } from "../src/outbox";
import { loadQueue } from "../src/queue-store";
import { buildSourceSummary } from "../src/vault-io";

const handles: BridgeHandle[] = [];
const roots: string[] = [];

afterEach(async () => {
  testNotices.splice(0, testNotices.length);
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Stored = { kind: "file"; text?: string } | { kind: "folder" };

function fakeVault(root: string, initial: Record<string, Stored> = {}) {
  const files = new Map<string, Stored>(Object.entries(initial));
  const vault = {
    adapter: { getBasePath: () => root },
    getAbstractFileByPath(filePath: string) {
      const hit = files.get(filePath);
      return hit ? { path: filePath, kind: hit.kind } : null;
    },
    async createFolder(filePath: string) {
      if (files.has(filePath)) throw new Error(`exists ${filePath}`);
      const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(filePath, { kind: "folder" });
      return { path: filePath };
    },
    async create(filePath: string, data: string) {
      if (files.has(filePath)) throw new Error(`exists ${filePath}`);
      const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(filePath, { kind: "file", text: data });
      return { path: filePath };
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

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "luo-distribute-"));
  roots.push(root);
  return root;
}

function activeNote(text: string) {
  const file = { path: "Notes/foo.md", basename: "foo", extension: "md" } as TFile;
  return { file, stored: { "Notes/foo.md": { kind: "file" as const, text } } };
}

function harness(vault: Vault, file: TFile | null) {
  const commands: { id: string; name: string; callback: () => Promise<void> | void }[] = [];
  const plugin = {
    app: {
      vault,
      workspace: { getActiveFile: () => file },
    },
    addCommand(command: { id: string; name: string; callback: () => Promise<void> | void }) {
      commands.push(command);
    },
  };
  return { commands, plugin: plugin as unknown as Plugin };
}

function ingestLayout(root: string): void {
  mkdirSync(path.join(root, "raw", "sources", "inbox"), { recursive: true });
  writeFileSync(path.join(root, "raw", "sources", "inbox", "foo.md"), "# 标题\n\nhello\n", "utf8");
  mkdirSync(path.join(root, "wiki", "sources"), { recursive: true });
  writeFileSync(
    path.join(root, "wiki", "sources", "foo.md"),
    buildSourceSummary({ title: "foo", rawPath: "raw/sources/inbox/foo.md", ingested: "2026-10-24" }),
    "utf8",
  );
}

describe("一键分发", () => {
  it("registers one-click-distribute as 一键分发", () => {
    const root = tempRoot();
    const { vault } = fakeVault(root);
    const { commands, plugin } = harness(vault, null);
    registerDistributeCommand(plugin, async () => null);
    expect(commands.map((command) => command.id)).toEqual([DISTRIBUTE_COMMAND_ID]);
    expect(commands.map((command) => command.name)).toEqual([DISTRIBUTE_COMMAND_NAME]);
    expect(DISTRIBUTE_COMMAND_ID).toBe("one-click-distribute");
    expect(DISTRIBUTE_COMMAND_NAME).toBe("一键分发");
  });

  it("stops with 请先入库当前笔记 when the note was never ingested", async () => {
    const root = tempRoot();
    const queuePath = path.join(root, "plugin", "data", "push-queue.json");
    const handle = await startBridge("secret-token", queuePath);
    handles.push(handle);
    const { file, stored } = activeNote("# 标题\n\nhello\n");
    const { files, vault } = fakeVault(root, stored);
    const { commands, plugin } = harness(vault, file);
    registerDistributeCommand(plugin, async () => ({ port: handle.port, token: "secret-token" }));

    await commands[0]?.callback();

    expect(testNotices).toEqual(["请先入库当前笔记"]);
    expect(files.has("raw/outbox/foo/status.json")).toBe(false);
    expect(loadQueue(queuePath)).toEqual([]);
  });

  it("creates a missing outbox, enqueues four platforms on 127.0.0.1, and marks them queued", async () => {
    const root = tempRoot();
    ingestLayout(root);
    const queuePath = path.join(root, "plugin", "data", "push-queue.json");
    const handle = await startBridge("secret-token", queuePath);
    handles.push(handle);
    const { file, stored } = activeNote("# 标题\n\nhello\n");
    const { files, vault } = fakeVault(root, stored);
    const { commands, plugin } = harness(vault, file);
    registerDistributeCommand(plugin, async () => ({ port: handle.port, token: "secret-token" }));

    await commands[0]?.callback();

    expect(testNotices).toEqual([
      "已加入浏览器队列 foo（X、小红书、B站专栏、CSDN）。在扩展中点「拉取并填入」。",
      "B站专栏：正文不足 200 字，平台可能拒收（需满 200 字或 3 张图），请补充后再发",
    ]);
    const status = files.get("raw/outbox/foo/status.json");
    expect(status?.kind).toBe("file");
    if (status?.kind === "file") {
      expect(JSON.parse(status.text ?? "")).toEqual({
        x: "queued",
        xiaohongshu: "queued",
        bilibili: "queued",
        csdn: "queued",
        source: "Notes/foo.md",
      });
    }
    const storedQueue = loadQueue(queuePath);
    expect(storedQueue.map((item) => item.platform)).toEqual([...PLATFORMS]);
    expect(storedQueue.every((item) => item.title === "标题")).toBe(true);

    const res = await fetch(`http://127.0.0.1:${handle.port}/pending`, {
      headers: { "x-luo-token": "secret-token" },
    });
    const body = (await res.json()) as { ok: boolean; items: Array<{ platform: string }> };
    expect(body.ok).toBe(true);
    expect(body.items.map((item) => item.platform)).toEqual([...PLATFORMS]);
    expect(loadQueue(queuePath)).toEqual([]);
  });

  it("reuses an existing outbox instead of overwriting the drafts", async () => {
    const root = tempRoot();
    ingestLayout(root);
    const queuePath = path.join(root, "plugin", "data", "push-queue.json");
    const handle = await startBridge("secret-token", queuePath);
    handles.push(handle);
    const { file, stored } = activeNote("# 新标题\n\nnew-body\n");
    const { files, vault } = fakeVault(root, stored);
    await writeOutbox(vault, "foo", "original-body", "旧标题");
    const { commands, plugin } = harness(vault, file);
    registerDistributeCommand(plugin, async () => ({ port: handle.port, token: "secret-token" }));

    await commands[0]?.callback();

    const draft = files.get("raw/outbox/foo/x.md");
    expect(draft?.kind).toBe("file");
    if (draft?.kind === "file") {
      expect(draft.text).toContain("original-body");
      expect(draft.text).not.toContain("new-body");
    }
    const status = files.get("raw/outbox/foo/status.json");
    if (status?.kind === "file") {
      expect(JSON.parse(status.text ?? "").x).toBe("queued");
    }
    expect(loadQueue(queuePath).map((item) => item.title)).toEqual(["旧标题", "旧标题", "旧标题", "旧标题"]);
  });
});
