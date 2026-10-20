/**
 * DUST2.19 — a device can interrupt a running hosted turn (it resolves
 * cancelled), and a turn a device authored is marked for the local operator.
 */

import { mkdir, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GolemSettings } from "../../src/config/schema.js";
import type { SessionEvent } from "../../src/interfaces/session-events.js";
import {
  createDeviceSessionsHandler,
  isRemoteOrigin,
  readHostLog,
  resetLedgers,
  SessionBus,
  START_CONVERSATION_PATH,
} from "../../src/session/index.js";
import { handleMessage } from "../../src/session/transport.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-interrupt-");

/** Answers every turn EXCEPT one containing HANG, which it never finishes. */
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
    const text = JSON.parse(line).message.content;
    if (String(text).includes("HANG")) { emit({ type: "assistant", message: { content: [{ type: "text", text: "working..." }] } }); continue; }
    emit({ type: "assistant", message: { content: [{ type: "text", text: "ack: " + text }] } });
    emit({ type: "result", subtype: "success", is_error: false, num_turns: 1 });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

const settings: Pick<GolemSettings, "security"> = {
  security: {
    write_port: 4655,
    write_lan: false,
    unlock_window_minutes: 15,
    idle_relock_minutes: 5,
    step_up_max_age_minutes: 2,
    device_cert_days: 365,
    join_injection: false,
    origination_roots: [],
  },
};

function collectUntil(
  bus: SessionBus,
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

function fakeRes(): { res: ServerResponse; done: Promise<{ status: number; json: unknown }> } {
  let resolve!: (v: { status: number; json: unknown }) => void;
  const done = new Promise<{ status: number; json: unknown }>((r) => {
    resolve = r;
  });
  let status = 0;
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(data?: string) {
      resolve({ status, json: data === undefined ? undefined : JSON.parse(data) });
    },
  } as unknown as ServerResponse;
  return { res, done };
}

describe("interrupting a hosted turn from a device", () => {
  let handler: ReturnType<typeof createDeviceSessionsHandler>;
  afterEach(() => handler?.shutdown("test cleanup"));

  async function startHanging(): Promise<{ id: string; dir: string }> {
    const dir = await newTempDir();
    await mkdir(path.join(dir, ".golem"), { recursive: true });
    await writeFile(path.join(dir, ".golem", "settings.json"), "{}\n", "utf8");
    const runner = path.join(dir, "fake-runner.mjs");
    await writeFile(runner, FAKE_RUNNER, "utf8");
    handler = createDeviceSessionsHandler({
      projectDir: dir,
      proxyBaseUrl: "http://localhost:4653",
      settings,
      serverUrl: { value: "https://localhost:4655/" },
      runnerBin: process.execPath,
      runnerArgsOverride: [runner],
    });
    const { res, done } = fakeRes();
    await handler.handleApi(
      {
        req: { method: "POST" } as never,
        res,
        body: JSON.stringify({ message: "please HANG" }),
      },
      new URL(`http://x${START_CONVERSATION_PATH}`),
    );
    const { json } = await done;
    return { id: (json as { id: string }).id, dir };
  }

  it("resolves the running turn as cancelled, then ends the session and says why", async () => {
    const { id, dir } = await startHanging();
    const session = handler.lookup(id);
    if (session === null || session.interrupt === undefined) {
      throw new Error("a hosted session must expose interrupt");
    }
    // The turn is mid-flight once the runner has started answering it.
    await collectUntil(session.bus, (e) => e.type === "text");
    const after = collectUntil(session.bus, (e) => e.type === "ended");
    session.interrupt();
    const events = await after;

    const end = events.find((e) => e.type === "turn_end");
    expect(end).toMatchObject({ type: "turn_end", cancelled: true });
    const ended = events.at(-1);
    expect(ended).toMatchObject({ type: "ended" });
    expect((ended as { reason: string }).reason).toContain("interrupted from a device");

    const log = await readHostLog(dir);
    expect(
      log.some(
        (e) => e.kind === "lifecycle" && e.event === "stopped" && e.detail?.includes("device"),
      ),
    ).toBe(true);
  });

  it("a normal turn end is not marked cancelled", async () => {
    const dir = await newTempDir();
    await mkdir(path.join(dir, ".golem"), { recursive: true });
    await writeFile(path.join(dir, ".golem", "settings.json"), "{}\n", "utf8");
    const runner = path.join(dir, "fake-runner.mjs");
    await writeFile(runner, FAKE_RUNNER, "utf8");
    handler = createDeviceSessionsHandler({
      projectDir: dir,
      proxyBaseUrl: "http://localhost:4653",
      settings,
      serverUrl: { value: "https://localhost:4655/" },
      runnerBin: process.execPath,
      runnerArgsOverride: [runner],
    });
    const { res, done } = fakeRes();
    await handler.handleApi(
      { req: { method: "POST" } as never, res, body: JSON.stringify({ message: "hi" }) },
      new URL(`http://x${START_CONVERSATION_PATH}`),
    );
    const id = ((await done).json as { id: string }).id;
    const session = handler.lookup(id);
    if (session === null) throw new Error("no session");
    const events = await collectUntil(session.bus, (e) => e.type === "turn_end");
    expect(events.at(-1)).not.toHaveProperty("cancelled");
  });
});

describe("remote-authored turns are marked locally", () => {
  it("treats everything but local as remote", () => {
    expect(isRemoteOrigin("local")).toBe(false);
    expect(isRemoteOrigin("device")).toBe(true);
    expect(isRemoteOrigin("phone-3f2a")).toBe(true);
  });

  it("calls onRemoteTurn for a device turn, after attribution, and not for a local one", async () => {
    resetLedgers();
    const dir = await newTempDir();
    const bus = new SessionBus("sess-r");
    const seen: { origin: string; text: string }[] = [];
    const session = { bus, projectDir: dir, deliver: async () => {} };
    const options = {
      lookup: () => session,
      onRemoteTurn: (t: { origin: string; text: string }) => seen.push(t),
    };

    const a = fakeRes();
    await handleMessage(
      session,
      a.res,
      JSON.stringify({ messageId: "m1", text: "from phone" }),
      "phone-1",
      options,
    );
    expect((await a.done).status).toBe(200);
    expect(seen).toStrictEqual([{ sessionId: "sess-r", origin: "phone-1", text: "from phone" }]);

    const b = fakeRes();
    await handleMessage(
      session,
      b.res,
      JSON.stringify({ messageId: "m2", text: "typed here" }),
      "local",
      options,
    );
    await b.done;
    expect(seen).toHaveLength(1);

    const log = await readHostLog(dir);
    expect(log.find((e) => e.kind === "turn" && e.origin === "phone-1")).toBeDefined();
  });
});
