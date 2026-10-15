import { describe, expect, it, vi } from "vitest";
import {
  isLockContention,
  isRenameRetryable,
  renameWithRetry,
} from "../../../src/shared/win-fs-retry.js";

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("isLockContention", () => {
  it("treats EEXIST as contention everywhere", () => {
    for (const p of ["win32", "linux", "darwin"] as const)
      expect(isLockContention(errno("EEXIST"), p)).toBe(true);
  });

  it("treats EPERM, EACCES and EBUSY as contention on win32 only", () => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      expect(isLockContention(errno(code), "win32")).toBe(true);
      expect(isLockContention(errno(code), "linux")).toBe(false);
      expect(isLockContention(errno(code), "darwin")).toBe(false);
    }
    expect(isLockContention(errno("ENOSPC"), "win32")).toBe(false);
  });
});

describe("renameWithRetry", () => {
  const opts = (rename: () => Promise<void>, platform: NodeJS.Platform) => ({
    rename,
    platform,
    sleep: async () => {},
  });

  it("succeeds after EPERM twice on win32", async () => {
    const rename = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(errno("EPERM"))
      .mockRejectedValueOnce(errno("EBUSY"))
      .mockResolvedValue(undefined);
    await renameWithRetry("a", "b", opts(rename, "win32"));
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("gives up after the bounded tries and rethrows the last error", async () => {
    const rename = vi.fn<() => Promise<void>>().mockRejectedValue(errno("EACCES"));
    await expect(renameWithRetry("a", "b", { ...opts(rename, "win32"), tries: 4 })).rejects.toThrow(
      "EACCES",
    );
    expect(rename).toHaveBeenCalledTimes(4);
  });

  it("does not retry EPERM off win32", async () => {
    const rename = vi.fn<() => Promise<void>>().mockRejectedValue(errno("EPERM"));
    await expect(renameWithRetry("a", "b", opts(rename, "linux"))).rejects.toThrow("EPERM");
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("does not retry other errors on win32", async () => {
    const rename = vi.fn<() => Promise<void>>().mockRejectedValue(errno("ENOENT"));
    await expect(renameWithRetry("a", "b", opts(rename, "win32"))).rejects.toThrow("ENOENT");
    expect(isRenameRetryable(errno("ENOENT"), "win32")).toBe(false);
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
