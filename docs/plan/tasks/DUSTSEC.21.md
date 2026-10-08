---
task: DUSTSEC.21
title: "Request bodies that are encoded or not JSON bypass redaction, and the redaction walk has no size bound"
state: queued
owner: agent
size: M
discipline: code
design: "Found by the independent review of DUSTSEC.19 (2026-10-08). (1) The proxy never decodes the request body (src/proxy/server.ts, readBody), so a JSON body sent with content-encoding gzip, or one that starts with a UTF-8 byte-order mark, fails JSON.parse and is forwarded unredacted. This was true before DUSTSEC.19 too. (2) A non-JSON body (multipart uploads for the Files API, plain text) is forwarded unchanged, and a test in tests/integration/pipeline-redact-json-bodies.test.ts (case f) now pins that as intended. (3) The redaction walk is synchronous on the request path and readBody has no size cap: measured on a 5,000-request batch (5.6 MB) 410 ms, about 1 second for 8 MB of tokenised text; the cost is linear, so a batch near the API's 256 MB limit would stall the event loop for tens of seconds and freeze every concurrent stream, with several copies of the body in memory."
gate: "Failing-first tests: a gzip-encoded JSON body and a BOM-prefixed JSON body are decoded, redacted, and forwarded in a form the upstream accepts (content-encoding and content-length handled correctly), or refused with a clear error, never forwarded raw; a decision recorded for non-JSON bodies (redact text bodies, or refuse when the content type is unknown and the body is large) with the case-f test updated to match; a body over a configured size limit does not stall the event loop (streamed or chunked walk, or a bounded refusal); golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change."
depends_on: []
touches: [src/proxy/server.ts, src/pipeline/pipeline.ts, tests]
created: 2026-10-08
---

## What this is

Three remaining ways a secret can reach the upstream, or a request can freeze the proxy, after DUSTSEC.19. The non-JSON decision is a design choice: write the decision and the reason in the task before changing behaviour, and say so in the PR.

## Out of scope

- The id false-positive in the long-token rule (DUSTSEC.20).
- Redacting response bodies.
