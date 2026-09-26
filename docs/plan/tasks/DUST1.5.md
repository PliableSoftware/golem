---
task: DUST1.5
title: "Dust audit — MCP server and local tools: classify every documented claim against the code"
state: done
owner: agent
size: M
discipline: review
design: "Dust initiative Phase 1 (USER, 2026-09-25): read-only audit, one partition per subsystem, feeding the Phase 2 wiki/spec rebaseline. Method and taxonomy are in this brief; ownership map is the DUST1.1–DUST1.12 set."
gate: "`docs/plan/audit/dust-1/DUST1.5.md` exists on branch `dust/DUST1.5` and classifies EVERY owned wiki page claim, spec section, Decision and ADR below with file:line evidence; every owned src file is cited as evidence or listed under Undocumented / Dead candidates. Zero changes outside that one file."
depends_on: []
touches: [docs/plan/audit/dust-1]
created: 2026-09-25
updated: 2026-09-25T23:34:53.819Z
---

## Why this exists

Phase 1 of the "dust" initiative: shake out drift after heavy development by checking
what the docs *say* against what the code *does*. Phases 2–3 (rebaseline, refactor) act on
these findings, so this audit must be evidence, not opinion.

## Owned scope

- **src:** `src/mcp/`, `src/tools/`, `src/bench/`
- **wiki:** `concepts/Tool Search.md`, `concepts/Managed Tools.md`
- **spec:** §2.1 Integration surfaces (MCP half), §3.5
- **Decisions:** 27, 34, 35, 53
- **Also verify:** the registered MCP tool set and names against CLAUDE.md's list (`search`,
  `fetch`, `expand`, `stats`, `ingest`, `coder`) and everything actually registered (`code`,
  `snooze`, `devices`, `wiki_read`, `wiki_upsert`, …) — report both directions of mismatch

Read anything else for context, but classify only what is owned here.

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
3. Reverse sweep: every owned src file — exported behaviour no doc mentions goes under
   **Undocumented**; code with no reachable caller goes under **Dead candidates**.
4. For every partial / not-started, name the existing `docs/plan/tasks/` id covering it, or
   `none` (`golem task list --plan`, grep `touches:`).
5. Note comments that contradict the code beside them (Phase 3 input).

Targeted single-file `npx vitest run <file>` is fine to confirm behaviour; do NOT run the full
suite (CLAUDE.md R13.17).

## Deliverable

`docs/plan/audit/dust-1/DUST1.5.md`, containing:

- A table: `feature | claim source | code evidence | test evidence | class | note | existing task`
- Sections: **Undocumented**, **Dead candidates**, **Stale comments**,
  **Contradictions for the human** (never auto-resolved), **Unverifiable here**

## Isolation

Work in your own worktree, before anything else:
`git worktree add ../Golem-DUST1.5 -b dust/DUST1.5 development`. Commit the findings note
early and as it grows — a subagent cannot park at a usage limit, uncommitted work dies with it.
Do not open a PR; DUST1.12 collects the branches.

## Out of scope

- Any edit to code, tests, wiki, spec, ADRs, ROADMAP or other task docs
- Writing new task docs for gaps (Phase 2 does that from this note)
- Fixing drift you find, however small

## Outcome

audit complete, see docs/plan/audit/dust-1/SUMMARY.md
