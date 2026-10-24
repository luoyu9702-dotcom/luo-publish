import { describe, expect, it } from "vitest";
import { fillStatusText, mergeLastFills } from "../src/last-fills";

describe("last fill lines", () => {
  it("lists each platform as empty, filled, or failed", () => {
    expect(fillStatusText("小红书", undefined)).toBe("小红书：尚未填写");
    expect(fillStatusText("CSDN", { ok: true, at: "2026-10-23T00:00:00.000Z" })).toBe("CSDN：已填入");
    expect(fillStatusText("X", { ok: false, reason: "未找到 X 发帖输入框", at: "2026-10-23T00:00:00.000Z" })).toBe(
      "X：失败：未找到 X 发帖输入框",
    );
  });

  it("keeps earlier platforms when a later fill arrives", () => {
    const next = mergeLastFills(
      { csdn: { ok: true, at: "2026-10-23T00:00:00.000Z" } },
      [{ platform: "xiaohongshu", ok: false, reason: "未找到小红书标题或正文编辑区" }],
      "2026-10-23T01:00:00.000Z",
    );
    expect(next.csdn).toEqual({ ok: true, at: "2026-10-23T00:00:00.000Z" });
    expect(next.xiaohongshu).toEqual({
      ok: false,
      reason: "未找到小红书标题或正文编辑区",
      at: "2026-10-23T01:00:00.000Z",
    });
  });
});
