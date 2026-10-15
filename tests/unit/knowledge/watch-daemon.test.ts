/**
 * DUST2.14 — the index watch daemon. The watcher is injected, so every batch is
 * delivered by the test: no timers, no sleeps. `idle()` is the condition to wait on.
 */

import { mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileChangeBatch, FileWatcher } from "../../../src/knowledge/file-watcher.js";
import {
  type IncrementalIngest,
  PartialReindexError,
} from "../../../src/knowledge/knowledge-base.js";
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
    const { daemon, feeds } = await start(kb, [project], { wikiDir: wiki });

    // the wiki always has its own watcher, even inside a watched root
    expect(daemon.stats.watched).toHaveLength(2);
    feeds.get(project)?.({ changed: [page], removed: [] });
    await daemon.idle();

    expect(kb.reindexCalls).toEqual([{ baseDir: project, files: [page] }]);
    await daemon.close();
  });

  it("watches a wiki dir outside the sync roots on its own, keyed external:", async () => {
    const wiki = path.join(outside, "wiki");
    const page = await mk(path.join(wiki, "a.md"));
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project], { wikiDir: wiki });
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

// ---------------------------------------------------------------------------------
// DUST2.14 review: leader election, wiki-only watcher, signature guard, retries
// ---------------------------------------------------------------------------------

/** A manual clock + timer queue: nothing fires until the test says so. */
function manualClock() {
  let t = 1_000_000;
  const q: { at: number; fn: () => void; ms: number }[] = [];
  return {
    now: () => t,
    timers: {
      set: (fn: () => void, ms: number) => {
        const h = { at: t + ms, fn, ms };
        q.push(h);
        return h;
      },
      clear: (h: unknown) => {
        const i = q.indexOf(h as (typeof q)[number]);
        if (i >= 0) q.splice(i, 1);
      },
    },
    /** Delays currently scheduled, in ms. */
    scheduled: () => q.map((h) => h.ms),
    advance(ms: number) {
      t += ms;
      for (const h of [...q]) {
        if (h.at <= t) {
          q.splice(q.indexOf(h), 1);
          h.fn();
        }
      }
    },
  };
}

describe("wiki always has its own watcher", () => {
  it("watches the wiki when the project root exceeds the file cap", async () => {
    const wiki = path.join(project, "docs", "wiki");
    const page = await mk(path.join(wiki, "A.md"));
    const w = fakeWatch();
    const { WatchCapExceededError } = await import("../../../src/knowledge/file-watcher.js");
    const capped = async (root: string, onBatch: (b: FileChangeBatch) => void) => {
      if (root === project) throw new WatchCapExceededError(root, 9, 2);
      return w.watch(root, onBatch);
    };
    const kb = new FakeKB();
    const daemon = await startIndexWatchDaemon({
      knowledge: kb,
      projectId: project,
      roots: [project],
      wikiDir: wiki,
      watch: capped as never,
    });
    expect(daemon.stats.skipped.some((s) => /watch cap/.test(s.reason))).toBe(true);
    expect([...w.feeds.keys()]).toEqual([wiki]);
    w.feeds.get(wiki)?.({ changed: [page], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls.flatMap((c) => c.files)).toEqual([page]);
    await daemon.close();
  });

  it("watches a wiki under a dot-dir the outer scan will not walk into", async () => {
    const wiki = path.join(project, ".wiki");
    const page = await mk(path.join(wiki, "A.md"));
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project], { wikiDir: wiki });
    expect([...feeds.keys()].sort()).toEqual([project, wiki].sort());
    feeds.get(wiki)?.({ changed: [page], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls[0]?.files).toEqual([page]);
    await daemon.close();
  });

  it("with the REAL watcher: an over-cap project still leaves the wiki watched", async () => {
    const wiki = path.join(project, "docs", "wiki");
    await mk(path.join(wiki, "A.md"));
    for (const n of ["a", "b", "c"]) await mk(path.join(project, `${n}.md`));
    const daemon = await startIndexWatchDaemon({
      knowledge: new FakeKB(),
      projectId: project,
      roots: [project],
      wikiDir: wiki,
      maxFiles: 5,
      pollMs: 60_000,
    });
    // project: 4 chunkable files fit under 5; shrink the cap so only the wiki fits
    await daemon.close();
    const tight = await startIndexWatchDaemon({
      knowledge: new FakeKB(),
      projectId: project,
      roots: [project],
      wikiDir: wiki,
      maxFiles: 1,
      pollMs: 60_000,
    });
    expect(tight.stats.watched).toHaveLength(1);
    expect(tight.stats.watched[0]?.endsWith(path.join("docs", "wiki"))).toBe(true);
    expect(tight.stats.skipped).toHaveLength(1);
    await tight.close();
  });
});

describe("signature guard", () => {
  it("halts before ANY apply when the index is another build's, logs once, releases the lease", async () => {
    const f = await mk(path.join(project, "a.md"));
    const lease = path.join(project, ".golem", "state", "kb-watch.lease");
    const kb = new FakeKB();
    const { daemon, feeds, closed, logs } = await start(kb, [project], {
      leasePath: lease,
      verifyIndex: async () => ({ kind: "halt", reason: "index rebuilt with another embedder" }),
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();

    expect(kb.reindexCalls).toEqual([]);
    expect(kb.removeCalls).toEqual([]);
    expect(daemon.stats.role).toBe("halted");
    expect(closed).toEqual([project]);
    expect(logs.filter((l) => l.includes("another embedder"))).toHaveLength(1);
    await daemon.close();
    await expect(readFile(lease, "utf8")).rejects.toThrow();
  });

  it("an unreadable manifest requeues instead of applying or halting", async () => {
    const f = await mk(path.join(project, "a.md"));
    const clock = manualClock();
    const kb = new FakeKB();
    let verdict: "retry" | "ok" = "retry";
    const { daemon, feeds } = await start(kb, [project], {
      timers: clock.timers,
      now: clock.now,
      verifyIndex: async () =>
        verdict === "retry" ? { kind: "retry", reason: "manifest unreadable" } : { kind: "ok" },
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls).toEqual([]);
    expect(daemon.stats.retrying).toBe(1);
    verdict = "ok";
    clock.advance(2000);
    await daemon.idle();
    expect(kb.reindexCalls.flatMap((c) => c.files)).toEqual([f]);
    await daemon.close();
  });
});

describe("failed paths are retried with capped exponential backoff", () => {
  it("retries 2s, 4s, 8s... then succeeds; gives up after RETRY_MAX_TRIES", async () => {
    const f = await mk(path.join(project, "a.md"));
    const clock = manualClock();
    const kb = new FakeKB();
    kb.failReindex = true;
    const { daemon, feeds, logs } = await start(kb, [project], {
      timers: clock.timers,
      now: clock.now,
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(clock.scheduled()).toEqual([2000]);

    const seen: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = clock.scheduled()[0] ?? 0;
      seen.push(next);
      clock.advance(next);
      await daemon.idle();
    }
    expect(seen).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000]); // capped at 60s

    clock.advance(clock.scheduled()[0] ?? 0); // the 8th failure: abandoned
    await daemon.idle();
    expect(daemon.stats.gaveUp).toBe(1);
    expect(daemon.stats.retrying).toBe(0);
    expect(logs.some((l) => l.includes("giving up on a.md"))).toBe(true);
    await daemon.close();
  });

  it("a failed edit keeps the page: a later success lands, and a fresh event supersedes a retry", async () => {
    const f = await mk(path.join(project, "a.md"));
    const clock = manualClock();
    const kb = new FakeKB();
    kb.failReindex = true;
    const { daemon, feeds } = await start(kb, [project], { timers: clock.timers, now: clock.now });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(daemon.stats.retrying).toBe(1);

    kb.failReindex = false;
    feeds.get(project)?.({ changed: [f], removed: [] }); // the next save supersedes the retry
    await daemon.idle();
    expect(daemon.stats.retrying).toBe(0);
    expect(kb.reindexCalls.flatMap((c) => c.files)).toEqual([f]);
    await daemon.close();
  });

  it("an UNREADABLE file is a failed path: not recorded as current, retried", async () => {
    const good = await mk(path.join(project, "good.md"));
    const bad = await mk(path.join(project, "bad.md"));
    const clock = manualClock();
    const kb = new FakeKB();
    let unreadable = true;
    kb.reindexFiles = async (baseDir, _p, files) => {
      const failed = unreadable ? files.filter((x) => x === bad) : [];
      kb.reindexCalls.push({ baseDir, files: files.filter((x) => !failed.includes(x)) });
      if (failed.length > 0) throw new PartialReindexError(failed, 1);
      return files.length;
    };
    const applied: AppliedChange[] = [];
    const { daemon, feeds } = await start(kb, [project], {
      timers: clock.timers,
      now: clock.now,
      onApplied: (c) => {
        applied.push(c);
      },
    });
    feeds.get(project)?.({ changed: [good, bad], removed: [] });
    await daemon.idle();

    expect(applied.flatMap((c) => c.changed.map((x) => x.abs))).toEqual([good]);
    expect(daemon.stats.retrying).toBe(1);
    unreadable = false;
    clock.advance(2000);
    await daemon.idle();
    expect(applied.flatMap((c) => c.changed.map((x) => x.abs))).toEqual([good, bad]);
    await daemon.close();
  });
});

describe("skips work the index already holds", () => {
  it("does not re-embed a file the manifest records at the same stat", async () => {
    const f = await mk(path.join(project, "a.md"), "same");
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project], {
      isCurrent: async (_b, files) => new Set(files.map((x) => x.abs)),
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls).toEqual([]);
    expect(daemon.stats.alreadyCurrent).toBe(1);
    await daemon.close();
  });

  it("does not re-embed the same stat twice (wiki seen by two watchers)", async () => {
    const f = await mk(path.join(project, "docs", "wiki", "a.md"));
    const kb = new FakeKB();
    const { daemon, feeds } = await start(kb, [project], {
      wikiDir: path.join(project, "docs", "wiki"),
    });
    feeds.get(project)?.({ changed: [f], removed: [] });
    await daemon.idle();
    feeds.get(path.join(project, "docs", "wiki"))?.({ changed: [f], removed: [] });
    await daemon.idle();
    expect(kb.reindexCalls).toHaveLength(1);
    await daemon.close();
  });
});

describe("per-project leader election (the vector store's own lock discipline)", () => {
  const leaseOf = () => path.join(project, ".golem", "state", "kb-watch.lease");

  it("N daemons on one project: exactly one leads; followers never start a watcher", async () => {
    const f = await mk(path.join(project, "a.md"));
    const parts = await Promise.all(
      Array.from({ length: 5 }, () => start(new FakeKB(), [project], { leasePath: leaseOf() })),
    );
    const roles = parts.map((p) => p.daemon.stats.role);
    expect(roles.filter((r) => r === "leader")).toHaveLength(1);
    expect(roles.filter((r) => r === "follower")).toHaveLength(4);
    for (const p of parts) {
      const leads = p.daemon.stats.role === "leader";
      expect(p.feeds.size).toBe(leads ? 1 : 0);
    }
    void f;
    for (const p of parts) await p.daemon.close();
  });

  it("a follower stays quiet: one slow retry timer, no polling, no applies", async () => {
    const clock = manualClock();
    const leader = await start(new FakeKB(), [project], { leasePath: leaseOf() });
    const kb = new FakeKB();
    const follower = await start(kb, [project], {
      leasePath: leaseOf(),
      timers: clock.timers,
      now: clock.now,
    });
    expect(follower.daemon.stats.role).toBe("follower");
    expect(follower.feeds.size).toBe(0);
    expect(clock.scheduled()).toEqual([30_000]);
    expect(kb.reindexCalls).toEqual([]);
    await follower.daemon.close();
    expect(clock.scheduled()).toEqual([]); // close clears the retry timer
    await leader.daemon.close();
  });

  it("a crashed leader is replaced: the follower's retry takes the stale lease over and catches up", async () => {
    const clock = manualClock();
    await mkdir(path.dirname(leaseOf()), { recursive: true });
    await writeFile(leaseOf(), "999999.dead-owner-token\n");
    const kb = new FakeKB();
    let tookOver = 0;
    const follower = await start(kb, [project], {
      leasePath: leaseOf(),
      timers: clock.timers,
      now: clock.now,
      onTakeover: () => {
        tookOver += 1;
      },
    });
    expect(follower.daemon.stats.role).toBe("follower"); // the dead owner's lease is still fresh

    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(leaseOf(), old, old); // the heartbeat stopped long ago
    clock.advance(30_000);
    // acquireLock does real fs work and a short real sleep: wait on the CONDITION.
    const deadline = Date.now() + 10_000;
    while (follower.daemon.stats.role !== "leader" && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    expect(follower.daemon.stats.role).toBe("leader");
    expect(tookOver).toBe(1);
    expect(follower.feeds.size).toBe(1);
    await follower.daemon.close();
  });

  it("close() releases the lease so the next session leads at once", async () => {
    const a = await start(new FakeKB(), [project], { leasePath: leaseOf() });
    expect(a.daemon.stats.role).toBe("leader");
    await a.daemon.close();
    await expect(readFile(leaseOf(), "utf8")).rejects.toThrow();
    const b = await start(new FakeKB(), [project], { leasePath: leaseOf() });
    expect(b.daemon.stats.role).toBe("leader");
    await b.daemon.close();
  });

  it("a leader whose lease was taken demotes itself instead of applying", async () => {
    const f = await mk(path.join(project, "a.md"));
    const kb = new FakeKB();
    const a = await start(kb, [project], { leasePath: leaseOf() });
    await writeFile(leaseOf(), "someone-else-took-it\n"); // lease replaced under us
    a.feeds.get(project)?.({ changed: [f], removed: [] });
    await a.daemon.idle();
    expect(kb.reindexCalls).toEqual([]);
    expect(a.daemon.stats.role).toBe("follower");
    expect(a.closed).toEqual([project]);
    await a.daemon.close();
  });
});
