# Dust initiative — 5-phase plan

USER-approved plan (session "Golem spec rebaseline and dust skill", 2026-09-25).
Shake out drift after heavy development: verify docs against code, rebaseline,
refactor, then package and derive marketing material. Gated — each phase starts
only after the prior one's PR merges to `development`.

## Phase 1 — Audit (read-only)

Deep-dive the codebase as it stands. For each area in `docs/golem-spec.md` and
`docs/wiki/`, verify implementation matches the written claim. Classify every
feature: shipped-and-matches (M) / shipped-but-drifted (D) / partial (P) /
not-started (N) / dead-or-superseded (X). No code edits.

- Task docs: DUST1.1–DUST1.11 (eleven subsystem partitions), DUST1.12 (close-out:
  merge branches, write `SUMMARY.md`, Phase 2/3 input lists).
- **Deliverable:** `docs/plan/audit/dust-1/DUST1.1.md` … `DUST1.11.md` +
  `SUMMARY.md`.

## Phase 2 — Wiki + spec rebaseline

Update `docs/wiki/` pages to match reality, citing file:line evidence.
Reverse-engineer a new spec from the verified state to replace
`docs/golem-spec.md` (kept as a spec — decisions/contracts/ADR references, not
the ADR log itself; ADRs stay under `docs/decisions/`). For every not-started
or partial feature from Phase 1, write a task doc under `docs/plan/tasks/` per
the existing workflow, then `golem task index --write`.

- **Input:** Phase 1's `SUMMARY.md` → "Phase 2 inputs" section (gaps + drift).
- **Task docs:** not yet written — this is what Phase 2 kickoff produces.

## Phase 3 — Refactor pass (gated on Phase 2 merged)

Using the rebaselined spec as ground truth, remove dead/superseded code and
stale comments. Propose removals before deleting. Respect CLAUDE.md hard
rules: `src/interfaces/` frozen contracts, redaction never weakened/reordered,
proxy byte-faithful at compression ≤ 1, no heavyweight native deps. `golem
verify` green (exit code) before and after.

- **Input:** Phase 1's `SUMMARY.md` → "Phase 3 inputs" section (dead code,
  confirmed bugs).
- **Task docs:** not yet written.

## Phase 4 — "dust" skill

Package the audit → rebaseline → refactor pattern (Phases 1–3) as a
distributable skill, generated into `.claude/skills` the same way the
`golem-*` rules generate from `src/hooks/guidance.ts` — so other
Golem-managed projects can run the same shake-out.

- **Task docs:** none yet.

## Phase 5 — Derived material

Once the spec is stable, generate website/blog-post material (feature
overview, changelog-style narrative) from it. Separate, non-blocking output —
doesn't touch code or wiki structure.

- **Task docs:** none yet.

---

## Status (as of 2026-09-26)

**Phase 1: content complete, not yet merged.**

- All 11 audits (DUST1.1–DUST1.11) done, committed in their own worktrees/branches.
- DUST1.12 close-out done in `D:/Personal/Repos/golem-dust1-phase1` (branch
  `dust/phase-1`, commit `9be1c87`): merged all 11 notes, wrote `SUMMARY.md`,
  clean working tree.
- **Not yet done:** opening the PR from `dust/phase-1` into `development`.
  `golem task done` for DUST1.1–1.12 and `golem task index --write` — check
  whether the close-out commit already did this before opening the PR.
- **Overall findings (800 rows, 791 classified, 746 distinct features after
  dedup):** 436 M (55%) · 194 D (25%) · 70 P · 43 N · 48 X. 13 cross-partition
  groups disagree (12 real conflicts X1–X12, 1 deferred).
- SUMMARY.md flags 5 HIGH-severity security findings recommended to fix
  out-of-band *before* Phase 3 starts, plus 1 more not reachable until R14.2
  ships.

**Phase 2–5: not started.** No task docs exist yet. Phase 2 task docs get
written from Phase 1's `SUMMARY.md` once that PR is reviewed/merged.

### Next step
Review `dust/phase-1` (11 findings notes + `SUMMARY.md`), decide the 12 X1–X12
conflicts, then open the PR into `development`.
