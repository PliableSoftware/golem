/**
 * DUSTSEC.23 — through the real proxy: a large many-small-strings body is redacted
 * without freezing the event loop, a client that hangs up mid-walk forwards nothing
 * and frees its reservation, and the error path re-walks with the sliced redaction.
 *
 * Secret-shaped values are assembled at runtime so no literal sits in the source.
 */

import { connect } from "node:net";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { NativeLosslessCompression } from "../../src/compression/index.js";
import { policyFor } from "../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../src/pipeline/index.js";
import type {
  PipelineRunOptions,
  ProxyRequest,
  ProxyRequestOutcome,
  RequestPipeline,
} from "../../src/proxy/types.js";
import { useTempDirs } from "../helpers/tmp.js";
import { rawRequest, startProxy, startUpstream } from "./helpers/test-servers.js";

const SECRET = `AKIA${"IOSFODNN7"}${"EXAMPLE"}`;
const PLACEHOLDER = ["[", "RED", "ACTED:aws-key:1]"].join("");
const newTempDir = useTempDirs("golem-dustsec23-");

function bigBody(targetBytes: number): string {
  const messages: { role: string; content: string }[] = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i += 1) {
    const content = i === 3 ? `my key is ${SECRET}` : `alpha beta item-${i} gamma delta`;
    messages.push({ role: "user", content });
    size += content.length + 32;
  }
  return JSON.stringify({ model: "claude-x", messages });
}

async function realPipeline(): Promise<RequestPipeline> {
  const dir = await newTempDir();
  return createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(dir),
    policy: () => policyFor(1),
    projectId: dir,
  });
}

function upstreamRecorder() {
  const seen = { hits: 0, bodies: [] as string[] };
  const handler = (_req: unknown, res: import("node:http").ServerResponse, body: Buffer): void => {
    seen.hits += 1;
    seen.bodies.push(body.toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  };
  return { seen, handler };
}

describe("DUSTSEC.23 through the proxy", () => {
  it("redacts a large many-small-strings body while another session's timer keeps ticking", async () => {
    const up = upstreamRecorder();
    const upstream = await startUpstream(up.handler);
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: await realPipeline(),
    });
    try {
      const body = bigBody(6 * 1024 * 1024);
      let last = performance.now();
      let max = 0;
      let observed = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        max = Math.max(max, now - last);
        last = now;
        observed += 1;
      }, 5);
      const res = await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      clearInterval(timer);
      expect(res.status).toBe(200);
      expect(up.seen.hits).toBe(1);
      expect(up.seen.bodies[0]).not.toContain(SECRET);
      expect(up.seen.bodies[0]).toContain(PLACEHOLDER);
      // Many ticks landed while the walk ran, and none was starved for long: the
      // sync walk of this body held the loop for about two seconds.
      expect(observed).toBeGreaterThan(20);
      expect(max).toBeLessThan(500);
      await vi.waitFor(() => expect(proxy.proxy.bodyBytesInFlight).toBe(0), { timeout: 2_000 });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  }, 60_000);

  it("two large bodies in flight both come out redacted and release their reservations", async () => {
    const up = upstreamRecorder();
    const upstream = await startUpstream(up.handler);
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: await realPipeline(),
    });
    try {
      const send = () =>
        rawRequest(proxy.origin, "/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: bigBody(2 * 1024 * 1024),
        });
      const [a, b] = await Promise.all([send(), send()]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(up.seen.bodies).toHaveLength(2);
      for (const forwarded of up.seen.bodies) expect(forwarded).not.toContain(SECRET);
      await vi.waitFor(() => expect(proxy.proxy.bodyBytesInFlight).toBe(0), { timeout: 2_000 });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  }, 60_000);

  it("a client that hangs up mid-walk forwards nothing, skips the fallback and frees its reservation", async () => {
    const up = upstreamRecorder();
    const upstream = await startUpstream(up.handler);
    const real = await realPipeline();
    let entered: () => void = () => {};
    const inWalk = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let sawSignal = false;
    let fallbackRuns = 0;
    const errors: unknown[] = [];
    const outcomes: ProxyRequestOutcome[] = [];
    const pipeline: RequestPipeline = {
      name: "watching",
      process: (request: ProxyRequest, options?: PipelineRunOptions) => {
        sawSignal = options?.signal !== undefined;
        entered();
        return real.process(request, options);
      },
      redactOnly: (request) => {
        fallbackRuns += 1;
        return (real.redactOnly as NonNullable<typeof real.redactOnly>)(request);
      },
      redactOnlyAsync: (request, options) => {
        fallbackRuns += 1;
        return (real.redactOnlyAsync as NonNullable<typeof real.redactOnlyAsync>)(request, options);
      },
    };
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline,
      onPipelineError: (e) => errors.push(e),
      onRequestOutcome: (o) => outcomes.push(o),
    });
    try {
      const body = Buffer.from(bigBody(12 * 1024 * 1024), "utf8");
      const port = Number(new URL(proxy.origin).port);
      const sock = connect(port, "127.0.0.1");
      sock.on("error", () => {});
      sock.write(
        `POST /v1/messages HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n`,
      );
      sock.write(body);
      await inWalk;
      await new Promise((resolve) => setTimeout(resolve, 60));
      const hungUpAt = performance.now();
      sock.destroy();
      await vi.waitFor(() => expect(outcomes.map((o) => o.result)).toContain("client_gone"), {
        timeout: 3_000,
      });
      // Cheap: far sooner than the walk of 12 MiB (several seconds) could finish.
      expect(performance.now() - hungUpAt).toBeLessThan(1_500);
      expect(sawSignal).toBe(true);
      expect(up.seen.hits).toBe(0);
      expect(errors).toHaveLength(0);
      expect(fallbackRuns).toBe(0);
      await vi.waitFor(() => expect(proxy.proxy.bodyBytesInFlight).toBe(0), { timeout: 2_000 });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  }, 60_000);

  const failingProcess = (extra: Partial<RequestPipeline>): RequestPipeline => ({
    name: "failing",
    process: () => Promise.reject(new Error("process boom")),
    ...extra,
  });
  const small = JSON.stringify({
    model: "m",
    messages: [{ role: "user", content: `k ${SECRET}` }],
  });

  it("a process failure re-walks with redactOnlyAsync when the pipeline has it", async () => {
    const up = upstreamRecorder();
    const upstream = await startUpstream(up.handler);
    const real = await realPipeline();
    let syncRuns = 0;
    let asyncRuns = 0;
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: failingProcess({
        redactOnly: (r) => {
          syncRuns += 1;
          return (real.redactOnly as NonNullable<typeof real.redactOnly>)(r);
        },
        redactOnlyAsync: (r, o) => {
          asyncRuns += 1;
          return (real.redactOnlyAsync as NonNullable<typeof real.redactOnlyAsync>)(r, o);
        },
      }),
    });
    try {
      const res = await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: small,
      });
      expect(res.status).toBe(200);
      expect([syncRuns, asyncRuns]).toEqual([0, 1]);
      expect(up.seen.bodies[0]).not.toContain(SECRET);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });

  it("a failing redactOnlyAsync fails closed: 502, nothing forwarded, reservation freed", async () => {
    const up = upstreamRecorder();
    const upstream = await startUpstream(up.handler);
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: failingProcess({
        redactOnlyAsync: () => Promise.reject(new Error("redaction boom")),
      }),
    });
    try {
      const res = await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: small,
      });
      expect(res.status).toBe(502);
      expect(up.seen.hits).toBe(0);
      await vi.waitFor(() => expect(proxy.proxy.bodyBytesInFlight).toBe(0), { timeout: 2_000 });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});
