/**
 * The shared atomic write (hosted-sessions.json and the settings files) must
 * ride out a Windows sharing violation on rename, and clean up if it never ends.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { replaceViaTemp } from "../../src/config/file-io.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-file-io-");
const errno = (code: string) => Object.assign(new Error(code), { code });
const sleep = async () => {};

describe("replaceViaTemp rename retry", () => {
  it("win32: rename failing EPERM twice then succeeding writes the file", async () => {
    const dir = await newTempDir();
    const file = path.join(dir, "hosted-sessions.json");
    const { rename } = await import("node:fs/promises");
    const doRename = vi
      .fn(rename)
      .mockRejectedValueOnce(errno("EPERM"))
      .mockRejectedValueOnce(errno("EPERM"));
    await replaceViaTemp(file, "new\n", { platform: "win32", rename: doRename, sleep });
    expect(doRename).toHaveBeenCalledTimes(3);
    expect(await readFile(file, "utf8")).toBe("new\n");
    expect(await readdir(dir)).toEqual(["hosted-sessions.json"]);
  });

  it("win32: a rename that never succeeds rethrows and removes the temp file", async () => {
    const dir = await newTempDir();
    const file = path.join(dir, "hosted-sessions.json");
    await writeFile(file, "old\n");
    const doRename = vi.fn().mockRejectedValue(errno("EPERM"));
    await expect(
      replaceViaTemp(file, "new\n", { platform: "win32", rename: doRename, sleep, tries: 3 }),
    ).rejects.toThrow("EPERM");
    expect(doRename).toHaveBeenCalledTimes(3);
    expect(await readdir(dir)).toEqual(["hosted-sessions.json"]);
    expect(await readFile(file, "utf8")).toBe("old\n");
  });

  it("linux: EPERM is not retried", async () => {
    const dir = await newTempDir();
    const doRename = vi.fn().mockRejectedValue(errno("EPERM"));
    await expect(
      replaceViaTemp(path.join(dir, "f.json"), "x", { platform: "linux", rename: doRename, sleep }),
    ).rejects.toThrow("EPERM");
    expect(doRename).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual([]);
  });
});
