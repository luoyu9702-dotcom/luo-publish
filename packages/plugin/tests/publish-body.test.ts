import { describe, expect, it } from "vitest";
import { buildOutbox } from "../src/outbox";
import { draftToPush } from "../src/status";
import { humanTitle, publishDraft, sanitizePublishBody, shapeDraft, stripFrontmatter, weightedLength } from "../src/publish-body";

const ingested = `---
source: x
author: "@goan999999"
author_name: govin.eth | G哥
post_id: "2113490736327123197"
url: https://x.com/goan999999/status/2113490736327123197
created_at: 2026-10-23T04:40:32.000Z
quoted_id: "2113276336848687614"
ingested: 2026-10-23
note: API text truncated at ~280 chars
---

卧槽！！！Codex 这次是真的要起飞了！

28.6 万 Star! 71 个 Agent!

兄弟们，赶紧给你们的 Codex 装上 ECC！
`;

describe("stripFrontmatter", () => {
  it("drops a leading YAML block and keeps the paragraph breaks", () => {
    expect(stripFrontmatter(ingested)).toBe(
      "卧槽！！！Codex 这次是真的要起飞了！\n\n28.6 万 Star! 71 个 Agent!\n\n兄弟们，赶紧给你们的 Codex 装上 ECC！\n",
    );
    expect(stripFrontmatter("hello\n\nworld\n")).toBe("hello\n\nworld\n");
  });
});

describe("publish body", () => {
  it("uses the first sentence when the only title is a filename slug", () => {
    expect(humanTitle(ingested, "2026-10-23-goan999999-codex-ecc")).toBe("卧槽！！！Codex 这次是真的要起飞了！");
    const body = sanitizePublishBody(ingested, "卧槽！！！Codex 这次是真的要起飞了！");
    expect(body).toBe("28.6 万 Star! 71 个 Agent!\n\n兄弟们，赶紧给你们的 Codex 装上 ECC！\n");
    expect(body).not.toMatch(/source:|author:|author_name:|post_id:|url:|created_at:|quoted_id:|ingested:|^note:/m);
    expect(body).toContain("\n\n");
  });

  it("keeps an H1 that is a real title and does not repeat it in the body", () => {
    const note = "# 真正的标题\n\nhello\n\nworld\n";
    expect(humanTitle(note, "demo")).toBe("真正的标题");
    expect(sanitizePublishBody(note, "真正的标题")).toBe("hello\n\nworld\n");
  });

  it("leaves a thematic break in the article alone", () => {
    const note = "hello\n\n---\n\nworld\n";
    expect(sanitizePublishBody(note, "标题")).toBe("hello\n\n---\n\nworld\n");
  });

  it("sanitizes an old outbox dump at push time", () => {
    const dirty = `---
platform: csdn
slug: "2026-10-23-goan999999-codex-ecc"
title: "2026-10-23-goan999999-codex-ecc"
---

# 2026-10-23-goan999999-codex-ecc

---
source: x
author: "@goan999999"
post_id: "2113490736327123197"
url: https://x.com/goan999999/status/2113490736327123197
created_at: 2026-10-23T04:40:32.000Z
ingested: 2026-10-23
note: API text truncated
---

卧槽！！！Codex 这次是真的要起飞了！

28.6 万 Star!
`;
    const csdn = publishDraft("csdn", dirty);
    expect(csdn.title).toBe("卧槽！！！Codex 这次是真的要起飞了！");
    expect(csdn.markdown).toBe("28.6 万 Star!\n");
    expect(csdn.markdown).not.toContain("# ");
    expect(draftToPush("bilibili", dirty)).toMatchObject({
      title: "卧槽！！！Codex 这次是真的要起飞了！",
      markdown: "28.6 万 Star!\n",
    });
    const xhs = draftToPush("xiaohongshu", dirty);
    expect(xhs.markdown).not.toMatch(/source:|author:/);
    expect(xhs.markdown).toContain("#话题");
    expect(xhs.markdown).toContain("\n\n");
  });

  it("builds four clean drafts from the ingested note", () => {
    const drafts = buildOutbox("2026-10-23-goan999999-codex-ecc", ingested, "2026-10-23-goan999999-codex-ecc");
    for (const platform of ["x", "bilibili", "csdn"] as const) {
      const item = draftToPush(platform, drafts[platform]);
      expect(item.title).toBe("卧槽！！！Codex 这次是真的要起飞了！");
      expect(item.markdown).not.toMatch(/source:|author:|post_id:|created_at:|ingested:/);
      expect(item.markdown.startsWith("# ")).toBe(false);
      expect(item.markdown).toContain("28.6 万 Star!");
    }
    const xhs = draftToPush("xiaohongshu", drafts.xiaohongshu);
    expect(xhs.title).toBe("卧槽！！！Codex 这次是真的要起飞了");
    expect(xhs.markdown).not.toMatch(/source:|author:|post_id:|created_at:|ingested:/);
    expect(xhs.markdown).toContain("28.6 万 Star!");
    expect(draftToPush("x", drafts.x).markdown).not.toContain("#话题");
    expect(draftToPush("xiaohongshu", drafts.xiaohongshu).markdown).toContain("#话题");
  });
});

describe("platform shaping", () => {
  it("counts wide characters as 2 units", () => {
    expect(weightedLength("abc")).toBe(3);
    expect(weightedLength("你好")).toBe(4);
    expect(weightedLength("Codex 起飞")).toBe(10);
  });

  it("truncates an X post at 280 weighted units and reports it", () => {
    const long = "啊".repeat(200);
    const shaped = shapeDraft("x", "", long);
    expect(weightedLength(shaped.markdown)).toBeLessThanOrEqual(280);
    expect(shaped.markdown).toBe(`${"啊".repeat(139)}\n`);
    expect(shaped.notes).toEqual(["X：标题加正文超过 280 字（中文按 2 字计），已截断"]);

    const withTitle = shapeDraft("x", "标题", long);
    expect(weightedLength(withTitle.title) + 2 + weightedLength(withTitle.markdown)).toBeLessThanOrEqual(280);
    expect(withTitle.notes).toHaveLength(1);
  });

  it("keeps an X post under the limit untouched", () => {
    const shaped = shapeDraft("x", "标题", "hello world\n");
    expect(shaped.markdown).toBe("hello world\n");
    expect(shaped.notes).toEqual([]);
  });

  it("flattens markdown syntax for the X text box", () => {
    const shaped = shapeDraft(
      "x",
      "",
      "## 小标题\n\n**加粗** and *斜体* and `代码`\n\n- 列表项\n\n> 引用一句\n\n[链接](https://example.com)\n\n![图](a.png)\n",
    );
    expect(shaped.markdown).toBe(
      "小标题\n\n加粗 and 斜体 and 代码\n\n列表项\n\n引用一句\n\n链接 https://example.com\n",
    );
    expect(shaped.markdown).not.toMatch(/[#*`>\[]/);
  });

  it("clamps a 小红书 title at 20 characters and keeps the topic line", () => {
    const shaped = shapeDraft("xiaohongshu", "这是一个超过二十个字的长标题用来测试截断行为", "正文\n");
    expect(shaped.title).toBe("这是一个超过二十个字的长标题用来测试截断");
    expect(shaped.title).toHaveLength(20);
    expect(shaped.notes).toEqual(["小红书：标题超过 20 字，已截断"]);
    expect(shaped.markdown).toBe("正文\n\n#话题\n");
  });

  it("truncates a 小红书 body at 1000 characters", () => {
    const shaped = shapeDraft("xiaohongshu", "标题", "字".repeat(1200));
    expect([...shaped.markdown]).toHaveLength(1000 + 6);
    expect(shaped.markdown.endsWith("#话题\n")).toBe(true);
    expect(shaped.notes).toEqual(["小红书：正文超过 1000 字，已截断"]);
  });

  it("clamps a B站专栏 title at 40 characters and warns below 200 body characters", () => {
    const clamped = shapeDraft("bilibili", "标".repeat(50), "正文");
    expect(clamped.title).toHaveLength(40);
    expect(clamped.notes[0]).toBe("B站专栏：标题超过 40 字，已截断");
    expect(clamped.notes[1]).toContain("正文不足 200 字");

    const ok = shapeDraft("bilibili", "标题", "正".repeat(250));
    expect(ok.notes).toEqual([]);
  });

  it("clamps a CSDN title at 100 characters", () => {
    const shaped = shapeDraft("csdn", "标".repeat(120), "正文");
    expect(shaped.title).toHaveLength(100);
    expect(shaped.notes).toEqual(["CSDN：标题超过 100 字，已截断"]);
  });

  it("keeps images in the article even when the X body drops them", () => {
    const item = draftToPush("x", "# 标题\n\n![图](a.png)\n");
    expect(item.imagePaths).toEqual(["a.png"]);
    expect(item.markdown).toBe("");
    expect(item.title).toBe("标题");
  });
});
