import { describe, expect, it, vi } from "vitest";
import { flakyRename, useFakePlatform } from "../helpers/flaky-rename.js";
import { useTempDirs } from "../helpers/tmp.js";

vi.mock("node:fs/promises", async (orig) =>
  (await import("../helpers/flaky-rename.js")).wrapFs(await orig()),
);

import { FileTaskStore } from "../../src/tasks/store.js";
import type { Task } from "../../src/tasks/types.js";

const tmp = useTempDirs("golem-win-rename-tasks-");
const platform = useFakePlatform();
const NOW = "2026-10-09T00:00:00.000Z";
const task = { id: "t1", createdAt: NOW, updatedAt: NOW, state: "queued", prompt: "p" } as Task;

describe("task store rides out a Windows rename sharing violation", () => {
  it("EPERM twice then success stores the task (win32)", async () => {
    const store = new FileTaskStore(await tmp());
    platform.set("win32");
    flakyRename.failNext(2);
    await expect(store.put(task, NOW)).resolves.toMatchObject({ id: "t1" });
    expect((await store.get("t1"))?.prompt).toBe("p");
  });

  it("EBUSY and EACCES are retried too (win32)", async () => {
    const store = new FileTaskStore(await tmp());
    platform.set("win32");
    flakyRename.failNext(1, "EBUSY");
    await store.put(task, NOW);
    flakyRename.failNext(1, "EACCES");
    await expect(store.put(task, NOW)).resolves.toMatchObject({ id: "t1" });
  });

  it("EPERM still throws off win32", async () => {
    const store = new FileTaskStore(await tmp());
    platform.set("linux");
    flakyRename.failNext(1);
    await expect(store.put(task, NOW)).rejects.toMatchObject({ code: "EPERM" });
    expect(flakyRename.calls).toBe(1);
  });
});
