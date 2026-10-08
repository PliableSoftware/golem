---
task: DUST2.12
title: "Plan-task tooling: never drop an unparseable doc silently, `golem task resume` for plan tasks, worktree capture"
state: queued
owner: agent
size: M
discipline: code
design: "wiki Plan Tasks; spec Decisions 38, 55; SUMMARY.md Gaps 1.7/r025 (P), r027 (P), r029 (N); hygiene :760-762"
gate: "`golem task list`/`index` report every doc they cannot parse (path + reason) instead of skipping it; `golem task resume <plan-id>` works for plan-scope tasks; a parked task records its git worktree; tests for each. golem verify green by exit code."
touches: [src/tasks, src/cli/commands, tests]
created: 2026-10-08
---

## What this is

Roadmap gap. `PlanTaskStore.list()` skips docs it cannot parse, which hid four task docs
(including open bug R8.29) from ROADMAP (DUST1.7 row 25). Resume and worktree capture are
partial/not started (rows 27, 29).

## The work

1. r025: surface parse failures (warning in `list`, non-zero or loud in `index --write`).
2. r027: plan-scope resume semantics — define what "resume" means for a committed doc.
3. r029: capture `git worktree` path/branch on park; show it on resume.

## Out of scope

- H2 `blocked` state vs metadata (open, USER). Fixing the four XS docs (DUST2.9).
