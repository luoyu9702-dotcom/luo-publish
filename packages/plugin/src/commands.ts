import { Modal, Notice, Plugin, SuggestModal, type App, type TFile } from "obsidian";
import { recoverPush } from "./fallback";
import { formatShanghaiStamp, planIngest, type Domain } from "./ingest";
import { findIngestedRawPath } from "./ingest-gate";
import {
  createOutboxFromNote,
  FILLABLE_PLATFORMS,
  PLATFORMS,
  readTaskType,
  slugFromBasename,
  type Platform,
  type TaskType,
} from "./outbox";
import { autoPublishPlatforms, hasTgConfig, loadTg, markTgSent, readTgSent, type AutoPublishSettings } from "./settings";
import { stripFrontmatter } from "./publish-body";
import { sendTgMessage } from "./tg";
import {
  PLATFORM_CHOICES,
  listOutboxSlugs,
  markPublished,
  pushDraft,
  readStatus,
  statusLines,
  suggestPlatforms,
  suggestSlugs,
  type BridgeEndpoint,
} from "./status";
import { appendLog, buildSourceSummary, copyNote, upsertIndex, writeSourceSummary } from "./vault-io";

export const INGEST_COMMAND_ID = "ingest-current-note";
export const INGEST_COMMAND_NAME = "入库当前笔记";
export const OUTBOX_COMMAND_ID = "create-outbox";
export const OUTBOX_COMMAND_NAME = "创建分发任务";
export const OUTBOX_OD_COMMAND_ID = "create-outbox-od";
export const OUTBOX_OD_COMMAND_NAME = "创建 OD 分发任务";
export const PUSH_COMMAND_ID = "push-draft";
export const PUSH_COMMAND_NAME = "推送到浏览器草稿";
export const PUBLISHED_COMMAND_ID = "mark-published";
export const PUBLISHED_COMMAND_NAME = "标记已发布";
export const FALLBACK_COMMAND_ID = "copy-open-compose";
export const FALLBACK_COMMAND_NAME = "复制并打开创作页";
export const DISTRIBUTE_COMMAND_ID = "one-click-distribute";
export const DISTRIBUTE_COMMAND_NAME = "一键分发";
export const PUBLISH_ALL_COMMAND_ID = "one-click-publish";
export const PUBLISH_ALL_COMMAND_NAME = "一键发布";
export const STATUS_VIEW_COMMAND_ID = "view-distribute-status";
export const STATUS_VIEW_COMMAND_NAME = "查看分发状态";
export const TG_COMMAND_ID = "send-tg";
export const TG_COMMAND_NAME = "发送到 TG 频道";

export const DOMAIN_CHOICES: { id: Domain; label: string }[] = [
  { id: "ai-tools", label: "AI 工具" },
  { id: "ai-agents", label: "AI Agent" },
  { id: "quant", label: "量化" },
  { id: "overseas-accounts", label: "海外账号" },
  { id: "digital-human", label: "数字人" },
  { id: "od-exam", label: "OD考试真题" },
  { id: "inbox", label: "收件箱" },
];

export function suggestDomains(query: string): Domain[] {
  const q = query.trim().toLowerCase();
  return DOMAIN_CHOICES.filter((choice) => {
    if (!q) return true;
    return choice.id.toLowerCase().includes(q) || choice.label.toLowerCase().includes(q);
  }).map((choice) => choice.id);
}

export function ingestBlockedReason(file: { extension: string } | null): string | null {
  if (!file) return "没有打开的笔记";
  if (file.extension !== "md") return "当前文件不是 Markdown 笔记";
  return null;
}

export async function runIngest(vault: App["vault"], file: TFile, domain: Domain): Promise<void> {
  const plan = planIngest("", file.path, domain);
  await copyNote(vault, file, plan.rawDest);
  const ingested = formatShanghaiStamp(new Date()).slice(0, 10);
  const summary = buildSourceSummary({
    title: file.basename,
    rawPath: plan.rawDest,
    ingested,
  });
  await writeSourceSummary(vault, plan.sourceWikiPath, summary);
  await appendLog(vault, plan.logLine);
  await upsertIndex(vault, domain, plan.indexStub);
}

class DomainSuggestModal extends SuggestModal<Domain> {
  constructor(
    app: App,
    private readonly onChoose: (domain: Domain) => void,
  ) {
    super(app);
    this.setPlaceholder("选择入库领域");
  }

  getSuggestions(query: string): Domain[] {
    return suggestDomains(query);
  }

  renderSuggestion(value: Domain, el: HTMLElement): void {
    const label = DOMAIN_CHOICES.find((choice) => choice.id === value)?.label ?? value;
    el.setText(`${label} (${value})`);
  }

  onChooseSuggestion(item: Domain): void {
    this.onChoose(item);
  }
}

export function registerOutboxCommand(plugin: Plugin): void {
  plugin.addCommand({
    id: OUTBOX_COMMAND_ID,
    name: OUTBOX_COMMAND_NAME,
    callback: () => {
      const file = plugin.app.workspace.getActiveFile();
      const blocked = ingestBlockedReason(file);
      if (blocked || !file) {
        new Notice(blocked ?? "没有打开的笔记");
        return;
      }
      void createOutboxFromNote(plugin.app.vault, file).then(
        ({ dir, notes }) => {
          const message = `已创建分发任务 ${dir}`;
          new Notice(notes.length > 0 ? `${message}\n${notes.join("\n")}` : message);
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : "创建分发任务失败";
          new Notice(message);
        },
      );
    },
  });
}

export function registerOutboxOdCommand(plugin: Plugin): void {
  plugin.addCommand({
    id: OUTBOX_OD_COMMAND_ID,
    name: OUTBOX_OD_COMMAND_NAME,
    callback: () => {
      const file = plugin.app.workspace.getActiveFile();
      const blocked = ingestBlockedReason(file);
      if (blocked || !file) {
        new Notice(blocked ?? "没有打开的笔记");
        return;
      }
      void createOutboxFromNote(plugin.app.vault, file, "od").then(
        ({ dir }) => {
          new Notice(`已创建 OD 分发任务 ${dir}`);
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : "创建分发任务失败";
          new Notice(message);
        },
      );
    },
  });
}

function platformLabel(platform: Platform): string {
  return PLATFORM_CHOICES.find((choice) => choice.id === platform)?.label ?? platform;
}

class SlugSuggestModal extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly slugs: string[],
    private readonly onChoose: (slug: string) => void,
  ) {
    super(app);
    this.setPlaceholder("选择分发任务");
  }

  getSuggestions(query: string): string[] {
    return suggestSlugs(this.slugs, query);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  onChooseSuggestion(item: string): void {
    this.onChoose(item);
  }
}

class PlatformSuggestModal extends SuggestModal<Platform> {
  constructor(
    app: App,
    private readonly onChoose: (platform: Platform) => void,
  ) {
    super(app);
    this.setPlaceholder("选择平台");
  }

  getSuggestions(query: string): Platform[] {
    return suggestPlatforms(query);
  }

  renderSuggestion(value: Platform, el: HTMLElement): void {
    el.setText(`${platformLabel(value)} (${value})`);
  }

  onChooseSuggestion(item: Platform): void {
    this.onChoose(item);
  }
}

function chooseOutboxTarget(plugin: Plugin, onChoose: (slug: string, platform: Platform) => void): void {
  const slugs = listOutboxSlugs(plugin.app.vault.getFiles().map((file) => file.path));
  if (slugs.length === 0) {
    new Notice("没有分发任务");
    return;
  }
  new SlugSuggestModal(plugin.app, slugs, (slug) => {
    new PlatformSuggestModal(plugin.app, (platform) => {
      onChoose(slug, platform);
    }).open();
  }).open();
}

export function registerFallbackCommand(
  plugin: Plugin,
  run: (slug: string, platform: Platform) => Promise<void>,
): void {
  plugin.addCommand({
    id: FALLBACK_COMMAND_ID,
    name: FALLBACK_COMMAND_NAME,
    callback: () => {
      chooseOutboxTarget(plugin, (slug, platform) => {
        void run(slug, platform).then(
          () => {
            new Notice(`已复制草稿并打开${platformLabel(platform)}创作页`);
          },
          (err: unknown) => {
            const message = err instanceof Error ? err.message : "复制并打开失败";
            new Notice(message);
          },
        );
      });
    },
  });
}

export function registerStatusCommands(
  plugin: Plugin,
  endpoint: () => Promise<BridgeEndpoint | null>,
  fallback?: (slug: string, platform: Platform) => Promise<void>,
): void {
  plugin.addCommand({
    id: PUSH_COMMAND_ID,
    name: PUSH_COMMAND_NAME,
    callback: () => {
      chooseOutboxTarget(plugin, (slug, platform) => {
        void (async () => {
          if (!fallback) {
            const target = await endpoint();
            if (!target) {
              new Notice("桥未启动");
              return;
            }
            try {
              const notes: string[] = [];
              await pushDraft(plugin.app.vault, slug, platform, target, "filled", false, (collected) =>
                notes.push(...collected),
              );
              const message = `已加入浏览器队列 ${slug} / ${platformLabel(platform)}。在扩展中点「拉取并填入」。`;
              new Notice(notes.length > 0 ? `${message}\n${notes.join("\n")}` : message);
            } catch (err) {
              const message = err instanceof Error ? err.message : "推送失败";
              new Notice(message);
            }
            return;
          }
          const notes: string[] = [];
          const result = await recoverPush({
            push: async () => {
              const target = await endpoint();
              if (!target) throw new Error("桥未启动");
              await pushDraft(plugin.app.vault, slug, platform, target, "filled", false, (collected) =>
                notes.push(...collected),
              );
            },
            fallback: () => fallback(slug, platform),
          });
          if (!result.ok) {
            new Notice(result.error);
            return;
          }
          if (result.via === "push") {
            const message = `已加入浏览器队列 ${slug} / ${platformLabel(platform)}。在扩展中点「拉取并填入」。`;
            new Notice(notes.length > 0 ? `${message}\n${notes.join("\n")}` : message);
            return;
          }
          new Notice(`${result.error}。已复制草稿并打开创作页。`);
        })();
      });
    },
  });

  plugin.addCommand({
    id: PUBLISHED_COMMAND_ID,
    name: PUBLISHED_COMMAND_NAME,
    callback: () => {
      chooseOutboxTarget(plugin, (slug, platform) => {
        void markPublished(plugin.app.vault, slug, platform).then(
          () => {
            new Notice(`已标记发布 ${slug} / ${platformLabel(platform)}`);
          },
          (err: unknown) => {
            const message = err instanceof Error ? err.message : "标记发布失败";
            new Notice(message);
          },
        );
      });
    },
  });
}

function vaultRootOf(plugin: Plugin): string {
  const adapter = plugin.app.vault.adapter as { getBasePath?: () => string };
  return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
}

/** Active note → outbox slug, creating the outbox when it does not exist yet. */
async function prepareActiveOutbox(plugin: Plugin): Promise<{ slug: string; notes: string[] } | null> {
  const file = plugin.app.workspace.getActiveFile();
  const blocked = ingestBlockedReason(file);
  if (blocked || !file) {
    new Notice(blocked ?? "没有打开的笔记");
    return null;
  }
  if (!findIngestedRawPath(vaultRootOf(plugin), file.path)) {
    new Notice("请先入库当前笔记");
    return null;
  }
  let slug: string;
  try {
    slug = slugFromBasename(file.basename);
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建分发任务失败";
    new Notice(message);
    return null;
  }
  const statusPath = `raw/outbox/${slug}/status.json`;
  const notes: string[] = [];
  if (!plugin.app.vault.getAbstractFileByPath(statusPath)) {
    try {
      const created = await createOutboxFromNote(plugin.app.vault, file);
      notes.push(...created.notes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建分发任务失败";
      new Notice(message);
      return null;
    }
  }
  return { slug, notes };
}

export function registerDistributeCommand(
  plugin: Plugin,
  endpoint: () => Promise<BridgeEndpoint | null>,
): void {
  plugin.addCommand({
    id: DISTRIBUTE_COMMAND_ID,
    name: DISTRIBUTE_COMMAND_NAME,
    callback: () => distributeActiveNote(plugin, endpoint),
  });
}

export function registerStatusViewCommand(plugin: Plugin): void {
  plugin.addCommand({
    id: STATUS_VIEW_COMMAND_ID,
    name: STATUS_VIEW_COMMAND_NAME,
    callback: () => {
      const slugs = listOutboxSlugs(plugin.app.vault.getFiles().map((file) => file.path));
      if (slugs.length === 0) {
        new Notice("没有分发任务");
        return;
      }
      new SlugSuggestModal(plugin.app, slugs, (slug) => {
        void readStatus(plugin.app.vault, slug).then(
          (status) => {
            new Notice(`${slug}\n${statusLines(status).join("\n")}`);
          },
          (err: unknown) => {
            const message = err instanceof Error ? err.message : "读取分发状态失败";
            new Notice(message);
          },
        );
      }).open();
    },
  });
}

async function distributeActiveNote(
  plugin: Plugin,
  endpoint: () => Promise<BridgeEndpoint | null>,
): Promise<void> {
  const prepared = await prepareActiveOutbox(plugin);
  if (!prepared) return;
  const { slug, notes: shapingNotes } = prepared;
  let target: BridgeEndpoint | null;
  try {
    target = await endpoint();
  } catch (err) {
    const message = err instanceof Error ? err.message : "桥未启动";
    new Notice(message);
    return;
  }
  if (!target) {
    new Notice("桥未启动");
    return;
  }
  const status = await readStatus(plugin.app.vault, slug);
  const fillable = (Object.keys(status) as string[]).filter((key) =>
    (FILLABLE_PLATFORMS as readonly string[]).includes(key),
  );
  const pushNotes: string[] = [];
  try {
    for (const key of fillable) {
      await pushDraft(plugin.app.vault, slug, key as Platform, target, "queued", false, (collected) =>
        pushNotes.push(...collected),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "推送失败";
    new Notice(message);
    return;
  }
  const labels = fillable.map((key) => platformLabel(key as Platform)).join("、");
  new Notice(`已加入浏览器队列 ${slug}（${labels}）。在扩展中点「拉取并填入」。`);
  const allNotes = [...shapingNotes];
  for (const note of pushNotes) {
    if (!allNotes.includes(note)) allNotes.push(note);
  }
  if (allNotes.length > 0) {
    new Notice(allNotes.join("\n"));
  }
}

/** Confirm copy for 一键发布. Pure so the wording stays testable. */
export function publishConfirmText(slug: string, autoPlatforms: Platform[], fillPlatforms: Platform[]): string {
  const label = (platform: Platform) => PLATFORM_CHOICES.find((choice) => choice.id === platform)?.label ?? platform;
  const auto = autoPlatforms.map(label).join("、") || "无";
  const fill = fillPlatforms.map(label).join("、") || "无";
  return [`将处理「${slug}」：`, `自动发布：${auto}`, `仅填入草稿：${fill}`, "发布后无法撤回，确认继续？"].join("\n");
}

export class PublishConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "一键发布" });
    for (const line of this.message.split("\n")) {
      contentEl.createEl("p", { text: line });
    }
    const buttons = contentEl.createDiv({ cls: "luo-publish-confirm-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: "确认发布", cls: "mod-warning" }).addEventListener("click", () => this.confirm());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  confirm(): Promise<void> {
    this.close();
    return Promise.resolve(this.onConfirm());
  }
}

export function registerPublishAllCommand(
  plugin: Plugin,
  endpoint: () => Promise<BridgeEndpoint | null>,
  autoPublishOf: () => AutoPublishSettings | Promise<AutoPublishSettings>,
): void {
  plugin.addCommand({
    id: PUBLISH_ALL_COMMAND_ID,
    name: PUBLISH_ALL_COMMAND_NAME,
    callback: () => publishActiveNote(plugin, endpoint, autoPublishOf),
  });
}

async function publishActiveNote(
  plugin: Plugin,
  endpoint: () => Promise<BridgeEndpoint | null>,
  autoPublishOf: () => AutoPublishSettings | Promise<AutoPublishSettings>,
): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  const blocked = ingestBlockedReason(file);
  if (blocked || !file) {
    new Notice(blocked ?? "没有打开的笔记");
    return;
  }
  if (!findIngestedRawPath(vaultRootOf(plugin), file.path)) {
    new Notice("请先入库当前笔记");
    return;
  }
  let slug: string;
  try {
    slug = slugFromBasename(file.basename);
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建分发任务失败";
    new Notice(message);
    return;
  }
  const statusPath = `raw/outbox/${slug}/status.json`;
  const existing = plugin.app.vault.getAbstractFileByPath(statusPath);
  // Determine task type from an existing outbox; a missing one is treated as standard.
  const taskType = existing ? await readTaskType(plugin.app.vault, slug) : "standard";
  // OD tasks never auto-click publish even if the global switch is on (design non-goal).
  const autoPlatforms = taskType === "od" ? [] : autoPublishPlatforms(await autoPublishOf());
  // For a standard task with no auto-publish enabled, stop before creating any task files.
  if (taskType !== "od" && autoPlatforms.length === 0) {
    new Notice("尚未开启自动发布。请在插件设置里打开「自动发布总开关」并勾选平台。");
    return;
  }
  let shapingNotes: string[] = [];
  if (!existing) {
    try {
      const created = await createOutboxFromNote(plugin.app.vault, file);
      shapingNotes.push(...created.notes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建分发任务失败";
      new Notice(message);
      return;
    }
  }
  const finalTaskType = await readTaskType(plugin.app.vault, slug);
  let target: BridgeEndpoint | null;
  try {
    target = await endpoint();
  } catch (err) {
    const message = err instanceof Error ? err.message : "桥未启动";
    new Notice(message);
    return;
  }
  if (!target) {
    new Notice("桥未启动");
    return;
  }
  const bridge: BridgeEndpoint = target;
  const status = await readStatus(plugin.app.vault, slug);
  const allFillable = (Object.keys(status) as string[])
    .filter((key) => (FILLABLE_PLATFORMS as readonly string[]).includes(key))
    .map((key) => key as Platform);
  const fillPlatforms = allFillable.filter((key) => !autoPlatforms.includes(key));
  new PublishConfirmModal(plugin.app, publishConfirmText(slug, autoPlatforms, fillPlatforms), async () => {
    const pushNotes: string[] = [];
    try {
      for (const platform of allFillable) {
        await pushDraft(
          plugin.app.vault,
          slug,
          platform,
          bridge,
          "queued",
          autoPlatforms.includes(platform),
          (collected) => pushNotes.push(...collected),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "推送失败";
      new Notice(message);
      return;
    }
    const labels = allFillable.map((platform) => platformLabel(platform)).join("、");
    const autoLabels = autoPlatforms.map((platform) => platformLabel(platform)).join("、");
    const tail = autoLabels
      ? `${autoLabels} 将由扩展自动发布，其余仅填入草稿。`
      : finalTaskType === "od"
        ? "OD 任务仅填入草稿，发布请到平台手动点。"
        : "其余仅填入草稿。";
    new Notice(`已加入浏览器队列 ${slug}（${labels}）。${tail}`);
    const allNotes = [...shapingNotes];
    for (const note of pushNotes) {
      if (!allNotes.includes(note)) allNotes.push(note);
    }
    if (allNotes.length > 0) {
      new Notice(allNotes.join("\n"));
    }
  }).open();
}

export function registerSendTgCommand(plugin: Plugin): void {
  plugin.addCommand({
    id: TG_COMMAND_ID,
    name: TG_COMMAND_NAME,
    callback: async () => {
      await sendTgFromActiveNote(plugin);
    },
  });
}

async function sendTgFromActiveNote(plugin: Plugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  const blocked = ingestBlockedReason(file);
  if (blocked || !file) {
    new Notice(blocked ?? "没有打开的笔记");
    return;
  }
  const slug = slugFromBasename(file.basename);
  const tgPath = `raw/outbox/${slug}/tg.md`;
  const tgFile = plugin.app.vault.getAbstractFileByPath(tgPath);
  if (!tgFile) {
    new Notice("当前任务无 tg.md（仅 OD 任务生成，请先创建 OD 分发任务）");
    return;
  }
  const settings = await loadTg(plugin);
  if (!hasTgConfig(settings)) {
    new Notice("未配置 TG Bot Token 或频道 ID，请在插件设置填写");
    return;
  }
  const body = stripFrontmatter(await plugin.app.vault.read(tgFile as TFile)).trim();
  if (!body) {
    new Notice("tg.md 正文为空");
    return;
  }
  const channel = settings.chatId ?? "";
  const preview = body.slice(0, 100);
  new TgConfirmModal(plugin.app, channel, preview, async () => {
    const result = await sendTgMessage(settings, body);
    if (!result.ok) {
      new Notice(`TG 发送失败：${result.reason ?? "未知错误"}`);
      return;
    }
    await markTgSent(plugin, slug);
    new Notice("已发送到 TG 频道");
  }).open();
}

export class TgConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly channel: string,
    private readonly preview: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "发送到 TG 频道" });
    contentEl.createEl("p", { text: `目标频道：${this.channel}` });
    contentEl.createEl("p", { text: `正文前 100 字：${this.preview}` });
    const buttons = contentEl.createDiv({ cls: "luo-publish-confirm-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: "确认发送", cls: "mod-warning" }).addEventListener("click", () => this.confirm());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  confirm(): Promise<void> {
    this.close();
    return Promise.resolve(this.onConfirm());
  }
}

export function registerIngestCommand(plugin: Plugin): void {
  plugin.addCommand({
    id: INGEST_COMMAND_ID,
    name: INGEST_COMMAND_NAME,
    callback: () => {
      const file = plugin.app.workspace.getActiveFile();
      const blocked = ingestBlockedReason(file);
      if (blocked || !file) {
        new Notice(blocked ?? "没有打开的笔记");
        return;
      }
      new DomainSuggestModal(plugin.app, (domain) => {
        void runIngest(plugin.app.vault, file, domain).then(
          () => {
            new Notice(`已入库 ${file.basename}`);
          },
          (err: unknown) => {
            const message = err instanceof Error ? err.message : "入库失败";
            new Notice(message);
          },
        );
      }).open();
    },
  });
}
