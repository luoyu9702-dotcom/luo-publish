import { Notice, PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import {
  ACCOUNT_FIELDS,
  bridgeListenLabel,
  importPublishAccounts,
  loadAccounts,
  loadAutoPublish,
  saveAccounts,
  saveAutoPublish,
  type AutoPublishSettings,
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
}
