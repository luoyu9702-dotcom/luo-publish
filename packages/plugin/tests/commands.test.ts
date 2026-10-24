import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile, Vault } from "obsidian";
import { ingestBlockedReason, runIngest, suggestDomains } from "../src/commands";

type Stored = { kind: "file"; text?: string; binary?: ArrayBuffer } | { kind: "folder" };

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
      files.set(path, { kind: "file", text: data });
      return { path };
    },
    async createBinary(path: string, data: ArrayBuffer) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      if (files.has(path)) throw new Error(`exists ${path}`);
      files.set(path, { kind: "file", binary: data });
      return { path };
    },
    async readBinary(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || !hit.binary) throw new Error(`no binary ${file.path}`);
      return hit.binary;
    },
    async process(file: { path: string }, fn: (data: string) => string) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file") throw new Error(`no text ${file.path}`);
      const next = fn(hit.text ?? "");
      files.set(file.path, { kind: "file", text: next });
      return next;
    },
  };
  return { files, vault: vault as unknown as Vault };
}

describe("domain picker", () => {
  it("offers the domains and filters by Chinese label or slug", () => {
    expect(suggestDomains("")).toEqual([
      "ai-tools",
      "ai-agents",
      "quant",
      "overseas-accounts",
      "digital-human",
      "inbox",
    ]);
    expect(suggestDomains("收件")).toEqual(["inbox"]);
    expect(suggestDomains("quant")).toEqual(["quant"]);
  });
});

describe("ingest command", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T16:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses when there is no markdown note", () => {
    expect(ingestBlockedReason(null)).toBe("没有打开的笔记");
    expect(ingestBlockedReason({ extension: "png" })).toBe("当前文件不是 Markdown 笔记");
    expect(ingestBlockedReason({ extension: "md" })).toBeNull();
  });

  it("copies the active note and writes the wiki stub, Shanghai log, and domain index line", async () => {
    const bytes = new TextEncoder().encode("# 标题\n正文").buffer;
    const { files, vault } = fakeVault({
      "Notes/foo.md": { kind: "file", binary: bytes },
    });
    const file = { path: "Notes/foo.md", basename: "foo" } as TFile;
    await runIngest(vault, file, "inbox");

    const copied = files.get("raw/sources/inbox/foo.md");
    expect(copied?.kind).toBe("file");
    if (copied?.kind === "file") {
      expect(new Uint8Array(copied.binary ?? new ArrayBuffer(0))).toEqual(new Uint8Array(bytes));
    }
    expect(files.get("wiki/sources/foo.md")).toMatchObject({
      text: `---
title: "foo"
raw_path: "raw/sources/inbox/foo.md"
ingested: "2026-10-24"
---

## 要点
`,
    });
    expect(files.get("wiki/log.md")).toMatchObject({
      text: "## [2026-10-24 00:30 Asia/Shanghai] ingest | foo\n",
    });
    expect(files.get("wiki/index.md")).toMatchObject({
      text: "## inbox\n\n- [foo](wiki/sources/foo.md)\n",
    });
  });

  it("does not write wiki files when raw already exists", async () => {
    const bytes = new TextEncoder().encode("x").buffer;
    const { files, vault } = fakeVault({
      "Notes/foo.md": { kind: "file", binary: bytes },
      raw: { kind: "folder" },
      "raw/sources": { kind: "folder" },
      "raw/sources/inbox": { kind: "folder" },
      "raw/sources/inbox/foo.md": { kind: "file", binary: bytes },
    });
    const file = { path: "Notes/foo.md", basename: "foo" } as TFile;
    await expect(runIngest(vault, file, "inbox")).rejects.toThrow(/未覆盖/);
    expect(files.has("wiki/sources/foo.md")).toBe(false);
    expect(files.has("wiki/log.md")).toBe(false);
    expect(files.has("wiki/index.md")).toBe(false);
  });
});
