import { describe, expect, it } from "vitest";
import type { TFile, Vault } from "obsidian";
import {
  buildOutbox,
  createOutboxFromNote,
  initialStatus,
  taskTypeFromPath,
  writeOutbox,
} from "../src/outbox";

describe("buildOutbox", () => {
  it("returns four platform drafts and a generated status.json shape", () => {
    expect(Object.keys(buildOutbox("demo", "hello", "标题"))).toEqual(
      expect.arrayContaining(["x", "xiaohongshu", "bilibili", "csdn"]),
    );
    expect(Object.keys(buildOutbox("demo", "hello", "标题"))).toHaveLength(4);
    expect(initialStatus()).toEqual({
      x: "generated",
      xiaohongshu: "generated",
      bilibili: "generated",
      csdn: "generated",
    });
  });

  it("copies the body without a repeated title heading, and adds a 小红书 topic line", () => {
    const files = buildOutbox("demo", "hello", "标题");
    for (const platform of ["x", "xiaohongshu", "bilibili", "csdn"] as const) {
      expect(files[platform]).toContain(`platform: ${platform}`);
      expect(files[platform]).toContain("hello");
      expect(files[platform]).not.toContain("# 标题");
    }
    expect(files.xiaohongshu).toContain("#话题");
    expect(files.bilibili).not.toContain("#话题");
    expect(files.x).not.toContain("#话题");
  });
});

type Stored = { kind: "file"; text?: string } | { kind: "folder" };

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
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(path, { kind: "file", text: data });
      return { path };
    },
    async read(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || hit.text === undefined) throw new Error(`no text ${file.path}`);
      return hit.text;
    },
  };
  return { files, vault: vault as unknown as Vault };
}

describe("writeOutbox", () => {
  it("writes four markdown drafts and status.json under raw/outbox/<slug>", async () => {
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");
    const names = ["x", "xiaohongshu", "bilibili", "csdn"] as const;
    const built = buildOutbox("demo", "hello", "标题");
    for (const name of names) {
      expect(files.get(`raw/outbox/demo/${name}.md`)).toMatchObject({ text: built[name] });
    }
    const status = files.get("raw/outbox/demo/status.json");
    expect(status?.kind).toBe("file");
    if (status?.kind === "file") {
      expect(JSON.parse(status.text ?? "")).toEqual(initialStatus());
    }
  });

  it("reports platform limit notes with the created task", async () => {
    const { vault } = fakeVault();
    const result = await writeOutbox(vault, "demo", "hello", "这是一个超过二十个字的长标题用来测试截断行为");
    expect(result.dir).toBe("raw/outbox/demo");
    expect(result.notes).toContain("小红书：标题超过 20 字，已截断");
    expect(result.notes).toContain(
      "B站专栏：正文不足 200 字，平台可能拒收（需满 200 字或 3 张图），请补充后再发",
    );
  });

  it("does not overwrite an existing outbox", async () => {
    const { files, vault } = fakeVault({
      raw: { kind: "folder" },
      "raw/outbox": { kind: "folder" },
      "raw/outbox/demo": { kind: "folder" },
      "raw/outbox/demo/status.json": { kind: "file", text: "{}\n" },
      "raw/outbox/demo/x.md": { kind: "file", text: "keep\n" },
    });
    await expect(writeOutbox(vault, "demo", "hello", "标题")).rejects.toThrow(/未覆盖/);
    expect(files.get("raw/outbox/demo/x.md")).toEqual({ kind: "file", text: "keep\n" });
  });

  it("creates a task from the active note basename and body", async () => {
    const note = "# 标题\n\nhello\n";
    const { files, vault } = fakeVault({
      "Notes/demo.md": { kind: "file", text: note },
    });
    const file = { path: "Notes/demo.md", basename: "demo" } as TFile;
    await createOutboxFromNote(vault, file);
    expect(files.get("raw/outbox/demo/x.md")).toMatchObject({
      text: buildOutbox("demo", note, "标题").x,
    });
    expect(files.get("raw/outbox/demo/csdn.md")).toMatchObject({
      text: buildOutbox("demo", note, "标题").csdn,
    });
  });
});

describe("OD task type", () => {
  it("buildOutbox(od) yields csdn/xiaohongshu/wechat/tg and no x/bilibili", () => {
    const files = buildOutbox("demo", "hello", "标题", "od");
    expect(Object.keys(files)).toEqual(["csdn", "xiaohongshu", "wechat", "tg"]);
    expect(files.csdn).toContain("platform: csdn");
    expect(files.wechat).toContain("platform: wechat");
    expect(files.tg).toContain("platform: tg");
    expect(files.xiaohongshu).toContain("#话题");
  });

  it("writeOutbox(od) writes four md files and a three-key status.json", async () => {
    const { files, vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题", "", "od");
    for (const name of ["csdn", "xiaohongshu", "wechat", "tg"] as const) {
      expect(files.get(`raw/outbox/demo/${name}.md`)?.kind).toBe("file");
    }
    expect(files.get("raw/outbox/demo/x.md")).toBeUndefined();
    expect(files.get("raw/outbox/demo/bilibili.md")).toBeUndefined();
    const status = files.get("raw/outbox/demo/status.json");
    if (status?.kind === "file") {
      expect(JSON.parse(status.text ?? "")).toEqual({
        csdn: "generated",
        xiaohongshu: "generated",
        wechat: "generated",
      });
    } else {
      throw new Error("missing status");
    }
  });

  it("infers od from the od-exam source path and honors an explicit override", () => {
    const odFile = { path: "raw/sources/od-exam/demo.md", basename: "demo" } as TFile;
    const otherFile = { path: "raw/sources/ai-tools/demo.md", basename: "demo" } as TFile;
    expect(taskTypeFromPath(odFile.path)).toBe("od");
    expect(taskTypeFromPath(otherFile.path)).toBe("standard");
    expect(taskTypeFromPath(odFile.path, "standard")).toBe("standard");
  });

  it("createOutboxFromNote infers od from an od-exam note", async () => {
    const { files, vault } = fakeVault({
      "raw/sources/od-exam/demo.md": { kind: "file", text: "# 标题\n\nhello\n" },
    });
    const file = { path: "raw/sources/od-exam/demo.md", basename: "demo" } as TFile;
    await createOutboxFromNote(vault, file);
    for (const name of ["csdn", "xiaohongshu", "wechat", "tg"] as const) {
      expect(files.get(`raw/outbox/demo/${name}.md`)?.kind).toBe("file");
    }
    const status = files.get("raw/outbox/demo/status.json");
    if (status?.kind === "file") {
      expect(JSON.parse(status.text ?? "")).toHaveProperty("wechat");
    } else {
      throw new Error("missing status");
    }
  });
});

