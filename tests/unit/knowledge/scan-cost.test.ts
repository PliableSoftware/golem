/** DUST2.14 review — one stat per file per scan, and a bounded walk. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDirs } from "../../helpers/tmp.js";

const statCalls: string[] = [];
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: (async (p: string, ...rest: unknown[]) => {
      statCalls.push(String(p));
      return (actual.stat as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof actual.stat,
  };
});

const { scanFiles, scanTree, WalkLimitError } = await import("../../../src/knowledge/ingest.js");
const { watchPath, WatchCapExceededError } = await import("../../../src/knowledge/file-watcher.js");

const newTempDir = useTempDirs("golem-scancost-");
let dir: string;

beforeEach(async () => {
  dir = await newTempDir();
  statCalls.length = 0;
});

describe("scan cost", () => {
  it("stats each chunkable file exactly once", async () => {
    for (let i = 0; i < 20; i += 1) await writeFile(path.join(dir, `f${i}.md`), "# x\n");
    statCalls.length = 0;
    const files = await scanFiles(dir);
    expect(files).toHaveLength(20);
    const perFile = statCalls.filter((p) => p.endsWith(".md"));
    expect(perFile).toHaveLength(20); // was 40: once in the walk, once more in the scan
  });

  it("a walk over the limit stops with WalkLimitError, counting non-chunkable files too", async () => {
    await mkdir(path.join(dir, "data"));
    for (let i = 0; i < 30; i += 1) await writeFile(path.join(dir, "data", `b${i}.bin`), "x");
    await expect(scanTree(dir, undefined, 10)).rejects.toBeInstanceOf(WalkLimitError);
    expect((await scanTree(dir, undefined, 100)).walked).toBe(30);
  });

  it("the watcher refuses a tree whose walk (not just chunkable files) is over the cap", async () => {
    await mkdir(path.join(dir, "data"));
    for (let i = 0; i < 40; i += 1) await writeFile(path.join(dir, "data", `b${i}.bin`), "x");
    await writeFile(path.join(dir, "a.md"), "# a\n");
    // 1 chunkable file, 41 walked; cap 3 -> walk limit 30
    await expect(watchPath(dir, () => {}, { maxFiles: 3 })).rejects.toBeInstanceOf(
      WatchCapExceededError,
    );
  });
});
