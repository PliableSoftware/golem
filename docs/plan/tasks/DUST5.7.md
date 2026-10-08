---
task: DUST5.7
title: "Close Dust Phase 5: SHIPPED row, debrief, PLAN.md status"
state: queued
owner: agent
size: S
discipline: write
design: "CLAUDE.md 'Batch close-out'; .claude/rules/golem-close-out-checklist.md; docs/plan/audit/dust-1/PLAN.md Status section."
gate: "docs/plan/SHIPPED.md has one row for DUST5.1-DUST5.6 that says the drafts are unpublished; a debrief in docs/wiki/debriefs/ (listed in WIKI.md) uses the /golem-dust debrief template; PLAN.md Status says Phase 5 drafts are done and publishing waits on DUST5.8; DUST5.1-DUST5.6 closed with `golem task done`; `golem task index --write` run; `golem wiki check` exit 0; golem verify exit 0."
depends_on: [DUST5.6]
touches: [docs/plan/SHIPPED.md, docs/wiki/debriefs, docs/wiki/WIKI.md, docs/plan/audit/dust-1/PLAN.md, docs/plan/ROADMAP.md]
created: 2026-10-08
---

## What this is

Batch close-out for Phase 5. Record the REVIEW.md verdict and any banned-claim near misses as lessons.

## Out of scope

- DUST5.8 (publishing is the user's).
