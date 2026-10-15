/**
 * DUST2.14 — the index watch daemon. The watcher is injected, so every batch is
 * delivered by the test: no timers, no sleeps. `idle()` is the condition to wait on.
 */

import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileChangeBatch, FileWatcher } from "../../../src/knowledge/file-watcher.js";
import type { IncrementalIngest } from "../../../src/knowledge/knowledge-base.js";
import {
  type AppliedChange,
  type IndexWatchDaemon,
  startIndexWatchDaemon,
  WATCH_APPLY_FILES,
} from "../../../src/knowledge/watch-daemon.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-wdaemon-");
let project: string;
let outside: string;

beforeEach(async () => {
  project = await newTempDir();
  outside = await newTempDir();
});

class FakeKB implements IncrementalIngest {
  readonly incrementalReady = true;
  readonly reindexCalls: { baseDir: string; files: string[] }[] = [];
  readonly removeCalls: string[][] = [];
  failReindex = false;
  /** When set, reindexFiles parks on it, so a test can hold an apply in flight. */
  gate: Promise<void> | undefined;
  async reindexFiles(baseDir: string, _p: string, files: readonly string[]): Promise<number> {
    if (this.gate !== undefined) await this.gate;
    if (this.failReindex) throw new Error("embedder down");
    this.reindexCalls.push({ baseDir, files: [...files] });
    return files.length;
  }
  async removeSourcePaths(_p: string, sps: readonly string[]): Promise<number> {
    this.removeCalls.push([...sps]);
    return sps.length;
  }
  async ingestText(): Promise<number> {
    return 0;
  }
}

/** A watcher factory that records each root and hands the test its `onBatch`. */
function fakeWatch() {
  const feeds = new Map<string, (b: FileChangeBatch) => void>();
  const closed: string[] = [];
  const watch = async (root: string, onBatch: (b: FileChangeBatch) => void) => {
    feeds.set(root, onBatch);
    const w: FileWatcher = {
      cycles: 0,
      errors: 0,
      close: () => {
        closed.push(root);
      },
    };
    return w;
  };
  return { watch, feeds, closed };
}

async function mk(file: string, text = "# x\n"): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

async function start(
  kb: FakeKB,
  roots: string[],
  extra: Partial<Parameters<typeof startIndexWatchDaemon>[0]> = {},
) {
  const w = fakeWatch();
  const logs: string[] = [];
  const daemon: IndexWatchDaemon = await startIndexWatchDaemon({
    knowledge: kb,
    projectId: project,
    roots,
    watch: w.watch,
    log: (m) => logs.push(m),
    ...extra,
  });
  return { daemon, ...w, logs };
}

describe("startIndexWatchDaemon", () => {
  it("a wiki page write reaches reindexFiles with project-relative keys, no manual ingest", async () => {
    const wiki = path.join(project, "docs", "wiki");
    const page = await mk(path.join(wiki, "concepts", "New Page.md"));
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project, wiki]);

    // the wiki sits inside the project root, so it is covered, not watched twice
    expect(daemon.stats.watched).toHaveLength(1);
    feeds.get(project)?.({ changed: [page], removed: [] });
    await daemon.idle();

    expect(kb.reindexCalls).toEqual([{ baseDir: project, files: [page] }]);
    await daemon.close();
  });

  it("watches a wiki dir outside the sync roots on its own, keyed external:", async () => {
    const wiki = path.join(outside, "wiki");
    const page = await mk(path.join(wiki, "a.md"));
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project, wiki]);
    expect(daemon.stats.watched).toHaveLength(2);

    feeds.get(wiki)?.({ changed: [], removed: [page] });
    await daemon.idle();

    const key = kb.removeCalls[0]?.[0] ?? "";
    expect(key.startsWith("external:")).toBe(true);
    expect(key.endsWith("/wiki/a.md")).toBe(true);
    await daemon.close();
  });

  it("drops duplicate and nested roots and skips missing ones", async () => {
    const sub = path.join(project, "src");
    await mk(path.join(sub, "a.ts"), "export {};\n");
    const { daemon, logs } = await start(new FakeKB(), [
      sub,
      project,
      project,
      path.join(project, "nope"),
    ]);
    expect(daemon.stats.watched).toHaveLength(1);
    expect(daemon.stats.skipped.map((s) => s.reason)).toEqual(["not found"]);
    expect(logs).toEqual([]);
    await daemon.close();
  });

  it("collapses an event storm on one path into at most one more apply", async () => {
    const f = await mk(path.join(project, "a.md"));
    const kb = new FakeKB();
    let release: () => void = () => {};
    kb.gate = new Promise<void>((r) => {
      release = r;
    });
    const { daemon, feeds } = await start(kb, [project]);
    const feed = feeds.get(project);

    feed?.({ changed: [f], removed: [] }); // first apply parks on the gate
    for (let i = 0; i < 500; i += 1) feed?.({ changed: [f], removed: [] });
    kb.gate = undefined;
    release();
    await daemon.idle();

    expect(kb.reindexCalls.length).toBeLessThanOrEqual(2);
    expect(daemon.stats.batches).toBe(501);
    await daemon.close();
  });

  it("settles rename-over-existing on the final state, in either order", async () => {
    const a = await mk(path.join(project, "a.md"));
    const b = path.join(project, "gone.md");
    const kb = new FakeKB();
    let release: () => void = () => {};
    kb.gate = new Promise<void>((r) => {
      release = r;
    });
    const { daemon, feeds } = await start(kb, [project]);
    const feed = feeds.get(project);

    feed?.({ changed: [], removed: [path.join(project, "park.md")] }); // occupies the drain
    feed?.({ changed: [], removed: [a] }); // a removed…
    feed?.({ changed: [a], removed: [] }); // …then replaced: final state is "changed"
    feed?.({ changed: [b], removed: [] }); // b appears…
    feed?.({ changed: [], removed: [b] }); // …and goes: final state is "removed"
    kb.gate = undefined;
    release();
    await daemon.idle();

    const reindexed = kb.reindexCalls.flatMap((c) => c.files);
    expect(reindexed).toContain(a);
    expect(reindexed).not.toContain(b);
    expect(kb.removeCalls.flat()).toContain("gone.md");
    await daemon.close();
  });

  it("applies deletions before re-embedding and slices large batches", async () => {
    const files: string[] = [];
    for (let i = 0; i < WATCH_APPLY_FILES + 3; i += 1) {
      files.push(await mk(path.join(project, `f${String(i).padStart(2, "0")}.md`)));
    }
    const order: string[] = [];
    const kb = new FakeKB();
    const reindex = kb.reindexFiles.bind(kb);
    kb.reindexFiles = async (...args) => {
      order.push("reindex");
      return reindex(...args);
    };
    const remove = kb.removeSourcePaths.bind(kb);
    kb.removeSourcePaths = async (...args) => {
      order.push("remove");
      return remove(...args);
    };
    const { daemon, feeds } = await start(kb, [project]);
    feeds.get(project)?.({ changed: files, removed: [path.join(project, "old.md")] });
    await daemon.idle();

    expect(order).toEqual(["remove", "reindex", "reindex"]);
    expect(kb.reindexCalls.map((c) => c.files.length)).toEqual([WATCH_APPLY_FILES, 3]);
    await daemon.close();
  });

  it("swallows a failing reindex: counted, logged, and the daemon keeps working", async () => {
    const f = await mk(path.join(project, "a.md"));
    const g = await mk(path.join(project, "b.md"));
    const kb = new FakeKB();
    kb.failReindex = true;
    const { daemon, feeds, logs } = await start(kb, [project]);

    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(daemon.stats.errors).toBe(1);
    expect(logs.some((l) => l.includes("embedder down"))).toBe(true);

    kb.failReindex = false;
    feeds.get(project)?.({ changed: [g], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls.flatMap((c) => c.files)).toEqual([g]);
    await daemon.close();
  });

  it("swallows a throwing logger and a throwing recorder", async () => {
    const f = await mk(path.join(project, "a.md"));
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project], {
      log: () => {
        throw new Error("log sink closed");
      },
      onApplied: () => {
        throw new Error("disk full");
      },
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(daemon.stats.errors).toBe(1);
    await daemon.close();
  });

  it("hands the recorder the mtime/size seen BEFORE the file was read", async () => {
    const f = await mk(path.join(project, "a.md"), "12345");
    const applied: AppliedChange[] = [];
    const { daemon, feeds } = await start(new FakeKB(), [project], {
      onApplied: (c) => {
        applied.push(c);
      },
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(applied[0]?.changed[0]).toMatchObject({ abs: f, size: 5 });
    await daemon.close();
  });

  it("refuses a path that resolves outside its root (symlink swapped in after the scan)", async () => {
    const secret = await mk(path.join(outside, "secret.md"), "top secret");
    const link = path.join(project, "link.md");
    try {
      await symlink(secret, link);
    } catch {
      return; // no symlink privilege on this host (Windows without developer mode)
    }
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project]);
    feeds.get(project)?.({ changed: [link], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls).toEqual([]);
    expect(daemon.stats.errors).toBe(1);
    await daemon.close();
  });

  it("treats a changed path that vanished before apply as a removal", async () => {
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project]);
    feeds.get(project)?.({ changed: [path.join(project, "ghost.md")], removed: [] });
    await daemon.idle();
    expect(kb.removeCalls).toEqual([["ghost.md"]]);
    expect(kb.reindexCalls).toEqual([]);
    await daemon.close();
  });

  it("close() stops every watcher, drops queued work, waits for the in-flight apply, is idempotent", async () => {
    const a = await mk(path.join(project, "a.md"));
    const b = await mk(path.join(project, "b.md"));
    const kb = new FakeKB();
    let release: () => void = () => {};
    kb.gate = new Promise<void>((r) => {
      release = r;
    });
    const { daemon, feeds, closed } = await start(kb, [project]);
    feeds.get(project)?.({ changed: [a], removed: [] }); // in flight, parked
    await Promise.resolve();
    feeds.get(project)?.({ changed: [b], removed: [] }); // queued behind it

    const closing = daemon.close();
    expect(closed).toEqual([project]);
    release();
    await closing;
    await daemon.close(); // second close: no throw, no second watcher close

    expect(closed).toEqual([project]);
    expect(kb.reindexCalls.flatMap((c) => c.files)).not.toContain(b);
    feeds.get(project)?.({ changed: [b], removed: [] }); // a late event after close
    await daemon.idle();
    expect(kb.reindexCalls.flatMap((c) => c.files)).not.toContain(b);
  });

  it("does not throw when the watcher cannot start (cap exceeded): the root is skipped with the reason", async () => {
    await mk(path.join(project, "a.md"));
    await mk(path.join(project, "b.md"));
    await mk(path.join(project, "c.md"));
    const kb = new FakeKB();
    const logs: string[] = [];
    // The REAL watcher, no fake: its baseline scan must refuse a tree over the cap.
    const daemon = await startIndexWatchDaemon({
      knowledge: kb,
      projectId: project,
      roots: [project],
      maxFiles: 2,
      log: (m) => logs.push(m),
    });
    expect(daemon.stats.watched).toEqual([]);
    expect(daemon.stats.skipped[0]?.reason).toMatch(/exceed the watch cap of 2/);
    expect(daemon.stats.errors).toBe(1);
    await daemon.close();
  });
});
