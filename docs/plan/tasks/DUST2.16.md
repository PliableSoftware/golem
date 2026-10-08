---
task: DUST2.16
title: "Settings cascade gaps: default! floor, locked controls rendered with origin + recourse, ApplyResult.overridden"
state: queued
owner: agent
size: M
discipline: code
design: "ADR-0008; wiki Settings Cascade, Configuration Surfaces; SUMMARY.md Gaps 1.8/r004 (N), r010 (P), r011 (P)"
gate: "`default!` is honoured as a floor; a pinned control renders locked with its origin and recourse on every surface (IMPORTANT_LOCKED); a write the cascade overrules returns ApplyResult.overridden and the surface says so; tests for each. golem verify green by exit code."
touches: [src/config, src/cli, src/tui, tests]
created: 2026-10-08
---

## What this is

Roadmap gap from ADR-0008 (DUST1.8 rows 4, 10, 11).

## Out of scope

- G3/S18 team policy reach (open, USER). G5 panel default scope (doc follows code).
