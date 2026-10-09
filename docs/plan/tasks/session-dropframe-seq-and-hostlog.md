---
task: session-dropframe-seq-and-hostlog
title: "Session contract and host log: the dropped-subscriber frame carries no seq (amend the frozen contract and the chat client), and the host log rotates by rename"
state: queued
owner: agent
size: M
discipline: code
design: "DUST3.15 (2026-10-08). (1) src/session/transport.ts: when a subscriber is closed for backpressure the synthetic ended frame is stamped seq: cursor + 1, which collides with the next real event on a Last-Event-ID resume; stamping the last real seq instead violates the frozen contract in src/interfaces/session-events.ts line 13 (a seq MUST NOT be reused). Either way needs a decision on a frozen interface (a frame with no seq, or a reserved sentinel, plus a client change in chat-page.ts, which does not dedupe by seq today). (2) src/session/host-log.ts: appendHostLog never trims; trimHostLog has no caller. An automatic trim on append was tried and reverted after review because it is a read-modify-write without a lock and can lose concurrent appends, including turn attribution lines (invariant 4). A safe trim needs a locked or rotate-by-rename design."
gate: "(1) The synthetic ended frame sent when a subscriber is dropped for backpressure carries no seq (or a reserved sentinel, say which), the frozen SessionEvent contract in src/interfaces/session-events.ts is amended with a dated note and its contract tests updated, chat-page.ts handles it, and a test shows a Last-Event-ID resume after a backpressure drop no longer sees a duplicate event id; (2) appendHostLog rotates the host log by RENAME past a configured size (rename the log aside, start a new file, keep N old files, default chosen and documented): no read-modify-write, so no concurrent append is lost, turn attribution lines survive, and a test with concurrent appends over the threshold loses nothing; golem verify exit 0; an independent read-only review before merge (frozen interface and session redaction paths)."
depends_on: []
touches: [src/session/transport.ts, src/session/host-log.ts, src/interfaces/session-events.ts, src/session/chat-page.ts, tests]
created: 2026-10-08
---

## DECIDED (USER, 2026-10-09)

Drop frame: carry no `seq` (or a reserved sentinel), amend the contract, update the client. Host log: rotate by rename (not a locked trim). `docs/plan/audit/dust-1/DECISIONS.md` DROP and LOG. Pick the retention size and file count and write them in the task. The original brief follows.

## What this is (original brief)

Two decisions that the Phase 3 reviews showed cannot be made as a bug fix. Recorded here so they are not rediscovered a third time.

## Out of scope

- Changing either behaviour before the decision.
