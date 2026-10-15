/**
 * Windows reports a held or pending-delete lockfile as EPERM/EACCES/EBUSY, not
 * EEXIST. The seam makes that simulable here; real Windows is CI's job.
 */

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../../../src/knowledge/file-driver.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-fvd-contention-");
let lockPath: string;

beforeEach(async () => {
  lockPath = path.join(await newTempDir(), "chunks.lock");
});

const errno = (code: string) => Object.assign(new Error(code), { code });

/** An exclusive create that fails with `code` `times` times, then succeeds. */
function failing(code: string, times: number) {
  let calls = 0;
  const createExclusive = async () => {
    calls++;
    if (calls <= times) throw errno(code);
  };
  return { createExclusive, calls: () => calls };
}

describe("acquireLock contention codes", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("win32: %s N times then success acquires", async (code) => {
    const f = failing(code, 4);
    const release = await acquireLock(lockPath, {
      platform: "win32",
      createExclusive: f.createExclusive,
      waitMs: 5000,
    });
    expect(f.calls()).toBe(5);
    await release();
  });

  it("win32: EPERM until the deadline times out as designed, not hang", async () => {
    const f = failing("EPERM", Number.POSITIVE_INFINITY);
    const t0 = Date.now();
    await expect(
      acquireLock(lockPath, { platform: "win32", createExclusive: f.createExclusive, waitMs: 150 }),
    ).rejects.toThrow(/vector store lock timeout/);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it.each(["linux", "darwin"] as const)("%s: EPERM and EACCES still throw at once", async (p) => {
    for (const code of ["EPERM", "EACCES"]) {
      const f = failing(code, Number.POSITIVE_INFINITY);
      await expect(
        acquireLock(lockPath, { platform: p, createExclusive: f.createExclusive, waitMs: 5000 }),
      ).rejects.toThrow(code);
      expect(f.calls()).toBe(1);
    }
  });

  it("win32: a non-contention error such as ENOSPC still throws", async () => {
    const f = failing("ENOSPC", Number.POSITIVE_INFINITY);
    await expect(
      acquireLock(lockPath, { platform: "win32", createExclusive: f.createExclusive }),
    ).rejects.toThrow("ENOSPC");
  });
});
