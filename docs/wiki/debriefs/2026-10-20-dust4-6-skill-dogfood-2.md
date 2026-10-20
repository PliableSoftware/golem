---
title: "2026-10-20 DUST4.6: second Dust skill dogfood, parallel partitions and a non-Golem repo"
type: debrief
tags: [dust, skills, audit, dogfood]
sources: [docs/plan/tasks/DUST4.6.md, docs/plan/audit/dust-4-6-parallel/SUMMARY.md, docs/plan/audit/dust-4-6-parallel/FINDINGS.md, src/cli/skills/dust.ts]
created: 2026-10-20
updated: 2026-10-20
---

# DUST4.6: second Dust skill dogfood

Follow-up to DUST4.4 in [[Dust Method]].

## Outcome

The Change Ledger page was split into two partitions, each audited in its own worktree and branch, then merged. Recounted across both tables: 20 rows, 16 matches, 4 partial, none drifted, none contradicted. One note's own header disagreed with its table (6/3 against 7/2). A scratch repo with only `golem init` run exposed two Golem-only commands in the skill. Five wording defects were fixed in `src/cli/skills/dust.ts`; no product code changed.

## Default rules applied and where

None: Phase 1 only, nothing was rebaselined.

## Open exceptions

Concurrency between two live auditors is untested; one agent wrote both notes in turn. `golem init` in the scratch repo started a proxy that may still be running.

## What review caught

No independent review: no hard-rule code changed.

## Lessons

- A header count is a claim like any other; the recount is the number.
- Unique id prefixes and per-partition file names are what make the merge and the grep work.
- A skill that names `golem verify` or `golem task index --write` must say what a repo without them does.

## Follow-ups filed

DUST4.7: Phase 1 with two live concurrent auditors (FINDINGS.md G8).
