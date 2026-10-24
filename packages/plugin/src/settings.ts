import type { TFile, Vault } from "obsidian";
import type { Platform } from "./outbox";

export type AccountSettings = {
  x?: string;
  xiaohongshu?: string;
  bilibili?: string;
  csdn?: string;
};

export const DEFAULT_ACCOUNTS: AccountSettings = {};

/**
 * Auto-publish is off everywhere until the user turns it on, per platform.
 * When a platform is on, the extension clicks that platform's publish button
 * right after filling the draft. There is no undo on the platforms.
 */
export type AutoPublishSettings = {
  enabled: boolean;
  platforms: Record<Platform, boolean>;
};

export const DEFAULT_AUTO_PUBLISH: AutoPublishSettings = {
  enabled: false,
  platforms: { x: false, xiaohongshu: false, bilibili: false, csdn: false },
};

export const PUBLISH_ACCOUNTS_PATH = "wiki/entities/publish-accounts.md";

/** Read-only settings label. The extension pairs with this loopback URL. */
export function bridgeListenLabel(port: number | null | undefined): string {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return "桥未启动";
  return `http://127.0.0.1:${port}`;
}

export const ACCOUNT_FIELDS: { id: keyof AccountSettings; label: string }[] = [
  { id: "x", label: "X" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "bilibili", label: "B站专栏" },
  { id: "csdn", label: "CSDN" },
];

const PLATFORM_KEYS = ACCOUNT_FIELDS.map((field) => field.id);

type DataStore = {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function cellText(value: string): string {
  return value.trim().replace(/^`+|`+$/g, "").trim();
}

function platformKey(label: string): keyof AccountSettings | null {
  const name = cellText(label).toLowerCase().replace(/\s+/g, "");
  if (name === "x" || name === "twitter" || name === "推特") return "x";
  if (name === "小红书" || name === "xiaohongshu" || name === "xhs") return "xiaohongshu";
  if (name === "b站" || name === "b站专栏" || name === "哔哩哔哩" || name === "bilibili") return "bilibili";
  if (name === "csdn") return "csdn";
  return null;
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = trimmed.split("|").slice(1, -1).map(cellText);
  if (cells.length < 2) return null;
  if (cells.every((cell) => /^:?-+:?$/.test(cell))) return null;
  return cells;
}

export function normalizeAccounts(input: AccountSettings): AccountSettings {
  const next: AccountSettings = {};
  for (const key of PLATFORM_KEYS) {
    const value = input[key]?.trim();
    if (value) next[key] = value;
  }
  return next;
}

/** Read a markdown table whose columns are platform and account id. */
export function parsePublishAccountsMarkdown(md: string): AccountSettings {
  const rows = md.split(/\r?\n/).map(tableCells).filter((row): row is string[] => row !== null);
  if (rows.length === 0) return {};
  let platformCol = 0;
  let accountCol = 1;
  let start = 0;
  const header = rows[0] ?? [];
  const headerNames = header.map((cell) => cell.toLowerCase());
  const platformIdx = headerNames.findIndex((cell) => cell === "平台" || cell === "platform");
  const accountIdx = headerNames.findIndex((cell) => cell.includes("账号") || cell.includes("account"));
  if (platformIdx >= 0 && accountIdx >= 0) {
    platformCol = platformIdx;
    accountCol = accountIdx;
    start = 1;
  }
  const accounts: AccountSettings = {};
  for (const row of rows.slice(start)) {
    const key = platformKey(row[platformCol] ?? "");
    const account = row[accountCol] ?? "";
    if (!key || !account) continue;
    accounts[key] = account;
  }
  return accounts;
}

export function readAccounts(data: unknown): AccountSettings {
  const record = asRecord(asRecord(data).accounts);
  const accounts: AccountSettings = {};
  for (const key of PLATFORM_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) accounts[key] = value.trim();
  }
  return accounts;
}

export async function loadAccounts(store: Pick<DataStore, "loadData">): Promise<AccountSettings> {
  return readAccounts(await store.loadData());
}

export async function saveAccounts(store: DataStore, accounts: AccountSettings): Promise<void> {
  const data = asRecord(await store.loadData());
  await store.saveData({ ...data, accounts: normalizeAccounts(accounts) });
}

export async function importPublishAccounts(vault: Vault): Promise<AccountSettings> {
  const file = vault.getAbstractFileByPath(PUBLISH_ACCOUNTS_PATH);
  if (!file) throw new Error(`未找到 ${PUBLISH_ACCOUNTS_PATH}`);
  return parsePublishAccountsMarkdown(await vault.read(file as TFile));
}

const AUTO_PLATFORM_KEYS: readonly Platform[] = ["x", "xiaohongshu", "bilibili", "csdn"];

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readAutoPublish(data: unknown): AutoPublishSettings {
  const record = asRecord(data);
  const stored = asRecord(record.autoPublish);
  const platforms = asRecord(stored.platforms);
  const next: AutoPublishSettings = {
    enabled: readBool(stored.enabled, DEFAULT_AUTO_PUBLISH.enabled),
    platforms: { ...DEFAULT_AUTO_PUBLISH.platforms },
  };
  for (const key of AUTO_PLATFORM_KEYS) {
    next.platforms[key] = readBool(platforms[key], DEFAULT_AUTO_PUBLISH.platforms[key]);
  }
  return next;
}

export async function loadAutoPublish(store: Pick<DataStore, "loadData">): Promise<AutoPublishSettings> {
  return readAutoPublish(await store.loadData());
}

export async function saveAutoPublish(store: DataStore, settings: AutoPublishSettings): Promise<void> {
  const data = asRecord(await store.loadData());
  const next: AutoPublishSettings = {
    enabled: settings.enabled,
    platforms: { ...DEFAULT_AUTO_PUBLISH.platforms },
  };
  for (const key of AUTO_PLATFORM_KEYS) {
    next.platforms[key] = settings.platforms[key] === true;
  }
  await store.saveData({ ...data, autoPublish: next });
}

/** Platforms that will really be published without a second look. Empty when the master switch is off. */
export function autoPublishPlatforms(settings: AutoPublishSettings): Platform[] {
  if (!settings.enabled) return [];
  return AUTO_PLATFORM_KEYS.filter((key) => settings.platforms[key] === true);
}

export type TgSettings = { token?: string; chatId?: string };

export const DEFAULT_TG: TgSettings = {};

function readTg(data: unknown): TgSettings {
  const record = asRecord(asRecord(data).tg);
  const token = typeof record.token === "string" ? record.token.trim() : "";
  const chatId = typeof record.chatId === "string" ? record.chatId.trim() : "";
  return { token, chatId };
}

export async function loadTg(store: Pick<DataStore, "loadData">): Promise<TgSettings> {
  return readTg(await store.loadData());
}

export async function saveTg(store: DataStore, settings: TgSettings): Promise<void> {
  const data = asRecord(await store.loadData());
  await store.saveData({
    ...data,
    tg: { token: (settings.token ?? "").trim(), chatId: (settings.chatId ?? "").trim() },
  });
}

export function hasTgConfig(settings: TgSettings): boolean {
  return Boolean(settings.token && settings.chatId);
}

/** OD tasks record their TG send result under this slug-keyed map in the local plugin data. */
export async function markTgSent(store: DataStore, slug: string): Promise<void> {
  const data = asRecord(await store.loadData());
  const sent = { ...asRecord(data.tgSent) };
  sent[slug] = true;
  await store.saveData({ ...data, tgSent: sent });
}

export async function readTgSent(store: Pick<DataStore, "loadData">, slug: string): Promise<boolean> {
  const data = asRecord(await store.loadData());
  return asRecord(data.tgSent)[slug] === true;
}
