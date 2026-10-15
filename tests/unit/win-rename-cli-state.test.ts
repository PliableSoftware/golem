import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { flakyRename, useFakePlatform } from "../helpers/flaky-rename.js";
import { useTempDirs } from "../helpers/tmp.js";

vi.mock("node:fs/promises", async (orig) =>
  (await import("../helpers/flaky-rename.js")).wrapFs(await orig()),
);

import { writeJsonObject } from "../../src/cli/json-file.js";

const tmp = useTempDirs("golem-win-rename-cli-");
const platform = useFakePlatform();

describe("cli json-file rides out a Windows rename sharing violation", () => {
  it("EPERM twice then success writes the file (win32)", async () => {
    const file = path.join(await tmp(), "settings.json");
    platform.set("win32");
    flakyRename.failNext(2);
    await expect(writeJsonObject(file, { a: 1 })).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: 1 });
  });

  it("EPERM still throws off win32", async () => {
    const file = path.join(await tmp(), "settings.json");
    platform.set("linux");
    flakyRename.failNext(1);
    await expect(writeJsonObject(file, { a: 1 })).rejects.toMatchObject({ code: "EPERM" });
    expect(flakyRename.calls).toBe(1);
  });
});
