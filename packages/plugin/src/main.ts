import { join } from "path";
import { Notice, Plugin } from "obsidian";
import { ensureBridgeToken, regenerateBridgeToken, startBridge, type BridgeHandle } from "./bridge-server";
import {
  registerDistributeCommand,
  registerFallbackCommand,
  registerIngestCommand,
  registerOutboxCommand,
  registerOutboxOdCommand,
  registerPublishAllCommand,
  registerSendTgCommand,
  registerStatusCommands,
  registerStatusViewCommand,
} from "./commands";
import { copyAndOpenDraft } from "./fallback";
import type { Platform } from "./outbox";
import { queueFilePath } from "./queue-store";
import { applyFillReport } from "./status";
import { loadAutoPublish } from "./settings";
import { AccountSettingTab } from "./settings-tab";

function bridgeQueuePath(plugin: Plugin): string {
  const adapter = plugin.app.vault.adapter as { getBasePath?: () => string };
  const base = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
  const pluginDir = plugin.manifest.dir ?? join(".obsidian", "plugins", "luo-publish");
  return queueFilePath(base ? join(base, pluginDir) : pluginDir);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Desktop Obsidian can copy through Electron when the web clipboard is blocked.
  }
  const electron = require("electron") as { clipboard: { writeText(value: string): void } };
  electron.clipboard.writeText(text);
}

function openComposeUrl(url: string): void {
  try {
    const opened = window.open(url, "_blank");
    if (opened) return;
  } catch {
    // Desktop Obsidian can block window.open. Electron opens the editor instead.
  }
  const electron = require("electron") as { shell: { openExternal(target: string): void } };
  electron.shell.openExternal(url);
}

export default class LuoPublishPlugin extends Plugin {
  private bridge: BridgeHandle | null = null;

  async onload() {
    this.addCommand({
      id: "luo-ping",
      name: "Luo Publish: Ping",
      callback: () => new Notice("luo-publish ok"),
    });
    registerIngestCommand(this);
    registerOutboxCommand(this);
    this.addSettingTab(new AccountSettingTab(this.app, this, () => this.bridge?.port ?? null));

    try {
      const token = await ensureBridgeToken(this);
      const bridge = await startBridge(token, bridgeQueuePath(this), {
        onReport: (report) => {
          void applyFillReport(this.app.vault, report).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : "状态回流失败";
            new Notice(`状态回流失败：${message}`);
          });
        },
      });
      this.bridge = bridge;
      new Notice(`桥已监听 127.0.0.1:${bridge.port}。使用「复制配对令牌」复制令牌。`, 10_000);
      this.addCommand({
        id: "copy-pairing-token",
        name: "复制配对令牌",
        callback: () => {
          void this.copyPairingToken();
        },
      });
      this.addCommand({
        id: "regenerate-pairing-token",
        name: "重新生成配对令牌",
        callback: () => {
          void this.rotatePairingToken();
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "桥启动失败";
      new Notice(`桥启动失败：${message}`);
    }

    const copyOpen = async (slug: string, platform: Platform): Promise<void> => {
      await copyAndOpenDraft(this.app.vault, slug, platform, { copy: copyText, open: openComposeUrl });
    };
    const endpoint = async () => {
      if (!this.bridge) return null;
      const token = await ensureBridgeToken(this);
      return { port: this.bridge.port, token };
    };
    registerFallbackCommand(this, copyOpen);
    registerStatusCommands(this, endpoint, copyOpen);
    registerDistributeCommand(this, endpoint);
    registerPublishAllCommand(this, endpoint, () => loadAutoPublish(this));
    registerStatusViewCommand(this);
    registerOutboxOdCommand(this);
    registerSendTgCommand(this);
  }

  onunload() {
    void this.bridge?.stop();
    this.bridge = null;
  }

  private async copyPairingToken(): Promise<void> {
    try {
      const token = await ensureBridgeToken(this);
      await copyText(token);
      new Notice("已复制配对令牌");
    } catch (err) {
      const message = err instanceof Error ? err.message : "复制失败";
      new Notice(`复制配对令牌失败：${message}`);
    }
  }

  private async rotatePairingToken(): Promise<void> {
    const token = await regenerateBridgeToken(this);
    this.bridge?.setToken(token);
    new Notice("已重新生成配对令牌");
  }
}
