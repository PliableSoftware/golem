/**
 * DUSTSEC.19 / DUSTSEC.21 — redaction ONLY, over every request body that is not
 * the Messages API object the full pipeline understands.
 *
 * `redactAnyBody` is what the pipeline falls back to for: any non-messages route,
 * a messages-route body that is an array or a bare JSON scalar, and any body that
 * is not JSON at all. It adds redaction and nothing else (no compression, policy,
 * observers or stages), using the SAME rules in the SAME order as stage 1.
 *
 * Body classes (DUSTSEC.21 design decision, see the task doc):
 * - JSON under ANY label (including a binary label): every string value is walked.
 * - OPAQUE, forwarded UNCHANGED, only when the body is not JSON and either
 *   (a) its label is a known-binary one (image/*, audio/*, video/*, font/*,
 *   multipart/*, octet-stream, pdf, archives, protobuf/grpc), or (b) it is
 *   unlabelled/unknown/text-labelled and starts with a known binary magic
 *   signature. Binary cannot be scanned reliably and a rewrite would corrupt it,
 *   so it is NOT redacted. The label is client-chosen: a client can pick a
 *   binary label to skip scanning non-JSON text. Accepted by design.
 * - Everything else is TEXT, NUL bytes or not, and is redacted losslessly.
 * - UTF-16/32 text cannot be scanned as bytes: a non-opaque body that shows
 *   UTF-16/32 shape anywhere is REFUSED by throwing (the proxy turns a throw into
 *   its fail-closed 502).
 * - A JSON body with duplicate object keys is guarded: `JSON.parse` keeps the
 *   LAST value, so a secret in a shadowed first value would otherwise survive.
 */

import type { ProxyRequest } from "../proxy/types.js";
import { redactRequestBody, redactStandaloneText } from "./redaction.js";

const BINARY_LABEL =
  /^(?:multipart\/|image\/|audio\/|video\/|font\/|application\/(?:octet-stream|pdf|zip|gzip|x-gzip|x-tar|x-7z-compressed|x-bzip2|vnd\.rar|wasm|protobuf|x-protobuf|grpc))/;

const FORM_TYPE = "application/x-www-form-urlencoded";

const MAGIC: ReadonlyArray<readonly number[]> = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x50, 0x4b, 0x05, 0x06], // ZIP (empty)
  [0x1f, 0x8b], // gzip
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x52, 0x61, 0x72, 0x21], // Rar!
  [0x52, 0x49, 0x46, 0x46], // RIFF (WebP, WAV, AVI)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x42, 0x5a, 0x68], // bzip2
  [0x28, 0xb5, 0x2f, 0xfd], // zstd
  [0x00, 0x61, 0x73, 0x6d], // wasm
  [0x4f, 0x67, 0x67, 0x53], // Ogg
  [0x49, 0x44, 0x33], // MP3 (ID3)
];

function hasBinaryMagic(body: Buffer): boolean {
  if (MAGIC.some((sig) => sig.every((byte, i) => body[i] === byte))) return true;
  // ISO base media (MP4/MOV): "ftyp" at offset 4.
  return body.length >= 8 && body.toString("latin1", 4, 8) === "ftyp";
}

function headerOf(request: ProxyRequest, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value.join(",") : (value ?? "")).toLowerCase();
}

/** A view of the body without a leading UTF-8 byte-order mark (the body itself is never altered). */
export function stripUtf8Bom(body: Buffer): Buffer {
  return body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf
    ? body.subarray(3)
    : body;
}

/** Parse a request body as JSON (any value), tolerating a UTF-8 BOM. Throws if it is not JSON. */
export function parseJsonBody(body: Buffer): unknown {
  return JSON.parse(stripUtf8Bom(body).toString("utf8"));
}

/**
 * True when any JSON object in the body repeats a key. A byte scanner, not a
 * parse: `{`, `}`, `[`, `]`, `,` and `"` are ASCII and never occur inside a
 * UTF-8 multibyte sequence, so it needs no decode and no copy.
 */
export function hasDuplicateKeys(body: Buffer): boolean {
  interface Frame {
    keys: Set<string> | null; // null: an array
    expectKey: boolean;
  }
  const stack: Frame[] = [];
  const n = body.length;
  for (let i = 0; i < n; i += 1) {
    const c = body[i];
    if (c === 0x22) {
      const start = i + 1;
      let j = start;
      let escaped = false;
      while (j < n && body[j] !== 0x22) {
        if (body[j] === 0x5c) {
          escaped = true;
          j += 1;
        }
        j += 1;
      }
      const top = stack[stack.length - 1];
      if (top?.keys && top.expectKey) {
        let key = body.toString("utf8", start, j);
        if (escaped) {
          try {
            key = JSON.parse(`"${key}"`) as string;
          } catch {
            // malformed: leave the raw form; JSON.parse of the body would fail anyway
          }
        }
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (c === 0x7b) {
      stack.push({ keys: new Set(), expectKey: true });
    } else if (c === 0x5b) {
      stack.push({ keys: null, expectKey: false });
    } else if (c === 0x7d || c === 0x5d) {
      stack.pop();
    } else if (c === 0x2c) {
      const top = stack[stack.length - 1];
      if (top?.keys) top.expectKey = true;
    }
  }
  return false;
}

/**
 * Duplicate-key guard. `JSON.parse` keeps the last value of a repeated key, so a
 * walk of the parsed value never sees a secret in a shadowed earlier one, while
 * the original bytes still carry it. When (and only when) the body has duplicate
 * keys, run the text redactor over the raw text: a changed result is used if it
 * still parses as JSON, otherwise the request is refused (throws). Returns the
 * same request when there is nothing to do.
 */
export function guardDuplicateKeys(request: ProxyRequest): ProxyRequest {
  const body = request.body;
  if (body === null || !hasDuplicateKeys(body)) return request;
  const text = stripUtf8Bom(body).toString("utf8");
  const out = redactStandaloneText(text);
  if (out === text) return request;
  const candidate = Buffer.from(out, "utf8");
  try {
    JSON.parse(out);
  } catch {
    throw new Error(
      "JSON body with duplicate keys holds a secret and could not be redacted as valid JSON; refusing it",
    );
  }
  return { ...request, body: candidate };
}

function isWideEncoded(body: Buffer, contentType: string): boolean {
  if (/charset\s*=\s*"?(?:utf-?(?:16|32)|ucs-?[24])/.test(contentType)) return true;
  const [a, b, c, d] = body;
  return (
    (a === 0xff && b === 0xfe) || // UTF-16LE / UTF-32LE BOM
    (a === 0xfe && b === 0xff) || // UTF-16BE BOM
    (a === 0x00 && b === 0x00 && c === 0xfe && d === 0xff) // UTF-32BE BOM
  );
}

const WINDOW = 1024;

/**
 * UTF-16/32 without a byte-order mark, anywhere in the body: in any 1 KiB window
 * (stepping by half a window, so a boundary cannot hide a run), a dense run of
 * NULs at consistently even or odd offsets (UTF-16), or NULs making up most of
 * the window (UTF-32). A lone NUL, or a few, is not enough.
 */
function looksLikeWideText(body: Buffer): boolean {
  const step = WINDOW / 2;
  for (let start = 0; start < body.length; start += step) {
    const end = Math.min(body.length, start + WINDOW);
    const n = end - start;
    if (n < 16) break;
    let even = 0;
    let odd = 0;
    for (let i = start; i < end; i += 1) {
      if (body[i] === 0) {
        if ((i - start) % 2 === 0) even += 1;
        else odd += 1;
      }
    }
    const major = Math.max(even, odd);
    const minor = Math.min(even, odd);
    if (major >= 8 && major >= 0.3 * (n / 2) && minor <= 0.1 * major) return true; // UTF-16
    if (even + odd >= 8 && even + odd >= 0.6 * n) return true; // UTF-32, NUL-dominated
    if (end === body.length) break;
  }
  return false;
}

/**
 * Sparse UTF-16: a secret short enough that NULs are a tiny share of the body.
 * Decode the whole body as UTF-16 at both byte alignments and both endiannesses;
 * if the text redactor finds a secret in any view, the body is UTF-16 holding one.
 */
function wideViewHoldsSecret(body: Buffer): boolean {
  for (const offset of [0, 1]) {
    const view = body.subarray(offset, body.length - ((body.length - offset) % 2));
    if (view.length < 2) continue;
    const le = view.toString("utf16le");
    if (redactStandaloneText(le) !== le) return true;
    const be = Buffer.from(view).swap16().toString("utf16le");
    if (redactStandaloneText(be) !== be) return true;
  }
  return false;
}

function decodeText(body: Buffer): { text: string; lossless: "utf8" | "latin1" } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), lossless: "utf8" };
  } catch {
    // Not valid UTF-8 (a hostile or odd client). latin1 maps every byte to one
    // character and back, so every byte outside a redaction survives untouched.
    return { text: body.toString("latin1"), lossless: "latin1" };
  }
}

function redactEncodedPart(part: string): string {
  if (!part.includes("%")) return part;
  let decoded: string;
  try {
    decoded = decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    return part;
  }
  const redacted = redactStandaloneText(decoded);
  return redacted === decoded ? part : encodeURIComponent(redacted);
}

/** Decode, redact and re-encode only the percent-encoded names/values that held a secret. */
function redactFormPairs(text: string): string {
  return text
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return redactEncodedPart(pair);
      return `${redactEncodedPart(pair.slice(0, eq))}=${redactEncodedPart(pair.slice(eq + 1))}`;
    })
    .join("&");
}

/**
 * Redact one request body of any shape. Returns the same request object (original
 * bytes, byte-order mark included) when nothing was found. Throws only to REFUSE a
 * body that cannot be scanned.
 */
export function redactAnyBody(input: ProxyRequest): ProxyRequest {
  const body = input.body;
  if (body === null || body.length === 0) return input;

  const contentType = headerOf(input, "content-type");
  const mime = contentType.split(";")[0]?.trim() ?? "";

  // JSON first, whatever the label says (a client may send JSON as text/plain, or
  // under a binary label): only a body that does NOT parse as JSON reaches the
  // opaque rules below.
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = parseJsonBody(body);
  } catch {
    isJson = false;
  }
  if (isJson) {
    const request = guardDuplicateKeys(input);
    if (request !== input) {
      parsed = parseJsonBody(request.body as Buffer);
    }
    const redacted = redactRequestBody(parsed);
    if (redacted.count === 0) return request;
    return { ...request, body: Buffer.from(JSON.stringify(redacted.value), "utf8") };
  }

  // (a) a known-binary label, or (b) a magic signature under no/unknown/text label.
  if (BINARY_LABEL.test(mime)) return input;
  if (!/json/.test(mime) && hasBinaryMagic(body)) return input;

  if (isWideEncoded(body, contentType)) {
    throw new Error(
      "request body is UTF-16/UTF-32 encoded and cannot be scanned for secrets; refusing it",
    );
  }
  if (body.includes(0) && (looksLikeWideText(body) || wideViewHoldsSecret(body))) {
    throw new Error(
      "request body looks UTF-16/UTF-32 encoded and cannot be scanned for secrets; refusing it",
    );
  }

  const { text, lossless } = decodeText(stripUtf8Bom(body));
  let out = redactStandaloneText(text);
  if (mime === FORM_TYPE) out = redactFormPairs(out);
  if (out === text) return input;
  return { ...input, body: Buffer.from(out, lossless) };
}
