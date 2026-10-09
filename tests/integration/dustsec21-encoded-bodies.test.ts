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

describe("DUSTSEC.21 review 2: a NUL byte never makes a text body opaque", () => {
  const nul = Buffer.from([0]);
  it("an unlabelled body with a trailing NUL is redacted", async () => {
    const r = await send(await build(), "/v1/other", {
      body: Buffer.concat([Buffer.from(`key=${SECRET}`), nul]),
    });
    expect(r.raw.includes(Buffer.from(SECRET))).toBe(false);
    expect(r.raw.includes(nul)).toBe(true);
    expect(r.body).toContain(PLACEHOLDER);
  });

  it("application/xml and text/plain bodies with a NUL are redacted", async () => {
    for (const type of ["application/xml", "text/plain", "application/x-unknown"]) {
      const r = await send(await build(), "/v1/other", {
        headers: { "content-type": type },
        body: Buffer.concat([Buffer.from(`<a>${SECRET}</a>`), nul, Buffer.from("tail")]),
      });
      expect(r.raw.includes(Buffer.from(SECRET))).toBe(false);
      expect(r.body).toContain(PLACEHOLDER);
    }
  });
});

describe("DUSTSEC.21 review 2: UTF-16/32 anywhere in the body is refused", () => {
  const u16 = (s: string) => Buffer.from(s, "utf16le");
  const be = (s: string) => Buffer.from(s, "utf16le").swap16();
  const u32 = (s: string) =>
    Buffer.concat(
      [...s].map((c) => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(c.codePointAt(0) ?? 0);
        return b;
      }),
    );
  const ascii = Buffer.from("x".repeat(4096));
  const cases: Record<string, Buffer> = {
    "UTF-16LE after 4096 ASCII bytes": Buffer.concat([ascii, u16(`key=${SECRET}`)]),
    "UTF-16LE secret only, sparse NULs": Buffer.concat([ascii, u16(SECRET)]),
    "UTF-16BE after 4096 ASCII bytes": Buffer.concat([ascii, be(`key=${SECRET}`)]),
    "UTF-16LE at an odd offset": Buffer.concat([ascii, Buffer.from("y"), u16(`key=${SECRET}`)]),
    "mostly-CJK UTF-16LE": u16(`${"你好世界".repeat(2000)} key=${SECRET}`),
    "UTF-32LE": u32(`key=${SECRET} and some padding text`),
  };
  for (const [name, body] of Object.entries(cases)) {
    for (const headers of [{}, { "content-type": "text/plain" }]) {
      it(`${name}, headers ${JSON.stringify(headers)}`, async () => {
        const r = await send(await build(), "/v1/other", { headers, body });
        expectRefusedNothingForwarded(r, 502);
      });
    }
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2000),
    Buffer.from(SECRET),
  ]);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(3000), Buffer.from("x")]);
  const gz = gzipSync(Buffer.from("hello".repeat(100)));
  const zeros = Buffer.alloc(3000);
  const legit: Array<[string, Buffer, Record<string, string>]> = [
    ["PNG, labelled", png, { "content-type": "image/png" }],
    ["PNG, unlabelled magic", png, {}],
    ["PDF, labelled", pdf, { "content-type": "application/pdf" }],
    ["PDF, unlabelled magic", pdf, {}],
    ["gzip, unlabelled magic", gz, {}],
    ["gzip, text/plain label with magic", gz, { "content-type": "text/plain" }],
    ["zeros, octet-stream", zeros, { "content-type": "application/octet-stream" }],
  ];
  for (const [name, body, headers] of legit) {
    it(`legitimate binary is not refused or altered: ${name}`, async () => {
      const r = await send(await build(), "/v1/files", { headers, body });
      expect(r.status).toBe(200);
      expect(r.raw.equals(body)).toBe(true);
    });
  }

  it("an octet-stream starting with a UTF-8 BOM is forwarded byte-identical", async () => {
    const body = Buffer.from([0xef, 0xbb, 0xbf, 0x01, 0x02, 0x00, 0x03]);
    const r = await send(await build(), "/v1/files", {
      headers: { "content-type": "application/octet-stream" },
      body,
    });
    expect(r.raw.equals(body)).toBe(true);
  });

  it("an unchanged BOM-prefixed JSON body keeps its original bytes", async () => {
    const body = Buffer.from(`${BOM}{"a":"hello"}`);
    const r = await send(await build(), "/v1/other", { headers: jsonHeaders, body });
    expect(r.raw.equals(body)).toBe(true);
  });
});

describe("DUSTSEC.21 review 2: duplicate JSON keys", () => {
  const first = (shape: string) => {
    const tail = shape === "messages" ? ',"messages":[]' : "";
    return {
      top: `{"a":"${SECRET}","a":"x"${tail}}`,
      nested: `{"o":{"k":"${SECRET}","k":"x"}${tail}}`,
      array: `{"l":[{"k":"hi"},{"k":"${SECRET}","k":"x"}]${tail}}`,
      escaped: `{"a":"${SECRET}","\\u0061":"x"${tail}}`,
    };
  };
  for (const path of routes) {
    for (const [name, body] of Object.entries(first(path === "/v1/messages" ? "messages" : ""))) {
      it(`${name} duplicate to ${path} does not forward the shadowed secret`, async () => {
        const r = await send(await build(), path, { headers: jsonHeaders, body });
        expect(r.status).toBe(200);
        expect(r.raw.includes(Buffer.from(SECRET))).toBe(false);
        expect(() => JSON.parse(r.body)).not.toThrow();
      });
    }
  }

  it("the redactOnly fail-safe covers duplicate keys", async () => {
    const pipeline = await build({ policy: () => Promise.reject(new Error("policy boom")) });
    for (const path of routes) {
      const body = first(path === "/v1/messages" ? "messages" : "").top;
      const r = await send(pipeline, path, { headers: jsonHeaders, body });
      expect(r.raw.includes(Buffer.from(SECRET))).toBe(false);
    }
  });

  it("a body without duplicate keys is not touched by the guard", async () => {
    const body = `{"a":"x","b":{"a":"y"},"c":[{"a":"z"},{"a":"w"}]}`;
    const r = await send(await build(), "/v1/other", { headers: jsonHeaders, body });
    expect(r.body).toBe(body);
  });
});

describe("DUSTSEC.21 review 2: the in-flight reservation is released", () => {
  async function settle(get: () => number): Promise<number> {
    for (let i = 0; i < 50 && get() !== 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    return get();
  }

  it("after a normal request, a client abort mid-body, and an upstream failure", async () => {
    const upstream = await startUpstream((_req, res) => {
      res.end("{}");
    });
    const proxy = await startProxy({ upstreamBaseUrl: upstream.origin, pipeline: await build() });
    try {
      const body = JSON.stringify({ pad: "a".repeat(50_000) });
      await rawRequest(proxy.origin, "/v1/other", { method: "POST", headers: jsonHeaders, body });
      expect(await settle(() => proxy.proxy.bodyBytesInFlight)).toBe(0);

      // Abort mid-body: declare 1 MB, send a little, hang up.
      const { connect } = await import("node:net");
      const port = new URL(proxy.origin).port;
      await new Promise<void>((resolve) => {
        const sock = connect(Number(port), "127.0.0.1", () => {
          sock.write(
            "POST /v1/other HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\n" +
              'content-length: 1000000\r\n\r\n{"a":',
          );
          setTimeout(() => {
            sock.destroy();
            resolve();
          }, 100);
        });
      });
      expect(await settle(() => proxy.proxy.bodyBytesInFlight)).toBe(0);
    } finally {
      await proxy.close();
      await upstream.close();
    }

    // Upstream failure: nothing listening.
    const dead = await startUpstream((_req, res) => {
      res.end("{}");
    });
    const origin = dead.origin;
    await dead.close();
    const proxy2 = await startProxy({ upstreamBaseUrl: origin, pipeline: await build() });
    try {
      const r = await rawRequest(proxy2.origin, "/v1/other", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ pad: "a".repeat(50_000) }),
      });
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(await settle(() => proxy2.proxy.bodyBytesInFlight)).toBe(0);
    } finally {
      await proxy2.close();
    }
  });

  it("a long-running stream no longer holds the reservation once headers arrive", async () => {
    let finish: () => void = () => {};
    const done = new Promise<void>((r) => {
      finish = r;
    });
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: 1\n\n");
      void done.then(() => res.end("data: 2\n\n"));
    });
    const proxy = await startProxy({ upstreamBaseUrl: upstream.origin, pipeline: await build() });
    try {
      const { Client } = await import("undici");
      const client = new Client(proxy.origin);
      const res = await client.request({
        path: "/v1/other",
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ pad: "a".repeat(50_000) }),
      });
      const it = res.body[Symbol.asyncIterator]();
      await it.next(); // first event arrived: the stream is open
      expect(proxy.proxy.bodyBytesInFlight).toBe(0);
      finish();
      for await (const _ of res.body) {
        // drain
      }
      await client.close();
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});
