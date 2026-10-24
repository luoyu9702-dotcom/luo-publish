import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { openedModals, testNotices, type Plugin, type TFile, type Vault } from "obsidian";
import { startBridge, type BridgeHandle } from "../src/bridge-server";
import {
  PUBLISH_ALL_COMMAND_ID,
  PUBLISH_ALL_COMMAND_NAME,
  PublishConfirmModal,
  publishConfirmText,
  registerPublishAllCommand,
} from "../src/commands";
import { PLATFORMS } from "../src/outbox";
import { loadQueue } from "../src/queue-store";
import { DEFAULT_AUTO_PUBLISH, type AutoPublishSettings } from "../src/settings";
import { buildSourceSummary } from "../src/vault-io";

const handles: BridgeHandle[] = [];
const roots: string[] = [];

afterEach(async () => {
  testNotices.splice(0, testNotices.length);
  openedModals.splice(0, openedModals.length);
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
      if (parent && !files.has(parent)) throw new Error(`missing parent ${filePath}`);
      files.set(filePath, { kind: "folder" });
      return { path: filePath };
    },
    async create(filePath: string, data: string) {
      if (files.has(filePath)) throw new Error(`exists ${filePath}`);
      const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${filePath}`);
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
  const root = mkdtempSync(path.join(tmpdir(), "luo-publish-all-"));
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

function autoPublish(enabled: boolean, on: string[] = []): () => AutoPublishSettings {
  const settings: AutoPublishSettings = {
    enabled,
    platforms: {
      x: on.includes("x"),
      xiaohongshu: on.includes("xiaohongshu"),
      bilibili: on.includes("bilibili"),
      csdn: on.includes("csdn"),
    },
  };
  return () => settings;
}

async function setup(text = "# 标题\n\nhello\n") {
  const root = tempRoot();
  ingestLayout(root);
  const queuePath = path.join(root, "plugin", "data", "push-queue.json");
  const handle = await startBridge("secret-token", queuePath);
  handles.push(handle);
  const { file, stored } = activeNote(text);
  const { files, vault } = fakeVault(root, stored);
  const { commands, plugin } = harness(vault, file);
  registerPublishAllCommand(plugin, async () => ({ port: handle.port, token: "secret-token" }), autoPublish(true, ["x", "xiaohongshu"]));
  return { commands, files, queuePath, vault };
}

describe("一键发布", () => {
  it("registers one-click-publish as 一键发布", () => {
    const root = tempRoot();
    const { vault } = fakeVault(root);
    const { commands, plugin } = harness(vault, null);
    registerPublishAllCommand(plugin, async () => null, autoPublish(false));
    expect(commands.map((command) => command.id)).toEqual([PUBLISH_ALL_COMMAND_ID]);
    expect(commands.map((command) => command.name)).toEqual([PUBLISH_ALL_COMMAND_NAME]);
    expect(PUBLISH_ALL_COMMAND_ID).toBe("one-click-publish");
    expect(PUBLISH_ALL_COMMAND_NAME).toBe("一键发布");
  });

  it("writes confirm copy that names the auto-published and fill-only platforms", () => {
    expect(publishConfirmText("foo", ["x", "xiaohongshu"], ["bilibili", "csdn"])).toBe(
      ["将处理「foo」：", "自动发布：X、小红书", "仅填入草稿：B站专栏、CSDN", "发布后无法撤回，确认继续？"].join("\n"),
    );
    expect(publishConfirmText("foo", [], ["x", "xiaohongshu", "bilibili", "csdn"])).toContain("自动发布：无");
  });

  it("stops with 请先入库当前笔记 when the note was never ingested", async () => {
    const root = tempRoot();
    const queuePath = path.join(root, "plugin", "data", "push-queue.json");
    const handle = await startBridge("secret-token", queuePath);
    handles.push(handle);
    const { file, stored } = activeNote("# 标题\n\nhello\n");
    const { files, vault } = fakeVault(root, stored);
    const { commands, plugin } = harness(vault, file);
    registerPublishAllCommand(plugin, async () => ({ port: handle.port, token: "secret-token" }), autoPublish(true, ["x"]));

    await commands[0]?.callback();

    expect(testNotices).toEqual(["请先入库当前笔记"]);
    expect(files.has("raw/outbox/foo/status.json")).toBe(false);
    expect(loadQueue(queuePath)).toEqual([]);
  });

  it("stops when no platform has auto-publish on", async () => {
    const root = tempRoot();
    ingestLayout(root);
    const queuePath = path.join(root, "plugin", "data", "push-queue.json");
    const handle = await startBridge("secret-token", queuePath);
    handles.push(handle);
    const { file, stored } = activeNote("# 标题\n\nhello\n");
    const { files, vault } = fakeVault(root, stored);
    const { commands, plugin } = harness(vault, file);
    registerPublishAllCommand(plugin, async () => ({ port: handle.port, token: "secret-token" }), autoPublish(false));

    await commands[0]?.callback();

    expect(testNotices).toEqual(["尚未开启自动发布。请在插件设置里打开「自动发布总开关」并勾选平台。"]);
    expect(openedModals).toHaveLength(0);
    expect(files.has("raw/outbox/foo/status.json")).toBe(false);
    expect(loadQueue(queuePath)).toEqual([]);
  });

  it("asks for confirmation, then queues all four platforms with the auto-publish flags", async () => {
    const { commands, files, queuePath } = await setup();

    await commands[0]?.callback();

    // The outbox exists but nothing is queued until the user confirms.
    expect(files.has("raw/outbox/foo/status.json")).toBe(true);
    expect(loadQueue(queuePath)).toEqual([]);
    expect(openedModals).toHaveLength(1);

    await (openedModals[0] as unknown as PublishConfirmModal).confirm();

    const queued = loadQueue(queuePath);
    expect(queued.map((item) => item.platform)).toEqual([...PLATFORMS]);
    expect(queued.map((item) => item.autoPublish)).toEqual([true, true, undefined, undefined]);
    expect(testNotices[0]).toBe(
      "已加入浏览器队列 foo（X、小红书、B站专栏、CSDN）。X、小红书 将由扩展自动发布，其余仅填入草稿。",
    );
    // The B站 body is under 200 characters, so the shaping note follows the queue notice.
    expect(testNotices).toHaveLength(2);
    expect(testNotices[1]).toContain("正文不足 200 字");

    const status = files.get("raw/outbox/foo/status.json");
    if (status?.kind === "file") {
      expect(JSON.parse(status.text ?? "")).toEqual({
        x: "queued",
        xiaohongshu: "queued",
        bilibili: "queued",
        csdn: "queued",
        source: "Notes/foo.md",
      });
    }
  });

  it("queues nothing when the user cancels the confirmation", async () => {
    const { commands, queuePath } = await setup();

    await commands[0]?.callback();

    expect(openedModals).toHaveLength(1);
    await (openedModals[0] as unknown as PublishConfirmModal).close();

    expect(loadQueue(queuePath)).toEqual([]);
    expect(testNotices).toEqual([]);
  });
});
