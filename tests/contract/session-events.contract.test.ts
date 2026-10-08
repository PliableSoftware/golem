/**
 * Contract suite for the frozen SessionEvent* shapes (src/interfaces/session-events.ts,
 * DUST2.24, SUMMARY r108): seq is host-stamped, strictly monotonic and gapless;
 * a resume cursor replays exactly the missed tail and reports a gap honestly;
 * the stream wire form carries the seq as the SSE cursor; a repeated messageId
 * is idempotent. The traced implementation is SessionBus + MessageLedger.
 */

import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../src/interfaces/session-events.js";
import { MessageLedger, SessionBus, sseFrame } from "../../src/session/index.js";

/** Distributive: a plain Omit over the union collapses it to the shared keys. */
type Unstamped = SessionEvent extends infer E
  ? E extends SessionEvent
    ? Omit<E, "seq">
    : never
  : never;

/** One of every variant, so the union is exercised end to end. */
const ONE_OF_EACH: readonly Unstamped[] = [
  { type: "attached", sessionId: "s", resumedFrom: 0, gap: false },
  { type: "text", text: "hi" },
  { type: "tool_call", id: "t1", name: "Read", input: { path: "x" } },
  { type: "tool_result", toolCallId: "t1", isError: false, content: "ok" },
  { type: "refused", tool: "Bash", message: "no", by: "host" },
  { type: "turn_end" },
  { type: "parked", detail: "limit" },
  { type: "ended", reason: "done" },
];

function collect(): {
  got: SessionEvent[];
  sub: { send: (e: SessionEvent) => boolean; close: (r: string) => void };
} {
  const got: SessionEvent[] = [];
  return {
    got,
    sub: {
      send: (e) => {
        got.push(e);
        return true;
      },
      close: () => {},
    },
  };
}

describe("SessionEvent contract: seq", () => {
  it("stamps a gapless 1..n seq across every variant, in publish order", () => {
    const bus = new SessionBus("s");
    const out = ONE_OF_EACH.map((e) => bus.publish(e));
    expect(out.map((e) => e.seq)).toEqual(ONE_OF_EACH.map((_, i) => i + 1));
    expect(out.map((e) => e.type)).toEqual(ONE_OF_EACH.map((e) => e.type));
  });

  it("overrides a caller-supplied seq: a caller cannot choose its own", () => {
    const bus = new SessionBus("s");
    const forged = { type: "text", text: "x", seq: 999 } as unknown as Unstamped;
    expect(bus.publish(forged).seq).toBe(1);
  });

  it("subscribers observe the same seq the publisher got, in order", () => {
    const bus = new SessionBus("s");
    const { got, sub } = collect();
    bus.subscribe(sub);
    const published = ONE_OF_EACH.map((e) => bus.publish(e));
    expect(got.map((e) => e.seq)).toEqual(published.map((e) => e.seq));
  });
});

describe("SessionEvent contract: resume cursor", () => {
  it("replays exactly the events after the cursor, with no gap", () => {
    const bus = new SessionBus("s");
    for (let i = 0; i < 5; i++) bus.publish({ type: "text", text: `${i}` });
    const { replay, gap } = bus.subscribe(collect().sub, 3);
    expect(replay.map((e) => e.seq)).toEqual([4, 5]);
    expect(gap).toBe(false);
  });

  it("a cursor at the head replays nothing; a fresh attach (0) replays the whole ring", () => {
    const bus = new SessionBus("s");
    for (let i = 0; i < 3; i++) bus.publish({ type: "text", text: `${i}` });
    expect(bus.subscribe(collect().sub, 3).replay).toEqual([]);
    expect(bus.subscribe(collect().sub, 0).replay).toHaveLength(3);
  });

  it("reports a gap when the cursor has fallen out of the bounded ring, and replays what survives", () => {
    const bus = new SessionBus("s", 3);
    for (let i = 0; i < 6; i++) bus.publish({ type: "text", text: `${i}` });
    const { replay, gap } = bus.subscribe(collect().sub, 1);
    expect(gap).toBe(true);
    expect(replay.map((e) => e.seq)).toEqual([4, 5, 6]);
    // The survivors are contiguous: a gap is declared, never papered over.
    expect(bus.subscribe(collect().sub, 3).gap).toBe(false);
  });

  it("detach stops delivery", () => {
    const bus = new SessionBus("s");
    const { got, sub } = collect();
    bus.subscribe(sub).detach();
    bus.publish({ type: "text", text: "after" });
    expect(got).toEqual([]);
  });

  it("remembers that the session ended so a late attach can be told at once", () => {
    const bus = new SessionBus("s");
    expect(bus.endedEvent).toBeUndefined();
    bus.publish({ type: "ended", reason: "done" });
    expect(bus.endedEvent?.type).toBe("ended");
  });
});

describe("SessionEvent contract: wire form", () => {
  it("each SSE frame carries seq as the cursor id and the event as JSON data", () => {
    const bus = new SessionBus("s");
    for (const e of ONE_OF_EACH) {
      const stamped = bus.publish(e);
      const frame = sseFrame(stamped);
      expect(frame).toBe(
        `id: ${stamped.seq}\nevent: ${stamped.type}\ndata: ${JSON.stringify(stamped)}\n\n`,
      );
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      expect(JSON.parse((data ?? "").slice(6))).toEqual(stamped);
    }
  });
});

describe("SessionMessage contract: idempotent by messageId", () => {
  it("a repeated id resolves to the original seq, never a new one", () => {
    const ledger = new MessageLedger();
    expect(ledger.lookup("m1")).toBeUndefined();
    ledger.record("m1", 7);
    expect(ledger.lookup("m1")).toBe(7);
    expect(ledger.lookup("m2")).toBeUndefined();
  });

  it("is a bounded retry window: the oldest id is forgotten first", () => {
    const ledger = new MessageLedger(2);
    ledger.record("a", 1);
    ledger.record("b", 2);
    ledger.record("c", 3);
    expect(ledger.size).toBe(2);
    expect(ledger.lookup("a")).toBeUndefined();
    expect(ledger.lookup("c")).toBe(3);
  });
});
