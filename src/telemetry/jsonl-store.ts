/**
 * WS-A A4 — append-only JSONL telemetry store (P0 default backend).
 *
 * One JSON object per line under `<project>/.golem/telemetry/events.jsonl`.
 * Appends are serialized through an internal promise chain so concurrent
 * record() calls cannot interleave partial lines, and each append is a single
 * `appendFile` of `<json>\n` (atomic enough for line-oriented readers). A
 * corrupt/partial trailing line is skipped on read rather than throwing, so a
 * crash mid-write never poisons future aggregates.
 *
 * `aggregate()` is the one method on the `golem statusline` hot path (it ticks
 * every ~2s of every session) — verification-notes §167 measured it at ~517ms
 * of a ~900ms statusline invocation against this repo's own 25.8MB/70k-event
 * file, because it re-read and re-parsed the WHOLE file on every call, with no
 * cache and no ceiling. Two changes fix that:
 *
 * 1. **Incremental rollup cache** (`.golem/state/telemetry-rollup.json`, see
 *    {@link telemetryRollupPath}). `aggregate()` stats the file, and if the
 *    cached watermark shows only growth since last time, it reads and folds
 *    just the NEW bytes on top of the cached totals instead of re-parsing from
 *    byte zero. The cache is keyed by `projectId` (or a sentinel for the
 *    unscoped query) so every caller shape stays correct.
 *
 *    Cross-process safety: the cache is a derived view over a file OTHER
 *    Golem processes (other sessions, the proxy) may be appending to
 *    concurrently, and it is never assumed to have been written by "this"
 *    process. Trust is decided purely by comparing the file's CURRENT
 *    `ino`/`size`/`mtimeMs` against what the cache last recorded: same inode
 *    and growth-only is trusted, anything else (rotation, shrink, backwards
 *    mtime, missing/corrupt cache) falls back to a full reparse. The
 *    watermark only ever advances to the last complete line, so a record
 *    still being written is picked up once finished. The fallback is always
 *    correct, so a stale or racing cache costs performance, not a wrong
 *    number. A rewrite that keeps the inode, grows the file and moves mtime
 *    forward cannot be told from an append; nothing in this store does that.
 *
 * 2. **Rotation** (see {@link JsonlTelemetryStore#record}): once `events.jsonl`
 *    passes `rotateThresholdBytes` (10MB by default — big enough that normal
 *    projects rotate roughly every few months at R11.7's measured ~2MB/11.6k
 *    events, small enough that a cold full reparse after rotation is cheap),
 *    it is renamed to `events.jsonl.1` and a fresh file starts. Exactly one
 *    prior generation is kept — a second rotation overwrites `.1` — so the
 *    file (and the worst-case full-reparse cost) never grows past roughly two
 *    generations. Every full-file reader in this module (not just
 *    `aggregate()`) reads `.1` + current via {@link readAllGenerations}, so
 *    none of them regress to "unbounded" even though only `aggregate()` gets
 *    the incremental fast path — it is the only one on a tight polling loop
 *    today. The trade-off is explicit: totals reflect at most ~2 rotation
 *    generations, not literally all-time history, in exchange for a bounded
 *    file. Revisit if a caller ever needs true unbounded retention.
 *
 * a future node:sqlite backend (same TelemetryStore interface) can replace
 * all of this with an index if it ever needs to be more than "bounded flat
 * file + cache".
 */

import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CompressionStats, TokenDelta } from "../interfaces/compression.js";
import { isRecord } from "../shared/json.js";
import type {
  AvoidedUpstreamStats,
  TelemetryEvent,
  TelemetryStore,
  ToolUsagePerTool,
  ToolUsageStats,
  UsageByBrevity,
  UsageByLevel,
  UsageBySemanticForced,
  UsageTotals,
} from "./types.js";

/** Telemetry file location for a project. */
export function telemetryFilePath(projectDir: string): string {
  return path.join(projectDir, ".golem", "telemetry", "events.jsonl");
}

/** The one retained prior rotation generation, alongside the current file. */
function rotatedTelemetryFilePath(file: string): string {
  return `${file}.1`;
}

/** Default rotation threshold — see the module doc comment for why 10MB. */
const DEFAULT_ROTATE_THRESHOLD_BYTES = 10 * 1024 * 1024;

/**
 * Read the current file plus its one retained prior rotation generation
 * (`events.jsonl.1`, if any), concatenated. Missing files (never rotated, or
 * no telemetry recorded yet) read as empty rather than throwing — every
 * caller here already treats an empty string as "no events" via
 * {@link parseEvent} skipping the resulting blank line.
 */
async function readAllGenerations(file: string): Promise<string> {
  const [rotated, current] = await Promise.all([
    readOrEmptyFile(rotatedTelemetryFilePath(file)),
    readOrEmptyFile(file),
  ]);
  return rotated + current;
}

/** Read a whole file as utf8, or "" when it does not exist. Rethrows any other error. */
async function readOrEmptyFile(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Read `file` from byte `start` up to `end` inclusive (or its current end,
 * when `end` is omitted), without loading anything before `start`. Used by
 * {@link JsonlTelemetryStore#aggregate}'s incremental path so a cache hit
 * costs O(new bytes), not O(whole file) — and by its full-reparse path with
 * an explicit `end` so the checkpoint it writes can never claim to have
 * folded bytes a concurrent append added AFTER the read already started (see
 * that path's own comment for the corruption this closes). A file that
 * shrank out from under `start` (e.g. a concurrent rotation) yields "" rather
 * than throwing — the caller's own size/mtime check is what decides whether
 * that is trustworthy, not this function.
 */
/**
 * Split off the complete lines of `text`: everything up to and including the
 * last `\n`. A trailing fragment with no newline is a record another process
 * is still writing, so it is neither folded nor counted in `consumedBytes`.
 */
function completeLines(text: string): { complete: string; consumedBytes: number } {
  const complete = text.slice(0, text.lastIndexOf("\n") + 1);
  return { complete, consumedBytes: Buffer.byteLength(complete, "utf8") };
}

function readFromOffset(file: string, start: number, end?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readStream = createReadStream(file, end === undefined ? { start } : { start, end });
    readStream.on("data", (chunk) => chunks.push(chunk as Buffer));
    readStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    readStream.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") resolve("");
      else reject(err);
    });
  });
}

const tokenDeltaSchema = z.object({ tokensBefore: z.number(), tokensAfter: z.number() });

/** Mutable accumulator shape for {@link JsonlTelemetryStore#aggregate} — see {@link foldAggregateEvent}. */
interface AggregateTotals {
  requests: number;
  tokensBefore: number;
  tokensAfter: number;
  ccrRefsStored: number;
  ccrRefsRetrieved: number;
  perStage: Record<string, TokenDelta>;
}

const aggregateTotalsSchema = z.object({
  requests: z.number(),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
  ccrRefsStored: z.number(),
  ccrRefsRetrieved: z.number(),
  perStage: z.record(z.string(), tokenDeltaSchema),
});

/** One cached checkpoint: how far into `events.jsonl` we've folded, and the running totals. */
const rollupEntrySchema = z.object({
  /** Byte offset into the CURRENT file (never counts `.1`) already folded into `totals`. */
  offset: z.number(),
  /**
   * The trusted watermark to compare a fresh `stat()` against. Deliberately
   * set to `offset`, not whatever the raw file size happened to be at write
   * time — see the cross-process-safety note in the module doc comment.
   */
  size: z.number(),
  mtimeMs: z.number(),
  /**
   * Inode of the CURRENT file the offset refers to. A rotation replaces the
   * file, so a changed inode means `offset` points into a different file and
   * must not be trusted (size/mtime alone cannot see a rotation once the new
   * file has grown past the old watermark). Absent on entries written before
   * this field existed: those are distrusted once and rewritten.
   */
  ino: z.number().optional(),
  totals: aggregateTotalsSchema,
});
type RollupEntry = z.infer<typeof rollupEntrySchema>;

const rollupFileSchema = z.object({
  version: z.literal(1),
  /** Keyed by `projectId`, or {@link ROLLUP_ALL_KEY} for the unscoped query. */
  entries: z.record(z.string(), rollupEntrySchema),
});
type RollupFile = z.infer<typeof rollupFileSchema>;

/** Real `projectId` values are never empty-and-NUL-wrapped, so this can't collide. */
const ROLLUP_ALL_KEY = "\u0000all\u0000";

/** `.golem/state/telemetry-rollup.json` for a project — {@link JsonlTelemetryStore#aggregate}'s cache. */
export function telemetryRollupPath(projectDir: string): string {
  return path.join(projectDir, ".golem", "state", "telemetry-rollup.json");
}

/** Read the rollup cache. Missing, unreadable, malformed, or schema-mismatched → null (never throws). */
async function readTelemetryRollup(file: string): Promise<RollupFile | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = rollupFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Persist one key's rollup entry, merging into whatever is already on disk so
 * other keys (other `projectId` scopes) survive. Best-effort, matching
 * `syncClaudeWiring`'s philosophy in `src/cli/version-sync.ts` ("neither the
 * proxy daemon starting nor a SessionStart hook should be crashable by
 * settings bookkeeping") — a failed write here must never fail the
 * `aggregate()` call it supports. Worst case, the next call sees a stale or
 * missing cache and falls back to a full reparse, which is always correct.
 */
async function writeTelemetryRollupEntry(
  file: string,
  key: string,
  entry: RollupEntry,
): Promise<void> {
  try {
    const existing = await readTelemetryRollup(file);
    const next: RollupFile = {
      version: 1,
      entries: { ...(existing?.entries ?? {}), [key]: entry },
    };
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  } catch {
    // Best-effort — see doc comment above.
  }
}

function emptyAggregateTotals(): AggregateTotals {
  return {
    requests: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    ccrRefsStored: 0,
    ccrRefsRetrieved: 0,
    perStage: {},
  };
}

function cloneAggregateTotals(totals: AggregateTotals): AggregateTotals {
  return { ...totals, perStage: { ...totals.perStage } };
}

function toCompressionStats(
  projectId: string | undefined,
  totals: AggregateTotals,
): CompressionStats {
  return {
    projectId: projectId ?? null,
    requests: totals.requests,
    tokensBefore: totals.tokensBefore,
    tokensAfter: totals.tokensAfter,
    perStage: totals.perStage,
    ccrRefsStored: totals.ccrRefsStored,
    ccrRefsRetrieved: totals.ccrRefsRetrieved,
  };
}

/**
 * Fold one already-parsed event into `acc`, exactly matching what the old
 * inline loop in `aggregate()` did — extracted so the full-reparse path and
 * the incremental path can never drift apart from each other.
 */
function foldAggregateEvent(
  acc: AggregateTotals,
  ev: TelemetryEvent,
  projectId: string | undefined,
): void {
  if (projectId !== undefined && ev.projectId !== projectId) return;

  if (ev.kind === "retrieval") {
    // Not a pipeline run — counts toward ccrRefsRetrieved only, never
    // toward `requests` or token savings (verification-notes §25).
    acc.ccrRefsRetrieved += ev.ccrRefsRetrieved ?? 0;
    return;
  }
  if (ev.kind === "usage") {
    // Not a pipeline run either — rolled up separately by
    // aggregateUsageByLevel (R1.1), never into the gross-token headline.
    return;
  }
  if (ev.kind === "avoidedUpstream") {
    // Not a pipeline run either — rolled up separately by
    // aggregateAvoidedUpstream (R2.2), never into the gross-token headline.
    return;
  }
  if (ev.kind === "tool") {
    // Not a pipeline run either — rolled up separately by
    // aggregateToolUsage (R4.3), never into the gross-token headline.
    return;
  }

  acc.requests += 1;
  acc.ccrRefsStored += ev.ccrRefsStored;

  // Headline savings = the WHOLE-request before/after (requestTokens). Only
  // legacy events (written before that field) fall back to the mixed-scope
  // stage stitch, which over-reports (verification-notes §30).
  const stageEntries = Object.entries(ev.stageSavings);
  if (ev.requestTokens !== undefined) {
    acc.tokensBefore += ev.requestTokens.tokensBefore;
    acc.tokensAfter += ev.requestTokens.tokensAfter;
  } else if (stageEntries.length > 0) {
    const firstBefore = stageEntries[0]?.[1].tokensBefore ?? 0;
    const lastAfter = stageEntries[stageEntries.length - 1]?.[1].tokensAfter ?? firstBefore;
    acc.tokensBefore += firstBefore;
    acc.tokensAfter += lastAfter;
  }

  for (const [stage, delta] of stageEntries) {
    const existing = acc.perStage[stage] ?? { tokensBefore: 0, tokensAfter: 0 };
    acc.perStage[stage] = {
      tokensBefore: existing.tokensBefore + delta.tokensBefore,
      tokensAfter: existing.tokensAfter + delta.tokensAfter,
    };
  }
}

/**
 * Read and parse every recorded event for a project (R6.4 — the cost-governance
 * benchmark needs raw, timestamped events to window by 24h/7d, which the
 * kind-specific `aggregate*` rollups do not expose). A missing file yields an
 * empty list; corrupt/partial lines are skipped, same as {@link parseEvent}
 * everywhere else. Read-only — never used on the request critical path.
 *
 * Reads current + one retained rotation generation ({@link readAllGenerations}),
 * same as every other full-file reader in this module — bounded by rotation,
 * not incrementally cached (unlike {@link JsonlTelemetryStore#aggregate}, this
 * isn't on a tight polling loop, so the simpler bound is enough).
 */
export async function readTelemetryEvents(projectDir: string): Promise<readonly TelemetryEvent[]> {
  const raw = await readAllGenerations(telemetryFilePath(projectDir));
  const events: TelemetryEvent[] = [];
  for (const line of raw.split("\n")) {
    const ev = parseEvent(line);
    if (ev !== null) events.push(ev);
  }
  return events;
}

function isTokenDelta(v: unknown): v is TokenDelta {
  return isRecord(v) && typeof v.tokensBefore === "number" && typeof v.tokensAfter === "number";
}

function isUsageTotals(v: unknown): v is UsageTotals {
  return (
    isRecord(v) &&
    typeof v.inputTokens === "number" &&
    typeof v.cacheCreationInputTokens === "number" &&
    typeof v.cacheReadInputTokens === "number" &&
    typeof v.outputTokens === "number"
  );
}

/** Parse one JSONL line into a TelemetryEvent, or null if malformed. */
function parseEvent(line: string): TelemetryEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null; // partial/corrupt trailing line — skip, don't throw
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.projectId !== "string" || typeof parsed.ts !== "string") return null;
  const stageSavings: Record<string, TokenDelta> = {};
  if (isRecord(parsed.stageSavings)) {
    for (const [k, v] of Object.entries(parsed.stageSavings)) {
      if (isTokenDelta(v))
        stageSavings[k] = { tokensBefore: v.tokensBefore, tokensAfter: v.tokensAfter };
    }
  }
  const kind =
    parsed.kind === "retrieval"
      ? "retrieval"
      : parsed.kind === "usage"
        ? "usage"
        : parsed.kind === "avoidedUpstream"
          ? "avoidedUpstream"
          : parsed.kind === "tool"
            ? "tool"
            : "request";
  return {
    ts: parsed.ts,
    projectId: parsed.projectId,
    level: typeof parsed.level === "number" ? parsed.level : 0,
    kind,
    ...(isTokenDelta(parsed.requestTokens) ? { requestTokens: parsed.requestTokens } : {}),
    stageSavings,
    ccrRefsStored: typeof parsed.ccrRefsStored === "number" ? parsed.ccrRefsStored : 0,
    ccrRefsRetrieved: typeof parsed.ccrRefsRetrieved === "number" ? parsed.ccrRefsRetrieved : 0,
    ...(isUsageTotals(parsed.usage) ? { usage: parsed.usage } : {}),
    semanticForced: parsed.semanticForced === true,
    // Decision 52. Absent on every line written before the dial existed, which
    // must read as "off" — brevity could not have been on then.
    ...(typeof parsed.brevity === "string" ? { brevity: parsed.brevity } : {}),
    ...(typeof parsed.brevityDirectiveTokens === "number"
      ? { brevityDirectiveTokens: parsed.brevityDirectiveTokens }
      : {}),
    ...(typeof parsed.avoidedUpstreamInputTokens === "number"
      ? { avoidedUpstreamInputTokens: parsed.avoidedUpstreamInputTokens }
      : {}),
    ...(typeof parsed.avoidedUpstreamOutputTokens === "number"
      ? { avoidedUpstreamOutputTokens: parsed.avoidedUpstreamOutputTokens }
      : {}),
    ...(typeof parsed.tool === "string" ? { tool: parsed.tool } : {}),
    ...(typeof parsed.toolDurationMs === "number" ? { toolDurationMs: parsed.toolDurationMs } : {}),
    ...(typeof parsed.toolResultBytes === "number"
      ? { toolResultBytes: parsed.toolResultBytes }
      : {}),
    ...(typeof parsed.toolModel === "string" ? { toolModel: parsed.toolModel } : {}),
    ...(typeof parsed.toolDraftChars === "number" ? { toolDraftChars: parsed.toolDraftChars } : {}),
    // R8.1. These were written by the proxy but NOT carried here, so
    // `aggregateCacheStats` could never see a verdict and always reported "none
    // recorded" — the field-by-field reconstruction in this function is an
    // allow-list, and a new TelemetryEvent field is invisible until added to it.
    // Any future field needs a line here AND a round-trip test through the store;
    // a unit test that feeds objects straight to an aggregator will not catch it.
    ...(typeof parsed.cachePrefix === "string" ? { cachePrefix: parsed.cachePrefix } : {}),
    ...(typeof parsed.cacheBustComponent === "string"
      ? { cacheBustComponent: parsed.cacheBustComponent }
      : {}),
    // R8.13 — and the same allow-list rule applies to these two.
    ...(typeof parsed.cacheBustMessageIndex === "number"
      ? { cacheBustMessageIndex: parsed.cacheBustMessageIndex }
      : {}),
    ...(typeof parsed.cacheMessageCount === "number"
      ? { cacheMessageCount: parsed.cacheMessageCount }
      : {}),
    // R8.8 — the same allow-list rule again, and it bit again: the proxy wrote
    // `model`/`modelProvider` and `golem bench cost` still reported every sample
    // as unattributed until these two lines existed. Caught by running the real
    // command against real telemetry, which is why the round-trip test below
    // exists rather than a fold-only unit test.
    ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
    ...(typeof parsed.modelProvider === "string" ? { modelProvider: parsed.modelProvider } : {}),
  };
}

export class JsonlTelemetryStore implements TelemetryStore {
  readonly #file: string;
  readonly #rollupFile: string;
  readonly #rotateThresholdBytes: number;
  /** Serializes appends so concurrent record() calls never interleave lines. */
  #writeChain: Promise<void> = Promise.resolve();
  #dirEnsured = false;

  /**
   * `rotateThresholdBytes` overrides the default 10MB rotation threshold —
   * exposed only so tests can force a rotation without writing 10MB of
   * fixture events; production callers ({@link openTelemetryStore}) always
   * use the default.
   */
  constructor(projectDir: string, options?: { readonly rotateThresholdBytes?: number }) {
    this.#file = telemetryFilePath(projectDir);
    this.#rollupFile = telemetryRollupPath(projectDir);
    this.#rotateThresholdBytes = options?.rotateThresholdBytes ?? DEFAULT_ROTATE_THRESHOLD_BYTES;
  }

  async #ensureDir(): Promise<void> {
    if (this.#dirEnsured) return;
    await mkdir(path.dirname(this.#file), { recursive: true });
    this.#dirEnsured = true;
  }

  record(event: TelemetryEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    // Chain the append after any in-flight write; swallow errors into the chain
    // so telemetry never throws into the request path (fire-and-forget).
    const next = this.#writeChain.then(async () => {
      await this.#ensureDir();
      await appendFile(this.#file, line, "utf8");
      await this.#rotateIfNeeded();
    });
    // Keep the chain alive even if this write rejects.
    this.#writeChain = next.catch(() => {});
    return next;
  }

  /**
   * Rotate `events.jsonl` → `events.jsonl.1` once the current file crosses
   * `#rotateThresholdBytes` — see the module doc comment for why. Runs
   * inside the write chain (after the append it follows, before the NEXT
   * queued append), so within this process a rotation can never race a
   * concurrent record() call; across processes it can, same as every other
   * multi-process write to this file, and `rename`'s atomic replace of an
   * existing `.1` keeps that race from corrupting either file.
   *
   * Best-effort: a failed rotation just means the file keeps growing past
   * the threshold until the next append tries again — it must never fail
   * the record() call the caller is waiting on.
   */
  async #rotateIfNeeded(): Promise<void> {
    let size: number;
    try {
      size = (await stat(this.#file)).size;
    } catch {
      return;
    }
    if (size < this.#rotateThresholdBytes) return;
    try {
      await rename(this.#file, rotatedTelemetryFilePath(this.#file));
    } catch {
      // Best-effort — see doc comment above.
    }
  }

  async aggregate(projectId?: string): Promise<CompressionStats> {
    const key = projectId ?? ROLLUP_ALL_KEY;

    let currentStat: { size: number; mtimeMs: number; ino: number } | null;
    try {
      currentStat = await stat(this.#file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // No current file — a just-rotated prior generation can still hold
      // data, so fall through to the full reparse rather than reporting
      // empty stats outright.
      currentStat = null;
    }

    const rollup = await readTelemetryRollup(this.#rollupFile);
    const entry = rollup?.entries[key];
    const trustworthy =
      currentStat !== null &&
      entry !== undefined &&
      entry.ino !== undefined &&
      currentStat.ino === entry.ino &&
      currentStat.size >= entry.size &&
      currentStat.mtimeMs >= entry.mtimeMs;

    if (!trustworthy) return this.#fullReparseAggregate(projectId, key);

    // Incremental path: fold only the bytes appended since the rollup was
    // written, on top of the totals it already has. Safe per the module doc
    // comment's cross-process-safety note — `trustworthy` above is the whole
    // argument, and it is re-checked from scratch on every call.
    const appended = await readFromOffset(this.#file, entry.offset);
    const acc = cloneAggregateTotals(entry.totals);
    // Advance only past complete lines: a partial trailing record is re-read
    // whole on the next call instead of being lost.
    const { complete, consumedBytes } = completeLines(appended);
    for (const line of complete.split("\n")) {
      const ev = parseEvent(line);
      if (ev !== null) foldAggregateEvent(acc, ev, projectId);
    }
    const newOffset = entry.offset + consumedBytes;
    await writeTelemetryRollupEntry(this.#rollupFile, key, {
      offset: newOffset,
      size: newOffset,
      mtimeMs: currentStat?.mtimeMs ?? entry.mtimeMs,
      ino: currentStat?.ino,
      totals: acc,
    });
    return toCompressionStats(projectId, acc);
  }

  /**
   * Full reparse: current + one retained rotation generation (never
   * unbounded — see the module doc comment), used both for a cold cache and
   * for a distrusted one. Always correct; the only cost of reaching here
   * unnecessarily is performance, not a wrong number.
   */
  async #fullReparseAggregate(
    projectId: string | undefined,
    key: string,
  ): Promise<CompressionStats> {
    // R14.6 — stat the CURRENT file BEFORE reading it, and read only up to
    // that boundary, so the checkpoint this writes can never claim to have
    // folded more than `acc` actually reflects.
    //
    // The previous version stat'd AFTER reading and checkpointed THAT size —
    // a TOCTOU race with any concurrent writer (a fire-and-forget telemetry
    // write from this same process, or another one entirely): read the file
    // at N bytes (1 event), then before the post-read stat, a concurrent
    // append grows it to N+k bytes (2 events); the checkpoint then recorded
    // {offset: N+k, totals: <1 event>} — claiming everything up to N+k was
    // already folded when only N bytes had been. Because the incremental
    // path's next call trusts `entry.offset` as its read-from watermark, that
    // second event was never re-read: `aggregate()` was stuck reporting the
    // stale total forever, not just briefly. Reproduced locally under
    // concurrent load (60 parallel writers) as the exact corrupted pairing
    // `{offset: <full size>, totals: {ccrRefsRetrieved: 1}}` against a file
    // that already durably held 2 events — the write path was never at
    // fault, only this checkpoint's bookkeeping.
    let preReadStat: { size: number; mtimeMs: number; ino: number } | null;
    try {
      preReadStat = await stat(this.#file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      preReadStat = null; // no current file — rotation-only content, if any
    }
    const rotated = await readOrEmptyFile(rotatedTelemetryFilePath(this.#file));
    const currentRaw =
      preReadStat === null || preReadStat.size === 0
        ? ""
        : await readFromOffset(this.#file, 0, preReadStat.size - 1);
    // Checkpoint only up to the last complete line; see completeLines().
    const { complete: current, consumedBytes: currentConsumed } = completeLines(currentRaw);
    const raw = rotated + current;
    const acc = emptyAggregateTotals();
    for (const line of raw.split("\n")) {
      const ev = parseEvent(line);
      if (ev !== null) foldAggregateEvent(acc, ev, projectId);
    }

    // `.1`'s contribution is already baked into `acc` and is never re-read
    // until the next rotation invalidates this checkpoint (via the size/mtime
    // mismatch check) and triggers another full reparse.
    if (preReadStat !== null) {
      await writeTelemetryRollupEntry(this.#rollupFile, key, {
        offset: currentConsumed,
        size: currentConsumed,
        mtimeMs: preReadStat.mtimeMs,
        ino: preReadStat.ino,
        totals: acc,
      });
    }
    return toCompressionStats(projectId, acc);
  }

  async aggregateUsageByLevel(projectId?: string): Promise<UsageByLevel> {
    const raw = await readAllGenerations(this.#file);

    const byLevel: Record<number, UsageTotals & { requests: number }> = {};
    for (const line of raw.split("\n")) {
      const ev = parseEvent(line);
      if (ev === null || ev.kind !== "usage" || ev.usage === undefined) continue;
      if (projectId !== undefined && ev.projectId !== projectId) continue;

      const acc = byLevel[ev.level] ?? {
        requests: 0,
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
      };
      byLevel[ev.level] = {
        requests: acc.requests + 1,
        inputTokens: acc.inputTokens + ev.usage.inputTokens,
        cacheCreationInputTokens: acc.cacheCreationInputTokens + ev.usage.cacheCreationInputTokens,
        cacheReadInputTokens: acc.cacheReadInputTokens + ev.usage.cacheReadInputTokens,
        outputTokens: acc.outputTokens + ev.usage.outputTokens,
      };
    }
    return { projectId: projectId ?? null, byLevel };
  }

  async aggregateUsageBySemanticForced(projectId?: string): Promise<UsageBySemanticForced> {
    const empty = (): UsageTotals & { requests: number } => ({
      requests: 0,
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    });
    const raw = await readAllGenerations(this.#file);

    let forced = empty();
    let notForced = empty();
    for (const line of raw.split("\n")) {
      const ev = parseEvent(line);
      if (ev === null || ev.kind !== "usage" || ev.usage === undefined) continue;
      if (projectId !== undefined && ev.projectId !== projectId) continue;

      const acc = ev.semanticForced === true ? forced : notForced;
      const next = {
        requests: acc.requests + 1,
        inputTokens: acc.inputTokens + ev.usage.inputTokens,
        cacheCreationInputTokens: acc.cacheCreationInputTokens + ev.usage.cacheCreationInputTokens,
        cacheReadInputTokens: acc.cacheReadInputTokens + ev.usage.cacheReadInputTokens,
        outputTokens: acc.outputTokens + ev.usage.outputTokens,
      };
      if (ev.semanticForced === true) forced = next;
      else notForced = next;
    }
    return { projectId: projectId ?? null, forced, notForced };
  }

  /**
   * Decision 52 — brevity rollup. Reads BOTH event kinds in one pass because the
   * two halves of the honest number live in different places: billed output
   * tokens on `usage` samples, and the directive's input cost on pipeline
   * events. Events written before the dial existed carry no `brevity` field and
   * are attributed to "off", which is correct — brevity could not have been on.
   */
  async aggregateUsageByBrevity(projectId?: string): Promise<UsageByBrevity> {
    const raw = await readAllGenerations(this.#file);

    // Mutable accumulator (UsageTotals' fields are readonly); widened back to the
    // readonly shape by the return type.
    interface BrevityAcc {
      requests: number;
      inputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      outputTokens: number;
      directiveTokens: number;
      injections: number;
    }
    const byBrevity: Record<string, BrevityAcc> = {};
    const bucket = (key: string) => {
      const existing = byBrevity[key];
      if (existing !== undefined) return existing;
      const fresh = {
        requests: 0,
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
        directiveTokens: 0,
        injections: 0,
      };
      byBrevity[key] = fresh;
      return fresh;
    };

    for (const line of raw.split("\n")) {
      const ev = parseEvent(line);
      if (ev === null) continue;
      if (projectId !== undefined && ev.projectId !== projectId) continue;
      const key = ev.brevity ?? "off";

      if (ev.kind === "usage" && ev.usage !== undefined) {
        const acc = bucket(key);
        acc.requests += 1;
        acc.inputTokens += ev.usage.inputTokens;
        acc.cacheCreationInputTokens += ev.usage.cacheCreationInputTokens;
        acc.cacheReadInputTokens += ev.usage.cacheReadInputTokens;
        acc.outputTokens += ev.usage.outputTokens;
        continue;
      }
      // Pipeline events (kind absent === "request") carry the directive's cost.
      if (ev.kind === undefined || ev.kind === "request") {
        const cost = ev.brevityDirectiveTokens ?? 0;
        if (cost > 0) {
          const acc = bucket(key);
          acc.directiveTokens += cost;
          acc.injections += 1;
        }
      }
    }
    return { projectId: projectId ?? null, byBrevity };
  }

  async aggregateAvoidedUpstream(projectId?: string): Promise<AvoidedUpstreamStats> {
    const raw = await readAllGenerations(this.#file);

    let events = 0;
    let inputTokensAvoided = 0;
    let outputTokensAvoided = 0;
    for (const line of raw.split("\n")) {
      const ev = parseEvent(line);
      if (ev === null || ev.kind !== "avoidedUpstream") continue;
      if (projectId !== undefined && ev.projectId !== projectId) continue;
      events += 1;
      inputTokensAvoided += ev.avoidedUpstreamInputTokens ?? 0;
      outputTokensAvoided += ev.avoidedUpstreamOutputTokens ?? 0;
    }
    return { projectId: projectId ?? null, events, inputTokensAvoided, outputTokensAvoided };
  }

  async aggregateToolUsage(projectId?: string): Promise<ToolUsageStats> {
    const raw = await readAllGenerations(this.#file);

    const byTool: Record<string, ToolUsagePerTool> = {};
    for (const line of raw.split("\n")) {
      const ev = parseEvent(line);
      if (ev === null || ev.kind !== "tool" || ev.tool === undefined) continue;
      if (projectId !== undefined && ev.projectId !== projectId) continue;

      const acc = byTool[ev.tool] ?? {
        calls: 0,
        totalDurationMs: 0,
        totalResultBytes: 0,
        draftChars: 0,
      };
      byTool[ev.tool] = {
        calls: acc.calls + 1,
        totalDurationMs: acc.totalDurationMs + (ev.toolDurationMs ?? 0),
        totalResultBytes: acc.totalResultBytes + (ev.toolResultBytes ?? 0),
        draftChars: acc.draftChars + (ev.toolDraftChars ?? 0),
      };
    }
    return { projectId: projectId ?? null, byTool };
  }

  async close(): Promise<void> {
    // Drain any pending appends.
    await this.#writeChain;
  }
}
