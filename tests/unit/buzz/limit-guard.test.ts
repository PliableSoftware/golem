import { describe, expect, it } from "vitest";
import {
  decideInFlight,
  decidePreflight,
  deferralChannelMessage,
  RETRY_BUDGET_MS,
} from "../../../src/buzz/limit-guard.js";
import { RateLimitedError } from "../../../src/inference/target-dispatcher.js";
import type { LimitPrediction } from "../../../src/proxy/limit-prediction.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function prediction(utilization: number, resetAtIso: string | null): LimitPrediction {
  return { observedAtIso: new Date(NOW).toISOString(), fiveHour: { utilization, resetAtIso } };
}

describe("decidePreflight (R14.3 MUST HANDLE, layer 1)", () => {
  it("proceeds when nothing has ever been observed", () => {
    expect(decidePreflight(null, {}, NOW)).toEqual({ kind: "proceed" });
  });

  it("proceeds when utilization is below threshold", () => {
    const verdict = decidePreflight(prediction(0.5, new Date(NOW + 60_000).toISOString()), {}, NOW);
    expect(verdict).toEqual({ kind: "proceed" });
  });

  it("defers BEFORE dispatch on a park verdict (fresh + near limit + future reset)", () => {
    const resetAtIso = new Date(NOW + 60_000).toISOString();
    const verdict = decidePreflight(prediction(0.95, resetAtIso), {}, NOW);
    expect(verdict.kind).toBe("defer");
    if (verdict.kind === "defer") {
      expect(verdict.untilIso).toBe(resetAtIso);
    }
  });

  it("never blocks on a stale reading — proceeds and lets the caller warn instead", () => {
    const staleObservedAtIso = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h old
    const stalePrediction: LimitPrediction = {
      observedAtIso: staleObservedAtIso,
      fiveHour: { utilization: 0.99, resetAtIso: new Date(NOW + 60_000).toISOString() },
    };
    expect(decidePreflight(stalePrediction, {}, NOW)).toEqual({ kind: "proceed" });
  });
});

function rateLimitError(
  retryAfterSeconds: number | null,
  resetAtIso: string | null = null,
): RateLimitedError {
  return new RateLimitedError(
    "rate limited",
    429,
    retryAfterSeconds,
    resetAtIso === null ? null : prediction(0.95, resetAtIso),
  );
}

describe("decideInFlight (R14.3 MUST HANDLE, layer 2)", () => {
  it("retries within the retry budget", () => {
    const verdict = decideInFlight(rateLimitError(5), 1, NOW);
    expect(verdict).toEqual({ kind: "retry", afterMs: 5000, attempt: 1 });
  });

  it("retries right at the budget boundary", () => {
    const verdict = decideInFlight(rateLimitError(RETRY_BUDGET_MS / 1000), 1, NOW);
    expect(verdict.kind).toBe("retry");
  });

  it("defers when retry-after exceeds the budget", () => {
    const verdict = decideInFlight(rateLimitError(600), 1, NOW);
    expect(verdict.kind).toBe("defer");
  });

  it("defers after exhausting the retry attempt cap even with a short retry-after", () => {
    const verdict = decideInFlight(rateLimitError(1), 10, NOW);
    expect(verdict.kind).toBe("defer");
  });

  it("backs off exponentially when the server gives no retry-after hint", () => {
    const first = decideInFlight(rateLimitError(null), 1, NOW);
    const second = decideInFlight(rateLimitError(null), 2, NOW);
    expect(first).toEqual({ kind: "retry", afterMs: 1000, attempt: 1 });
    expect(second).toEqual({ kind: "retry", afterMs: 2000, attempt: 2 });
  });

  it("defer uses the observed reset time over a fallback guess when available", () => {
    const resetAtIso = new Date(NOW + 3_600_000).toISOString();
    const verdict = decideInFlight(rateLimitError(600, resetAtIso), 1, NOW);
    expect(verdict).toMatchObject({ kind: "defer", untilIso: resetAtIso });
  });
});

describe("deferralChannelMessage", () => {
  it("is honest and actionable, never a bare stopReason", () => {
    const msg = deferralChannelMessage(
      new Date(NOW + 60_000).toISOString(),
      "pre-flight: 95% used",
    );
    expect(msg).toContain("Rate limited");
    expect(msg).toContain("resets");
    expect(msg.toLowerCase()).not.toContain("automatically resume");
  });
});
