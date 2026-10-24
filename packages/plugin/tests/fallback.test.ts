import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Plugin, Vault } from "obsidian";
import { registerFallbackCommand } from "../src/commands";
import { writeOutbox } from "../src/outbox";
import { clipboardText, composeUrl, copyAndOpenDraft, recoverPush } from "../src/fallback";

const fillers = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bridge-ext/src/fillers");

type Stored = { kind: "file"; text?: string } | { kind: "folder" };

function fakeVault(initial: Record<string, Stored> = {}) {
  const files = new Map<string, Stored>(Object.entries(initial));
  const vault = {
    getAbstractFileByPath(filePath: string) {
      const hit = files.get(filePath);
      return hit ? { path: filePath, kind: hit.kind } : null;
    },
    async createFolder(filePath: string) {
      if (files.has(filePath)) throw new Error(`exists ${filePath}`);
      const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(filePath, { kind: "folder" });
      return { path: filePath };
    },
    async create(filePath: string, data: string) {
      if (files.has(filePath)) throw new Error(`exists ${filePath}`);
      const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${parent}`);
      files.set(filePath, { kind: "file", text: data });
      return { path: filePath };
    },
    async read(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || hit.text === undefined) throw new Error(`no text ${file.path}`);
      return hit.text;
    },
  };
  return { vault: vault as unknown as Vault };
}

describe("compose fallback", () => {
  it("uses the same editor URLs as the extension fillers", () => {
    const sources = {
      x: readFileSync(path.join(fillers, "x.ts"), "utf8"),
      xiaohongshu: readFileSync(path.join(fillers, "xiaohongshu.ts"), "utf8"),
      bilibili: readFileSync(path.join(fillers, "bilibili.ts"), "utf8"),
      csdn: readFileSync(path.join(fillers, "csdn.ts"), "utf8"),
    };
    expect(sources.x).toContain(composeUrl("x"));
    expect(sources.xiaohongshu).toContain(composeUrl("xiaohongshu"));
    expect(sources.bilibili).toContain(composeUrl("bilibili"));
    expect(sources.csdn).toContain(composeUrl("csdn"));
    expect(composeUrl("x")).toBe("https://x.com/compose/post");
    expect(composeUrl("csdn")).toBe("https://mp.csdn.net/mp_blog/creation/editor");
  });

  it("copies the markdown and keeps a title that is already in the body", () => {
    expect(clipboardText("标题", "hello\n")).toBe("标题\n\nhello\n");
    expect(clipboardText("标题", "# 标题\n\nhello\n")).toBe("# 标题\n\nhello\n");
  });

  it("copies the draft and opens only that platform editor", async () => {
    const { vault } = fakeVault();
    await writeOutbox(vault, "demo", "hello", "标题");
    const copied: string[] = [];
    const opened: string[] = [];
    const result = await copyAndOpenDraft(vault, "demo", "x", {
      async copy(text) {
        copied.push(text);
      },
      open(url) {
        opened.push(url);
      },
    });
    expect(copied).toEqual(["标题\n\nhello\n"]);
    expect(opened).toEqual(["https://x.com/compose/post"]);
    expect(result).toEqual({ url: "https://x.com/compose/post", text: "标题\n\nhello\n" });
  });

  it("does not open a page when the draft is missing", async () => {
    const { vault } = fakeVault();
    const opened: string[] = [];
    await expect(
      copyAndOpenDraft(vault, "missing", "csdn", {
        async copy() {},
        open(url) {
          opened.push(url);
        },
      }),
    ).rejects.toThrow(/未找到/);
    expect(opened).toEqual([]);
  });

  it("opens the editor after a failed push and skips that when the push works", async () => {
    let opened = 0;
    const pushed = await recoverPush({
      async push() {},
      async fallback() {
        opened += 1;
      },
    });
    expect(pushed).toEqual({ ok: true, via: "push" });
    expect(opened).toBe(0);

    const recovered = await recoverPush({
      async push() {
        throw new Error("桥未启动");
      },
      async fallback() {
        opened += 1;
      },
    });
    expect(recovered).toEqual({ ok: true, via: "fallback", error: "桥未启动" });
    expect(opened).toBe(1);

    const failed = await recoverPush({
      async push() {
        throw new Error("推送失败：invalid token");
      },
      async fallback() {
        throw new Error("复制并打开失败");
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toBe("推送失败：invalid token。复制并打开失败");
  });
});

describe("fallback command", () => {
  it("registers 复制并打开创作页", () => {
    const commands: { id: string; name: string }[] = [];
    registerFallbackCommand(
      {
        addCommand(command: { id: string; name: string }) {
          commands.push(command);
        },
      } as unknown as Plugin,
      async () => {},
    );
    expect(commands.map((command) => ({ id: command.id, name: command.name }))).toEqual([
      { id: "copy-open-compose", name: "复制并打开创作页" },
    ]);
  });
});
