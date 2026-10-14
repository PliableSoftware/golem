/**
 * Lock integrity: the heartbeat refreshes only a lock it owns, and breaking a
 * stale lock never takes a lock a live owner holds. Races are driven through the
 * `afterJudgedStale` hook and an injected `createExclusive`, not sleeps.
 */

import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "../../../src/knowledge/file-driver.js";
import { collectionDir, FileVectorDriver, type StoredChunk } from "../../../src/knowledge/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-fvd-owner-");
let lockPath: string;

beforeEach(async () => {
  lockPath = path.join(await newTempDir(), "chunks.lock");
});
afterEach(() => {
  vi.useRealTimers();
});

const rmForce = (f: string) => rm(f, { force: true });
const OLD = new Date(Date.now() - 3_600_000);

describe("heartbeat ownership", () => {
  it("does not refresh the mtime of a lock that holds another owner's token", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const release = await acquireLock(lockPath, { staleMs: 30 });
    // Someone else now owns the slot (our lock was broken); theirs is old on purpose.
    await writeFile(lockPath, "9999.someoneelse\n");
    await utimes(lockPath, OLD, OLD);
    const before = (await stat(lockPath)).mtimeMs;

    await vi.advanceTimersByTimeAsync(100); // several beats
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 30)); // let any fire-and-forget utimes land
    expect((await stat(lockPath)).mtimeMs).toBe(before);
    await release();
    expect((await readFile(lockPath, "utf8")).trim()).toBe("9999.someoneelse");
  });

  it("still refreshes the mtime of its own lock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const release = await acquireLock(lockPath, { staleMs: 30 });
    await utimes(lockPath, OLD, OLD);
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      expect(Date.now() - (await stat(lockPath)).mtimeMs).toBeLessThan(60_000);
    });
    await release();
  });
});

describe("stale lock break", () => {
  it("never takes a lock a live owner installed after the staleness judgement", async () => {
    await writeFile(lockPath, "1.deadowner\n");
    await utimes(lockPath, OLD, OLD);
    const live = "4242.liveowner";
    const real = (file: string, content: string) => writeFile(file, content, { flag: "wx" });
    let injected = false;
    const foreignWrites: string[] = [];
    // The live owner replaces the stale lock the breaker already judged; a third
    // process then grabs the slot the instant it is vacated (the old put-back window).
    const createExclusive = async (file: string, content: string) => {
      if (content.trim() === live) {
        // The old code re-created the displaced owner's lock; a third process wins
        // the vacated slot first. The fixed code never writes another owner's token.
        foreignWrites.push(content);
        await writeFile(file, "7777.thirdparty\n").catch(() => {});
      }
      return real(file, content);
    };
    await expect(
      acquireLock(lockPath, {
        staleMs: 1_000,
        waitMs: 150,
        createExclusive,
        afterJudgedStale: async () => {
          if (injected) return;
          injected = true;
          await writeFile(lockPath, `${live}\n`); // fresh mtime
        },
      }),
    ).rejects.toThrow(/vector store lock timeout/);

    // The live owner's lock is untouched: still its token, no second holder.
    expect((await readFile(lockPath, "utf8")).trim()).toBe(live);
    expect(foreignWrites).toEqual([]);
  });

  it("breaks a genuinely stale lock and acquires it", async () => {
    await writeFile(lockPath, "1.deadowner\n");
    await utimes(lockPath, OLD, OLD);
    const release = await acquireLock(lockPath, { staleMs: 1_000, waitMs: 2_000 });
    expect((await readFile(lockPath, "utf8")).trim()).not.toBe("1.deadowner");
    await release();
  });

  it("guard (passes on old code too): contending breakers of one stale lock serialise", async () => {
    await writeFile(lockPath, "1.deadowner\n");
    await utimes(lockPath, OLD, OLD);
    let held = 0;
    let maxHeld = 0;
    const run = async () => {
      const release = await acquireLock(lockPath, { staleMs: 1_000, waitMs: 5_000 });
      held++;
      maxHeld = Math.max(maxHeld, held);
      await new Promise((r) => setTimeout(r, 20));
      held--;
      await release();
    };
    await Promise.all([run(), run(), run()]);
    expect(maxHeld).toBe(1);
  });
});

const BREAK = () => `${lockPath}.break`;

describe("breaker sidecar ownership", () => {
  it("clearing a stale sidecar never removes a fresh sidecar another breaker created meanwhile", async () => {
    await writeFile(lockPath, "1.deadowner\n");
    await utimes(lockPath, OLD, OLD);
    await writeFile(BREAK(), "0.deadbreaker\n");
    await utimes(BREAK(), OLD, OLD);
    const r = "5555.breakerR";
    let done = false;
    // P clears the stale sidecar and R creates a fresh one after our stat saw it stale.
    const beforeClearBreaker = async () => {
      if (done) return;
      done = true;
      await rmForce(BREAK());
      await writeFile(BREAK(), `${r}\n`);
    };
    await expect(
      acquireLock(lockPath, { staleMs: 1_000, waitMs: 150, beforeClearBreaker }),
    ).rejects.toThrow(/vector store lock timeout/);
    expect((await readFile(BREAK(), "utf8")).trim()).toBe(r);
    expect((await readFile(lockPath, "utf8")).trim()).toBe("1.deadowner");
  });

  it("a breaker whose sidecar was replaced backs off and leaves the other breaker's sidecar", async () => {
    await writeFile(lockPath, "1.deadowner\n");
    await utimes(lockPath, OLD, OLD);
    const next = "6666.nextbreaker";
    let done = false;
    const beforeTakeRename = async () => {
      if (done) return;
      done = true;
      await writeFile(BREAK(), `${next}\n`); // stalled past staleMs; the next breaker took over
    };
    await expect(
      acquireLock(lockPath, { staleMs: 1_000, waitMs: 150, beforeTakeRename }),
    ).rejects.toThrow(/vector store lock timeout/);
    expect((await readFile(BREAK(), "utf8")).trim()).toBe(next);
    expect((await readFile(lockPath, "utf8")).trim()).toBe("1.deadowner");
  });
});

describe("write fencing", () => {
  it("assertHeld rejects once the lock carries another token", async () => {
    const release = await acquireLock(lockPath);
    await release.assertHeld();
    await writeFile(lockPath, "9999.someoneelse\n");
    await expect(release.assertHeld()).rejects.toThrow(/lock lost/);
    await release();
  });

  it("a heartbeat that finds the lock gone marks it lost for good", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const release = await acquireLock(lockPath, { staleMs: 30 });
    const mine = (await readFile(lockPath, "utf8")).trim();
    await writeFile(lockPath, "9999.someoneelse\n");
    await vi.advanceTimersByTimeAsync(40);
    vi.useRealTimers();
    await vi.waitFor(() => expect(release.lost).toBe(true));
    await writeFile(lockPath, `${mine}\n`); // even if it looks like ours again
    await expect(release.assertHeld()).rejects.toThrow(/lock lost/);
    await release();
  });

  it("a flush whose lock was broken mid-write aborts and writes nothing", async () => {
    const base = await newTempDir();
    const chunk: StoredChunk = {
      chunk: { chunkId: "c1", projectId: "p", text: "t", sourcePath: "a.md", metadata: {} },
      vector: [1, 0],
    };
    const driver = new FileVectorDriver(base, {
      // The lock is broken the instant we hold it: a stalled holder losing to a break.
      createExclusive: async (file, content) => {
        await writeFile(file, content, { flag: "wx" });
        await writeFile(file, "9999.newowner\n");
      },
    });
    await expect(driver.upsert("p", [chunk])).rejects.toThrow(/lock lost/);
    const dir = collectionDir(base, "p");
    await expect(stat(path.join(dir, "chunks.jsonl"))).rejects.toThrow();
    await expect(stat(path.join(dir, "meta.json"))).rejects.toThrow();
    expect((await readFile(path.join(dir, "chunks.lock"), "utf8")).trim()).toBe("9999.newowner");
  });
});
