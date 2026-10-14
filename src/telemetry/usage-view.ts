/**
 * DUST2.18 — the dashboard's usage block: billed cache + spend, and the
 * estimated avoided-token figures, folded from the SAME rollups `golem stats
 * --cache` ({@link aggregateCacheStats}) and `golem bench cost`
 * ({@link buildCostBenchmark}) print. Nothing is re-derived here.
 *
 * Honest observability: `cache` and `spend` come from billed `usage` events;
 * everything under `estimated` is chars/4 (or a substitution estimate) and the
 * renderer must label it so.
 */

import { aggregateCacheStats } from "./cache-report.js";
import { buildCostBenchmark, type SpendSummary } from "./cost-benchmark.js";
import { readTelemetryEvents } from "./jsonl-store.js";
import { loadModelCatalog, type ModelCatalog } from "./model-catalog.js";
import type { TelemetryEvent } from "./types.js";

export interface UsageView {
  /** Billed (authoritative) prompt-cache figures. `hit_rate` null = no samples. */
  readonly cache: {
    readonly samples: number;
    readonly hit_rate: number | null;
    readonly cache_read_tokens: number;
    readonly cache_creation_tokens: number;
    readonly uncached_input_tokens: number;
    readonly billed_input_tokens: number;
  };
  /** Billed tokens priced from the model catalog; null when no catalog was available. */
  readonly spend: SpendSummary | null;
  /** chars/4 or substitution estimates, NOT billed. */
  readonly estimated: {
    readonly avoided_upstream_input_tokens: number;
    readonly avoided_upstream_output_tokens: number;
    readonly drafted_locally_tokens: number;
  };
}

/** Pure fold over recorded events. All-time window, like the dashboard's savings tiles. */
export function buildUsageView(
  events: readonly TelemetryEvent[],
  opts: { readonly nowMs: number; readonly catalog?: ModelCatalog },
): UsageView {
  const cache = aggregateCacheStats(events);
  const bench = buildCostBenchmark(events, {
    window: "all",
    nowMs: opts.nowMs,
    ...(opts.catalog !== undefined ? { catalog: opts.catalog } : {}),
  });
  return {
    cache: {
      samples: cache.samples,
      hit_rate: cache.hitRate,
      cache_read_tokens: cache.cacheReadTokens,
      cache_creation_tokens: cache.cacheCreationTokens,
      uncached_input_tokens: cache.uncachedInputTokens,
      billed_input_tokens:
        cache.cacheReadTokens + cache.cacheCreationTokens + cache.uncachedInputTokens,
    },
    spend: bench.spend ?? null,
    estimated: {
      avoided_upstream_input_tokens: bench.golem_savings.avoided_upstream_input_tokens,
      avoided_upstream_output_tokens: bench.golem_savings.avoided_upstream_output_tokens,
      drafted_locally_tokens: bench.golem_savings.drafted_locally_tokens_est,
    },
  };
}

/** Read telemetry + catalog for `dir`. Never throws: a failed source degrades to "no data". */
export async function collectUsageView(dir: string): Promise<UsageView> {
  let events: readonly TelemetryEvent[] = [];
  try {
    events = await readTelemetryEvents(dir);
  } catch {
    events = [];
  }
  let catalog: ModelCatalog | undefined;
  try {
    catalog = await loadModelCatalog(dir);
  } catch {
    catalog = undefined;
  }
  return buildUsageView(events, {
    nowMs: Date.now(),
    ...(catalog !== undefined ? { catalog } : {}),
  });
}
