/**
 * DUST2.17 — every proxied request leaves a durable (gateway, provider, reason)
 * line under .golem/state/, single-target included, with no credential in it.
 * Driven through buildProxyFromSettings, the real daemon wiring.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProxyFromSettings } from "../../src/cli/proxy-runtime.js";
import { loadConfig } from "../../src/config/index.js";
import {
  createSelectionLog,
  sanitizeReason,
  selectionLogPath,
} from "../../src/shared/selection-log.js";
import { JsonlTelemetryStore } from "../../src/telemetry/jsonl-store.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-selection-log-");
let projectDir: string;
let upstream: { server: Server; url: string };
// Built at runtime so no secret-shaped literal sits in the repo.
const SECRET = `sk-ant-api03-${randomBytes(24).toString("hex")}`;

beforeEach(async () => {
  projectDir = await newTempDir();
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", content: [] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  upstream = { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
});

afterEach(async () => {
  await new Promise<void>((r) => upstream.server.close(() => r()));
  delete process.env.GOLEM_UPSTREAM_API_KEY__WORK;
});

type Proxy = ReturnType<typeof buildProxyFromSettings>["proxy"];

async function runRequests(
  mutate: (p: Awaited<ReturnType<typeof loadConfig>>["settings"]["proxy"]) => object,
  requests: Array<{ model?: string; headers?: Record<string, string> }>,
): Promise<void> {
  const { settings } = await loadConfig({ projectDir });
  const proxySettings = {
    ...settings.proxy,
    upstream_base_url: upstream.url,
    ...mutate(settings.proxy),
  };
  const withUp = { ...settings, proxy: proxySettings };
  const { proxy } = buildProxyFromSettings(projectDir, withUp, new JsonlTelemetryStore(projectDir));
  const addr = await (proxy as Proxy).listen(0);
  try {
    for (const r of requests) {
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SECRET}`,
          "x-api-key": SECRET,
          ...r.headers,
        },
        body: JSON.stringify({
          ...(r.model !== undefined ? { model: r.model } : {}),
          max_tokens: 8,
          messages: [{ role: "user", content: `my key is ${SECRET}` }],
        }),
      });
      expect(res.status).toBe(200);
      await res.text();
    }
  } finally {
    await proxy.close();
  }
}

async function readLog(): Promise<string> {
  // The append is off the request path: poll briefly rather than assume timing.
  for (let i = 0; i < 100; i++) {
    try {
      const t = await readFile(selectionLogPath(projectDir), "utf8");
      if (t.length > 0) return t;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return "";
}

describe("selection log (DUST2.17)", () => {
  it("single target: one line per request, survives a second proxy lifetime", async () => {
    await runRequests(() => ({}), [{}]);
    expect((await readLog()).trim().split("\n")).toHaveLength(1);
    // A fresh proxy ("daemon restart") appends to the same file, never truncates it.
    await runRequests(() => ({}), [{}, {}]);
    await new Promise((r) => setTimeout(r, 100));
    const lines = (await readLog())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ provider: "anthropic", gateway: null });
    expect(typeof lines[0].reason).toBe("string");
    expect(lines[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("multi target: records gateway, provider, target, reason and sticky; no secret anywhere", async () => {
    process.env.GOLEM_UPSTREAM_API_KEY__WORK = SECRET;
    await runRequests(
      () => ({
        gateways: [
          { id: "work", provider: "anthropic", base_url: upstream.url, models: [{ name: "m-a" }] },
          { id: "other", provider: "anthropic", base_url: upstream.url, models: [{ name: "m-b" }] },
        ],
        targets: [
          { id: "ta", gateway: "work", model: { name: "m-a" } },
          { id: "tb", gateway: "other", model: { name: "m-b" } },
        ],
      }),
      [{ headers: { "x-golem-target": "tb" } }, { model: "golem/ta" }],
    );
    await new Promise((r) => setTimeout(r, 100));
    const raw = await readLog();
    const lines = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ target: "tb", gateway: "other", provider: "anthropic" });
    expect(lines[1]).toMatchObject({ target: "ta", gateway: "work", provider: "anthropic" });
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(upstream.url);
    expect(raw).not.toContain("Bearer");
  });
});

describe("selection log unit behaviour", () => {
  it("redacts and bounds request-derived reason text", () => {
    const out = sanitizeReason(`header ${SECRET}\n\u0000${"x".repeat(500)}`);
    expect(out).not.toContain(SECRET);
    expect([...out].some((c) => c.charCodeAt(0) < 32)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(201);
  });

  it("rotates by rename, caps retained files, and never throws on a dead path", async () => {
    const log = createSelectionLog(projectDir, { maxBytes: 300, keep: 2 });
    for (let i = 0; i < 40; i++) {
      log.record({ gateway: null, provider: "anthropic", target: "t", reason: `r${i}` });
      await log.flush();
    }
    const names = await readdir(path.dirname(selectionLogPath(projectDir)));
    const rotated = names.filter(
      (n) => n.startsWith("selection-log.") && n !== "selection-log.jsonl",
    );
    expect(rotated.length).toBeLessThanOrEqual(2);
    expect(rotated.length).toBeGreaterThan(0);

    // A file where the state directory should be: every write fails, nothing throws.
    const broken = await newTempDir();
    await mkdir(path.join(broken, ".golem"), { recursive: true });
    await writeFile(path.join(broken, ".golem", "state"), "not a directory");
    const dead = createSelectionLog(broken);
    expect(() =>
      dead.record({ gateway: null, provider: "p", target: "t", reason: "r" }),
    ).not.toThrow();
    await expect(dead.flush()).resolves.toBeUndefined();
  });
});
