/** One uploaded image: base64 payload handed over by the plugin. */
export type PushImage = { name: string; mime: string; data: string };

export type FillPayload = { title: string; markdown: string; images?: PushImage[] };

export type FillResult = { ok: true } | { ok: false; reason: string };
