---
task: DUST1.11
title: "Dust audit — cross-cutting: vision, roadmap and positioning claims, wiki index integrity, and the unowned-code sweep"
state: queued
owner: agent
size: M
discipline: review
design: "Dust initiative Phase 1 (USER, 2026-09-25): read-only audit, one partition per subsystem, feeding the Phase 2 wiki/spec rebaseline. Method and taxonomy are in this brief; ownership map is the DUST1.1–DUST1.12 set. This partition owns what no subsystem does."
gate: "`docs/plan/audit/dust-1/DUST1.11.md` exists on branch `dust/DUST1.11` and classifies every owned spec section, Decision and wiki page below with evidence, lists every src file no DUST1.1–DUST1.10 brief claims, and reports WIKI.md index integrity both ways. Zero changes outside that one file."
depends_on: []
touches: [docs/plan/audit/dust-1]
created: 2026-09-25
updated: 2026-09-25
---

## Why this exists

Phase 1 of the "dust" initiative: shake out drift after heavy development by checking
what the docs *say* against what the code *does*. DUST1.1–DUST1.10 each own a subsystem; this
brief owns the claims that span all of them, and catches whatever fell between their lists.

## Owned scope

- **spec (`docs/golem-spec.md`):** §1 Vision & Goals and Non-goals, §2 Architecture Overview
  (the overall picture — subsystem specifics belong to their partitions), §7 Phased Roadmap,
  §8 Risks & Mitigations, §9 "To verify against live docs" block, and the spec header/version line
- **Decisions:** 20, 21, 32, 36 — and any numbered Decision above 64 or otherwise not listed in a
  DUST1.1–DUST1.10 brief (check; the set there covers 1–64)
- **wiki:** `concepts/Architecture.md`, `concepts/Dogfooding Golem.md`, all of `syntheses/`,
  `questions/`, `sources/`; `WIKI.md`'s Index (every listed page exists, every page is listed,
  descriptions still true of the page)
- **Project prose:** `CLAUDE.md` "What this project is" and "Source of truth"; `README.md`
  feature claims
- **Unowned-code sweep:** every `src/**/*.ts` (non-test) not named by a DUST1.1–DUST1.10 brief —
  `src/cli/commands/` is known unowned — classified like any other feature
- **Plan hygiene:** `docs/plan/tasks/` docs in `queued`/`blocked` state whose work already shipped,
  and `done` docs whose gate the code does not meet — report, never edit the task

Debriefs under `docs/wiki/debriefs/` are dated history, not current claims: do not classify
them, cite them only to explain *when* something drifted.

## Method

1. For each claim in the owned docs, find the implementing code (path:line) and the test that
   pins it. A debrief or task doc is itself a claim, never evidence.
2. Classify each feature with exactly one of:
   - **shipped-and-matches** — code does what the doc says; a test or direct read confirms it
   - **shipped-but-drifted** — shipped, but behaviour, names, defaults or config keys differ
     from the doc (say which side looks right, do not decide)
   - **partial** — some of the described behaviour exists; name the missing part
   - **not-started** — documented as intended/accepted, no implementation
   - **dead-or-superseded** — code or doc for something a later Decision/ADR replaced, or code
     with no live caller/config path (show the grep)
3. For every partial / not-started, name the existing `docs/plan/tasks/` id covering it, or `none`.
4. Note comments that contradict the code beside them (Phase 3 input).

Do NOT run the full test suite (CLAUDE.md R13.17); targeted single-file runs are fine.

## Deliverable

`docs/plan/audit/dust-1/DUST1.11.md`, containing:

- A table: `feature | claim source | code evidence | test evidence | class | note | existing task`
- Sections: **Unowned code**, **WIKI.md index integrity**, **Plan hygiene**, **Stale comments**,
  **Contradictions for the human** (never auto-resolved), **Unverifiable here**

## Isolation

Own worktree first: `git worktree add ../Golem-DUST1.11 -b dust/DUST1.11 development`. Commit
the findings note early and as it grows. Do not open a PR; DUST1.12 collects the branches.

## Out of scope

- Any edit to code, tests, wiki, spec, ADRs, ROADMAP or other task docs
- Re-auditing a subsystem another brief owns — a cross-partition observation goes under a
  **For DUST1.n** heading and nothing more
