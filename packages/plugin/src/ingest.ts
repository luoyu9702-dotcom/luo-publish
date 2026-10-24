export type Domain =
  | "ai-tools" | "ai-agents" | "quant"
  | "overseas-accounts" | "digital-human" | "od-exam" | "inbox";

export type IngestPlan = {
  rawDest: string;
  sourceWikiPath: string;
  indexStub: string;
  logLine: string;
};

function shanghaiPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((part) => part.type === type);
  if (!found) throw new Error(`missing date part ${type}`);
  return found.value;
}

/** `YYYY-MM-DD HH:mm` in Asia/Shanghai. */
export function formatShanghaiStamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const year = shanghaiPart(parts, "year");
  const month = shanghaiPart(parts, "month");
  const day = shanghaiPart(parts, "day");
  const hour = shanghaiPart(parts, "hour");
  const minute = shanghaiPart(parts, "minute");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function planIngest(vaultRoot: string, notePath: string, domain: Domain): IngestPlan {
  const base = notePath.split(/[/\\]/).pop()!.replace(/\.md$/i, "");
  const rawDest = `raw/sources/${domain}/${base}.md`;
  const sourceWikiPath = `wiki/sources/${base}.md`;
  const stamp = formatShanghaiStamp(new Date());
  const logLine = `## [${stamp} Asia/Shanghai] ingest | ${base}`;
  const indexStub = `- [${base}](${sourceWikiPath})`;
  return { rawDest, sourceWikiPath, indexStub, logLine };
}
