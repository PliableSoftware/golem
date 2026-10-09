/**
 * DUSTSEC.19 / DUSTSEC.21 — redaction ONLY, over every request body that is not
 * the Messages API object the full pipeline understands.
 *
 * `redactAnyBody` is what the pipeline falls back to for: any non-messages route,
 * a messages-route body that is an array or a bare JSON scalar, and any body that
 * is not JSON at all. It adds redaction and nothing else (no compression, policy,
 * observers or stages), using the SAME rules in the SAME order as stage 1.
 *
 * Body classes, decided here (DUSTSEC.21 design decision, task doc):
 * - JSON (any value, optional UTF-8 BOM): every string value is walked.
 * - Text (anything not declared opaque that is not binary): the standalone text
 *   redactor runs over the whole body. A form-urlencoded body also has its
 *   percent-encoded names and values decoded, redacted and re-encoded.
 * - Opaque (multipart, octet-stream, image/audio/video, PDF and archive types, or
 *   an unlabelled body containing NUL bytes): forwarded UNCHANGED. Binary payloads
 *   cannot be scanned reliably (a secret may sit inside compressed data, and a
 *   rewrite would corrupt the file), so they are NOT redacted. That is a stated
 *   limit, not an oversight; the request size limit still applies to them.
 * - A body that cannot be read as bytes-to-text at all (a UTF-16/32 byte-order
 *   mark or declared charset): REFUSED by throwing. The proxy turns a throw into
 *   the fail-closed 502, so nothing is forwarded.
 */

import type { ProxyRequest } from "../proxy/types.js";
import { redactRequestBody, redactStandaloneText } from "./redaction.js";

const OPAQUE_TYPE =
  /^(?:multipart\/|image\/|audio\/|video\/|font\/|application\/(?:octet-stream|pdf|zip|gzip|x-gzip|x-tar|x-7z-compressed|x-bzip2|vnd\.rar|wasm|protobuf|x-protobuf|grpc))/;

const FORM_TYPE = "application/x-www-form-urlencoded";

function headerOf(request: ProxyRequest, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value.join(",") : (value ?? "")).toLowerCase();
}

/** A leading UTF-8 byte-order mark makes `JSON.parse` fail; drop it. */
export function stripUtf8Bom(body: Buffer): Buffer {
  return body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf
    ? body.subarray(3)
    : body;
}

/** The request with any leading UTF-8 BOM removed from the body (same object if none). */
export function withoutBom(request: ProxyRequest): ProxyRequest {
  if (request.body === null) return request;
  const stripped = stripUtf8Bom(request.body);
  return stripped === request.body ? request : { ...request, body: stripped };
}

/** Parse a request body as JSON (any value), tolerating a UTF-8 BOM. Throws if it is not JSON. */
export function parseJsonBody(body: Buffer): unknown {
  return JSON.parse(stripUtf8Bom(body).toString("utf8"));
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
 * Redact one request body of any shape. Returns the same request object when
 * nothing was found. Throws only to REFUSE a body that cannot be scanned.
 */
export function redactAnyBody(input: ProxyRequest): ProxyRequest {
  const request = withoutBom(input);
  const body = request.body;
  if (body === null || body.length === 0) return request;

  const contentType = headerOf(request, "content-type");
  const mime = contentType.split(";")[0]?.trim() ?? "";
  if (OPAQUE_TYPE.test(mime)) return request;
  if (isWideEncoded(body, contentType)) {
    throw new Error(
      "request body is UTF-16/UTF-32 encoded and cannot be scanned for secrets; refusing it",
    );
  }

  // JSON first, whatever the label says: a client may send JSON as text/plain.
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = parseJsonBody(body);
  } catch {
    isJson = false;
  }
  if (isJson) {
    const redacted = redactRequestBody(parsed);
    if (redacted.count === 0) return request;
    return { ...request, body: Buffer.from(JSON.stringify(redacted.value), "utf8") };
  }

  if (body.includes(0)) {
    // A NUL byte: binary payload. Unlabelled/unknown binary is opaque; but a body
    // that CLAIMS to be JSON or text and holds NULs may be an encoding we cannot
    // read (UTF-16 with no BOM), so it is refused rather than forwarded unread.
    if (/json|^text\//.test(mime)) {
      throw new Error(
        `request body labelled "${mime}" contains NUL bytes and cannot be scanned for secrets; refusing it`,
      );
    }
    return request;
  }

  const { text, lossless } = decodeText(body);
  let out = redactStandaloneText(text);
  if (mime === FORM_TYPE) out = redactFormPairs(out);
  if (out === text) return request;
  return { ...request, body: Buffer.from(out, lossless) };
}
