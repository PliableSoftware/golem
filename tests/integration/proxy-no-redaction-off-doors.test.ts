/**
 * DUSTSEC.2 — the only way to turn redaction off is the persisted `bypass_all`
 * setting. Two side doors used to exist and are probed here, through the real
 * proxy and a real pipeline, asserting on the bytes the upstream received.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../src/compression/index.js";
import { policyFor } from "../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../src/pipeline/index.js";
import { useTempDirs } from "../helpers/tmp.js";
import { rawRequest, startProxy, startUpstream } from "./helpers/test-servers.js";

// Assembled at runtime so no literal key sits in the source.
const SECRET = `AKIA${"IOSFODNN7"}${"EXAMPLE"}`;
const newTempDir = useTempDirs("golem-doors-");
let projectDir: string;

beforeEach(async () => {
  projectDir = await newTempDir();
});

const body = (): string =>
  JSON.stringify({
    model: { name: "claude-x" },
    messages: [{ role: "user", content: `key ${SECRET}` }],
  });

function setup() {
  const received: { path: string; body: string }[] = [];
  const handler = (req: IncomingMessage, res: ServerResponse, buf: Buffer): void => {
    received.push({ path: req.url ?? "", body: buf.toString("utf8") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  };
  return { received, handler };
}

const pipeline = () =>
  createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(projectDir),
    policy: () => policyFor(1),
    projectId: projectDir,
  });

describe("no redaction-off side doors", () => {
  it("POST /__golem/pipeline/false (cross-origin) disables nothing", async () => {
    const s = setup();
    const upstream = await startUpstream(s.handler);
    const proxy = await startProxy({ upstreamBaseUrl: upstream.origin, pipeline: pipeline() });
    try {
      await rawRequest(proxy.origin, "/__golem/pipeline/false", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-length": "0" },
      });
      await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body(),
      });
      const messages = s.received.find((r) => r.path === "/v1/messages");
      expect(messages?.body).not.toContain(SECRET);
      expect(messages?.body).toContain("[REDACTED:aws-key:1]");
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });

  it.each(["1", "true", "yes"])("x-golem-bypass: %s is redacted like any request", async (v) => {
    const s = setup();
    const upstream = await startUpstream(s.handler);
    const proxy = await startProxy({ upstreamBaseUrl: upstream.origin, pipeline: pipeline() });
    try {
      await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-golem-bypass": v },
        body: body(),
      });
      expect(s.received[0]?.body).not.toContain(SECRET);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });

  it("proxy.bypass_all (constructor pipelineEnabled:false) remains the one way off", async () => {
    const s = setup();
    const upstream = await startUpstream(s.handler);
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: pipeline(),
      pipelineEnabled: false,
    });
    try {
      const sent = body();
      await rawRequest(proxy.origin, "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: sent,
      });
      expect(s.received[0]?.body).toBe(sent);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});
