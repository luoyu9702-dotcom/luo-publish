import { describe, expect, it } from "vitest";
import { applyImageUpload } from "../src/fillers/images";
import type { PushImage } from "../src/fillers/types";

const images: PushImage[] = [
  { name: "a.png", mime: "image/png", data: btoa("hello") },
  { name: "b.png", mime: "image/png", data: btoa("world") },
];

type FakeInput = {
  tagName: string;
  type: string;
  files: unknown;
  events: string[];
  dispatchEvent(event: { type: string }): boolean;
};

function fakeRoot(found: Record<string, FakeInput | null>) {
  return {
    querySelector(selector: string) {
      if (selector.includes("publish") || selector.includes("发布")) return null;
      return found[selector] ?? null;
    },
  } as unknown as ParentNode;
}

function fakeInput(): FakeInput {
  return {
    tagName: "INPUT",
    type: "file",
    files: null,
    events: [],
    dispatchEvent(event: { type: string }) {
      this.events.push(event.type);
      return true;
    },
  };
}

describe("image upload", () => {
  it("assigns nothing and fires no event when there are no images", () => {
    const input = fakeInput();
    const root = fakeRoot({ 'input[type="file"]': input });
    expect(applyImageUpload([], root)).toEqual({ ok: true });
    expect(input.files).toBeNull();
    expect(input.events).toEqual([]);
  });

  it("returns a reason when the page has no file input", () => {
    const result = applyImageUpload(images, fakeRoot({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/未找到/);
  });

  it("writes the images into the file input and fires change", () => {
    const input = fakeInput();
    const root = fakeRoot({ 'input[type="file"][accept*="image"]': null, 'input[type="file"]': input });
    expect(applyImageUpload(images, root)).toEqual({ ok: true });
    const files = input.files as File[];
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.name)).toEqual(["a.png", "b.png"]);
    expect(files.map((file) => file.type)).toEqual(["image/png", "image/png"]);
    expect(input.events).toEqual(["change"]);
  });

  it("prefers a real DataTransfer when the page has one", () => {
    const input = fakeInput();
    const added: string[] = [];
    const original = (globalThis as { DataTransfer?: unknown }).DataTransfer;
    (globalThis as { DataTransfer?: unknown }).DataTransfer = class {
      items = { add: (file: File) => added.push(file.name) };
      get files() {
        return { length: added.length };
      }
    };
    try {
      const root = fakeRoot({ 'input[type="file"]': input });
      expect(applyImageUpload(images, root)).toEqual({ ok: true });
      expect(added).toEqual(["a.png", "b.png"]);
      expect((input.files as { length: number }).length).toBe(2);
      expect(input.events).toEqual(["change"]);
    } finally {
      if (original === undefined) delete (globalThis as { DataTransfer?: unknown }).DataTransfer;
      else (globalThis as { DataTransfer?: unknown }).DataTransfer = original;
    }
  });
});
