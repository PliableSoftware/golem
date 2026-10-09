/**
 * R5.2 — `golem watch` pure renderer + byte formatting.
 */

import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStateReport } from "../../../src/cli/session-report.js";
import { formatBytes, renderWatchFrame, runWatch } from "../../../src/cli/watch.js";

function report(overrides: Partial<SessionStateReport> = {}): SessionStateReport {
  return {
    project_dir: "/proj",
    generated_at: "2026-07-16T00:00:00.000Z",
    proxy: { running: true, upstream: "anthropic" },
    compression: { level: "1", name: "lossless", redaction_off: false },
    local_model: { reachable: true },
    autonomy: { level: "manual" },
    blocked: { waiting: false, status: "clear" },
    savings: {
      source: "telemetry",
      project_id: null,
      requests: 10,
      tokens_before: 1000,
      tokens_after: 600,
      tokens_saved: 400,
      per_stage: { dedup: { tokens_before: 1000, tokens_after: 600, tokens_saved: 400 } },
      ccr_refs_stored: 3,
      ccr_refs_retrieved: 1,
      tool_usage: {
        coder: { calls: 2, total_duration_ms: 4000, total_result_bytes: 800, draft_chars: 400 },
      },
      note: "telemetry",
    },
    storage: {
      ccr_bytes: 2048,
      knowledge_bytes: 1_572_864,
      telemetry_bytes: 512,
      webcache_bytes: 0,
    },
    ...overrides,
  };
}

describe("formatBytes", () => {
  it("renders human-readable sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });
  it("never throws on odd input", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("renderWatchFrame", () => {
  it("shows the core state fields (no color)", () => {
    const frame = renderWatchFrame(report(), { color: false });
    expect(frame).toContain("Golem watch");
    expect(frame).toContain("proxy running");
    expect(frame).toContain("→anthropic");
    expect(frame).toContain("1 lossless");
    expect(frame).toContain("saved 40%");
    expect(frame).toContain("dedup");
    expect(frame).toContain("CCR refs: 3 stored / 1 retrieved");
    expect(frame).toContain("1.5 MB"); // knowledge storage
    expect(frame).toContain("coder");
  });

  it("warns LOUDLY when redaction is off (proxy.bypass_all)", () => {
    const frame = renderWatchFrame(
      report({ compression: { level: "off", name: "off", redaction_off: true } }),
      { color: false },
    );
    expect(frame).toContain("REDACTION OFF");
  });

  it("renders an unknown compression level once, without a doubled label or NaN", () => {
    const frame = renderWatchFrame(
      report({ compression: { level: "unknown", name: "unknown", redaction_off: false } }),
      { color: false },
    );
    expect(frame).toContain("compression unknown ");
    expect(frame).not.toContain("unknown unknown");
    expect(frame).not.toContain("NaN");
    expect(frame).not.toContain("REDACTION OFF");
  });

  it("shows a waiting line with the reason", () => {
    const frame = renderWatchFrame(
      report({ blocked: { waiting: true, status: "waiting", reason: "permission prompt" } }),
      { color: false },
    );
    expect(frame).toContain("waiting on you: permission prompt");
  });

  it("shows proxy OFF and unknown liveness distinctly", () => {
    expect(renderWatchFrame(report({ proxy: { running: false, upstream: "foundry" } }))).toContain(
      "proxy OFF",
    );
    expect(renderWatchFrame(report({ proxy: { running: null, upstream: "foundry" } }))).toContain(
      "proxy unknown",
    );
  });
});

describe("renderWatchFrame (DUST3.13 D6, D9)", () => {
  it("D6: footer states the actual refresh cadence, not the default", () => {
    const frame = renderWatchFrame(report(), { refreshMs: 500 });
    expect(frame).toContain("refreshes every 0.5s");
    expect(frame).not.toContain("refreshes every 2s");
  });

  it("D6: footer falls back to the default cadence when none is given", () => {
    expect(renderWatchFrame(report())).toContain("refreshes every 2s");
  });

  it("D9: an unknown proxy state does not wear the running glyph", () => {
    const unknown = renderWatchFrame(report({ proxy: { running: null, upstream: "anthropic" } }));
    const running = renderWatchFrame(report());
    const off = renderWatchFrame(report({ proxy: { running: false, upstream: "anthropic" } }));
    const glyph = (f: string): string => f.split("\r\n")[0]?.replace(/^.*H/, "")[0] ?? "";
    expect(glyph(unknown)).not.toBe(glyph(running));
    expect(glyph(unknown)).not.toBe(glyph(off));
  });
});

const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[3\\dm`);

describe("runWatch (DUST3.13 D5, D9)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function sink(isTTY: boolean): { out: PassThrough; text: () => string } {
    const out = new PassThrough() as PassThrough & { isTTY?: boolean };
    out.isTTY = isTTY;
    let buf = "";
    out.on("data", (c) => {
      buf += String(c);
    });
    return { out, text: () => buf };
  }

  it("D5: NO_COLOR suppresses colour on a TTY when no flag was given", async () => {
    vi.stubEnv("NO_COLOR", "1");
    const { out, text } = sink(true);
    const done = runWatch({ dir: "/proj", out, collect: async () => report() });
    await new Promise((r) => setTimeout(r, 20));
    process.emit("SIGINT");
    await done;
    expect(text()).not.toMatch(ANSI_COLOR);
  });

  it("D5: a non-TTY sink gets no colour by default", async () => {
    vi.stubEnv("NO_COLOR", "");
    const { out, text } = sink(false);
    const done = runWatch({ dir: "/proj", out, collect: async () => report() });
    await new Promise((r) => setTimeout(r, 20));
    process.emit("SIGINT");
    await done;
    expect(text()).not.toMatch(ANSI_COLOR);
  });

  it("D5: a TTY sink without NO_COLOR gets colour", async () => {
    vi.stubEnv("NO_COLOR", "");
    const { out, text } = sink(true);
    const done = runWatch({ dir: "/proj", out, collect: async () => report() });
    await new Promise((r) => setTimeout(r, 20));
    process.emit("SIGINT");
    await done;
    expect(text()).toMatch(ANSI_COLOR);
  });

  it("D9: a slow poll never overlaps the next one", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const collect = async (): Promise<SessionStateReport> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 350));
      inFlight -= 1;
      return report();
    };
    const { out } = sink(false);
    const done = runWatch({ dir: "/proj", refreshMs: 100, out, collect });
    await vi.advanceTimersByTimeAsync(2_000);
    process.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(maxInFlight).toBe(1);
  });
});
