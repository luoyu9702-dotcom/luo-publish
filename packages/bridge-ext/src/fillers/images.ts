import { injectImages } from "./inject";
import type { FillResult, PushImage } from "./types";

/** The hidden file input behind each platform's image button. */
const FILE_INPUT_SELECTORS = ['input[type="file"][accept*="image"]', 'input[type="file"]'];

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Put the images into the editor's file input and fire change, so the page
 * starts its own upload. This function is injected into the page, so it must
 * not call other module functions and must not click 发布.
 */
export function applyImageUpload(images: PushImage[], root: ParentNode = document): FillResult {
  if (images.length === 0) return { ok: true };
  let input: Element | null = null;
  for (const selector of FILE_INPUT_SELECTORS) {
    input = root.querySelector(selector);
    if (input) break;
  }
  if (!input) return { ok: false, reason: "未找到图片上传入口" };

  const node = input as HTMLInputElement;
  const files = images.map((image) => new File([base64ToBytes(image.data)], image.name, { type: image.mime }));
  let assigned = false;
  if (typeof DataTransfer !== "undefined") {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    node.files = transfer.files;
    assigned = true;
  }
  if (!assigned) {
    // No DataTransfer (old engines, tests): define files directly and let change carry them.
    Object.defineProperty(node, "files", { value: files, configurable: true });
  }
  if (typeof node.dispatchEvent === "function" && typeof Event !== "undefined") {
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { ok: true };
}

/** Upload the payload images into the open editor tab, retrying until the file input mounts. */
export async function uploadImages(tabId: number, images: PushImage[], fallback: string): Promise<FillResult> {
  return injectImages(tabId, applyImageUpload, images, fallback);
}
