/**
 * DUST2.14 — the index watch daemon: keeps the vector index fresh for the chosen
 * roots (configured `watch_paths`) and the project wiki while a long-lived process
 * (`golem mcp serve`) is up, so a wiki page write reaches the index without a
 * manual `ingest`.
 *
 * It composes {@link watchPath} (the polling watcher; no native dependency, same
 * code on every OS) with a coalescing apply queue over the incremental-ingest
 * capability. The wiki stays the truth and the index a derived cache: this module
 * only READS files and writes the vector store, never a watched file.
 *
 * Invariants a reviewer should be able to check here:
 *  - ONE LEADER PER PROJECT: only the session holding the per-project lease polls
 *    and embeds. Followers do not poll; they retry the lease on a slow timer, so a
 *    crashed leader is replaced. The lease is the vector store's own lockfile
 *    ({@link acquireLock}: token, heartbeat, stale take-over), not a second protocol;
 *  - the wiki gets its OWN watcher, always: it is bounded and the point of the task,
 *    so it never depends on an outer root (which can exceed the cap, or skip a
 *    dot-dir) covering it;
 *  - bounded: a file cap per watcher, debounce + poll interval, one apply in flight,
 *    pending work keyed by path so an event storm collapses instead of queueing,
 *    failed paths retried with capped exponential backoff and then given up on;
 *  - never throws into the host: every failure is counted, logged, and swallowed;
 *  - never reads outside a watched root: each changed path is re-resolved with
 *    `realpath.native` and dropped unless still inside its root's real path;
 *  - never writes into an index it did not build: before ANY apply the manifest's
 *    embedder signature is compared with ours (`verifyIndex`); a mismatch halts the
 *    daemon (a width change would clear every record);
 *  - never loses a page to a failed edit: reindex embeds before it deletes, an
 *    unreadable file is a failed path (old chunks kept), failures are retried;
 *  - clean shutdown: `close()` stops every watcher and timer, drops queued work,
 *    waits for the apply in flight and releases the lease. Every timer is unref'd.
 */

import { realpathSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { acquireLock, type LockRelease } from "./file-driver.js";
import { type FileChangeBatch, type FileWatcher, watchPath } from "./file-watcher.js";
import { projectBaseDir, sourcePathFor } from "./ingest.js";
import { type IncrementalIngest, PartialReindexError } from "./knowledge-base.js";

/** Default cap on chunkable files per watched root. */
export const WATCH_MAX_FILES = 5000;
/** Default poll interval for the daemon: slower than an ad-hoc watch, the scan covers whole trees. */
export const WATCH_POLL_MS = 2000;
/** Files re-embedded per `reindexFiles` call, so one bad batch costs a few files, not a storm. */
export const WATCH_APPLY_FILES = 20;
/** Retry schedule for a failed path: 2s, 4s, ... capped at 60s, abandoned after this many tries. */
export const RETRY_BASE_MS = 2000;
export const RETRY_MAX_MS = 60_000;
export const RETRY_MAX_TRIES = 8;
/** A lease not refreshed for this long is presumed orphaned (the lock heartbeats at a third of it). */
export const LEASE_STALE_MS = 30_000;
/** How often a follower retries the lease. */
export const FOLLOWER_RETRY_MS = 30_000;

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

/** Answer to "may I write into this index right now?". */
export type IndexVerdict =
  | { readonly kind: "ok" }
  /** Cannot tell right now (manifest unreadable): requeue and try again later. */
  | { readonly kind: "retry"; readonly reason: string }
  /** The index is another build's (different embedder, newer format): stop for good. */
  | { readonly kind: "halt"; readonly reason: string };

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.(); // background upkeep must never keep the host process alive
    return t;
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface IndexWatchDaemonOptions {
  readonly knowledge: IncrementalIngest;
  readonly projectId: string;
  /** Candidate index roots (absolute). Missing, nested and duplicate roots are dropped. */
  readonly roots: readonly string[];
  /** The project wiki dir: ALWAYS watched on its own, wherever it sits relative to `roots`. */
  readonly wikiDir?: string;
  readonly maxFiles?: number;
  readonly pollMs?: number;
  readonly debounceMs?: number;
  readonly log?: (msg: string) => void;
  /** Called after each applied slice; errors are swallowed. */
  readonly onApplied?: (change: AppliedChange) => Promise<void> | void;
  /** Checked before every apply; see {@link IndexVerdict}. Omitted = always ok. */
  readonly verifyIndex?: () => Promise<IndexVerdict>;
  /**
   * Of these files (stat taken before the read), which does the manifest already
   * record as indexed at exactly that stat? Another session did them: skip.
   */
  readonly isCurrent?: (
    baseDir: string,
    files: readonly { readonly abs: string; readonly mtimeMs: number; readonly size: number }[],
  ) => Promise<ReadonlySet<string>>;
  /** Lease lockfile; omit to run unelected (always a leader). */
  readonly leasePath?: string;
  readonly leaseStaleMs?: number;
  readonly followerRetryMs?: number;
  /** Runs when a follower takes over a dead leader's lease, before it starts watching. */
  readonly onTakeover?: () => Promise<void> | void;
  /** Test seams. */
  readonly watch?: typeof watchPath;
  readonly timers?: Timers;
  readonly now?: () => number;
}

export interface IndexWatchStats {
  readonly role: "leader" | "follower" | "halted" | "closed";
  /** Roots actually being watched (real paths). */
  readonly watched: readonly string[];
  /** Roots that were not watched, each with the reason. */
  readonly skipped: readonly { readonly root: string; readonly reason: string }[];
  /** Batches received from the watchers. */
  readonly batches: number;
  /** Files re-indexed / source paths removed so far. */
  readonly reindexed: number;
  readonly removed: number;
  /** Files skipped because the index already holds them at the same stat. */
  readonly alreadyCurrent: number;
  /** Failures swallowed (watcher, apply, recorder, escaped paths). */
  readonly errors: number;
  /** Paths waiting for a retry / abandoned after the last try. */
  readonly retrying: number;
  readonly gaveUp: number;
}

export interface IndexWatchDaemon {
  readonly stats: IndexWatchStats;
  /** Resolves once everything queued so far has been applied (or failed). A condition, not a sleep. */
  idle(): Promise<void>;
  /** Stop watching; drop queued work; wait for the in-flight apply; release the lease. Idempotent, never rejects. */
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

interface ResolvedRoot {
  readonly root: string;
  readonly real: string;
  readonly isFile: boolean;
}

export async function startIndexWatchDaemon(
  options: IndexWatchDaemonOptions,
): Promise<IndexWatchDaemon> {
  const log = options.log ?? (() => {});
  const watch = options.watch ?? watchPath;
  const timers = options.timers ?? realTimers;
  const now = options.now ?? Date.now;
  const maxFiles = options.maxFiles ?? WATCH_MAX_FILES;
  const watchers: FileWatcher[] = [];
  const skipped: { root: string; reason: string }[] = [];
  const watched: string[] = [];
  let role: IndexWatchStats["role"] = "follower";
  let closed = false;
  let batches = 0;
  let reindexed = 0;
  let removed = 0;
  let alreadyCurrent = 0;
  let errors = 0;
  let gaveUp = 0;

  const fail = (what: string, err: unknown): void => {
    errors += 1;
    try {
      log(`watch: ${what}: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      // a throwing logger must not take the daemon down
    }
  };
  const say = (msg: string): void => {
    try {
      log(msg);
    } catch {
      // see fail()
    }
  };

  // ---- resolve roots: exist, real path, distinct, outermost only -------------
  const resolve = async (list: readonly string[]): Promise<ResolvedRoot[]> => {
    const out: ResolvedRoot[] = [];
    for (const root of list) {
      const abs = path.resolve(root);
      try {
        const st = await stat(abs);
        const real = realOrNull(abs);
        if (real === null) throw new Error("cannot resolve real path");
        out.push({ root: abs, real, isFile: st.isFile() });
      } catch {
        skipped.push({ root: abs, reason: "not found" });
      }
    }
    return out;
  };
  const sorted = (await resolve(options.roots)).sort((a, b) => a.real.length - b.real.length);
  const distinct: ResolvedRoot[] = [];
  for (const r of sorted) {
    if (distinct.some((d) => !d.isFile && isWithin(d.real, r.real))) continue; // covered by an outer root
    distinct.push(r);
  }
  const wikiRoots = options.wikiDir === undefined ? [] : await resolve([options.wikiDir]);
  const toWatch: ResolvedRoot[] = [
    ...distinct,
    ...wikiRoots.filter((w) => !distinct.some((d) => d.real === w.real)),
  ];

  // ---- apply queue ------------------------------------------------------------
  const pending = new Map<string, Queued>();
  const retryQ = new Map<string, { item: Queued; tries: number; due: number }>();
  const lastApplied = new Map<string, string>(); // abs -> "mtimeMs:size" this daemon indexed
  let draining: Promise<void> | null = null;
  let retryTimer: unknown = null;
  let lease: LockRelease | null = null;
  let followerTimer: unknown = null;
  let halted = false;

  const record = async (change: AppliedChange): Promise<void> => {
    try {
      await options.onApplied?.(change);
    } catch (err) {
      fail("checkpoint record failed", err);
    }
  };

  // -- retry with capped exponential backoff ------------------------------------
  const armRetry = (): void => {
    if (retryTimer !== null) {
      timers.clear(retryTimer);
      retryTimer = null;
    }
    if (closed || retryQ.size === 0) return;
    let soonest = Number.POSITIVE_INFINITY;
    for (const e of retryQ.values()) soonest = Math.min(soonest, e.due);
    retryTimer = timers.set(fireRetry, Math.max(0, soonest - now()));
  };
  const fireRetry = (): void => {
    retryTimer = null;
    if (closed) return;
    const t = now();
    for (const [abs, e] of [...retryQ]) {
      if (e.due > t) continue;
      retryQ.delete(abs);
      if (!pending.has(abs)) pending.set(abs, { ...e.item, ctx: e.item.ctx });
      retryTries.set(abs, e.tries);
    }
    armRetry();
    kick();
  };
  /** Tries already spent on a path currently back in `pending`. */
  const retryTries = new Map<string, number>();

  const requeue = (item: Queued, why: string): void => {
    const tries = (retryTries.get(item.abs) ?? 0) + 1;
    retryTries.delete(item.abs);
    if (tries >= RETRY_MAX_TRIES) {
      gaveUp += 1;
      fail(`giving up on ${path.basename(item.abs)} after ${tries} tries`, new Error(why));
      return;
    }
    const delay = Math.min(RETRY_BASE_MS * 2 ** (tries - 1), RETRY_MAX_MS);
    retryQ.set(item.abs, { item, tries, due: now() + delay });
    armRetry();
  };

  const applyRoot = async (ctx: RootCtx, items: readonly Queued[]): Promise<void> => {
    const gone: Queued[] = items.filter((i) => i.kind === "removed");
    const live: { item: Queued; mtimeMs: number; size: number }[] = [];
    for (const i of items) {
      if (i.kind !== "changed") continue;
      const real = realOrNull(i.abs);
      if (real === null) {
        gone.push({ ...i, kind: "removed" }); // vanished since the scan
      } else if (!isWithin(ctx.real, real)) {
        fail("refused a path that resolves outside its root", new Error(path.basename(i.abs)));
      } else {
        // Stat BEFORE the read: a recorded stat can then lag the content, never lead it.
        const st = await stat(i.abs).catch(() => null);
        if (st === null) gone.push({ ...i, kind: "removed" });
        else live.push({ item: i, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
    // Deletions first: they cost no embedding, so they are never worth redoing.
    if (gone.length > 0) {
      const keys = [...new Set(gone.map((g) => sourcePathFor(ctx.baseDir, g.abs)))];
      try {
        await options.knowledge.removeSourcePaths(options.projectId, keys);
        removed += keys.length;
        for (const g of gone) lastApplied.delete(g.abs);
        await record({ baseDir: ctx.baseDir, changed: [], removedSourcePaths: keys });
      } catch (err) {
        fail("remove failed", err);
        for (const g of gone) requeue(g, "remove failed");
      }
    }

    // Skip what this daemon already indexed at this stat, and what another session
    // (the manifest) already holds at this stat.
    let todo = live.filter((l) => lastApplied.get(l.item.abs) !== `${l.mtimeMs}:${l.size}`);
    if (options.isCurrent !== undefined && todo.length > 0) {
      try {
        const have = await options.isCurrent(
          ctx.baseDir,
          todo.map((t) => ({ abs: t.item.abs, mtimeMs: t.mtimeMs, size: t.size })),
        );
        const fresh = todo.filter((t) => !have.has(t.item.abs));
        for (const t of todo)
          if (have.has(t.item.abs)) lastApplied.set(t.item.abs, `${t.mtimeMs}:${t.size}`);
        alreadyCurrent += todo.length - fresh.length;
        todo = fresh;
      } catch (err) {
        fail("current-check failed", err); // fall through: re-indexing is the safe direction
      }
    }

    for (let i = 0; i < todo.length; i += WATCH_APPLY_FILES) {
      const slice = todo.slice(i, i + WATCH_APPLY_FILES);
      if (closed) return;
      const done = (s: typeof slice): void => {
        for (const t of s) {
          lastApplied.set(t.item.abs, `${t.mtimeMs}:${t.size}`);
          retryTries.delete(t.item.abs);
        }
      };
      try {
        await options.knowledge.reindexFiles(
          ctx.baseDir,
          options.projectId,
          slice.map((s) => s.item.abs),
        );
        reindexed += slice.length;
        done(slice);
        await record({
          baseDir: ctx.baseDir,
          changed: slice.map((s) => ({ abs: s.item.abs, mtimeMs: s.mtimeMs, size: s.size })),
          removedSourcePaths: [],
        });
      } catch (err) {
        if (err instanceof PartialReindexError) {
          // The readable files ARE indexed; the unreadable ones kept their old chunks
          // and are NOT recorded as current: retry them.
          const bad = new Set(err.failed);
          const ok = slice.filter((s) => !bad.has(s.item.abs));
          reindexed += ok.length;
          done(ok);
          if (ok.length > 0) {
            await record({
              baseDir: ctx.baseDir,
              changed: ok.map((s) => ({ abs: s.item.abs, mtimeMs: s.mtimeMs, size: s.size })),
              removedSourcePaths: [],
            });
          }
          for (const s of slice) if (bad.has(s.item.abs)) requeue(s.item, "file unreadable");
          fail("some files were unreadable", err);
        } else {
          // Embedder down, lock lost...: old chunks are intact (embed-then-swap);
          // the manifest is not advanced; retry with backoff.
          fail("reindex failed", err);
          for (const s of slice) requeue(s.item, "reindex failed");
        }
      }
    }
  };

  const halt = (reason: string): void => {
    if (halted) return;
    halted = true;
    role = "halted";
    say(`watch: stopped: ${reason}`);
    pending.clear();
    retryQ.clear();
    armRetry();
    void stopWatching();
    void releaseLease();
  };

  const stillLeader = async (): Promise<boolean> => {
    if (lease === null) return options.leasePath === undefined; // unelected = always leader
    try {
      await lease.assertHeld();
      return true;
    } catch {
      say("watch: lost the project watch lease; another session leads now");
      void demote();
      return false;
    }
  };

  const drain = async (): Promise<void> => {
    while (!closed && !halted && pending.size > 0) {
      if (!(await stillLeader())) {
        pending.clear();
        return;
      }
      const taken = [...pending.values()];
      pending.clear();
      if (options.verifyIndex !== undefined) {
        let verdict: IndexVerdict;
        try {
          verdict = await options.verifyIndex();
        } catch (err) {
          verdict = { kind: "retry", reason: err instanceof Error ? err.message : String(err) };
        }
        if (verdict.kind === "halt") {
          halt(verdict.reason);
          return;
        }
        if (verdict.kind === "retry") {
          for (const q of taken) requeue(q, verdict.reason);
          return;
        }
      }
      const byRoot = new Map<RootCtx, Queued[]>();
      for (const q of taken) byRoot.set(q.ctx, [...(byRoot.get(q.ctx) ?? []), q]);
      for (const [ctx, items] of byRoot) {
        if (closed || halted) return;
        try {
          await applyRoot(ctx, items);
        } catch (err) {
          fail("apply failed", err);
        }
      }
    }
  };

  const kick = (): void => {
    if (draining !== null || closed || halted) return;
    draining = drain()
      .catch((err) => fail("drain failed", err))
      .finally(() => {
        draining = null;
        if (pending.size > 0) kick();
      });
  };

  const enqueue = (ctx: RootCtx, batch: FileChangeBatch): void => {
    if (closed || halted) return;
    batches += 1;
    // Keyed by path: a later state wins, so rename-over-existing (removed then
    // created) and a delete-recreate storm settle on the final state. A fresh event
    // also supersedes a scheduled retry of the same path.
    for (const abs of batch.removed) {
      retryQ.delete(abs);
      retryTries.delete(abs);
      pending.set(abs, { ctx, abs, kind: "removed" });
    }
    for (const abs of batch.changed) {
      retryQ.delete(abs);
      retryTries.delete(abs);
      pending.set(abs, { ctx, abs, kind: "changed" });
    }
    kick();
  };

  // ---- watchers + leadership ------------------------------------------------------
  const startWatching = async (): Promise<void> => {
    for (const r of toWatch) {
      if (closed || halted) return;
      try {
        const baseDir = projectBaseDir(options.projectId, r.root, r.isFile);
        const ctx: RootCtx = { real: r.real, baseDir };
        const watcher = await watch(r.root, (batch) => enqueue(ctx, batch), {
          maxFiles,
          pollMs: options.pollMs ?? WATCH_POLL_MS,
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
  };

  const stopWatching = async (): Promise<void> => {
    for (const w of watchers) {
      try {
        w.close();
      } catch (err) {
        fail("close failed", err);
      }
    }
    watchers.length = 0;
    watched.length = 0;
  };

  let releasing: Promise<void> = Promise.resolve();
  const releaseLease = (): Promise<void> => {
    const l = lease;
    lease = null;
    if (l === null) return releasing;
    releasing = releasing.then(async () => {
      try {
        await l();
      } catch (err) {
        fail("lease release failed", err);
      }
    });
    return releasing;
  };

  const tryLead = async (): Promise<boolean> => {
    const file = options.leasePath;
    if (file === undefined) return true;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      // waitMs 1: ONE contention verdict, not a wait; a stale lease is taken over by
      // acquireLock's own protocol (token re-check, rename-based replace).
      lease = await acquireLock(file, {
        staleMs: options.leaseStaleMs ?? LEASE_STALE_MS,
        waitMs: 1,
      });
      return true;
    } catch {
      return false; // someone else leads
    }
  };

  const scheduleFollowerRetry = (): void => {
    if (closed || halted || options.leasePath === undefined) return;
    if (followerTimer !== null) timers.clear(followerTimer);
    followerTimer = timers.set(() => {
      followerTimer = null;
      void retryLead();
    }, options.followerRetryMs ?? FOLLOWER_RETRY_MS);
  };

  const retryLead = async (): Promise<void> => {
    if (closed || halted || role === "leader") return;
    try {
      if (await tryLead()) {
        if (closed) {
          await releaseLease();
          return;
        }
        role = "leader";
        say("watch: took over the project watch lease");
        try {
          await options.onTakeover?.(); // catch up on what the dead leader missed
        } catch (err) {
          fail("takeover catch-up failed", err);
        }
        await startWatching();
        return;
      }
    } catch (err) {
      fail("lease retry failed", err);
    }
    scheduleFollowerRetry();
  };

  const demote = async (): Promise<void> => {
    if (role !== "leader") return;
    role = "follower";
    pending.clear();
    retryQ.clear();
    armRetry();
    await stopWatching();
    await releaseLease();
    scheduleFollowerRetry();
  };

  if (await tryLead()) {
    role = "leader";
    await startWatching();
  } else {
    say("watch: another session leads the index watch for this project; standing by");
    scheduleFollowerRetry();
  }

  return {
    get stats(): IndexWatchStats {
      return {
        role: closed ? "closed" : role,
        watched: [...watched],
        skipped: [...skipped],
        batches,
        reindexed,
        removed,
        alreadyCurrent,
        errors,
        retrying: retryQ.size,
        gaveUp,
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
      retryQ.clear();
      if (retryTimer !== null) timers.clear(retryTimer);
      if (followerTimer !== null) timers.clear(followerTimer);
      retryTimer = null;
      followerTimer = null;
      await stopWatching();
      if (draining !== null) await draining;
      await releaseLease();
    },
  };
}
