import { describe, expect, it, vi } from "vitest";
import { flakyRename, useFakePlatform } from "../helpers/flaky-rename.js";
import { useTempDirs } from "../helpers/tmp.js";

vi.mock("node:fs/promises", async (orig) =>
  (await import("../helpers/flaky-rename.js")).wrapFs(await orig()),
);

import { LocalConversationStore } from "../../src/session/conversation-store.js";
import { readSessionTree, writeSessionTree } from "../../src/session/session-tree.js";

const tmp = useTempDirs("golem-win-rename-session-");
const platform = useFakePlatform();
const TURN = { role: "user", content: "hello", timestamp: "2026-10-09T00:00:00.000Z" };

describe("session stores ride out a Windows rename sharing violation", () => {
  it("conversation-store: EPERM twice then success appends the turn (win32)", async () => {
    const store = new LocalConversationStore(await tmp());
    platform.set("win32");
    flakyRename.failNext(2);
    await expect(store.appendTurn("c1", TURN)).resolves.toBeUndefined();
    expect((await store.readConversation("c1"))?.turns).toHaveLength(1);
  });

  it("conversation-store: EPERM still throws off win32", async () => {
    const store = new LocalConversationStore(await tmp());
    platform.set("linux");
    flakyRename.failNext(1);
    await expect(store.appendTurn("c1", TURN)).rejects.toMatchObject({ code: "EPERM" });
    expect(flakyRename.calls).toBe(1);
  });

  it("session-tree: EPERM twice then success writes the tree (win32)", async () => {
    const dir = await tmp();
    platform.set("win32");
    flakyRename.failNext(2);
    await expect(writeSessionTree(dir, { conversations: [] })).resolves.toBeUndefined();
    expect(await readSessionTree(dir)).toEqual({ conversations: [] });
  });

  it("session-tree: EPERM still throws off win32", async () => {
    platform.set("darwin");
    flakyRename.failNext(1);
    await expect(writeSessionTree(await tmp(), { conversations: [] })).rejects.toMatchObject({
      code: "EPERM",
    });
  });
});
