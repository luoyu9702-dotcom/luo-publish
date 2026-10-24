import { existsSync, readFileSync } from "fs";
import path from "path";
import { planIngest, type Domain } from "./ingest";

const DOMAINS: readonly Domain[] = [
  "ai-tools",
  "ai-agents",
  "quant",
  "overseas-accounts",
  "digital-human",
  "inbox",
];

function noteBase(notePath: string): string {
  return notePath.split(/[/\\]/).pop()?.replace(/\.md$/i, "") ?? "";
}

function rawPathFromWiki(markdown: string): string | null {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const line = /^raw_path:\s*(.+)$/m.exec(fence?.[1] ?? "");
  if (!line?.[1]) return null;
  const raw = line[1].trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return raw.replace(/^["']|["']$/g, "");
  }
}

/** Vault-relative raw path that stays inside raw/sources. */
function existingRaw(vaultRoot: string, rel: string): string | null {
  const normalized = rel.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized.startsWith("raw/sources/") || normalized.split("/").includes("..")) return null;
  const root = path.resolve(vaultRoot);
  const abs = path.resolve(root, normalized);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return existsSync(abs) ? normalized : null;
}

/**
 * Vault-relative raw path when this note was already ingested, otherwise null.
 * Prefers `raw_path` in `wiki/sources/<basename>.md`, then a copy under `raw/sources/<domain>/`.
 */
export function findIngestedRawPath(vaultRoot: string, notePath: string): string | null {
  const base = noteBase(notePath);
  if (!base || base === "." || base === "..") return null;
  const wiki = path.join(vaultRoot, "wiki", "sources", `${base}.md`);
  if (existsSync(wiki)) {
    try {
      const linked = rawPathFromWiki(readFileSync(wiki, "utf8"));
      if (linked) {
        const found = existingRaw(vaultRoot, linked);
        if (found) return found;
      }
    } catch {
      // Unreadable wiki stub. Fall through to the raw copies.
    }
  }
  for (const domain of DOMAINS) {
    const found = existingRaw(vaultRoot, planIngest(vaultRoot, `${base}.md`, domain).rawDest);
    if (found) return found;
  }
  return null;
}
