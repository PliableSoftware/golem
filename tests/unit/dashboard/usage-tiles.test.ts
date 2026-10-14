/**
 * DUST2.18 — the dashboard's usage data path: the rollups are the SAME ones
 * `golem stats --cache` / `golem bench cost` use, billed and estimated figures
 * stay labelled apart, and an empty install shows words, never NaN.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { SessionStateReport } from "../../../src/cli/session-report.js";
import { sessionStateReportSchema } from "../../../src/cli/session-report.js";
import {
  type DashboardHandle,
  type DashboardSnapshot,
  escapeHtml,
  renderPage,
  startDashboard,
  usageTilesHtml,
} from "../../../src/dashboard/server.js";
import {
  formatCount,
  formatPercent,
  formatUsd,
  NO_USAGE_YET,
  usageTiles,
} from "../../../src/dashboard/usage-tiles.js";
import { aggregateCacheStats } from "../../../src/telemetry/cache-report.js";
import { buildCostBenchmark } from "../../../src/telemetry/cost-benchmark.js";
import { BUILTIN_MODEL_CATALOG } from "../../../src/telemetry/model-catalog.js";
import type { TelemetryEvent } from "../../../src/telemetry/types.js";
import { buildUsageView, createUsageViewCache } from "../../../src/telemetry/usage-view.js";

const NOW = Date.parse("2026-10-14T00:00:00.000Z");

function usage(
  model: string | undefined,
  read: number,
  write: number,
  input: number,
): TelemetryEvent {
  return {
    ts: "2026-10-13T00:00:00.000Z",
    projectId: "p1",
    level: 1,
    kind: "usage",
    stageSavings: {},
    ccrRefsStored: 0,
    ...(model !== undefined ? { model, modelProvider: "anthropic" } : {}),
    usage: {
      inputTokens: input,
      cacheCreationInputTokens: write,
      cacheReadInputTokens: read,
      outputTokens: 50,
    },
  };
}

const BAD_WORDS = /NaN|undefined|Infinity|null/;

describe("buildUsageView reuses the stats --cache / bench cost rollups", () => {
  const events = [usage("claude-opus-5", 900, 100, 0), usage("claude-opus-5", 800, 0, 200)];

  it("hit rate and billed input equal aggregateCacheStats", () => {
    const view = buildUsageView(events, { nowMs: NOW, catalog: BUILTIN_MODEL_CATALOG });
    const cache = aggregateCacheStats(events);
    expect(view.cache.hit_rate).toBe(cache.hitRate);
    expect(view.cache.samples).toBe(2);
    expect(view.cache.billed_input_tokens).toBe(2000);
  });

  it("spend equals buildCostBenchmark's spend", () => {
    const view = buildUsageView(events, { nowMs: NOW, catalog: BUILTIN_MODEL_CATALOG });
    const bench = buildCostBenchmark(events, {
      window: "all",
      nowMs: NOW,
      catalog: BUILTIN_MODEL_CATALOG,
    });
    expect(view.spend).toEqual(bench.spend);
    expect(view.spend?.priced_usd).not.toBeNull();
  });

  it("without a catalog spend is null, not zero", () => {
    expect(buildUsageView(events, { nowMs: NOW }).spend).toBeNull();
  });
});

describe("usageTiles", () => {
  it("labels billed tiles plainly and estimated tiles (est.)", () => {
    const view = buildUsageView([usage("claude-opus-5", 900, 100, 0)], {
      nowMs: NOW,
      catalog: BUILTIN_MODEL_CATALOG,
    });
    const tiles = usageTiles(view);
    for (const t of tiles) {
      if (t.basis === "estimated") expect(t.label).toContain("(est.)");
      else expect(t.label).not.toContain("est.");
    }
    expect(tiles.find((t) => t.id === "cache-hit-rate")?.value).toBe("90.0%");
    expect(tiles.find((t) => t.id === "cost")?.value).toMatch(/^\$\d/);
  });

  it("empty state says so in words, with no NaN/undefined/Infinity", () => {
    for (const v of [undefined, buildUsageView([], { nowMs: NOW })]) {
      const tiles = usageTiles(v);
      expect(tiles.find((t) => t.id === "cache-hit-rate")?.value).toBe(NO_USAGE_YET);
      expect(tiles.find((t) => t.id === "billed-input")?.value).toBe(NO_USAGE_YET);
      expect(tiles.find((t) => t.id === "cost")?.value).toBe(NO_USAGE_YET);
      for (const t of tiles) expect(`${t.label} ${t.value}`).not.toMatch(BAD_WORDS);
    }
  });

  it("an unpriced model is not shown as $0.00", () => {
    const view = buildUsageView([usage("some-unknown-model", 1, 1, 1)], {
      nowMs: NOW,
      catalog: BUILTIN_MODEL_CATALOG,
    });
    expect(usageTiles(view).find((t) => t.id === "cost")?.value).toBe("not priced");
  });

  it("formatters never leak non-finite numbers", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
      expect(formatCount(bad)).toBe(NO_USAGE_YET);
      expect(formatPercent(bad)).toBe(NO_USAGE_YET);
      expect(formatUsd(bad)).toBe("not priced");
    }
  });
});

describe("rendering helpers", () => {
  it("escapeHtml escapes markup characters", () => {
    expect(escapeHtml(`<img src=x onerror="a&b">`)).toBe(
      "&lt;img src=x onerror=&quot;a&amp;b&quot;&gt;",
    );
  });

  it("usageTilesHtml escapes label, value and id", () => {
    const html = usageTilesHtml([
      { id: '"><x', label: "<b>l</b>", value: "<script>v</script>", basis: "billed" },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });

  const snap = (usageView?: DashboardSnapshot["usage"]): DashboardSnapshot => ({
    project_dir: "/p",
    compression: { level: "1", name: "lossless" },
    stats: {
      source: "live",
      project_id: null,
      requests: 0,
      tokens_before: 0,
      tokens_after: 0,
      tokens_saved: 0,
      per_stage: {},
      ccr_refs_stored: 0,
      ccr_refs_retrieved: 0,
      note: "n",
    },
    generated_at: "2026-10-14T00:00:00.000Z",
    ...(usageView !== undefined ? { usage: usageView } : {}),
  });

  it("renderPage with no usage shows the empty wording and no NaN", () => {
    const html = renderPage(snap());
    expect(html).toContain(NO_USAGE_YET);
    expect(html).toContain("Usage and cost");
    const body = html.slice(html.indexOf('id="usage-tiles"'), html.indexOf("Stage attribution"));
    expect(body).not.toMatch(BAD_WORDS);
  });

  it("the client script sets usage text via textContent only", () => {
    const html = renderPage(snap());
    const script = html.slice(html.indexOf("<script>"));
    expect(script).not.toContain(".innerHTML");
  });
});

describe("HTTP data path", () => {
  let handle: DashboardHandle | undefined;
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  const view = buildUsageView([usage("claude-opus-5", 900, 100, 0)], {
    nowMs: NOW,
    catalog: BUILTIN_MODEL_CATALOG,
  });

  it("/api/state carries a schema-valid usage block", async () => {
    const state: SessionStateReport = {
      project_dir: "/p",
      generated_at: "2026-10-14T00:00:00.000Z",
      proxy: { running: null, upstream: "anthropic" },
      compression: { level: "1", name: "lossless", redaction_off: false },
      local_model: { reachable: null },
      autonomy: { level: "manual" },
      blocked: { waiting: false, status: "clear" },
      savings: {
        source: "live",
        project_id: null,
        requests: 0,
        tokens_before: 0,
        tokens_after: 0,
        tokens_saved: 0,
        per_stage: {},
        ccr_refs_stored: 0,
        ccr_refs_retrieved: 0,
        note: "n",
      },
      storage: { ccr_bytes: 0, knowledge_bytes: 0, telemetry_bytes: 0, webcache_bytes: 0 },
      usage: view,
    };
    handle = await startDashboard({
      port: 0,
      snapshot: () => Promise.reject(new Error("unused")),
      sessionState: () => Promise.resolve(state),
    });
    const json = await (await fetch(`${handle.url}api/state`)).json();
    const parsed = sessionStateReportSchema.parse(json);
    expect(parsed.usage?.cache.hit_rate).toBe(0.9);
    expect(JSON.stringify(json)).not.toMatch(/NaN|Infinity/);
  });

  it("/api/stats adds display tiles; the page shows them", async () => {
    const snapshot = (): Promise<DashboardSnapshot> =>
      Promise.resolve({ ...snapBase(), usage: view });
    handle = await startDashboard({ port: 0, snapshot });
    const json = (await (await fetch(`${handle.url}api/stats`)).json()) as {
      usage_tiles: { id: string; value: string }[];
    };
    expect(json.usage_tiles.map((t) => t.id)).toContain("cache-hit-rate");
    const page = await (await fetch(handle.url)).text();
    expect(page).toContain("90.0%");
  });
});

function snapBase(): DashboardSnapshot {
  return {
    project_dir: "/p",
    compression: { level: "1", name: "lossless" },
    stats: {
      source: "live",
      project_id: null,
      requests: 0,
      tokens_before: 0,
      tokens_after: 0,
      tokens_saved: 0,
      per_stage: {},
      ccr_refs_stored: 0,
      ccr_refs_retrieved: 0,
      note: "n",
    },
    generated_at: "2026-10-14T00:00:00.000Z",
  };
}

describe("createUsageViewCache", () => {
  const empty = buildUsageView([], { nowMs: NOW });
  const full = buildUsageView([usage("claude-opus-5", 900, 100, 0)], { nowMs: NOW });

  it("two polls inside the TTL compute once; one after it recomputes", async () => {
    let t = 0;
    let calls = 0;
    const get = createUsageViewCache({
      ttlMs: 10_000,
      now: () => t,
      compute: async () => {
        calls += 1;
        return full;
      },
    });
    await get("/p");
    t = 9_999;
    await get("/p");
    expect(calls).toBe(1);
    t = 10_000;
    await get("/p");
    expect(calls).toBe(2);
  });

  it("keys by project dir", async () => {
    let calls = 0;
    const get = createUsageViewCache({
      compute: async () => {
        calls += 1;
        return full;
      },
    });
    await get("/a");
    await get("/b");
    expect(calls).toBe(2);
  });

  it("concurrent polls single-flight", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const get = createUsageViewCache({
      compute: async () => {
        calls += 1;
        await gate;
        return full;
      },
    });
    const all = [get("/p"), get("/p"), get("/p")];
    release();
    const views = await Promise.all(all);
    expect(calls).toBe(1);
    expect(views.every((v) => v === full)).toBe(true);
  });

  it("a failure serves the last good value, else the empty state, and never throws", async () => {
    let t = 0;
    let fail = false;
    const get = createUsageViewCache({
      ttlMs: 10,
      now: () => t,
      compute: async () => {
        if (fail) throw new Error("boom");
        return full;
      },
    });
    fail = true;
    expect((await get("/p")).cache.samples).toBe(empty.cache.samples);
    fail = false;
    t = 100;
    expect(await get("/p")).toBe(full);
    fail = true;
    t = 200;
    expect(await get("/p")).toBe(full);
  });

  it("a failed computation does not wedge later polls", async () => {
    let n = 0;
    const get = createUsageViewCache({
      ttlMs: 0,
      compute: async () => {
        n += 1;
        if (n === 1) throw new Error("x");
        return full;
      },
    });
    await get("/p");
    expect(await get("/p")).toBe(full);
  });
});
