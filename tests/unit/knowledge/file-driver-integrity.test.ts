/**
 * DUST3.7 D6/D7 — two FileVectorDriver instances over one store (the daemon and
 * the WebFetch hook are separate processes) must not erase each other's chunks,
 * and `getChunk` must find a chunk in a collection this instance never opened.
 */

import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../../../src/knowledge/file-driver.js";
import type { StoredChunk } from "../../../src/knowledge/index.js";
import { collectionDir, FileVectorDriver } from "../../../src/knowledge/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

let base: string;
const newTempDir = useTempDirs("golem-fvd-int-");

beforeEach(async () => {
  base = await newTempDir();
});

function rec(projectId: string, id: string, vector = [1, 0]): StoredChunk {
  return {
    chunk: { chunkId: id, projectId, text: id, sourcePath: `${id}.md`, metadata: {} },
    vector,
  };
}

async function ids(driverBase: string, projectId: string): Promise<string[]> {
  const raw = await readFile(
    path.join(collectionDir(driverBase, projectId), "chunks.jsonl"),
    "utf8",
  );
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => (JSON.parse(l) as StoredChunk).chunk.chunkId)
    .sort();
}

describe("FileVectorDriver cross-instance writes (D6)", () => {
  it("keeps both writers' chunks when two instances loaded the same empty store", async () => {
    const a = new FileVectorDriver(base);
    const b = new FileVectorDriver(base);
    await a.openCollection("p");
    await b.openCollection("p");
    await a.upsert("p", [rec("p", "from-a")]);
    await b.upsert("p", [rec("p", "from-b")]);
    expect(await ids(base, "p")).toEqual(["from-a", "from-b"]);
  });

  it("survives many interleaved concurrent writers", async () => {
    const drivers = Array.from({ length: 6 }, () => new FileVectorDriver(base));
    await Promise.all(drivers.map((d) => d.openCollection("p")));
    await Promise.all(
      drivers.flatMap((d, i) => [
        d.upsert("p", [rec("p", `w${i}-1`)]),
        d.upsert("p", [rec("p", `w${i}-2`)]),
      ]),
    );
    expect(await ids(base, "p")).toHaveLength(12);
  });

  it("a delete by one instance does not resurrect or drop another's chunks", async () => {
    const a = new FileVectorDriver(base);
    const b = new FileVectorDriver(base);
    await a.upsert("p", [rec("p", "keep"), rec("p", "gone")]);
    await b.openCollection("p");
    await a.upsert("p", [rec("p", "late")]);
    expect(await b.deleteBySourcePaths("p", ["gone.md"])).toBe(1);
    expect(await ids(base, "p")).toEqual(["keep", "late"]);
  });
});

describe("FileVectorDriver.getChunk on an unopened collection (D7)", () => {
  it("finds a persisted chunk without openCollection", async () => {
    await new FileVectorDriver(base).upsert("p", [rec("p", "abc")]);
    const fresh = new FileVectorDriver(base);
    expect((await fresh.getChunk("abc"))?.text).toBe("abc");
    expect(await fresh.getChunk("nope")).toBeNull();
  });
});

describe("unreadable store is never treated as empty", () => {
  it("a read error other than ENOENT aborts the mutation and leaves the store intact", async () => {
    const d = new FileVectorDriver(base);
    await d.upsert("p", [rec("p", "precious")]);
    const dir = collectionDir(base, "p");
    const chunksFile = path.join(dir, "chunks.jsonl");
    const original = await readFile(chunksFile, "utf8");
    const metaBefore = await readFile(path.join(dir, "meta.json"), "utf8");
    // EISDIR on read: a non-ENOENT failure, like EBUSY/EPERM on a locked file.
    await rm(chunksFile);
    await mkdir(chunksFile);
    const other = new FileVectorDriver(base);
    await expect(other.upsert("p", [rec("p", "new")])).rejects.toThrow();
    await expect(other.deleteBySourcePaths("p", ["precious.md"])).rejects.toThrow();
    expect((await stat(chunksFile)).isDirectory()).toBe(true);
    expect(await readFile(path.join(dir, "meta.json"), "utf8")).toBe(metaBefore);
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await rm(chunksFile, { recursive: true });
    await writeFile(chunksFile, original);
    expect(await ids(base, "p")).toEqual(["precious"]);
  });
});

describe("lock ownership and heartbeat", () => {
  it("release does not remove a lock another owner now holds", async () => {
    const lockPath = path.join(base, "x.lock");
    const release = await acquireLock(lockPath);
    await writeFile(lockPath, "someone-else\n"); // lock was broken and re-taken
    await release();
    expect((await readFile(lockPath, "utf8")).trim()).toBe("someone-else");
  });

  it("release removes its own lock", async () => {
    const lockPath = path.join(base, "y.lock");
    await (await acquireLock(lockPath))();
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("a holder that outlives the stale threshold keeps its lock (heartbeat)", async () => {
    const lockPath = path.join(base, "z.lock");
    const release = await acquireLock(lockPath, { staleMs: 150 });
    await new Promise((r) => setTimeout(r, 500));
    await expect(acquireLock(lockPath, { staleMs: 150, waitMs: 100 })).rejects.toThrow(/timeout/);
    await release();
  });

  it("a genuinely stale lock (no heartbeat) is taken over", async () => {
    const lockPath = path.join(base, "s.lock");
    await writeFile(lockPath, "dead-process\n");
    await new Promise((r) => setTimeout(r, 120));
    const release = await acquireLock(lockPath, { staleMs: 50, waitMs: 2000 });
    await release();
  });
});

describe("in-memory swap and dim crash window", () => {
  it("a concurrent search never sees an emptied collection during a write", async () => {
    const d = new FileVectorDriver(base);
    await d.upsert(
      "p",
      Array.from({ length: 200 }, (_, i) => rec("p", `c${i}`)),
    );
    let min = Number.POSITIVE_INFINITY;
    let done = false;
    const poll = (async () => {
      while (!done) {
        min = Math.min(min, (await d.search("p", [1, 0], 5)).length);
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let i = 0; i < 15; i += 1) await d.upsert("p", [rec("p", `n${i}`)]);
    done = true;
    await poll;
    expect(min).toBe(5);
  });

  it("chunks of another dimension than meta.json (crash between renames) are dropped, not mixed", async () => {
    const dir = collectionDir(base, "p");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "meta.json"), '{"schemaVersion":1,"dim":3,"count":1}\n');
    await writeFile(path.join(dir, "chunks.jsonl"), `${JSON.stringify(rec("p", "old", [1, 0]))}\n`);
    const d = new FileVectorDriver(base);
    await d.upsert("p", [rec("p", "new", [1, 0, 0])]);
    expect(await ids(base, "p")).toEqual(["new"]);
  });
});

describe("damaged meta.json self-heals", () => {
  async function seed(): Promise<string> {
    await new FileVectorDriver(base).upsert("p", [rec("p", "a", [1, 0]), rec("p", "b", [0, 1])]);
    return path.join(collectionDir(base, "p"), "meta.json");
  }

  for (const [name, content] of [
    ["torn", '{"schemaVersion":1,"di'],
    ["zero-length", ""],
  ] as const) {
    it(`a ${name} meta.json keeps every chunk, is kept aside, and is rewritten`, async () => {
      const metaPath = await seed();
      await writeFile(metaPath, content);
      const d = new FileVectorDriver(base);
      await d.upsert("p", [rec("p", "c", [1, 1])]);
      expect(await ids(base, "p")).toEqual(["a", "b", "c"]);
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as { dim: number; count: number };
      expect(meta).toMatchObject({ dim: 2, count: 3 });
      const aside = (await readdir(path.dirname(metaPath))).filter((f) =>
        f.startsWith("meta.json.corrupt-"),
      );
      expect(aside).toHaveLength(1);
      expect(await readFile(path.join(path.dirname(metaPath), aside[0] ?? ""), "utf8")).toBe(
        content,
      );
    });
  }

  it("still refuses to write when chunks.jsonl is unreadable, even with bad meta", async () => {
    const metaPath = await seed();
    await writeFile(metaPath, "");
    const chunksFile = path.join(path.dirname(metaPath), "chunks.jsonl");
    await rm(chunksFile);
    await mkdir(chunksFile);
    await expect(new FileVectorDriver(base).upsert("p", [rec("p", "z")])).rejects.toThrow();
  });
});

describe("lock acquisition under persistent errors", () => {
  it("times out instead of spinning when breaking a stale lock keeps failing", async () => {
    // A stale lock that is a DIRECTORY: create gives EEXIST, it looks stale, and
    // reading/renaming it as a file keeps failing. The old loop spun forever.
    const lockPath = path.join(base, "d.lock");
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    const t0 = Date.now();
    await expect(acquireLock(lockPath, { staleMs: 50, waitMs: 150 })).rejects.toThrow(/timeout/);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
