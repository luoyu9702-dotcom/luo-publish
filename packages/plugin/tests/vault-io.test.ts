import { describe, expect, it } from "vitest";
import type { TFile, Vault } from "obsidian";
import {
  appendLog,
  buildSourceSummary,
  copyNote,
  joinLog,
  upsertIndex,
  upsertIndexMarkdown,
  writeSourceSummary,
} from "../src/vault-io";

describe("source summary", () => {
  it("writes title, raw_path, ingested date, and an empty 要点 section", () => {
    expect(
      buildSourceSummary({
        title: "foo",
        rawPath: "raw/sources/inbox/foo.md",
        ingested: "2026-10-24",
      }),
    ).toBe(`---
title: "foo"
raw_path: "raw/sources/inbox/foo.md"
ingested: "2026-10-24"
---

## 要点
`);
  });
});

describe("log and index text", () => {
  it("appends a log line without dropping the existing log", () => {
    expect(joinLog("# log\n", "## [2026-10-24 00:30 Asia/Shanghai] ingest | foo")).toBe(
      "# log\n\n## [2026-10-24 00:30 Asia/Shanghai] ingest | foo\n",
    );
  });

  it("inserts the stub under the matching domain heading", () => {
    const index = "# 索引\n\n## ai-tools\n\n- [a](wiki/sources/a.md)\n\n## inbox\n\n- [old](wiki/sources/old.md)\n\n## quant\n";
    const next = upsertIndexMarkdown(index, "inbox", "- [foo](wiki/sources/foo.md)");
    expect(next).toContain("## inbox\n\n- [old](wiki/sources/old.md)\n- [foo](wiki/sources/foo.md)\n");
    expect(next).toContain("## quant\n");
    expect(next).not.toMatch(/## quant[\s\S]*foo/);
  });

  it("does not duplicate a stub already in that domain section", () => {
    const index = "## inbox\n\n- [foo](wiki/sources/foo.md)\n";
    expect(upsertIndexMarkdown(index, "inbox", "- [foo](wiki/sources/foo.md)")).toBe(index);
  });

  it("creates the domain section when the heading is missing", () => {
    expect(upsertIndexMarkdown("# 索引\n", "inbox", "- [foo](wiki/sources/foo.md)")).toBe(
      "# 索引\n\n## inbox\n\n- [foo](wiki/sources/foo.md)\n",
    );
  });
});

type Stored = { kind: "file"; text?: string; binary?: ArrayBuffer } | { kind: "folder" };

function fakeVault(initial: Record<string, Stored> = {}) {
  const files = new Map<string, Stored>(Object.entries(initial));
  const ops: string[] = [];
  const vault = {
    getAbstractFileByPath(path: string) {
      const hit = files.get(path);
      return hit ? { path, kind: hit.kind } : null;
    },
    async createFolder(path: string) {
      ops.push(`createFolder ${path}`);
      if (files.has(path)) throw new Error(`exists ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(path, { kind: "folder" });
      return { path };
    },
    async create(path: string, data: string) {
      ops.push(`create ${path}`);
      if (files.has(path)) throw new Error(`exists ${path}`);
      files.set(path, { kind: "file", text: data });
      return { path };
    },
    async createBinary(path: string, data: ArrayBuffer) {
      ops.push(`createBinary ${path}`);
      const parent = path.slice(0, path.lastIndexOf("/"));
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      if (files.has(path)) throw new Error(`exists ${path}`);
      files.set(path, { kind: "file", binary: data });
      return { path };
    },
    async readBinary(file: { path: string }) {
      ops.push(`readBinary ${file.path}`);
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || !hit.binary) throw new Error(`no binary ${file.path}`);
      return hit.binary;
    },
    async process(file: { path: string }, fn: (data: string) => string) {
      ops.push(`process ${file.path}`);
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file") throw new Error(`no text ${file.path}`);
      const next = fn(hit.text ?? "");
      files.set(file.path, { kind: "file", text: next });
      return next;
    },
    async modify() {
      ops.push("modify");
    },
    async modifyBinary() {
      ops.push("modifyBinary");
    },
  };
  return { files, ops, vault: vault as unknown as Vault };
}

describe("vault writes", () => {
  it("copies note bytes into rawDest and does not modify the source or an existing raw file", async () => {
    const bytes = new TextEncoder().encode("# hello").buffer;
    const { files, ops, vault } = fakeVault({
      "Notes/foo.md": { kind: "file", binary: bytes },
    });
    const source = { path: "Notes/foo.md" } as TFile;
    await copyNote(vault, source, "raw/sources/inbox/foo.md");
    const copied = files.get("raw/sources/inbox/foo.md");
    expect(copied?.kind).toBe("file");
    if (copied?.kind === "file") {
      expect(new Uint8Array(copied.binary ?? new ArrayBuffer(0))).toEqual(new Uint8Array(bytes));
    }
    expect(files.get("Notes/foo.md")).toEqual({ kind: "file", binary: bytes });
    expect(ops.some((op) => op === "modify" || op === "modifyBinary")).toBe(false);

    await expect(copyNote(vault, source, "raw/sources/inbox/foo.md")).rejects.toThrow(/未覆盖/);
    expect(ops.filter((op) => op.startsWith("createBinary"))).toEqual(["createBinary raw/sources/inbox/foo.md"]);
  });

  it("writes a new wiki summary and leaves an existing summary untouched", async () => {
    const { files, vault } = fakeVault();
    const body = buildSourceSummary({
      title: "foo",
      rawPath: "raw/sources/inbox/foo.md",
      ingested: "2026-10-24",
    });
    expect(await writeSourceSummary(vault, "wiki/sources/foo.md", body)).toBe("created");
    expect(files.get("wiki/sources/foo.md")).toMatchObject({ text: body });

    files.set("wiki/sources/foo.md", { kind: "file", text: "keep me\n" });
    expect(await writeSourceSummary(vault, "wiki/sources/foo.md", body)).toBe("exists");
    expect(files.get("wiki/sources/foo.md")).toEqual({ kind: "file", text: "keep me\n" });
  });

  it("creates wiki/log.md and appends later lines", async () => {
    const { files, vault } = fakeVault();
    await appendLog(vault, "## [2026-10-24 00:30 Asia/Shanghai] ingest | foo");
    expect(files.get("wiki/log.md")).toMatchObject({
      text: "## [2026-10-24 00:30 Asia/Shanghai] ingest | foo\n",
    });
    await appendLog(vault, "## [2026-10-24 00:31 Asia/Shanghai] ingest | bar");
    expect(files.get("wiki/log.md")).toMatchObject({
      text: "## [2026-10-24 00:30 Asia/Shanghai] ingest | foo\n\n## [2026-10-24 00:31 Asia/Shanghai] ingest | bar\n",
    });
  });

  it("upserts the stub under the domain section in wiki/index.md", async () => {
    const { files, vault } = fakeVault({
      "wiki/index.md": { kind: "file", text: "## ai-tools\n\n- [a](wiki/sources/a.md)\n" },
    });
    await upsertIndex(vault, "inbox", "- [foo](wiki/sources/foo.md)");
    expect(files.get("wiki/index.md")).toMatchObject({
      text: "## ai-tools\n\n- [a](wiki/sources/a.md)\n\n## inbox\n\n- [foo](wiki/sources/foo.md)\n",
    });
  });
});
