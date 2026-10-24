import { PLATFORM_ROWS, fillStatusText, isLastFills, type LastFillRecord } from "./last-fills";
import { isPairingState, type PairingState, type PendingResult } from "./pairing";

let paired = false;

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const baseEl = document.querySelector<HTMLInputElement>("#base");
const tokenEl = document.querySelector<HTMLInputElement>("#token");
const pairEl = document.querySelector<HTMLButtonElement>("#pair");
const pullEl = document.querySelector<HTMLButtonElement>("#pull");
const resultEl = document.querySelector<HTMLPreElement>("#result");

function setStatus(text: string, kind: "ok" | "bad" | "idle"): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = kind === "idle" ? "" : kind;
}

function showResult(value: unknown): void {
  if (!resultEl) return;
  resultEl.textContent = JSON.stringify(value, null, 2);
}

function showFills(fills: Record<string, LastFillRecord> | null | undefined): void {
  for (const row of PLATFORM_ROWS) {
    const el = document.querySelector(`#fill-${row.id}`);
    if (el) el.textContent = fillStatusText(row.label, fills?.[row.id]);
  }
}

function showPaired(pairing: PairingState): void {
  paired = true;
  if (baseEl) baseEl.value = pairing.baseUrl;
  if (tokenEl) tokenEl.value = pairing.token;
  setStatus(`已配对 ${pairing.baseUrl}`, "ok");
}

async function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function pull(fromButton: boolean): Promise<void> {
  const result = await send<PendingResult & { lastFills?: Record<string, LastFillRecord> }>({ type: "pending" });
  console.log("luo-publish pending", result);
  if (!result.ok) {
    if (fromButton) {
      setStatus(result.error, "bad");
      showResult(result);
    }
    return;
  }
  if (isLastFills(result.lastFills)) showFills(result.lastFills);
  if (fromButton || result.items.length > 0) showResult(result);
}

pairEl?.addEventListener("click", () => {
  void (async () => {
    const baseUrl = baseEl?.value ?? "";
    const token = tokenEl?.value ?? "";
    const result = await send<{ ok: true; port: number } | { ok: false; error: string }>({
      type: "pair",
      baseUrl,
      token,
    });
    if (!result.ok) {
      paired = false;
      setStatus(`配对失败：${result.error}`, "bad");
      return;
    }
    const pairing = { baseUrl: `http://127.0.0.1:${result.port}`, token: token.trim(), paired: true as const, port: result.port };
    if (isPairingState(pairing)) showPaired(pairing);
    else setStatus(`已配对 127.0.0.1:${result.port}`, "ok");
  })();
});

pullEl?.addEventListener("click", () => {
  void pull(true);
});

void send<{ ok: true; pairing: PairingState | null; lastFills?: Record<string, LastFillRecord> }>({ type: "state" }).then((state) => {
  if (state?.pairing) showPaired(state.pairing);
  else setStatus("未配对", "idle");
  if (isLastFills(state?.lastFills)) showFills(state.lastFills);
});

const timer = window.setInterval(() => {
  if (!paired) return;
  void pull(false);
}, 2000);
window.addEventListener("unload", () => window.clearInterval(timer));
