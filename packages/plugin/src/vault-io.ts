import { TFile, type Vault } from "obsidian";
import type { Domain } from "./ingest";

export function buildSourceSummary(input: { title: string; rawPath: string; ingested: string }): string {
  return `---
title: ${JSON.stringify(input.title)}
raw_path: ${JSON.stringify(input.rawPath)}
ingested: ${JSON.stringify(input.ingested)}
---

## 要点
`;
}

export function joinLog(existing: string, logLine: string): string {
  const base = existing.replace(/\s*$/, "");
  if (!base) return `${logLine}\n`;
  return `${base}\n\n${logLine}\n`;
}

export function upsertIndexMarkdown(existing: string, domain: Domain, stub: string): string {
  const normalized = existing.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const heading = `## ${domain}`;
  const headingIdx = lines.findIndex((line) => line.trim() === heading);
  if (headingIdx === -1) {
    const base = normalized.replace(/\s*$/, "");
    const prefix = base.length > 0 ? `${base}\n\n` : "";
    return `${prefix}${heading}\n\n${stub}\n`;
  }

  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) {
      end = i;
      break;
    }
  }

  const section = lines.slice(headingIdx + 1, end);
  if (section.some((line) => line.trim() === stub.trim())) {
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  }

  let insertAt = end;
  while (insertAt > headingIdx + 1 && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt -= 1;
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(end);
  const gap = insertAt === headingIdx + 1 ? ["", stub, ""] : [stub, ""];
  const text = [...before, ...gap, ...after].join("\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function ensureParentFolders(vault: Vault, filePath: string): Promise<void> {
  const parts = filePath.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (vault.getAbstractFileByPath(current)) continue;
    await vault.createFolder(current);
  }
}

function asFile(value: { path: string }): TFile {
  return value as TFile;
}

/** Copy note bytes. Refuses to overwrite an existing raw file. */
export async function copyNote(vault: Vault, source: TFile, rawDest: string): Promise<void> {
  if (vault.getAbstractFileByPath(rawDest)) {
    throw new Error(`raw 已存在，未覆盖：${rawDest}`);
  }
  await ensureParentFolders(vault, rawDest);
  const bytes = await vault.readBinary(source);
  await vault.createBinary(rawDest, bytes);
}

/** Create the wiki source stub. An existing page is left unchanged. */
export async function writeSourceSummary(
  vault: Vault,
  wikiPath: string,
  markdown: string,
): Promise<"created" | "exists"> {
  if (vault.getAbstractFileByPath(wikiPath)) return "exists";
  await ensureParentFolders(vault, wikiPath);
  await vault.create(wikiPath, markdown);
  return "created";
}

export async function appendLog(vault: Vault, logLine: string): Promise<void> {
  const path = "wiki/log.md";
  const existing = vault.getAbstractFileByPath(path);
  if (!existing) {
    await ensureParentFolders(vault, path);
    await vault.create(path, joinLog("", logLine));
    return;
  }
  await vault.process(asFile(existing), (data) => joinLog(data, logLine));
}

export async function upsertIndex(vault: Vault, domain: Domain, stub: string): Promise<void> {
  const path = "wiki/index.md";
  const existing = vault.getAbstractFileByPath(path);
  if (!existing) {
    await ensureParentFolders(vault, path);
    await vault.create(path, upsertIndexMarkdown("", domain, stub));
    return;
  }
  await vault.process(asFile(existing), (data) => upsertIndexMarkdown(data, domain, stub));
}
