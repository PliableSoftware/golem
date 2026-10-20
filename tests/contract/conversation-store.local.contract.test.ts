/**
 * Registers LocalConversationStore against the ConversationStore contract
 * (DUST2.24, SUMMARY r106), plus the known-gap findings as expected-fail.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { redactRequestBody } from "../../src/pipeline/redaction.js";
import { LocalConversationStore } from "../../src/session/conversation-store.js";
import { useTempDirs } from "../helpers/tmp.js";
import { describeConversationStoreContract, runtimeSecret } from "./conversation-store-contract.js";

// Relative to now: a fixed date ages past the 30-day eviction window.
const NOW = Date.now();
const T0 = new Date(NOW - 60_000).toISOString();
const T1 = new Date(NOW - 59_000).toISOString();

const newTempDir = useTempDirs("golem-dust224-convstore-");

async function readTree(dir: string): Promise<string> {
  let out = "";
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    out += entry.isDirectory() ? await readTree(p) : `${entry.name}\n${await readFile(p, "utf8")}`;
  }
  return out;
}

describeConversationStoreContract("LocalConversationStore", async () => {
  const dir = await newTempDir();
  return { store: new LocalConversationStore(dir), readDisk: () => readTree(dir) };
});

describe("ConversationStore known gaps (Phase 3, S9)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await newTempDir();
  });

  // S9 (SUMMARY.md): object KEYS are never redacted (redaction.ts:287-290), and the
  // store inherits it. Written against current behaviour: when Phase 3 fixes S9 this
  // starts passing, `it.fails` flips red, and the marker must be removed.
  it.fails("S9: a secret used as an object key is redacted before disk", async () => {
    const store = new LocalConversationStore(dir);
    const secret = runtimeSecret("k");
    await store.appendTurn("c-key", {
      role: "user",
      content: { [secret]: "value" },
      timestamp: T0,
    });
    expect(await readTree(dir)).not.toContain(secret);
  });

  it("the store persists exactly what redactRequestBody returns (no second pass)", async () => {
    const store = new LocalConversationStore(dir);
    const content = { text: `x ${runtimeSecret("c")} y` };
    await store.appendTurn("c-same", {
      role: "user",
      content,
      timestamp: T0,
    });
    const rec = await store.readConversation("c-same");
    expect(rec?.turns[0]?.content).toEqual(redactRequestBody(content).value);
  });
});
