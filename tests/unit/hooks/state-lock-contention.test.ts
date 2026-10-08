/**
 * Windows reports a held or pending-delete lockfile as EPERM/EACCES/EBUSY, not
 * EEXIST. The seam makes that simulable here; real Windows is CI's job.
 */

import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withFileLock } from "../../../src/hooks/state-lock.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-state-lock-contention-");
const errno = (code: string) => Object.assign(new Error(code), { code });

function failing(code: string, times: number) {
  let calls = 0;
  return {
    createExclusive: async () => {
      calls++;
      if (calls <= times) throw errno(code);
    },
    calls: () => calls,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("withFileLock contention codes", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("win32: %s then success takes the lock", async (code) => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const file = path.join(await newTempDir(), "state.json");
    const f = failing(code, 3);
    await withFileLock(file, async () => {}, {
      platform: "win32",
      createExclusive: f.createExclusive,
      timeoutMs: 5000,
    });
    expect(f.calls()).toBe(4);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("win32: EPERM until the deadline runs unlocked with a stderr note", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const file = path.join(await newTempDir(), "state.json");
    const f = failing("EPERM", Number.POSITIVE_INFINITY);
    let ran = false;
    await withFileLock(
      file,
      async () => {
        ran = true;
      },
      { platform: "win32", createExclusive: f.createExclusive, timeoutMs: 100 },
    );
    expect(ran).toBe(true);
    expect(f.calls()).toBeGreaterThan(1);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/timed out/);
  });

  it("linux: EPERM is a real failure, reported at once", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const file = path.join(await newTempDir(), "state.json");
    const f = failing("EPERM", Number.POSITIVE_INFINITY);
    await withFileLock(file, async () => {}, {
      platform: "linux",
      createExclusive: f.createExclusive,
      timeoutMs: 5000,
    });
    expect(f.calls()).toBe(1);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/EPERM/);
  });
});
