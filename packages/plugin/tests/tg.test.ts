import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTgMessage } from "../src/tg";

type FetchCall = [string, { body: string }];

type FetchResp = { ok: boolean; status: number; json: () => Promise<unknown> };

/** Each entry is one call's response; cycles if there are more calls than entries. */
function mockFetch(payloads: FetchResp[] | FetchResp) {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  let count = 0;
  const fetchMock = vi.fn(async () => {
    const idx = Math.min(count, list.length - 1);
    count += 1;
    return list[idx];
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

function resp(payload: unknown, ok = true, status = 200): FetchResp {
  return { ok, status, json: async () => payload };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendTgMessage", () => {
  it("returns an error when token or chat id is missing", async () => {
    const result = await sendTgMessage({ token: "t" }, "hi");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("posts to the Bot API with Markdown first and succeeds", async () => {
    const fetchMock = mockFetch(resp({ ok: true }));
    const result = await sendTgMessage({ token: "T", chatId: "@c" }, "hello");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as FetchCall[];
    expect(url).toContain("/botT/sendMessage");
    expect(JSON.parse(init.body)).toEqual({ chat_id: "@c", text: "hello", parse_mode: "Markdown" });
  });

  it("falls back to plain text when Markdown entities are rejected", async () => {
    const fetchMock = mockFetch([resp({ ok: false, description: "can't parse entities" }, false, 400), resp({ ok: true })]);
    const result = await sendTgMessage({ token: "T", chatId: "@c" }, "hi *x*");
    expect(result.ok).toBe(true); // plain retry succeeds
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetchMock.mock.calls[1] as FetchCall)[1].body);
    expect(second.parse_mode).toBeUndefined();
  });

  it("reports the reason when both attempts fail", async () => {
    const fetchMock = mockFetch([resp({ ok: false, description: "forbidden" }, false, 403), resp({ ok: false, description: "forbidden" }, false, 403)]);
    const result = await sendTgMessage({ token: "T", chatId: "@c" }, "hi");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("forbidden");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
