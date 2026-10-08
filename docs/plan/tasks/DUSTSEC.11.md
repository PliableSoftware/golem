---
task: DUSTSEC.11
title: "owner: user binds the worker lane — workerTargetFromPersona refuses owner:user"
state: queued
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R9 (USER, 2026-10-08); SUMMARY.md S19; DUST1.6 W8, C2; wiki Persona Registry"
gate: "Probe: a persona (or task) with owner: user is NOT dispatched by the worker lane — workerTargetFromPersona, selectTarget and resolveCoderRoute refuse it with a clear reason (before: dispatched). owner: agent unchanged. golem verify green by exit code."
touches: [src/inference/personas.ts, src/inference/target-dispatcher.ts, src/inference/coder-route.ts, tests]
created: 2026-10-08
---

## What this is

The wiki and `persona-lane` say a `user`-owned persona is "a role only a human fills; nothing may
dispatch it", but `workerTargetFromPersona` (`src/inference/personas.ts:190`, SUMMARY S19 cites
`:183-197`) deliberately ignores the permission axis; callers at
`src/inference/target-dispatcher.ts:733` and `src/inference/coder-route.ts:37`.

**USER decision (verbatim, R9):** `owner: user` BINDS the worker lane: `workerTargetFromPersona`
must refuse owner:user tasks.

## The work

1. Make the refusal live in one place (`workerTargetFromPersona`) and have every caller surface
   it — no caller may route around it by falling back to a default target.
2. Remove the comment that says the permission axis is ignored on purpose.
3. Tests per the gate, at each caller.

## Hard rules

- `src/interfaces/` frozen: if a persona/task type changes, update contract tests and flag dependents.

## Out of scope

- Agent-definition generation (`.claude/agents/`), persona wiki wording (DUST2.7).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.
