/**
 * DUSTSEC.21 — reading and normalising the REQUEST body before redaction.
 *
 * Redaction can only protect what it can read. Two things used to hide a body
 * from it: a `content-encoding` (gzip, deflate, br) the proxy never decoded, and
 * a body with no size bound. Both live here so the proxy has one place that
 * decides what bytes the pipeline is shown.
 *
 * Policy, in one line each:
 * - Over the size limit (on the wire OR after decompression): refuse, 413.
 * - An encoding we cannot decode, or a body that does not decode: refuse. NEVER
 *   forward the bytes we could not read.
 * - Decoded bodies are forwarded IDENTITY-encoded (see {@link normalizeRequestBody}).
 */

import type { IncomingMessage } from "node:http";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

/** The request is refused. `status` is the HTTP status to answer with. */
export class RequestBodyRefusal extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyRefusal";
  }
}

/**
 * Default request body limit: 32 MiB (the Messages API's own request limit), on
 * the wire and after decompression.
 */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

/** Upper bound the `proxy.max_request_body_bytes` setting may take. */
export const MAX_REQUEST_BODY_BYTES_CEILING = 256 * 1024 * 1024;

function tooLarge(max: number, what: string): RequestBodyRefusal {
  return new RequestBodyRefusal(
    413,
    `golem proxy: ${what} exceeds the ${max}-byte request body limit ` +
      "(proxy.max_request_body_bytes). Nothing was forwarded.",
  );
}

/**
 * Total request-body bytes held across concurrent requests (the wire body plus
 * its decoded form). A request that cannot reserve its bytes is answered 503
 * with Retry-After and nothing is forwarded.
 */
export class BodyBudget {
  #used = 0;
  constructor(readonly cap: number) {}
  tryReserve(bytes: number): boolean {
    if (this.#used + bytes > this.cap) return false;
    this.#used += bytes;
    return true;
  }
  release(bytes: number): void {
    this.#used = Math.max(0, this.#used - bytes);
  }
  get used(): number {
    return this.#used;
  }
}

/** What one request has reserved from the {@link BodyBudget}; the caller releases it. */
export interface BodyHold {
  bytes: number;
}

function busy(): RequestBodyRefusal {
  return new RequestBodyRefusal(
    503,
    "golem proxy: too many large request bodies are in flight (proxy memory cap). " +
      "Nothing was forwarded; retry shortly.",
  );
}

/**
 * Buffer the request body, refusing (413) past `maxBytes`. A declared
 * `content-length` over the limit is refused before a single byte is read; a
 * chunked body is counted as it arrives and the chunks are dropped the moment the
 * limit is crossed, so memory never grows past the limit plus one chunk.
 */
export function readBody(
  req: IncomingMessage,
  maxBytes: number,
  budget: BodyBudget,
  hold: BodyHold,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(tooLarge(maxBytes, `the declared body (${declared} bytes)`));
      return;
    }
    const reserve = (n: number): boolean => {
      if (!budget.tryReserve(n)) return false;
      hold.bytes += n;
      return true;
    };
    // A declared length is reserved up front, so a flood is refused before any read.
    if (Number.isFinite(declared) && declared > 0 && !reserve(declared)) {
      reject(busy());
      return;
    }
    const reservedUpFront = hold.bytes;
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        reject(tooLarge(maxBytes, "the request body"));
        return;
      }
      if (size > reservedUpFront && !reserve(Math.min(chunk.length, size - reservedUpFront))) {
        over = true;
        chunks.length = 0;
        reject(busy());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (over) return;
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!over) reject(err);
    });
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

type Decoder = (input: Buffer, maxOutputLength: number) => Buffer;

const DECODERS: Readonly<Record<string, Decoder>> = {
  gzip: (b, m) => gunzipSync(b, { maxOutputLength: m }),
  "x-gzip": (b, m) => gunzipSync(b, { maxOutputLength: m }),
  // RFC 9110 says zlib-wrapped, but some clients send raw deflate: try both.
  deflate: (b, m) => {
    try {
      return inflateSync(b, { maxOutputLength: m });
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw err;
      return inflateRawSync(b, { maxOutputLength: m });
    }
  },
  br: (b, m) => brotliDecompressSync(b, { maxOutputLength: m }),
};

export interface NormalizedRequestBody {
  readonly body: Buffer;
  readonly headers: Record<string, string | string[]>;
}

/**
 * Make the body the pipeline sees the body the upstream will receive, and make
 * both readable.
 *
 * 1. `content-encoding` is decoded (listed order is application order, so it is
 *    undone in reverse). The decoded body is forwarded IDENTITY-encoded: the
 *    `content-encoding` header is removed and `content-length` is recomputed from
 *    the body by the proxy. Chosen over re-encoding because (a) it is the simpler
 *    path with no compressor to run or to get wrong, and (b) what the upstream
 *    receives is then exactly the bytes that were scanned. A re-encode would
 *    leave the upstream's decoder free to disagree with ours (trailing bytes,
 *    concatenated members) about what the payload is.
 * 2. A leading UTF-8 byte-order mark is NOT touched here: the pipeline parses a
 *    BOM-free view and forwards the original bytes unless redaction rewrote them.
 *
 * Throws {@link RequestBodyRefusal}: an unsupported or undecodable encoding is
 * refused, never forwarded raw.
 */
export function normalizeRequestBody(
  body: Buffer,
  headers: Record<string, string | string[]>,
  maxBytes: number,
): NormalizedRequestBody {
  let out = body;
  let outHeaders = headers;
  const raw = headerValue(headers["content-encoding"]);
  if (raw !== undefined) {
    const codings = raw
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0 && c !== "identity");
    for (const coding of [...codings].reverse()) {
      const decode = DECODERS[coding];
      if (decode === undefined) {
        throw new RequestBodyRefusal(
          415,
          `golem proxy: unsupported request content-encoding "${coding}", so the body ` +
            "cannot be scanned for secrets. Nothing was forwarded; send it uncompressed.",
        );
      }
      try {
        out = decode(out, maxBytes);
      } catch (err) {
        if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw tooLarge(maxBytes, "the decompressed request body");
        }
        throw new RequestBodyRefusal(
          400,
          `golem proxy: the request body is not valid ${coding} data, so it cannot be ` +
            "scanned for secrets. Nothing was forwarded.",
        );
      }
    }
    const { "content-encoding": _removed, ...rest } = headers;
    outHeaders = rest;
  }
  return { body: out, headers: outHeaders };
}
