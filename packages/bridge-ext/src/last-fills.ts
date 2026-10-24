import type { FillResult } from "./fillers/types";

export const LAST_FILLS_KEY = "luoLastFills";

export const PLATFORM_ROWS = [
  { id: "x", label: "X" },
  { id: "bilibili", label: "B站专栏" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "csdn", label: "CSDN" },
] as const;

export type LastFillRecord = {
  ok: boolean;
  reason?: string;
  at: string;
  stage?: "fill" | "publish";
};

export function fillStatusText(label: string, record: LastFillRecord | undefined): string {
  if (!record) return `${label}：尚未填写`;
  if (record.ok) return record.stage === "publish" ? `${label}：已发布` : `${label}：已填入`;
  return `${label}：失败：${record.reason ?? "未知原因"}`;
}

export function isLastFills(value: unknown): value is Record<string, LastFillRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.ok === "boolean" &&
      typeof record.at === "string" &&
      (record.reason === undefined || typeof record.reason === "string") &&
      (record.stage === undefined || record.stage === "fill" || record.stage === "publish")
    );
  });
}

export function mergeLastFills(
  prev: Record<string, LastFillRecord>,
  fills: Array<{ platform: string } & FillResult & { stage?: "fill" | "publish" }>,
  at: string,
): Record<string, LastFillRecord> {
  const next = { ...prev };
  for (const fill of fills) {
    const record: LastFillRecord = fill.ok ? { ok: true, at } : { ok: false, reason: fill.reason, at };
    if (fill.stage) record.stage = fill.stage;
    next[fill.platform] = record;
  }
  return next;
}
