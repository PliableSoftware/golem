/**
 * An index target OUTSIDE the project root must not share source-path keys with
 * the project's own files. Before the fix both were keyed relative to their own
 * directory, so a watched outside `README.md` edit/delete replaced or dropped the
 * project's `README.md` chunks. The watcher is mocked so batches are delivered
 * deterministically (no fs events, no debounce).
 */

import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileChangeBatch } from "../../../src/knowledge/file-watcher.js";
import { useTempDirs } from "../../helpers/tmp.js";

let deliver: ((b: FileChangeBatch) => void) | undefined;
vi.mock("../../../src/knowledge/file-watcher.js", () => ({
  watchPath: async (_root: string, cb: (b: FileChangeBatch) => void) => {
    deliver = cb;
    return { close: () => {} };
  },
}));

const { GolemKnowledgeBase, hashingEmbedFn, InMemoryVectorDriver } = await import(
  "../../../src/knowledge/index.js"
);
const { projectBaseDir, sourcePathFor } = await import("../../../src/knowledge/ingest.js");

const newTempDir = useTempDirs("golem-outside-watch-");
let project: string;
let outside: string;
let kb: InstanceType<typeof GolemKnowledgeBase>;

beforeEach(async () => {
  const root = await newTempDir();
  project = path.join(root, "project");
  outside = path.join(root, "outside");
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(project, "README.md"), "# projectMarker alpha\n");
  await writeFile(path.join(outside, "README.md"), "# outsideMarker beta\n");
  kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() });
  deliver = undefined;
});

afterEach(() => {
  kb.closeWatchers();
});

async function texts(query: string): Promise<string[]> {
  return (await kb.search(query, project, 20)).map((h) => h.chunk.text);
}
const has = async (marker: string) => (await texts(marker)).some((t) => t.includes(marker));

async function waitUntil(pred: () => Promise<boolean>): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > 5000) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("outside-project index target", () => {
  it("uses a source-path namespace distinct from the project's", async () => {
    const base = projectBaseDir(project, outside, false);
    const key = sourcePathFor(base, path.join(outside, "README.md"));
    expect(key).not.toBe("README.md");
    expect(sourcePathFor(base, path.join(project, "README.md"))).toBe("README.md");
    expect(key.startsWith("external:")).toBe(true);
    expect(key.includes("\\")).toBe(false);
  });

  it("editing a watched outside README.md leaves the project's README.md chunks intact", async () => {
    await kb.ingest(project, project);
    await kb.ingest(outside, project, true);
    expect(await has("projectMarker")).toBe(true);
    expect(await has("outsideMarker")).toBe(true);

    await writeFile(path.join(outside, "README.md"), "# outsideMarker gamma edited\n");
    deliver?.({ changed: [path.join(outside, "README.md")], removed: [] });
    await waitUntil(() => has("gamma edited"));

    expect(await has("projectMarker")).toBe(true);
  });

  it("deleting a watched outside README.md leaves the project's README.md chunks intact", async () => {
    await kb.ingest(project, project);
    await kb.ingest(outside, project, true);
    await rm(path.join(outside, "README.md"));
    deliver?.({ changed: [], removed: [path.join(outside, "README.md")] });
    await waitUntil(async () => !(await has("outsideMarker")));

    expect(await has("projectMarker")).toBe(true);
  });

  it("a target that IS the project root spelled through a symlink stays inside the project", async () => {
    const link = path.join(path.dirname(project), "project-link");
    await symlink(project, link, "junction");
    const realProject = await realpath(project);
    await mkdir(path.join(project, "docs"), { recursive: true });
    await writeFile(path.join(project, "docs", "guide.md"), "# guideMarker\n");
    for (const target of [link, path.join(link, "docs")]) {
      const base = projectBaseDir(realProject, target, false);
      const f = path.join(
        target === link ? link : target,
        target === link ? "README.md" : "guide.md",
      );
      expect(sourcePathFor(base, f).startsWith("external:")).toBe(false);
    }
    await kb.ingest(link, realProject);
    const hits = await kb.search("projectMarker alpha", realProject, 5);
    expect(hits.map((h) => h.chunk.sourcePath)).toContain("README.md");
  });

  it("a symlink INTO a project subdirectory never yields a base above the project or a mixed key", async () => {
    const deep = path.join(project, "deep", "er");
    await mkdir(path.join(deep, "c"), { recursive: true });
    await writeFile(path.join(deep, "f.md"), "# deepMarker\n");
    await writeFile(path.join(deep, "c", "f.md"), "# deepCMarker\n");
    const link1 = path.join(path.dirname(project), "link1");
    await symlink(deep, link1, "junction");
    const realProject = await realpath(project);
    for (const [target, file] of [
      [link1, path.join(link1, "f.md")],
      [path.join(link1, "c"), path.join(link1, "c", "f.md")],
    ] as const) {
      const base = projectBaseDir(realProject, target, false);
      const key = sourcePathFor(base, file);
      // The link's spelled path is not under the project, so the file is keyed in the
      // external namespace; never relative to a directory above the project.
      expect(key.startsWith("external:")).toBe(true);
    }
  });
});
