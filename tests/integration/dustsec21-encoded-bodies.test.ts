/**
 * DUSTSEC.21 — request bodies that are encoded or not JSON must not reach the
 * upstream unredacted, and the redaction walk is bounded. Assertions are on the
 * bytes the upstream actually received. Secrets are assembled at runtime so no
 * key-shaped literal is committed.
 */

import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
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

const jsonHeaders = { "content-type": "application/json" };
const BOM = "﻿";

describe("DUSTSEC.21 (2) a UTF-8 byte-order mark before the JSON", () => {
  for (const path of routes) {
    it(`BOM body to ${path} is redacted and forwarded without the BOM`, async () => {
      const r = await send(await build(), path, {
        headers: jsonHeaders,
        body: Buffer.from(BOM + messagesBody()),
      });
      expectCleanForward(r);
      expect(r.raw[0]).toBe(0x7b);
    });
  }

  it("a BOM inside a gzip body is handled too", async () => {
    const r = await send(await build(), "/v1/messages", {
      headers: { ...jsonHeaders, "content-encoding": "gzip" },
      body: gzipSync(Buffer.from(BOM + messagesBody())),
    });
    expectCleanForward(r);
  });

  it("the redactOnly fail-safe covers a BOM body", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const path of routes) {
      const r = await send(pipeline, path, {
        headers: jsonHeaders,
        body: Buffer.from(BOM + messagesBody()),
      });
      expectCleanForward(r);
    }
  });

  it("a UTF-16 body is refused (cannot be scanned), never forwarded", async () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(messagesBody(), "utf16le"),
    ]);
    for (const path of routes) {
      const r = await send(await build(), path, { headers: jsonHeaders, body: utf16 });
      expectRefusedNothingForwarded(r, 502);
    }
  });
});

describe("DUSTSEC.21 (3) a JSON array or scalar", () => {
  const shapes: Record<string, () => string> = {
    array: () => JSON.stringify(messages()),
    "nested array": () => JSON.stringify([[{ a: SECRET }]]),
    "bare string": () => JSON.stringify(`key ${SECRET}`),
  };
  for (const [name, make] of Object.entries(shapes)) {
    for (const path of routes) {
      it(`${name} to ${path} is redacted`, async () => {
        const r = await send(await build(), path, { headers: jsonHeaders, body: make() });
        expect(r.status).toBe(200);
        expect(r.hits).toBe(1);
        expect(r.body).not.toContain(SECRET);
        expect(r.body).toContain(PLACEHOLDER);
        expect(r.headers["content-length"]).toBe(String(r.raw.length));
      });
    }
  }

  it("non-secret scalars and arrays pass through unchanged", async () => {
    for (const body of ["42", "true", "null", '["hello"]']) {
      const r = await send(await build(), "/v1/messages", { headers: jsonHeaders, body });
      expect(r.body).toBe(body);
    }
  });

  it("the redactOnly fail-safe covers an array and a scalar on the messages route", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const body of [JSON.stringify(messages()), JSON.stringify(`k ${SECRET}`)]) {
      const r = await send(pipeline, "/v1/messages", { headers: jsonHeaders, body });
      expect(r.status).toBe(200);
      expect(r.body).not.toContain(SECRET);
      expect(r.body).toContain(PLACEHOLDER);
    }
  });
});

describe("DUSTSEC.21 (4) bodies that are not JSON", () => {
  const textBody = `plain text ${SECRET} {not json`;

  for (const path of routes) {
    it(`text/plain to ${path} is redacted`, async () => {
      const r = await send(await build(), path, {
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: textBody,
      });
      expect(r.status).toBe(200);
      expect(r.body).not.toContain(SECRET);
      expect(r.body).toContain(PLACEHOLDER);
      expect(r.body).toContain("plain text");
      expect(r.headers["content-length"]).toBe(String(r.raw.length));
    });
  }

  it("a body labelled application/json that is malformed is redacted as text", async () => {
    const r = await send(await build(), "/v1/messages", {
      headers: jsonHeaders,
      body: `{"a": "${SECRET}", `,
    });
    expect(r.body).not.toContain(SECRET);
    expect(r.body).toContain(PLACEHOLDER);
  });

  it("a body with no content-type that is text is redacted", async () => {
    const r = await send(await build(), "/v1/other", { body: textBody });
    expect(r.body).not.toContain(SECRET);
  });

  it("text that is not valid UTF-8 is still redacted and its other bytes are preserved", async () => {
    const body = Buffer.concat([
      Buffer.from("head "),
      Buffer.from([0xff, 0xfe, 0x80]),
      Buffer.from(` ${SECRET} tail`),
    ]);
    const r = await send(await build(), "/v1/other", {
      headers: { "content-type": "text/plain" },
      body,
    });
    expect(r.raw.includes(Buffer.from(SECRET))).toBe(false);
    expect(r.raw.includes(Buffer.from([0xff, 0xfe, 0x80]))).toBe(true);
    expect(r.body).toContain(PLACEHOLDER);
  });

  it("a form-urlencoded body is redacted, including a percent-encoded secret", async () => {
    const encoded = SECRET.split("")
      .map((c) => `%${c.charCodeAt(0).toString(16)}`)
      .join("");
    for (const [value, expected] of [
      [SECRET, PLACEHOLDER],
      [encoded, encodeURIComponent(PLACEHOLDER)],
    ] as const) {
      const r = await send(await build(), "/v1/other", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `a=1&key=${value}&b=two+words`,
      });
      expect(r.body).not.toContain(SECRET);
      expect(r.body).not.toContain(encoded);
      expect(r.body).toContain("a=1&");
      expect(r.body).toContain("b=two+words");
      expect(r.body).toContain(expected);
    }
  });

  it("a multipart body is forwarded unchanged (opaque, not scanned)", async () => {
    const body = Buffer.concat([
      Buffer.from(`--XB\r\ncontent-disposition: form-data; name="file"\r\n\r\n`),
      Buffer.from([0x00, 0x01, 0x02, 0xff]),
      Buffer.from(` ${SECRET}\r\n--XB--\r\n`),
    ]);
    const r = await send(await build(), "/v1/files", {
      headers: { "content-type": "multipart/form-data; boundary=XB" },
      body,
    });
    expect(r.hits).toBe(1);
    expect(r.raw.equals(body)).toBe(true);
  });

  it("an octet-stream body is forwarded unchanged", async () => {
    const body = Buffer.from([0x00, 0x9f, 0x92, 0x96, 0xff]);
    const r = await send(await build(), "/v1/files", {
      headers: { "content-type": "application/octet-stream" },
      body,
    });
    expect(r.raw.equals(body)).toBe(true);
  });

  it("the redactOnly fail-safe covers a text body", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const path of routes) {
      const r = await send(pipeline, path, {
        headers: { "content-type": "text/plain" },
        body: textBody,
      });
      expect(r.status).toBe(200);
      expect(r.body).not.toContain(SECRET);
    }
  });
});

describe("DUSTSEC.21 pipeline-level (no proxy in front)", () => {
  const req = (body: Buffer, headers: Record<string, string> = {}, url = "/v1/messages") => ({
    method: "POST",
    url,
    headers,
    body,
  });

  it("process and redactOnly strip a BOM and redact, on the messages route", async () => {
    const p = await build();
    const r = req(Buffer.from(BOM + messagesBody()));
    for (const out of [await p.process(r), p.redactOnly?.(r)]) {
      const text = out?.body?.toString("utf8") ?? "";
      expect(text.startsWith("{")).toBe(true);
      expect(text).not.toContain(SECRET);
    }
  });

  it("process and redactOnly redact an array and a scalar on the messages route", async () => {
    const p = await build();
    for (const body of [JSON.stringify(messages()), JSON.stringify(`k ${SECRET}`)]) {
      const r = req(Buffer.from(body));
      for (const out of [await p.process(r), p.redactOnly?.(r)]) {
        expect(out?.body?.toString("utf8")).not.toContain(SECRET);
        expect(out?.body?.toString("utf8")).toContain(PLACEHOLDER);
      }
    }
  });

  it("a UTF-16 body makes BOTH process and redactOnly throw (so the proxy fails closed)", async () => {
    const p = await build();
    const wide = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(messagesBody(), "utf16le")]);
    await expect(p.process(req(wide))).rejects.toThrow();
    expect(() => p.redactOnly?.(req(wide))).toThrow();
  });
});

describe("DUSTSEC.21 (5) request body size limit", () => {
  const big = () => JSON.stringify({ pad: "a".repeat(200_000) });

  it("a body whose content-length exceeds the limit gets 413 and nothing is forwarded", async () => {
    const r = await send(
      await build(),
      "/v1/messages",
      { headers: jsonHeaders, body: big() },
      { maxRequestBodyBytes: 100_000 },
    );
    expectRefusedNothingForwarded(r, 413);
  });

  it("a chunked body that grows past the limit gets 413 and nothing is forwarded", async () => {
    async function* chunks() {
      for (let i = 0; i < 20; i += 1) yield Buffer.from("a".repeat(10_000));
    }
    const got = { hits: 0 };
    const upstream = await startUpstream((_req, res) => {
      got.hits += 1;
      res.end("{}");
    });
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: await build(),
      maxRequestBodyBytes: 50_000,
    });
    try {
      const res = await rawRequest(proxy.origin, "/v1/other", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: Readable.from(chunks()) as unknown as Buffer,
      });
      expect(res.status).toBe(413);
      expect(got.hits).toBe(0);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });

  it("a body at the limit is accepted", async () => {
    const body = messagesBody();
    const r = await send(
      await build(),
      "/v1/messages",
      { headers: jsonHeaders, body },
      { maxRequestBodyBytes: Buffer.byteLength(body) },
    );
    expectCleanForward(r);
  });

  it("the default limit is 32 MiB", async () => {
    const { resolveProxyConfig } = await import("../../src/proxy/types.js");
    expect(resolveProxyConfig().maxRequestBodyBytes).toBe(32 * 1024 * 1024);
  });

  it("the setting is schema-validated and positive", async () => {
    const { DEFAULT_SETTINGS } = await import("../../src/config/schema.js");
    expect(DEFAULT_SETTINGS.proxy.max_request_body_bytes).toBe(32 * 1024 * 1024);
  });
});

describe("DUSTSEC.21 review: JSON under ANY label is redacted as JSON", () => {
  const labels = [
    "application/octet-stream",
    "image/png",
    "multipart/form-data; boundary=XB",
    "application/pdf",
  ];
  for (const label of labels) {
    for (const path of routes) {
      it(`${label} carrying JSON to ${path}`, async () => {
        const r = await send(await build(), path, {
          headers: { "content-type": label },
          body: `  ${messagesBody()}`,
        });
        expect(r.status).toBe(200);
        expect(r.body).not.toContain(SECRET);
        expect(r.body).toContain(PLACEHOLDER);
        expect(r.headers["content-length"]).toBe(String(r.raw.length));
      });
    }
  }

  it("the redactOnly fail-safe also redacts JSON under an opaque label", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const path of routes) {
      const r = await send(pipeline, path, {
        headers: { "content-type": "application/octet-stream" },
        body: messagesBody(),
      });
      expect(r.body).not.toContain(SECRET);
    }
  });
});

describe("DUSTSEC.21 review: UTF-16 without a BOM", () => {
  const swap = (b: Buffer) => Buffer.from(b).swap16();
  const sources = {
    json: messagesBody(),
    text: `plain text ${SECRET} and some more words to pad it out`,
  };
  for (const [kind, src] of Object.entries(sources)) {
    for (const [endian, body] of [
      ["LE", Buffer.from(src, "utf16le")],
      ["BE", swap(Buffer.from(src, "utf16le"))],
    ] as const) {
      for (const headers of [{}, { "content-type": "text/plain" }, jsonHeaders]) {
        it(`${kind} UTF-16${endian} no BOM, headers ${JSON.stringify(headers)} is refused`, async () => {
          const r = await send(await build(), "/v1/other", { headers, body });
          expectRefusedNothingForwarded(r, 502);
        });
      }
    }
  }

  it("true binary with a few NUL bytes (no label) is forwarded unchanged", async () => {
    const blob = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256));
    const r = await send(await build(), "/v1/files", { body: blob });
    expect(r.hits).toBe(1);
    expect(r.raw.equals(blob)).toBe(true);
  });
});

describe("DUSTSEC.21 review: raw deflate", () => {
  it("a raw (headerless) deflate body is decoded", async () => {
    const r = await send(await build(), "/v1/messages", {
      headers: { ...jsonHeaders, "content-encoding": "deflate" },
      body: deflateRawSync(Buffer.from(messagesBody())),
    });
    expectCleanForward(r);
  });
});

describe("DUSTSEC.21 review: in-flight buffered bytes are capped", () => {
  it("concurrent bodies past the cap get 503 + Retry-After, nothing forwarded for them", async () => {
    const got = { hits: 0 };
    const upstream = await startUpstream(async (_req, res) => {
      got.hits += 1;
      await new Promise((r) => setTimeout(r, 300));
      res.end("{}");
    });
    const proxy = await startProxy({
      upstreamBaseUrl: upstream.origin,
      pipeline: await build(),
      maxRequestBodyBytes: 100_000,
      maxInFlightBodyBytes: 150_000,
    });
    try {
      const body = JSON.stringify({ pad: "a".repeat(90_000) });
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          rawRequest(proxy.origin, "/v1/other", { method: "POST", headers: jsonHeaders, body }),
        ),
      );
      const statuses = results.map((x) => x.status).sort();
      expect(statuses).toContain(503);
      expect(statuses).toContain(200);
      const refused = results.find((x) => x.status === 503);
      expect(refused?.headers["retry-after"]).toBeDefined();
      expect(got.hits).toBe(statuses.filter((s) => s === 200).length);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});

describe("DUSTSEC.21 review: setting validation", () => {
  it("rejects 0, -1, 1.5, a string and a value over the upper bound", async () => {
    const { leafSchema } = await import("../../src/config/schema.js");
    const schema = leafSchema("proxy", "max_request_body_bytes");
    expect(schema).toBeDefined();
    for (const bad of [0, -1, 1.5, "100", 256 * 1024 * 1024 + 1]) {
      expect(schema?.safeParse(bad).success).toBe(false);
    }
    expect(schema?.safeParse(256 * 1024 * 1024).success).toBe(true);
    expect(schema?.safeParse(1).success).toBe(true);
  });
});
