import type { TFile, Vault } from "obsidian";

/** One uploaded image: base64 payload ready for the browser extension. */
export type PushImage = { name: string; mime: string; data: string };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_POST = 4;

export type ImageAttachResult = { images: PushImage[]; notes: string[] };

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function isRemote(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith("data:");
}

/**
 * Find a markdown image path in the vault: as written, as a vault-absolute path,
 * then relative to each candidate base directory (task folder first, then source folder).
 */
export function resolveImagePath(vault: Vault, rawPath: string, baseDir: string | string[] = ""): TFile | null {
  const clean = rawPath.trim().replace(/^\.\//, "");
  if (!clean || isRemote(clean)) return null;
  const candidates = [clean, clean.replace(/^\/+/, "")];
  const dirs = Array.isArray(baseDir) ? baseDir : baseDir ? [baseDir] : [];
  for (const rawDir of dirs) {
    const dir = rawDir.replace(/^\/+/, "").replace(/\/+$/, "");
    if (dir) candidates.push(`${dir}/${clean.replace(/^\/+/, "")}`);
  }
  for (const candidate of candidates) {
    const file = vault.getAbstractFileByPath(candidate);
    if (file && typeof (file as TFile).extension === "string") return file as TFile;
  }
  return null;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Read vault images into base64 uploads. Missing, remote, and oversized files are
 * skipped with a note instead of failing the whole push.
 */
export async function attachImages(
  vault: Vault,
  paths: readonly string[],
  baseDir: string | string[] = "",
): Promise<ImageAttachResult> {
  const images: PushImage[] = [];
  const notes: string[] = [];
  for (const raw of paths.slice(0, MAX_IMAGES_PER_POST)) {
    const file = resolveImagePath(vault, raw, baseDir);
    if (!file) {
      const clean = raw.trim();
      notes.push(isRemote(clean) ? `图片是网络地址，已跳过：${clean}` : `图片不存在，已跳过：${clean}`);
      continue;
    }
    const bytes = await vault.readBinary(file);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      notes.push(`图片超过 5MB，已跳过：${file.path}`);
      continue;
    }
    images.push({
      name: file.name,
      mime: MIME_BY_EXT[(file.extension ?? "").toLowerCase()] ?? "application/octet-stream",
      data: bytesToBase64(bytes),
    });
  }
  if (paths.length > MAX_IMAGES_PER_POST) {
    notes.push(`图片超过 ${MAX_IMAGES_PER_POST} 张，仅上传前 ${MAX_IMAGES_PER_POST} 张`);
  }
  return { images, notes };
}
