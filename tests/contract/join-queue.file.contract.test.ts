/**
 * Registers FileJoinQueue against the JoinQueue contract (DUST2.24, SUMMARY r107).
 * Expiry is implementation behaviour pinned here too: an expired message is
 * claimed (so it can never land late) but never returned for delivery.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileJoinQueue, PENDING_TTL_MS } from "../../src/session/join-queue.js";
import { useTempDirs } from "../helpers/tmp.js";
import { describeJoinQueueContract } from "./join-queue-contract.js";

const newTempDir = useTempDirs("golem-dust224-joinq-");

async function readTree(dir: string): Promise<string> {
  let out = "";
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    out += entry.isDirectory() ? await readTree(p) : `${entry.name}\n${await readFile(p, "utf8")}`;
  }
  return out;
}

const open = (projectDir: string, now?: () => number): FileJoinQueue =>
  new FileJoinQueue({
    projectDir,
    ...(now !== undefined ? { now } : {}),
    resolve: async () => ({ ok: true }),
  });

describeJoinQueueContract("FileJoinQueue", async () => {
  const dir = await newTempDir();
  return { queue: open(dir), readDisk: () => readTree(dir), another: () => open(dir) };
});

describe("FileJoinQueue expiry", () => {
  it("claims an over-TTL message without delivering it", async () => {
    const dir = await newTempDir();
    let t = Date.parse("2026-09-20T00:00:00.000Z");
    const queue = open(dir, () => t);
    await queue.enqueue({
      conversationId: "a1b2c3d4e5f60718",
      deviceId: "d",
      messageId: "m-old",
      text: "stale",
    });
    t += PENDING_TTL_MS + 1;
    expect(await queue.claim("a1b2c3d4e5f60718")).toEqual([]);
    const listed = await queue.list();
    expect(listed[0]?.expiredAt).toBeDefined();
    expect(listed[0]?.deliveredAt).toBeUndefined();
  });
});
