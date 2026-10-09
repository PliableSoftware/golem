---
task: DUSTSEC.23
title: "The request redaction walk is synchronous, so one large many-small-strings body can freeze the proxy for tens of seconds"
state: queued
owner: agent
size: L
discipline: code
design: "Found by the fact-check and the DUSTSEC.21 reviews (2026-10-09). The JSON walk in src/pipeline/redaction.ts (redactRequestBody and its generic-body caller redactAnyBody in src/pipeline/body-redaction.ts) runs every redaction rule over every string value, synchronously, on the request path. Measured: about 0.7 s per MiB of many small strings; a 32 MiB object with many small values took about 26 s of blocked event loop, which stalls every other session's streams. The redactOnly fail-safe re-runs the whole walk when process fails, so the worst case can repeat. The size limit proxy.max_request_body_bytes (default 32 MiB, DUSTSEC.21) bounds what is admitted, not how long redaction takes."
gate: "A request body of 32 MiB made of many small strings no longer blocks the event loop for more than a small, stated bound (for example 100 ms per slice): the walk yields to the event loop between slices, or runs in a worker thread, with identical output bytes to the synchronous walk on every recorded-shape fixture and on a property test over random JSON; fail-closed behaviour and the redactOnly fail-safe are preserved (an error or a worker crash refuses, never forwards raw); another session's stream shows no stall in a test that measures event-loop delay during a large redaction; tests/contract/ passes untouched; golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change."
depends_on: []
touches: [src/pipeline, src/proxy/server.ts, tests]
created: 2026-10-09
---

## What this is

A denial-of-service shape rather than a leak, but it is reachable by any client that can send a large body. The design choice is between yielding (setImmediate or scheduler between slices, simplest, keeps one thread, the walk becomes async) and a worker thread (isolates the CPU, needs a structured-clone copy of the body and a failure path). Write the choice and the measurements in the task before changing code.

## Out of scope

- Making redaction faster by changing the rules (rule order and rule behaviour must not change).
- Object keys are never redacted (the S9 gap) and the `__proto__` key handling (separate, tracked).
