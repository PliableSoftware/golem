/**
 * DUST2.13 — pure freshness/cacheability rules for the web cache: what a
 * response's headers allow us to store, and until when. No network, no clock
 * reads: `nowMs` is always passed in.
 */

import { describe, expect, it } from "vitest";
import {
  isUncacheable,
  MAX_EXPLICIT_FRESHNESS_MS,
  metaFrom,
  parseCacheControl,
} from "../../../src/hooks/web-fetch/revalidate.js";

const NOW = Date.parse("2026-10-14T12:00:00Z");

describe("parseCacheControl", () => {
  it("reads no-store / no-cache / private / max-age, case-insensitively", () => {
    const cc = parseCacheControl("Private, NO-CACHE, No-Store, Max-Age=60");
    expect(cc).toMatchObject({ noStore: true, noCache: true, isPrivate: true, maxAgeMs: 60_000 });
  });
  it("treats a negative or non-numeric max-age as zero / absent, never throwing", () => {
    expect(parseCacheControl("max-age=-5").maxAgeMs).toBe(0);
    expect(parseCacheControl("max-age=abc").maxAgeMs).toBeUndefined();
  });
  it("ignores s-maxage (this is a private cache)", () => {
    expect(parseCacheControl("s-maxage=600").maxAgeMs).toBeUndefined();
  });
});

describe("isUncacheable", () => {
  it.each(["no-store", "private", "no-cache", "public, no-store"])("is true for %s", (cc) => {
    expect(isUncacheable({ cacheControl: cc })).toBe(true);
  });
  it("is true for a Set-Cookie response", () => {
    expect(isUncacheable({ setCookie: true })).toBe(true);
  });
  it("is false for plain public/max-age/s-maxage/no headers", () => {
    expect(isUncacheable({})).toBe(false);
    expect(isUncacheable({ cacheControl: "public, max-age=60, s-maxage=0" })).toBe(false);
  });
});

describe("metaFrom freshness", () => {
  const exp = (res: Parameters<typeof metaFrom>[0]) => metaFrom(res, NOW).expiresAt;

  it("max-age is relative to local now", () => {
    expect(exp({ status: 200, cacheControl: "max-age=3600" })).toBe("2026-10-14T13:00:00.000Z");
  });
  it("max-age=0 is already stale", () => {
    expect(Date.parse(exp({ status: 200, cacheControl: "max-age=0" }) ?? "")).toBeLessThanOrEqual(
      NOW,
    );
  });
  it("max-age wins over Expires", () => {
    expect(
      exp({ status: 200, cacheControl: "max-age=60", expires: "Wed, 01 Jan 2031 00:00:00 GMT" }),
    ).toBe("2026-10-14T12:01:00.000Z");
  });
  it("Expires alone is honoured", () => {
    expect(exp({ status: 200, expires: "Wed, 14 Oct 2026 14:00:00 GMT" })).toBe(
      "2026-10-14T14:00:00.000Z",
    );
  });
  it("corrects Expires for clock skew using the response Date", () => {
    // Server clock is 1h behind ours: Expires is 30 min after ITS Date.
    expect(
      exp({
        status: 200,
        date: "Wed, 14 Oct 2026 11:00:00 GMT",
        expires: "Wed, 14 Oct 2026 11:30:00 GMT",
      }),
    ).toBe("2026-10-14T12:30:00.000Z");
  });
  it("treats an invalid Expires (e.g. '0', 'never') as already stale, not as absent", () => {
    for (const bad of ["0", "never", "", "32 Foo 2026"]) {
      const at = exp({ status: 200, expires: bad });
      expect(Date.parse(at ?? "")).toBeLessThanOrEqual(NOW);
    }
  });
  it("ignores an invalid Date header and falls back to absolute Expires", () => {
    expect(exp({ status: 200, date: "garbage", expires: "Wed, 14 Oct 2026 14:00:00 GMT" })).toBe(
      "2026-10-14T14:00:00.000Z",
    );
  });
  it("clamps an absurd max-age instead of throwing a RangeError", () => {
    const at = exp({ status: 200, cacheControl: "max-age=99999999999999999" });
    expect(Date.parse(at ?? "")).toBe(NOW + MAX_EXPLICIT_FRESHNESS_MS);
  });
  it("sets no expiry when the response carries no freshness headers", () => {
    expect(exp({ status: 200 })).toBeUndefined();
  });
});
