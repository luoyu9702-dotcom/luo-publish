import { afterEach, describe, expect, it } from "vitest";
import type { TFile, Vault } from "obsidian";
import { startBridge, type BridgeHandle } from "../src/bridge-server";
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_POST, attachImages, resolveImagePath } from "../src/images";
import { writeOutbox } from "../src/outbox";
import { pushDraft } from "../src/status";

const handles: BridgeHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

type Stored = { kind: "file"; text?: string; binary?: ArrayBuffer } | { kind: "folder" };

function fakeVault(initial: Record<string, Stored> = {}) {
  const files = new Map<string, Stored>(Object.entries(initial));
  const asNode = (path: string, hit: Stored) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (hit.kind === "folder") return { path, kind: "folder" };
    const dot = name.lastIndexOf(".");
    return { path, kind: "file", name, extension: dot > 0 ? name.slice(dot + 1) : "" };
  };
  const vault = {
    getAbstractFileByPath(path: string) {
      const hit = files.get(path);
      return hit ? asNode(path, hit) : null;
    },
    async createFolder(path: string) {
      if (files.has(path)) throw new Error(`exists ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${path}`);
      files.set(path, { kind: "folder" });
      return { path };
    },
    async create(path: string, data: string) {
      if (files.has(path)) throw new Error(`exists ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !files.has(parent)) throw new Error(`missing parent ${path}`);
      files.set(path, { kind: "file", text: data });
      return { path };
    },
    async read(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || hit.text === undefined) throw new Error(`no text ${file.path}`);
      return hit.text;
    },
    async modify(file: { path: string }, data: string) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file") throw new Error(`no text ${file.path}`);
      files.set(file.path, { kind: "file", text: data });
    },
    async readBinary(file: { path: string }) {
      const hit = files.get(file.path);
      if (!hit || hit.kind !== "file" || !hit.binary) throw new Error(`no binary ${file.path}`);
      return hit.binary;
    },
  };
  return { files, vault: vault as unknown as Vault };
}

const helloBytes = new TextEncoder().encode("hello").buffer;

describe("image path resolution", () => {
  it("finds a vault path as written, vault-absolute, and relative to the note", () => {
    const { vault } = fakeVault({
      "img/b.png": { kind: "file", binary: helloBytes },
      "Notes/img/a.png": { kind: "file", binary: helloBytes },
    });
    expect(resolveImagePath(vault, "img/b.png")?.path).toBe("img/b.png");
    expect(resolveImagePath(vault, "/img/b.png")?.path).toBe("img/b.png");
    expect(resolveImagePath(vault, "./img/b.png")?.path).toBe("img/b.png");
    expect(resolveImagePath(vault, "a.png", "Notes/img")?.path).toBe("Notes/img/a.png");
    expect(resolveImagePath(vault, "missing.png")).toBeNull();
    expect(resolveImagePath(vault, "https://example.com/a.png")).toBeNull();
    expect(resolveImagePath(vault, "data:image/png;base64,AAAA")).toBeNull();
  });
});

describe("attachImages", () => {
  it("reads a vault image into base64", async () => {
    const { vault } = fakeVault({ "img/a.png": { kind: "file", binary: helloBytes } });
    const result = await attachImages(vault, ["img/a.png"]);
    expect(result.notes).toEqual([]);
    expect(result.images).toEqual([{ name: "a.png", mime: "image/png", data: btoa("hello") }]);
  });

  it("skips missing and remote images with a note instead of failing", async () => {
    const { vault } = fakeVault();
    const result = await attachImages(vault, ["missing.png", "https://example.com/x.png"]);
    expect(result.images).toEqual([]);
    expect(result.notes).toEqual(["图片不存在，已跳过：missing.png", "图片是网络地址，已跳过：https://example.com/x.png"]);
  });

  it("skips an image over the size limit", async () => {
    const { vault } = fakeVault({ "img/big.png": { kind: "file", binary: new ArrayBuffer(MAX_IMAGE_BYTES + 1) } });
    const result = await attachImages(vault, ["img/big.png"]);
    expect(result.images).toEqual([]);
    expect(result.notes).toEqual(["图片超过 5MB，已跳过：img/big.png"]);
  });

  it(`keeps only the first ${MAX_IMAGES_PER_POST} images`, async () => {
    const initial: Record<string, Stored> = {};
    for (const name of ["1.png", "2.png", "3.png", "4.png", "5.png"]) initial[`img/${name}`] = { kind: "file", binary: helloBytes };
    const { vault } = fakeVault(initial);
    const result = await attachImages(vault, ["img/1.png", "img/2.png", "img/3.png", "img/4.png", "img/5.png"]);
    expect(result.images.map((image) => image.name)).toEqual(["1.png", "2.png", "3.png", "4.png"]);
    expect(result.notes).toEqual([`图片超过 ${MAX_IMAGES_PER_POST} 张，仅上传前 ${MAX_IMAGES_PER_POST} 张`]);
  });
});

describe("pushDraft with images", () => {
  const note = '---\ntitle: "标题"\n---\n\n![图](img/a.png)\n\n正文\n';

  it("uploads vault images for 小红书 and strips the image lines from the body", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    const { vault } = fakeVault({
      "Notes/foo.md": { kind: "file", text: note },
      "Notes/img/a.png": { kind: "file", binary: helloBytes },
    });
    await writeOutbox(vault, "foo", note, "标题", "Notes/foo.md");

    const notes: string[] = [];
    await pushDraft(
      vault,
      "foo",
      "xiaohongshu",
      { port: handle.port, token: "secret-token" },
      "filled",
      false,
      (collected) => notes.push(...collected),
    );

    const res = await fetch(`http://127.0.0.1:${handle.port}/pending`, { headers: { "x-luo-token": "secret-token" } });
    const body = (await res.json()) as {
      items: Array<{ markdown: string; images?: Array<{ name: string; mime: string; data: string }> }>;
    };
    expect(body.items[0]?.images).toEqual([{ name: "a.png", mime: "image/png", data: btoa("hello") }]);
    expect(body.items[0]?.markdown).not.toContain("![图]");
    expect(body.items[0]?.markdown).toContain("正文");
    expect(notes).toEqual([]);
  });

  it("keeps the markdown image lines for B站专栏 and says the upload is manual", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    const { vault } = fakeVault({
      "Notes/foo.md": { kind: "file", text: note },
      "Notes/img/a.png": { kind: "file", binary: helloBytes },
    });
    await writeOutbox(vault, "foo", note, "标题", "Notes/foo.md");

    const notes: string[] = [];
    await pushDraft(
      vault,
      "foo",
      "bilibili",
      { port: handle.port, token: "secret-token" },
      "filled",
      false,
      (collected) => notes.push(...collected),
    );

    const res = await fetch(`http://127.0.0.1:${handle.port}/pending`, { headers: { "x-luo-token": "secret-token" } });
    const body = (await res.json()) as { items: Array<{ markdown: string; images?: unknown[] }> };
    expect(body.items[0]?.images).toBeUndefined();
    expect(body.items[0]?.markdown).toContain("![图](img/a.png)");
    expect(notes).toEqual(["B站专栏：暂不支持自动传图，请在编辑器手动上传"]);
  });

  it("reports a missing image but still pushes the text", async () => {
    const handle = await startBridge("secret-token");
    handles.push(handle);
    const { vault } = fakeVault({ "Notes/foo.md": { kind: "file", text: note } });
    await writeOutbox(vault, "foo", note, "标题", "Notes/foo.md");

    const notes: string[] = [];
    await pushDraft(
      vault,
      "foo",
      "xiaohongshu",
      { port: handle.port, token: "secret-token" },
      "filled",
      false,
      (collected) => notes.push(...collected),
    );

    const res = await fetch(`http://127.0.0.1:${handle.port}/pending`, { headers: { "x-luo-token": "secret-token" } });
    const body = (await res.json()) as { items: Array<{ markdown: string; images?: unknown[] }> };
    expect(body.items[0]?.images).toBeUndefined();
    expect(notes).toEqual(["图片不存在，已跳过：img/a.png"]);
  });
});
