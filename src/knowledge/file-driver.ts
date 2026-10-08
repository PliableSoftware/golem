/**
 * WS-C — durable, pure-TS vector driver (the default persisted store).
 *
 * §26 evaluated LanceDB and sqlite-vec and correctly ruled that BOTH are native
 * binaries, so either can only ship as an OPTIONAL add-on — which would leave the
 * default `npx @pliable/golem` install with no persistence at all. This driver fills
 * that gap: it persists each project's `{chunk, vector}` records to disk as JSONL
 * and does the same brute-force cosine search as {@link InMemoryVectorDriver} on
 * an in-memory copy loaded at open. No native dependency (CLAUDE.md hard rule),
 * cross-platform (node:fs/path only).
 *
 * Scale note: brute-force cosine over a few thousand chunks is sub-millisecond;
 * LanceDB's ANN index only pays off at ~100k+ vectors, so it stays the documented
 * OPTIONAL scale upgrade behind this same `VectorDriver` seam (§26) — nothing
 * above the seam changes if a user opts into it.
 *
 * Durability: upserts rewrite the collection file atomically (tmp + rename), and
 * a `meta.json` carries {@link KNOWLEDGE_SCHEMA_VERSION} + the embedding
 * dimension. A schema/version mismatch on open is treated as empty (re-index)
 * rather than an error, and corrupt JSONL lines are skipped — the KB degrades,
 * never crashes.
 */

import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { Chunk } from "../interfaces/knowledge.js";
import { resolveWorktreeRoot } from "../shared/git-worktree.js";
import {
  assertEmbedderSpaceMatch,
  cosineSimilarity,
  type DeletableVectorDriver,
  KNOWLEDGE_SCHEMA_VERSION,
  type StoredChunk,
  type VectorMatch,
} from "./driver.js";

/**
 * Canonicalize a project id before it is hashed into a collection identity.
 *
 * A project id is usually an absolute path, and on Windows the SAME project can
 * arrive spelled several ways — `d:\repo` from one launcher and `D:\repo` from
 * another (Windows treats drive letters case-insensitively), `d:/repo` from
 * anything that hands Node a POSIX-style path, `D:\repo\` from anything that
 * appends a separator. Each spelling hashes differently, spawning DUPLICATE
 * per-project collections that each re-embed the tree independently — this
 * repo had three, 231 MB, two of them unreachable.
 *
 * Task ccr-ref-scope (2026-08-22) added a second collapse ahead of the
 * spelling one: a git LINKED WORKTREE is resolved to its main checkout's root
 * via {@link resolveWorktreeRoot} FIRST, because a worktree is the SAME
 * project as its main checkout — the identical decision made for the CCR
 * store (`src/compression/`), through the same shared function, so the two
 * can't independently drift into disagreeing about one project's identity.
 *
 * Then, for a Windows path (the only shape where these are the same location)
 * the drive letter is uppercased, `/` is folded to `\`, and trailing
 * separators are dropped (never past the root, so `D:\` survives). POSIX
 * paths and bare ids are left ALONE: `\` is a legal filename character there,
 * and folding it would merge two genuinely different directories.
 */
export function canonicalProjectId(projectId: string): string {
  const resolved = resolveWorktreeRoot(projectId);
  if (!/^[A-Za-z]:/.test(resolved)) return resolved;
  const drive = `${resolved[0]?.toUpperCase() ?? ""}${resolved.slice(1)}`;
  const separators = drive.replace(/\//g, "\\");
  // `D:\` (3) and drive-relative `D:` (2) are already minimal.
  if (separators.length <= 3) return separators;
  const trimmed = separators.replace(/\\+$/, "");
  // Trailing separators are noise on a path, but the root's IS the path — never
  // let `D:\\` collapse to the drive-relative `D:`, which means somewhere else.
  return trimmed.length > 2 ? trimmed : `${trimmed}\\`;
}

/**
 * Filesystem-safe per-project collection directory under `baseDir`. Exported so
 * the auto-index manifest lives alongside a collection's data with ONE hashing
 * impl (projectId is often an absolute path). The id is canonicalized first
 * ({@link canonicalProjectId}) so drive-letter case can't split one project
 * across two collections.
 */
export function collectionDir(baseDir: string, projectId: string): string {
  const hash = createHash("sha256")
    .update(canonicalProjectId(projectId), "utf8")
    .digest("hex")
    .slice(0, 16);
  return path.join(baseDir, hash);
}

/**
 * The embedding width an EXISTING collection stores, read straight off the
 * driver's persisted `meta.json` — without opening the collection or loading a
 * single vector (R10.4).
 *
 * This is the ground truth a query is checked against by
 * {@link assertEmbedderSpaceMatch}, so a caller that must decide "can I query
 * this index with the embedder I have?" reads it here rather than discovering
 * the answer as a thrown error on every request. Every index ever written by
 * this driver has it, which is what makes the check work on indexes built
 * before the embedder was recorded anywhere else.
 *
 * Returns `null` when there is no collection, the metadata is missing/corrupt,
 * its schema version is stale (that data is never served — it is re-indexed),
 * or the collection is empty (`dim` 0 — nothing to mismatch against).
 */
export async function readCollectionDim(
  baseDir: string,
  projectId: string,
): Promise<number | null> {
  try {
    const raw = await readFile(path.join(collectionDir(baseDir, projectId), "meta.json"), "utf8");
    const meta = JSON.parse(raw) as Partial<PersistedMeta>;
    if (meta.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION) return null;
    return typeof meta.dim === "number" && meta.dim > 0 ? meta.dim : null;
  } catch {
    return null;
  }
}

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 60_000;

export interface LockOptions {
  /** A lock whose mtime is older than this is presumed orphaned. Default 30s. */
  readonly staleMs?: number;
  /** Give up acquiring after this long. Default 60s. */
  readonly waitMs?: number;
}

/**
 * Exclusive-create lockfile (`wx`) carrying a unique owner token.
 *
 * - Release removes the file only if it still holds OUR token, so a holder whose
 *   lock was broken never deletes the next owner's.
 * - A heartbeat refreshes the mtime while held, so a long flush is never mistaken
 *   for a crashed holder.
 * - A stale lock is broken by RENAMING it to a unique name (atomic: only one
 *   breaker wins the rename), then retrying the exclusive create. If the renamed
 *   file turns out to be fresh (we raced a new owner), it is put back.
 * - Throws after `waitMs` rather than writing unlocked.
 *
 * Exported for tests only; not part of the knowledge barrel.
 */
export async function acquireLock(
  lockPath: string,
  options: LockOptions = {},
): Promise<() => Promise<void>> {
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
  const token = `${process.pid}.${randomBytes(12).toString("hex")}`;
  for (;;) {
    try {
      await writeFile(lockPath, `${token}\n`, { flag: "wx" });
      const beat = setInterval(
        () => {
          const now = new Date();
          void utimes(lockPath, now, now).catch(() => {});
        },
        Math.max(5, Math.floor(staleMs / 3)),
      );
      beat.unref();
      return async () => {
        clearInterval(beat);
        try {
          if ((await readFile(lockPath, "utf8")).trim() === token)
            await rm(lockPath, { force: true });
        } catch {
          // already gone — nothing of ours to release
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    try {
      const st = await stat(lockPath);
      if (Date.now() - st.mtimeMs > staleMs) {
        const moved = `${lockPath}.stale.${token}`;
        await rename(lockPath, moved);
        const fresh = Date.now() - (await stat(moved)).mtimeMs <= staleMs;
        if (fresh) {
          // Lost a race with a new owner: give the lock back if the slot is free.
          const content = await readFile(moved, "utf8");
          await writeFile(lockPath, content, { flag: "wx" }).catch(() => {});
        }
        await rm(moved, { force: true });
        continue;
      }
    } catch {
      continue; // released/broken between the create and the stat — retry now
    }
    if (Date.now() > deadline) throw new Error(`vector store lock timeout: ${lockPath}`);
    await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 25)));
  }
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

interface Collection {
  readonly dir: string;
  records: Map<string, StoredChunk>;
  /** Embedding dimension seen so far (0 until the first non-empty vector). */
  dim: number;
}

interface PersistedMeta {
  readonly schemaVersion: number;
  readonly dim: number;
  readonly count: number;
}

export class FileVectorDriver implements DeletableVectorDriver {
  readonly schemaVersion = KNOWLEDGE_SCHEMA_VERSION;
  readonly #baseDir: string;
  /** projectId -> loaded collection. */
  readonly #collections = new Map<string, Collection>();
  /** chunkId -> projectId, for global getChunk over loaded collections. */
  readonly #chunkIndex = new Map<string, string>();
  /** collection dir -> tail of the in-process mutation queue. */
  readonly #queues = new Map<string, Promise<void>>();

  readonly #lock: LockOptions;

  constructor(baseDir: string, lock: LockOptions = {}) {
    this.#baseDir = baseDir;
    this.#lock = lock;
  }

  #dirFor(projectId: string): string {
    return collectionDir(this.#baseDir, projectId);
  }

  async openCollection(projectId: string): Promise<void> {
    if (this.#collections.has(projectId)) return;
    const dir = this.#dirFor(projectId);
    const col: Collection = { dir, records: new Map(), dim: 0 };
    try {
      this.#adopt(projectId, col, await this.#readDisk(dir));
    } catch {
      // Unreadable right now: serve empty for reads. Mutations re-read strictly
      // and refuse to write rather than overwrite what they could not read.
    }
    this.#collections.set(projectId, col);
  }

  /** Swap a freshly read state into `col` in one assignment and re-point the id index. */
  #adopt(
    projectId: string,
    col: Collection,
    next: { records: Map<string, StoredChunk>; dim: number },
  ): void {
    for (const id of col.records.keys()) this.#chunkIndex.delete(id);
    col.records = next.records;
    col.dim = next.dim;
    for (const id of next.records.keys()) this.#chunkIndex.set(id, projectId);
  }

  /**
   * Read a collection's state from disk. Only a missing file (ENOENT) or a stale
   * schema version means "empty"; any other failure (EBUSY, EPERM, EISDIR, a meta
   * parse error ...) THROWS, so a caller about to rewrite the store never mistakes
   * "could not read" for "nothing there" and wipes it.
   */
  async #readDisk(dir: string): Promise<{ records: Map<string, StoredChunk>; dim: number }> {
    const records = new Map<string, StoredChunk>();
    let metaRaw: string;
    try {
      metaRaw = await readFile(path.join(dir, "meta.json"), "utf8");
    } catch (err) {
      if (isEnoent(err)) return { records, dim: 0 };
      throw err;
    }
    const meta = JSON.parse(metaRaw) as Partial<PersistedMeta>;
    if (meta.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION) return { records, dim: 0 };
    const dim = typeof meta.dim === "number" ? meta.dim : 0;
    let raw: string;
    try {
      raw = await readFile(path.join(dir, "chunks.jsonl"), "utf8");
    } catch (err) {
      if (isEnoent(err)) return { records, dim }; // meta without chunks — empty
      throw err;
    }
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const rec = JSON.parse(line) as StoredChunk;
        if (rec.chunk?.chunkId === undefined || !Array.isArray(rec.vector)) continue;
        // A crash between the meta and chunks renames can leave records from a
        // different embedder space than meta.json records; those are unqueryable.
        if (dim > 0 && rec.vector.length > 0 && rec.vector.length !== dim) continue;
        records.set(rec.chunk.chunkId, rec);
      } catch {
        // Skip a corrupt line (e.g. a torn final write); the rest still loads.
      }
    }
    return { records, dim };
  }

  /**
   * Cross-process-safe read-modify-write (DUST3.7 D6). Every session runs its own
   * driver over the same `chunks.jsonl`; a load-once + whole-file rewrite let one
   * process erase another's chunks. So each mutation takes an exclusive-create
   * lockfile, RELOADS from disk, applies `change`, and writes via a uniquely named
   * temp + rename. Returns whatever `change` returns; it reports whether to flush.
   */
  async #mutate<T>(
    projectId: string,
    change: (col: Collection) => { flush: boolean; result: T },
  ): Promise<T> {
    await this.openCollection(projectId);
    const col = this.#collections.get(projectId);
    if (col === undefined) throw new Error("collection missing after open");
    const prev = this.#queues.get(col.dir) ?? Promise.resolve();
    const run = prev.then(async () => {
      await mkdir(col.dir, { recursive: true });
      const release = await acquireLock(path.join(col.dir, "chunks.lock"), this.#lock);
      try {
        // Work on a detached copy of what is on disk NOW; readers keep seeing the
        // old state until the finished copy is swapped in, and a failed read or
        // flush leaves both the files and the in-memory state untouched.
        const work: Collection = { dir: col.dir, ...(await this.#readDisk(col.dir)) };
        const out = change(work);
        if (out.flush) {
          await this.#flush(work);
          this.#adopt(projectId, col, work);
        }
        return out.result;
      } finally {
        await release();
      }
    });
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(col.dir, tail);
    return run;
  }

  async upsert(projectId: string, records: readonly StoredChunk[]): Promise<void> {
    await this.#mutate(projectId, (col) => {
      // Embedder-space change (verification-notes §69 / PRE_R6_BATCH LE5c): if the
      // incoming vectors have a different dimension than the persisted collection,
      // the existing chunks were embedded by a different model and live in an
      // incompatible space — a mixed-dim collection is unqueryable
      // (`assertEmbedderSpaceMatch` rejects every query). `golem index` re-ingests
      // without clearing, so a lexical→semantic reindex (e.g. after `ollama pull
      // bge-m3`) would otherwise strand the old-dim chunks under the new signature.
      // Reset the collection to the new space rather than corrupt it.
      const incomingDim = records.find((r) => r.vector.length > 0)?.vector.length ?? 0;
      if (incomingDim > 0 && col.dim > 0 && incomingDim !== col.dim) {
        col.records.clear();
        col.dim = incomingDim;
      }
      for (const rec of records) {
        col.records.set(rec.chunk.chunkId, rec);
        if (col.dim === 0 && rec.vector.length > 0) col.dim = rec.vector.length;
      }
      return { flush: true, result: undefined };
    });
  }

  async #flush(col: Collection): Promise<void> {
    await mkdir(col.dir, { recursive: true });
    // Atomic replace: stream records to a uniquely named temp file then rename
    // over the live one so a crash mid-write never leaves a half-truncated
    // collection and two writers never share a temp.
    const suffix = `${process.pid}.${randomBytes(6).toString("hex")}`;
    // meta.json FIRST: a crash between the two renames then leaves the new dim
    // with old-dim chunks (dropped on load by the dim check) rather than new-dim
    // chunks under the old dim (which the next upsert would clear as a "change").
    const meta: PersistedMeta = {
      schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      dim: col.dim,
      count: col.records.size,
    };
    const metaTmp = path.join(col.dir, `meta.json.${suffix}.tmp`);
    const tmp = path.join(col.dir, `chunks.jsonl.${suffix}.tmp`);
    const dest = path.join(col.dir, "chunks.jsonl");
    try {
      await writeFile(metaTmp, `${JSON.stringify(meta)}\n`, "utf8");
      await this.#writeRecordsStreamed(tmp, col.records.values());
      await rename(metaTmp, path.join(col.dir, "meta.json"));
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { force: true });
      await rm(metaTmp, { force: true });
      throw err;
    }
  }

  /**
   * Write one JSON line per record via a stream, honoring backpressure. R4.6
   * (r3.7-lancedb-scale-spike): the old `Array.join("\n")` built one string for
   * the entire collection and hard-crashed (`RangeError: Invalid string length`)
   * past ~30k-50k chunks — V8's max string length. Streaming line-by-line keeps
   * memory flat and removes the ceiling. `events.once(stream, "drain")` rejects
   * if the stream errors mid-wait, so an I/O failure surfaces instead of hanging.
   */
  async #writeRecordsStreamed(file: string, records: Iterable<StoredChunk>): Promise<void> {
    const stream = createWriteStream(file, { encoding: "utf8" });
    try {
      for (const rec of records) {
        if (!stream.write(`${JSON.stringify(rec)}\n`)) {
          await once(stream, "drain");
        }
      }
    } catch (err) {
      stream.destroy();
      throw err;
    }
    stream.end();
    await finished(stream);
  }

  async search(
    projectId: string,
    queryVector: readonly number[],
    k: number,
  ): Promise<VectorMatch[]> {
    await this.openCollection(projectId);
    const col = this.#collections.get(projectId);
    if (col === undefined || k <= 0) return [];
    // Loud, not silent: a query embedded in a different space than the index was
    // built in (e.g. semantic vectors against a lexically-built index) would
    // score 0 for every chunk and return ranked garbage. `col.dim` is the
    // persisted build-time dimension (meta.json).
    assertEmbedderSpaceMatch(queryVector.length, col.dim);
    const scored: VectorMatch[] = [];
    for (const rec of col.records.values()) {
      scored.push({ chunkId: rec.chunk.chunkId, score: cosineSimilarity(queryVector, rec.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  async getChunk(chunkId: string): Promise<Chunk | null> {
    const projectId = this.#chunkIndex.get(chunkId);
    if (projectId !== undefined) {
      const hit = this.#collections.get(projectId)?.records.get(chunkId)?.chunk;
      if (hit !== undefined) return hit;
    }
    return this.#openOwnerOf(chunkId);
  }

  /**
   * D7: `getChunk` is global but only loaded collections are indexed, so a fresh
   * process (the `fetch` tool) missed every chunk until something opened its
   * collection. On a miss, find the on-disk collection that holds the id (each
   * record carries its `projectId`), open it, and answer from it.
   */
  async #openOwnerOf(chunkId: string): Promise<Chunk | null> {
    const loaded = new Set([...this.#collections.values()].map((c) => c.dir));
    let dirs: string[];
    try {
      dirs = await readdir(this.#baseDir);
    } catch {
      return null;
    }
    for (const name of dirs) {
      const dir = path.join(this.#baseDir, name);
      if (loaded.has(dir)) continue;
      let raw: string;
      try {
        raw = await readFile(path.join(dir, "chunks.jsonl"), "utf8");
      } catch {
        continue;
      }
      if (!raw.includes(chunkId)) continue;
      for (const line of raw.split("\n")) {
        if (!line.includes(chunkId)) continue;
        try {
          const rec = JSON.parse(line) as StoredChunk;
          if (rec.chunk?.chunkId !== chunkId) continue;
          if (collectionDir(this.#baseDir, rec.chunk.projectId) !== dir) continue;
          await this.openCollection(rec.chunk.projectId);
          return this.#collections.get(rec.chunk.projectId)?.records.get(chunkId)?.chunk ?? null;
        } catch {
          // corrupt line — keep scanning
        }
      }
    }
    return null;
  }

  /** Remove all of one source file's chunks (for incremental re-index). Flushes if any changed. */
  deleteBySourcePath(projectId: string, sourcePath: string): Promise<number> {
    return this.deleteBySourcePaths(projectId, [sourcePath]);
  }

  /**
   * Batch removal with a SINGLE flush — the whole collection file is rewritten
   * once, not once per source path (the incremental sync deletes many files per
   * run, so per-path flushing is O(files × collection size) in write I/O).
   */
  async deleteBySourcePaths(projectId: string, sourcePaths: readonly string[]): Promise<number> {
    if (sourcePaths.length === 0) return 0;
    const targets = new Set(sourcePaths);
    return this.#mutate(projectId, (col) => {
      let removed = 0;
      for (const [id, rec] of col.records) {
        if (rec.chunk.sourcePath !== undefined && targets.has(rec.chunk.sourcePath)) {
          col.records.delete(id);
          this.#chunkIndex.delete(id);
          removed += 1;
        }
      }
      return { flush: removed > 0, result: removed };
    });
  }

  async close(): Promise<void> {
    // Every upsert flushes synchronously to disk, so there is nothing buffered.
  }
}
