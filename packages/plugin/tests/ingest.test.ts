import { describe, it, expect } from "vitest";
import { formatShanghaiStamp, planIngest } from "../src/ingest";

describe("planIngest", () => {
  it("routes inbox domain to raw/sources/inbox and builds log line", () => {
    const p = planIngest("/vault", "Notes/foo.md", "inbox");
    expect(p.rawDest).toBe("raw/sources/inbox/foo.md");
    expect(p.sourceWikiPath).toMatch(/^wiki\/sources\//);
    expect(p.logLine).toMatch(/^## \[\d{4}-\d{2}-\d{2}/);
    expect(p.logLine).toContain("ingest |");
  });

  it("formats the log stamp in Asia/Shanghai, not UTC", () => {
    expect(formatShanghaiStamp(new Date("2026-10-23T16:30:00.000Z"))).toBe("2026-10-24 00:30");
  });
});
