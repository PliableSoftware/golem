---
task: DUST4.7
title: Exercise the golem-dust skill's Phase 1 with two live auditors running concurrently
state: queued
owner: agent
size: S
discipline: code
design: docs/plan/audit/dust-4-6-parallel/FINDINGS.md (G8); the skill is src/cli/skills/dust.ts.
gate: Two agents audit two sub-partitions at the same time, each in its own worktree and branch; the two notes merge without conflict and a SUMMARY recounts both tables mechanically; every place the skill was wrong, missing or ambiguous under real concurrency is fixed in src/cli/skills/dust.ts with a test, or filed; no product code changed.
depends_on: [DUST4.6]
touches: [docs/plan/audit, src/cli/skills/dust.ts, .claude/skills/golem-dust, tests/unit/cli/skills.test.ts]
created: 2026-10-20
updated: 2026-10-20
---

## What this is

DUST4.6 ran two partitions in two worktrees, but one agent wrote both notes in turn. What
real concurrency adds was never run: two auditors starting from one base commit, whether the
skill's "do not read earlier audit notes" holds when the other note is appearing, and whether
the per-partition id prefix is enough to keep two live authors from colliding.

## How

1. Dispatch two agents at once, one worktree and branch each (per the parallel-agent isolation
   rule), over two halves of one small doc slice.
2. Merge the branches, recount the SUMMARY with the grep from the skill, compare with each
   note's header.
3. Record each defect; fix wording in the skill or file a task.

## Out of scope

- Phases 2 and 3.
- Fixing any drift the audit finds in the slice.
