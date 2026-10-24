import type { TgSettings } from "./settings";

export type TgSendResult = { ok: boolean; reason?: string };

const TG_API = "https://api.telegram.org";

/**
 * Send a message to a TG channel via Bot API. Tries Markdown first; if Telegram
 * rejects the entities, retries once as plain text so the content still goes out.
 * Never auto-retries on failure beyond that single degrade (no duplicate posts).
 */
export async function sendTgMessage(settings: TgSettings, text: string): Promise<TgSendResult> {
  if (!settings.token || !settings.chatId) {
    return { ok: false, reason: "未配置 TG Bot Token 或频道 ID" };
  }
  const url = `${TG_API}/bot${settings.token}/sendMessage`;
  const attempt = async (useMarkdown: boolean): Promise<TgSendResult> => {
    const body: Record<string, unknown> = { chat_id: settings.chatId, text };
    if (useMarkdown) body.parse_mode = "Markdown";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (res.ok && data?.ok === true) return { ok: true };
      const reason = data?.description ?? `HTTP ${res.status}`;
      return { ok: false, reason };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "无法连接 Telegram" };
    }
  };
  const first = await attempt(true);
  if (first.ok) return first;
  return attempt(false);
}
