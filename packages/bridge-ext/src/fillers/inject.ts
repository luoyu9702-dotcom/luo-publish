import type { FillPayload, FillResult, PushImage } from "./types";

/**
 * Inject a self-contained page function into every frame and retry until the
 * target mounts. Page functions must not click 发布 unless they live in
 * fillers/publish.ts and the user turned auto-publish on.
 */
const INJECT_TIMEOUT_MS = 20_000;
const RETRY_MS = 400;

export function injectAction<P>(
  tabId: number,
  func: (payload: P) => FillResult,
  payload: P,
  fallback: string,
  timeoutMs: number = INJECT_TIMEOUT_MS,
): Promise<FillResult> {
  const deadline = Date.now() + timeoutMs;
  let last: FillResult = { ok: false, reason: fallback };
  const attempt = async (): Promise<FillResult> => {
    while (Date.now() < deadline) {
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "MAIN",
          func,
          args: [payload],
        });
        for (const item of injected ?? []) {
          const result = item?.result;
          if (result && typeof result === "object" && "ok" in result) {
            if (result.ok === true) return result;
            if (typeof result.reason === "string") last = result;
          }
        }
      } catch (err) {
        last = { ok: false, reason: err instanceof Error ? err.message : fallback };
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    return last;
  };
  return attempt();
}

export function injectFill(
  tabId: number,
  func: (payload: FillPayload) => FillResult,
  payload: FillPayload,
  fallback: string,
): Promise<FillResult> {
  return injectAction(tabId, func, payload, fallback);
}

/** Same retry loop for the image upload step, which mounts even later than the text editor. */
export function injectImages(
  tabId: number,
  func: (images: PushImage[]) => FillResult,
  images: PushImage[],
  fallback: string,
): Promise<FillResult> {
  return injectAction(tabId, func, images, fallback);
}
