---
task: session-dropframe-seq-and-hostlog
title: "Two frozen-contract decisions DUST3.15 deliberately did not make: the dropped-subscriber frame's seq, and the unbounded host log"
state: queued
owner: user
size: M
discipline: code
design: "DUST3.15 (2026-10-08). (1) src/session/transport.ts: when a subscriber is closed for backpressure the synthetic ended frame is stamped seq: cursor + 1, which collides with the next real event on a Last-Event-ID resume; stamping the last real seq instead violates the frozen contract in src/interfaces/session-events.ts line 13 (a seq MUST NOT be reused). Either way needs a decision on a frozen interface (a frame with no seq, or a reserved sentinel, plus a client change in chat-page.ts, which does not dedupe by seq today). (2) src/session/host-log.ts: appendHostLog never trims; trimHostLog has no caller. An automatic trim on append was tried and reverted after review because it is a read-modify-write without a lock and can lose concurrent appends, including turn attribution lines (invariant 4). A safe trim needs a locked or rotate-by-rename design."
gate: "The user chooses the contract change for the drop frame and the log retention design; then an agent task follows. Until then both stay as they are."
blocked: "USER decision: the drop-frame seq touches a frozen interface; the host-log trim needs a design choice (lock versus rotate-by-rename, and the retention size)."
depends_on: []
touches: [src/session/transport.ts, src/session/host-log.ts, src/interfaces/session-events.ts, src/session/chat-page.ts, tests]
created: 2026-10-08
---

## What this is

Two decisions that the Phase 3 reviews showed cannot be made as a bug fix. Recorded here so they are not rediscovered a third time.

## Out of scope

- Changing either behaviour before the decision.
