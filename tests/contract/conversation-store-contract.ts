/**
 * Reusable contract harness for ConversationStore implementations
 * (src/interfaces/conversation-store.ts, ADR-0007 §6, Decision 60).
 *
 * The binding clause under test: redaction is structural, so no raw secret may
 * reach the backing directory under any append shape. `readDisk` lets the
 * harness inspect every byte the implementation wrote.
 */

import { describe, expect, it } from "vitest";
import type { ConversationStore } from "../../src/interfaces/conversation-store.js";

export interface ConversationStoreHarness {
  readonly store: ConversationStore;
  /** Every byte under the store's backing location, concatenated. */
  readonly readDisk: () => Promise<string>;
}

const T0 = "2026-09-20T00:00:00.000Z";
const T1 = "2026-09-20T00:00:01.000Z";

/** Built at runtime so no scanner flags a literal and no placeholder passes vacuously. */
export function runtimeSecret(seed = "a"): string {
  return `ghp_${seed.repeat(36)}`;
}

export function describeConversationStoreContract(
  name: string,
  make: () => ConversationStoreHarness | Promise<ConversationStoreHarness>,
): void {
  describe(`ConversationStore contract: ${name}`, () => {
    it("never writes a raw secret from string content to disk", async () => {
      const { store, readDisk } = await make();
      const secret = runtimeSecret();
      await store.appendTurn("c-str", { role: "user", content: `token ${secret}`, timestamp: T0 });
      expect(await readDisk()).not.toContain(secret);
      const rec = await store.readConversation("c-str");
      expect(JSON.stringify(rec)).not.toContain(secret);
    });

    it("never writes a raw secret nested in structured content blocks", async () => {
      const { store, readDisk } = await make();
      const secret = runtimeSecret("b");
      await store.appendTurn("c-blocks", {
        role: "assistant",
        content: [
          { type: "text", text: `see ${secret}` },
          { type: "tool_use", id: "t1", name: "x", input: { header: `Bearer ${secret}` } },
        ],
        timestamp: T0,
      });
      expect(await readDisk()).not.toContain(secret);
    });

    it("keeps non-secret content and caller-defined role/timestamp verbatim", async () => {
      const { store } = await make();
      await store.appendTurn("c-plain", { role: "weird-role", content: "hello", timestamp: T0 });
      const rec = await store.readConversation("c-plain");
      expect(rec?.turns).toEqual([{ role: "weird-role", content: "hello", timestamp: T0 }]);
    });

    it("appends in order and tracks startedAt / lastTurnAt", async () => {
      const { store } = await make();
      await store.appendTurn("c-order", { role: "user", content: "one", timestamp: T0 });
      await store.appendTurn("c-order", { role: "assistant", content: "two", timestamp: T1 });
      const rec = await store.readConversation("c-order");
      expect(rec?.turns.map((t) => t.content)).toEqual(["one", "two"]);
      expect(rec?.startedAt).toBe(T0);
      expect(rec?.lastTurnAt).toBe(T1);
    });

    it("returns null for an unknown conversation and lists summaries with turn counts", async () => {
      const { store } = await make();
      expect(await store.readConversation("nope")).toBeNull();
      await store.appendTurn("c-list", { role: "user", content: "a", timestamp: T0 });
      await store.appendTurn("c-list", { role: "user", content: "b", timestamp: T1 });
      const list = await store.listConversations();
      expect(list.find((c) => c.conversationId === "c-list")?.turnCount).toBe(2);
    });

    it("forget removes one conversation, reports whether it existed, and leaves no residue", async () => {
      const { store, readDisk } = await make();
      await store.appendTurn("c-keep", { role: "user", content: "keep-me-marker", timestamp: T0 });
      await store.appendTurn("c-drop", { role: "user", content: "drop-me-marker", timestamp: T0 });
      expect(await store.forget("c-drop")).toBe(true);
      expect(await store.forget("c-drop")).toBe(false);
      expect(await store.readConversation("c-drop")).toBeNull();
      expect(await store.readConversation("c-keep")).not.toBeNull();
      const disk = await readDisk();
      expect(disk).not.toContain("drop-me-marker");
      expect(disk).toContain("keep-me-marker");
    });

    it("forgetAll removes everything and is safe to repeat", async () => {
      const { store, readDisk } = await make();
      await store.appendTurn("c-a", { role: "user", content: "all-marker", timestamp: T0 });
      await store.forgetAll();
      await store.forgetAll();
      expect(await store.listConversations()).toEqual([]);
      expect(await readDisk()).not.toContain("all-marker");
    });
  });
}
