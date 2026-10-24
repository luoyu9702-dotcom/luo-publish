import { randomBytes } from "crypto";
import http from "http";
import { tmpdir } from "os";
import path from "path";
import { PLATFORMS, type Platform } from "./outbox";
import type { PushImage } from "./images";
import { drain, enqueue } from "./queue-store";

/**
 * Localhost bridge for the later browser extension.
 * Binds 127.0.0.1 only.
 * POST /pair { token } → { ok, port }
 * POST /push with X-Luo-Token enqueues { platform, title, markdown, images?, slug?, autoPublish? } onto the plugin-private queue file.
 * 「推送到浏览器草稿」calls that enqueue. The extension does not receive plugin HTTP and does not read the file.
 * GET /pending with X-Luo-Token drains the file and returns the items. A new process with the same path still sees them.
 * POST /report with X-Luo-Token lets the extension report a fill/publish result back; onReport writes it into status.json.
 * The extension pulls while its popup is open, and when the user presses「拉取并填入」.
 * This process does not call the browser and does not publish.
 */

export type PushItem = {
  platform: Platform;
  title: string;
  markdown: string;
  images?: PushImage[];
  slug?: string;
  autoPublish?: boolean;
};

export type FillReport = {
  slug: string;
  platform: Platform;
  stage: "fill" | "publish";
  ok: boolean;
  reason?: string;
};

export type BridgeHandle = {
  address: string;
  port: number;
  setToken(token: string): void;
  stop(): Promise<void>;
};

export type BridgeOptions = {
  onReport?: (report: FillReport) => void;
};

export type TokenStore = {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
};

export type PushValidation =
  | { ok: true; item: PushItem }
  | { ok: false; error: "missing token" | "invalid token" | "unknown platform" | "invalid slug" | "invalid body" };

export type ReportValidation =
  | { ok: true; report: FillReport }
  | { ok: false; error: "missing token" | "invalid token" | "unknown platform" | "invalid slug" | "invalid body" };

export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function isSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    value !== "." &&
    value !== ".."
  );
}

export async function ensureBridgeToken(store: TokenStore): Promise<string> {
  const data = asRecord(await store.loadData());
  const existing = data.bridgeToken;
  if (typeof existing === "string" && existing.length > 0) return existing;
  const bridgeToken = generateToken();
  await store.saveData({ ...data, bridgeToken });
  return bridgeToken;
}

export async function regenerateBridgeToken(store: TokenStore): Promise<string> {
  const data = asRecord(await store.loadData());
  const bridgeToken = generateToken();
  await store.saveData({ ...data, bridgeToken });
  return bridgeToken;
}

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

function checkToken(
  tokenHeader: string | undefined,
  expectedToken: string,
): { ok: true } | { ok: false; error: "missing token" | "invalid token" } {
  const token = tokenHeader?.trim() ?? "";
  if (!token) return { ok: false, error: "missing token" };
  if (token !== expectedToken) return { ok: false, error: "invalid token" };
  return { ok: true };
}

function isPushImage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.mime === "string" && typeof record.data === "string";
}

export function validatePush(input: {
  tokenHeader: string | undefined;
  expectedToken: string;
  body: unknown;
}): PushValidation {
  const gate = checkToken(input.tokenHeader, input.expectedToken);
  if (!gate.ok) return gate;

  const body = asRecord(input.body);
  if (!Object.keys(body).length && (input.body === null || typeof input.body !== "object" || Array.isArray(input.body))) {
    return { ok: false, error: "invalid body" };
  }
  const platform = body.platform;
  if (typeof platform !== "string" || !isPlatform(platform)) {
    return typeof platform === "string" ? { ok: false, error: "unknown platform" } : { ok: false, error: "invalid body" };
  }
  if (typeof body.title !== "string" || typeof body.markdown !== "string") {
    return { ok: false, error: "invalid body" };
  }
  const item: PushItem = { platform, title: body.title, markdown: body.markdown };
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || !body.images.every(isPushImage)) {
      return { ok: false, error: "invalid body" };
    }
    item.images = body.images as PushImage[];
  }
  if (body.slug !== undefined) {
    if (!isSlug(body.slug)) return { ok: false, error: "invalid slug" };
    item.slug = body.slug.trim();
  }
  if (body.autoPublish !== undefined) {
    if (typeof body.autoPublish !== "boolean") return { ok: false, error: "invalid body" };
    item.autoPublish = body.autoPublish;
  }
  return { ok: true, item };
}

export function validateReport(input: {
  tokenHeader: string | undefined;
  expectedToken: string;
  body: unknown;
}): ReportValidation {
  const gate = checkToken(input.tokenHeader, input.expectedToken);
  if (!gate.ok) return gate;

  const body = asRecord(input.body);
  if (!isSlug(body.slug)) return { ok: false, error: "invalid slug" };
  const platform = body.platform;
  if (typeof platform !== "string" || !isPlatform(platform)) {
    return typeof platform === "string" ? { ok: false, error: "unknown platform" } : { ok: false, error: "invalid body" };
  }
  const stage = body.stage;
  if (stage !== "fill" && stage !== "publish") return { ok: false, error: "invalid body" };
  if (typeof body.ok !== "boolean") return { ok: false, error: "invalid body" };
  const report: FillReport = { slug: body.slug.trim(), platform, stage, ok: body.ok };
  if (body.reason !== undefined) {
    if (typeof body.reason !== "string") return { ok: false, error: "invalid body" };
    report.reason = body.reason;
  }
  return { ok: true, report };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Luo-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    ...corsHeaders(),
  });
  res.end(json);
}

function statusFor(error: string): number {
  return error === "missing token" || error === "invalid token" ? 401 : 400;
}

function headerToken(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Text routes stay small; /push carries base64 images (4 × 5MB raw ≈ 27MB encoded). */
const DEFAULT_BODY_LIMIT = 1_000_000;
const PUSH_BODY_LIMIT = 48_000_000;

function readBody(req: http.IncomingMessage, limit = DEFAULT_BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

type BridgeState = { token: string; queuePath: string; port: number; onReport?: (report: FillReport) => void };

async function handle(req: http.IncomingMessage, res: http.ServerResponse, state: BridgeState): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  const path = (req.url ?? "/").split("?")[0];
  const tokenHeader = headerToken(req.headers["x-luo-token"]);

  if (req.method === "GET" && path === "/pending") {
    const gate = checkToken(tokenHeader, state.token);
    if (!gate.ok) {
      sendJson(res, statusFor(gate.error), { ok: false, error: gate.error });
      return;
    }
    const items = drain(state.queuePath);
    sendJson(res, 200, { ok: true, items });
    return;
  }

  if (req.method !== "POST" || (path !== "/pair" && path !== "/push" && path !== "/report")) {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  let parsed: unknown = {};
  try {
    const raw = await readBody(req, path === "/push" ? PUSH_BODY_LIMIT : DEFAULT_BODY_LIMIT);
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid body" });
    return;
  }

  if (path === "/pair") {
    const tokenValue = asRecord(parsed).token;
    const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
    if (!token) {
      sendJson(res, 401, { ok: false, error: "missing token" });
      return;
    }
    if (token !== state.token) {
      sendJson(res, 401, { ok: false, error: "invalid token" });
      return;
    }
    sendJson(res, 200, { ok: true, port: state.port });
    return;
  }

  if (path === "/report") {
    const result = validateReport({ tokenHeader, expectedToken: state.token, body: parsed });
    if (!result.ok) {
      sendJson(res, statusFor(result.error), { ok: false, error: result.error });
      return;
    }
    state.onReport?.(result.report);
    sendJson(res, 200, { ok: true });
    return;
  }

  const result = validatePush({ tokenHeader, expectedToken: state.token, body: parsed });
  if (!result.ok) {
    sendJson(res, statusFor(result.error), { ok: false, error: result.error });
    return;
  }
  enqueue(state.queuePath, { ...result.item, enqueuedAt: new Date().toISOString() });
  sendJson(res, 200, { ok: true });
}

/** Listen on 127.0.0.1 only. Port 0 asks the OS for a free port. queuePath defaults to a temp file. */
export function startBridge(token: string, queuePath?: string, options: BridgeOptions = {}): Promise<BridgeHandle> {
  const state: BridgeState = {
    token,
    queuePath: queuePath ?? path.join(tmpdir(), `luo-publish-queue-${randomBytes(8).toString("hex")}.json`),
    port: 0,
    onReport: options.onReport,
  };
  const server = http.createServer((req, res) => {
    void handle(req, res, state).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "bridge error" });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("bridge did not bind a TCP port"));
        return;
      }
      state.port = addr.port;
      resolve({
        address: addr.address,
        port: addr.port,
        setToken(next: string) {
          state.token = next;
        },
        stop() {
          return new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          });
        },
      });
    });
  });
}
