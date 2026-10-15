/**
 * DUST2.14 review — reindexFiles must be failure-safe: embed BEFORE swapping, and an
 * unreadable file is a failure to retry, never a file with no content.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GolemKnowledgeBase,
  hashingEmbedFn,
  InMemoryVectorDriver,
  PartialReindexError,
} from "../../../src/knowledge/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-failsafe-");
let dir: string;
let kb: GolemKnowledgeBase;
let embedDown = false;

beforeEach(async () => {
  dir = await newTempDir();
  embedDown = false;
  const real = hashingEmbedFn();
  kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), {
    embed: async (texts, kind) => {
      if (embedDown) throw new Error("embedder down");
      return real(texts, kind);
    },
  });
});

const sources = async (q: string): Promise<string[]> =>
  (await kb.search(q, dir, 10)).map((h) => h.chunk.sourcePath ?? "");

describe("reindexFiles failure safety", () => {
  it("a failing embedder keeps the page's OLD chunks (no page vanishes from search)", async () => {
    const f = path.join(dir, "a.md");
    await writeFile(f, "# A\n\nolduniquemarker text\n");
    await kb.reindexFiles(dir, dir, [f]);
    expect(await sources("olduniquemarker")).toContain("a.md");

    await writeFile(f, "# A\n\nbrandnewmarker text\n");
    embedDown = true;
    await expect(kb.reindexFiles(dir, dir, [f])).rejects.toThrow("embedder down");
    embedDown = false;

    expect(await sources("olduniquemarker")).toContain("a.md"); // still searchable
  });

  it("an unreadable file is reported failed and keeps its old chunks; readable ones still land", async () => {
    const bad = path.join(dir, "b.md");
    const good = path.join(dir, "g.md");
    await writeFile(bad, "# B\n\nkeepmearound content\n");
    await kb.reindexFiles(dir, dir, [bad]);

    await rm(bad);
    await mkdir(bad); // a directory where the file was: readFile fails (EISDIR), like an EBUSY/EPERM read
    await writeFile(good, "# G\n\nfreshgoodmarker content\n");
    const err = await kb.reindexFiles(dir, dir, [bad, good]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PartialReindexError);
    expect((err as PartialReindexError).failed).toEqual([bad]);
    expect(await sources("keepmearound")).toContain("b.md"); // old chunks NOT deleted
    expect(await sources("freshgoodmarker")).toContain("g.md"); // the rest was indexed
  });
});
