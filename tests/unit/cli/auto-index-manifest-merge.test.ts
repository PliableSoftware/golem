/** DUST3.7 D4 — indexing a sub-path must not wipe the manifest's file map. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mergeManifestFiles, writeManifest } from "../../../src/cli/auto-index.js";
import { collectionDir, knowledgeDir, scanFiles } from "../../../src/knowledge/index.js";
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
