/**
 * Conditional revalidation for the web cache (R4-followup).
 *
 * A cached-but-not-explicitly-fresh URL can be confirmed with a conditional GET
 * before it is served, so a page that changed is not served stale. The network
 * call itself is injectable ({@link RevalidateFn}) — tests never reach the
 * network, and the per-project gate lives in the CLI layer, not here.
 */

import type { WebCacheMeta } from "../../knowledge/index.js";

/** The status + validators/cache-directives from a conditional revalidation request. */
export interface RevalidateResponse {
  readonly status: number;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly cacheControl?: string;
  readonly expires?: string;
  /** Response `Date`, used to correct an absolute `Expires` for clock skew. */
  readonly date?: string;
  /** True when the response carried `Set-Cookie` (per-user state: never cached). */
  readonly setCookie?: boolean;
}

/** Conditional-GET a URL to check whether the cached copy is still current. */
export type RevalidateFn = (
  url: string,
  validators: {
    readonly etag?: string | undefined;
    readonly lastModified?: string | undefined;
    readonly fetchedAt: string;
  },
) => Promise<RevalidateResponse>;

/** Default {@link RevalidateFn}: a conditional GET that reads status + headers only (body cancelled). */
export const defaultRevalidate: RevalidateFn = async (url, v) => {
  const headers: Record<string, string> = {};
  if (v.etag !== undefined) headers["if-none-match"] = v.etag;
  headers["if-modified-since"] = v.lastModified ?? new Date(v.fetchedAt).toUTCString();
  const res = await fetch(url, { method: "GET", headers, redirect: "follow" });
  try {
    await res.body?.cancel(); // we only need status + headers, never the body
  } catch {
    // ignore
  }
  const etag = res.headers.get("etag") ?? undefined;
  const lastModified = res.headers.get("last-modified") ?? undefined;
  const cacheControl = res.headers.get("cache-control") ?? undefined;
  const expires = res.headers.get("expires") ?? undefined;
  const date = res.headers.get("date") ?? undefined;
  return {
    status: res.status,
    ...(date !== undefined ? { date } : {}),
    ...(res.headers.get("set-cookie") !== null ? { setCookie: true } : {}),
    ...(etag !== undefined ? { etag } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
    ...(cacheControl !== undefined ? { cacheControl } : {}),
    ...(expires !== undefined ? { expires } : {}),
  };
};

/**
 * Upper bound on an explicit `max-age`/`Expires` window we will record (30 days).
 * Also keeps `new Date(...)` inside its valid range for absurd header values. The
 * window actually served is further capped by the configured TTL (default 7 days,
 * `DEFAULT_WEB_CACHE_TTL_HOURS`): an explicit expiry can only SHORTEN freshness.
 */
export const MAX_EXPLICIT_FRESHNESS_MS = 30 * 24 * 3_600_000;

/**
 * Parse the relevant `Cache-Control` directives. `s-maxage` is deliberately not
 * read: it addresses shared caches, and this is a private one.
 */
export function parseCacheControl(value: string | undefined): {
  noStore: boolean;
  noCache: boolean;
  isPrivate: boolean;
  maxAgeMs: number | undefined;
} {
  if (value === undefined) {
    return { noStore: false, noCache: false, isPrivate: false, maxAgeMs: undefined };
  }
  const lower = value.toLowerCase();
  const m = lower.match(/(?:^|[\s,])max-age\s*=\s*"?(-?\d+)/);
  const maxAgeMs = m?.[1] === undefined ? undefined : Math.max(0, Number(m[1])) * 1000;
  return {
    noStore: /\bno-store\b/.test(lower),
    noCache: /\bno-cache\b/.test(lower),
    isPrivate: /\bprivate\b/.test(lower),
    maxAgeMs,
  };
}

/**
 * Must this response be neither cached nor ingested? `no-store`, `private` and
 * `no-cache` say so directly (no-cache is cacheable only with mandatory
 * revalidation per HTTP; we do not cache it, which is the conservative reading),
 * and a `Set-Cookie` response carries per-user state. A response to a request
 * with credentials never reaches here: Golem sends none.
 */
export function isUncacheable(res: {
  readonly cacheControl?: string | undefined;
  readonly setCookie?: boolean | undefined;
}): boolean {
  const cc = parseCacheControl(res.cacheControl);
  return cc.noStore || cc.noCache || cc.isPrivate || res.setCookie === true;
}

/**
 * Compute the cache-metadata to persist from a response. `max-age` is relative
 * to the local clock, so it is skew-free. An absolute `Expires` is corrected by
 * the server's own `Date` when that parses; an invalid `Expires` means "already
 * expired" (RFC 9111 4.2.1), recorded as `nowMs`, so the entry is stale.
 */
export function metaFrom(res: RevalidateResponse, nowMs: number): WebCacheMeta {
  const cc = parseCacheControl(res.cacheControl);
  let expiresAtMs: number | undefined;
  if (cc.maxAgeMs !== undefined) {
    expiresAtMs = nowMs + cc.maxAgeMs;
  } else if (res.expires !== undefined) {
    const exp = Date.parse(res.expires);
    if (Number.isFinite(exp)) {
      const serverNow = res.date === undefined ? Number.NaN : Date.parse(res.date);
      expiresAtMs = Number.isFinite(serverNow) ? nowMs + (exp - serverNow) : exp;
    } else {
      expiresAtMs = nowMs;
    }
  }
  let expiresAt: string | undefined;
  if (expiresAtMs !== undefined) {
    const bounded = Math.min(expiresAtMs, nowMs + MAX_EXPLICIT_FRESHNESS_MS);
    expiresAt = Number.isFinite(bounded) ? new Date(bounded).toISOString() : undefined;
  }
  return {
    ...(res.etag !== undefined ? { etag: res.etag } : {}),
    ...(res.lastModified !== undefined ? { lastModified: res.lastModified } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}
