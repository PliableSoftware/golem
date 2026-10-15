import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../../../src/telemetry/index.js";
import { windowedStatsWithFallback } from "../../../src/telemetry/index.js";

function ev(): TelemetryEvent {
  return {
    ts: "2026-09-01T00:00:00.000Z",
    projectId: "p",
    ccrRefsStored: 0,
    stageSavings: {},
    requestTokens: { tokensBefore: 100, tokensAfter: 50 },
  } as unknown as TelemetryEvent;
}

describe("windowedStatsWithFallback", () => {
  it("folds the event list once for the all window (DUST3.12 D11)", () => {
    const list = [ev(), ev()];
    let passes = 0;
    const counted = {
      length: list.length,
      [Symbol.iterator]() {
        passes += 1;
        return list[Symbol.iterator]();
      },
    } as unknown as readonly TelemetryEvent[];
    const out = windowedStatsWithFallback(counted, {
      preferred: "all",
      nowMs: Date.parse("2026-10-08T00:00:00.000Z"),
    });
    expect(out.windowApplied).toBe("all");
    expect(passes).toBe(1);
  });

  it("widens 24h to 7d to all when narrower windows are empty", () => {
    const out = windowedStatsWithFallback([ev()], {
      preferred: "24h",
      nowMs: Date.parse("2026-10-08T00:00:00.000Z"),
    });
    expect(out.windowApplied).toBe("all");
    expect(out.stats.requests).toBe(1);
  });
});
