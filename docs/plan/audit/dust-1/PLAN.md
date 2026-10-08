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

## Status (as of 2026-10-08)

**Phase 1: done and merged to `development`.** DUST1.1-DUST1.12 notes and
`SUMMARY.md` are in `docs/plan/audit/dust-1/`.

**Phase 2: task docs written, work not started.** `DUST2.1`-`DUST2.26` (doc
rebaseline and gap tasks), `DUSTSEC.1`-`DUSTSEC.16` (security and decision
code fixes, to land before Phase 3) and `npm-claim-golem-run` (owner: user)
are in `docs/plan/tasks/`. USER decisions are recorded in
`docs/plan/audit/dust-1/DECISIONS.md`.

**Phase 3-5: not started.** Gated on Phase 2 merged.
