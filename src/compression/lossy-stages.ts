/**
 * Every lossy stage, the level that gates it, and what recovers its output.
 *
 * Spec §4 says every lossy operation declares its gate. Until DUST2.20 that held
 * for the two stages `resolveEffectiveCompression` predicts, and nowhere else.
 * This module is the declaration: one row per lossy stage, enumerated by
 * `tests/unit/compression/lossy-stages.test.ts`, which also fails when a
 * `StageConfig` field appears that no row accounts for.
 *
 * `pipeline.ts` stays the enforcement point. These rows declare; they do not run.
 */

import type { CompressionLevel, StageConfig } from "../interfaces/policy.js";

/** Whether (and how) the original can be recovered after a stage ran. */
export type Recovery =
  /** Original stored in the CCR store; the marker carries the `hash=` ref. */
  | "ccr-marker"
  /** Content dropped or rewritten with NO marker. Not recoverable from the request. */
  | "none";

export interface LossyStageDeclaration {
  /** Key under `stageSavings` in telemetry. */
  readonly id: string;
  /** The `StageConfig` field whose value turns this stage on. */
  readonly stageField: keyof StageConfig;
  /** Lowest numeric `compression.level` at which `stageField` is on. */
  readonly minLevel: 2 | 3;
  /** True when a prompt-caching upstream turns the stage off (Decision 31). */
  readonly gatedOffOnCachingUpstream: boolean;
  /** True when `compression.force_semantic_on_caching` lifts the caching gate. */
  readonly forceFlagLiftsCachingGate: boolean;
  /** Needs the Headroom sidecar (`compression.headroom_sidecar`). */
  readonly needsHeadroomSidecar: boolean;
  readonly recovery: Recovery;
  /** Where the gate is enforced, for the reader following a declaration to code. */
  readonly enforcedAt: string;
}

export const LOSSY_STAGES: readonly LossyStageDeclaration[] = Object.freeze([
  {
    id: "semantic",
    stageField: "semanticCompression",
    minLevel: 2,
    gatedOffOnCachingUpstream: true,
    forceFlagLiftsCachingGate: true,
    needsHeadroomSidecar: true,
    // Headroom's stale-turn drops (`read_lifecycle`) leave no `hash=` marker
    // unless the CCR backfill bridge finds one; C4 names them unmarked.
    recovery: "none",
    enforcedAt: "src/pipeline/pipeline.ts (stage 3)",
  },
  {
    id: "contextSubstitution",
    stageField: "semanticCompression",
    minLevel: 2,
    gatedOffOnCachingUpstream: true,
    // Deliberately not lifted: the R2.6 flag is scoped to the semantic stage.
    forceFlagLiftsCachingGate: false,
    needsHeadroomSidecar: false,
    recovery: "ccr-marker",
    enforcedAt: "src/pipeline/pipeline.ts (stage 4)",
  },
  {
    id: "tool_result_cache",
    stageField: "toolResultCache",
    minLevel: 2,
    // Only the standalone MCP service reads this field; the proxy never does
    // (spec §3.4), so no upstream gate applies to it.
    gatedOffOnCachingUpstream: false,
    forceFlagLiftsCachingGate: false,
    needsHeadroomSidecar: false,
    recovery: "ccr-marker",
    enforcedAt: "src/mcp/in-memory-compression.ts (standalone `golem mcp serve` only)",
  },
]);

/**
 * `StageConfig` fields that are NOT lossy, so no declaration is owed.
 * Anything else added to `StageConfig` must either appear here or get a row.
 */
export const NON_LOSSY_STAGE_FIELDS: readonly (keyof StageConfig)[] = Object.freeze([
  "redaction",
  "losslessCompression",
]);

/**
 * What `compression.level` hands Headroom, per content class.
 *
 * Headroom's `ContentRouter` does its own content-type detection; Golem does not
 * choose a codec per type. What the level controls is which content CLASSES the
 * sidecar may touch and how many recent turns it leaves alone. These values are
 * the worker's `_MODE_PRESETS` and router preset (`headroom-worker.py`); the test
 * pins this table to that file so the two cannot drift.
 */
export interface HeadroomLevelMapping {
  readonly level: Exclude<CompressionLevel, "off" | 1>;
  readonly mode: "stale_turns" | "aggressive";
  /** Recent messages Headroom must leave untouched (`protect_recent`). */
  readonly protectRecent: number;
  /** Whether user-authored messages are compressible (`compress_user_messages`). */
  readonly compressUserMessages: boolean;
  /** Tool output is emitted marker-free (`router.lossless`) at every level. */
  readonly toolOutputMarkerFree: true;
}

export const HEADROOM_LEVEL_MAPPING: readonly HeadroomLevelMapping[] = Object.freeze([
  {
    level: 2,
    mode: "stale_turns",
    protectRecent: 4,
    compressUserMessages: false,
    toolOutputMarkerFree: true,
  },
  {
    level: 3,
    mode: "aggressive",
    protectRecent: 1,
    compressUserMessages: true,
    toolOutputMarkerFree: true,
  },
]);
