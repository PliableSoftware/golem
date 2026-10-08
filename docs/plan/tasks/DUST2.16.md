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

Roadmap gap from ADR-0008 (DUST1.8 rows 4, 10, 11). Evidence per row is in DUST1.8.

## The work

1. r004: `default!` is described as the floor for future non-negotiables but nothing reads it —
   define and enforce it in the cascade resolver.
2. r010: render a pinned control as locked, with the origin that pinned it and how to change it,
   on the panel, `golem config`, the TUI and VS Code alike.
3. r011: populate `ApplyResult.overridden` when a write lands below a higher-precedence origin,
   and have each surface tell the user their write had no effect.

## Out of scope

- G3/S18 team policy reach (open, USER). G5 panel default scope (doc follows code).
