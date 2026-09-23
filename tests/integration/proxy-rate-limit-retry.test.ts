/**
 * R14.5 — the proxy's own transparent retry-on-429/529, generalized out of
 * Buzz (`src/buzz/limit-guard.ts` / `acp-turn.ts`) into
 * `src/proxy/rate-limit-retry.ts` so Claude Code's own live traffic through
 * the proxy gets the same "wait it out, invisibly" behaviour a background
 * persona draft already had.
 *
 * `rateLimitSleep` is overridden throughout to resolve instantly — these
 * tests assert the retry loop's DECISIONS (attempt count, requested delay,
 * which response is ultimately forwarded), not real wall-clock backoff.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GolemProxy } from "../../src/proxy/index.js";

interface ScriptedUpstream {
  readonly server: Server;
  readonly url: string;
  readonly requestCount: () => number;
}

/** The Nth request gets `statuses[N]`; once the script runs out, every further request is 200. */
function startScriptedUpstream(statuses: readonly number[]): Promise<ScriptedUpstream> {
  let requests = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const status = statuses[requests] ?? 200;
      requests += 1;
      if (status === 429 || status === 529) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rate limited", attempt: requests } }));
        return;
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, attempt: requests }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, requestCount: () => requests });
    });
  });
}

let upstream: ScriptedUpstream | undefined;
let proxy: GolemProxy | undefined;

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  if (upstream !== undefined) {
    await new Promise<void>((resolve) => upstream?.server.close(() => resolve()));
    upstream = undefined;
  }
});

async function startProxy(
  statuses: readonly number[],
  rateLimitSleep: (ms: number, signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
): Promise<{ base: string; upstream: ScriptedUpstream }> {
  upstream = await startScriptedUpstream(statuses);
  proxy = new GolemProxy({ upstreamBaseUrl: upstream.url, rateLimitSleep });
  const { port } = await proxy.listen(0, "127.0.0.1");
  return { base: `http://127.0.0.1:${port}`, upstream };
}

function post(base: string): Promise<Response> {
  return fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-x", messages: [] }),
  });
}

describe("proxy rate-limit retry (R14.5)", () => {
  it("retries a rate-limited upstream and forwards the eventual success, transparently", async () => {
    const { base, upstream: u } = await startProxy([429, 429, 200]);
    const res = await post(base);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, attempt: 3 });
    expect(u.requestCount()).toBe(3);
  });

  it("gives up after exhausting retries and forwards the still-429 response, byte for byte", async () => {
    // MAX_RETRY_ATTEMPTS = 3, so 1 initial + 3 retries = 4 attempts before giving up.
    const { base, upstream: u } = await startProxy([429, 429, 429, 429, 200]);
    const res = await post(base);
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: { message: "rate limited", attempt: 4 } });
    expect(u.requestCount()).toBe(4); // the 5th (200) script entry was never reached
  });

  it("retries a 529 (Anthropic overloaded) exactly like a 429", async () => {
    const { base, upstream: u } = await startProxy([529, 200]);
    const res = await post(base);
    expect(res.status).toBe(200);
    expect(u.requestCount()).toBe(2);
  });

  it("never retries an ordinary error status (e.g. 500) — forwarded on the first attempt", async () => {
    const { base, upstream: u } = await startProxy([500]);
    const res = await post(base);
    expect(res.status).toBe(500);
    expect(u.requestCount()).toBe(1);
  });

  it("waits the exponential-backoff amount when the upstream gives no retry-after", async () => {
    const waits: number[] = [];
    const { base, upstream: u } = await startProxy([429, 429, 200], (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    const res = await post(base);
    expect(res.status).toBe(200);
    expect(u.requestCount()).toBe(3);
    expect(waits).toEqual([1000, 2000]); // 1s, then 2s — R14.5's confirmed backoff
  });

  it("succeeds with exactly one client-visible response regardless of how many retries it took", async () => {
    const { base } = await startProxy([429, 429, 429, 200]);
    const res = await post(base);
    // The retry loop is invisible on the wire — one request in, one response out.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
