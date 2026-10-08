---
task: DUST4.6
title: "Exercise the golem-dust skill's parallel-partition and recount steps, and its non-Golem-layout assumptions, which the DUST4.4 dogfood did not reach"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-4-dogfood/ (DUST4.4 audit note); the skill is src/cli/skills/dust.ts."
gate: "A Phase 1 run with two sub-partitions in two worktrees produces two notes and one SUMMARY whose counts equal a mechanical recount across both tables; a second run in a scratch repo with only `golem init` run in it records which skill steps assume Golem tooling; each defect is fixed in src/cli/skills/dust.ts with tests or filed; no product code changed."
depends_on: [DUST4.4]
touches: [docs/plan/audit, src/cli/skills/dust.ts, .claude/skills/golem-dust, tests/unit/cli/skills.test.ts]
created: 2026-10-08
---

## What this is

DUST4.4 ran Phase 1 on one partition, so three steps of the skill were only read,
never run: parallel worktrees (one HEAD per auditor), merging two notes, and
recounting a SUMMARY across more than one table. It also ran inside this repo, so
the skill's Golem-specific references (`golem task index --write`, `/golem-park`,
`golem verify`) were never tried where they might not exist.

## How

1. Split a slice into two sub-partitions (for example the CLI surface and the
   store of one subsystem), one worktree and one branch each, auditors in parallel.
2. Recount the SUMMARY from both tables with a command, then compare with each
   note's own header counts.
3. Repeat Phase 1 in a scratch repo that has only had `golem init` run.
4. Record each place the skill was wrong, missing or ambiguous; fix small wording
   in `src/cli/skills/dust.ts` (with `tests/unit/cli/skills.test.ts`, regenerated
   `.claude/skills/golem-dust/SKILL.md` and its hash in `.golem/managed-files.json`)
   or file a task.

## Out of scope

- Phases 2 and 3.
- Fixing any drift the audit finds in the slice.
