/**
 * DUST2.14 — wiki -> vector index through the watch daemon, end to end: real
 * polling watcher (short intervals), real GolemKnowledgeBase over the in-memory
 * driver, real manifest. Waits are on conditions (the daemon's own `idle()` and
 * counters), never on a fixed sleep.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startKnowledgeWatch, writeManifest } from "../../src/cli/auto-index.js";
import {
  collectionDir,
  GolemKnowledgeBase,
  hashingEmbedFn,
  type IndexWatchDaemon,
  InMemoryVectorDriver,
  knowledgeDir,
} from "../../src/knowledge/index.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-wikiwatch-");
let project: string;
let kb: GolemKnowledgeBase;
let daemon: IndexWatchDaemon | undefined;

beforeEach(async () => {
  project = await newTempDir();
  kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() });
  daemon = undefined;
});

afterEach(async () => {
  await daemon?.close();
  kb.closeWatchers();
});

async function until(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sources = async (q: string): Promise<string[]> =>
  (await kb.search(q, project, 10)).map((h) => h.chunk.sourcePath ?? "");

const fast = { pollMs: 40, debounceMs: 40 };

describe("wiki -> vector index via the watcher", () => {
  it("a wiki page written after start is searchable with no manual ingest, and the wiki file is untouched", async () => {
    const wikiDir = path.join(project, "docs", "wiki");
    await mkdir(path.join(wikiDir, "concepts"), { recursive: true });
    daemon = await startKnowledgeWatch({
      projectDir: project,
      projectId: project,
      knowledge: kb,
      watchPaths: [],
      wikiDir,
      env: {},
      ...fast,
    });
    expect(daemon).toBeDefined();

    const page = path.join(wikiDir, "concepts", "Gizmo.md");
    const body = "# Gizmo\n\nThe zorblax gizmo flushes the frobnicator.\n";
    await writeFile(page, body);
    const before = await stat(page);

    await until(
      async () =>
        (await sources("zorblax gizmo frobnicator")).includes("docs/wiki/concepts/Gizmo.md"),
      "the page to be indexed",
    );

    // Derived cache: indexing read the page and never rewrote it.
    expect(await readFile(page, "utf8")).toBe(body);
    expect((await stat(page)).mtimeMs).toBe(before.mtimeMs);
  });

  it("a wiki dir outside the project is watched too, under external: keys", async () => {
    const wikiDir = path.join(await newTempDir(), "wiki");
    await mkdir(wikiDir, { recursive: true });
    daemon = await startKnowledgeWatch({
      projectDir: project,
      projectId: project,
      knowledge: kb,
      watchPaths: [],
      wikiDir,
      env: {},
      ...fast,
    });
    expect(daemon?.stats.watched).toHaveLength(2);
    await writeFile(path.join(wikiDir, "Far.md"), "# Far\n\nquuxwidget lives elsewhere.\n");
    await until(
      async () =>
        (await sources("quuxwidget lives elsewhere")).some(
          (s) => s.startsWith("external:") && s.endsWith("/wiki/Far.md"),
        ),
      "the external page to be indexed",
    );
  });

  it("records what it indexed in the manifest, so the next session does not redo it", async () => {
    await writeManifest(project, project, "lexical:hash-v1-512", [project], "t", {});
    const wikiDir = path.join(project, "docs", "wiki");
    await mkdir(wikiDir, { recursive: true });
    daemon = await startKnowledgeWatch({
      projectDir: project,
      projectId: project,
      knowledge: kb,
      watchPaths: [],
      wikiDir,
      env: {},
      ...fast,
    });
    await writeFile(path.join(wikiDir, "P.md"), "# P\n\nplinkplonk.\n");
    const manifest = path.join(collectionDir(knowledgeDir(project), project), "manifest.json");
    await until(async () => {
      const files = (JSON.parse(await readFile(manifest, "utf8")).files ?? {}) as Record<
        string,
        unknown
      >;
      return "docs/wiki/P.md" in files;
    }, "the manifest checkpoint");
  });

  it("GOLEM_KB_WATCH=off starts nothing", async () => {
    for (const v of ["0", "false", "OFF"]) {
      expect(
        await startKnowledgeWatch({
          projectDir: project,
          projectId: project,
          knowledge: kb,
          watchPaths: [],
          wikiDir: path.join(project, "docs", "wiki"),
          env: { GOLEM_KB_WATCH: v },
        }),
      ).toBeUndefined();
    }
  });

  it("starts nothing for a KB that cannot re-index incrementally", async () => {
    const plain = { ingest: async () => ({}), search: async () => [], getChunk: async () => ({}) };
    expect(
      await startKnowledgeWatch({
        projectDir: project,
        projectId: project,
        knowledge: plain as never,
        watchPaths: [],
        wikiDir: path.join(project, "docs", "wiki"),
        env: {},
      }),
    ).toBeUndefined();
  });
});
