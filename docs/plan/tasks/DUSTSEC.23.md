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

**Design (revised in review round 1, 2026-10-15).** The first cut wrote the walk once as a generator and had the sync walk drain it. Review found that generator frames cost more call stack per level than the old recursion (through the proxy the old code forwarded about 2808 levels of nesting, the generator version about 2144) and that every number, boolean and null allocated a generator. So: the SYNC `redactRequestBody` is the original recursive walk again, byte for byte (so hooks, `redactOnly` and the conversation store are unchanged in depth and speed), and the ASYNC walk is a separate ITERATIVE walk with an explicit stack: no recursion and no generators, primitives handled inline, the clock read every 256 cost units rather than per value. A differential test holds the two to the same bytes.

## Implemented (2026-10-14, revised 2026-10-15 after the first review)

- `src/pipeline/redaction.ts`: sync `redactRequestBody` / `redactValue` restored to the original recursive code (the walk code is identical to development). New `SlicedWalk` (iterative, explicit stack, one-slot root frame, holes preserved as `Array.prototype.map` does, no mutation of the input) behind `redactRequestBodyAsync` (`REDACTION_SLICE_MS` = 20, `setImmediate`, `AbortSignal`). `RedactionPacer` (one per request) yields between the unsliceable steps, but only when 5 ms or more of work ran since its last yield: a small body never yields (and so needs no timer machinery; the local-answer fake-timer tests depend on that). The async result carries `json`, the serialisation it already made for the token estimate, so callers do not stringify twice (same bytes).
- `src/proxy/request-body.ts`: `RedactionAborted` lives here (re-exported from `redaction.ts`), so the proxy can tell an abort from a real error without importing the pipeline.
- `src/pipeline/body-redaction.ts`: `redactAnyBodyAsync`; the non-JSON classification is a shared helper, so both take the same refusals; yields between parse, duplicate-key scan, walk and serialise.
- `src/pipeline/pipeline.ts`: `process` uses the async walks; new `redactOnlyAsync`; sync `redactOnly` kept.
- `src/proxy/types.ts` (not `src/interfaces/`): optional `options.signal` on `process`, optional `redactOnlyAsync`, `PipelineRunOptions`.
- `src/proxy/server.ts`: passes the abort signal and prefers `redactOnlyAsync`. Only a `RedactionAborted` counts as the client having gone (reply nothing, skip the fallback, report `client_gone`); any other pipeline error is reported to `onPipelineError` first, even if the client also left, and still forwards nothing.
- Left synchronous on purpose: `src/session/conversation-store.ts`, hooks, `redactStandaloneText`: not on the proxy request path.
- Tests: `tests/unit/pipeline/redaction-async.test.ts` (differential over random JSON, recorded shapes, primitive-heavy bodies, no-mutation, deep nesting 1k to 4.4k as objects, arrays and mixed, abort, throw, timers, stall, fairness), `tests/integration/dustsec23-async-redaction.test.ts` (through the proxy: stall measured against the sync stall of the same body, two bodies in flight, hang-up mid-walk, depth 2400, a real error vs a hang-up, `redactOnlyAsync` preference, fail closed). `tests/contract/` untouched. Against a scratch checkout of the first cut, the deep-nesting cases at 3500 and 4400 (objects and mixed), the depth-2400 proxy test and the real-error-vs-hang-up test fail.

### Measured (this machine, Linux, 4 cores, Node 24; old = development before this task)

Nesting capacity (deepest body that still comes out redacted; bisected, +-8):

| Shape | old, direct | first cut, direct | now, direct | old, via proxy | first cut, via proxy | now, via proxy |
|---|---|---|---|---|---|---|
| object | 4471 | 2320 | 4471 | 3432 | 2193 | 4466 |
| array | 1763 | 2237 | 4471 | 4340 | 2325 | 4466 |
| mixed | 2325 | 2250 | 4471 | 4387 | 2193 | 4466 |

(Direct is the sync walk for old and the async walk for the others; 4471 is where `JSON.stringify` of the whole body stops, which both versions run first. The via-proxy column is bounded by the rest of the request path, not by redaction. The sync walk is the old code again, so its depth is the old depth.)

Wall time and worst event-loop stall (a 2 ms timer's longest gap), old sync vs async, warm second run, two runs where they differ:

| Body | old wall / stall | async wall | async worst stall | where the stall is |
|---|---|---|---|---|
| 32 MiB, many small strings (walk only) | 10.5 to 11.1 s / the whole walk | 10.4 to 10.6 s (about 1.0x) | 102 to 107 ms | `JSON.stringify` for the token estimate (about 105 ms) |
| same, `redactAnyBody` (with parse) | 11.0 s / the whole walk | 10.9 to 12.4 s (1.0 to 1.13x, noisy; other agents share this box) | 313 to 547 ms | the duplicate-key byte scan (about 300 ms on a body with this many keys) and `JSON.parse` (about 150 ms); each is one call, so they now run in separate turns |
| 31 MB array of numbers (walk only) | 275 ms | 240 ms (0.9x) | 106 ms | `JSON.stringify` before the walk |
| same, `redactAnyBody` | 670 ms | 522 ms (0.8x) | 155 ms | parse |
| one 30 MB string in JSON | 540 to 625 ms | 542 to 600 ms | 485 to 489 ms | the single string: one rule scan cannot be sliced |
| 30 MB non-JSON text | 505 ms | 516 ms | 516 ms | the same, one scan |

So the claim is: a body of many small values never holds the loop for more than a slice (20 ms) plus ONE of the unsliceable calls (up to about 300 ms for the duplicate-key scan on a key-dense 32 MiB body, about 150 ms for the parse, about 105 ms for a stringify); a single huge string, or a huge non-JSON text body, is still one scan of 0.5 s. Not fixed here: slicing the duplicate-key scanner (it is DUSTSEC.21's refusal code) and slicing one rule scan over one string.

### Second review round (2026-10-15)

Bodies made mostly of containers skipped the slice: pushing and finishing a container cost nothing and the clock was read only after a committed value, so `[[],[],...]` ran as one slice (0.8 to 1.1 s stall). Now every iteration is charged (a unit per committed value, per container entered, per container finished; strings add one per 32 characters) and the clock is read at the TOP of the loop. Measured after the fix, 32 MB bodies, sync stall vs async worst stall: `[[],...]` 553 vs 195 ms, `[{},...]` 607 vs 252 ms, 16-deep empty arrays 787 vs 376 ms (the remainder is the one-call `JSON.stringify` of such a body; async wall time 1.2 to 1.3x sync here), numbers array 336 vs 123 ms with async wall 258 ms (at or below the sync 336 ms). New tests fail on the previous commit (4 container-heavy cases) and pass now; the array depth check now also asserts the async walk succeeds at 4400. The wiki and the claim above are corrected: the clock counts containers too, and the worst stall is a slice plus the largest single unsliceable call for that body class, not a flat bound.
