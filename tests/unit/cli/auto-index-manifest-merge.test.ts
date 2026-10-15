/** DUST3.7 D4 — indexing a sub-path must not wipe the manifest's file map. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  embedderSignature,
  ensureProjectIndexed,
  mergeManifestFiles,
  recordIndexedTarget,
  writeManifest,
} from "../../../src/cli/auto-index.js";
import { HardwareTier } from "../../../src/interfaces/inference.js";
import type { IngestReport, KnowledgeBase } from "../../../src/interfaces/knowledge.js";
import { collectionDir, knowledgeDir, scanFiles } from "../../../src/knowledge/index.js";
import type { IncrementalIngest } from "../../../src/knowledge/knowledge-base.js";
import { useTempDirs } from "../../helpers/tmp.js";

let dir: string;
const newTempDir = useTempDirs("golem-manifest-");

beforeEach(async () => {
  dir = await newTempDir();
});

describe("mergeManifestFiles", () => {
  it("keeps previously recorded files when a sub-path is indexed", async () => {
    await mkdir(path.join(dir, "docs"));
    await writeFile(path.join(dir, "docs", "g.md"), "# g\n");
    await writeManifest(dir, dir, "lexical", [dir], "t0", { "old.md": { m: 1, s: 2 } });
    const merged = await mergeManifestFiles(
      dir,
      dir,
      "lexical",
      await scanFiles(path.join(dir, "docs"), dir),
    );
    expect(Object.keys(merged.files).sort()).toEqual(["docs/g.md", "old.md"]);
    await writeManifest(dir, dir, "lexical", merged.paths, "t1", merged.files);
    const raw = await readFile(
      path.join(collectionDir(knowledgeDir(dir), dir), "manifest.json"),
      "utf8",
    );
    expect(Object.keys(JSON.parse(raw).files)).toContain("old.md");
  });

  it("drops the old map when the embedder signature changed", async () => {
    await writeManifest(dir, dir, "lexical", [dir], "t0", { "old.md": { m: 1, s: 2 } });
    const merged = await mergeManifestFiles(dir, dir, "other", []);
    expect(merged.files).toEqual({});
  });
});

class KB implements KnowledgeBase, IncrementalIngest {
  readonly incrementalReady = true;
  readonly removed: string[] = [];
  async ingest(p: string, projectId: string): Promise<IngestReport> {
    return { path: p, projectId, filesSeen: 1, chunksIndexed: 1, filesSkipped: 0, watching: false };
  }
  async search(): Promise<never[]> {
    return [];
  }
  async getChunk(): Promise<never> {
    throw new Error("unused");
  }
  async reindexFiles(): Promise<number> {
    return 0;
  }
  async removeSourcePaths(_p: string, sp: readonly string[]): Promise<number> {
    this.removed.push(...sp);
    return sp.length;
  }
  async ingestText(): Promise<number> {
    return 0;
  }
}

describe("recordIndexedTarget outside the project", () => {
  it("leaves the manifest alone so the next sync neither deletes nor overwrites", async () => {
    const project = await newTempDir();
    const outside = await newTempDir();
    await writeFile(path.join(project, "README.md"), "# project readme\n");
    await writeFile(path.join(outside, "README.md"), "# someone else's readme\n");
    await writeFile(path.join(outside, "notes.md"), "# notes\n");
    const kb = new KB();
    const opts = {
      projectDir: project,
      projectId: project,
      knowledge: kb,
      watchPaths: [] as string[],
      now: "t0",
      embedMode: "lexical" as const,
      tier: HardwareTier.PMid,
    };
    await ensureProjectIndexed(opts);
    const manifestPath = path.join(collectionDir(knowledgeDir(project), project), "manifest.json");
    const before = await readFile(manifestPath, "utf8");

    await recordIndexedTarget(
      project,
      project,
      embedderSignature("lexical", HardwareTier.PMid),
      outside,
      "t1",
    );
    expect(await readFile(manifestPath, "utf8")).toBe(before);

    const res = await ensureProjectIndexed({ ...opts, now: "t2" });
    expect(res.action).toBe("skipped");
    expect(kb.removed).toEqual([]);
  });
});
