---
task: DUST2.1
title: "Reword the CLAUDE.md hard rule: \"byte-faithful at compression ≤ 1\" → \"lossless and prefix-stable at level ≤ 1\""
state: queued
owner: agent
size: S
discipline: docs
design: "docs/plan/audit/dust-1/DECISIONS.md C1 (USER, 2026-10-08, approved editing this hard rule); SUMMARY.md contradiction C1; DUST1.1 #6, DUST1.3 #1"
gate: "CLAUDE.md Hard rules line 36 and the line-6 \"byte-faithful proxying\" phrase carry the new wording, with recorded-shape tests still named as the guard; docs/plan/audit/dust-1/PLAN.md Phase 3 hard-rule list matches. No other file changes. golem wiki check green by exit code."
touches: [CLAUDE.md, docs/plan/audit/dust-1/PLAN.md]
created: 2026-10-08
---

## What this is

The first Phase 2 task, because every other doc task cites the new wording. Level-1 dedup
replaces spans with markers, compaction strips whitespace and any rewrite re-serialises the whole
body (`pipeline.ts:753`), so "byte-faithful" is not what level 1 guarantees. The code guarantees
reversibility and prefix stability.

**USER decision (verbatim, C1):** REWORD the hard rule (CLAUDE.md) and all docs from
"byte-faithful at compression <= 1" to "lossless and prefix-stable at level <= 1". USER approved
editing that hard rule. Recorded-shape tests keep guarding it. Make the CLAUDE.md edit its own
tiny task.

## The work

1. `CLAUDE.md:36` → `Proxy lossless and prefix-stable at level ≤ 1. Pipeline changes need
   recorded-shape tests` (keep the second sentence).
2. `CLAUDE.md:6` "byte-faithful proxying" → "lossless, prefix-stable proxying".
3. `docs/plan/audit/dust-1/PLAN.md` Phase 3 hard-rule list (it repeats the old wording).
4. Leave the `golem-run` mention on line 6 alone — DUSTSEC.16 owns it.

## Out of scope

- Every other doc (DUST2.2 spec, DUST2.3 ADRs, DUST2.4 wiki, DUST2.9 README) and code comments
  (DUST2.10). Other CLAUDE.md drift rows (DUST2.9).
- The "Redaction never weakened" and `bypass_all` hard rules: unchanged.

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.
