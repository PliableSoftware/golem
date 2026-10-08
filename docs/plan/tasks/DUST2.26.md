---
task: DUST2.26
title: "Dust Phase 2 close-out — merge the rebaseline branches, regenerate the index, SHIPPED row, debrief"
state: queued
owner: agent
size: S
discipline: review
design: "CLAUDE.md 'Batch close-out'; docs/plan/audit/dust-1/PLAN.md Phase 2; DECISIONS.md"
gate: "All of DUST2.1–DUST2.10 merged into one Phase 2 branch with no lost edits (shared docs: keep both sides; ROADMAP regenerated, never hand-resolved); `golem task index --write` leaves ROADMAP clean; a docs/plan/SHIPPED.md row and docs/wiki/debriefs/<date>-DUST2-rebaseline.md exist; `golem task done` run for each closed task; PLAN.md status updated; `golem verify` and `golem wiki check` green by exit code; PR into development opened by the orchestrator, CI gate green."
depends_on: [DUST2.1, DUST2.2, DUST2.3, DUST2.4, DUST2.5, DUST2.6, DUST2.7, DUST2.8, DUST2.9, DUST2.10]
touches: [docs/plan, docs/wiki/debriefs, docs/plan/SHIPPED.md, docs/plan/ROADMAP.md]
created: 2026-10-08
---

## The work

Follow CLAUDE.md "Batch close-out" in order:

1. Merge each DUST2.n branch (one at a time; re-check mergeability after each). Before removing any
   worktree: `git -C <path> status --short` and confirm the owning agent has finished.
2. `golem verify` (exit code) and `golem wiki check`.
3. `docs/plan/SHIPPED.md` row (that exact path).
4. Debrief `docs/wiki/debriefs/<date>-DUST2-rebaseline.md`: outcome, which DECISIONS.md default
   rules were applied and where, open exceptions (G3, M2, H2, P3, P4), lessons, sources, tags.
5. `golem task done <id> --note "shipped"` for DUST2.1–2.10, then `golem task index --write`.
6. Update `docs/plan/audit/dust-1/PLAN.md` status: Phase 2 done; Phase 3 may start once its PR
   merges AND the DUSTSEC.* tasks have landed (they are the pre-Phase-3 gate).

## Out of scope

- DUST2.11–DUST2.25 are roadmap items, not part of this batch; they stay queued.
- Writing Phase 3/4/5 task docs.
- Pushing/merging to development (the orchestrator does that); `gh pr checks` must show CI gate green before merge.
