/**
 * DUST3.7 D6/D7 — two FileVectorDriver instances over one store (the daemon and
 * the WebFetch hook are separate processes) must not erase each other's chunks,
 * and `getChunk` must find a chunk in a collection this instance never opened.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
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
