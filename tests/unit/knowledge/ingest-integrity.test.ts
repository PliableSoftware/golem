/**
 * DUST3.7 D3/D5 — incremental re-index drops vectors of files that stop yielding
 * chunks, and a sub-path ingest names files project-relative (no duplicates).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type EmbedFn,
  GolemKnowledgeBase,
  InMemoryVectorDriver,
} from "../../../src/knowledge/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const embed: EmbedFn = (texts) => Promise.resolve(texts.map(() => [1, 0, 0]));

let dir: string;
const newTempDir = useTempDirs("golem-ingest-int-");

beforeEach(async () => {
  dir = await newTempDir();
});

async function sourcePaths(kb: GolemKnowledgeBase, projectId: string): Promise<string[]> {
  const hits = await kb.search("x", projectId, 50, new Set(["knowledge"]));
  return [...new Set(hits.map((h) => h.chunk.sourcePath ?? ""))].sort();
}

describe("reindexFiles (D3)", () => {
  it("drops the old vectors of a file that now yields no chunks", async () => {
    const f = path.join(dir, "a.md");
    await writeFile(f, "# A\n\nsome content here\n");
    const kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed });
    await kb.ingest(dir, dir);
    expect(await sourcePaths(kb, dir)).toEqual(["a.md"]);
    await writeFile(f, "");
    await kb.reindexFiles(dir, dir, [f]);
    expect(await sourcePaths(kb, dir)).toEqual([]);
  });
});

describe("sub-path ingest (D5)", () => {
  it("uses project-relative source paths so a later full ingest does not duplicate", async () => {
    await mkdir(path.join(dir, "docs"));
    await writeFile(path.join(dir, "docs", "guide.md"), "# Guide\n\nhello world\n");
    const kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed });
    await kb.ingest(path.join(dir, "docs"), dir);
    expect(await sourcePaths(kb, dir)).toEqual(["docs/guide.md"]);
    await kb.reindexFiles(dir, dir, [path.join(dir, "docs", "guide.md")]);
    expect(await sourcePaths(kb, dir)).toEqual(["docs/guide.md"]);
  });
});
