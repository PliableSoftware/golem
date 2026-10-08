/**
 * Recorded-shape fidelity at compression <= 1 (DUST2.24, SUMMARY r098).
 *
 * CLAUDE.md hard rule, as reworded by DUST2.1: any redaction or level-1 dedup
 * re-serialises the whole body (`pipeline.ts` stage 2 onward), so the bar is
 * not "untouched bytes" but (a) untouched when nothing applies, (b) lossless:
 * whatever level 1 removes is CCR-reversible byte-for-byte, and (c) prefix
 * stable: turn N+1's forwarded history starts with exactly the bytes turn N
 * forwarded, so the upstream prompt cache keeps hitting.
 *
 * Drives the real `pipeline.process()` over the recorded shapes in
 * tests/helpers/recorded-conversations.ts.
 */

import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../src/compression/index.js";
import { LocalDirBlobStore } from "../../src/compression/local-blob-store.js";
import { type CompressionLevel, policyFor } from "../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../src/pipeline/index.js";
import { redactRequestBody } from "../../src/pipeline/redaction.js";
import type { ProxyRequest } from "../../src/proxy/types.js";
import { type Msg, type RecordedShape, recordedShapes } from "../helpers/recorded-conversations.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-dust224-fidelity-");

interface Rig {
  readonly compression: NativeLosslessCompression;
  readonly send: (shape: RecordedShape, turnLength: number) => Promise<Sent>;
}
interface Sent {
  readonly req: ProxyRequest;
  readonly out: ProxyRequest;
  readonly outBody: Record<string, unknown> & { messages: Msg[] };
}

/** A fresh pipeline over a (possibly shared) CCR directory, at the given level. */
function rig(ccrDir: string, level: CompressionLevel): Rig {
  const compression = new NativeLosslessCompression(new LocalDirBlobStore(ccrDir));
  const pipeline = createGolemPipeline({
    compression,
    policy: () => policyFor(level),
    projectId: "dust224",
  });
  return {
    compression,
    send: async (shape, turnLength) => {
      const body = { ...shape.envelope, messages: shape.messages.slice(0, turnLength) };
      const req: ProxyRequest = {
        method: "POST",
        url: "/v1/messages",
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify(body), "utf8"),
      };
      const out = await pipeline.process(req);
      const outBody = JSON.parse((out.body as Buffer).toString("utf8"));
      return { req, out, outBody };
    },
  };
}

const wire = (s: Sent): string => (s.out.body as Buffer).toString("utf8");
const LEVELS: readonly CompressionLevel[] = ["off", 1];

describe("level <= 1 recorded shapes: untouched when nothing applies", () => {
  for (const level of LEVELS) {
    for (const shape of recordedShapes().filter(
      (s) => s.secrets.length === 0 && (!s.hasDuplicates || level === "off"),
    )) {
      // The whitespace-noisy shape is compactable at level 1, so only level "off" is exempt there.
      if (level === 1 && shape.name.startsWith("whitespace-noisy")) continue;
      it(`level ${level}: "${shape.name}" is forwarded as the same request, byte for byte`, async () => {
        const r = rig(await newTempDir(), level);
        const sent = await r.send(shape, shape.messages.length);
        expect(sent.out).toBe(sent.req);
        expect(wire(sent)).toBe((sent.req.body as Buffer).toString("utf8"));
      });
    }
  }
});

describe("level 1 recorded shapes: lossless", () => {
  it("a repeated large tool_result becomes a CCR marker that retrieves the exact original", async () => {
    const shape = recordedShapes().find((s) => s.name.startsWith("tool loop"));
    if (shape === undefined) throw new Error("fixture missing");
    const r = rig(await newTempDir(), 1);
    const { outBody } = await r.send(shape, shape.messages.length);

    const inputs = shape.messages.map((m) => JSON.stringify(m));
    const outputs = outBody.messages.map((m) => JSON.stringify(m));
    const changed = outputs.flatMap((o, i) => (o !== inputs[i] ? [i] : []));
    // Exactly the second occurrence changed; the first stays in place.
    expect(changed).toEqual([6]);

    const marker = JSON.stringify(outBody.messages[6]);
    const refId = /hash=([0-9a-f]{64})/.exec(marker)?.[1];
    expect(refId).toBeDefined();
    const original = await r.compression.retrieve({
      refId: refId as string,
      contentType: "text/plain",
      originalTokens: 0,
    });
    const firstResult = (shape.messages[2]?.content as Msg[])[0]?.content;
    expect(original.content).toBe(firstResult);
  });

  it("expanding every marker reconstructs the original messages (compaction is whitespace-only)", async () => {
    for (const shape of recordedShapes().filter((s) => s.secrets.length === 0)) {
      const r = rig(await newTempDir(), 1);
      const { outBody } = await r.send(shape, shape.messages.length);
      let text = JSON.stringify(outBody.messages);
      for (const match of text.matchAll(
        /\[Golem: duplicate content elided[^\]]*hash=([0-9a-f]{64})\]/g,
      )) {
        const { content } = await r.compression.retrieve({
          refId: match[1] as string,
          contentType: "text/plain",
          originalTokens: 0,
        });
        text = text.replace(match[0], JSON.stringify(content).slice(1, -1));
      }
      // Compaction may only touch whitespace, so with it removed the two sides must agree.
      const squash = (s: string): string => s.replace(/(?:\\[rnt]|\s)+/g, "");
      expect(squash(text), shape.name).toBe(squash(JSON.stringify(shape.messages)));
    }
  });

  it("changes nothing outside `messages`: envelope fields keep value and key order", async () => {
    for (const shape of recordedShapes()) {
      const r = rig(await newTempDir(), 1);
      const { outBody } = await r.send(shape, shape.messages.length);
      const sentKeys = Object.keys({ ...shape.envelope, messages: 0 });
      expect(Object.keys(outBody), shape.name).toEqual(sentKeys);
      for (const key of Object.keys(shape.envelope)) {
        expect(outBody[key], `${shape.name}.${key}`).toEqual(shape.envelope[key]);
      }
    }
  });

  it("never forwards a raw secret, and never touches tool_use / thinking / image blocks", async () => {
    for (const shape of recordedShapes()) {
      const r = rig(await newTempDir(), 1);
      const sent = await r.send(shape, shape.messages.length);
      for (const secret of shape.secrets) expect(wire(sent), shape.name).not.toContain(secret);
      shape.messages.forEach((m, i) => {
        if (!Array.isArray(m.content)) return;
        (m.content as Msg[]).forEach((block, j) => {
          if (block.type === "tool_result" || block.type === "text") return;
          expect(
            (sent.outBody.messages[i]?.content as Msg[])[j],
            `${shape.name} ${i}.${j}`,
          ).toEqual(block);
        });
      });
    }
  });
});

describe("level <= 1 recorded shapes: prefix-stable across turns", () => {
  for (const level of LEVELS) {
    for (const shape of recordedShapes()) {
      it(`level ${level}: "${shape.name}" — every turn forwards the previous turn's messages as its prefix`, async () => {
        const r = rig(await newTempDir(), level);
        let previous: string[] = [];
        for (let n = 1; n <= shape.messages.length; n++) {
          const { outBody } = await r.send(shape, n);
          const current = outBody.messages.map((m) => JSON.stringify(m));
          expect(current.slice(0, previous.length), `turn ${n}`).toEqual(previous);
          previous = current;
        }
      });
    }
  }

  it("a fresh process reproduces the same bytes for the same history (no hidden mutable state)", async () => {
    for (const shape of recordedShapes()) {
      const ccr = await newTempDir();
      const a = await rig(ccr, 1).send(shape, shape.messages.length);
      const b = await rig(ccr, 1).send(shape, shape.messages.length);
      expect(wire(b), shape.name).toBe(wire(a));
    }
  });

  it("the serialised prefix is byte-stable, not just deep-equal", async () => {
    const shape = recordedShapes().find((s) => s.name.startsWith("secret in early"));
    if (shape === undefined) throw new Error("fixture missing");
    const r = rig(await newTempDir(), 1);
    const early = await r.send(shape, 5);
    const later = await r.send(shape, shape.messages.length);
    const head = JSON.stringify(early.outBody.messages).slice(0, -1);
    expect(JSON.stringify(later.outBody.messages).startsWith(head)).toBe(true);
  });
});

describe("redaction is idempotent (S10)", () => {
  // S10 (SUMMARY.md): `connection-password` used to re-match its own placeholder, so a
  // second pass renumbered it. Fixed in redaction-rules.ts (DUST3.3).
  it("S10: redacting redacted output is a no-op", () => {
    const pw = (seed: string): string => `pw${seed.repeat(16)}`;
    const conn = (user: string, seed: string): string =>
      `${[`postgres://${user}`, pw(seed)].join(":")}@h/db`;
    const first = (
      redactRequestBody({ t: `${conn("u", "k7")} ${conn("v", "m3")}` }).value as { t: string }
    ).t;
    // Reorder the two already-redacted URLs, as a resent or edited history can.
    const [a, b] = first.split(" ");
    const once = { t: `${b} ${a}` };
    const twice = redactRequestBody(once).value;
    expect(twice).toEqual(once);
  });
});
