/**
 * R14.5 — the shared 429/529 classify + retry-decision policy
 * (src/proxy/rate-limit-retry.ts), extracted out of Buzz so the proxy's own
 * retry loop can share it. `tests/unit/buzz/limit-guard.test.ts` still covers
 * `decideInFlight`'s wrapping of this policy into Buzz's defer verdict; this
 * file covers the policy itself, independent of any caller.
 */

import { describe, expect, it } from "vitest";
import {
  classifyRateLimit,
  decideRetry,
  MAX_RETRY_ATTEMPTS,
  parseRetryAfterSeconds,
  RateLimitedError,
  RETRY_BUDGET_MS,
} from "../../../src/proxy/rate-limit-retry.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

describe("classifyRateLimit", () => {
  it("classifies a 429 with a plain-record header shape (the proxy's transport)", () => {
    const err = classifyRateLimit("cheap", 429, "Too Many Requests", { "retry-after": "5" }, NOW);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err?.status).toBe(429);
    expect(err?.retryAfterSeconds).toBe(5);
    expect(err?.message).toContain("returned 429");
  });

  it("classifies a 529 (Anthropic overloaded) the same way as a 429", () => {
    const err = classifyRateLimit("cheap", 529, "Overloaded", {}, NOW);
    expect(err?.status).toBe(529);
  });

  it("classifies with a fetch Headers object (the dispatcher's transport)", () => {
    const headers = new Headers({ "retry-after": "10" });
    const err = classifyRateLimit("cheap", 429, "Too Many Requests", headers, NOW);
    expect(err?.retryAfterSeconds).toBe(10);
  });

  it("returns null for a non-429/529 status", () => {
    expect(classifyRateLimit("cheap", 500, "Internal Server Error", {}, NOW)).toBeNull();
  });

  it("reads the first value of a repeated retry-after header", () => {
    const err = classifyRateLimit(
      "cheap",
      429,
      "Too Many Requests",
      { "retry-after": ["7", "9"] },
      NOW,
    );
    expect(err?.retryAfterSeconds).toBe(7);
  });
});

describe("parseRetryAfterSeconds", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterSeconds("5", NOW)).toBe(5);
  });

  it("parses an HTTP-date into seconds from now", () => {
    const future = new Date(NOW + 30_000).toUTCString();
    expect(parseRetryAfterSeconds(future, NOW)).toBe(30);
  });

  it("returns null for absent/blank/unparsable values", () => {
    expect(parseRetryAfterSeconds(null, NOW)).toBeNull();
    expect(parseRetryAfterSeconds("", NOW)).toBeNull();
    expect(parseRetryAfterSeconds("not a date", NOW)).toBeNull();
  });
});

function rateLimitError(retryAfterSeconds: number | null): RateLimitedError {
  return new RateLimitedError("rate limited", 429, retryAfterSeconds, null);
}

describe("decideRetry", () => {
  it("retries using retry-after verbatim when present", () => {
    expect(decideRetry(rateLimitError(5), 1)).toEqual({ kind: "retry", afterMs: 5000 });
  });

  it("backs off exponentially starting at 1s when the server gives no hint", () => {
    expect(decideRetry(rateLimitError(null), 1)).toEqual({ kind: "retry", afterMs: 1000 });
    expect(decideRetry(rateLimitError(null), 2)).toEqual({ kind: "retry", afterMs: 2000 });
    expect(decideRetry(rateLimitError(null), 3)).toEqual({ kind: "retry", afterMs: 4000 });
  });

  it(`gives up once retry-after exceeds the ${RETRY_BUDGET_MS / 1000}s budget`, () => {
    const decision = decideRetry(rateLimitError(RETRY_BUDGET_MS / 1000 + 1), 1);
    expect(decision.kind).toBe("give-up");
  });

  it("retries right at the budget boundary", () => {
    expect(decideRetry(rateLimitError(RETRY_BUDGET_MS / 1000), 1).kind).toBe("retry");
  });

  it(`gives up after ${MAX_RETRY_ATTEMPTS} attempts even with a short retry-after`, () => {
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      expect(decideRetry(rateLimitError(1), attempt).kind).toBe("retry");
    }
    expect(decideRetry(rateLimitError(1), MAX_RETRY_ATTEMPTS + 1).kind).toBe("give-up");
  });
});
