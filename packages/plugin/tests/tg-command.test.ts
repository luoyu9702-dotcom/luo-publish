import { describe, expect, it } from "vitest";
import type { Plugin, TFile, Vault } from "obsidian";
import { testNotices } from "obsidian";
import { TG_COMMAND_NAME, registerSendTgCommand } from "../src/commands";

type Stored = { kind: "file"; text?: string } | { kind: "folder" };

function fakeVault(initial: Record<string, Stored> = {}) {
  const files = new Map<string, Stored>(Object.entries(initial));
  const vault = {
    getAbstractFileByPath(filePath: string) {
      const hit = files.get(filePath);
      return hit ? { path: filePath, kind: hit.kind } : null;
    },
    async read(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || hit.text === undefined) throw new Error(`no text ${file.path}`);
      return hit.text;
    },
  };
  return { files, vault: vault as unknown as Vault };
}

function harness(vault: Vault, file: TFile | null, store: { data: unknown }) {
  const commands: { id: string; name: string; callback: () => Promise<void> | void }[] = [];
  const plugin = {
    app: { vault, workspace: { getActiveFile: () => file } },
    async loadData() {
      return store.data;
    },
    async saveData(data: unknown) {
      store.data = data;
    },
    addCommand(command: { id: string; name: string; callback: () => Promise<void> | void }) {
      commands.push(command);
    },
  };
  return { commands, plugin: plugin as unknown as Plugin };
}

const active = { path: "Notes/foo.md", basename: "foo", extension: "md" } as TFile;

describe("发送到 TG 频道", () => {
  it("registers send-tg as 发送到 TG 频道", () => {
    const { vault } = fakeVault();
    const { commands, plugin } = harness(vault, null, { data: {} });
    registerSendTgCommand(plugin);
    expect(commands.map((command) => command.name)).toEqual([TG_COMMAND_NAME]);
  });

  it("stops with a notice when the task has no tg.md", async () => {
    testNotices.splice(0, testNotices.length);
    const { vault } = fakeVault({ "raw/outbox/foo/csdn.md": { kind: "file", text: "x" } });
    const { commands, plugin } = harness(vault, active, { data: {} });
    registerSendTgCommand(plugin);
    await commands[0]?.callback();
    expect(testNotices).toEqual(["当前任务无 tg.md（仅 OD 任务生成，请先创建 OD 分发任务）"]);
  });

  it("stops with a notice when TG is not configured", async () => {
    testNotices.splice(0, testNotices.length);
    const tgMd = "---\nplatform: tg\nslug: \"foo\"\ntitle: \"标题\"\n---\n\n正文内容\n";
    const { vault } = fakeVault({ "raw/outbox/foo/tg.md": { kind: "file", text: tgMd } });
    const { commands, plugin } = harness(vault, active, { data: {} });
    registerSendTgCommand(plugin);
    await commands[0]?.callback();
    expect(testNotices).toEqual(["未配置 TG Bot Token 或频道 ID，请在插件设置填写"]);
  });
});
