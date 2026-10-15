/**
 * DUST2.14 — a killed index BUILD resumes without duplicating or losing chunks,
 * and an untrustworthy manifest is discarded rather than believed. The "kill" is a
 * KB whose reindexFiles throws at a chosen batch (the session ending mid-embed),
 * backed by an in-memory store keyed by source path like the real driver's.
 */

import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createManifestRecorder,
  type EnsureIndexedOptions,
  ensureProjectIndexed,
  INDEX_CHECKPOINT_FILES,
  MANIFEST_VERSION,
  writeManifest,
} from "../../../src/cli/auto-index.js";
import type { Chunk, IngestReport, KnowledgeBase } from "../../../src/interfaces/knowledge.js";
import { collectionDir, knowledgeDir, sourcePathFor } from "../../../src/knowledge/index.js";
import type { IncrementalIngest } from "../../../src/knowledge/knowledge-base.js";
import { useTempDirs } from "../../helpers/tmp.js";

let projectDir: string;
const newTempDir = useTempDirs("golem-resume-");

beforeEach(async () => {
  projectDir = await newTempDir();
});

/** In-memory store: sourcePath → number of chunk copies (a dup would make this 2). */
class StoreKB implements KnowledgeBase, IncrementalIngest {
  readonly incrementalReady = true;
  readonly store = new Map<string, number>();
  batches = 0;
  fullIngests = 0;
  constructor(readonly dieOnBatch = Number.POSITIVE_INFINITY) {}
  async ingest(p: string, projectId: string): Promise<IngestReport> {
    this.fullIngests += 1;
    return { path: p, projectId, filesSeen: 0, chunksIndexed: 0, filesSkipped: 0, watching: false };
  }
  async search(): Promise<never[]> {
    return [];
  }
  async getChunk(): Promise<Chunk> {
    throw new Error("unused");
  }
  async reindexFiles(baseDir: string, _p: string, files: readonly string[]): Promise<number> {
    this.batches += 1;
    if (this.batches >= this.dieOnBatch) throw new Error("killed mid-ingest");
    for (const f of files) this.store.set(sourcePathFor(baseDir, f), 1); // replace, not append
    return files.length;
  }
  async removeSourcePaths(_p: string, sps: readonly string[]): Promise<number> {
    for (const sp of sps) this.store.delete(sp);
    return sps.length;
  }
  async ingestText(): Promise<number> {
    return 0;
  }
}

const opts = (
  kb: KnowledgeBase,
  extra: Partial<EnsureIndexedOptions> = {},
): EnsureIndexedOptions => ({
  projectDir,
  projectId: projectDir,
  knowledge: kb,
  watchPaths: [],
  now: "2026-10-15T00:00:00Z",
  embedMode: "lexical",
  tier: 2,
  ...extra,
});

async function writeFiles(count: number, body = "one"): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const p = path.join(projectDir, `f${String(i).padStart(3, "0")}.txt`);
    await writeFile(p, `${body} ${i}`, "utf8");
    await utimes(p, new Date(2000), new Date(2000));
  }
}

const manifestPath = (): string =>
  path.join(collectionDir(knowledgeDir(projectDir), projectDir), "manifest.json");
const readManifestJson = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(manifestPath(), "utf8"));

describe("a killed first build resumes", () => {
  it("keeps the finished batches; the rerun embeds only the rest, once each", async () => {
    const total = INDEX_CHECKPOINT_FILES * 2 + 5;
    await writeFiles(total);

    const dying = new StoreKB(2); // batch 1 lands and is checkpointed, batch 2 is killed
    await expect(ensureProjectIndexed(opts(dying))).rejects.toThrow("killed mid-ingest");
    expect(dying.store.size).toBe(INDEX_CHECKPOINT_FILES);
    const mid = (await readManifestJson()).files as Record<string, unknown>;
    expect(Object.keys(mid)).toHaveLength(INDEX_CHECKPOINT_FILES);

    const resumed = new StoreKB();
    // Seed the survivor's chunks, as the on-disk store would still hold them.
    for (const k of dying.store.keys()) resumed.store.set(k, 1);
    const r = await ensureProjectIndexed(opts(resumed));

    expect(r.action).toBe("synced"); // a manifest exists now, so this is a continuation
    expect(r.updated).toBe(total - INDEX_CHECKPOINT_FILES);
    expect(resumed.store.size).toBe(total); // nothing lost
    expect([...resumed.store.values()].every((n) => n === 1)).toBe(true); // nothing doubled
    expect(resumed.fullIngests).toBe(0);
  });

  it("a first build reports indexed and is not deferred by the auto-index cap", async () => {
    await writeFiles(INDEX_CHECKPOINT_FILES + 3);
    const kb = new StoreKB();
    const r = await ensureProjectIndexed(opts(kb, { maxAutoFiles: 2 }));
    expect(r.action).toBe("indexed");
    expect(r.files).toBe(INDEX_CHECKPOINT_FILES + 3);
    expect(kb.store.size).toBe(INDEX_CHECKPOINT_FILES + 3);
  });

  it("an empty project still builds and records its manifest", async () => {
    const r = await ensureProjectIndexed(opts(new StoreKB()));
    expect(r).toMatchObject({ action: "indexed", chunks: 0, files: 0 });
    expect((await readManifestJson()).version).toBe(MANIFEST_VERSION);
  });
});

describe("an untrustworthy manifest is discarded, never believed", () => {
  const cases: [string, string][] = [
    ["truncated JSON (a crash mid-write)", '{"signature":"lexical:hash-v1-512","files":{"a.tx'],
    ["a wrong shape", JSON.stringify({ signature: 7, files: [] })],
    [
      "a newer format",
      JSON.stringify({ version: 99, signature: "lexical:hash-v1-512", files: {} }),
    ],
    [
      "files that are not states",
      JSON.stringify({ signature: "lexical:hash-v1-512", files: { "a.txt": 3 } }),
    ],
  ];
  for (const [name, body] of cases) {
    it(`rebuilds from the files after ${name}, with a warning`, async () => {
      await writeFiles(3);
      await mkdir(path.dirname(manifestPath()), { recursive: true });
      await writeFile(manifestPath(), body, "utf8");
      const logs: string[] = [];
      const kb = new StoreKB();
      const r = await ensureProjectIndexed(opts(kb, { log: (m) => logs.push(m) }));

      expect(logs.some((l) => l.includes("manifest discarded"))).toBe(true);
      expect(r.action).toBe("indexed");
      expect(kb.store.size).toBe(3); // every file re-embedded, none trusted as done
      expect((await readManifestJson()).version).toBe(MANIFEST_VERSION);
    });
  }

  it("still trusts a legacy manifest with no version field, silently", async () => {
    await writeFiles(2);
    await ensureProjectIndexed(opts(new StoreKB()));
    const legacy = await readManifestJson();
    delete legacy.version;
    await writeFile(manifestPath(), JSON.stringify(legacy), "utf8");
    const logs: string[] = [];
    const r = await ensureProjectIndexed(opts(new StoreKB(), { log: (m) => logs.push(m) }));
    expect(r.action).toBe("skipped");
    expect(logs).toEqual([]);
  });
});

describe("manifest writes are atomic", () => {
  it("leaves one versioned manifest and no temp siblings", async () => {
    await writeManifest(projectDir, projectDir, "lexical:hash-v1-512", [projectDir], "t", {
      "a.txt": { m: 1, s: 1 },
    });
    const names = await readdir(path.dirname(manifestPath()));
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect((await readManifestJson()).version).toBe(MANIFEST_VERSION);
  });
});

describe("createManifestRecorder", () => {
  const sig = "lexical:hash-v1-512";

  it("folds watcher-applied files in, and never creates a manifest", async () => {
    const record = createManifestRecorder(projectDir, projectDir, [projectDir]);
    const abs = path.join(projectDir, "a.txt");
    await record({
      baseDir: projectDir,
      changed: [{ abs, mtimeMs: 5, size: 9 }],
      removedSourcePaths: [],
    });
    await expect(readFile(manifestPath(), "utf8")).rejects.toThrow(); // still no manifest

    await writeManifest(projectDir, projectDir, sig, [projectDir], "t", {
      "old.txt": { m: 1, s: 1 },
      "gone.txt": { m: 1, s: 1 },
    });
    await record({
      baseDir: projectDir,
      changed: [{ abs, mtimeMs: 5, size: 9 }],
      removedSourcePaths: ["gone.txt"],
    });
    expect((await readManifestJson()).files).toEqual({
      "old.txt": { m: 1, s: 1 },
      "a.txt": { m: 5, s: 9 },
    });
  });

  it("does not record files outside the sync roots (an extra wiki dir would read as deleted)", async () => {
    await writeManifest(projectDir, projectDir, sig, [projectDir], "t", {});
    const elsewhere = await newTempDir();
    const record = createManifestRecorder(projectDir, projectDir, [projectDir]);
    await record({
      baseDir: projectDir,
      changed: [{ abs: path.join(elsewhere, "w.md"), mtimeMs: 1, size: 1 }],
      removedSourcePaths: [],
    });
    expect((await readManifestJson()).files).toEqual({});
  });

  it("leaves a corrupt manifest alone", async () => {
    await mkdir(path.dirname(manifestPath()), { recursive: true });
    await writeFile(manifestPath(), "{nope", "utf8");
    const record = createManifestRecorder(projectDir, projectDir, [projectDir]);
    await record({
      baseDir: projectDir,
      changed: [{ abs: path.join(projectDir, "a.txt"), mtimeMs: 1, size: 1 }],
      removedSourcePaths: [],
    });
    expect(await readFile(manifestPath(), "utf8")).toBe("{nope");
  });
});
