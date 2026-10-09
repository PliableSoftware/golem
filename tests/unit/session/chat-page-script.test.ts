/**
 * The chat page's inline script, run in a minimal fake DOM: the paths for a
 * backpressure drop, seq dedup, a restarted bus (epoch) and a real shutdown.
 */

import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { renderChatPage } from "../../../src/session/chat-page.js";

type Listener = (m: { data: string }) => void;

class FakeEventSource {
  static all: FakeEventSource[] = [];
  closed = false;
  readonly listeners = new Map<string, Listener>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: Listener | null = null;
  readyState = 1;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(name: string, fn: Listener): void {
    this.listeners.set(name, fn);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(ev: Record<string, unknown>): void {
    this.listeners.get(String(ev.type))?.({ data: JSON.stringify(ev) });
  }
}

function fakeEl(): Record<string, unknown> {
  const el: Record<string, unknown> = {
    children: [] as unknown[],
    textContent: "",
    className: "",
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    classList: { add: () => undefined, remove: () => undefined },
    appendChild(c: unknown) {
      (el.children as unknown[]).push(c);
    },
    addEventListener: () => undefined,
  };
  return el;
}

function text(node: unknown): string {
  const n = node as { textContent: string; children: unknown[] };
  return n.textContent + n.children.map(text).join("");
}

async function boot(): Promise<{
  log: Record<string, unknown>;
  timers: Array<() => void>;
  rendered: () => string;
}> {
  FakeEventSource.all = [];
  const html = renderChatPage({ sessionId: "s1", projectDir: "/p", kind: "hosted" });
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
  const log = fakeEl();
  const elements = new Map<string, Record<string, unknown>>([["log", log]]);
  const timers: Array<() => void> = [];
  const ctx = {
    document: {
      getElementById: (id: string) => {
        let e = elements.get(id);
        if (e === undefined) {
          e = fakeEl();
          elements.set(id, e);
        }
        return e;
      },
      createElement: () => fakeEl(),
      addEventListener: () => undefined,
      body: fakeEl(),
      hidden: false,
    },
    window: { addEventListener: () => undefined },
    EventSource: FakeEventSource,
    fetch: () => Promise.resolve({ ok: false, json: () => ({ turns: [] }) }),
    setTimeout: (f: () => void) => {
      timers.push(f);
      return 0;
    },
    confirm: () => true,
    Date,
    Math,
    JSON,
  };
  vm.runInNewContext(script, ctx);
  await new Promise((r) => setImmediate(r)); // the history fetch resolves, then connect()
  return { log, timers, rendered: () => text(log) };
}

const attached = (epoch: string, resumedFrom = 0) => ({
  type: "attached",
  seq: 0,
  sessionId: "s1",
  epoch,
  resumedFrom,
  gap: false,
});

describe("chat page script", () => {
  it("a backpressure drop reconnects and does not say the session ended", async () => {
    const page = await boot();
    const es = FakeEventSource.all[0] as FakeEventSource;
    es.emit(attached("e1"));
    es.emit({ type: "text", seq: 1, text: "hello" });
    es.emit({ type: "ended", dropped: true, reason: "slow" });
    expect(page.rendered()).toContain("reconnecting");
    expect(page.rendered()).not.toContain("session ended");
    expect(es.closed).toBe(true);
    page.timers.forEach((f) => void f());
    expect(FakeEventSource.all).toHaveLength(2);
    expect(FakeEventSource.all[1]?.url).toContain("after=1");
  });

  it("skips an event whose seq it already rendered", async () => {
    const page = await boot();
    const es = FakeEventSource.all[0] as FakeEventSource;
    es.emit(attached("e1"));
    es.emit({ type: "text", seq: 1, text: "once" });
    es.emit({ type: "text", seq: 1, text: "once" });
    expect(page.rendered().match(/once/g)).toHaveLength(1);
  });

  it("a restarted bus (new epoch) resets the held seq and resumes from 0", async () => {
    const page = await boot();
    const es = FakeEventSource.all[0] as FakeEventSource;
    es.emit(attached("e1"));
    es.emit({ type: "text", seq: 7, text: "before" });
    // Reconnect lands on a new bus instance whose seq restarts at 1.
    es.emit(attached("e2", 7));
    expect(es.closed).toBe(true);
    const fresh = FakeEventSource.all[1] as FakeEventSource;
    expect(fresh.url).toContain("after=0");
    fresh.emit(attached("e2"));
    fresh.emit({ type: "text", seq: 1, text: "after restart" });
    expect(page.rendered()).toContain("after restart");
  });

  it("a real ended event says so and never reconnects", async () => {
    const page = await boot();
    const es = FakeEventSource.all[0] as FakeEventSource;
    es.emit(attached("e1"));
    es.emit({ type: "ended", seq: 2, reason: "host shutting down" });
    expect(page.rendered()).toContain("session ended");
    expect(es.closed).toBe(true);
    es.onerror?.();
    page.timers.forEach((f) => void f());
    expect(FakeEventSource.all).toHaveLength(1);
  });
});
