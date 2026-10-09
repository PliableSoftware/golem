/**
 * DUST3.15 (2026-10-09, USER decision DROP) — the synthetic frame sent to a
 * subscriber dropped for backpressure carries no seq and no SSE `id:`.
 *
 * Before: it was stamped `bus.cursor + 1`, the id of the NEXT real event, so a
 * client that stored it as `Last-Event-ID` resumed past an event it never saw.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetLedgers,
  SessionBus,
  SUBSCRIBER_QUEUE_LIMIT,
  sseFrame,
  type TransportSession,
} from "../../../src/session/index.js";
import { handleStream } from "../../../src/session/transport.js";

beforeEach(() => resetLedgers());

function connect(
  session: TransportSession,
  opts: { writeOk: boolean; lastEventId?: string },
): { chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    on: () => undefined,
    writeHead: () => undefined,
    write: (c: string) => {
      chunks.push(c);
      return opts.writeOk;
    },
    end: () => undefined,
  } as unknown as ServerResponse;
  const headers: Record<string, string> =
    opts.lastEventId === undefined ? {} : { "last-event-id": opts.lastEventId };
  const req = { url: "/session/s/stream", method: "GET", headers, on: () => undefined };
  handleStream(
    session,
    req as unknown as IncomingMessage,
    res,
    new URL("http://x/session/s/stream"),
    { heartbeatMs: 3_600_000 },
  );
  return { chunks };
}

/** What an EventSource would do: remember the last `id:` it saw. */
function lastEventId(chunks: readonly string[]): string | undefined {
  let id: string | undefined;
  for (const c of chunks) {
    const m = /^id: (.*)$/m.exec(c);
    if (m !== null) id = m[1];
  }
  return id;
}

function frameSeqs(chunks: readonly string[]): number[] {
  return chunks
    .filter((c) => c.includes("\nevent: text\n"))
    .map((c) => Number(/^id: (\d+)$/m.exec(c)?.[1]));
}

describe("backpressure drop frame", () => {
  it("has no `id:` line and no seq in its data", () => {
    const bus = new SessionBus("s", 10_000);
    const session: TransportSession = { bus, projectDir: "/nowhere", deliver: async () => {} };
    const { chunks } = connect(session, { writeOk: false });
    for (let i = 0; i <= SUBSCRIBER_QUEUE_LIMIT + 1; i += 1)
      bus.publish({ type: "text", text: "t" });

    const drop = chunks.find((c) => c.includes('"dropped":true'));
    expect(drop).toBeDefined();
    expect(drop).not.toMatch(/^id:/m);
    const data = JSON.parse(/^data: (.*)$/m.exec(drop ?? "")?.[1] ?? "{}") as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({ type: "ended", dropped: true });
    expect("seq" in data).toBe(false);
  });

  it("a resume after the drop loses nothing and repeats no event id", () => {
    const bus = new SessionBus("s", 10_000);
    const session: TransportSession = { bus, projectDir: "/nowhere", deliver: async () => {} };
    const first = connect(session, { writeOk: false });
    const total = SUBSCRIBER_QUEUE_LIMIT + 5;
    for (let i = 0; i < total; i += 1) bus.publish({ type: "text", text: `t${i}` });

    const resumeFrom = lastEventId(first.chunks);
    // The cursor the client holds is a real seq it received, never the drop frame's.
    const received = frameSeqs(first.chunks);
    expect(resumeFrom).toBe(String(received[received.length - 1]));

    const second = connect(session, { writeOk: true, lastEventId: resumeFrom });
    const all = [...received, ...frameSeqs(second.chunks)];
    expect(all).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it("sseFrame still stamps id: for a real event", () => {
    expect(sseFrame({ type: "text", seq: 7, text: "x" }).startsWith("id: 7\n")).toBe(true);
  });
});
