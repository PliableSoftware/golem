---
task: DUST2.24
title: "Contract suites for frozen session interfaces and recorded-shape tests for lossless/prefix-stable level ≤ 1"
state: queued
owner: agent
size: M
discipline: code
design: "CLAUDE.md hard rules (as reworded by DUST2.1); SUMMARY.md Gaps 1.1/r098, r106, r107, r108 (P) HR"
gate: "tests/contract/ holds suites for ConversationStore (redact before disk), JoinQueue (redact on enqueue, atomic claim) and SessionEvent* (seq, idempotent); recorded-shape tests prove level ≤ 1 output is lossless (CCR-reversible) and prefix-stable across turns. Known failures (S10 idempotence) are marked expected-fail with the Phase 3 reference, not hidden. golem verify green by exit code."
depends_on: [DUST2.1]
touches: [tests/contract, tests/integration, src/interfaces]
created: 2026-10-08
---

## What this is

Frozen contracts in `src/interfaces/` (`conversation-store.ts`, `join-queue.ts`,
`session-events.ts`) have unit tests only; `SessionEvent` has no traced implementation (DUST1.1
rows 106-108). r098: any redaction or level-1 dedup re-serialises the whole body
(`pipeline.ts:753`); under C1 the bar is lossless + prefix-stable, and this task gives it tests.

## Hard rules

- Tests only; no interface type changes. If a contract is unimplementable as written, report it.

## Out of scope

- Fixing S9/S10 (Phase 3).
