/**
 * DUSTSEC.15 / V2 — an unknown default target ALWAYS fails closed, a single
 * configured target included. Before, the single-target path had no route
 * resolver and quietly served the top-level upstream with a startup warning.
 */

import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProxyFromSettings } from "../../src/cli/proxy-runtime.js";
import { loadConfig } from "../../src/config/index.js";
import { JsonlTelemetryStore } from "../../src/telemetry/jsonl-store.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-unknown-target-");
let projectDir: string;
let upstream: { server: Server; url: string; hits: number } | null = null;

beforeEach(async () => {
  projectDir = await newTempDir();
});

afterEach(async () => {
  const s = upstream?.server;
  upstream = null;
  if (s !== undefined) await new Promise<void>((r) => s.close(() => r()));
});

async function startUpstream(): Promise<NonNullable<typeof upstream>> {
  const state = { hits: 0 } as { server: Server; url: string; hits: number };
  state.server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      state.hits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", content: [] }));
    });
  });
  await new Promise<void>((r) => state.server.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(state.server.address() as { port: number }).port}`;
  return state;
}

async function post(model: string | undefined): Promise<{ status: number; text: string }> {
  upstream = await startUpstream();
  const { settings } = await loadConfig({ projectDir });
  const withUpstream = {
    ...settings,
    proxy: { ...settings.proxy, upstream_base_url: upstream.url },
    inference: { ...settings.inference, ...(model !== undefined ? { model } : {}) },
  };
  const telemetry = new JsonlTelemetryStore(projectDir);
  const { proxy } = buildProxyFromSettings(projectDir, withUpstream, telemetry);
  const addr = await proxy.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        max_tokens: 16,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await proxy.close();
  }
}

describe("unknown default target fails closed (DUSTSEC.15)", () => {
  it("single target + unknown inference.model: 400, Golem-attributed, upstream never hit", async () => {
    const r = await post("ghost-target");
    expect(r.status).toBe(400);
    expect(r.text).toContain("golem proxy");
    expect(r.text).toContain("ghost-target");
    expect(upstream?.hits).toBe(0);
  });

  it("CONTROL: no inference.model still serves the top-level upstream", async () => {
    const r = await post(undefined);
    expect(r.status).toBe(200);
    expect(upstream?.hits).toBe(1);
  });
});
