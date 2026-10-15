/**
 * DUST2.14 — the index watch daemon: keeps the vector index fresh for the chosen
 * roots (configured `watch_paths`, the project wiki) while a long-lived process
 * (`golem mcp serve`) is up, so a wiki page write reaches the index without a
 * manual `ingest`.
 *
 * It composes {@link watchPath} (the polling watcher; no native dependency, same
 * code on every OS) with a coalescing apply queue over the incremental-ingest
 * capability. The wiki stays the truth and the index a derived cache: this module
 * only READS files and writes the vector store, never a watched file.
 *
 * Invariants a reviewer should be able to check here:
 *  - bounded: one watcher per DISTINCT root (a root inside another is dropped), a
 *    file cap per watcher, debounce + poll interval, one apply in flight, pending
 *    work keyed by path so an event storm collapses instead of queueing;
 *  - never throws into the host: every failure is counted, logged once per
 *    occurrence, and swallowed; nothing here can reject unhandled;
 *  - never reads outside a watched root: each changed path is re-resolved with
 *    `realpath.native` and dropped unless it is still inside its root's real path
 *    (a symlink swapped in after the scan, or a `..` spelling, cannot escape);
 *  - keys match a full index: `baseDir` comes from {@link projectBaseDir} and keys
 *    from {@link sourcePathFor}, so an outside root lives in `external:` and a
 *    watch event can never touch a project file's chunks;
 *  - clean shutdown: `close()` stops every watcher and timer, drops queued work
 *    and waits for the one apply in flight.
 */

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { type FileChangeBatch, type FileWatcher, watchPath } from "./file-watcher.js";
import { projectBaseDir, sourcePathFor } from "./ingest.js";
import type { IncrementalIngest } from "./knowledge-base.js";

/** Default cap on chunkable files per watched root. */
export const WATCH_MAX_FILES = 5000;
/** Default poll interval for the daemon: slower than an ad-hoc watch, the scan covers whole trees. */
export const WATCH_POLL_MS = 2000;
/** Files re-embedded per `reindexFiles` call, so one bad batch costs a few files, not a storm. */
export const WATCH_APPLY_FILES = 20;

/** What one successfully applied slice of work changed, for a manifest/checkpoint recorder. */
export interface AppliedChange {
  /** The base the source paths are relative to (`external:` keys are absolute). */
  readonly baseDir: string;
  /**
   * Files re-indexed, with the mtime/size observed BEFORE they were read, so a
   * checkpoint built from this can lag the content but never lead it.
   */
  readonly changed: readonly {
    readonly abs: string;
    readonly mtimeMs: number;
    readonly size: number;
  }[];
  /** Source-path keys whose chunks were dropped. */
  readonly removedSourcePaths: readonly string[];
}

export interface IndexWatchDaemonOptions {
  readonly knowledge: IncrementalIngest;
  readonly projectId: string;
  /** Candidate roots (absolute). Missing, nested and duplicate roots are dropped. */
  readonly roots: readonly string[];
  readonly maxFiles?: number;
  readonly pollMs?: number;
  readonly debounceMs?: number;
  readonly log?: (msg: string) => void;
  /** Called after each applied slice; errors are swallowed. */
  readonly onApplied?: (change: AppliedChange) => Promise<void> | void;
  /** Test seam: the watcher factory. */
  readonly watch?: typeof watchPath;
}

export interface IndexWatchStats {
  /** Roots actually being watched (real paths). */
  readonly watched: readonly string[];
  /** Roots that were not watched, each with the reason. */
  readonly skipped: readonly { readonly root: string; readonly reason: string }[];
  /** Batches received from the watchers. */
  readonly batches: number;
  /** Files re-indexed / source paths removed so far. */
  readonly reindexed: number;
  readonly removed: number;
  /** Failures swallowed (watcher, apply, recorder, escaped paths). */
  readonly errors: number;
}

export interface IndexWatchDaemon {
  readonly stats: IndexWatchStats;
  /** Resolves once everything queued so far has been applied (or failed). A condition, not a sleep. */
  idle(): Promise<void>;
  /** Stop watching; drop queued work; wait for the in-flight apply. Idempotent, never rejects. */
  close(): Promise<void>;
}

interface RootCtx {
  readonly real: string;
  readonly baseDir: string;
}

interface Queued {
  readonly ctx: RootCtx;
  readonly abs: string;
  readonly kind: "changed" | "removed";
}

function realOrNull(p: string): string | null {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
}

/** True when `child` is `parent` or beneath it (native real paths, so case/8.3 spellings agree). */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

export async function startIndexWatchDaemon(
  options: IndexWatchDaemonOptions,
): Promise<IndexWatchDaemon> {
  const log = options.log ?? (() => {});
  const watch = options.watch ?? watchPath;
  const maxFiles = options.maxFiles ?? WATCH_MAX_FILES;
  const watchers: FileWatcher[] = [];
  const skipped: { root: string; reason: string }[] = [];
  const watched: string[] = [];
  let closed = false;
  let batches = 0;
  let reindexed = 0;
  let removed = 0;
  let errors = 0;

  const fail = (what: string, err: unknown): void => {
    errors += 1;
    try {
      log(`watch: ${what}: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      // a throwing logger must not take the daemon down
    }
  };

  // ---- resolve roots: exist, real path, distinct, outermost only -------------
  const resolved: { root: string; real: string; isFile: boolean }[] = [];
  for (const root of options.roots) {
    const abs = path.resolve(root);
    try {
      const st = await stat(abs);
      const real = realOrNull(abs);
      if (real === null) throw new Error("cannot resolve real path");
      resolved.push({ root: abs, real, isFile: st.isFile() });
    } catch {
      skipped.push({ root: abs, reason: "not found" });
    }
  }
  resolved.sort((a, b) => a.real.length - b.real.length);
  const distinct: typeof resolved = [];
  for (const r of resolved) {
    if (distinct.some((d) => !d.isFile && isWithin(d.real, r.real))) continue; // covered by an outer root
    distinct.push(r);
  }

  // ---- apply queue ------------------------------------------------------------
  const pending = new Map<string, Queued>();
  let draining: Promise<void> | null = null;

  const applyRoot = async (ctx: RootCtx, items: readonly Queued[]): Promise<void> => {
    const gone = items.filter((i) => i.kind === "removed").map((i) => i.abs);
    const live: string[] = [];
    for (const i of items) {
      if (i.kind !== "changed") continue;
      const real = realOrNull(i.abs);
      if (real === null) {
        gone.push(i.abs); // vanished since the scan
      } else if (!isWithin(ctx.real, real)) {
        fail("refused a path that resolves outside its root", new Error(path.basename(i.abs)));
      } else {
        live.push(i.abs);
      }
    }
    // Deletions first: they cost no embedding, so they are never worth redoing.
    if (gone.length > 0) {
      const keys = [...new Set(gone.map((abs) => sourcePathFor(ctx.baseDir, abs)))];
      try {
        await options.knowledge.removeSourcePaths(options.projectId, keys);
        removed += keys.length;
        await record({ baseDir: ctx.baseDir, changed: [], removedSourcePaths: keys });
      } catch (err) {
        fail("remove failed", err);
      }
    }
    for (let i = 0; i < live.length; i += WATCH_APPLY_FILES) {
      const slice = live.slice(i, i + WATCH_APPLY_FILES);
      if (closed) return;
      try {
        const seen: { abs: string; mtimeMs: number; size: number }[] = [];
        for (const abs of slice) {
          const st = await stat(abs).catch(() => null);
          if (st !== null) seen.push({ abs, mtimeMs: st.mtimeMs, size: st.size });
        }
        await options.knowledge.reindexFiles(ctx.baseDir, options.projectId, slice);
        reindexed += slice.length;
        await record({ baseDir: ctx.baseDir, changed: seen, removedSourcePaths: [] });
      } catch (err) {
        fail("reindex failed", err); // manifest not advanced, so the next sync redoes it
      }
    }
  };

  const record = async (change: AppliedChange): Promise<void> => {
    try {
      await options.onApplied?.(change);
    } catch (err) {
      fail("checkpoint record failed", err);
    }
  };

  const drain = async (): Promise<void> => {
    while (!closed && pending.size > 0) {
      const taken = [...pending.values()];
      pending.clear();
      const byRoot = new Map<RootCtx, Queued[]>();
      for (const q of taken) byRoot.set(q.ctx, [...(byRoot.get(q.ctx) ?? []), q]);
      for (const [ctx, items] of byRoot) {
        if (closed) return;
        try {
          await applyRoot(ctx, items);
        } catch (err) {
          fail("apply failed", err);
        }
      }
    }
  };

  const kick = (): void => {
    if (draining !== null || closed) return;
    draining = drain()
      .catch((err) => fail("drain failed", err))
      .finally(() => {
        draining = null;
        if (pending.size > 0) kick();
      });
  };

  const enqueue = (ctx: RootCtx, batch: FileChangeBatch): void => {
    if (closed) return;
    batches += 1;
    // Keyed by path: a later state wins, so rename-over-existing (removed then
    // created) and a delete-recreate storm settle on the final state.
    for (const abs of batch.removed) pending.set(abs, { ctx, abs, kind: "removed" });
    for (const abs of batch.changed) pending.set(abs, { ctx, abs, kind: "changed" });
    kick();
  };

  // ---- start watchers ------------------------------------------------------------
  for (const r of distinct) {
    try {
      const baseDir = projectBaseDir(options.projectId, r.root, r.isFile);
      const ctx: RootCtx = { real: r.real, baseDir };
      const watcher = await watch(r.root, (batch) => enqueue(ctx, batch), {
        maxFiles,
        ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : { pollMs: WATCH_POLL_MS }),
        ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
        onError: (err) => fail(`watcher for ${path.basename(r.root)}`, err),
      });
      watchers.push(watcher);
      watched.push(r.real);
    } catch (err) {
      skipped.push({ root: r.root, reason: err instanceof Error ? err.message : String(err) });
      fail(`not watching ${path.basename(r.root)}`, err);
    }
  }

  return {
    get stats(): IndexWatchStats {
      return {
        watched: [...watched],
        skipped: [...skipped],
        batches,
        reindexed,
        removed,
        errors,
      };
    },
    async idle(): Promise<void> {
      while (!closed && (draining !== null || pending.size > 0)) {
        if (draining === null) kick();
        await draining;
      }
    },
    async close(): Promise<void> {
      closed = true;
      pending.clear();
      for (const w of watchers) {
        try {
          w.close();
        } catch (err) {
          fail("close failed", err);
        }
      }
      watchers.length = 0;
      if (draining !== null) await draining;
    },
  };
}
