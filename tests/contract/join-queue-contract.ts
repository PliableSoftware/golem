/**
 * Reusable contract harness for JoinQueue implementations
 * (src/interfaces/join-queue.ts, R13.7): redaction on enqueue, idempotent
 * enqueue, and an atomic claim that delivers each message exactly once.
 */

import { describe, expect, it } from "vitest";
import type { JoinQueue } from "../../src/interfaces/join-queue.js";

export interface JoinQueueHarness {
  readonly queue: JoinQueue;
  /** Every byte under the queue's backing location, concatenated. */
  readonly readDisk: () => Promise<string>;
  /** Build a second handle over the SAME backing store (a second process). */
  readonly another: () => JoinQueue;
}

const CONV = "a1b2c3d4e5f60718";
const input = (messageId: string, text = "run the tests") => ({
  conversationId: CONV,
  deviceId: "phone-1",
  messageId,
  text,
});

export function describeJoinQueueContract(
  name: string,
  make: () => JoinQueueHarness | Promise<JoinQueueHarness>,
): void {
  describe(`JoinQueue contract: ${name}`, () => {
    it("redacts on enqueue: the raw secret reaches neither disk nor any read path", async () => {
      const { queue, readDisk } = await make();
      const secret = `ghp_${"q".repeat(36)}`;
      const res = await queue.enqueue(input("m-red", `use ${secret} now`));
      expect(res.status).toBe("queued");
      expect(await readDisk()).not.toContain(secret);
      expect(JSON.stringify(res)).not.toContain(secret);
      expect(JSON.stringify(await queue.pending(CONV))).not.toContain(secret);
      expect(JSON.stringify(await queue.claim(CONV))).not.toContain(secret);
      expect(JSON.stringify(await queue.list())).not.toContain(secret);
    });

    it("enqueue is idempotent by messageId: a retry returns the original, never a second copy", async () => {
      const { queue } = await make();
      const first = await queue.enqueue(input("m-dup", "first"));
      const retry = await queue.enqueue(input("m-dup", "different text on retry"));
      expect(first.status).toBe("queued");
      expect(retry.status).toBe("duplicate");
      if (retry.status === "duplicate") expect(retry.message.text).toBe("first");
      expect(await queue.pending(CONV)).toHaveLength(1);
    });

    it("idempotency survives delivery: a retry after claim is still a duplicate", async () => {
      const { queue } = await make();
      await queue.enqueue(input("m-after"));
      await queue.claim(CONV);
      expect((await queue.enqueue(input("m-after"))).status).toBe("duplicate");
      expect(await queue.pending(CONV)).toHaveLength(0);
    });

    it("refuses empty text and malformed ids as a first-class outcome, storing nothing", async () => {
      const { queue } = await make();
      expect((await queue.enqueue(input("m-empty", "   "))).status).toBe("refused");
      expect((await queue.enqueue(input("../escape"))).status).toBe("refused");
      expect(
        (await queue.enqueue({ ...input("m-badconv"), conversationId: "../etc" })).status,
      ).toBe("refused");
      expect(await queue.list()).toHaveLength(0);
    });

    it("claim returns pending messages oldest-first, once, and marks them delivered", async () => {
      const { queue } = await make();
      await queue.enqueue(input("m1", "one"));
      await queue.enqueue(input("m2", "two"));
      const got = await queue.claim(CONV);
      expect(got.map((m) => m.text)).toEqual(["one", "two"]);
      expect(got.every((m) => typeof m.deliveredAt === "string")).toBe(true);
      expect(await queue.claim(CONV)).toEqual([]);
      expect(await queue.pending(CONV)).toEqual([]);
    });

    it("claim is atomic: concurrent claimers across handles deliver each message exactly once", async () => {
      const h = await make();
      for (let i = 0; i < 6; i++) await h.queue.enqueue(input(`m-race-${i}`, `msg ${i}`));
      const claimers = [h.queue, h.another(), h.another(), h.queue, h.another()];
      const results = await Promise.all(claimers.map((q) => q.claim(CONV)));
      const ids = results.flat().map((m) => m.messageId);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
    });

    it("forget removes a message by id and reports whether it existed", async () => {
      const { queue } = await make();
      await queue.enqueue(input("m-forget", "forget-marker"));
      expect(await queue.forget("m-forget")).toBe(true);
      expect(await queue.forget("m-forget")).toBe(false);
      expect(await queue.pending(CONV)).toEqual([]);
    });
  });
}
