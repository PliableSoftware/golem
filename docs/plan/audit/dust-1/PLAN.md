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
proxy lossless and prefix-stable at level ≤ 1, no heavyweight native deps. `golem
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

## Status (as of 2026-10-08, night)

**Phase 1: done and merged.** DUST1.1-DUST1.12 notes and `SUMMARY.md`.

**Security batch: done.** `DUSTSEC.1`-`DUSTSEC.18` shipped and independently reviewed twice. `DUSTSEC.10` (R8, no relay-connected signal at the hook) is open for a USER decision, and `npm-claim-golem-run` is open for the user.

**Phase 2: done and merged.** `DUST2.1`-`DUST2.10`, `DUST2.24`, `DUST2.26`. `DUST2.11`-`DUST2.23` are roadmap items and stay queued; `DUST2.25` is blocked on a USER decision. Open contradictions G3, M2, H2, P3, P4 are listed in spec section 10.

**Phase 3: done and merged.** `DUST3.1`-`DUST3.18` (PRs #242-#256). The 25 NEEDS-USER dead-code proposals in `PHASE3-INDEX.md` are not acted on and wait for the user, as does `session-dropframe-seq-and-hostlog`. Follow-ups: `vector-store-lock-and-outside-watch`, `proxy-runtime-webcache-windows-flake`, `dust3-leftovers`.

**Phase 4-5: task docs not yet written.**
