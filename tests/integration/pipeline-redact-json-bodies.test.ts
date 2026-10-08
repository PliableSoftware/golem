/**
 * DUSTSEC.19 — redaction must cover every JSON body, not only POST /v1/messages.
 * `/v1/messages/count_tokens`, `/v1/messages/batches` and any other JSON POST
 * carry conversation text too. Assertions are on the bytes the upstream actually
 * received. Secrets are assembled at runtime so no key-shaped literal is committed.
 */

import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../src/compression/index.js";
import { policyFor } from "../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../src/pipeline/index.js";
import type { ProxyRequest, RequestPipeline } from "../../src/proxy/types.js";
import { useTempDirs } from "../helpers/tmp.js";
import { rawRequest, startProxy, startUpstream } from "./helpers/test-servers.js";

const SECRET = `AKIA${"IOSFODNN7"}${"EXAMPLE"}`;
const PLACEHOLDER = `[${"REDACTED"}:aws-key:1]`;

const newTempDir = useTempDirs("golem-dustsec19-");

async function build(overrides: Partial<Parameters<typeof createGolemPipeline>[0]> = {}) {
  const projectDir = await newTempDir();
  return createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(projectDir),
    policy: () => policyFor(1),
    projectId: projectDir,
    ...overrides,
  });
}

interface Sent {
  readonly status: number;
  readonly hits: number;
  readonly body: string;
  readonly contentLength: string | undefined;
}

async function send(
  pipeline: RequestPipeline,
  path: string,
  init: { method: string; contentType?: string; body?: string },
): Promise<Sent> {
  const got = { hits: 0, body: "", contentLength: undefined as string | undefined };
  const upstream = await startUpstream((req, res: ServerResponse, body) => {
    got.hits += 1;
    got.body = body.toString("utf8");
    const cl = req.headers["content-length"];
    got.contentLength = Array.isArray(cl) ? cl[0] : cl;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  const proxy = await startProxy({ upstreamBaseUrl: upstream.origin, pipeline });
  try {
    const res = await rawRequest(proxy.origin, path, {
      method: init.method,
      headers: init.contentType !== undefined ? { "content-type": init.contentType } : {},
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    return { status: res.status, ...got };
  } finally {
    await proxy.close();
    await upstream.close();
  }
}

const json = { method: "POST", contentType: "application/json" } as const;

function expectRedacted(r: Sent): void {
  expect(r.status).toBe(200);
  expect(r.hits).toBe(1);
  expect(r.body).not.toContain(SECRET);
  expect(r.body).toContain(PLACEHOLDER);
  expect(r.contentLength).toBe(String(Buffer.byteLength(r.body)));
}

const messages = () => [{ role: "user", content: `my key is ${SECRET}` }];

describe("DUSTSEC.19 redaction over non-messages JSON bodies", () => {
  it("(a) count_tokens", async () => {
    const r = await send(await build(), "/v1/messages/count_tokens", {
      ...json,
      body: JSON.stringify({ model: "claude-x", messages: messages() }),
    });
    expectRedacted(r);
  });

  it("(b) batches: nested requests[].params", async () => {
    const r = await send(await build(), "/v1/messages/batches", {
      ...json,
      body: JSON.stringify({
        requests: [{ custom_id: "a", params: { model: "claude-x", messages: messages() } }],
      }),
    });
    expectRedacted(r);
    expect(JSON.parse(r.body).requests[0].custom_id).toBe("a");
  });

  it("(c) an arbitrary JSON POST", async () => {
    const r = await send(await build(), "/v1/something/else", {
      ...json,
      body: JSON.stringify({ note: [{ deep: `x ${SECRET}` }] }),
    });
    expectRedacted(r);
  });

  it("(c2) a body that parses as JSON without a JSON content-type", async () => {
    const r = await send(await build(), "/v1/something/else", {
      method: "POST",
      contentType: "text/plain",
      body: JSON.stringify({ note: SECRET }),
    });
    expectRedacted(r);
  });

  it("(d) fail-safe: a pipeline error never forwards a raw body on these routes", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const path of ["/v1/messages/count_tokens", "/v1/messages/batches", "/v1/other"]) {
      const r = await send(pipeline, path, {
        ...json,
        body: JSON.stringify({ requests: [{ params: { messages: messages() } }] }),
      });
      expectRedacted(r);
    }
  });

  it("(e) a GET with no body is unchanged", async () => {
    const r = await send(await build(), "/v1/models", { method: "GET" });
    expect(r.hits).toBe(1);
    expect(r.body).toBe("");
  });

  it("(f) a non-JSON body is forwarded unchanged", async () => {
    const body = `plain text ${SECRET} {not json`;
    const r = await send(await build(), "/v1/messages/count_tokens", {
      method: "POST",
      contentType: "text/plain",
      body,
    });
    expect(r.hits).toBe(1);
    expect(r.body).toBe(body);
  });

  it("level off still redacts (no new way to turn redaction off)", async () => {
    const r = await send(
      await build({ policy: () => policyFor("off") }),
      "/v1/messages/count_tokens",
      {
        ...json,
        body: JSON.stringify({ messages: messages() }),
      },
    );
    expectRedacted(r);
  });
});

describe("DUSTSEC.19 pipeline-level identity", () => {
  const req = (url: string, body: string | null, method = "POST"): ProxyRequest => ({
    method,
    url,
    headers: {},
    body: body === null ? null : Buffer.from(body, "utf8"),
  });

  it("returns the very same request object when no secret is found", async () => {
    const p = await build();
    const clean = req("/v1/messages/batches", JSON.stringify({ requests: [{ x: "hello" }] }));
    expect(await p.process(clean)).toBe(clean);
    expect(p.redactOnly?.(clean)).toBe(clean);
    const get = req("/v1/models", null, "GET");
    expect(await p.process(get)).toBe(get);
    expect(p.redactOnly?.(get)).toBe(get);
  });

  it("redactOnly redacts a count_tokens body", async () => {
    const p = await build();
    const out = p.redactOnly?.(
      req("/v1/messages/count_tokens", JSON.stringify({ messages: messages() })),
    );
    expect(out?.body?.toString("utf8")).toContain(PLACEHOLDER);
    expect(out?.body?.toString("utf8")).not.toContain(SECRET);
  });
});
