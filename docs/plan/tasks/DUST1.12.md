---
task: DUST1.12
title: "Dust Phase 1 close-out — merge the eleven audit notes into one classified baseline and the Phase 2/3 input lists"
state: queued
owner: agent
size: M
discipline: review
design: "Dust initiative Phase 1 (USER, 2026-09-25). Inputs are the findings notes from DUST1.1–DUST1.11 at `docs/plan/audit/dust-1/`. Phases are gated: the Phase 1 PR merges before Phase 2 (wiki + spec rebaseline) starts."
gate: "Branch `dust/phase-1` carries all eleven notes plus `docs/plan/audit/dust-1/SUMMARY.md`; every row of every note appears in SUMMARY exactly once (duplicates across partitions merged, conflicting classifications listed for the human); `golem task index --write` leaves ROADMAP.md clean; `golem wiki check` exits 0. No code, wiki, spec or ADR changes."
depends_on: [DUST1.1, DUST1.2, DUST1.3, DUST1.4, DUST1.5, DUST1.6, DUST1.7, DUST1.8, DUST1.9, DUST1.10, DUST1.11]
touches: [docs/plan/audit/dust-1, docs/plan/tasks, docs/plan/ROADMAP.md]
created: 2026-09-25
updated: 2026-09-25
---

## Why this exists

Eleven partitions produce eleven notes; Phase 2 needs one baseline it can act on without
re-reading all of them, and Phase 3 needs one dead-code list it can trust.

## The work

1. Own worktree: `git worktree add ../Golem-dust-phase-1 -b dust/phase-1 development`, then
   merge `dust/DUST1.1` … `dust/DUST1.11` into it. Each touches only its own note, so conflicts
   mean a brief was not followed — report it, do not hand-resolve content.
2. Check each note met its own gate (every owned item classified, evidence present). A gap is a
   finding of this task, listed by partition — not something to fill in here.
3. Write `docs/plan/audit/dust-1/SUMMARY.md`:
   - counts per class, per partition and overall
   - the merged classification table (one row per feature, owning partition named)
   - **Phase 2 inputs** — every `partial` / `not-started` row, with its existing task id or
     `none` (the `none` rows are the task docs Phase 2 must write); every `shipped-but-drifted`
     row, grouped by the wiki page or spec section to update
   - **Phase 3 inputs** — every `dead-or-superseded` and stale-comment row, each marked if it
     touches a CLAUDE.md hard rule (`src/interfaces/`, redaction, proxy byte-faithfulness,
     Headroom adapter) so Phase 3 can treat those with extra care
   - **Contradictions for the human** — merged from all notes, unresolved
4. Mark DUST1.1–DUST1.11 done (`golem task done <id> --note "findings in docs/plan/audit/dust-1/<id>.md"`)
   and this one, then `golem task index --write`.
5. Close-out per CLAUDE.md: `docs/plan/SHIPPED.md` row and a `docs/wiki/debriefs/` debrief for
   the phase. Commit on `dust/phase-1`. Opening the PR (into `development`) is the orchestrating
   session's call.

## Out of scope

- Reclassifying a partition's finding on your own judgement — disagreements go to
  **Contradictions for the human**
- Writing Phase 2 task docs, editing wiki/spec, or deleting code
