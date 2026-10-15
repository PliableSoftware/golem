/**
 * WS-C T6 — cross-platform file watcher driving incremental KB freshness.
 *
 * POLLING backend on every OS: scan the tree ({@link scanFiles} — SKIP_DIRS-
 * pruned, chunkable files only) on an interval and diff mtime/size against the
 * previous snapshot. It deliberately does NOT use `node:fs.watch`.
 *
 * Why not fs.watch: libuv's Windows/macOS fs-event layer aborts the PROCESS —
 * uncatchable, no `error` event — via `uv__relative_path`'s
 * `assert(!_wcsnicmp(filename, dir, dirlen))` (src\win\fs-event.c) whenever
 * `GetLongPathNameW` of a changed file's full path doesn't prefix-match the
 * watched directory it stored at start. That path is taken for EVERY directory
 * watch, recursive or not (the recursive flag only sets `ReadDirectoryChangesW`'s
 * subtree bit), so neither `{recursive:true}` nor a per-directory non-recursive
 * watch avoids it, and canonicalizing the watched path doesn't either (Node's
 * `realpath` ≠ Windows `GetLongPathNameW` semantics). It fires on some
 * environments' path shapes (GitHub runner temp junction/8.3) and could crash a
 * real Windows user; it reliably reddened CI (verification-notes §68).
 *
 * Polling can't crash, needs no per-platform branch, and — being the same code
 * on every OS — means Linux CI actually exercises what Windows/macOS run. Cost:
 * change latency up to `pollMs` and a periodic stat-scan (bounded by SKIP_DIRS);
 * fine for opt-in KB freshness. Detected changes feed a debounce + re-stat
 * batching layer, so a burst of writes (or a `git checkout`) collapses into one
 * batch and a half-written file gets a moment to settle before it's classified.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { isChunkableExtension } from "./chunker.js";
import { MAX_FILE_BYTES, SKIP_DIRS, scanTree, WalkLimitError } from "./ingest.js";

/** One debounced round of changes, classified by whether the path still exists. */
export interface FileChangeBatch {
  /** Absolute paths of chunkable files that exist and changed (created or modified). */
  readonly changed: readonly string[];
  /** Absolute paths that no longer exist (deleted, or renamed away). */
  readonly removed: readonly string[];
}

export interface FileWatcherOptions {
  /** Debounce window in ms — events within this window collapse into one batch. Default 500. */
  readonly debounceMs?: number;
  /** Poll interval in ms — how often the tree is re-scanned for changes. Default 1000. */
  readonly pollMs?: number;
  /**
   * Most chunkable files this watcher will track (unset = no cap). A baseline over the
   * cap rejects with {@link WatchCapExceededError}; a tree that GROWS past it later
   * pauses reporting (the scan result is dropped, `onError` fires once per excursion)
   * until it shrinks back, so a runaway directory cannot turn a poll into unbounded work.
   */
  readonly maxFiles?: number;
  /**
   * Called for a failure the watcher swallowed (a throwing `onBatch`, a failed scan
   * that is not a transient miss). It never throws into the host: this is
   * observability, and a throw from it is itself swallowed.
   */
  readonly onError?: (err: unknown) => void;
}

/** The tree under a watched root holds more chunkable files than `maxFiles` allows. */
export class WatchCapExceededError extends Error {
  constructor(
    readonly root: string,
    readonly files: number,
    readonly maxFiles: number,
  ) {
    super(`${files} files under ${root} exceed the watch cap of ${maxFiles}`);
    this.name = "WatchCapExceededError";
  }
}

export interface FileWatcher {
  /** Stop watching and release every underlying resource. */
  close(): void;
  /**
   * How many poll cycles have COMPLETED — incremented after a scan resolves and
   * any resulting events have armed the debounce, so observing it advance means
   * the cycle's real fs work is genuinely finished.
   *
   * Observability for tests, and it earns its place. A test driving this watcher
   * on fake timers has to know when a poll's REAL fs I/O has landed before it
   * advances the clock again, and draining a fixed number of `setImmediate`
   * turns only approximates that: macrotask turns do not wait on the libuv
   * threadpool. The approximation fails under load, and it fails badly — `loop`
   * arms the next poll timer only after the previous poll resolves, so one
   * missed cycle stalls the chain entirely and nothing ever flushes. That was a
   * real CI flake (`file-watcher-settle-is-a-guess`). A counter turns the wait
   * into a condition.
   *
   * Nothing about polling, debouncing or batching depends on this value.
   */
  readonly cycles: number;
  /** Failures swallowed so far (see {@link FileWatcherOptions.onError}). */
  readonly errors: number;
}

function isIgnoredSegment(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/** True if any directory segment between `root` and `absPath` (excluding the leaf) is skipped. */
function isIgnoredPath(root: string, absPath: string): boolean {
  const rel = path.relative(root, absPath);
  const segments = rel.split(path.sep);
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (seg !== undefined && isIgnoredSegment(seg)) return true;
  }
  return false;
}

/** Snapshot of the watched tree: absolute path → `mtimeMs:size` change signal. */
/** Regular files (chunkable or not) the walk may see per scan, as a multiple of `maxFiles`. */
export const WALK_LIMIT_FACTOR = 10;

async function snapshot(root: string, maxFiles: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const limit = Number.isFinite(maxFiles) ? maxFiles * WALK_LIMIT_FACTOR : undefined;
  try {
    for (const f of (await scanTree(root, undefined, limit)).files) {
      map.set(f.abs, `${f.mtimeMs}:${f.size}`);
    }
  } catch (err) {
    if (err instanceof WalkLimitError)
      throw new WatchCapExceededError(root, err.walked, limit ?? 0);
    throw err;
  }
  return map;
}

/**
 * Watch `root` (a file or a directory) for changes, debounced and re-stat'd
 * into one {@link FileChangeBatch} per quiet period. There is no per-event
 * callback by design — a burst of saves (or a `git checkout`) collapses into
 * one batch instead of one reindex per file.
 */
export async function watchPath(
  root: string,
  onBatch: (batch: FileChangeBatch) => void,
  options: FileWatcherOptions = {},
): Promise<FileWatcher> {
  const debounceMs = options.debounceMs ?? 500;
  const pollMs = options.pollMs ?? 1000;
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
  const pending = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let errors = 0;
  const swallow = (err: unknown): void => {
    errors += 1;
    try {
      options.onError?.(err);
    } catch {
      // observability must never throw into the host
    }
  };

  const flush = async (): Promise<void> => {
    debounceTimer = null;
    if (stopped || pending.size === 0) return;
    const paths = [...pending];
    pending.clear();
    const changed: string[] = [];
    const removed: string[] = [];
    for (const p of paths) {
      if (isIgnoredPath(root, p) || !isChunkableExtension(path.extname(p))) continue;
      try {
        const st = await stat(p);
        if (st.isFile() && st.size <= MAX_FILE_BYTES) changed.push(p);
      } catch {
        removed.push(p);
      }
    }
    if (stopped) return;
    if (changed.length > 0 || removed.length > 0) {
      try {
        onBatch({ changed, removed });
      } catch (err) {
        swallow(err); // a sync throw from the consumer must not become an unhandled rejection
      }
    }
  };

  const onEvent = (absPath: string): void => {
    if (stopped) return;
    pending.add(absPath);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void flush().catch(swallow), debounceMs);
    debounceTimer.unref?.(); // a pending flush must never keep the host process alive
  };

  // Baseline snapshot: only changes AFTER watch start are reported.
  let prev = await snapshot(root, maxFiles);
  if (prev.size > maxFiles) throw new WatchCapExceededError(root, prev.size, maxFiles);
  let overCap = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const poll = async (): Promise<void> => {
    let cur: Map<string, string>;
    try {
      cur = await snapshot(root, maxFiles);
    } catch (err) {
      if (err instanceof WatchCapExceededError) {
        if (!overCap) swallow(err);
        overCap = true;
        return; // paused until the tree is walkable again
      }
      return; // root briefly unreadable (mid-rename, etc.) — try again next tick
    }
    if (cur.size > maxFiles) {
      if (!overCap) swallow(new WatchCapExceededError(root, cur.size, maxFiles));
      overCap = true;
      return; // paused: keep the last in-cap snapshot, report nothing until it shrinks
    }
    overCap = false;
    for (const [abs, sig] of cur) {
      if (prev.get(abs) !== sig) onEvent(abs); // created or modified
    }
    for (const abs of prev.keys()) {
      if (!cur.has(abs)) onEvent(abs); // deleted (or renamed away)
    }
    prev = cur;
  };

  // Self-scheduling (not setInterval) so a slow scan on a big tree never overlaps.
  let cycles = 0;
  const loop = async (): Promise<void> => {
    if (stopped) return;
    try {
      await poll();
    } catch (err) {
      swallow(err); // never let one bad cycle end the loop or reject unhandled
    }
    // Counted AFTER the scan resolves and its events have armed the debounce, so
    // a reader that sees this advance knows the cycle's fs work is done. Counted
    // before the next timer is armed only because a stopped watcher must not
    // appear to still be cycling.
    cycles += 1;
    if (!stopped) {
      pollTimer = setTimeout(() => void loop(), pollMs);
      pollTimer.unref?.(); // the poll loop is background upkeep, not a reason to stay alive
    }
  };
  pollTimer = setTimeout(() => void loop(), pollMs);
  pollTimer.unref?.();

  return {
    get cycles(): number {
      return cycles;
    },
    get errors(): number {
      return errors;
    },
    close(): void {
      stopped = true;
      pending.clear();
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      pollTimer = null;
      debounceTimer = null;
    },
  };
}
