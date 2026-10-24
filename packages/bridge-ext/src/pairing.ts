import type { PushImage } from "./fillers/types";

export type PairOk = { ok: true; port: number };
export type PairErr = { ok: false; error: string };
export type PairResult = PairOk | PairErr;

export type PendingItem = {
  platform: string;
  title: string;
  markdown: string;
  images?: PushImage[];
  slug?: string;
  autoPublish?: boolean;
};

export type FillReport = {
  slug: string;
  platform: string;
  stage: "fill" | "publish";
  ok: boolean;
  reason?: string;
};

export type ReportResult = { ok: true } | { ok: false; error: string };

export type PendingResult = { ok: true; items: PendingItem[] } | PairErr;

export type PairingState = {
  baseUrl: string;
  token: string;
  paired: true;
  port: number;
};

export const PAIRING_KEY = "luoPairing";

const HOST_ERROR = "桥地址必须是 http://127.0.0.1:端口";

/** Accept a full loopback URL, `127.0.0.1:port`, or a port. Reject every other host. */
export function normalizeBridgeBase(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (/^\d{1,5}$/.test(candidate)) candidate = `http://127.0.0.1:${candidate}`;
  else if (/^127\.0\.0\.1:\d{1,5}$/.test(candidate)) candidate = `http://${candidate}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.hostname !== "127.0.0.1") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://127.0.0.1:${port}`;
}

export function isPairingState(value: unknown): value is PairingState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.paired === true &&
    typeof record.baseUrl === "string" &&
    normalizeBridgeBase(record.baseUrl) === record.baseUrl &&
    typeof record.token === "string" &&
    record.token.length > 0 &&
    typeof record.port === "number"
  );
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function requestPair(baseUrl: string, token: string): Promise<PairResult> {
  const base = normalizeBridgeBase(baseUrl);
  if (!base) return { ok: false, error: HOST_ERROR };
  try {
    const res = await fetch(`${base}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await readJson(res);
    if (body?.ok === true && typeof body.port === "number") return { ok: true, port: body.port };
    if (body?.ok === false && typeof body.error === "string") return { ok: false, error: body.error };
    return { ok: false, error: "配对响应无效" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "配对失败" };
  }
}

export async function requestPending(baseUrl: string, token: string): Promise<PendingResult> {
  const base = normalizeBridgeBase(baseUrl);
  if (!base) return { ok: false, error: HOST_ERROR };
  try {
    const res = await fetch(`${base}/pending`, {
      headers: { "X-Luo-Token": token },
    });
    const body = await readJson(res);
    if (body?.ok === true && Array.isArray(body.items)) {
      return { ok: true, items: body.items as PendingItem[] };
    }
    if (body?.ok === false && typeof body.error === "string") return { ok: false, error: body.error };
    return { ok: false, error: "拉取响应无效" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "拉取失败" };
  }
}

/** Tell the plugin bridge how a fill/publish went, so status.json can follow along. */
export async function requestReport(baseUrl: string, token: string, report: FillReport): Promise<ReportResult> {
  const base = normalizeBridgeBase(baseUrl);
  if (!base) return { ok: false, error: HOST_ERROR };
  try {
    const res = await fetch(`${base}/report`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Luo-Token": token },
      body: JSON.stringify(report),
    });
    const body = await readJson(res);
    if (body?.ok === true) return { ok: true };
    if (body?.ok === false && typeof body.error === "string") return { ok: false, error: body.error };
    return { ok: false, error: "回报响应无效" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "回报失败" };
  }
}
