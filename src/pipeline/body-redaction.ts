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
 * - A JSON body with duplicate object keys is REFUSED (400): `JSON.parse` keeps
 *   the LAST value, so a secret in a shadowed first value would otherwise survive.
 */

import { RequestBodyRefusal } from "../proxy/request-body.js";
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

/**
 * A magic signature alone is not enough (GIF8, ID3, BZh, %PDF, RIFF, OggS, Rar!
 * and ftyp are printable ASCII, and plain text can start with them). The body must
 * ALSO look binary: a C0 control byte other than tab/newline/carriage return in
 * its first 4 KiB (NUL included), or not valid UTF-8.
 */
function looksBinary(body: Buffer): boolean {
  const n = Math.min(body.length, 4096);
  for (let i = 0; i < n; i += 1) {
    const c = body[i] as number;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    return false;
  } catch {
    return true;
  }
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
 * Duplicate-key refusal. `JSON.parse` keeps the last value of a repeated key, so a
 * walk of the parsed value never sees a secret in a shadowed earlier one, while
 * the original bytes still carry it (and a raw-text redaction cannot help: the
 * secret there may be JSON-escaped). No legitimate client sends duplicate keys
 * (`JSON.stringify` never emits them), so such a body is REFUSED: 400, nothing
 * forwarded. Both `process` and `redactOnly` throw this, and the proxy answers it
 * directly rather than falling back to another path.
 */
export function refuseDuplicateKeys(body: Buffer | null): void {
  if (body !== null && hasDuplicateKeys(body)) {
    throw new RequestBodyRefusal(
      400,
      "golem proxy: the JSON request body repeats an object key (duplicate keys). Parsers " +
        "disagree about which value wins, so a secret could hide in the ignored one. " +
        "Nothing was forwarded.",
    );
  }
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
 * Project the body's ASCII characters out of a UTF-16/32 reading at one byte
 * alignment: a code unit holding an ASCII value becomes that byte, anything else
 * a space (secrets are ASCII; a non-ASCII unit acts as a boundary, as a space
 * does). Done unit by unit with no decode of the whole body.
 */
function asciiView(body: Buffer, unit: 2 | 4, bigEndian: boolean, offset: number): string {
  const count = Math.floor((body.length - offset) / unit);
  const out = Buffer.alloc(count, 0x20);
  for (let u = 0; u < count; u += 1) {
    const at = offset + u * unit;
    const low = bigEndian ? at + unit - 1 : at;
    const v = body[low] as number;
    if (v >= 0x80) continue;
    let zero = true;
    for (let k = 0; k < unit; k += 1) {
      if (at + k !== low && body[at + k] !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) out[u] = v;
  }
  return out.toString("latin1");
}

/**
 * A secret hidden in UTF-16 or UTF-32 text, however sparse (a short wide-encoded
 * secret inside a long ASCII body has almost no NULs, so no density test sees it).
 * Read the whole body as UTF-16 (2 alignments x 2 endiannesses) and UTF-32
 * (4 alignments x 2 endiannesses); if the text redactor finds a secret in any
 * view, the body is wide-encoded and holding one: refuse it.
 */
function wideViewHoldsSecret(body: Buffer): boolean {
  for (const [unit, alignments] of [
    [2, 2],
    [4, 4],
  ] as const) {
    for (let offset = 0; offset < alignments; offset += 1) {
      for (const bigEndian of [false, true]) {
        const view = asciiView(body, unit, bigEndian, offset);
        if (redactStandaloneText(view) !== view) return true;
      }
    }
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
    refuseDuplicateKeys(body);
    const redacted = redactRequestBody(parsed);
    if (redacted.count === 0) return input;
    return { ...input, body: Buffer.from(JSON.stringify(redacted.value), "utf8") };
  }

  // (a) a known-binary label, or (b) a magic signature under no/unknown/text label.
  if (BINARY_LABEL.test(mime)) return input;
  if (!/json/.test(mime) && hasBinaryMagic(body) && looksBinary(body)) return input;

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
