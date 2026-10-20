/**
 * Tool-result cache with mtime invalidation (spec §3.4).
 *
 * Caches the result of a file-derived tool call keyed by path. An entry is valid
 * only while the file's `mtimeMs` and `size` match what was recorded at `set`
 * time; a changed, vanished or unreadable file is a miss and the entry is
 * dropped. Size is checked as well as mtime because coarse-grained filesystems
 * can leave mtime unchanged across a quick rewrite.
 *
 * Not wired into the proxy path: the request body carries no file path for a
 * tool result, so there is nothing to key on there. It is the building block for
 * a path-aware caller (see the spec §3.4 note).
 */

import { stat } from "node:fs/promises";

interface Entry {
  readonly value: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export class ToolResultCache {
  readonly #entries = new Map<string, Entry>();

  /** Record `value` for `path` against the file's current mtime and size. */
  async set(path: string, value: string): Promise<boolean> {
    try {
      const s = await stat(path);
      this.#entries.set(path, { value, mtimeMs: s.mtimeMs, size: s.size });
      return true;
    } catch {
      this.#entries.delete(path);
      return false;
    }
  }

  /** The cached value, or `undefined` when absent or the file changed. */
  async get(path: string): Promise<string | undefined> {
    const entry = this.#entries.get(path);
    if (entry === undefined) return undefined;
    try {
      const s = await stat(path);
      if (s.mtimeMs === entry.mtimeMs && s.size === entry.size) return entry.value;
    } catch {
      // Vanished or unreadable: fall through to invalidate.
    }
    this.#entries.delete(path);
    return undefined;
  }

  get size(): number {
    return this.#entries.size;
  }
}
