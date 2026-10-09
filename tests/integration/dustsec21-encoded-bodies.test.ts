/**
 * DUSTSEC.21 — request bodies that are encoded or not JSON must not reach the
 * upstream unredacted, and the redaction walk is bounded. Assertions are on the
 * bytes the upstream actually received. Secrets are assembled at runtime so no
 * key-shaped literal is committed.
 */

import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../src/compression/index.js";
import { policyFor } from "../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../src/pipeline/index.js";
import type { ProxyServerOptions, RequestPipeline } from "../../src/proxy/types.js";
import { useTempDirs } from "../helpers/tmp.js";
import { rawRequest, startProxy, startUpstream } from "./helpers/test-servers.js";

const SECRET = `AKIA${"IOSFODNN7"}${"EXAMPLE"}`;
const PLACEHOLDER = `[${"REDACTED"}:aws-key:1]`;

const newTempDir = useTempDirs("golem-dustsec21-");

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
  readonly raw: Buffer;
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly responseBody: string;
}

async function send(
  pipeline: RequestPipeline,
  path: string,
  init: { headers?: Record<string, string>; body: Buffer | string },
  proxyOptions: Partial<ProxyServerOptions> = {},
): Promise<Sent> {
  const got = { hits: 0, raw: Buffer.alloc(0) as Buffer, headers: {} as IncomingHttpHeaders };
  const upstream = await startUpstream((req, res: ServerResponse, body) => {
    got.hits += 1;
    got.raw = body;
    got.headers = req.headers;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  const proxy = await startProxy({ upstreamBaseUrl: upstream.origin, pipeline, ...proxyOptions });
  try {
    const res = await rawRequest(proxy.origin, path, {
      method: "POST",
      headers: init.headers ?? {},
      body: init.body,
    });
    return {
      status: res.status,
      ...got,
      body: got.raw.toString("utf8"),
      responseBody: res.body.toString("utf8"),
    };
  } finally {
    await proxy.close();
    await upstream.close();
  }
}

const messages = () => [{ role: "user", content: `my key is ${SECRET}` }];
const messagesBody = () => JSON.stringify({ model: "claude-x", messages: messages() });

/** The upstream got an identity-encoded, parseable, redacted body with a true length. */
function expectCleanForward(r: Sent): void {
  expect(r.status).toBe(200);
  expect(r.hits).toBe(1);
  expect(r.body).not.toContain(SECRET);
  expect(r.body).toContain(PLACEHOLDER);
  expect(r.headers["content-encoding"]).toBeUndefined();
  expect(r.headers["content-length"]).toBe(String(r.raw.length));
  expect(() => JSON.parse(r.body)).not.toThrow();
}

function expectRefusedNothingForwarded(r: Sent, status: number): void {
  expect(r.status).toBe(status);
  expect(r.hits).toBe(0);
}

const routes = ["/v1/messages", "/v1/messages/count_tokens", "/v1/some/other"] as const;

describe("DUSTSEC.21 (1) content-encoded JSON bodies", () => {
  for (const [enc, encode] of [
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ] as const) {
    for (const path of routes) {
      it(`${enc} body to ${path} is decoded, redacted and forwarded identity-encoded`, async () => {
        const r = await send(await build(), path, {
          headers: { "content-type": "application/json", "content-encoding": enc },
          body: encode(Buffer.from(messagesBody())),
        });
        expectCleanForward(r);
      });
    }
  }

  it("a stacked encoding (gzip then br) is decoded in reverse order", async () => {
    const r = await send(await build(), "/v1/messages/count_tokens", {
      headers: { "content-type": "application/json", "content-encoding": "gzip, br" },
      body: brotliCompressSync(gzipSync(Buffer.from(messagesBody()))),
    });
    expectCleanForward(r);
  });

  it("an undecodable gzip body is refused and nothing is forwarded", async () => {
    // Not gzip at all, but it carries the secret in the clear.
    const r = await send(await build(), "/v1/messages", {
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: Buffer.from(messagesBody()),
    });
    expectRefusedNothingForwarded(r, 400);
    expect(r.responseBody).not.toContain(SECRET);
  });

  it("an unsupported encoding is refused and nothing is forwarded", async () => {
    const r = await send(await build(), "/v1/messages", {
      headers: { "content-type": "application/json", "content-encoding": "compress" },
      body: Buffer.from(messagesBody()),
    });
    expectRefusedNothingForwarded(r, 415);
  });

  it("a decompression bomb over the limit is refused with 413", async () => {
    const r = await send(
      await build(),
      "/v1/messages",
      {
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: gzipSync(Buffer.from(JSON.stringify({ pad: "a".repeat(200_000) }))),
      },
      { maxRequestBodyBytes: 50_000 },
    );
    expectRefusedNothingForwarded(r, 413);
  });

  it("the redactOnly fail-safe also covers an encoded body", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const path of routes) {
      const r = await send(pipeline, path, {
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: gzipSync(Buffer.from(messagesBody())),
      });
      expectCleanForward(r);
    }
  });

  it("identity encoding is left alone", async () => {
    const r = await send(await build(), "/v1/messages/count_tokens", {
      headers: { "content-type": "application/json", "content-encoding": "identity" },
      body: messagesBody(),
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain(PLACEHOLDER);
    expect(r.body).not.toContain(SECRET);
  });
});
