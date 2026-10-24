import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findIngestedRawPath } from "../src/ingest-gate";
import { buildSourceSummary } from "../src/vault-io";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function vault(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "luo-vault-"));
  dirs.push(dir);
  return dir;
}

function write(root: string, rel: string, text = ""): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

describe("findIngestedRawPath", () => {
  it("returns null when the note has not been ingested", () => {
    const root = vault();
    write(root, "Notes/foo.md", "# 标题\n");
    expect(findIngestedRawPath(root, "Notes/foo.md")).toBeNull();
    expect(findIngestedRawPath(root, "Notes\\foo.md")).toBeNull();
  });

  it("returns the raw path after the ingest layout is on disk", () => {
    const root = vault();
    const raw = "raw/sources/inbox/foo.md";
    write(root, "Notes/foo.md", "# 标题\n");
    write(root, raw, "# 标题\n");
    write(
      root,
      "wiki/sources/foo.md",
      buildSourceSummary({ title: "foo", rawPath: raw, ingested: "2026-10-24" }),
    );
    expect(findIngestedRawPath(root, "Notes/foo.md")).toBe(raw);
    expect(findIngestedRawPath(root, "Notes\\bar.md")).toBeNull();
  });

  it("finds a raw copy when the wiki stub is missing", () => {
    const root = vault();
    write(root, "raw/sources/quant/demo.md", "body");
    expect(findIngestedRawPath(root, "demo.md")).toBe("raw/sources/quant/demo.md");
  });

  it("ignores a wiki stub whose raw file is missing", () => {
    const root = vault();
    write(
      root,
      "wiki/sources/foo.md",
      buildSourceSummary({ title: "foo", rawPath: "raw/sources/inbox/foo.md", ingested: "2026-10-24" }),
    );
    expect(findIngestedRawPath(root, "Notes/foo.md")).toBeNull();
  });
});
