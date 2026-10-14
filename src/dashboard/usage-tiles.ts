/**
 * DUST2.18 — display model for the dashboard's usage tiles.
 *
 * Pure: {@link UsageView} in, label/value/basis strings out. The page (server
 * render AND the client poller) only ever shows these strings, so the honesty
 * rules live in one tested place:
 *
 * - `basis: "billed"` is for figures off upstream `usage` blocks (cache hit
 *   rate, billed input tokens, cost priced from them). Only these may appear
 *   without an "estimated" label.
 * - `basis: "estimated"` is chars/4 or a substitution estimate; its label
 *   always says "(est.)".
 * - No data renders as plain words, never NaN / undefined / Infinity / "0%".
 */

import type { UsageView } from "../telemetry/usage-view.js";

export type TileBasis = "billed" | "estimated";

export interface UsageTile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly basis: TileBasis;
}

export const NO_USAGE_YET = "no usage data yet";
export const NOT_PRICED = "not priced";

/** Whole-number rendering; anything not a finite number is "no data", never "NaN". */
export function formatCount(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return NO_USAGE_YET;
  return Math.round(n).toLocaleString("en-US");
}

export function formatPercent(fraction: number | null | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return NO_USAGE_YET;
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatUsd(usd: number | null | undefined): string {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return NOT_PRICED;
  return `$${usd.toFixed(2)}`;
}

/** The tiles for `usage`; `undefined` (no usage block at all) reads as no data. */
export function usageTiles(usage: UsageView | undefined): readonly UsageTile[] {
  const hasSamples = usage !== undefined && usage.cache.samples > 0;
  const spend = usage?.spend ?? null;
  const priced = spend?.priced_usd ?? null;
  let cost = NOT_PRICED;
  if (!hasSamples) cost = NO_USAGE_YET;
  else if (priced !== null) {
    cost = formatUsd(priced);
    // A total that skipped models is a floor, not the bill — say so on the tile.
    if (spend !== null && (spend.unpriced_models.length > 0 || spend.unattributed_requests > 0)) {
      cost += " (partial)";
    }
  }
  const avoidedIn = usage?.estimated.avoided_upstream_input_tokens ?? 0;
  const avoidedOut = usage?.estimated.avoided_upstream_output_tokens ?? 0;
  return [
    {
      id: "cache-hit-rate",
      label: "Cache hit rate (billed)",
      value: hasSamples ? formatPercent(usage.cache.hit_rate) : NO_USAGE_YET,
      basis: "billed",
    },
    {
      id: "billed-input",
      label: "Tokens spent: billed input",
      value: hasSamples ? formatCount(usage.cache.billed_input_tokens) : NO_USAGE_YET,
      basis: "billed",
    },
    {
      id: "cost",
      label: "Cost (billed tokens x catalog prices)",
      value: cost,
      basis: "billed",
    },
    {
      id: "avoided-upstream",
      label: "Avoided upstream in / out (est.)",
      value:
        avoidedIn === 0 && avoidedOut === 0
          ? "none recorded"
          : `${formatCount(avoidedIn)} / ${formatCount(avoidedOut)}`,
      basis: "estimated",
    },
  ];
}
