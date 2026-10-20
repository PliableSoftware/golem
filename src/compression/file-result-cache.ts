/**
 * Cache of file-derived results with mtime invalidation (spec §3.4).
 *
 * Named for what it keys on, to keep it apart from `StageConfig.toolResultCache`,
 * which is the standalone MCP service's CCR swap and has nothing to do with it.
 *
 * Validity is a {@link FileStamp} taken from the file BEFORE the caller reads it:
 * stamping after the read would bless a result that predates a concurrent write,
 * and the entry would then look fresh forever. {@link FileResultCache.fill} does
 * stamp, read, stamp again, and stores only when both stamps agree.
 *
 * The stamp is nanosecond mtime and ctime, inode and size (bigint stat), so a
 * same-size rewrite within one coarse mtime tick still invalidates through ctime,
 * and a replace-by-rename through the inode.
 *
 * Not wired into the proxy path: the request body carries no file path for a tool
 * result, so there is nothing to key on there.
 */

import { stat } from "node:fs/promises";

export interface FileStamp {
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly ino: bigint;
  readonly size: bigint;
}

export interface FileResultCacheOptions {
  /** Most entries kept; the oldest is evicted first. Default 256. */
  readonly maxEntries?: number;
  /** Longest value (UTF-16 code units) worth caching; longer is refused. Default 1 MiB. */
  readonly maxValueChars?: number;
}

/** Take a stamp of `path`, or `null` when it cannot be statted. */
export async function stampFile(path: string): Promise<FileStamp | null> {
  try {
    const s = await stat(path, { bigint: true });
    return { mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs, ino: s.ino, size: s.size };
  } catch {
    return null;
  }
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino && a.size === b.size;
}

interface Entry {
  readonly value: string;
  readonly stamp: FileStamp;
}

export class FileResultCache {
  readonly #entries = new Map<string, Entry>();
  readonly #maxEntries: number;
  readonly #maxValueChars: number;

  constructor(options: FileResultCacheOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 256;
    this.#maxValueChars = options.maxValueChars ?? 1024 * 1024;
  }

  /**
   * Store `value` against `stamp`, which MUST have been taken before `value` was
   * derived. Refused (false) when the file no longer matches the stamp, the value
   * is over the size cap, or the file is gone.
   */
  async set(path: string, value: string, stamp: FileStamp): Promise<boolean> {
    if (value.length > this.#maxValueChars) return false;
    const now = await stampFile(path);
    if (now === null || !sameStamp(now, stamp)) {
      this.#entries.delete(path);
      return false;
    }
    this.#entries.delete(path); // re-insert so eviction order is by last write
    this.#entries.set(path, { value, stamp });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
    return true;
  }

  /** The cached value, or `undefined` when absent or the file changed. */
  async get(path: string): Promise<string | undefined> {
    const entry = this.#entries.get(path);
    if (entry === undefined) return undefined;
    const now = await stampFile(path);
    if (now !== null && sameStamp(now, entry.stamp)) return entry.value;
    this.#entries.delete(path);
    return undefined;
  }

  /**
   * Cached value, else derive it with `read`, caching only when the file did not
   * change while `read` ran. The derived value is returned either way.
   */
  async fill(path: string, read: () => Promise<string>): Promise<string> {
    const hit = await this.get(path);
    if (hit !== undefined) return hit;
    const before = await stampFile(path);
    const value = await read();
    if (before !== null) await this.set(path, value, before);
    return value;
  }

  get size(): number {
    return this.#entries.size;
  }
}
