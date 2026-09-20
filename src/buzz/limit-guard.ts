/**
 * R14.3 — the rate-limit / usage-cap policy for one `golem acp` turn.
 *
 * `golem acp` is a headless daemon reacting to an `@mention` with nobody
 * watching: there is no PreToolUse loop for [[Usage Limit Park]]'s existing
 * gate to sit in front of, and no human to answer a park prompt. So this
 * module is a from-scratch policy for a turn, not a reuse of the hook — but it
 * reuses the hook's DECISION function (`decideSnoozeNudge`) so a Buzz turn and
 * a Claude Code session park on the same threshold rather than drifting apart.
 *
 * Two layers, because one is not enough (see [[Buzz Integration]] "MUST
 * HANDLE"):
 *
 * 1. **Pre-flight** ({@link decidePreflight}) — cheap, advisory, from the
 *    proxy's persisted `.golem/state/limit-state.json`. A `park` verdict means
 *    decline the turn BEFORE spending it.
 * 2. **In-flight** ({@link decideInFlight}) — authoritative, from a
 *    `RateLimitedError` the dispatch boundary actually raised. Within
 *    {@link RETRY_BUDGET_MS} of the observed reset, retry in-turn (streaming
 *    keepalive); beyond it, defer.
 *
 * Pure decision functions, no I/O — testable with a faked clock and no
 * network. The caller (`acp-turn.ts`) is responsible for acting on the
 * verdict: reading state, calling `persistSnoozeNote`, posting the channel
 * message (via the seam R14.4's `cli-client.ts` fills in), and recording the
 * thread as deferred (via the seam R14.4's `thread-state.ts` fills in).
 *
 * MUST NOT: call `runSnooze()` or the `snooze` MCP tool. Both block until the
 * window resets, which deadlocks the very channel a resume has to arrive
 * through — see [[Buzz Integration]].
 */

import { decideSnoozeNudge, type SnoozeNudgeState } from "../hooks/snooze-nudge.js";
import type { RateLimitedError } from "../inference/target-dispatcher.js";
import type { LimitPrediction } from "../proxy/limit-prediction.js";

/**
 * A short wait is worth holding the turn open for; a long one is not.
 *
 * 60s is comfortably inside `BUZZ_ACP_IDLE_TIMEOUT`'s 620s default (so a
 * streamed keepalive chunk before/after the wait is plenty to avoid the idle
 * cancel) and is the goose-shaped behaviour for ordinary per-minute
 * throttling (`block/goose` defaults to 3 tries / 1s / ×2). Above it, a turn
 * cannot outlive the wait — Anthropic's 5h window is nowhere close to
 * `BUZZ_ACP_MAX_TURN_DURATION` (7200s) — so deferring is the only honest
 * option.
 */
export const RETRY_BUDGET_MS = 60_000;

/** Proceed with dispatch — the only verdict that ends without a caller reaction. */
export type ProceedVerdict = { readonly kind: "proceed" };
/** Retry in-turn after `afterMs`, within the retry budget. */
export type RetryVerdict = {
  readonly kind: "retry";
  readonly afterMs: number;
  readonly attempt: number;
};
/** End the turn now; a resume is expected no earlier than `untilIso`. */
export type DeferVerdict = {
  readonly kind: "defer";
  readonly untilIso: string;
  readonly reason: string;
};

/**
 * Verdict for one point in a turn. `decidePreflight` only ever returns
 * `proceed | defer` and `decideInFlight` only ever returns `retry | defer` —
 * each function is typed to its own narrower subset below so a caller's
 * exhaustiveness check (e.g. `if (kind === "retry") ...; else use .untilIso`)
 * does not have to re-guard against a variant that function can never
 * produce.
 */
export type LimitVerdict = ProceedVerdict | RetryVerdict | DeferVerdict;

/** Bound the number of in-turn retries even when every wait reports as short. */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Pre-flight: read before dispatch starts. Wraps `decideSnoozeNudge` — see its
 * own doc for the fresh/stale/park logic. `stale` is a warning, never a block:
 * this process may legitimately be the only thing running for hours.
 *
 * Passes `enforce: true`. Advisory mode (`enforce: false`) is one-shot PER
 * RESET WINDOW, keyed on `state.nudgedForResetIso` — state this module shares
 * with Claude Code's own `PreToolUse` hook. In a project with an active
 * interactive session, that hook has usually already nudged for the current
 * window, which would silently make every `golem acp` turn in that window see
 * `none` and dispatch, regardless of the ACTUAL utilization Buzz is adding on
 * top. A headless daemon with nobody to nudge is exactly the enforcing case:
 * park keeps firing every turn until the agent defers or the window resets,
 * independent of what any other process already saw.
 */
export function decidePreflight(
  prediction: LimitPrediction | null,
  state: SnoozeNudgeState,
  nowMs: number,
): ProceedVerdict | DeferVerdict {
  const decision = decideSnoozeNudge(
    prediction,
    state,
    nowMs,
    undefined,
    undefined,
    /* enforce */ true,
  );
  if (decision.kind === "park") {
    return {
      kind: "defer",
      untilIso: decision.resetAtIso,
      reason:
        `pre-flight: session window ~${Math.round(decision.utilization * 100)}% used, ` +
        `resets ${decision.resetAtIso}`,
    };
  }
  // `stale` and `none` both proceed — a cold feed warns (the caller logs it to
  // stderr) but never blocks a turn on data that may simply be missing.
  return { kind: "proceed" };
}

/**
 * In-flight: classify a `RateLimitedError` the dispatch boundary raised.
 * `attempt` is 1 for the first retry, 2 for the second, and so on —
 * exponential backoff is used only when the response gave no `retry-after`.
 */
export function decideInFlight(
  err: RateLimitedError,
  attempt: number,
  nowMs: number,
): RetryVerdict | DeferVerdict {
  if (attempt > MAX_RETRY_ATTEMPTS) {
    return deferFrom(err, nowMs, `exhausted ${MAX_RETRY_ATTEMPTS} in-turn retries`);
  }

  const afterMs =
    err.retryAfterSeconds !== null ? err.retryAfterSeconds * 1000 : 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, ... when the server gave no hint

  if (afterMs <= RETRY_BUDGET_MS) {
    return { kind: "retry", afterMs, attempt };
  }
  return deferFrom(err, nowMs, `retry-after ${Math.round(afterMs / 1000)}s exceeds the budget`);
}

/** A conservative fallback used only when neither the response nor the prediction gives a reset. */
const FALLBACK_DEFER_MS = 300_000;

function deferFrom(err: RateLimitedError, nowMs: number, why: string): DeferVerdict {
  const resetIso = err.prediction?.fiveHour.resetAtIso ?? null;
  const fallbackMs =
    // A pathological `retry-after` (e.g. a gateway sending a bogus huge value)
    // must never overflow `Date`'s valid range and throw `RangeError` from
    // inside a catch block, where nothing would catch it — clamp to a day.
    err.retryAfterSeconds !== null && Number.isFinite(err.retryAfterSeconds)
      ? Math.min(err.retryAfterSeconds * 1000, 24 * 60 * 60 * 1000)
      : FALLBACK_DEFER_MS;
  const untilIso = resetIso ?? new Date(nowMs + fallbackMs).toISOString();
  return { kind: "defer", untilIso, reason: `in-flight: ${why} (status ${err.status})` };
}

/**
 * The channel message posted on defer — honest and actionable, never a
 * promise of automatic resumption (that is R14.4's heartbeat decision to
 * make, not this module's).
 */
export function deferralChannelMessage(untilIso: string, reason: string): string {
  const local = (() => {
    const d = new Date(untilIso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : untilIso;
  })();
  return (
    `Rate limited (${reason}). The session window resets around ${local}. ` +
    "I've saved where I got to and will pick this up on the next mention after that."
  );
}
