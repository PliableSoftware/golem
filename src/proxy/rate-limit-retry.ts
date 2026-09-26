/**
 * R14.5 — the 429/529 (rate-limited) classification and retry POLICY, shared
 * by every caller that dials an upstream: the target dispatcher
 * (`src/inference/target-dispatcher.ts`, one worker-lane draft), the proxy
 * (`src/proxy/server.ts`, Claude Code's own live traffic), and Buzz's turn
 * loop (`src/buzz/limit-guard.ts` / `acp-turn.ts`).
 *
 * Started as Buzz-only (R14.3): a `golem acp` turn retried a rate-limited
 * dispatch in-turn, bounded, then deferred. The proxy had none of this — a
 * 429 from upstream reached Claude Code untouched, so an ordinary interactive
 * session got no benefit from the exact same "wait it out" logic a background
 * persona draft already had. This module is the one place that logic lives
 * now; `limit-guard.ts`'s `decideInFlight` and the proxy's retry loop are both
 * thin wrappers over {@link decideRetry}, so the policy cannot drift between
 * the two callers.
 *
 * Pure, no I/O — the sleep/retry LOOP still lives with each caller, because
 * only the caller knows how to reissue its own request.
 */

import type { LimitPrediction } from "./limit-prediction.js";
import { parseLimitPrediction } from "./limit-prediction.js";

/** Raised for a target the caller may not use, or cannot be dispatched to. */
export class TargetDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetDispatchError";
  }
}

/**
 * R14.3 — the target responded 429 (or 529, Anthropic's overloaded variant).
 *
 * A distinct class rather than a generic {@link TargetDispatchError} because a
 * rate limit is a DIFFERENT kind of failure from a broken config or an
 * unreachable endpoint: it is transient, it carries its own timing evidence
 * (`retry-after`, or the `anthropic-ratelimit-unified-*` headers), and a
 * caller must react to it on a bounded retry-then-give-up policy rather than
 * surfacing it as an ordinary error. Every transport before R14.3 collapsed
 * every non-ok status into one generic error and discarded the response
 * headers entirely — a 429 was indistinguishable from a 500.
 */
export class RateLimitedError extends TargetDispatchError {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
    readonly prediction: LimitPrediction | null,
  ) {
    super(message);
    this.name = "RateLimitedError";
  }
}

/**
 * The header shapes a caller may hold: a `fetch` `Headers` object (the target
 * dispatcher's transport) or the plain record undici's `Dispatcher.request()`
 * already returns (the proxy's transport, and what {@link parseLimitPrediction}
 * itself expects). Accepting both here means neither caller has to normalize
 * before classifying.
 */
export type RateLimitHeaders = Headers | Readonly<Record<string, string | string[] | undefined>>;

function headersToRaw(
  headers: RateLimitHeaders,
): Readonly<Record<string, string | string[] | undefined>> {
  if (!(headers instanceof Headers)) return headers;
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function retryAfterHeader(headers: RateLimitHeaders): string | null {
  if (headers instanceof Headers) return headers.get("retry-after");
  const value = headers["retry-after"];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * `retry-after` is delta-seconds OR an HTTP-date (RFC 9110 §10.2.3) — both are
 * legal and real gateways send either. Returns null when absent/unparsable, in
 * which case the caller falls back to exponential backoff.
 */
export function parseRetryAfterSeconds(value: string | null, nowMs: number): number | null {
  if (value === null || value.trim() === "") return null;
  const asSeconds = Number(value.trim());
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds;
  const asDateMs = Date.parse(value);
  if (Number.isFinite(asDateMs)) return Math.max(0, Math.round((asDateMs - nowMs) / 1000));
  return null;
}

/**
 * Build a {@link RateLimitedError} from a response, or null when `status` is
 * neither 429 nor 529. `subjectId` names whatever was dialled (a target id
 * for the dispatcher, the route/target id — or the bare origin when there is
 * none — for the proxy) purely for the error message.
 */
export function classifyRateLimit(
  subjectId: string,
  status: number,
  statusText: string,
  headers: RateLimitHeaders,
  nowMs: number,
): RateLimitedError | null {
  if (status !== 429 && status !== 529) return null;
  const raw = headersToRaw(headers);
  return new RateLimitedError(
    `"${subjectId}" returned ${status} ${statusText} (rate limited).`,
    status,
    parseRetryAfterSeconds(retryAfterHeader(headers), nowMs),
    parseLimitPrediction(raw, new Date(nowMs).toISOString()),
  );
}

/**
 * A short wait is worth holding a request open for; a long one is not.
 *
 * 60s is comfortably inside Buzz's idle timeout (a streamed keepalive before/
 * after the wait avoids that cancel) and is the goose-shaped behaviour for
 * ordinary per-minute throttling (`block/goose` defaults to 3 tries / 1s /
 * ×2). Above it, giving up and letting the caller decide what "no luck"
 * means (defer a turn, forward the still-429 response) is the only honest
 * option — nothing dials it back down once it is already this long.
 */
export const RETRY_BUDGET_MS = 60_000;

/** Bound the number of retries even when every wait reports as short. */
export const MAX_RETRY_ATTEMPTS = 3;

export type RetryDecision =
  | { readonly kind: "retry"; readonly afterMs: number }
  | { readonly kind: "give-up"; readonly reason: string };

/**
 * Classify a `RateLimitedError` into "retry after N ms" or "give up, and
 * here's why". `attempt` is 1 for the first retry, 2 for the second, and so
 * on — exponential backoff (1s, 2s, 4s, ...) is used only when the response
 * gave no `retry-after` of its own, which always wins when present.
 *
 * Pure — no sleep, no I/O. Each caller runs its own loop around this.
 */
export function decideRetry(err: RateLimitedError, attempt: number): RetryDecision {
  if (attempt > MAX_RETRY_ATTEMPTS) {
    return { kind: "give-up", reason: `exhausted ${MAX_RETRY_ATTEMPTS} retries` };
  }

  const afterMs =
    err.retryAfterSeconds !== null ? err.retryAfterSeconds * 1000 : 1000 * 2 ** (attempt - 1);

  if (afterMs <= RETRY_BUDGET_MS) {
    return { kind: "retry", afterMs };
  }
  return {
    kind: "give-up",
    reason: `retry-after ${Math.round(afterMs / 1000)}s exceeds the budget`,
  };
}
