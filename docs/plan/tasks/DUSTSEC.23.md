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

## Decision (2026-10-14): A, yield between time-budgeted slices

Measured on this machine (Linux, 4 cores, Node 24.21, 31.9 MB JSON, one object per message holding one short string, about 700,000 strings). The sync walk is the baseline; a ticking `setInterval(5)` and `monitorEventLoopDelay` watch the loop.

| Variant | Wall time | Longest loop stall | Notes |
|---|---|---|---|
| sync walk (today) | 10.5 s | about 10.5 s (timers never fire) | every other session frozen for the whole walk |
| A, yield every 5 ms | 10.8 s (+2.7%) | 13 ms | p99 loop delay 5.8 ms |
| A, yield every 20 ms | 10.7 s (+2.2%) | 22 ms | p99 21.5 ms |
| A, yield every 50 ms | 10.6 s (+1.3%) | 57 ms | p99 51 ms |
| B, worker thread | 11.8 s (+12%) | 142 ms | main thread still stalls to structured-clone the body in (and the result out); 2 full copies resident; worker spawn plus a crash path to make fail-closed |

Parts that cannot be sliced, measured on the same body: `structuredClone` 464 ms, `JSON.stringify` 104 ms, `JSON.parse` 147 ms.

**Choice: A.** One thread, no clone, no crash mode, no second copy of the body, wall time within 3% of sync. B is slower overall and its main-thread stall (the clone, 142 ms) is no better than a 20 ms slice.

**Slice budget: 20 ms of wall time**, checked with `performance.now()` after each string (time-based, so a slice is bounded whatever the string sizes are). Between slices the walk awaits `setImmediate`, which runs after the poll phase, so socket I/O of other sessions is served every slice; it behaves the same on Windows. The stated bound is therefore about 20 ms plus the longest single string, plus the parts that are not sliceable (parse, stringify, one very large single string, which still cost what they cost per call).

**Design.** One walk, written once as a generator (`redactValueSteps`) that yields when the slice budget is spent. The sync `redactRequestBody` drains it with an infinite budget (so it never yields and its output is the same code's output); the async `redactRequestBodyAsync` drives it with the slice budget and an AbortSignal. A differential test checks the two byte for byte anyway.

## Implemented (2026-10-14, branch awaiting independent review)

- `src/pipeline/redaction.ts`: the walk is one generator, `redactValueSteps`; `redactRequestBody` (sync) drains it, `redactRequestBodyAsync` slices it (`REDACTION_SLICE_MS` = 20, `setImmediate`, `AbortSignal`, `RedactionAborted`). Strings are handled inline (no generator per string); sparse arrays keep their holes as `Array.prototype.map` did.
- `src/pipeline/body-redaction.ts`: `redactAnyBodyAsync` beside the unchanged-behaviour `redactAnyBody`; the non-JSON classification is a shared helper, so both take the same refusals.
- `src/pipeline/pipeline.ts`: `process` uses the async walks (stage 1, the post-plugin re-redaction, the non-messages and non-JSON fallbacks); new `redactOnlyAsync`; sync `redactOnly` kept.
- `src/proxy/types.ts` (not `src/interfaces/`, so no frozen contract changed): optional `options.signal` on `process`, optional `redactOnlyAsync`, new `PipelineRunOptions`.
- `src/proxy/server.ts`: passes the abort signal, prefers `redactOnlyAsync`, and on a client abort during the pipeline or the fallback replies nothing, skips the fallback walk and reports `client_gone`.
- Callers left synchronous on purpose: `src/session/conversation-store.ts` (an interface method that is sync), hooks, `redactStandaloneText`. None is on the proxy request path.
- Tests: `tests/unit/pipeline/redaction-async.test.ts` (differential, abort, throw, no leaked timers, stall with the sync version failing the same bound, fairness), `tests/integration/dustsec23-async-redaction.test.ts` (through the proxy: stall, two bodies in flight, hang-up mid-walk, `redactOnlyAsync` preference, fail closed). `tests/contract/` untouched.

Re-measured on the real code (32 MiB body): sync 10.6 s wall, 10.6 s stall; async 10.9 s wall (1.02x), p99 loop delay 20 ms, longest stall 123 to 137 ms (the unsliceable `JSON.stringify` of the token estimate, about 105 ms, plus a slice).

Residual: the stall is bounded by one slice plus `JSON.stringify` / `JSON.parse` / one very long string, not by 100 ms flat; a single large non-JSON text body is still one synchronous scan.
