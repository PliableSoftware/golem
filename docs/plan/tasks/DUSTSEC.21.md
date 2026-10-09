---
task: DUSTSEC.21
title: "Request bodies that are encoded or not JSON bypass redaction, and the redaction walk has no size bound"
state: done
owner: agent
size: M
discipline: code
design: "Found by the independent review of DUSTSEC.19 (2026-10-08). (1) The proxy never decodes the request body (src/proxy/server.ts, readBody), so a JSON body sent with content-encoding gzip, or one that starts with a UTF-8 byte-order mark, fails JSON.parse and is forwarded unredacted. This was true before DUSTSEC.19 too. (2) A non-JSON body (multipart uploads for the Files API, plain text) is forwarded unchanged, and a test in tests/integration/pipeline-redact-json-bodies.test.ts (case f) now pins that as intended. (2b) A JSON array or a bare JSON scalar sent to POST /v1/messages is never redacted: both process and redactOnly in src/pipeline/pipeline.ts return early when the body is not an object and neither falls through to redactJsonBody (found by the second fact-check of the marketing drafts). The upstream rejects such a body, but it still receives it. (3) The redaction walk is synchronous on the request path and readBody has no size cap: measured on a 5,000-request batch (5.6 MB) 410 ms, about 1 second for 8 MB of tokenised text; the cost is linear, so a batch near the API's 256 MB limit would stall the event loop for tens of seconds and freeze every concurrent stream, with several copies of the body in memory."
gate: "Failing-first tests: a gzip-encoded JSON body and a BOM-prefixed JSON body are decoded, redacted, and forwarded in a form the upstream accepts (content-encoding and content-length handled correctly), or refused with a clear error, never forwarded raw; a decision recorded for non-JSON bodies (redact text bodies, or refuse when the content type is unknown and the body is large) with the case-f test updated to match; a body over a configured size limit does not stall the event loop (streamed or chunked walk, or a bounded refusal); golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change."
depends_on: []
touches: [src/proxy/server.ts, src/pipeline/pipeline.ts, tests]
created: 2026-10-08
updated: 2026-10-09T07:36:54.717Z
---

## What this is

Three remaining ways a secret can reach the upstream, or a request can freeze the proxy, after DUSTSEC.19. The non-JSON decision is a design choice: write the decision and the reason in the task before changing behaviour, and say so in the PR.

## Out of scope

- The id false-positive in the long-token rule (DUSTSEC.20).
- Redacting response bodies.

## Design decisions (2026-10-09)

Written before behaviour changed; reviewed by an independent reader before merge.

**Encoded bodies.** The proxy decodes `content-encoding` gzip, x-gzip, deflate (zlib-wrapped, falling back to raw deflate) and br (stacked
codings in reverse order) right after reading the body, and forwards the decoded body
**identity-encoded**: `content-encoding` removed, `content-length` recomputed. Chosen over
re-encoding because it needs no compressor, and because the upstream then receives exactly the bytes
that were scanned (a re-encode lets a second decoder disagree with ours about trailing bytes or
concatenated members). Unsupported coding: 415. Undecodable body: 400. Neither is forwarded.
With `proxy.bypass_all` nothing is decoded (byte-faithful, unchanged).

**BOM.** A leading UTF-8 BOM is stripped for parsing and is NOT restored on forward (the proxy and
the pipeline both strip it). UTF-16/32 (BOM or declared charset, or NUL bytes in a body labelled
JSON or text) cannot be scanned and is refused: the pipeline throws, `redactOnly` throws, the proxy
answers its existing fail-closed 502.

**Non-object JSON on the messages route.** An array or bare scalar goes through the same generic
walker as other routes: redaction only.

**Non-JSON bodies.**
- Text (anything not declared opaque and without NUL bytes, including a body labelled JSON that does
  not parse): the standalone text redactor runs over the whole body. Valid UTF-8 is redacted as
  UTF-8; invalid UTF-8 is redacted as latin1 so every other byte survives and invalid bytes cannot be
  used to dodge the scan. `application/x-www-form-urlencoded` also gets percent-encoded names/values
  decoded, redacted and re-encoded.
- JSON under ANY label (octet-stream, image/*, multipart/*, PDF...) is walked as JSON first; only a body that does not parse as JSON reaches the opaque rule (review finding 1).
- Opaque (when not JSON: multipart/*, octet-stream, image/audio/video/font, PDF and archive types, protobuf/grpc,
  or an unlabelled body with NUL bytes that is not UTF-16/32 shaped): forwarded UNCHANGED. UTF-16/32 without a BOM is detected by NUL parity/proportion in the first 4 KiB and refused (review finding 2). **Opaque binary bodies are not
  redacted**: a secret can sit inside compressed or encoded data, and rewriting would corrupt the
  file. This includes text fields inside a multipart upload. Case (f) of
  `pipeline-redact-json-bodies.test.ts` now pins text redaction, and (f2) pins multipart unchanged.

**Size limit.** `proxy.max_request_body_bytes`, default 32 MiB (the Messages API request limit), positive integer with a 256 MiB ceiling in the schema (no unlimited
value), enforced on the declared `content-length` before reading, while streaming a chunked body,
and on decompressed output. 413, nothing forwarded. The redaction walk itself stays synchronous:
measured 803 ms for a 3.9 MB body with 35,000 secrets, 109 ms for 5 MB of text, and (review) 4.7 s for 49 MiB of JSON with 425k secrets, so the limit
bounds the worst stall rather than removing it. The walk is still synchronous. On the messages path a failed `process` re-walks in `redactOnly`; that double walk was NOT removed, because skipping it safely would need proof that redaction had completed before the failure, and fail-closed matters more than the stall. Total buffered request bytes across concurrent requests are capped (ProxyServerOptions.maxInFlightBodyBytes, default max(256 MiB, 2x the body limit), wire plus decoded form): over it, 503 with Retry-After and nothing forwarded. A streamed or worker-thread walk is not done here.

### Second review round (2026-10-09)

**Classification, restated.** A body is OPAQUE (forwarded unchanged) only when it does not parse as
JSON AND either (a) its label is known-binary (image/*, audio/*, video/*, font/*, multipart/*,
octet-stream, pdf, archives, protobuf/grpc) or (b) it has no, an unknown, or a text label and starts
with a known binary magic signature (PNG, JPEG, GIF, PDF, ZIP, gzip, 7z, RAR, RIFF, ELF, bzip2, zstd,
wasm, Ogg, MP3, MP4 ftyp). Every other body is TEXT whether or not it holds NUL bytes (a NUL never
makes a body opaque) and is redacted losslessly (UTF-8, or latin1 when not valid UTF-8). **A client
can still choose a known-binary label to avoid scanning non-JSON text, and a body that starts with a
known magic signature AND has a C0 control byte (other than tab, newline, CR) or invalid UTF-8 in its
first 4 KiB is likewise forwarded unscanned.** Both are accepted by design: binary cannot be scanned
reliably and the label and the leading bytes are client-chosen. Claude Code always labels JSON as
JSON, and JSON under any label is still walked.

**UTF-16/32.** A non-opaque, non-JSON body containing NULs is scanned over its WHOLE length in 1 KiB
windows (half-window steps): dense NULs at a consistent parity, or NUL-dominated windows, are
refused. Independently of density, the body is read as UTF-16 (2 alignments x 2 endiannesses) and
UTF-32 (4 alignments x 2 endiannesses), 12 views in all, each projected to its ASCII characters, and
refused if the text redactor finds a secret in any view. That catches a short wide-encoded secret in
a large body and mostly-CJK text. The refusal is a `RequestBodyRefusal(502)` (status kept at 502),
so the proxy answers it directly and `redactOnly` does not repeat the scan. Bodies that are opaque
(a known-binary label, or a magic signature plus a binary look) are never refused or altered by this
check. Cost: it runs only on NUL-bearing non-opaque non-JSON bodies.

**Duplicate JSON keys (revised in round 3).** `JSON.parse` keeps the last value, so the walk missed a
secret in a shadowed first value while the original bytes were forwarded. A raw-text redaction pass
(the round-2 approach) does not work: the secret there may be JSON-escaped and match nothing. A byte
scanner (escaped key spellings included) now finds repeated keys and the body is REFUSED: 400, nothing
forwarded. No legitimate client sends duplicate keys (`JSON.stringify` never emits them). `process`
and `redactOnly` both throw `RequestBodyRefusal(400)` and the proxy answers it directly. The
raw-text pass is removed.

**BOM.** The BOM is stripped only from the view used for parsing. An unchanged body is forwarded with
its original bytes (BOM included); a rewritten body is re-serialised without it.

**In-flight cap.** The reservation is released once the final upstream response headers arrive (the
retry loop has ended and nothing replays the body afterwards) and on close. The released bytes are
still referenced by the request until the response ends, so this bounds admission, not the resident
set of requests already streaming.

**`proxy.bypass_all`.** The size limit and the in-flight cap still apply in bypass mode, as
memory-safety guards. Nothing is decoded, scanned or redacted in bypass mode; "full bypass" is not
a way past the limits. The `golem-bypass` skill text now says so.

### Third review round (2026-10-09)

- **Sparse wide text.** The decode check reads the whole body as UTF-16 (2 alignments x 2
  endiannesses) and UTF-32 (4 alignments x 2 endiannesses) by projecting each code unit's ASCII value
  (anything else becomes a space) and refusing if the text redactor finds a secret in any view. It does
  not depend on the NUL ratio. Measured on a 32 MiB text body containing one NUL: 3.3 s in total, 0.8 s
  of it the ordinary text pass, so about 2.5 s extra, paid only by NUL-bearing non-opaque non-JSON bodies.
- **Magic signatures.** A signature makes a body opaque only if the body also looks binary (a C0
  control byte other than tab/newline/CR in the first 4 KiB, or not valid UTF-8). GIF8, ID3, BZh, %PDF,
  RIFF, OggS, Rar! and ftyp are printable ASCII, so printable text starting with them is TEXT and is
  redacted. Consequence: an uncompressed PDF whose first 4 KiB are all printable and sent with no
  label is redacted as text rather than forwarded untouched; a PDF with the usual binary comment line,
  or any PDF labelled application/pdf, is unaffected. More generally, an unlabelled, all-printable
  PDF (or other binary that looks printable in its first 4 KiB) is redacted as TEXT, which can alter
  its bytes and break the file, because the proxy cannot tell it apart; Claude Code does not send
  unlabelled PDFs.
- **Limits stated plainly.** The 32 MiB default bounds ADMISSION, not stall time: the JSON walk
  is synchronous at roughly 0.7 s per MiB on bodies made of many small strings, so a pathological
  32 MiB body can block the event loop for tens of seconds, and `redactOnly` can repeat the walk.
  Fixing that needs an asynchronous or worker-thread walk (follow-up). Likewise the in-flight cap bounds
  admission, not memory: a streaming request stops counting once response headers arrive while its
  buffers stay resident until the response ends.
- **Follow-ups, not fixed here.** (1) asynchronous or worker-thread redaction walk. (2) Object KEYS
  are never redacted (the S9 gap): a secret used as a key is forwarded. (3) `redactValue` in
  `src/pipeline/redaction.ts` assigns `out[key] = next`; a `__proto__` key sets the prototype of `out`
  and the member is silently dropped when a sibling is redacted (pre-existing).

## Outcome

shipped (PR 276); four independent review passes
