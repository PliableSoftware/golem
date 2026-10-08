---
task: DUST3.11
title: "Tasks, spawn gate and delegation ledger: escalated tasks are not re-run locally, the gate honours resetAtIso, ledger writes do not lose updates, `review --waive` needs an id"
state: queued
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.7 rows 8 and 28; DUST1.11 (`task review --waive`); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/tasks/multiplex.ts, src/hooks/spawn-gate.ts, src/hooks/delegation-ledger.ts, src/cli/commands/tasks.ts, tests]
created: 2026-10-08
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-11 -b dust3-11 development`), failing
test first, commit as you go. DUST2.12 also edits `src/cli/commands/tasks.ts` (plan-task
resume). Rebase rather than resolve by hand.

## The work

1. **Row 28: an escalated task is re-serviced locally and marked done** (`src/tasks/multiplex.ts:139,200`).
   `escalateTask` sets `state:"queued", escalated:true`, and `runQueueLocally` filters on
   `state==="queued"` only. Skip `escalated` tasks there.
2. **Row 8a: the spawn gate ignores `resetAtIso`** (`src/hooks/spawn-gate.ts:168-172`). It refuses on
   utilization even after the window has reset. `snooze-nudge.ts:114-115` already checks this;
   match it.
3. **Row 8b: spawn-gate and delegation-ledger read-modify-write races**
   (`spawn-gate.ts:241-268`, `src/hooks/delegation-ledger.ts:98-128`). Writes are atomic, but
   nothing guards load→decide→save. Add a lockfile, or move to append-only records. Test: two
   concurrent recorders both land.
4. **`golem task review --waive` with no id waives every run** (`src/cli/commands/tasks.ts:348-358`,
   `delegation-ledger.ts:185-199`). Require an id, or an explicit `--all`.

## Out of scope

- `spawnResume` failure detection: `dust-comment-pass-code-defects`.
- `golem task resume` for plan tasks, worktree capture, unparseable docs: DUST2.12.
- Quoted scalar titles: `roadmap-generator-quoted-titles`.
