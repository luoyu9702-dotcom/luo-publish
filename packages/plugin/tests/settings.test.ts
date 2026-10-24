import { describe, expect, it } from "vitest";
import type { TFile, Vault } from "obsidian";
import { ensureBridgeToken } from "../src/bridge-server";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_AUTO_PUBLISH,
  PUBLISH_ACCOUNTS_PATH,
  autoPublishPlatforms,
  bridgeListenLabel,
  importPublishAccounts,
  parsePublishAccountsMarkdown,
  readAutoPublish,
  saveAccounts,
  saveAutoPublish,
} from "../src/settings";

const fixture = `# 发布账号

| 平台 | 账号 |
| --- | --- |
| X | \`@yu_luo26312\` |
| 小红书 | 42926470599 |
| 公众号 | gh_8b39fc70f045 |
| CSDN | 2401_86932595 |
| B站 | bili_79674646750 |
| 其他 | ignore-me |
`;

describe("bridge listen address", () => {
  it("shows the loopback URL and a stopped label", () => {
    expect(bridgeListenLabel(62934)).toBe("http://127.0.0.1:62934");
    expect(bridgeListenLabel(null)).toBe("桥未启动");
    expect(bridgeListenLabel(0)).toBe("桥未启动");
  });
});

describe("publish account markdown", () => {
  it("starts empty", () => {
    expect(DEFAULT_ACCOUNTS).toEqual({});
    expect(parsePublishAccountsMarkdown("")).toEqual({});
  });

  it("reads the vault table of platform and account id", () => {
    expect(parsePublishAccountsMarkdown(fixture)).toEqual({
      x: "@yu_luo26312",
      xiaohongshu: "42926470599",
      csdn: "2401_86932595",
      bilibili: "bili_79674646750",
    });
  });

  it("reads an English header row", () => {
    const md = `| platform | account id |
| --- | --- |
| xiaohongshu | 42926470599 |
`;
    expect(parsePublishAccountsMarkdown(md)).toEqual({ xiaohongshu: "42926470599" });
  });
});

describe("account persistence", () => {
  it("saves accounts beside bridgeToken", async () => {
    let saved: unknown = { bridgeToken: "abc", kept: true };
    const store = {
      async loadData() {
        return saved;
      },
      async saveData(data: unknown) {
        saved = data;
      },
    };
    await saveAccounts(store, { x: "@yu_luo26312", bilibili: "  ", csdn: "2401_86932595" });
    expect(saved).toEqual({
      bridgeToken: "abc",
      kept: true,
      accounts: { x: "@yu_luo26312", csdn: "2401_86932595" },
    });
    expect(await ensureBridgeToken(store)).toBe("abc");
    expect(saved).toEqual({
      bridgeToken: "abc",
      kept: true,
      accounts: { x: "@yu_luo26312", csdn: "2401_86932595" },
    });
  });

  it("imports wiki/entities/publish-accounts.md when that file exists", async () => {
    const files = new Map<string, string>([[PUBLISH_ACCOUNTS_PATH, fixture]]);
    const vault = {
      getAbstractFileByPath(path: string) {
        return files.has(path) ? { path } : null;
      },
      async read(file: { path: string }) {
        const text = files.get(file.path);
        if (text === undefined) throw new Error("missing");
        return text;
      },
    };
    expect(await importPublishAccounts(vault as unknown as Vault)).toEqual({
      x: "@yu_luo26312",
      xiaohongshu: "42926470599",
      csdn: "2401_86932595",
      bilibili: "bili_79674646750",
    });

    const empty = {
      getAbstractFileByPath() {
        return null;
      },
      async read(_file: TFile) {
        return "";
      },
    };
    await expect(importPublishAccounts(empty as unknown as Vault)).rejects.toThrow(/未找到/);
  });
});

describe("auto publish settings", () => {
  it("starts with everything off", () => {
    expect(DEFAULT_AUTO_PUBLISH).toEqual({
      enabled: false,
      platforms: { x: false, xiaohongshu: false, bilibili: false, csdn: false },
    });
    expect(readAutoPublish({})).toEqual(DEFAULT_AUTO_PUBLISH);
    expect(readAutoPublish({ autoPublish: { enabled: "yes", platforms: { x: 1 } } })).toEqual(DEFAULT_AUTO_PUBLISH);
    expect(autoPublishPlatforms(DEFAULT_AUTO_PUBLISH)).toEqual([]);
  });

  it("only publishes the platforms that are on, and nothing while the master switch is off", () => {
    const on = {
      enabled: true,
      platforms: { x: true, xiaohongshu: true, bilibili: false, csdn: false },
    };
    expect(autoPublishPlatforms(on)).toEqual(["x", "xiaohongshu"]);
    expect(autoPublishPlatforms({ ...on, enabled: false })).toEqual([]);
  });

  it("saves auto-publish beside the other data", async () => {
    let saved: unknown = { bridgeToken: "abc", accounts: { x: "@yu_luo26312" } };
    const store = {
      async loadData() {
        return saved;
      },
      async saveData(data: unknown) {
        saved = data;
      },
    };
    await saveAutoPublish(store, {
      enabled: true,
      platforms: { x: true, xiaohongshu: false, bilibili: false, csdn: true },
    });
    expect(saved).toEqual({
      bridgeToken: "abc",
      accounts: { x: "@yu_luo26312" },
      autoPublish: {
        enabled: true,
        platforms: { x: true, xiaohongshu: false, bilibili: false, csdn: true },
      },
    });
    expect(readAutoPublish(saved)).toEqual({
      enabled: true,
      platforms: { x: true, xiaohongshu: false, bilibili: false, csdn: true },
    });
  });
});
