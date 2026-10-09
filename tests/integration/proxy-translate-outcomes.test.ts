/**
 * DUST3 leftover 1 — the translating path's upstream body-read and gunzip
 * failures destroy the client socket. They used to do it without reporting,
 * so the one request that died left no outcome line (R11.7 promises one per
 * request).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UpstreamTranslator } from "../../src/proxy/index.js";
import type { ProxyRequestOutcome } from "../../src/proxy/types.js";
import {
  type FakeUpstream,
  type RunningProxy,
  rawRequest,
  startProxy,
  startUpstream,
} from "./helpers/test-servers.js";

const translator: UpstreamTranslator = {
  path: "/v1/chat/completions",
  translateRequest: (body) => ({ body, stream: false }),
  translateResponse: (body) => body,
  createStreamTranslator: () => {
    throw new Error("not streaming");
  },
};

describe("translating path reports upstream body failures (R11.7)", () => {
  let upstream: FakeUpstream | undefined;
  let proxy: RunningProxy | undefined;
  let outcomes: ProxyRequestOutcome[];

  beforeEach(() => {
    outcomes = [];
  });
  afterEach(async () => {
    await proxy?.close();
    await upstream?.close();
  });

  const run = async (
    handler: Parameters<typeof startUpstream>[0],
  ): Promise<{ failed: boolean }> => {
    upstream = await startUpstream(handler);
    proxy = await startProxy({
      upstreamBaseUrl: `${upstream.origin}/v1`,
      translateUpstream: translator,
      onRequestOutcome: (o) => outcomes.push(o),
    });
    let failed = false;
    try {
      await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 8, messages: [] }),
      });
    } catch {
      failed = true;
    }
    // The outcome is reported from the proxy's own event loop turn.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { failed };
  };

  it("reports a gunzip failure as upstream_error with a reason", async () => {
    const { failed } = await run((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end("this is not gzip");
    });

    expect(failed).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.result).toBe("upstream_error");
    expect(outcomes[0]?.detail).toMatch(/gunzip|decode|gzip/i);
  });

  it("reports a non-2xx body that dies mid-read as upstream_error with a reason", async () => {
    const { failed } = await run((_req, res) => {
      res.writeHead(500, { "content-type": "application/json", "content-length": "1000" });
      res.write("{");
      setTimeout(() => res.destroy(), 10);
    });

    expect(failed).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.result).toBe("upstream_error");
    expect(outcomes[0]?.detail).toMatch(/body/i);
  });
});
