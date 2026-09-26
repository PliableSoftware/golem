/**
 * R13.8 — start and continue a conversation FROM THE DEVICE.
 *
 * Same discipline as `hosted-session.test.ts`: a small node script speaks the
 * real stream-json protocol on stdout/stdin, so the spawn, the argument
 * array, the event mapping onto `SessionBus`, and the store writes are all
 * exercised for real. It is not the `claude` binary — see that file's header
 * for why not.
 *
 * Covers the task's "Gate detail":
 *   - start a conversation in a temp project root, observed live
 *   - stop the process and resume the same conversation — the restarted
 *     agent's context comes from the conversation store, which accumulates
 *     across the restart
 *   - scrollback paging returns turns in order, no gaps or duplicates
 *   - each refusal names what it looked for
 */

import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GolemSettings } from "../../src/config/schema.js";
import type { SessionEvent } from "../../src/interfaces/session-events.js";
import {
  conversationIdFor,
  createDeviceSessionsHandler,
  LocalConversationStore,
  START_CONVERSATION_PATH,
} from "../../src/session/index.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-device-sessions-");

/**
 * A stand-in runner, same shape as `hosted-session.test.ts`'s `FAKE_RUNNER`
 * (an ack, a tool call/result, a result event per turn) plus one addition:
 * a message containing the marker `EXIT_AFTER_THIS` makes the process exit
 * right after answering, so a test can model "the runner process ended" —
 * the case item 3 (resume) has to cover — without a timing race.
 */
const FAKE_RUNNER = `
let buf = "";
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
emit({ type: "system", subtype: "init", session_id: "runner-sess-1" });
process.stdin.on("data", (c) => {
  buf += c.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    const text = msg.message.content;
    emit({ type: "assistant", session_id: "runner-sess-1", message: { content: [
      { type: "text", text: "ack: " + text },
    ] } });
    emit({ type: "result", subtype: "success", session_id: "runner-sess-1", is_error: false, num_turns: 1 });
    if (String(text).includes("EXIT_AFTER_THIS")) process.exit(0);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

async function writeFakeRunner(dir: string): Promise<string> {
  const file = path.join(dir, "fake-runner.mjs");
  await writeFile(file, FAKE_RUNNER, "utf8");
  return file;
}

function fakeRequest(
  method: string,
  body: string,
): {
  req: IncomingMessage;
  res: ServerResponse;
  body: string;
  result: Promise<{ status: number; json: unknown }>;
} {
  let resolve!: (v: { status: number; json: unknown }) => void;
  const result = new Promise<{ status: number; json: unknown }>((r) => {
    resolve = r;
  });
  let status = 0;
  let chunks = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(data?: string) {
      chunks += data ?? "";
      resolve({ status, json: chunks.trim() === "" ? undefined : JSON.parse(chunks) });
    },
  } as unknown as ServerResponse;
  const req = { method } as unknown as IncomingMessage;
  return { req, res, body, result };
}

function securityFixture(
  originationRoots: readonly string[] = [],
): Pick<GolemSettings, "security"> {
  return {
    security: {
      write_port: 4655,
      write_lan: false,
      unlock_window_minutes: 15,
      idle_relock_minutes: 5,
      step_up_max_age_minutes: 2,
      device_cert_days: 365,
      join_injection: false,
      origination_roots: [...originationRoots],
    },
  };
}

async function wireProject(dir: string): Promise<void> {
  await mkdir(path.join(dir, ".golem"), { recursive: true });
  await writeFile(path.join(dir, ".golem", "settings.json"), "{}\n", "utf8");
  await mkdir(path.join(dir, ".claude"), { recursive: true });
}

/** Collect bus events until a predicate matches, then resolve with all of them. */
function collectUntil(
  bus: {
    subscribe: (
      sub: { send: (e: SessionEvent) => boolean; close: (r: string) => void },
      after?: number,
    ) => { detach: () => void };
  },
  match: (e: SessionEvent) => boolean,
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  return new Promise((resolve) => {
    const { detach } = bus.subscribe({
      send: (e) => {
        events.push(e);
        if (match(e)) {
          detach();
          resolve(events);
        }
        return true;
      },
      close: () => {},
    });
  });
}

/**
 * The store-append after a `turn_end`/`ended` bus event is deliberately
 * fire-and-forget (`wireHostedSession` publishes first, writes second), and a
 * registry update on exit is the same shape — so a test observing the BUS
 * event is not yet guaranteed the disk write landed. Poll rather than assume.
 */
async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("createDeviceSessionsHandler", () => {
  let projectDir: string;
  let handler: ReturnType<typeof createDeviceSessionsHandler>;

  afterEach(() => {
    handler?.shutdown("test cleanup");
  });

  async function setUp(originationRoots: readonly string[] = []): Promise<string> {
    projectDir = await newTempDir();
    await wireProject(projectDir);
    const runner = await writeFakeRunner(projectDir);
    handler = createDeviceSessionsHandler({
      projectDir,
      proxyBaseUrl: "http://localhost:4653",
      settings: securityFixture(originationRoots),
      serverUrl: { value: "https://localhost:4655/" },
      runnerBin: process.execPath,
      runnerArgsOverride: [runner],
    });
    return runner;
  }

  it("starts a conversation in a temp project root, observed live", async () => {
    await setUp();
    const request = fakeRequest("POST", JSON.stringify({ message: "hello there" }));
    const started = handler.handleApi(request, new URL(`http://x${START_CONVERSATION_PATH}`));

    const { status, json } = await request.result;
    expect(status).toBe(201);
    const id = (json as { id: string }).id;
    expect(id).toBe(conversationIdFor({ messages: [{ role: "user", content: "hello there" }] }));
    await started;

    const session = handler.lookup(id);
    expect(session).not.toBeNull();
    if (session === null) throw new Error("unreachable — asserted above");
    const events = await collectUntil(session.bus, (e) => e.type === "turn_end");
    expect(events.map((e) => e.type)).toStrictEqual(["text", "turn_end"]);
    expect((events[0] as { text: string }).text).toContain("hello there");

    // Invariant 4 + the assistant fold: both sides land in the store.
    const store = LocalConversationStore.forProjectDir(projectDir);
    const record = await waitFor(async () => {
      const r = await store.readConversation(id);
      return r !== null && r.turns.length >= 2 ? r : undefined;
    });
    expect(record.turns.map((t) => t.role)).toStrictEqual(["user", "assistant"]);
    expect(record.turns[0]?.content).toBe("hello there");
  });

  it("refuses a duplicate first message while the original is still live", async () => {
    await setUp();
    const first = fakeRequest("POST", JSON.stringify({ message: "same text" }));
    await handler.handleApi(first, new URL(`http://x${START_CONVERSATION_PATH}`));
    await first.result;

    const second = fakeRequest("POST", JSON.stringify({ message: "same text" }));
    await handler.handleApi(second, new URL(`http://x${START_CONVERSATION_PATH}`));
    const { status, json } = await second.result;
    expect(status).toBe(409);
    expect((json as { error: string }).error).toContain("already exists");
  });

  it("refuses an empty message, naming what is required", async () => {
    await setUp();
    const request = fakeRequest("POST", JSON.stringify({ message: "" }));
    await handler.handleApi(request, new URL(`http://x${START_CONVERSATION_PATH}`));
    const { status, json } = await request.result;
    expect(status).toBe(400);
    expect((json as { error: string }).error).toContain("`message` is required");
  });

  it("refuses origination outside security.origination_roots, naming the root", async () => {
    await setUp(["/only/this/root"]);
    const request = fakeRequest(
      "POST",
      JSON.stringify({ message: "hi", root: path.join(projectDir, "elsewhere") }),
    );
    await handler.handleApi(request, new URL(`http://x${START_CONVERSATION_PATH}`));
    const { status, json } = await request.result;
    expect(status).toBe(403);
    expect((json as { error: string }).error).toContain("origination_roots");
  });

  it("refuses scrollback for an unknown conversation, naming the id", async () => {
    await setUp();
    const request = fakeRequest("GET", "");
    await handler.handleApi(request, new URL("http://x/api/conversations/does-not-exist/messages"));
    const { status, json } = await request.result;
    expect(status).toBe(404);
    expect((json as { error: string }).error).toContain("does-not-exist");
  });

  it("refuses to resume a conversation nobody has ever recorded, naming the id", async () => {
    await setUp();
    const request = fakeRequest("GET", "");
    await handler.handleApi(request, new URL("http://x/api/conversations/never-existed"));
    const { status, json } = await request.result;
    expect(status).toBe(404);
    expect((json as { error: string }).error).toContain("never-existed");
  });

  it("scrollback pages turns in order, with no gaps or duplicates", async () => {
    await setUp();
    const first = fakeRequest("POST", JSON.stringify({ message: "turn one" }));
    await handler.handleApi(first, new URL(`http://x${START_CONVERSATION_PATH}`));
    const { json: startJson } = await first.result;
    const id = (startJson as { id: string }).id;

    const store = LocalConversationStore.forProjectDir(projectDir);
    const session = handler.lookup(id);
    if (session === null) throw new Error("expected the just-started conversation to be live");
    await collectUntil(session.bus, (e) => e.type === "turn_end");
    // Wait for the fire-and-forget assistant append (turn one) to land before
    // sending the next turn — two concurrent `appendTurn` calls on the same
    // conversation is a read-modify-write race this store does not guard
    // against, and a real device waits for a reply before sending the next
    // message anyway.
    await waitFor(async () => {
      const r = await store.readConversation(id);
      return r !== null && r.turns.length >= 2 ? r : undefined;
    });
    await session.deliver("turn two");
    await collectUntil(session.bus, (e) => e.type === "turn_end" && e.seq > 2);
    await waitFor(async () => {
      const r = await store.readConversation(id);
      return r !== null && r.turns.length >= 4 ? r : undefined;
    });

    const page = fakeRequest("GET", "");
    await handler.handleApi(page, new URL(`http://x/api/conversations/${id}/messages?limit=10`));
    const { status, json } = await page.result;
    expect(status).toBe(200);
    const { turns, hasMore } = json as {
      turns: { role: string; content: unknown; timestamp: string }[];
      hasMore: boolean;
    };
    expect(turns.map((t) => t.role)).toStrictEqual(["user", "assistant", "user", "assistant"]);
    expect(turns.map((t) => t.content)).toStrictEqual([
      "turn one",
      "ack: turn one",
      "turn two",
      "ack: turn two",
    ]);
    // No gaps/duplicates: timestamps non-decreasing (already-checked content
    // above pins exact order and rules out a dropped or repeated turn).
    const timestamps = turns.map((t) => t.timestamp);
    expect([...timestamps].sort()).toStrictEqual(timestamps);
    expect(hasMore).toBe(false);

    const firstPage = fakeRequest("GET", "");
    await handler.handleApi(
      firstPage,
      new URL(`http://x/api/conversations/${id}/messages?limit=2`),
    );
    const { json: pagedJson } = await firstPage.result;
    const paged = pagedJson as { turns: { role: string }[]; hasMore: boolean };
    expect(paged.turns).toHaveLength(2);
    expect(paged.hasMore).toBe(true);
  });

  it("resumes after the runner process exits, and the restart sees earlier turns as context", async () => {
    await setUp();
    const first = fakeRequest(
      "POST",
      JSON.stringify({ message: "remember this, then EXIT_AFTER_THIS" }),
    );
    await handler.handleApi(first, new URL(`http://x${START_CONVERSATION_PATH}`));
    const { json: startJson } = await first.result;
    const id = (startJson as { id: string }).id;

    const session = handler.lookup(id);
    if (session === null) throw new Error("expected the just-started conversation to be live");
    await collectUntil(session.bus, (e) => e.type === "ended");
    expect(handler.lookup(id)).toBeNull();

    // The registry update on exit is fire-and-forget too (same shape as the
    // store append above) — wait for `stoppedAt`/`runnerSessionId` to land
    // before asking to resume, or the still-"running" record legitimately
    // refuses (this is exactly the 409 the next describe block tests for a
    // DIFFERENT case — a stale write here would conflate the two).
    const { findHostSession } = await import("../../src/session/index.js");
    await waitFor(async () => {
      const rec = await findHostSession(projectDir, id);
      return rec?.stoppedAt !== undefined && rec.runnerSessionId !== undefined ? rec : undefined;
    });

    const resume = fakeRequest("GET", "");
    await handler.handleApi(resume, new URL(`http://x/api/conversations/${id}`));
    const { status, json } = await resume.result;
    expect(status).toBe(200);
    expect((json as { status: string }).status).toBe("restarted");

    const resumed = handler.lookup(id);
    expect(resumed).not.toBeNull();
    if (resumed === null) throw new Error("expected resume to bring the conversation back live");
    await resumed.deliver("a follow-up after restart");
    await collectUntil(resumed.bus, (e) => e.type === "turn_end");

    // The restarted process's own turn is a fresh SessionBus (seq resets), but
    // the CONVERSATION STORE is what carries context across the restart, and it
    // must hold every turn from both processes, in order.
    const history = await waitFor(async () => {
      const h = (await resumed.history?.()) ?? [];
      return h.length >= 4 ? h : undefined;
    });
    expect(history.map((t) => t.role)).toStrictEqual(["user", "assistant", "user", "assistant"]);
    expect(history[0]?.content).toContain("remember this");
    expect(history[2]?.content).toBe("a follow-up after restart");
  });

  it("refuses to resume a conversation with no recorded runner session id", async () => {
    await setUp();
    const store = LocalConversationStore.forProjectDir(projectDir);
    const id = conversationIdFor({ messages: [{ role: "user", content: "orphan" }] });
    await store.appendTurn(id, {
      role: "user",
      content: "orphan",
      timestamp: new Date().toISOString(),
    });
    const { registerHostSession } = await import("../../src/session/index.js");
    await registerHostSession(projectDir, {
      id,
      projectDir,
      startedAt: new Date().toISOString(),
      pid: 2_147_483_646,
      stoppedAt: new Date().toISOString(),
    });

    const request = fakeRequest("GET", "");
    await handler.handleApi(request, new URL(`http://x/api/conversations/${id}`));
    const { status, json } = await request.result;
    expect(status).toBe(409);
    expect((json as { error: string }).error).toContain("no recorded runner session id");
  });

  it("lists the project itself via GET /api/projects, reachable and originable", async () => {
    await setUp();
    const request = fakeRequest("GET", "");
    await handler.handleApi(request, new URL("http://x/api/projects"));
    const { status, json } = await request.result;
    expect(status).toBe(200);
    const { projects } = json as {
      projects: { root: string; reachability: { status: string }; canOriginate: boolean }[];
    };
    const self = projects.find((p) => p.root === path.resolve(projectDir));
    expect(self?.reachability).toStrictEqual({ status: "ok" });
    expect(self?.canOriginate).toBe(true);
  });
});
