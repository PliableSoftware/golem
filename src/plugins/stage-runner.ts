/**
 * `src/plugins/stage-runner.ts` — run ONE third-party pipeline stage so that
 * nothing it does wrong can leave the body worse than it found it (DUST2.11).
 *
 * The body a stage receives has already been through built-in redaction (stage 1
 * runs first, `src/pipeline/pipeline.ts`), so "the pre-stage body" is a
 * built-in-redacted body. Restoring it on failure is therefore the direction
 * that keeps built-in redaction applied: a failing stage costs the user its
 * transformation, never a redaction.
 *
 * Three failure shapes, one outcome (skip, keep the pre-stage body, record):
 *  - the stage throws, or its promise rejects;
 *  - the stage mutated `body` IN PLACE and THEN threw. Without a snapshot the
 *    half-edited body would survive, which is not "the pre-stage body";
 *  - the stage's promise does not settle within the timeout. A late write to the
 *    original object after that cannot reach the restored copy.
 *
 * Not covered, and said so: a stage that blocks the event loop synchronously
 * (`while (true) {}`) cannot be interrupted from inside the same thread.
 */

import { describeThrown } from "./safe-text.js";
import type { PluginPipelineStage } from "./types.js";

/** How long one stage may take before it is treated as hung. */
export const PLUGIN_STAGE_TIMEOUT_MS = 5_000;

export interface PluginStageFault {
  readonly stage: string;
  /** `disabled`: skipped without running, because the circuit breaker is open. */
  readonly kind: "threw" | "timed-out" | "disabled";
  readonly reason: string;
  /** Faults of any kind recorded against this stage in this process, this one included. */
  readonly total: number;
  /** True on the fault that opened the circuit breaker (log this one loudly). */
  readonly tripped?: boolean;
}

export interface PluginStageOutcome {
  /** The body to continue with: the stage's result, or the untouched pre-stage body. */
  readonly body: Record<string, unknown>;
  /** True when the stage returned a different object (the caller must forward it). */
  readonly replaced: boolean;
  /** Set when the stage was skipped. */
  readonly fault: PluginStageFault | null;
}

/**
 * Consecutive timeouts after which a stage is skipped for a cool-off. A hung
 * stage cannot be aborted (no signal reaches third-party code), so without this
 * every request would pay the full timeout again.
 */
export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOL_OFF_MS = 60_000;
export interface PluginStageRunOptions {
  /** Per-stage timeout. Default {@link PLUGIN_STAGE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Clock for the breaker's cool-off. Default: a monotonic clock (`performance.now`). */
  readonly now?: () => number;
  readonly breakerThreshold?: number;
  readonly breakerCoolOffMs?: number;
}

/**
 * Breaker bookkeeping, per stage. "Consecutive" is defined over invocation
 * START order, because requests overlap:
 *
 *  - a tick counter orders starts and completions;
 *  - each timeout records the tick at which its invocation STARTED;
 *  - the breaker opens when the first of the last N timeouts started after the
 *    last completed non-timeout (no success since it started);
 *  - opening bumps `generation`. An invocation remembers the generation it
 *    started in and only counts toward the breaker if that is still current, so
 *    requests that were already in flight when it opened cannot re-trip it the
 *    moment the cool-off ends.
 *
 * Three CONCURRENT hung requests with no success in between do trip it: with no
 * abort signal that is indistinguishable from a hang, and is the point.
 */
interface BreakerState {
  generation: number;
  tick: number;
  lastSuccessTick: number;
  timeoutStarts: number[];
  disabledUntil: number;
}

const ledger = new Map<string, number>();
const breakers = new Map<string, BreakerState>();

/** Per-stage fault counts for this process, for status surfaces. */
export function pluginStageFaultCounts(): ReadonlyMap<string, number> {
  return new Map(ledger);
}

export { describeThrown, MAX_REASON_CHARS, redactForLog } from "./safe-text.js";

/** Test-only. */
export function resetPluginStageFaultsForTests(): void {
  ledger.clear();
  breakers.clear();
}

/** Monotonic milliseconds: immune to wall-clock steps (NTP, DST, manual changes). */
function monotonicNow(): number {
  return performance.now();
}

/** Stages currently skipped by the breaker, for status surfaces. */
export function pluginStagesInCoolOff(now: () => number = monotonicNow): readonly string[] {
  return [...breakers].filter(([, b]) => b.disabledUntil > now()).map(([name]) => name);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TIMED_OUT = Symbol("plugin-stage-timed-out");

export async function runPluginStage(
  stage: PluginPipelineStage,
  body: Record<string, unknown>,
  projectId: string,
  options: PluginStageRunOptions = {},
): Promise<PluginStageOutcome> {
  const timeoutMs = options.timeoutMs ?? PLUGIN_STAGE_TIMEOUT_MS;
  const now = options.now ?? monotonicNow;
  const threshold = options.breakerThreshold ?? BREAKER_THRESHOLD;
  const coolOffMs = options.breakerCoolOffMs ?? BREAKER_COOL_OFF_MS;

  const state = breakers.get(stage.name) ?? {
    generation: 0,
    tick: 0,
    lastSuccessTick: 0,
    timeoutStarts: [],
    disabledUntil: 0,
  };
  breakers.set(stage.name, state);
  if (state.disabledUntil > now()) {
    return {
      body,
      replaced: false,
      fault: fault(
        stage.name,
        "disabled",
        "stage disabled after repeated timeouts; skipped during cool-off",
      ),
    };
  }

  const startTick = ++state.tick;
  const startGeneration = state.generation;

  // Snapshot BEFORE the stage can touch anything. Plain JSON, so this is exact.
  let snapshot: Record<string, unknown>;
  try {
    snapshot = structuredClone(body);
  } catch {
    // Cannot guarantee a rollback, so do not run third-party code against the
    // only copy: skip the stage.
    return {
      body,
      replaced: false,
      fault: fault(stage.name, "threw", "body could not be snapshotted"),
    };
  }

  // A ref'd timer on purpose: a short-lived process (`golem plugin`) must stay
  // alive until the timeout fires, or it exits silently with a hung stage.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => stage.transform({ body, projectId })),
      timeout,
    ]);
    if (result === TIMED_OUT) {
      let tripped = false;
      if (startGeneration === state.generation) {
        state.timeoutStarts.push(startTick);
        const firstOfWindow = state.timeoutStarts[state.timeoutStarts.length - threshold];
        tripped = firstOfWindow !== undefined && state.lastSuccessTick < firstOfWindow;
        if (tripped) {
          state.disabledUntil = now() + coolOffMs;
          state.generation++;
          state.timeoutStarts = [];
        }
      }
      return {
        body: snapshot,
        replaced: false,
        fault: fault(
          stage.name,
          "timed-out",
          tripped
            ? `did not finish within ${timeoutMs}ms; stage disabled after repeated timeouts (cool-off ${coolOffMs}ms)`
            : `did not finish within ${timeoutMs}ms`,
          tripped,
        ),
      };
    }
    state.lastSuccessTick = ++state.tick;
    if (result !== undefined && isRecord(result) && result !== body) {
      return { body: result, replaced: true, fault: null };
    }
    return { body, replaced: false, fault: null };
  } catch (err) {
    // It came back promptly, so it is responsive: not a hang.
    state.lastSuccessTick = ++state.tick;
    return {
      body: snapshot,
      replaced: false,
      fault: fault(stage.name, "threw", describeThrown(err)),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function fault(
  stage: string,
  kind: PluginStageFault["kind"],
  reason: string,
  tripped = false,
): PluginStageFault {
  const total = (ledger.get(stage) ?? 0) + 1;
  ledger.set(stage, total);
  return { stage, kind, reason, total, ...(tripped ? { tripped: true } : {}) };
}
