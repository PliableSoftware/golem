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

import type { PluginPipelineStage } from "./types.js";

/** How long one stage may take before it is treated as hung. */
export const PLUGIN_STAGE_TIMEOUT_MS = 5_000;

export interface PluginStageFault {
  readonly stage: string;
  readonly kind: "threw" | "timed-out";
  readonly reason: string;
  /** Faults of any kind recorded against this stage in this process, this one included. */
  readonly total: number;
}

export interface PluginStageOutcome {
  /** The body to continue with: the stage's result, or the untouched pre-stage body. */
  readonly body: Record<string, unknown>;
  /** True when the stage returned a different object (the caller must forward it). */
  readonly replaced: boolean;
  /** Set when the stage was skipped. */
  readonly fault: PluginStageFault | null;
}

const ledger = new Map<string, number>();

/** Per-stage fault counts for this process, for status surfaces. */
export function pluginStageFaultCounts(): ReadonlyMap<string, number> {
  return new Map(ledger);
}

/** Test-only. */
export function resetPluginStageFaultsForTests(): void {
  ledger.clear();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function runPluginStage(
  stage: PluginPipelineStage,
  body: Record<string, unknown>,
  projectId: string,
  timeoutMs: number = PLUGIN_STAGE_TIMEOUT_MS,
): Promise<PluginStageOutcome> {
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

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer.unref();
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => stage.transform({ body, projectId })),
      timeout,
    ]);
    if (result === "timeout") {
      return {
        body: snapshot,
        replaced: false,
        fault: fault(stage.name, "timed-out", `did not finish within ${timeoutMs}ms`),
      };
    }
    if (result !== undefined && isRecord(result) && result !== body) {
      return { body: result, replaced: true, fault: null };
    }
    return { body, replaced: false, fault: null };
  } catch (err) {
    return {
      body: snapshot,
      replaced: false,
      fault: fault(stage.name, "threw", err instanceof Error ? err.message : String(err)),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function fault(stage: string, kind: PluginStageFault["kind"], reason: string): PluginStageFault {
  const total = (ledger.get(stage) ?? 0) + 1;
  ledger.set(stage, total);
  return { stage, kind, reason, total };
}
