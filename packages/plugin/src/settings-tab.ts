import { Notice, PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import {
  ACCOUNT_FIELDS,
  bridgeListenLabel,
  importPublishAccounts,
  loadAccounts,
  loadAutoPublish,
  loadTg,
  saveAccounts,
  saveAutoPublish,
  saveTg,
  type AutoPublishSettings,
  type TgSettings,
} from "./settings";

export class AccountSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: Plugin,
    private readonly listenPort: () => number | null = () => null,
  ) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const address = bridgeListenLabel(this.listenPort());
    new Setting(containerEl)
      .setName("桥地址")
      .setDesc("扩展配对时填写这个地址。只读。令牌仍用命令「复制配对令牌」。")
      .addText((text) => {
        text.setValue(address);
        text.setDisabled(true);
        text.inputEl.readOnly = true;
      });
    containerEl.createEl("h2", { text: "平台账号" });
    containerEl.createEl("p", { text: "这些标识只作对照，不代替浏览器登录。" });
    void this.drawFields();
    containerEl.createEl("h2", { text: "自动发布" });
    containerEl.createEl("p", {
      text: "默认关闭。开启后，扩展在填入草稿后会直接点击对应平台的发布按钮，发布后无法撤回。请确认浏览器里已登录对应平台，并自行承担发布责任。",
    });
    void this.drawAutoPublish();
    void this.drawTg();
  }

  private async drawAutoPublish(): Promise<void> {
    const settings: AutoPublishSettings = await loadAutoPublish(this.host);
    const { containerEl } = this;
    new Setting(containerEl)
      .setName("自动发布总开关")
      .setDesc(settings.enabled ? "已开启：勾选的平台会在填入后自动发布。" : "已关闭：所有平台只填入草稿，不点发布。")
      .addToggle((toggle) => {
        toggle.setValue(settings.enabled).onChange((value) => {
          settings.enabled = value;
          void saveAutoPublish(this.host, settings).then(() => this.display());
        });
      });
    for (const field of ACCOUNT_FIELDS) {
      new Setting(containerEl)
        .setName(field.label)
        .setDesc(settings.enabled ? "开启后该平台自动发布。" : "先打开总开关才能设置。")
        .addToggle((toggle) => {
          toggle.setValue(settings.platforms[field.id]).setDisabled(!settings.enabled).onChange((value) => {
            settings.platforms[field.id] = value;
            void saveAutoPublish(this.host, settings);
          });
        });
    }
  }

  private async drawFields(): Promise<void> {
    const accounts = await loadAccounts(this.host);
    const { containerEl } = this;
    for (const field of ACCOUNT_FIELDS) {
      new Setting(containerEl)
        .setName(field.label)
        .addText((text) => {
          text.setValue(accounts[field.id] ?? "").onChange((value) => {
            const trimmed = value.trim();
            if (trimmed) accounts[field.id] = trimmed;
            else delete accounts[field.id];
            void saveAccounts(this.host, accounts);
          });
        });
    }
    new Setting(containerEl)
      .setName("从 publish-accounts 导入")
      .setDesc("wiki/entities/publish-accounts.md")
      .addButton((button) => {
        button.setButtonText("从 publish-accounts 导入").onClick(() => {
          void this.importAccounts();
        });
      });
  }

  private async importAccounts(): Promise<void> {
    try {
      const imported = await importPublishAccounts(this.app.vault);
      const current = await loadAccounts(this.host);
      await saveAccounts(this.host, { ...current, ...imported });
      new Notice("已从 publish-accounts 导入");
      this.display();
    } catch (err) {
      const message = err instanceof Error ? err.message : "导入失败";
      new Notice(message);
    }
  }

  private async drawTg(): Promise<void> {
    const settings: TgSettings = await loadTg(this.host);
    const { containerEl } = this;
    containerEl.createEl("h2", { text: "TG 频道" });
    containerEl.createEl("p", {
      text: "OD 精讲通过 Bot API 直发 TG 频道。Token 与频道 ID 只存在本机插件数据里，不进库、不进 git。需自建 bot 并拉入频道设为管理员。",
    });
    new Setting(containerEl)
      .setName("Bot Token")
      .setDesc("格式 <token>，仅本机存储，不写出库文件。")
      .addText((text) => {
        text.setValue(settings.token ?? "").onChange((value) => {
          settings.token = value;
          void saveTg(this.host, settings);
        });
      });
    new Setting(containerEl)
      .setName("频道 ID")
      .setDesc("频道的 chat_id 或 @username。")
      .addText((text) => {
        text.setValue(settings.chatId ?? "").onChange((value) => {
          settings.chatId = value;
          void saveTg(this.host, settings);
        });
      });
  }
}
