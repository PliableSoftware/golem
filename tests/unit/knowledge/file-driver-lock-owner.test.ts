/**
 * Lock integrity: the heartbeat refreshes only a lock it owns, and breaking a
 * stale lock never takes a lock a live owner holds. Races are driven through the
 * `afterJudgedStale` hook and an injected `createExclusive`, not sleeps.
 */

import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "../../../src/knowledge/file-driver.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-fvd-owner-");
let lockPath: string;

beforeEach(async () => {
  lockPath = path.join(await newTempDir(), "chunks.lock");
});
afterEach(() => {
  vi.useRealTimers();
});

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
    // The live owner replaces the stale lock the breaker already judged; a third
    // process then grabs the slot the instant it is vacated (the old put-back window).
    const createExclusive = async (file: string, content: string) => {
      if (content.trim() === live) {
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
  });

  it("breaks a genuinely stale lock and acquires it", async () => {
    await writeFile(lockPath, "1.deadowner\n");
    await utimes(lockPath, OLD, OLD);
    const release = await acquireLock(lockPath, { staleMs: 1_000, waitMs: 2_000 });
    expect((await readFile(lockPath, "utf8")).trim()).not.toBe("1.deadowner");
    await release();
  });

  it("two breakers of one stale lock never both hold it", async () => {
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
