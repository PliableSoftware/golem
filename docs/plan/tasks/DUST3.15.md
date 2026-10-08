---
task: DUST3.15
title: "Session transport and host log: SSE drop frame keeps the cursor, idempotency reserves the id before awaiting, the host log is trimmed, `session forget` rejects a path-escaping id"
state: queued
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.10 D5, D8, `trimHostLog` row, LOW note (session forget); ADR-0007; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop; DUST2.24 session contract suites green."
depends_on: []
touches: [src/session/transport.ts, src/session/join-queue.ts, src/session/host-log.ts, src/session/conversation-store.ts, src/session/session-bus.ts, tests]
created: 2026-10-08
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-15 -b dust3-15 development`), failing
test first, commit as you go. `src/interfaces/` is frozen: fix behind the interfaces.

## The work

1. **D5: the slow-subscriber drop frame desynchronises `Last-Event-ID`** (`src/session/transport.ts:231-235`).
   The synthetic `ended` frame carries `seq: cursor + 1`, so a reconnect skips a real event. Send it
   without an `id:` or with the current cursor. That makes "nothing was lost"
   (`session-bus.ts:111`) true.
2. **D8: idempotency check-then-act races** (`transport.ts:311-345`, `src/session/join-queue.ts:150-185`).
   Lookup and write are separated by awaits. Reserve the message id synchronously (in-memory map
   or exclusive-create file) first. `join-queue` is a redaction path (HR): do not move or skip its
   redaction step.
3. **The host log is unbounded** (`src/session/host-log.ts:111`). `trimHostLog` exists and has no
   caller, and the header (`:22`) claims it is bounded. Call it after `appendHostLog`, throttled.
4. **`session forget <id>` joins an unvalidated id into a path** (`src/session/conversation-store.ts:152,243`).
   `../x` escapes the directory before `rm`. Reject separators and anything outside the id charset.

## NEEDS-USER (proposals only, do not delete)

| item | file:line | evidence | recommendation |
|---|---|---|---|
| `FileJoinQueue.prune` | `src/session/join-queue.ts:284` | No caller and no test; HR area | Wire it on queue open, or delete. User call |
| `listConversations` | `src/session/conversation-store.ts:217`; `src/interfaces/conversation-store.ts:89` | Test-only, but a frozen-interface method | Keep |
| `hostSessionLogPath` as a write target | `src/session/host-registry.ts:33` | Used by cleanup (`:151`), never written | Keep |
| `HostAttachment.attached === true` path | `src/session/host-gate.ts:128` | No caller passes an attachment; pinned by `host-gate.test.ts:84,88` | Keep for the attach feature |

## Out of scope

- `/interrupt` answering 501: DUST2.19.
- D10 (`session host stop` on Windows may leave `claude` running): not reproduced (suspected only,
  needs a Windows run). Listed in the index.
