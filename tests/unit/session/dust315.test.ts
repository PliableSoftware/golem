/**
 * DUST3.15 — session transport, join-queue, host-log and conversation-store defects.
 * Each test failed on the code before its fix.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalConversationStore } from "../../../src/session/conversation-store.js";
import { appendHostLog, HOST_LOG_MAX_LINES, hostLogPath } from "../../../src/session/host-log.js";
import {
  resetLedgers,
  SessionBus,
  SUBSCRIBER_QUEUE_LIMIT,
  sessionTransportHandler,
  type TransportSession,
} from "../../../src/session/index.js";
import { FileJoinQueue } from "../../../src/session/join-queue.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-dust315-");

beforeEach(() => resetLedgers());

interface FakeRes {
  status?: number;
  body: string;
  chunks: string[];
  ended: boolean;
}

function fakeRes(writeOk: boolean): { res: ServerResponse; out: FakeRes } {
  const out: FakeRes = { body: "", chunks: [], ended: false };
  const res = {
    on: () => undefined,
    writeHead: (s: number) => {
      out.status = s;
    },
    write: (c: string) => {
      out.chunks.push(c);
      return writeOk;
    },
    end: (c?: string) => {
      if (c !== undefined) out.body += c;
      out.ended = true;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function fakeReq(url: string, method: string): IncomingMessage {
  return { url, method, headers: {}, on: () => undefined } as unknown as IncomingMessage;
}

describe("D5 — the slow-subscriber drop frame keeps the resume cursor", () => {
  it("does not advance Last-Event-ID past the last real event", async () => {
    const bus = new SessionBus("s1");
    const session: TransportSession = {
      bus,
      projectDir: "/nowhere",
      deliver: async () => undefined,
    };
    const handler = sessionTransportHandler({ lookup: () => session });
    const { res, out } = fakeRes(false);
    await handler({
      req: fakeReq("/session/s1/stream", "GET"),
      res,
      device: { id: "d" },
      body: "",
    });
    for (let i = 0; i < SUBSCRIBER_QUEUE_LIMIT + 5; i++) {
      bus.publish({ type: "heartbeat" } as never);
    }
    expect(out.ended).toBe(true);
    const parse = (c: string) => ({
      id: Number(/^id: (\d+)/.exec(c)?.[1]),
      type: /event: (\w+)/.exec(c)?.[1],
    });
    const frames = out.chunks.map(parse);
    const lastReal = Math.max(...frames.filter((f) => f.type === "heartbeat").map((f) => f.id));
    const ended = frames.find((f) => f.type === "ended");
    // A client resuming from the ended frame's id must not skip a real event.
    expect(ended?.id).toBeLessThanOrEqual(lastReal);
  });
});

describe("D8 — concurrent same-messageId delivery", () => {
  it("delivers a message once when the same id is POSTed concurrently", async () => {
    const dir = await newTempDir();
    const bus = new SessionBus("s2");
    let delivered = 0;
    const session: TransportSession = {
      bus,
      projectDir: dir,
      deliver: async () => {
        delivered += 1;
        await new Promise((r) => setTimeout(r, 20));
      },
    };
    const handler = sessionTransportHandler({ lookup: () => session });
    const post = async (): Promise<FakeRes> => {
      const { res, out } = fakeRes(true);
      await handler({
        req: fakeReq("/session/s2/message", "POST"),
        res,
        device: { id: "d" },
        body: JSON.stringify({ messageId: "m1", text: "hello" }),
      });
      return out;
    };
    const [a, b] = await Promise.all([post(), post()]);
    expect(delivered).toBe(1);
    const statuses = [a, b].map((o) => (JSON.parse(o.body) as { status: string }).status).sort();
    expect(statuses).toEqual(["delivered", "duplicate"]);
  });

  it("FileJoinQueue queues one message when the same id is enqueued concurrently", async () => {
    const dir = await newTempDir();
    const q = new FileJoinQueue({ projectDir: dir, resolve: async () => ({ ok: true }) });
    const input = {
      conversationId: "a1b2c3d4e5f60718",
      deviceId: "d",
      messageId: "m1",
      text: "hello",
    };
    const tick = 1_000;
    const results = await Promise.all([q.enqueue(input), q.enqueue(input)]);
    void tick;
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "queued"]);
    expect(await q.pending(input.conversationId)).toHaveLength(1);
  });
});

describe("host log is bounded", () => {
  it("trims past HOST_LOG_MAX_LINES when appending", async () => {
    const dir = await newTempDir();
    const file = hostLogPath(dir);
    await mkdir(path.dirname(file), { recursive: true });
    const line = JSON.stringify({ kind: "turn", ts: "t", sessionId: "s", origin: "o", text: "x" });
    await writeFile(
      file,
      `${Array.from({ length: HOST_LOG_MAX_LINES + 50 }, () => line).join("\n")}\n`,
    );
    await appendHostLog(dir, {
      kind: "turn",
      ts: "t",
      sessionId: "s",
      origin: "o",
      text: "last",
    });
    const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeLessThanOrEqual(HOST_LOG_MAX_LINES);
    expect(lines.at(-1)).toContain("last");
  });
});

describe("conversation store forget rejects a path-escaping id", () => {
  it("does not delete a file outside the store directory", async () => {
    const root = await newTempDir();
    const storeDir = path.join(root, "store");
    await mkdir(storeDir, { recursive: true });
    const victim = path.join(root, "victim.json");
    await writeFile(victim, "{}");
    const store = new LocalConversationStore(storeDir);
    expect(await store.forget("../victim")).toBe(false);
    await expect(readFile(victim, "utf8")).resolves.toBe("{}");
  });
});
