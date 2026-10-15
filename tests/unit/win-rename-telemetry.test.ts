import { describe, expect, it, vi } from "vitest";
import { flakyRename, useFakePlatform } from "../helpers/flaky-rename.js";
import { useTempDirs } from "../helpers/tmp.js";

vi.mock("node:fs/promises", async (orig) =>
  (await import("../helpers/flaky-rename.js")).wrapFs(await orig()),
);

import { readModelCatalog, writeModelCatalog } from "../../src/telemetry/model-catalog.js";

const tmp = useTempDirs("golem-win-rename-telemetry-");
const platform = useFakePlatform();
const CATALOG = { source: "test", asOf: "2026-10-09", entries: [] };

describe("telemetry model catalog rides out a Windows rename sharing violation", () => {
  it("EPERM twice then success writes the catalog (win32)", async () => {
    const dir = await tmp();
    platform.set("win32");
    flakyRename.failNext(2);
    await expect(writeModelCatalog(dir, CATALOG)).resolves.toBeUndefined();
    expect((await readModelCatalog(dir))?.source).toBe("test");
  });

  it("EPERM still throws off win32", async () => {
    platform.set("linux");
    flakyRename.failNext(1);
    await expect(writeModelCatalog(await tmp(), CATALOG)).rejects.toMatchObject({ code: "EPERM" });
  });
});
